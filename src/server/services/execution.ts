/**
 * Execution Engine
 * Launches Claude Code CLI as a subprocess to execute leaf node agents.
 *
 * Architecture decision: Using child_process.spawn (not exec) so we can:
 * 1. Stream stdout/stderr in real-time via SSE
 * 2. Handle large outputs without buffer overflow
 * 3. Properly signal process termination
 *
 * Claude Code CLI command format:
 * claude --model {model} --max-turns {max_iterations} --print --output-format json -p "{prompt}"
 */
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { getDb } from '../db';
import { broadcastGlobal, broadcastToNode } from '../utils/sse';
import { setupWorkspace } from './workspace';

// Track running processes so we can cancel them
const runningProcesses = new Map<string, ChildProcess>();

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
}

/**
 * Map our model names to Claude Code CLI model identifiers.
 */
function resolveModelId(model: string): string {
  const modelMap: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'haiku': 'claude-haiku-4-5',
    'opus': 'claude-opus-4-5',
  };
  return modelMap[model] || 'claude-sonnet-4-5';
}

/**
 * Get the project ID for a given node by walking to root and finding the project.
 */
function getProjectId(nodeId: string): string {
  const db = getDb();

  // Walk up to find root node
  let currentId: string | null = nodeId;
  let rootId = nodeId;
  while (currentId) {
    const node = db.prepare('SELECT parent_id FROM nodes WHERE id = ?').get(currentId) as { parent_id: string | null } | undefined;
    if (!node || !node.parent_id) {
      rootId = currentId;
      break;
    }
    currentId = node.parent_id;
  }

  // Find project with this root node
  const project = db.prepare('SELECT id FROM projects WHERE root_node_id = ?').get(rootId) as { id: string } | undefined;
  return project?.id || 'default';
}

/**
 * Append a log line to both the node's DB record and SSE stream.
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
 * Execute a leaf node agent using Claude Code CLI.
 * Streams output in real-time, updates node status on completion.
 */
export async function executeNode(nodeId: string): Promise<void> {
  const db = getDb();
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  if (node.node_type === 'orchestrator') {
    throw new Error('Cannot directly execute an orchestrator node. Approve children first.');
  }

  if (runningProcesses.has(nodeId)) {
    throw new Error(`Node ${nodeId} is already running`);
  }

  const projectId = getProjectId(nodeId);

  // Mark as running
  db.prepare(`UPDATE nodes SET status = 'running', started_at = CURRENT_TIMESTAMP, execution_log = '', error_log = '' WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'running' });

  try {
    // Set up workspace with CLAUDE.md, settings, MCP config
    broadcastToNode(nodeId, 'log:output', { message: 'Setting up workspace...', timestamp: new Date().toISOString() });
    const workspacePath = await setupWorkspace(nodeId, projectId);

    broadcastToNode(nodeId, 'log:output', {
      message: `Workspace ready at: ${workspacePath}`,
      timestamp: new Date().toISOString()
    });

    const modelId = resolveModelId(node.model);
    const prompt = node.prompt || 'Complete the task described in CLAUDE.md';
    const maxTurns = node.max_iterations || 10;

    // Build Claude Code CLI command
    // --print: non-interactive mode
    // --output-format json: structured output for parsing
    // -p: initial prompt
    const claudeArgs = [
      '--model', modelId,
      '--max-turns', String(maxTurns),
      '--print',
      '--output-format', 'json',
      '-p', prompt,
    ];

    broadcastToNode(nodeId, 'log:output', {
      message: `Launching: claude ${claudeArgs.slice(0, 4).join(' ')} ...`,
      timestamp: new Date().toISOString()
    });

    // Check if claude CLI is available
    const claudeAvailable = await checkClaudeAvailable();
    if (!claudeAvailable) {
      // Graceful degradation: simulate execution for development/testing
      await simulateExecution(nodeId, node);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('claude', claudeArgs, {
        cwd: workspacePath,
        env: {
          ...process.env,
          // Don't override ANTHROPIC_API_KEY — claude CLI uses its own stored
          // OAuth credentials (~/.claude/.credentials.json) when not set.
          ...(process.env.ANTHROPIC_API_KEY
            ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      runningProcesses.set(nodeId, proc);

      let outputBuffer = '';
      let errorBuffer = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        outputBuffer += text;

        // Stream line by line for real-time feedback
        const lines = outputBuffer.split('\n');
        outputBuffer = lines.pop() || ''; // keep incomplete line in buffer
        for (const line of lines) {
          if (line.trim()) appendLog(nodeId, line);
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        errorBuffer += text;

        const lines = errorBuffer.split('\n');
        errorBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) appendLog(nodeId, line, true);
        }
      });

      proc.on('close', (code) => {
        runningProcesses.delete(nodeId);

        // Flush remaining buffer content
        if (outputBuffer.trim()) appendLog(nodeId, outputBuffer);
        if (errorBuffer.trim()) appendLog(nodeId, errorBuffer, true);

        if (code === 0) {
          db.prepare(`UPDATE nodes SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nodeId);
          broadcastGlobal('node:status', { nodeId, status: 'completed' });
          broadcastToNode(nodeId, 'log:complete', { message: 'Execution completed successfully', exitCode: 0 });
          resolve();
        } else {
          const errMsg = `Process exited with code ${code}`;
          db.prepare(`UPDATE nodes SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nodeId);
          broadcastGlobal('node:status', { nodeId, status: 'failed' });
          broadcastToNode(nodeId, 'log:error', { message: errMsg, exitCode: code });
          reject(new Error(errMsg));
        }
      });

      proc.on('error', (err) => {
        runningProcesses.delete(nodeId);
        reject(err);
      });
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE nodes SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_log = ? WHERE id = ?`)
      .run(errorMessage, nodeId);
    broadcastGlobal('node:status', { nodeId, status: 'failed' });
    broadcastToNode(nodeId, 'log:error', { message: `Execution failed: ${errorMessage}` });
    throw error;
  }
}

/**
 * Check if Claude Code CLI is available in the PATH.
 */
async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', ['claude'], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Simulate execution when Claude Code CLI is not available.
 * Used for development/testing without the full CLI installed.
 */
async function simulateExecution(nodeId: string, node: NodeRow): Promise<void> {
  const db = getDb();

  appendLog(nodeId, '[SIMULATION MODE] Claude Code CLI not found. Simulating execution...');
  appendLog(nodeId, `Task: ${node.prompt || 'No prompt defined'}`);
  appendLog(nodeId, `Model: ${node.model}, Max turns: ${node.max_iterations}`);

  // Simulate some processing time
  await new Promise(r => setTimeout(r, 1000));
  appendLog(nodeId, '[SIMULATION] Analyzing task requirements...');

  await new Promise(r => setTimeout(r, 1000));
  appendLog(nodeId, '[SIMULATION] Task analysis complete. In production, Claude Code would execute here.');
  appendLog(nodeId, '[SIMULATION] Install Claude Code CLI: npm install -g @anthropic-ai/claude-code');

  db.prepare(`UPDATE nodes SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'completed' });
  broadcastToNode(nodeId, 'log:complete', { message: 'Simulation complete', exitCode: 0 });
}

/**
 * Cancel a running execution.
 */
export function cancelExecution(nodeId: string): boolean {
  const proc = runningProcesses.get(nodeId);
  if (!proc) return false;

  proc.kill('SIGTERM');
  runningProcesses.delete(nodeId);

  const db = getDb();
  db.prepare(`UPDATE nodes SET status = 'failed', error_log = 'Cancelled by user' WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'failed' });

  return true;
}

/**
 * Get list of currently running node IDs.
 */
export function getRunningNodes(): string[] {
  return Array.from(runningProcesses.keys());
}
