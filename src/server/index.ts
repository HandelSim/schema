/**
 * Agent Tree Orchestrator - Express API Server
 *
 * Architecture:
 * - Serves both the REST API (port 3001) and static frontend (port 3000 in prod)
 * - Uses SSE for real-time updates to the frontend tree graph
 * - SQLite for persistence (simple, no infra needed)
 * - Spawns Claude Code CLI subprocesses for leaf node execution
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { getDb } from './db';
import projectsRouter from './routes/projects';
import nodesRouter from './routes/nodes';
import contractsRouter from './routes/contracts';
import { broadcastGlobal, initSSE } from './utils/sse';

const app = express();
const API_PORT = parseInt(process.env.PORT_API || '3001', 10);
const FRONTEND_PORT = parseInt(process.env.PORT_FRONTEND || '3000', 10);

// ============================================================
// Middleware
// ============================================================

// CORS: allow frontend dev server and same-origin requests
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

// Request logging in development
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
app.use('/api/nodes', nodesRouter);
app.use('/api/contracts', contractsRouter);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  try {
    const db = getDb();
    // Simple query to verify DB is accessible
    db.prepare('SELECT 1').get();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Global SSE endpoint for tree-wide status updates
// Clients subscribe here to receive all node status changes
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

  // SPA fallback: serve index.html for all non-API routes
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

// Initialize database on startup
try {
  getDb();
  console.log('[DB] Database initialized successfully');
} catch (err) {
  console.error('[DB] Failed to initialize database:', err);
  process.exit(1);
}

app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`[API] Server running on http://0.0.0.0:${API_PORT}`);
  console.log(`[API] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[API] Anthropic API: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT configured'}`);
});

// If in production, also serve frontend on its own port
if (process.env.NODE_ENV === 'production') {
  const frontendApp = express();
  frontendApp.use(express.static(clientBuildPath));
  frontendApp.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
  frontendApp.listen(FRONTEND_PORT, '0.0.0.0', () => {
    console.log(`[Frontend] Serving on http://0.0.0.0:${FRONTEND_PORT}`);
  });
}

export default app;
