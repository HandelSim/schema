/**
 * Context Generator
 * Generates the CLAUDE.md hierarchy and settings files for a project's agent workspaces.
 *
 * Improvement 5: CLAUDE.md Hierarchy
 * - generateProjectClaude(): root-level project context
 * - generateNodeClaude(): per-node context (inherits ancestor chain)
 * - generateSettings(): per-node Claude Code settings.json
 *
 * Files are written under /tmp/ato-contexts/{projectId}/ so each agent
 * has a ready-made workspace when execution starts.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db';
import { generateClaudeMd, generateRootClaudeMd } from './claude-md';
import { getTierConfig } from '../config/testing-tiers';
import { storeHammerConfig } from './execution';

interface NodeRow {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  node_type: string;
  model: string;
  allowed_tools: string | null;
  mcp_tools: string | null;
  testing_tier: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  root_node_id: string | null;
}

/**
 * Get all nodes in a project tree (recursive CTE).
 */
function getProjectNodes(projectId: string): NodeRow[] {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!project?.root_node_id) return [];

  return db.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT ?
      UNION ALL
      SELECT nodes.id FROM nodes JOIN tree ON nodes.parent_id = tree.id
    )
    SELECT * FROM nodes WHERE id IN (SELECT id FROM tree)
    ORDER BY depth, created_at
  `).all(project.root_node_id) as NodeRow[];
}

/**
 * Generate the project-level CLAUDE.md.
 * Written to: {contextRoot}/{projectId}/CLAUDE.md
 */
export function generateProjectClaude(projectId: string): string {
  return generateRootClaudeMd(projectId);
}

/**
 * Generate a node-specific CLAUDE.md that inherits the full ancestor chain.
 * Written to: {contextRoot}/{projectId}/nodes/{nodeId}/CLAUDE.md
 */
export function generateNodeClaude(nodeId: string): string {
  return generateClaudeMd(nodeId);
}

/**
 * Generate Claude Code settings.json for a node's workspace.
 * Configures model, tools, MCP servers, and testing hooks based on testing tier.
 */
export function generateSettings(nodeId: string): Record<string, unknown> {
  const db = getDb();
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const tierConfig = getTierConfig(node.testing_tier);
  const allowedTools: string[] = node.allowed_tools ? JSON.parse(node.allowed_tools) : ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
  const mcpTools: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }> = node.mcp_tools ? JSON.parse(node.mcp_tools) : [];

  // Add Playwright MCP only for Tier 3
  const effectiveMcpTools = [...mcpTools];
  if (tierConfig.playwrightMcp) {
    effectiveMcpTools.push({
      name: 'playwright',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    });
  }

  const mcpServers: Record<string, unknown> = {};
  for (const tool of effectiveMcpTools) {
    mcpServers[tool.name] = {
      command: tool.command,
      args: tool.args || [],
      env: tool.env || {},
    };
  }

  return {
    model: resolveModelId(node.model),
    permissions: {
      allow: allowedTools.map(t => `${t}(*)`),
      deny: [],
    },
    mcpServers,
    env: {
      TESTING_TIER: node.testing_tier || 'tier1',
    },
  };
}

function resolveModelId(model: string): string {
  const map: Record<string, string> = {
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5',
    opus: 'claude-opus-4-6',
  };
  return map[model] || 'claude-sonnet-4-6';
}

/**
 * Generate and write all context files for an entire project.
 * Creates:
 *   {contextRoot}/{projectId}/CLAUDE.md              — project root context
 *   {contextRoot}/{projectId}/nodes/{nodeId}/CLAUDE.md — per-node context
 *   {contextRoot}/{projectId}/nodes/{nodeId}/settings.json — per-node settings
 *
 * Returns the context root path.
 */
export async function generateAllContexts(projectId: string): Promise<string> {
  const contextRoot = process.env.CONTEXT_ROOT || join(process.cwd(), 'contexts');
  const projectDir = join(contextRoot, projectId);

  mkdirSync(projectDir, { recursive: true });

  // Project-level CLAUDE.md
  const projectClaude = generateProjectClaude(projectId);
  writeFileSync(join(projectDir, 'CLAUDE.md'), projectClaude, 'utf-8');

  // Per-node files
  const nodes = getProjectNodes(projectId);
  for (const node of nodes) {
    const nodeDir = join(projectDir, 'nodes', node.id);
    mkdirSync(nodeDir, { recursive: true });

    const nodeClaude = generateNodeClaude(node.id);
    writeFileSync(join(nodeDir, 'CLAUDE.md'), nodeClaude, 'utf-8');

    const settings = generateSettings(node.id);
    writeFileSync(join(nodeDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');

    // Store HammerConfig JSON on the node for execution
    const tierConfig = getTierConfig(node.testing_tier);
    const allowedTools: string[] = node.allowed_tools ? JSON.parse(node.allowed_tools) : ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
    const hammerConfig = {
      model: resolveModelId(node.model),
      maxTurns: 40,
      allowedTools,
      screenshots: { enabled: tierConfig.playwrightMcp ?? false },
      permissionMode: 'bypassPermissions' as const,
    };
    storeHammerConfig(node.id, hammerConfig);
  }

  return projectDir;
}
