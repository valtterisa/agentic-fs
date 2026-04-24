import { Elysia, t } from "elysia";
import { stepCountIs, tool, ToolLoopAgent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { Bash } from "just-bash";
import { z } from "zod";
import { openDatabase } from "./sqlite";
import { openRedis } from "./redis";
import { createQdrant } from "./qdrant";
import { HybridFileSystem } from "./hybrid-fs";
import { AuditLog } from "./audit";
import type { Role, SessionContext } from "./types";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_COLLECTION: z.string().default("vfs_demo_docs"),
  SQLITE_PATH: z.string().default("./data/runtime/vfs-demo.db"),
  DEFAULT_ROLE: z.enum(["admin", "editor", "viewer"]).default("admin"),
  ANTHROPIC_API_KEY: z.string().optional(),
});

const env = envSchema.parse(process.env);

const db = openDatabase(env.SQLITE_PATH);
const redis = await openRedis(env.REDIS_URL);
const qdrant = createQdrant(env.QDRANT_URL);
const fs = new HybridFileSystem(db, redis, qdrant, env.QDRANT_COLLECTION);
await fs.warmPathTree();
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
  source: "api" | "agent" = "api",
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
  let bashPromise: Promise<Bash> | null = null;
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

  const initBash = async (): Promise<Bash> => {
    const roots = ["/kb", "/workspace", "/memory", "/scratch"];
    const files: Record<string, string> = {};
    for (const root of roots) {
      const discovered = await ops.find(root).catch(() => ({ results: [] as string[] }));
      for (const path of discovered.results) {
        const file = await ops.cat(path).catch(() => null);
        if (file?.content) files[path] = file.content;
      }
    }
    return new Bash({
      files,
      cwd: "/",
      env: {
        HOME: "/home/user",
        USER: "agent",
        TENANT_ID: ctx.tenantId,
        AGENT_USER_ID: ctx.userId,
        AGENT_ROLE: ctx.role,
      },
      executionLimits: {
        maxCallDepth: 80,
        maxCommandCount: 5000,
        maxLoopIterations: 5000,
        maxAwkIterations: 5000,
        maxSedIterations: 5000,
      },
    });
  };

  const getBash = async (): Promise<Bash> => {
    if (!bashPromise) bashPromise = initBash();
    return bashPromise;
  };

  const syncWritableBack = async (bash: Bash): Promise<void> => {
    const scan = await bash.exec("find /workspace /memory /scratch -type f 2>/dev/null");
    if (!scan.stdout.trim()) return;
    const paths = scan.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const path of paths) {
      const read = await bash.exec(`cat ${quote(path)}`);
      if (read.exitCode === 0) {
        await ops.write(path, read.stdout);
      }
    }
  };
  return {
    bash: tool({
      description:
        "Run shell commands in a sandboxed POSIX environment (use for ls, cd, cat, grep, find, pipes, redirection, and text processing).",
      inputSchema: z.object({
        command: z.string().min(1),
        cwd: z.string().optional(),
        stdin: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        replaceEnv: z.boolean().optional(),
        rawScript: z.boolean().optional(),
      }),
      execute: async ({
        command,
        cwd,
        stdin,
        args,
        env,
        replaceEnv,
        rawScript,
      }) => {
        const bash = await getBash();
        const result = await bash.exec(command, {
          cwd,
          stdin,
          args,
          env,
          replaceEnv,
          rawScript,
        });
        await syncWritableBack(bash);
        logEvent(ctx, "bash", command.slice(0, 120), "ok", {
          exitCode: result.exitCode,
          source: "agent",
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      },
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
    const redisOk = await redis
      .ping()
      .then((v) => v === "PONG")
      .catch(() => false);
    const qdrantOk = await qdrant
      .getCollections()
      .then(() => true)
      .catch(() => false);
    const dbOk = db.query("SELECT 1 as ok").get() as { ok: number };
    return {
      status: redisOk && qdrantOk && dbOk.ok === 1 ? "ready" : "degraded",
      redis: redisOk,
      qdrant: qdrantOk,
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
    "/tools/find",
    async ({ body, headers }) => {
      const s = sessionFromHeaders(headers);
      const ops = createOperations(s);
      return ops.find(body.path);
    },
    { body: t.Object({ path: t.Optional(t.String()) }) },
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
  .post(
    "/chat/agent",
    async ({ body, headers, set }) => {
      const s = sessionFromHeaders(headers);
      const prompt = body.message.trim();
      try {
        const agent = new ToolLoopAgent({
          model: anthropic("claude-haiku-4-5"),
          instructions:
            "You are a filesystem agent for a virtual FS. Use tools to inspect or modify data when needed. Keep replies short and actionable.",
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
        const err = error as Error & {
          cause?: unknown;
          data?: unknown;
          statusCode?: number;
        };
        const errorDetails = {
          name: err.name,
          message: err.message,
          stack: err.stack,
          cause: err.cause,
          data: err.data,
          statusCode: err.statusCode,
        };
        logEvent(s, "agent", prompt.slice(0, 120), "error", errorDetails);
        set.status = 500;
        return {
          error: err.message,
          details: errorDetails,
          answer: "",
          steps: [],
        };
      }
    },
    { body: t.Object({ message: t.String() }) },
  )
  .listen(env.PORT);

console.log(
  `vfs-demo listening on ${app.server?.hostname}:${app.server?.port}`,
);

const shutdown = async () => {
  redis.close();
  db.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
