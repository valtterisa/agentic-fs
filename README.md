# vfs-demo

## What

`vfs-demo` is an AI chat assistant that answers questions by using filesystem tools against a controlled virtual filesystem.

Core idea: use a virtual filesystem with POSIX-like commands instead of giving the model a real sandboxed machine.

The virtual filesystem is hybrid:
- `/kb` is read-only knowledge loaded from local files (`data/kb`)
- `/workspace`, `/memory`, `/scratch` are writable and stored in SQLite per tenant

The UI shows tool usage in real time, so you can see exactly how the answer was produced.

## Why

Most AI demos hide retrieval steps and make debugging hard.  
This project makes answers traceable and safer:

- **Traceable**: you can see `grep`/`cat`/`find` calls while the model is working
- **Deterministic**: answers can be grounded in exact file reads, not just model memory
- **Safer by default**: access is constrained to virtual roots with role-based permissions
- **Lower complexity**: no mandatory vector DB or embedding pipeline for core usage
- **Lower cost than full sandboxes**: no per-session VM/container sandbox required for common file tasks

## Filesystem illusion model

This system intentionally gives the LLM a filesystem illusion that is:

- useful enough to solve tasks
- constrained enough to stay safe
- auditable enough to trust

In this project, that illusion is built with:

- POSIX-like tool names (`ls`, `cat`, `grep`, `find`, `write`, `mkdir`, `rm`)
- path semantics (`/kb`, `/workspace`, relative paths via `cwd`)
- realistic error behavior (`ENOENT`, `EACCES`, `EROFS`)
- persistent writable state (SQLite-backed virtual files)
- real read-only knowledge source (`data/kb`)

Why this is better than direct filesystem access in many products:

- smaller blast radius (access only to allowed virtual roots)
- easier policy enforcement and auditing
- predictable, testable behavior for agent actions
- lower infra spend compared with running isolated compute sandboxes per interaction

## Example use cases

- **Internal knowledge assistant**: ask questions over markdown docs and verify sources via live tool trace
- **Support/copilot workflows**: answer policy/process questions from `/kb`, write drafts to `/workspace`
- **Ops/runbook helper**: search incident notes, summarize findings, and store action notes
- **Compliance-friendly assistant**: keep auditable read/write operations with tenant scoping

## Money (costs)

Main cost buckets:

- **Model/API cost**: each `/chat/agent` request uses LLM tokens; longer prompts, longer outputs, and extra tool loops increase usage.
- **Runtime cost**: CPU/memory for Bun + UI + container runtime, plus SQLite storage (typically low for this demo).

How this architecture keeps costs down:

- **No mandatory embeddings/vector DB in core**: avoids indexing pipelines and vector storage as baseline cost.
- **Tool-grounded retrieval from local files**: the agent can read exactly what it needs instead of sending large context blindly.
- **Step limit (`stopWhen`)**: caps agent tool loop length to prevent runaway token/tool usage.
- **Local KB files**: knowledge can live in `data/kb` without external retrieval fees.

Practical money-saving tips:

- Keep prompts short and specific.
- Keep KB files concise and split by topic for targeted `grep`/`cat`.
- Use smaller/faster models for routine queries; reserve larger models for hard tasks.
- Monitor average tool steps per request and lower step limits if needed.

## Architecture

It combines:
- a Bun + Elysia backend
- a virtual filesystem (VFS) with role-based policies
- an AI agent with filesystem tools (`ls`, `cat`, `grep`, `find`, `write`, `mkdir`, `rm`)
- a Vite + React chat UI that streams tool usage in real time

## Filesystem model

Virtual roots:
- `/kb` = read-only knowledge base loaded from `data/kb`
- `/workspace`, `/memory`, `/scratch` = writable tenant-scoped roots (stored in SQLite)
- `/tools` = virtual tool namespace

Access model:
- `viewer` can read
- `editor` and `admin` can write in writable roots
- writes to `/kb` are blocked

## Main API endpoints

Health:
- `GET /health/live`
- `GET /health/ready`

Tool API:
- `POST /tools/ls`
- `POST /tools/cat`
- `POST /tools/grep`
- `POST /tools/find`
- `POST /tools/write`
- `POST /tools/mkdir`
- `POST /tools/rm`

Agent API:
- `POST /chat/agent` (non-streaming JSON response)
- `POST /chat/agent/stream` (NDJSON streaming events for live UI updates)

## Run with Docker

```bash
docker compose up -d --build
```

App URL:
- `http://localhost:3000`

## Run without Docker

Install dependencies:

```bash
pnpm install
```

Build UI:

```bash
pnpm run build:ui
```

Run backend:

```bash
pnpm run start
```

Optional frontend dev server:

```bash
pnpm run dev:ui
```

## Quick API examples

List root:

```bash
curl -X POST http://localhost:3000/tools/ls \
  -H "content-type: application/json" \
  -d "{\"path\":\"/\"}"
```

Read KB file:

```bash
curl -X POST http://localhost:3000/tools/cat \
  -H "content-type: application/json" \
  -d "{\"path\":\"/kb/space/missions.md\"}"
```

Ask the agent:

```bash
curl -X POST http://localhost:3000/chat/agent \
  -H "content-type: application/json" \
  -d "{\"message\":\"What year did Apollo 11 land on the Moon?\"}"
```

## Notes

- `/kb` content is loaded from disk at server start.
- If you change files under `data/kb`, restart/rebuild the app to ensure runtime sees updates.
