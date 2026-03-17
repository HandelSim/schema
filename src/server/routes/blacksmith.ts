/**
 * Blacksmith API routes.
 * Provides SSE streaming interface for the Blacksmith persistent architect.
 */
import { Router, Request, Response } from 'express';
import { blacksmith } from '../services/blacksmith';
import { readBlacksmithHistory } from '../services/project-store';

const router = Router();

/**
 * POST /api/blacksmith/message
 * Send a message to Blacksmith and stream the response via SSE.
 * Body: { message: string, projectId: string }
 */
router.post('/message', async (req: Request, res: Response) => {
  const { message, projectId } = req.body as { message: string; projectId: string };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    send('start', { message: 'Blacksmith is thinking...' });

    for await (const event of blacksmith.sendMessage(message.trim(), projectId)) {
      if (event.type === 'text') {
        send('text', { content: event.content });
      } else if (event.type === 'tool_use') {
        send('tool_use', { tool: event.tool });
      } else if (event.type === 'done') {
        send('done', {});
      } else if (event.type === 'error') {
        send('error', { error: event.error });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send('error', { error: message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/blacksmith/decompose/:nodeId
 * Trigger decomposition for a specific node.
 * Body: { projectId: string }
 */
router.post('/decompose/:nodeId', async (req: Request, res: Response) => {
  const { nodeId } = req.params as { nodeId: string };
  const { projectId } = req.body as { projectId: string };

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    send('start', { message: `Blacksmith is decomposing node ${nodeId}...` });

    for await (const event of blacksmith.decompose(nodeId, projectId)) {
      if (event.type === 'text') {
        send('text', { content: event.content });
      } else if (event.type === 'tool_use') {
        send('tool_use', { tool: event.tool });
      } else if (event.type === 'done') {
        send('done', {});
      } else if (event.type === 'error') {
        send('error', { error: event.error });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send('error', { error: message });
  } finally {
    res.end();
  }
});

/**
 * GET /api/blacksmith/history
 * Get conversation history for a project.
 * Query: ?projectId=...
 */
router.get('/history', (req: Request, res: Response) => {
  const { projectId } = req.query as { projectId?: string };

  if (!projectId) {
    res.status(400).json({ error: 'projectId query param is required' });
    return;
  }

  try {
    const history = readBlacksmithHistory(projectId);
    res.json({ history });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/blacksmith/status
 * Get current Blacksmith status (idle, thinking, decomposing).
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: blacksmith.getStatus(),
    currentProjectId: blacksmith.getCurrentProjectId(),
  });
});

/**
 * POST /api/blacksmith/switch-project/:id
 * Switch Blacksmith to a different project session.
 */
router.post('/switch-project/:id', async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  try {
    await blacksmith.switchProject(id);
    res.json({ message: `Switched to project ${id}`, projectId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
