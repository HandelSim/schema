/**
 * SCHEMA - Express API Server
 *
 * Architecture:
 * - Serves both the REST API (port 3001) and static frontend (port 3000 in prod)
 * - Uses SSE for real-time updates to the frontend tree graph
 * - File-based project storage (project.json per project)
 * - Blacksmith: persistent Claude Agent SDK architect
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import projectsRouter from './routes/projects';
import blacksmithRouter from './routes/blacksmith';
import { broadcastGlobal, initSSE } from './utils/sse';
import { WORKSPACE_DIR } from './services/project-store';

const app = express();
const API_PORT = parseInt(process.env.PORT_API || '3001', 10);
const FRONTEND_PORT = parseInt(process.env.PORT_FRONTEND || '3000', 10);

// ============================================================
// Middleware
// ============================================================

app.use(cors({
  origin: [
    `http://localhost:${FRONTEND_PORT}`,
    `http://localhost:3000`,
    `http://127.0.0.1:${FRONTEND_PORT}`,
    process.env.CORS_ORIGIN || '',
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ============================================================
// API Routes
// ============================================================

app.use('/api/projects', projectsRouter);
app.use('/api/blacksmith', blacksmithRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    workspace: WORKSPACE_DIR,
    model: process.env.SCHEMA_MODEL || 'sonnet',
  });
});

app.get('/api/events', (req, res) => {
  const clientId = `global-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  initSSE(req, res, clientId);
});

// ============================================================
// Frontend Static Files (production)
// ============================================================

const clientBuildPath = path.join(__dirname, '../../dist/client');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientBuildPath));

  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientBuildPath, 'index.html'));
    }
  });
}

// ============================================================
// Error Handler
// ============================================================

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================
// Start Server
// ============================================================

console.log(`[SCHEMA] Workspace directory: ${WORKSPACE_DIR}`);
console.log(`[SCHEMA] Model: ${process.env.SCHEMA_MODEL || 'sonnet'}`);

app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`[API] Server running on http://0.0.0.0:${API_PORT}`);
  console.log(`[API] Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('[API] Anthropic API: configured via API key');
  } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log('[API] Anthropic API: configured via Claude Code OAuth token');
  } else {
    console.warn('[API] WARNING: No Claude auth found. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.');
  }
});

if (process.env.NODE_ENV === 'production') {
  const http = require('http') as typeof import('http');
  const frontendApp = express();

  frontendApp.use('/api', (req, res) => {
    const isSSE = req.headers.accept === 'text/event-stream';
    const options = {
      hostname: '127.0.0.1',
      port: API_PORT,
      path: `/api${req.url}`,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
    };
    const proxy = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      if (isSSE) {
        res.socket?.setNoDelay(true);
        proxyRes.on('data', (chunk: Buffer) => {
          res.write(chunk);
          if (typeof (res as any).flush === 'function') (res as any).flush();
        });
        proxyRes.on('end', () => res.end());
      } else {
        proxyRes.pipe(res);
      }
    });
    proxy.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ error: 'API proxy error' });
      else res.end();
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
        console.error('[Frontend proxy] Error:', err.message);
      }
    });
    res.on('close', () => { if (!proxy.destroyed) proxy.destroy(); });
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      req.pipe(proxy);
    } else {
      proxy.end();
    }
  });

  frontendApp.use(express.static(clientBuildPath));
  frontendApp.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
  frontendApp.listen(FRONTEND_PORT, '0.0.0.0', () => {
    console.log(`[Frontend] Serving on http://0.0.0.0:${FRONTEND_PORT}`);
  });
}

export default app;
