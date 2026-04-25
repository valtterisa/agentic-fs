import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertAllowed, canRead, canWrite } from "./rbac";
import type { GrepMatch, SessionContext } from "./types";

function normalizePath(input: string, cwd = "/"): string {
  const base = input.startsWith("/") ? input : `${cwd}/${input}`;
  const segments = base.split("/").filter(Boolean);
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join("/")}`.replace(/\/+$/, "") || "/";
}

function parent(path: string): string {
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}` || "/";
}

function loadKbFilesFromDisk(baseDir = "data/kb"): Map<string, string> {
  const files = new Map<string, string>();
  const root = resolve(process.cwd(), baseDir);
  const walk = (dir: string, rel = ""): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, nextRel);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const vfsPath = `/kb/${nextRel.replace(/\\/g, "/")}`;
      files.set(vfsPath, readFileSync(fullPath, "utf8"));
    }
  };
  try {
    walk(root);
  } catch {
    return files;
  }
  return files;
}

export class HybridFileSystem {
  private readonly kbFiles = loadKbFilesFromDisk();

  constructor(private readonly db: Database) {}

  private dynamicChildren(tenantId: string, prefix: string): string[] {
    const stmt = this.db.query(
      "SELECT path FROM virtual_files WHERE tenant_id = ?1 AND path LIKE ?2 ORDER BY path"
    );
    const rows = stmt.all(tenantId, `${prefix === "/" ? "" : prefix}/%`) as { path: string }[];
    const names = new Set<string>();
    for (const row of rows) {
      const rel = row.path.slice(prefix === "/" ? 1 : prefix.length + 1);
      const first = rel.split("/")[0];
      if (first) names.add(first);
    }
    return [...names];
  }

  private kbChildren(prefix: string): string[] {
    if (prefix === "/") return ["kb", "workspace", "memory", "scratch", "tools"];
    if (!prefix.startsWith("/kb")) return [];
    const names = new Set<string>();
    for (const filePath of this.kbFiles.keys()) {
      if (!filePath.startsWith(prefix === "/kb" ? "/kb/" : `${prefix}/`)) continue;
      const rel = filePath.slice(prefix.length + (prefix.endsWith("/") ? 0 : 1));
      const first = rel.split("/")[0];
      if (first) names.add(first);
    }
    return [...names].sort();
  }

  async ls(ctx: SessionContext, target = "."): Promise<string[]> {
    const path = normalizePath(target, ctx.cwd);
    assertAllowed(canRead(ctx.role, path), "EACCES");
    if (path === "/" || path.startsWith("/kb")) {
      const staticChildren = this.kbChildren(path);
      const dynamicChildren =
        path === "/" ? this.dynamicChildren(ctx.tenantId, "/") : [];
      return [...new Set([...staticChildren, ...dynamicChildren])].sort();
    }
    if (
      path.startsWith("/workspace") ||
      path.startsWith("/memory") ||
      path.startsWith("/scratch")
    ) {
      return this.dynamicChildren(ctx.tenantId, path);
    }
    return [];
  }

  async cd(ctx: SessionContext, target: string): Promise<string> {
    const next = normalizePath(target, ctx.cwd);
    const list = await this.ls(ctx, next);
    if (list.length === 0 && !next.startsWith("/kb/") && !next.startsWith("/workspace") && !next.startsWith("/memory") && !next.startsWith("/scratch") && next !== "/tools" && next !== "/") {
      throw new Error("ENOENT");
    }
    return next;
  }

  async cat(ctx: SessionContext, target: string): Promise<string> {
    const path = normalizePath(target, ctx.cwd);
    assertAllowed(canRead(ctx.role, path), "EACCES");
    if (path.startsWith("/kb")) {
      const content = this.kbFiles.get(path);
      if (!content) throw new Error("ENOENT");
      return content;
    }
    const stmt = this.db.query(
      "SELECT content FROM virtual_files WHERE tenant_id = ?1 AND path = ?2 LIMIT 1"
    );
    const row = stmt.get(ctx.tenantId, path) as { content?: string } | null;
    if (!row?.content) throw new Error("ENOENT");
    return row.content;
  }

  async write(ctx: SessionContext, target: string, content: string): Promise<void> {
    const path = normalizePath(target, ctx.cwd);
    assertAllowed(canWrite(ctx.role, path), path.startsWith("/kb") ? "EROFS" : "EACCES");
    const now = new Date().toISOString();
    const stmt = this.db.query(`
      INSERT INTO virtual_files (tenant_id, path, content, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(tenant_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `);
    stmt.run(ctx.tenantId, path, content, now);
  }

  async find(ctx: SessionContext, target = "."): Promise<string[]> {
    const root = normalizePath(target, ctx.cwd);
    const paths: string[] = [];
    if (root.startsWith("/kb") || root === "/") {
      for (const key of this.kbFiles.keys()) {
        if (key.startsWith(root === "/" ? "/kb" : root)) paths.push(key);
      }
    }
    if (root.startsWith("/workspace") || root.startsWith("/memory") || root.startsWith("/scratch") || root === "/") {
      const stmt = this.db.query("SELECT path FROM virtual_files WHERE tenant_id = ?1 ORDER BY path");
      const rows = stmt.all(ctx.tenantId) as { path: string }[];
      for (const row of rows) {
        if (row.path.startsWith(root) || root === "/") paths.push(row.path);
      }
    }
    return [...new Set(paths)].sort();
  }

  async grep(ctx: SessionContext, pattern: string, target = "/kb"): Promise<GrepMatch[]> {
    const root = normalizePath(target, ctx.cwd);
    const candidates = (await this.find(ctx, root)).filter((p) => !p.endsWith("/"));
    const regex = new RegExp(pattern, "i");
    const matches: GrepMatch[] = [];
    for (const path of candidates) {
      if (!path.startsWith(root)) continue;
      const body = await this.cat(ctx, path).catch(() => null);
      if (!body) continue;
      const lines = body.split("\n");
      lines.forEach((value, index) => {
        if (regex.test(value)) {
          matches.push({ path, line: index + 1, value });
        }
      });
    }
    return matches;
  }

  pwd(ctx: SessionContext): string {
    return normalizePath(ctx.cwd, "/");
  }

  async mkdir(ctx: SessionContext, target: string): Promise<void> {
    const path = normalizePath(target, ctx.cwd);
    assertAllowed(canWrite(ctx.role, path), path.startsWith("/kb") ? "EROFS" : "EACCES");
    if (!path.startsWith("/workspace") && !path.startsWith("/memory") && !path.startsWith("/scratch")) {
      throw new Error("EACCES");
    }
  }

  async rm(ctx: SessionContext, target: string): Promise<void> {
    const path = normalizePath(target, ctx.cwd);
    assertAllowed(canWrite(ctx.role, path), path.startsWith("/kb") ? "EROFS" : "EACCES");
    const stmt = this.db.query("DELETE FROM virtual_files WHERE tenant_id = ?1 AND path = ?2");
    stmt.run(ctx.tenantId, path);
  }

  static normalize(input: string, cwd = "/"): string {
    return normalizePath(input, cwd);
  }

  static parent(path: string): string {
    return parent(path);
  }
}

