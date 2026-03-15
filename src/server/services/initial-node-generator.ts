/**
 * Initial Node Generator
 * Uses Claude API to auto-generate root node configuration from project name + description.
 * Called after project creation; updates the root node with rich config while keeping
 * it in 'pending' (Awaiting Approval) status for user review.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { broadcastGlobal } from '../utils/sse';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface RootNodeConfig {
  name: string;
  prompt: string;
  role: string;
  is_leaf: boolean;
  model: 'sonnet' | 'haiku' | 'opus';
  acceptance_criteria: string;
  allowed_tools: string[];
  max_iterations: number;
  escalation_policy: 'ask_human' | 'auto_retry' | 'fail';
}

/**
 * Calls Claude API to generate a root node configuration from project details.
 * Falls back gracefully if the API call fails.
 */
async function generateRootNodeConfig(
  projectName: string,
  projectDescription: string
): Promise<RootNodeConfig> {
  const promptText = `You are planning a software project. Given the project name and description, generate a detailed root node configuration as JSON with fields: name (project root name), prompt (comprehensive task prompt), role (appropriate role), is_leaf (always false for root), model (sonnet/haiku/opus), acceptance_criteria, allowed_tools array, max_iterations (number), escalation_policy.

Project Name: ${projectName}
Project Description: ${projectDescription}

Respond with ONLY valid JSON, no markdown fences, no explanation:
{
  "name": "...",
  "prompt": "...",
  "role": "...",
  "is_leaf": false,
  "model": "sonnet",
  "acceptance_criteria": "...",
  "allowed_tools": ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
  "max_iterations": 10,
  "escalation_policy": "ask_human"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: promptText }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude API');
  }

  let cleaned = textContent.text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const config = JSON.parse(cleaned) as RootNodeConfig;

  // Enforce root node invariants
  config.is_leaf = false;
  config.model = (['sonnet', 'haiku', 'opus'] as const).includes(config.model) ? config.model : 'sonnet';
  config.escalation_policy = (['ask_human', 'auto_retry', 'fail'] as const).includes(config.escalation_policy)
    ? config.escalation_policy : 'ask_human';
  config.max_iterations = typeof config.max_iterations === 'number' ? config.max_iterations : 10;
  config.allowed_tools = Array.isArray(config.allowed_tools)
    ? config.allowed_tools : ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];

  return config;
}

/**
 * Generates initial root node configuration and updates the node in the DB.
 * The node status remains 'pending' (Awaiting Approval) — user must explicitly approve.
 */
export async function generateInitialNode(
  rootNodeId: string,
  projectName: string,
  projectDescription: string
): Promise<void> {
  const db = getDb();

  try {
    console.log(`[InitialNodeGen] Generating config for root node ${rootNodeId}...`);

    const config = await generateRootNodeConfig(projectName, projectDescription);

    // Update root node with generated config, keeping status='pending'
    db.prepare(`
      UPDATE nodes SET
        name = ?,
        prompt = ?,
        role = ?,
        node_type = 'orchestrator',
        model = ?,
        acceptance_criteria = ?,
        allowed_tools = ?,
        max_iterations = ?,
        escalation_policy = ?
      WHERE id = ?
    `).run(
      config.name || projectName,
      config.prompt || projectDescription,
      config.role || 'Senior Software Engineer',
      config.model,
      config.acceptance_criteria || null,
      JSON.stringify(config.allowed_tools),
      config.max_iterations,
      config.escalation_policy,
      rootNodeId
    );

    const updatedNode = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootNodeId);
    broadcastGlobal('node:updated', { node: updatedNode });

    console.log(`[InitialNodeGen] Root node ${rootNodeId} updated with generated config.`);
  } catch (error) {
    // Non-fatal: log error but don't fail project creation
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[InitialNodeGen] Failed to generate initial node config: ${message}`);
  }
}
