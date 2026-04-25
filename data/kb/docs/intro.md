# VFS POSIX Demo Corpus

This corpus is used to test read-only knowledge access under `/kb`.

The system exposes deterministic endpoints for:

- `ls`
- `cd`
- `cat`
- `find`
- `grep`
- `write`
- `mkdir`
- `rm`

Only `/workspace`, `/memory`, and `/scratch` are writable.
`/kb` is read-only by design.
