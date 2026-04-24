FROM oven/bun:1.2 AS base
WORKDIR /app
COPY package.json tsconfig.json bunfig.toml ./
RUN bun install

FROM base AS runtime
WORKDIR /app
COPY . .
RUN mkdir -p /data && chown -R bun:bun /app /data
USER bun
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=20s CMD bun -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/server.ts"]

