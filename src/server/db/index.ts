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
    try {
      _db.prepare("ALTER TABLE projects ADD COLUMN mode TEXT DEFAULT 'manual'").run();
    } catch { /* column already exists */ }
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
