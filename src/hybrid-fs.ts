import type { Database } from "bun:sqlite";
import type { RedisClient } from "bun";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { getFileByPath, getPathTree, grepCandidates } from "./qdrant";
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

export class HybridFileSystem {
  private pathTree = new Map<string, string[]>();

  constructor(
    private readonly db: Database,
    private readonly redis: RedisClient,
    private readonly qdrant: QdrantClient,
    private readonly collection: string
  ) {}

  async warmPathTree(): Promise<void> {
    const cacheKey = "vfs:path_tree";
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.pathTree = new Map(Object.entries(JSON.parse(cached) as Record<string, string[]>));
      return;
    }
    const tree = await getPathTree(this.qdrant, this.collection);
    this.pathTree = new Map(Object.entries(tree));
    await this.redis.set(cacheKey, JSON.stringify(tree));
    await this.redis.expire(cacheKey, 600);
  }

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

  async ls(ctx: SessionContext, target = "."): Promise<string[]> {
    const path = normalizePath(target, ctx.cwd);
    assertAllowed(canRead(ctx.role, path), "EACCES");
    if (path.startsWith("/kb")) {
      return this.pathTree.get(path) ?? [];
    }
    if (path === "/" || path.startsWith("/workspace") || path.startsWith("/memory") || path.startsWith("/scratch")) {
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
      const key = `vfs:file:${path}`;
      const cached = await this.redis.get(key);
      if (cached) return cached;
      const content = await getFileByPath(this.qdrant, this.collection, path);
      if (!content) throw new Error("ENOENT");
      await this.redis.set(key, content);
      await this.redis.expire(key, 600);
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
      for (const key of this.pathTree.keys()) {
        if (key.startsWith(root)) paths.push(key);
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
    const candidates = root.startsWith("/kb")
      ? await grepCandidates(this.qdrant, this.collection, pattern)
      : (await this.find(ctx, root)).filter((p) => !p.endsWith("/"));
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

  static normalize(input: string, cwd = "/"): string {
    return normalizePath(input, cwd);
  }

  static parent(path: string): string {
    return parent(path);
  }
}

