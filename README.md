# vfs-demo

POSIX-first virtual filesystem runtime for AI and automation tools.

This project focuses on deterministic, policy-enforced filesystem operations.  
It does not depend on vector databases, embeddings, or RAG to be useful.

## Why this exists

Most agent systems eventually need exact file operations, predictable behavior, and auditability.

This project provides a portable VFS contract that can be reused across stacks:

- POSIX-style operations for exact reads and writes
- strict path boundaries
- role-based access controls
- auditable tool execution

## Core scope

In scope:

- virtual roots and path policy
- POSIX-style tool endpoints (`ls`, `cat`, `write`, `mkdir`, `rm`)
- role-based access (`reader`, `editor`)
- operation audit trail

Out of scope in core:

- vector databases
- embedding/indexing pipelines
- retrieval orchestration
- RAG-specific logic

Those can be integrated later by materializing content into VFS roots (for example under `/kb`).

## Virtual filesystem model

- `/kb` = read-only knowledge root
- `/workspace`, `/memory`, `/scratch` = writable tenant-scoped roots

## API shape

Tool-style endpoints under `/tools/*` provide deterministic POSIX-like operations.

Example operations:

- `POST /tools/ls`
- `POST /tools/cat`
- `POST /tools/write`
- `POST /tools/mkdir`
- `POST /tools/rm`

## Run locally

```bash
docker compose up -d --build
```

Endpoints:

- API: `http://localhost:3000`
- UI: `http://localhost:3000`
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`

## API examples

```bash
curl -X POST http://localhost:3000/tools/ls \
  -H "content-type: application/json" \
  -d "{\"path\":\"/\"}"
```

```bash
curl -X POST http://localhost:3000/tools/cat \
  -H "content-type: application/json" \
  -d "{\"path\":\"/kb/docs/intro.md\"}"
```

```bash
curl -X POST http://localhost:3000/tools/write \
  -H "content-type: application/json" \
  -H "x-role: editor" \
  -d "{\"path\":\"/workspace/notes/hello.txt\",\"content\":\"hello from vfs\"}"
```

## Integration model

This VFS can be plugged into projects that use RAG, vector DBs, search, or custom ingestion.

Recommended boundary:

- external systems discover/retrieve content
- content is mounted or written into VFS roots
- agents and tools operate through deterministic POSIX-like VFS endpoints

## Security note

Write operations are restricted to writable roots, path traversal is blocked, and access is controlled by role.
