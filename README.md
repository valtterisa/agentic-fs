# vfs-demo

Virtual filesystem demo with Bun + Elysia + Qdrant + Redis + SQLite.  
No sandbox and no VPS orchestration required.

## One-command setup

```bash
docker compose up -d --build
```

After startup:

- API: `http://localhost:3000`
- UI: `http://localhost:3000`
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`

Set `ANTHROPIC_API_KEY` to enable the agent endpoint.

## What this demo does

- Virtual read-only knowledge base under `/kb`
- Writable tenant-scoped paths under `/workspace`, `/memory`, `/scratch`
- Tool endpoints for `ls`, `cd`, `cat`, `find`, `grep`, `write`
- Agent endpoint for natural language: `POST /chat/agent`
- Coarse filter in Qdrant and fine in-memory regex matching for grep
- Pre-embedded sample dataset imported automatically

## API examples

### List root

```bash
curl -X POST http://localhost:3000/tools/ls -H "content-type: application/json" -d "{\"path\":\"/\"}"
```

### Read a file

```bash
curl -X POST http://localhost:3000/tools/cat -H "content-type: application/json" -d "{\"path\":\"/kb/docs/intro.md\"}"
```

### Recursive grep

```bash
curl -X POST http://localhost:3000/tools/grep -H "content-type: application/json" -d "{\"path\":\"/kb\",\"pattern\":\"path tree\"}"
```

### Write to workspace

```bash
curl -X POST http://localhost:3000/tools/write -H "content-type: application/json" -H "x-role: editor" -d "{\"path\":\"/workspace/notes/today.txt\",\"content\":\"fast filesystem retrieval\"}"
```

### Agentic natural-language call

```bash
curl -X POST http://localhost:3000/chat/agent -H "content-type: application/json" -H "x-role: editor" -d "{\"message\":\"Find docs about grep and write a short summary to /workspace/notes/grep-summary.txt\"}"
```

### Find under workspace

```bash
curl -X POST http://localhost:3000/tools/find -H "content-type: application/json" -d "{\"path\":\"/workspace\"}"
```

## Add your own data

1. Put pre-embedded points into `data/sources/demo/preembedded/points.json`.
2. Keep one `path_tree` record and `chunk` records with `path`, `chunkIndex`, and `content`.
3. Re-run import:

```bash
docker compose run --rm indexer
```

## Prompt ideas

1. Find every line mentioning deterministic navigation.
2. Show architecture notes under `/kb/docs`.
3. Search for all files that mention grep behavior.
4. Write temporary notes under `/scratch` and read them back.
5. Compare `/kb/guides/search.md` and `/kb/guides/grep.md`.

## Security and backups

See [`docs/security-backup.md`](docs/security-backup.md).

