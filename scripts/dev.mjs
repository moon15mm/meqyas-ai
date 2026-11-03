#!/usr/bin/env node
/**
 * `pnpm dev` — starts PostgreSQL + Redis (docker), applies migrations, then
 * runs the API (uvicorn --reload) and the web app (next dev) side by side.
 *
 * Flags: --no-docker (use your own PostgreSQL/Redis), --skip-migrate
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: isWin, ...opts });
  if (res.status !== 0) {
    console.error(`\n✖ ${cmd} ${cmdArgs.join(" ")} failed`);
    process.exit(res.status ?? 1);
  }
}

if (!args.has("--no-docker")) {
  console.log("▶ starting PostgreSQL & Redis (docker compose)…");
  run("docker", ["compose", "up", "-d", "--wait", "postgres", "redis"]);
}
if (!args.has("--skip-migrate")) {
  console.log("▶ applying database migrations…");
  run("uv", ["run", "--directory", "apps/api", "alembic", "upgrade", "head"]);
}

const procs = [
  {
    name: "api",
    color: "\x1b[36m",
    cmd: "uv",
    args: ["run", "--directory", "apps/api", "uvicorn", "app.main:app", "--reload", "--port", "8000"],
  },
  { name: "web", color: "\x1b[35m", cmd: "pnpm", args: ["--filter", "@meqyas/web", "dev"] },
];

const children = procs.map(({ name, color, cmd, args: a }) => {
  const child = spawn(cmd, a, { cwd: root, shell: isWin, env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line) out.write(prefix + line + "\n");
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("\n  Web  → http://localhost:3000\n  API  → http://localhost:8000/api/docs\n");
