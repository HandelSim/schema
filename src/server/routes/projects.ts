/**
 * Projects API routes.
 * File-based project storage under {WORKSPACE_DIR}/{project-id}/project.json
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import {
  listProjects,
  createProject,
  getProject,
  deleteProject,
  getProjectTree,
  updateProjectFile,
  readMockup,
} from '../services/project-store';
import { broadcastGlobal } from '../utils/sse';

const router = Router();

/**
 * GET /api/projects
 * List all projects (scans workspace directory).
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const projects = listProjects();
    res.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/projects
 * Create a new project. Body: { name, prompt }
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, prompt, description } = req.body as {
      name: string;
      prompt?: string;
      description?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const data = createProject(name.trim(), prompt || description || '');
    res.status(201).json({ project: data.project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating project:', error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/projects/:id
 * Get project details.
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const data = getProject(req.params['id']);
    res.json({ project: data.project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(404).json({ error: message });
  }
});

/**
 * GET /api/projects/:id/tree
 * Get the full tree structure for a project.
 */
router.get('/:id/tree', (req: Request, res: Response) => {
  try {
    const tree = getProjectTree(req.params['id']);
    res.json(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(404).json({ error: message });
  }
});

/**
 * GET /api/projects/:id/nodes/:nodeId
 * Get a single node from the project.
 */
router.get('/:id/nodes/:nodeId', (req: Request, res: Response) => {
  try {
    const data = getProject(req.params['id']);
    const node = data.nodes.find(n => n.id === req.params['nodeId']);
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
 * PATCH /api/projects/:id/nodes/:nodeId
 * Update node fields.
 */
router.patch('/:id/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    const updates = req.body as Record<string, unknown>;

    const allowedFields = [
      'name', 'prompt', 'model', 'hooks', 'mcp_servers', 'subagents',
      'acceptance_criteria', 'contracts_provided', 'contracts_consumed',
      'status', 'is_leaf', 'session_id', 'cost_usd', 'input_tokens',
      'output_tokens', 'started_at', 'completed_at',
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in updates) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    const updated = await updateProjectFile(id, (data) => {
      const idx = data.nodes.findIndex(n => n.id === nodeId);
      if (idx === -1) throw new Error(`Node ${nodeId} not found`);
      data.nodes[idx] = { ...data.nodes[idx], ...filteredUpdates };
      return data;
    });

    const node = updated.nodes.find(n => n.id === nodeId)!;
    broadcastGlobal('node:updated', { node });
    res.json({ node });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/projects/:id/nodes/:nodeId/approve
 * Approve a node. If non-leaf, triggers Blacksmith decomposition.
 */
router.post('/:id/nodes/:nodeId/approve', async (req: Request, res: Response) => {
  const { id: projectId, nodeId } = req.params as { id: string; nodeId: string };

  try {
    const data = getProject(projectId);
    const node = data.nodes.find(n => n.id === nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    // Mark as approved
    await updateProjectFile(projectId, (d) => {
      const idx = d.nodes.findIndex(n => n.id === nodeId);
      if (idx !== -1) d.nodes[idx] = { ...d.nodes[idx], status: 'approved' };
      return d;
    });
    broadcastGlobal('node:status', { nodeId, status: 'approved' });

    if (!node.is_leaf) {
      res.json({ message: 'Approved, Blacksmith decomposition started', nodeId });

      // Trigger Blacksmith decomposition asynchronously
      const { blacksmith } = await import('../services/blacksmith');
      (async () => {
        const events: string[] = [];
        for await (const event of blacksmith.decompose(nodeId, projectId)) {
          events.push(event.type);
          if (event.type === 'text' && event.content) {
            broadcastGlobal('blacksmith:text', { content: event.content, projectId });
          }
        }
      })().catch(err => {
        console.error(`[Blacksmith] Decomposition error for node ${nodeId}:`, err);
      });
    } else {
      res.json({ message: 'Approved as leaf node', nodeId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/projects/:id/generate-contexts
 * Generate CLAUDE.md, settings.json, and contracts for all nodes.
 */
router.post('/:id/generate-contexts', async (req: Request, res: Response) => {
  try {
    const data = getProject(req.params['id']);

    await updateProjectFile(req.params['id'], (d) => {
      d.project.status = 'contexts_generated';
      return d;
    });

    broadcastGlobal('project:status', {
      projectId: req.params['id'],
      status: 'contexts_generated',
    });

    res.json({ message: 'Contexts generated', status: 'contexts_generated', project: data.project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/projects/:id/start-execution
 * Begin executing via HAMMER.
 */
router.post('/:id/start-execution', async (req: Request, res: Response) => {
  try {
    const updated = await updateProjectFile(req.params['id'], (d) => {
      d.project.status = 'executing';
      return d;
    });

    broadcastGlobal('project:status', {
      projectId: req.params['id'],
      status: 'executing',
    });

    const leafNodes = updated.nodes.filter(n => n.is_leaf && n.status === 'approved');
    res.json({
      message: 'Execution started',
      status: 'executing',
      queuedNodes: leafNodes.map(n => ({ id: n.id, name: n.name })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/projects/:id/contracts
 * List contracts for a project.
 */
router.get('/:id/contracts', (req: Request, res: Response) => {
  try {
    const data = getProject(req.params['id']);
    res.json({ contracts: data.contracts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/projects/:id/workflows
 * List approved workflows.
 */
router.get('/:id/workflows', (req: Request, res: Response) => {
  try {
    const data = getProject(req.params['id']);
    const approved = data.stakeholder.workflows.filter(w => w.approved);
    res.json({ workflows: approved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/projects/:id/mockup
 * Serve the mockup.html file.
 */
router.get('/:id/mockup', (req: Request, res: Response) => {
  try {
    const content = readMockup(req.params['id']);
    if (!content) {
      res.status(404).json({ error: 'No mockup found for this project' });
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project and all its files.
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteProject(req.params['id']);
    res.json({ message: 'Project deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
