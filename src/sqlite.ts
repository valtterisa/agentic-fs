import { Database } from "bun:sqlite";

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA busy_timeout=5000;");
  db.run(`
    CREATE TABLE IF NOT EXISTS virtual_files (
      tenant_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, path)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS session_state (
      user_id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

