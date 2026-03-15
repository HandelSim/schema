/**
 * Database initialization and query helpers.
 * Uses better-sqlite3 for synchronous SQLite access - ideal for an API server
 * that benefits from simplicity over connection pooling complexity.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mkdirSync } from 'fs';

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'ato.db');

// Ensure the data directory exists
const dataDir = join(DB_PATH, '..');
mkdirSync(dataDir, { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);

    // Performance optimizations
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('cache_size = -64000'); // 64MB cache

    // Run schema migrations on startup
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    _db.exec(schema);

    // Incremental migrations for columns added after initial schema
    const migrate = (sql: string) => { try { _db!.prepare(sql).run(); } catch { /* column already exists */ } };

    migrate("ALTER TABLE projects ADD COLUMN mode TEXT DEFAULT 'manual'");

    // Improvement 2: project lifecycle phases
    migrate("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'building' CHECK(status IN ('building','tree_approved','contexts_generating','contexts_generated','executing','completed','failed'))");

    // Improvement 1: testing tier on nodes
    migrate("ALTER TABLE nodes ADD COLUMN testing_tier TEXT DEFAULT 'tier1' CHECK(testing_tier IN ('tier1','tier2','tier3'))");

    // Improvement 3: API contract columns on nodes
    migrate("ALTER TABLE nodes ADD COLUMN apis_provided TEXT DEFAULT '[]'");
    migrate("ALTER TABLE nodes ADD COLUMN apis_consumed TEXT DEFAULT '[]'");

    // Improvement 6: integration results on nodes
    migrate("ALTER TABLE nodes ADD COLUMN integration_status TEXT DEFAULT NULL");
    migrate("ALTER TABLE nodes ADD COLUMN integration_results TEXT DEFAULT NULL");

    // HAMMER: store HammerConfig JSON on each node for execution
    migrate("ALTER TABLE nodes ADD COLUMN hammer_config TEXT DEFAULT NULL");
    // HAMMER: store session ID for resumable runs
    migrate("ALTER TABLE nodes ADD COLUMN hammer_session_id TEXT DEFAULT NULL");
    // HAMMER: store cost summary JSON after execution
    migrate("ALTER TABLE nodes ADD COLUMN hammer_cost TEXT DEFAULT NULL");

    // Improvement 4: contract change proposals table
    _db.exec(`
      CREATE TABLE IF NOT EXISTS contract_change_proposals (
        id TEXT PRIMARY KEY,
        contract_id TEXT REFERENCES contracts(id) ON DELETE CASCADE,
        proposed_by TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        old_content TEXT,
        new_content TEXT,
        change_type TEXT DEFAULT 'unknown' CHECK(change_type IN ('backward_compatible','breaking','unknown')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        analysis TEXT,
        reviewed_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_contract_id ON contract_change_proposals(contract_id);
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON contract_change_proposals(status);
    `);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Graceful shutdown
process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
