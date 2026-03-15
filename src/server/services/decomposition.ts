/**
 * Decomposition Service
 * Uses Claude Sonnet 4 to recursively break down high-level project specs
 * into executable sub-agent configurations. Each decomposition produces
 * child nodes and interface contracts between them.
 */
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { broadcastGlobal, broadcastToNode } from '../utils/sse';
import { getDefaultHooks } from '../utils/hooks-templates';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ComponentConfig {
  prompt: string;
  role: string;
  is_leaf: boolean;
  model: 'sonnet' | 'haiku' | 'opus';
  system_prompt_additions?: string;
  hooks?: Record<string, unknown>;
  mcp_tools?: unknown[];
  allowed_tools?: string[];
  allowed_paths?: string[];
  dependencies?: string[];
  acceptance_criteria?: string;
  context_files?: string[];
  max_iterations?: number;
  escalation_policy?: 'ask_human' | 'auto_retry' | 'fail';
}

interface ContractConfig {
  description: string;
  initial_content: string;
}

interface DecompositionResult {
  components: Record<string, ComponentConfig>;
  contracts: Record<string, ContractConfig>;
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  status: string;
  node_type: string;
  prompt: string | null;
  role: string | null;
  system_prompt: string | null;
  hooks: string | null;
  mcp_tools: string | null;
  allowed_tools: string | null;
  allowed_paths: string | null;
  dependencies: string | null;
  acceptance_criteria: string | null;
  context_files: string | null;
  max_iterations: number;
  escalation_policy: string;
  model: string;
  started_at: string | null;
  completed_at: string | null;
  execution_log: string | null;
  error_log: string | null;
  created_at: string;
}

/**
 * Build the decomposition prompt that instructs Claude to analyze the parent
 * node and generate a set of child agent configurations.
 */
function buildDecompositionPrompt(
  node: NodeRow,
  contracts: Array<{ name: string; content: string | null }>,
  projectSpec: string
): string {
  const contractsContent = contracts.length > 0
    ? contracts.map(c => `### ${c.name}\n${c.content || '(empty)'}`).join('\n\n')
    : 'No contracts defined yet.';

  return `You are a senior software architect performing recursive project decomposition.

## Context
- Project specification: ${projectSpec}
- Parent node name: ${node.name}
- Parent node prompt: ${node.prompt || '(none)'}
- Parent node role: ${node.role || 'Software Engineer'}
- Current depth: ${node.depth}
- Sibling contracts:
${contractsContent}

## Your Task
Decompose this component into sub-components. For each, provide a complete Claude Code agent configuration.

## Rules
1. Each sub-component should be a coherent unit of work (1-2 developer sessions max for leaves)
2. Define explicit file path boundaries (allowed_paths) for each component
3. Include a testing agent as a sibling at every level (suffix name with "-tests" or "-testing")
4. Set is_leaf: true when task is small enough for one developer session
5. Define acceptance_criteria clearly and measurably
6. Include appropriate hooks based on the type of work
7. Specify dependencies between siblings using their component names
8. Include contracts for any shared interfaces between components
9. The model field should reflect complexity: use "sonnet" for complex tasks, "haiku" for simple/test tasks

## Output Format
Respond with ONLY valid JSON (no markdown code fencing, no explanation text):
{
  "components": {
    "component-name": {
      "prompt": "Detailed task description for this agent...",
      "role": "Senior Backend Engineer",
      "is_leaf": false,
      "model": "sonnet",
      "system_prompt_additions": "Additional context specific to this component...",
      "hooks": {},
      "mcp_tools": [],
      "allowed_tools": ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
      "allowed_paths": ["src/component-name/"],
      "dependencies": [],
      "acceptance_criteria": "Measurable completion criteria...",
      "context_files": [],
      "max_iterations": 10,
      "escalation_policy": "ask_human"
    }
  },
  "contracts": {
    "contract-name": {
      "description": "What this contract defines...",
      "initial_content": "TypeScript interface or API spec content..."
    }
  }
}`;
}

/**
 * Parse and validate the Claude response as a DecompositionResult.
 * Claude can sometimes wrap JSON in markdown fences despite instructions.
 */
function parseDecompositionResponse(content: string): DecompositionResult {
  // Strip markdown code fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const result = JSON.parse(cleaned) as DecompositionResult;

  // Validate required structure
  if (!result.components || typeof result.components !== 'object') {
    throw new Error('Invalid decomposition: missing "components" object');
  }

  // Apply defaults to each component
  for (const [name, comp] of Object.entries(result.components)) {
    comp.allowed_tools = comp.allowed_tools || ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
    comp.mcp_tools = comp.mcp_tools || [];
    comp.dependencies = comp.dependencies || [];
    comp.context_files = comp.context_files || [];
    comp.max_iterations = comp.max_iterations || 10;
    comp.escalation_policy = comp.escalation_policy || 'ask_human';
    comp.model = comp.model || 'sonnet';

    // Auto-set node type based on name convention and is_leaf flag
    if (name.includes('test') || name.includes('testing')) {
      // Will be set as 'test' type in DB
    }
  }

  result.contracts = result.contracts || {};

  return result;
}

/**
 * Main decomposition function.
 * Updates node status, calls Claude API, creates child nodes and contracts.
 */
export async function decomposeNode(nodeId: string): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Cannot run decomposition. Set this environment variable and restart the server.');
  }
  const db = getDb();

  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  // Get project spec from root node
  const project = db.prepare(
    'SELECT p.*, n.system_prompt FROM projects p JOIN nodes n ON p.root_node_id = n.id WHERE p.root_node_id IN (WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM nodes WHERE id = ? UNION ALL SELECT n.id, n.parent_id FROM nodes n JOIN ancestors a ON n.id = a.parent_id) SELECT id FROM ancestors WHERE parent_id IS NULL)'
  ).get(nodeId);

  // Simpler approach: walk up to root
  let rootNode = node;
  while (rootNode.parent_id) {
    const parent = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootNode.parent_id) as NodeRow | undefined;
    if (!parent) break;
    rootNode = parent;
  }

  const projectSpec = rootNode.system_prompt || rootNode.prompt || 'Build the specified software system.';

  // Get sibling contracts (contracts belonging to parent node)
  const siblingContracts = node.parent_id
    ? db.prepare('SELECT name, content FROM contracts WHERE parent_node_id = ?').all(node.parent_id) as Array<{ name: string; content: string | null }>
    : [];

  // Mark node as decomposing
  db.prepare(`UPDATE nodes SET status = 'decomposing' WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'decomposing' });
  broadcastToNode(nodeId, 'log', { message: `Starting decomposition of "${node.name}"...` });

  try {
    const prompt = buildDecompositionPrompt(node, siblingContracts, projectSpec);

    broadcastToNode(nodeId, 'log', { message: 'Calling Claude API for decomposition...' });

    // Use Claude Sonnet 4 for high-quality architectural decomposition
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    broadcastToNode(nodeId, 'log', { message: 'Parsing decomposition result...' });

    const result = parseDecompositionResponse(textContent.text);
    const componentNames = Object.keys(result.components);

    broadcastToNode(nodeId, 'log', {
      message: `Creating ${componentNames.length} child nodes and ${Object.keys(result.contracts).length} contracts...`
    });

    // Create child nodes in a transaction for atomicity
    const insertNode = db.prepare(`
      INSERT INTO nodes (
        id, parent_id, name, depth, status, node_type, prompt, role, system_prompt,
        hooks, mcp_tools, allowed_tools, allowed_paths, dependencies,
        acceptance_criteria, context_files, max_iterations, escalation_policy, model
      ) VALUES (
        ?, ?, ?, ?, 'pending', ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const insertContract = db.prepare(`
      INSERT INTO contracts (id, parent_node_id, name, content, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);

    const createChildren = db.transaction(() => {
      const createdNodes: Array<{ id: string; name: string }> = [];

      for (const [compName, comp] of Object.entries(result.components)) {
        const childId = uuidv4();
        const nodeType = (compName.includes('test') || compName.includes('testing'))
          ? 'test'
          : comp.is_leaf ? 'leaf' : 'orchestrator';

        // Merge default hooks with template hooks
        const defaultHooks = getDefaultHooks(nodeType as 'orchestrator' | 'leaf' | 'test');
        const hooks = comp.hooks && Object.keys(comp.hooks).length > 0
          ? comp.hooks
          : defaultHooks;

        insertNode.run(
          childId,
          nodeId,
          compName,
          node.depth + 1,
          nodeType,
          comp.prompt || '',
          comp.role || 'Software Engineer',
          comp.system_prompt_additions || null,
          JSON.stringify(hooks),
          JSON.stringify(comp.mcp_tools || []),
          JSON.stringify(comp.allowed_tools || ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']),
          JSON.stringify(comp.allowed_paths || []),
          JSON.stringify(comp.dependencies || []),
          comp.acceptance_criteria || null,
          JSON.stringify(comp.context_files || []),
          comp.max_iterations || 10,
          comp.escalation_policy || 'ask_human',
          comp.model || 'sonnet'
        );

        createdNodes.push({ id: childId, name: compName });
      }

      // Create contracts for this node's children
      for (const [contractName, contract] of Object.entries(result.contracts)) {
        insertContract.run(
          uuidv4(),
          nodeId,
          contractName,
          contract.initial_content || '',
          null
        );
      }

      return createdNodes;
    });

    const createdNodes = createChildren();

    // Mark parent node as approved (decomposition complete)
    db.prepare(`UPDATE nodes SET status = 'approved', node_type = 'orchestrator' WHERE id = ?`).run(nodeId);

    // Broadcast all new nodes to connected clients
    for (const child of createdNodes) {
      const fullChild = db.prepare('SELECT * FROM nodes WHERE id = ?').get(child.id);
      broadcastGlobal('node:created', { node: fullChild });
    }

    broadcastGlobal('node:status', { nodeId, status: 'approved' });
    broadcastToNode(nodeId, 'log', {
      message: `Decomposition complete. Created ${createdNodes.length} child agents.`
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE nodes SET status = 'failed', error_log = ? WHERE id = ?`).run(errorMessage, nodeId);
    broadcastGlobal('node:status', { nodeId, status: 'failed' });
    broadcastToNode(nodeId, 'error', { message: `Decomposition failed: ${errorMessage}` });
    throw error;
  }
}
