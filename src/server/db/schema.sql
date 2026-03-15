-- Agent Tree Orchestrator Database Schema
-- SQLite via better-sqlite3

-- Enable WAL mode for better concurrent read performance
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Core node table: represents every agent in the tree (orchestrators and leaves)
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  -- Status lifecycle: pending -> approved -> decomposing -> running -> completed | failed | rejected
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','decomposing','running','completed','failed','rejected')),
  -- node_type: 'orchestrator' decomposes into children, 'leaf' executes directly, 'test' is a testing agent
  node_type TEXT NOT NULL DEFAULT 'leaf' CHECK(node_type IN ('orchestrator','leaf','test')),
  prompt TEXT,
  role TEXT,
  system_prompt TEXT,
  -- JSON fields for complex configurations
  hooks JSON,
  mcp_tools JSON DEFAULT '[]',
  allowed_tools JSON DEFAULT '["Read","Write","Edit","Bash","Grep","Glob"]',
  allowed_paths JSON DEFAULT '[]',
  dependencies JSON DEFAULT '[]',
  acceptance_criteria TEXT,
  context_files JSON DEFAULT '[]',
  max_iterations INTEGER DEFAULT 10,
  escalation_policy TEXT DEFAULT 'ask_human' CHECK(escalation_policy IN ('ask_human','auto_retry','fail')),
  model TEXT DEFAULT 'sonnet' CHECK(model IN ('sonnet','haiku','opus')),
  -- Execution tracking
  started_at DATETIME,
  completed_at DATETIME,
  execution_log TEXT,
  error_log TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Projects are top-level containers with a root node
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  root_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  mode TEXT DEFAULT 'manual' CHECK(mode IN ('manual','auto')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Contracts define shared interfaces between sibling nodes
-- They prevent tight coupling and ensure agents can work in parallel
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  parent_node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT,
  -- created_by tracks which agent last updated the contract
  created_by TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_contracts_parent_node_id ON contracts(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_projects_root_node ON projects(root_node_id);
