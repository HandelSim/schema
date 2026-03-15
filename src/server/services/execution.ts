/**
 * Execution Engine — HAMMER integration
 *
 * SCHEMA delegates all agent execution to HAMMER, which handles:
 * - Claude Agent SDK wrapping
 * - Retry logic with failure prompt reconstruction
 * - Acceptance check execution and evaluation
 * - Screenshot capture and visual verification
 * - Session save/load for resumption
 * - Cost tracking and budget enforcement
 *
 * This file is responsible only for:
 * - Reading node config from the DB
 * - Building a HammerConfig from the node's hammer_config JSON
 * - Calling runHammer()
 * - Persisting results back to the DB and broadcasting SSE events
 */

import { join } from 'path';
import { getDb } from '../db';
import { broadcastGlobal, broadcastToNode } from '../utils/sse';
import { setupWorkspace } from './workspace';
import { maybeRunIntegrationVerification } from './integration-verifier';
import { runHammer, HammerConfig, resolveConfig } from '@handelSim/hammer';

// Track in-flight executions so we can cancel them
const runningAbortControllers = new Map<string, AbortController>();

interface NodeRow {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  node_type: string;
  prompt: string | null;
  model: string;
  max_iterations: number;
  allowed_tools: string | null;
  execution_log: string | null;
  error_log: string | null;
  hammer_config: string | null;
  hammer_session_id: string | null;
  acceptance_criteria: string | null;
  system_prompt: string | null;
}

/**
 * Map our model names to Claude model identifiers.
 */
function resolveModelId(model: string): string {
  const modelMap: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-6',
    'haiku': 'claude-haiku-4-5',
    'opus': 'claude-opus-4-6',
  };
  return modelMap[model] || 'claude-sonnet-4-6';
}

/**
 * Get the project ID for a given node by walking to root.
 */
function getProjectId(nodeId: string): string {
  const db = getDb();
  let currentId: string | null = nodeId;
  let rootId = nodeId;
  while (currentId) {
    const node = db.prepare('SELECT parent_id FROM nodes WHERE id = ?').get(currentId) as { parent_id: string | null } | undefined;
    if (!node || !node.parent_id) { rootId = currentId; break; }
    currentId = node.parent_id;
  }
  const project = db.prepare('SELECT id FROM projects WHERE root_node_id = ?').get(rootId) as { id: string } | undefined;
  return project?.id || 'default';
}

/**
 * Append a log line to the DB and broadcast via SSE.
 */
function appendLog(nodeId: string, line: string, isError = false): void {
  const db = getDb();
  const node = db.prepare('SELECT execution_log, error_log FROM nodes WHERE id = ?').get(nodeId) as {
    execution_log: string | null;
    error_log: string | null;
  } | undefined;

  if (isError) {
    const existing = node?.error_log || '';
    db.prepare('UPDATE nodes SET error_log = ? WHERE id = ?').run(existing + line + '\n', nodeId);
    broadcastToNode(nodeId, 'log:error', { message: line, timestamp: new Date().toISOString() });
  } else {
    const existing = node?.execution_log || '';
    db.prepare('UPDATE nodes SET execution_log = ? WHERE id = ?').run(existing + line + '\n', nodeId);
    broadcastToNode(nodeId, 'log:output', { message: line, timestamp: new Date().toISOString() });
  }
}

/**
 * Build a HammerConfig from a node row.
 * Merges the node's hammer_config JSON with sensible defaults from the node's DB fields.
 */
function buildHammerConfig(node: NodeRow, workspacePath: string): Partial<HammerConfig> & { cwd: string; prompt: string } {
  // Start with any stored HammerConfig on the node
  let storedConfig: Partial<HammerConfig> = {};
  if (node.hammer_config) {
    try {
      storedConfig = JSON.parse(node.hammer_config);
    } catch {
      // ignore malformed JSON
    }
  }

  // Parse allowed_tools from JSON string
  let allowedTools: string[] = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent'];
  if (node.allowed_tools) {
    try {
      allowedTools = JSON.parse(node.allowed_tools);
    } catch {
      // use default
    }
  }

  // Build acceptance checks from acceptance_criteria
  const acceptanceChecks = storedConfig.acceptanceChecks ?? undefined;

  return {
    ...storedConfig,
    cwd: workspacePath,
    prompt: node.prompt || 'Complete the task described in CLAUDE.md',
    model: storedConfig.model ?? resolveModelId(node.model),
    maxTurns: storedConfig.maxTurns ?? node.max_iterations ?? 10,
    allowedTools: storedConfig.allowedTools ?? allowedTools,
    systemPrompt: storedConfig.systemPrompt ?? node.system_prompt ?? undefined,
    sessionId: node.hammer_session_id ?? storedConfig.sessionId ?? undefined,
    sessionDir: '/tmp/hammer-sessions',
    acceptanceChecks,
    retryPolicy: storedConfig.retryPolicy ?? { maxAttempts: 2, escalateAfter: 2, delayMs: 1000 },
    escalationPolicy: storedConfig.escalationPolicy ?? { type: 'log' },
    permissionMode: storedConfig.permissionMode ?? 'bypassPermissions',
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      ...(storedConfig.env ?? {}),
    },
  };
}

/**
 * Execute a leaf node agent using HAMMER.
 * HAMMER handles SDK wrapping, retries, acceptance checks, sessions, and cost tracking.
 */
export async function executeNode(nodeId: string): Promise<void> {
  const db = getDb();
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  if (node.node_type === 'orchestrator') {
    throw new Error('Cannot directly execute an orchestrator node. Approve children first.');
  }

  if (runningAbortControllers.has(nodeId)) {
    throw new Error(`Node ${nodeId} is already running`);
  }

  const projectId = getProjectId(nodeId);
  const abortController = new AbortController();
  runningAbortControllers.set(nodeId, abortController);

  // Mark as running
  db.prepare(`UPDATE nodes SET status = 'running', started_at = CURRENT_TIMESTAMP, execution_log = '', error_log = '' WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'running' });

  try {
    appendLog(nodeId, 'Setting up workspace...');
    const workspacePath = await setupWorkspace(nodeId, projectId);
    appendLog(nodeId, `Workspace ready at: ${workspacePath}`);

    const hammerPartialConfig = buildHammerConfig(node, workspacePath);
    appendLog(nodeId, `Launching HAMMER (model: ${hammerPartialConfig.model}, maxTurns: ${hammerPartialConfig.maxTurns})...`);

    // Resolve full config (auto-detects acceptance checks, workspace type, etc.)
    const hammerConfig = await resolveConfig(hammerPartialConfig);

    appendLog(nodeId, `Acceptance checks: ${hammerConfig.acceptanceChecks?.map(c => c.name).join(', ') || 'auto-detected'}`);

    // Run HAMMER — handles everything internally
    const result = await runHammer(hammerConfig);

    runningAbortControllers.delete(nodeId);

    // Persist results
    db.prepare(`UPDATE nodes SET hammer_session_id = ?, hammer_cost = ? WHERE id = ?`)
      .run(result.sessionId ?? null, JSON.stringify(result.cost), nodeId);

    // Stream output to log
    if (result.output) {
      const lines = result.output.split('\n');
      for (const line of lines.slice(-100)) { // last 100 lines
        if (line.trim()) appendLog(nodeId, line);
      }
    }

    // Log acceptance check results
    for (const check of result.acceptanceResults) {
      const icon = check.passed ? '✓' : '✗';
      appendLog(nodeId, `[acceptance] ${icon} ${check.name} (${check.durationMs}ms)`, !check.passed);
    }

    // Log cost
    appendLog(nodeId, `Cost: $${result.cost.estimatedUsd.toFixed(4)} (${result.cost.inputTokens} in / ${result.cost.outputTokens} out tokens)`);

    if (result.status === 'success') {
      db.prepare(`UPDATE nodes SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nodeId);
      broadcastGlobal('node:status', { nodeId, status: 'completed' });
      broadcastToNode(nodeId, 'log:complete', {
        message: `Execution completed successfully (${result.attempts} attempt${result.attempts > 1 ? 's' : ''})`,
        exitCode: 0,
      });
      maybeRunIntegrationVerification(nodeId).catch(err =>
        console.error('[execution] Integration verification error:', err)
      );
    } else {
      const errMsg = `HAMMER status: ${result.status} — ${result.error ?? 'unknown'}`;
      db.prepare(`UPDATE nodes SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_log = ? WHERE id = ?`)
        .run(errMsg, nodeId);
      broadcastGlobal('node:status', { nodeId, status: 'failed' });
      broadcastToNode(nodeId, 'log:error', { message: errMsg });
      maybeRunIntegrationVerification(nodeId).catch(err =>
        console.error('[execution] Integration verification error:', err)
      );
      throw new Error(errMsg);
    }

  } catch (error) {
    runningAbortControllers.delete(nodeId);
    const errorMessage = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE nodes SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_log = ? WHERE id = ?`)
      .run(errorMessage, nodeId);
    broadcastGlobal('node:status', { nodeId, status: 'failed' });
    broadcastToNode(nodeId, 'log:error', { message: `Execution failed: ${errorMessage}` });
    throw error;
  }
}

/**
 * Cancel a running execution.
 */
export function cancelExecution(nodeId: string): boolean {
  const controller = runningAbortControllers.get(nodeId);
  if (!controller) return false;

  controller.abort();
  runningAbortControllers.delete(nodeId);

  const db = getDb();
  db.prepare(`UPDATE nodes SET status = 'failed', error_log = 'Cancelled by user' WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'failed' });

  return true;
}

/**
 * Get list of currently running node IDs.
 */
export function getRunningNodes(): string[] {
  return Array.from(runningAbortControllers.keys());
}

/**
 * Store a HammerConfig JSON on a node (called by Generate Agent Contexts).
 */
export function storeHammerConfig(nodeId: string, config: Partial<HammerConfig>): void {
  const db = getDb();
  db.prepare('UPDATE nodes SET hammer_config = ? WHERE id = ?')
    .run(JSON.stringify(config), nodeId);
}
