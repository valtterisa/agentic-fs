import { Database } from "bun:sqlite";
import type { AuditEvent } from "./types";

export class AuditLog {
  constructor(private readonly db: Database) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        command TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        details_json TEXT
      );
    `);
  }

  write(event: AuditEvent): void {
    const stmt = this.db.query(`
      INSERT INTO audit_events (id, at, user_id, role, tenant_id, command, target, status, details_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `);
    stmt.run(
      event.id,
      event.at,
      event.userId,
      event.role,
      event.tenantId,
      event.command,
      event.target,
      event.status,
      event.details ? JSON.stringify(event.details) : null
    );
  }
}

