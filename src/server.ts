import { Elysia, t } from "elysia";
import { stepCountIs, tool, ToolLoopAgent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { openDatabase } from "./sqlite";
import { HybridFileSystem } from "./hybrid-fs";
import { AuditLog } from "./audit";
import type { Role, SessionContext } from "./types";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  SQLITE_PATH: z.string().default("./data/runtime/vfs-demo.db"),
  DEFAULT_ROLE: z.enum(["admin", "editor", "viewer"]).default("admin"),
  ANTHROPIC_API_KEY: z.string().optional(),
});

const env = envSchema.parse(process.env);

const db = openDatabase(env.SQLITE_PATH);
const fs = new HybridFileSystem(db);
const audit = new AuditLog(db);

function headerValue(
  headers: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return headers[key] ?? headers[key.toLowerCase()];
}

function sessionFromHeaders(
  headers: Record<string, string | undefined>,
): SessionContext {
  return {
    userId: headerValue(headers, "x-user-id") ?? "demo-user",
    role: (headerValue(headers, "x-role") as Role) ?? env.DEFAULT_ROLE,
    cwd: headerValue(headers, "x-cwd") ?? "/",
    tenantId: headerValue(headers, "x-tenant-id") ?? "demo-tenant",
  };
}

function logEvent(
  ctx: SessionContext,
  command: string,
  target: string,
  status: "ok" | "error",
  details?: Record<string, unknown>,
): void {
  audit.write({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    userId: ctx.userId,
    role: ctx.role,
    tenantId: ctx.tenantId,
    command,
    target,
    status,
    details,
  });
}

function createOperations(
  ctx: SessionContext,
  source = "api",
) {
  return {
    ls: async (path?: string) => {
      const target = path ?? ".";
      try {
        const entries = await fs.ls(ctx, target);
        logEvent(ctx, "ls", target, "ok", { count: entries.length, source });
        return { cwd: ctx.cwd, path: target, entries };
      } catch (error) {
        logEvent(ctx, "ls", target, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    mkdir: async (path: string) => {
      try {
        await fs.mkdir(ctx, path);
        logEvent(ctx, "mkdir", path, "ok", { source });
        return { ok: true, path };
      } catch (error) {
        logEvent(ctx, "mkdir", path, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    rm: async (path: string) => {
      try {
        await fs.rm(ctx, path);
        logEvent(ctx, "rm", path, "ok", { source });
        return { ok: true, path };
      } catch (error) {
        logEvent(ctx, "rm", path, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    cd: async (path: string) => {
      try {
        const cwd = await fs.cd(ctx, path);
        logEvent(ctx, "cd", path, "ok", { cwd, source });
        return { cwd };
      } catch (error) {
        logEvent(ctx, "cd", path, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    cat: async (path: string) => {
      try {
        const content = await fs.cat(ctx, path);
        logEvent(ctx, "cat", path, "ok", { length: content.length, source });
        return { path, content };
      } catch (error) {
        logEvent(ctx, "cat", path, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    write: async (path: string, content: string) => {
      try {
        await fs.write(ctx, path, content);
        logEvent(ctx, "write", path, "ok", { length: content.length, source });
        return { ok: true, path, written: content.length };
      } catch (error) {
        logEvent(ctx, "write", path, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    find: async (path?: string) => {
      const target = path ?? ".";
      try {
        const results = await fs.find(ctx, target);
        logEvent(ctx, "find", target, "ok", { count: results.length, source });
        return { path: target, results };
      } catch (error) {
        logEvent(ctx, "find", target, "error", {
          error: (error as Error).message,
          source,
        });
        throw error;
      }
    },
    grep: async (pattern: string, path?: string) => {
      const target = path ?? "/kb";
      try {
        const matches = await fs.grep(ctx, pattern, target);
        logEvent(ctx, "grep", target, "ok", {
          pattern,
          count: matches.length,
          source,
        });
        return { path: target, pattern, matches };
      } catch (error) {
        logEvent(ctx, "grep", target, "error", {
          error: (error as Error).message,
          source,
          pattern,
        });
        throw error;
      }
    },
  };
}

function createAgentTools(ctx: SessionContext) {
  const ops = createOperations(ctx, "agent");
  return {
    ls: tool({
      description: "List entries in a VFS path",
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path }) => ops.ls(path),
    }),
    cat: tool({
      description: "Read a file from VFS",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => ops.cat(path),
    }),
    write: tool({
      description: "Write content to a writable VFS path",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => ops.write(path, content),
    }),
    mkdir: tool({
      description: "Create a directory path in writable roots",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => ops.mkdir(path),
    }),
    rm: tool({
      description: "Remove a file in writable roots",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => ops.rm(path),
    }),
    find: tool({
      description: "Find files recursively from a root path",
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path }) => ops.find(path),
    }),
    grep: tool({
      description: "Search file lines by regex pattern",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path }) => ops.grep(pattern, path),
    }),
  };
}

const app = new Elysia()
  .get("/", () => new Response(Bun.file("public/index.html")))
  .get(
    "/app.js",
    () =>
      new Response(Bun.file("public/app.js"), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      }),
  )
  .get("/health/live", () => ({ status: "ok" }))
  .get("/health/ready", async () => {
    const dbOk = db.query("SELECT 1 as ok").get() as { ok: number };
    return {
      status: dbOk.ok === 1 ? "ready" : "degraded",
      sqlite: dbOk.ok === 1,
    };
  })
  .post(
    "/tools/ls",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.ls(body.path);
    },
    { body: t.Object({ path: t.Optional(t.String()) }) },
  )
  .post(
    "/tools/cd",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.cd(body.path);
    },
    { body: t.Object({ path: t.String() }) },
  )
  .post(
    "/tools/cat",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.cat(body.path);
    },
    { body: t.Object({ path: t.String() }) },
  )
  .post(
    "/tools/write",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      const result = await ops.write(body.path, body.content);
      return { ok: result.ok };
    },
    { body: t.Object({ path: t.String(), content: t.String() }) },
  )
  .post(
    "/tools/mkdir",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.mkdir(body.path);
    },
    { body: t.Object({ path: t.String() }) },
  )
  .post(
    "/tools/rm",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.rm(body.path);
    },
    { body: t.Object({ path: t.String() }) },
  )
  .post(
    "/tools/find",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.find(body.path);
    },
    { body: t.Object({ path: t.Optional(t.String()) }) },
  )
  .post(
    "/chat/agent",
    async ({ body, headers, set }) => {
      if (!env.ANTHROPIC_API_KEY) {
        set.status = 400;
        return { error: "ANTHROPIC_API_KEY is required for /chat/agent" };
      }
      const s = sessionFromHeaders(headers);
      const prompt = body.message.trim();
      try {
        const agent = new ToolLoopAgent({
          model: anthropic("claude-haiku-4-5"),
          instructions:
            "You are a VFS assistant. Use tools for exact filesystem operations and keep responses concise.",
          tools: createAgentTools(s),
          stopWhen: stepCountIs(8),
        });
        const result = await agent.generate({ prompt });
        logEvent(s, "agent", prompt.slice(0, 120), "ok", {
          steps: result.steps.length,
        });
        return {
          answer: result.text,
          steps: result.steps.map((step) => ({
            text: step.text,
            toolCalls: step.toolCalls.map((call) => ({
              toolName: call.toolName,
              input: call.input,
            })),
            toolResults: step.toolResults.map((toolResult) => ({
              toolName: toolResult.toolName,
              output: toolResult.output,
            })),
          })),
        };
      } catch (error) {
        const err = error as Error;
        logEvent(s, "agent", prompt.slice(0, 120), "error", {
          name: err.name,
          message: err.message,
          stack: err.stack,
        });
        set.status = 500;
        return { error: err.message, answer: "", steps: [] };
      }
    },
    { body: t.Object({ message: t.String() }) },
  )
  .post(
    "/tools/grep",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      const result = await ops.grep(body.pattern, body.path);
      return { matches: result.matches };
    },
    { body: t.Object({ pattern: t.String(), path: t.Optional(t.String()) }) },
  )
  .listen(env.PORT);

console.log(
  `vfs-demo listening on ${app.server?.hostname}:${app.server?.port}`,
);

const shutdown = async () => {
  db.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
