import { spawn } from "node:child_process";

const child = spawn("bun", ["scripts/index-demo-docs.ts"], { stdio: "inherit" });
child.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  process.exit(0);
});

