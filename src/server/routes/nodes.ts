/**
 * Nodes API routes.
 * Handles all node lifecycle operations: CRUD, approval, rejection, execution, verification.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { initSSE, broadcastGlobal } from '../utils/sse';
import { decomposeNode } from '../services/decomposition';
import { executeNode, cancelExecution } from '../services/execution';
import { verifyNode } from '../services/verification';

const router = Router();

/**
 * GET /api/nodes/:id
 * Get full node details including parsed JSON fields.
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params['id']);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    res.json({ node });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/nodes/:id/children
 * Get immediate children of a node.
 */
router.get('/:id/children', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const children = db.prepare('SELECT * FROM nodes WHERE parent_id = ? ORDER BY created_at').all(req.params['id']);
    res.json({ children });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /api/nodes/:id
 * Update node configuration (prompt, role, model, hooks, etc.)
 * Only editable when node is in pending or approved status.
 */
router.patch('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params['id']) as { status: string } | undefined;

    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    // Allow editing in pending, approved, and failed states
    const editableStatuses = ['pending', 'approved', 'failed', 'rejected'];
    if (!editableStatuses.includes(node.status)) {
      res.status(400).json({ error: `Cannot edit node in status: ${node.status}` });
      return;
    }

    const allowedFields = [
      'name', 'prompt', 'role', 'system_prompt', 'hooks', 'mcp_tools',
      'allowed_tools', 'allowed_paths', 'dependencies', 'acceptance_criteria',
      'context_files', 'max_iterations', 'escalation_policy', 'model', 'node_type'
    ];

    const updates: string[] = [];
    const values: unknown[] = [];

    for (const field of allowedFields) {
      if (field in req.body) {
        updates.push(`${field} = ?`);
        // Serialize JSON fields
        const jsonFields = ['hooks', 'mcp_tools', 'allowed_tools', 'allowed_paths', 'dependencies', 'context_files'];
        values.push(jsonFields.includes(field) ? JSON.stringify(req.body[field as keyof typeof req.body]) : req.body[field as keyof typeof req.body]);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    values.push(req.params['id']);
    db.prepare(`UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params['id']);
    broadcastGlobal('node:updated', { node: updated });

    res.json({ node: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/nodes
 * Create a child node manually.
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { parent_id, name, prompt, role, node_type, model } = req.body as {
      parent_id: string;
      name: string;
      prompt?: string;
      role?: string;
      node_type?: string;
      model?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Node name is required' });
      return;
    }

    const parent = parent_id ? db.prepare('SELECT depth FROM nodes WHERE id = ?').get(parent_id) as { depth: number } | undefined : null;
    const depth = parent ? parent.depth + 1 : 0;

    const nodeId = uuidv4();
    db.prepare(`
      INSERT INTO nodes (id, parent_id, name, depth, status, node_type, prompt, role, model)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(nodeId, parent_id || null, name.trim(), depth, node_type || 'leaf', prompt || null, role || null, model || 'sonnet');

    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
    broadcastGlobal('node:created', { node });

    res.status(201).json({ node });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/nodes/:id/approve
 * Approve a node. If it's an orchestrator, trigger decomposition.
 * If it's a leaf, just mark as approved.
 */
/** Walk up the tree to find the project mode for a given node. */
function getProjectMode(nodeId: string): 'manual' | 'auto' {
  const db = getDb();
  // Find root node by walking up parent chain
  let currentId = nodeId;
  for (let i = 0; i < 20; i++) {
    const row = db.prepare('SELECT id, parent_id FROM nodes WHERE id = ?').get(currentId) as
      { id: string; parent_id: string | null } | undefined;
    if (!row) break;
    if (!row.parent_id) {
      // This is the root node — find the project
      const project = db.prepare('SELECT mode FROM projects WHERE root_node_id = ?').get(row.id) as
        { mode: string } | undefined;
      return (project?.mode === 'auto') ? 'auto' : 'manual';
    }
    currentId = row.parent_id;
  }
  return 'manual';
}

/** Auto-approve and decompose a child node (for auto mode). */
async function autoApproveChild(nodeId: string): Promise<void> {
  const db = getDb();
  const child = db.prepare('SELECT id, node_type, status FROM nodes WHERE id = ?').get(nodeId) as
    { id: string; node_type: string; status: string } | undefined;
  if (!child || child.status !== 'pending') return;

  db.prepare(`UPDATE nodes SET status = 'approved' WHERE id = ?`).run(nodeId);
  broadcastGlobal('node:status', { nodeId, status: 'approved' });

  if (child.node_type !== 'leaf') {
    await decomposeNode(nodeId);
    // Recursively auto-approve grandchildren
    const grandchildren = db.prepare('SELECT id FROM nodes WHERE parent_id = ? AND status = ?')
      .all(nodeId, 'pending') as Array<{ id: string }>;
    for (const gc of grandchildren) {
      await autoApproveChild(gc.id);
    }
  }
}

router.post('/:id/approve', (req: Request, res: Response) => {
  const db = getDb();
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params['id']) as {
    id: string;
    status: string;
    node_type: string;
  } | undefined;

  if (!node) {
    res.status(404).json({ error: 'Node not found' });
    return;
  }

  const { decompose = true } = req.body as { decompose?: boolean };
  const projectMode = getProjectMode(node.id);

  // Mark as approved immediately
  db.prepare(`UPDATE nodes SET status = 'approved' WHERE id = ?`).run(req.params['id']);
  broadcastGlobal('node:status', { nodeId: req.params['id'], status: 'approved' });

  // Trigger decomposition asynchronously if requested
  if (decompose && node.node_type !== 'leaf') {
    res.json({ message: 'Approved, decomposition started', nodeId: node.id });

    // Run decomposition in background (don't await)
    decomposeNode(node.id).then(() => {
      // In auto mode, auto-approve all pending children
      if (projectMode === 'auto') {
        const children = db.prepare('SELECT id FROM nodes WHERE parent_id = ? AND status = ?')
          .all(node.id, 'pending') as Array<{ id: string }>;
        for (const child of children) {
          autoApproveChild(child.id).catch(err =>
            console.error(`Auto-approve failed for child ${child.id}:`, err)
          );
        }
      }
    }).catch(err => {
      console.error(`Decomposition failed for node ${node.id}:`, err);
    });
  } else {
    res.json({ message: 'Approved as leaf node', nodeId: node.id });
  }
});

/**
 * POST /api/nodes/:id/reject
 * Reject a node with optional feedback.
 */
router.post('/:id/reject', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { feedback } = req.body as { feedback?: string };
    const nodeId = req.params['id'];

    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    db.prepare(`UPDATE nodes SET status = 'rejected', error_log = ? WHERE id = ?`)
      .run(feedback || 'Rejected by user', nodeId);

    broadcastGlobal('node:status', { nodeId, status: 'rejected' });

    res.json({ message: 'Node rejected', nodeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/nodes/:id/execute
 * Execute a leaf node agent. Starts the Claude Code CLI subprocess.
 */
router.post('/:id/execute', (req: Request, res: Response) => {
  const db = getDb();
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params['id']) as {
    id: string;
    status: string;
    node_type: string;
  } | undefined;

  if (!node) {
    res.status(404).json({ error: 'Node not found' });
    return;
  }

  if (node.status === 'running') {
    res.status(400).json({ error: 'Node is already running' });
    return;
  }

  res.json({ message: 'Execution started', nodeId: node.id });

  // Run execution in background
  executeNode(node.id).catch(err => {
    console.error(`Execution failed for node ${node.id}:`, err);
  });
});

/**
 * POST /api/nodes/:id/cancel
 * Cancel a running execution.
 */
router.post('/:id/cancel', (req: Request, res: Response) => {
  const cancelled = cancelExecution(req.params['id']);
  if (cancelled) {
    res.json({ message: 'Execution cancelled' });
  } else {
    res.status(400).json({ error: 'No running execution found for this node' });
  }
});

/**
 * GET /api/nodes/:id/logs
 * SSE endpoint for streaming execution logs.
 * Clients connect here and receive real-time updates.
 */
router.get('/:id/logs', (req: Request, res: Response) => {
  const nodeId = req.params['id'];
  const clientId = `log-${nodeId}-${Date.now()}`;

  initSSE(req, res, clientId, nodeId);

  // Send existing logs immediately upon connection
  const db = getDb();
  const node = db.prepare('SELECT execution_log, error_log, status FROM nodes WHERE id = ?').get(nodeId) as {
    execution_log: string | null;
    error_log: string | null;
    status: string;
  } | undefined;

  if (node?.execution_log) {
    const lines = node.execution_log.split('\n').filter(Boolean);
    for (const line of lines) {
      res.write(`event: log:history\ndata: ${JSON.stringify({ message: line })}\n\n`);
    }
  }

  if (node?.status === 'completed' || node?.status === 'failed') {
    res.write(`event: log:complete\ndata: ${JSON.stringify({ status: node.status })}\n\n`);
  }
});

/**
 * POST /api/nodes/:id/verify
 * Trigger verification roll-up for a node.
 */
router.post('/:id/verify', async (req: Request, res: Response) => {
  try {
    const result = await verifyNode(req.params['id']);
    res.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/nodes/:id
 * Delete a node and all its descendants (cascade).
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params['id']);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params['id']);
    broadcastGlobal('node:deleted', { nodeId: req.params['id'] });

    res.json({ message: 'Node deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
