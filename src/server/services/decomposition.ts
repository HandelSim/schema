/**
 * Decomposition Service
 * Uses Claude Haiku to recursively break down high-level project specs
 * into executable sub-agent configurations. Each decomposition produces
 * child nodes and interface contracts between them.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
import { getDb } from '../db';
import { broadcastGlobal, broadcastToNode } from '../utils/sse';
import { getDefaultHooks } from '../utils/hooks-templates';

/** Load the HAMMER capabilities manifest once at startup. */
const CAPABILITIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/hammer-capabilities.json'), 'utf-8')
);

/**
 * Rate limiting for auto-mode recursive decomposition.
 * Stagger child decomposition launches to avoid bursting the Claude API with
 * simultaneous requests when many non-leaf children are created at once.
 * Each subsequent child gets an additional DECOMPOSE_STAGGER_MS delay.
 */
const DECOMPOSE_STAGGER_MS = 2000;

/**
 * Maximum number of decompositions that may run concurrently across the
 * entire server process.  Prevents exponential fan-out in deep auto-mode trees.
 */
const MAX_CONCURRENT_DECOMPOSITIONS = 4;

let activeDecompositions = 0;

/** Acquire the decomposition semaphore, waiting if at capacity. */
async function acquireDecompositionSlot(): Promise<void> {
  while (activeDecompositions >= MAX_CONCURRENT_DECOMPOSITIONS) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  activeDecompositions++;
}

function releaseDecompositionSlot(): void {
  if (activeDecompositions > 0) activeDecompositions--;
}

/** Call Claude CLI and return full text output (non-streaming, for decomposition). */
async function callClaudeCLI(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = (require('child_process') as typeof import('child_process')).spawn('claude', [
      '-p',
      '--output-format', 'text',
      '--model', 'claude-haiku-4-5-20251001',
      '--strict-mcp-config',
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.on('close', (code: number | null) => {
      if (code !== 0) reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
      else resolve(stdout.trim());
    });
    proc.on('error', (e: Error) => reject(e));
    setTimeout(() => { proc.kill(); reject(new Error('claude CLI timeout')); }, 300000);
  });
}

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
  testing_tier?: 'tier1' | 'tier2' | 'tier3';
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
 * Injects the HAMMER capabilities manifest so Claude makes grounded choices
 * instead of guessing what tools, hooks, and MCP servers are available.
 */
function buildDecompositionPrompt(
  node: NodeRow,
  contracts: Array<{ name: string; content: string | null }>,
  projectSpec: string
): string {
  const contractsContent = contracts.length > 0
    ? contracts.map(c => `### ${c.name}\n${c.content || '(empty)'}`).join('\n\n')
    : 'No contracts defined yet.';

  const caps = CAPABILITIES;

  // Format allowed_tools guidance from the manifest
  const toolsGuidance = [
    `- leaf nodes: ${JSON.stringify(caps.claude_code_tools.recommended_defaults.leaf)}`,
    `- test nodes: ${JSON.stringify(caps.claude_code_tools.recommended_defaults.test)}`,
    `- orchestrator nodes: ${JSON.stringify(caps.claude_code_tools.recommended_defaults.orchestrator)}`,
    `- Add "WebFetch" or "WebSearch" only if the node needs live internet access`,
    `- Add "Agent" only if the node needs to spawn sub-agents`,
  ].join('\n');

  // Format hook templates from the manifest
  const hooksGuidance = Object.entries(caps.hook_templates)
    .filter(([key]) => key !== '_comment' && key !== 'defaults_by_node_type')
    .map(([name, h]: [string, any]) => `  - "${name}": ${h.description} | Use when: ${h.use_when}`)
    .join('\n');

  // Format MCP servers from the manifest
  const mcpGuidance = Object.entries(caps.mcp_servers)
    .filter(([key]) => key !== '_comment')
    .map(([name, s]: [string, any]) => `  - "${name}": ${s.description}\n    Cost: ${s.cost}\n    When: ${s.when_to_use}`)
    .join('\n\n');

  // Format testing tiers from the manifest
  const tiersGuidance = Object.entries(caps.testing_tiers)
    .filter(([key]) => key !== '_comment')
    .map(([tier, t]: [string, any]) => `  - "${tier}" (${t.label}): ${t.description}\n    Assign when: ${t.assign_when}`)
    .join('\n\n');

  const MAX_DEPTH = 2;
  const depthNote = node.depth >= MAX_DEPTH - 1
    ? `\n⚠️  DEPTH LIMIT: This node is at depth ${node.depth}. All children MUST be leaves (is_leaf: true). Do NOT create any orchestrator children — the tree must terminate here.`
    : ``;

  return `You are a senior software architect performing recursive project decomposition for SCHEMA, a multi-agent software development orchestrator.

**CRITICAL: This tree graph represents a project FILE STRUCTURE. Every node is a DIRECTORY. The component names you choose become directory names in the project. The full path of a node is built by joining its ancestors: e.g. root/backend/api. Design the tree as you would design a real project directory hierarchy.**

Each directory/node becomes a HAMMER agent — a Claude Code instance scoped to that directory, with specific tool access, file path boundaries, hooks, and acceptance criteria. Your configs must be precise and grounded in what HAMMER actually supports.

## Project Context
- Project specification: ${projectSpec}
- Parent directory (node) name: ${node.name}
- Parent directory prompt/purpose: ${node.prompt || '(none)'}
- Parent directory role: ${node.role || 'Software Engineer'}
- Current depth: ${node.depth}${depthNote}

## Existing Contracts (shared interfaces between sibling directories)
${contractsContent}

---

## DIRECTORY STRUCTURE RULES
- Component names MUST be valid directory names (lowercase, hyphens, no spaces)
- Each component represents a real subdirectory that will exist in the project
- allowed_paths for each node should be the directory path relative to the project root
- Think like a file system: src/, tests/, docs/, api/, lib/, config/ etc.
- Children of a node live inside that node's directory
- Leaf nodes are the actual implementation directories — files get written there
- Orchestrator nodes are parent directories that contain child directories

---

## HAMMER CAPABILITIES — What You Can Configure

### allowed_tools
Only use tool names from this list. Recommended defaults by node type:
${toolsGuidance}

### hooks
Leave hooks as {} to apply the correct default hooks for the node_type automatically.
The server maps node types to these defaults:
  - leaf: pathBoundary + codeQuality + secretDetection + contractVerification
  - test: pathBoundary + testRunner + secretDetection
  - orchestrator: (none — orchestrators don't write files)

Available hook templates if you need custom overrides:
${hooksGuidance}

### mcp_tools
Available MCP servers (include full config object if you want one enabled):

${mcpGuidance}

Include context7 for any node working with third-party libraries.
Use the exact config object from the manifest — do not invent MCP server configs.

### testing_tier
Assign a testing tier to control what testing infrastructure runs:

${tiersGuidance}

### model
ALWAYS use "haiku" — all agent nodes run claude-haiku-4-5-20251001. This is enforced server-side.

---

## Decomposition Rules
1. Each sub-directory should be a coherent unit of work (1-2 developer sessions max for leaves)
2. Define explicit file path boundaries (allowed_paths) matching the actual directory path
3. Include exactly one test/integration sibling at each level (suffix: "-tests" or "-testing")
4. Set is_leaf: true when the directory contains final implementation files (no subdirectories)
5. Write acceptance_criteria as measurable, verifiable completion criteria (not vague goals)
6. Leave hooks:{} unless you have a specific reason to override the node-type defaults
7. List dependencies by directory name — these control execution order
8. Include contracts for any shared TypeScript interfaces, API specs, or data schemas
9. Add context7 to mcp_tools for any directory that will use third-party libraries
10. Assign testing_tier: "tier3" ONLY to integration-test nodes that run after siblings complete

## Output Format
Respond with ONLY valid JSON (no markdown code fencing, no explanation text):
{
  "components": {
    "component-name": {
      "prompt": "Detailed task description — specific enough that a developer could execute it without asking questions",
      "role": "Senior Backend Engineer",
      "is_leaf": true,
      "model": "haiku",
      "system_prompt_additions": "Additional context specific to this component (optional)",
      "hooks": {},
      "mcp_tools": [
        { "name": "context7", "command": "npx", "args": ["-y", "@upstash/context7-mcp@latest"] }
      ],
      "allowed_tools": ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
      "allowed_paths": ["src/component-name/"],
      "dependencies": ["other-component-name"],
      "acceptance_criteria": "All unit tests pass. TypeScript compiles with zero errors. ESLint reports zero warnings.",
      "context_files": [],
      "max_iterations": 10,
      "escalation_policy": "ask_human",
      "testing_tier": "tier1"
    }
  },
  "contracts": {
    "contract-name": {
      "description": "What this contract defines and which components use it",
      "initial_content": "// TypeScript interface or OpenAPI spec\nexport interface Foo { ... }"
    }
  }
}`;
}

/**
 * Parse and validate the Claude response as a DecompositionResult.
 * Claude can sometimes wrap JSON in markdown fences despite instructions.
 */
function parseDecompositionResponse(content: string): DecompositionResult {
  // Strip markdown code fences — handles both leading/trailing fences and
  // cases where Claude wraps the JSON in a fence anywhere in the response.
  let cleaned = content.trim();

  // Try to extract JSON from a ```json ... ``` or ``` ... ``` block first
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // As a last resort, find the outermost { ... } in case there's surrounding text
  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }
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
    comp.model = comp.model || 'haiku';

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
 * Acquires the global concurrency semaphore before calling the Claude API to
 * prevent exponential request bursts during auto-mode tree expansion.
 */
export async function decomposeNode(nodeId: string): Promise<void> {
  const db = getDb();

  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  // Get project spec from root node
  const project = db.prepare(
    'SELECT p.*, n.system_prompt FROM projects p JOIN nodes n ON p.root_node_id = n.id WHERE p.root_node_id IN (WITH RECURSIVE ancestors(id, parent_id) AS (SELECT id, parent_id FROM nodes WHERE id = ? UNION ALL SELECT n.id, n.parent_id FROM nodes n JOIN ancestors a ON n.id = a.parent_id) SELECT id FROM ancestors WHERE parent_id IS NULL)'
  ).get(nodeId);

  // Walk up to root node
  let rootNode = node;
  while (rootNode.parent_id) {
    const parent = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootNode.parent_id) as NodeRow | undefined;
    if (!parent) break;
    rootNode = parent;
  }

  // Truncate the project spec so decomposition prompts stay a manageable size.
  // Very long specs cause slower Claude responses and excessive fan-out.
  const MAX_SPEC_CHARS = 800;
  const rawSpec = rootNode.system_prompt || rootNode.prompt || 'Build the specified software system.';
  const projectSpec = rawSpec.length > MAX_SPEC_CHARS
    ? rawSpec.slice(0, MAX_SPEC_CHARS) + '… (truncated for decomposition efficiency)'
    : rawSpec;

  // Check project mode for auto-approve behaviour
  const projectRecord = db.prepare(
    'SELECT mode FROM projects WHERE root_node_id = ?'
  ).get(rootNode.id) as { mode: string } | undefined;
  const isAutoMode = projectRecord?.mode === 'auto';

  // Get sibling contracts (contracts belonging to parent node)
  const siblingContracts = node.parent_id
    ? db.prepare('SELECT name, content FROM contracts WHERE parent_node_id = ?').all(node.parent_id) as Array<{ name: string; content: string | null }>
    : [];

  try {
    const prompt = buildDecompositionPrompt(node, siblingContracts, projectSpec);

    // Throttle concurrent calls — acquire slot BEFORE marking decomposing so
    // the DB status reflects nodes that are actually running (not queued).
    await acquireDecompositionSlot();

    // Mark node as decomposing only after we've acquired the semaphore slot.
    db.prepare(`UPDATE nodes SET status = 'decomposing' WHERE id = ?`).run(nodeId);
    broadcastGlobal('node:status', { nodeId, status: 'decomposing' });
    broadcastToNode(nodeId, 'log', { message: `Starting decomposition of "${node.name}"...` });

    broadcastToNode(nodeId, 'log', { message: 'Calling Claude for decomposition...' });
    let rawText: string;
    try {
      rawText = await callClaudeCLI(prompt);
    } finally {
      releaseDecompositionSlot();
    }

    if (!rawText.trim()) {
      throw new Error('Claude CLI produced no output for decomposition');
    }

    broadcastToNode(nodeId, 'log', { message: 'Parsing decomposition result...' });

    const result = parseDecompositionResponse(rawText);
    const componentNames = Object.keys(result.components);

    broadcastToNode(nodeId, 'log', {
      message: `Creating ${componentNames.length} child nodes and ${Object.keys(result.contracts).length} contracts...`
    });

    // Create child nodes in a transaction for atomicity
    const insertNode = db.prepare(`
      INSERT INTO nodes (
        id, parent_id, name, depth, status, node_type, prompt, role, system_prompt,
        hooks, mcp_tools, allowed_tools, allowed_paths, dependencies,
        acceptance_criteria, context_files, max_iterations, escalation_policy, model,
        testing_tier
      ) VALUES (
        ?, ?, ?, ?, 'pending', ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?
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

        // Derive default testing_tier from node type if not specified
        const testingTier = comp.testing_tier ||
          (nodeType === 'test' ? 'tier1' : 'tier1');

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
          comp.model || 'haiku',
          testingTier
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

    // In auto mode: approve all children and recursively decompose non-leaf ones.
    // Stagger launches by DECOMPOSE_STAGGER_MS per child to avoid bursting the
    // Claude API with simultaneous requests.
    // Hard depth limit: nodes at MAX_DEPTH or below are converted to leaves to
    // prevent runaway infinite tree expansion.
    const MAX_AUTO_DECOMPOSE_DEPTH = 2;
    if (isAutoMode) {
      broadcastToNode(nodeId, 'log', { message: 'Auto mode: approving all child nodes...' });
      let staggerIndex = 0;
      for (const child of createdNodes) {
        db.prepare(`UPDATE nodes SET status = 'approved' WHERE id = ?`).run(child.id);
        broadcastGlobal('node:status', { nodeId: child.id, status: 'approved' });
        const childNode = db.prepare('SELECT node_type, depth FROM nodes WHERE id = ?').get(child.id) as { node_type: string; depth: number } | undefined;
        if (childNode && childNode.node_type !== 'leaf') {
          if (childNode.depth >= MAX_AUTO_DECOMPOSE_DEPTH) {
            // Force-convert to leaf: tree has reached its depth limit
            db.prepare(`UPDATE nodes SET node_type = 'leaf' WHERE id = ?`).run(child.id);
            broadcastGlobal('node:updated', { nodeId: child.id, node_type: 'leaf' });
            broadcastToNode(nodeId, 'log', {
              message: `[depth-limit] "${child.name}" capped as leaf at depth ${childNode.depth}`
            });
          } else {
            // Stagger each non-leaf child decomposition to avoid concurrent API burst
            const launchDelay = staggerIndex * DECOMPOSE_STAGGER_MS;
            staggerIndex++;
            setTimeout(() => {
              decomposeNode(child.id).catch(err =>
                console.error(`[auto-mode] Decompose failed for ${child.id}:`, err)
              );
            }, launchDelay);
          }
        }
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE nodes SET status = 'failed', error_log = ? WHERE id = ?`).run(errorMessage, nodeId);
    broadcastGlobal('node:status', { nodeId, status: 'failed' });
    broadcastToNode(nodeId, 'error', { message: `Decomposition failed: ${errorMessage}` });
    throw error;
  }
}
