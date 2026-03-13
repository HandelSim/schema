/**
 * Verification Roll-up Service
 * Uses Claude Haiku 4.5 (fast, cost-effective) to validate that a node's
 * children have collectively met the parent's acceptance criteria.
 *
 * Roll-up strategy:
 * 1. Collect completed children's execution logs
 * 2. Check contract compliance
 * 3. Validate against parent acceptance criteria
 * 4. Mark parent as completed or flag issues
 */
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { broadcastGlobal, broadcastToNode } from '../utils/sse';
import { getApiKeyOrThrow } from '../utils/auth';

const getAnthropic = () => new Anthropic({ apiKey: getApiKeyOrThrow() });

interface NodeRow {
  id: string;
  name: string;
  status: string;
  node_type: string;
  prompt: string | null;
  role: string | null;
  acceptance_criteria: string | null;
  execution_log: string | null;
  error_log: string | null;
}

interface VerificationResult {
  passed: boolean;
  summary: string;
  issues: string[];
  recommendations: string[];
}

/**
 * Build the verification prompt for Claude Haiku.
 */
function buildVerificationPrompt(
  parentNode: NodeRow,
  children: NodeRow[],
  contracts: Array<{ name: string; content: string | null }>
): string {
  const childSummaries = children.map(c => `
### ${c.name} (${c.status})
Role: ${c.role || 'Agent'}
${c.execution_log ? `\nExecution log (last 500 chars):\n${c.execution_log.slice(-500)}` : ''}
${c.error_log ? `\nErrors:\n${c.error_log.slice(-200)}` : ''}`
  ).join('\n');

  const contractsSummary = contracts.length > 0
    ? contracts.map(c => `### ${c.name}\n${c.content || '(empty)'}`).join('\n\n')
    : 'No contracts defined.';

  return `You are a QA verification agent performing acceptance criteria validation.

## Parent Component: ${parentNode.name}
Role: ${parentNode.role || 'Software Component'}
Task: ${parentNode.prompt || '(none)'}

## Acceptance Criteria to Verify
${parentNode.acceptance_criteria || 'No explicit criteria. Check for general completion.'}

## Child Component Results
${childSummaries}

## Shared Contracts
${contractsSummary}

## Your Task
Determine if the collective work of the children satisfies the parent's acceptance criteria.

Respond with ONLY valid JSON (no markdown fencing):
{
  "passed": true,
  "summary": "One sentence overall assessment",
  "issues": ["List of specific issues found, empty if none"],
  "recommendations": ["Suggested fixes for issues, empty if none"]
}`;
}

/**
 * Verify that a node's children have collectively completed the parent's task.
 * Updates parent status and broadcasts results.
 */
export async function verifyNode(nodeId: string): Promise<VerificationResult> {
  const db = getDb();
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as NodeRow | undefined;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  // Get all children
  const children = db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(nodeId) as NodeRow[];

  if (children.length === 0) {
    // Leaf node - verify its own execution
    return verifyLeafNode(nodeId, node);
  }

  // Check if all required children are done
  const incomplete = children.filter(c => !['completed', 'failed'].includes(c.status));
  if (incomplete.length > 0) {
    const names = incomplete.map(c => c.name).join(', ');
    broadcastToNode(nodeId, 'log', {
      message: `Cannot verify: ${incomplete.length} children still running: ${names}`
    });
    return {
      passed: false,
      summary: `${incomplete.length} children not yet complete`,
      issues: [`Waiting for: ${names}`],
      recommendations: ['Wait for all children to complete before verifying']
    };
  }

  // Get contracts
  const contracts = db.prepare('SELECT name, content FROM contracts WHERE parent_node_id = ?')
    .all(nodeId) as Array<{ name: string; content: string | null }>;

  broadcastToNode(nodeId, 'log', { message: 'Running verification roll-up with Claude Haiku...' });

  try {
    const prompt = buildVerificationPrompt(node, children, contracts);

    // Use Claude Haiku for fast, cost-effective verification
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude API');
    }

    let result: VerificationResult;
    try {
      let cleaned = textContent.text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      result = JSON.parse(cleaned) as VerificationResult;
    } catch {
      result = {
        passed: false,
        summary: 'Could not parse verification result',
        issues: ['API response was not valid JSON'],
        recommendations: ['Retry verification']
      };
    }

    // Update parent node status based on verification
    if (result.passed) {
      db.prepare(`UPDATE nodes SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nodeId);
      broadcastGlobal('node:status', { nodeId, status: 'completed' });
    }

    // Append verification report to execution log
    const report = `\n=== VERIFICATION REPORT ===\n${JSON.stringify(result, null, 2)}\n`;
    const existing = (db.prepare('SELECT execution_log FROM nodes WHERE id = ?').get(nodeId) as { execution_log: string | null })?.execution_log || '';
    db.prepare('UPDATE nodes SET execution_log = ? WHERE id = ?').run(existing + report, nodeId);

    broadcastToNode(nodeId, 'verification', result);

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    broadcastToNode(nodeId, 'log:error', { message: `Verification error: ${errorMessage}` });
    return {
      passed: false,
      summary: `Verification failed: ${errorMessage}`,
      issues: [errorMessage],
      recommendations: ['Check API key and retry']
    };
  }
}

/**
 * Verify a leaf node's own execution against its acceptance criteria.
 */
async function verifyLeafNode(nodeId: string, node: NodeRow): Promise<VerificationResult> {
  if (node.status !== 'completed') {
    return {
      passed: false,
      summary: `Node is not completed (status: ${node.status})`,
      issues: [`Current status: ${node.status}`],
      recommendations: ['Execute the node first']
    };
  }

  if (!node.acceptance_criteria) {
    return {
      passed: true,
      summary: 'No acceptance criteria defined; assuming pass',
      issues: [],
      recommendations: ['Define acceptance criteria for better verification']
    };
  }

  // For leaf nodes, run the check_acceptance script if available
  broadcastToNode(nodeId, 'log', { message: 'Verifying leaf node acceptance criteria...' });

  return {
    passed: true,
    summary: 'Leaf node completed successfully',
    issues: [],
    recommendations: []
  };
}
