# Security and Backup

## Security Baseline

- Run services only through `docker compose`.
- Keep `.env` private and do not commit it.
- Restrict public access to port `3000` behind your own reverse proxy if internet exposed.
- Keep `/kb` read-only and use role headers (`x-role`) for write permissions.

## Backups

- SQLite volume: `app_data`

Backup command examples:

```bash
docker run --rm -v vfs-demo_app_data:/src -v %cd%/backups:/dst alpine tar czf /dst/sqlite.tar.gz -C /src .
```

