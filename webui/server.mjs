#!/usr/bin/env node
/**
 * webui/server.mjs — thin dashboard server for the @sntxrr/career-ops
 * swamp model.
 *
 * It serves a self-contained page and two JSON endpoints that shell out to
 * swamp:
 *   GET  /api/pipeline  → `swamp data get pipeline current --json` (.content)
 *   POST /api/refresh   → re-runs `import-all`, then returns the fresh pipeline
 *
 * No third-party dependencies — Node's http/fs/child_process only. The swamp
 * repo is the directory that contains this file's parent (webui/..).
 *
 * Env overrides:
 *   PORT            listen port (default 8787)
 *   SWAMP_BIN       swamp binary (default: "swamp" on PATH)
 *   CAREER_OPS_DIR  fallback career-ops path for refresh when no snapshot exists
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const PORT = Number(process.env.PORT) || 8787;
const SWAMP = process.env.SWAMP_BIN || "swamp";
const MODEL = "@sntxrr/career-ops";
const INSTANCE = "pipeline";

async function swamp(args) {
  const { stdout } = await run(SWAMP, args, {
    cwd: REPO,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  return stdout;
}

/** Pull the pipeline resource's `.content` out of `swamp data get --json`. */
function extractContent(stdout) {
  const parsed = JSON.parse(stdout);
  if (parsed && typeof parsed === "object" && parsed.content) return parsed.content;
  // Fallback: find the object that looks like our pipeline snapshot.
  const seen = [];
  const stack = [parsed];
  while (stack.length) {
    const o = stack.pop();
    if (o && typeof o === "object") {
      if (!Array.isArray(o) && "funnel" in o && "applications" in o) return o;
      for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

async function getPipeline() {
  try {
    const out = await swamp(["data", "get", INSTANCE, "current", "--json"]);
    const content = extractContent(out);
    if (!content) return { empty: true, message: "No pipeline snapshot found. Click Refresh to import." };
    return content;
  } catch (e) {
    const msg = String(e.stderr || e.message || e);
    // No data yet is an expected, recoverable state — surface it as empty.
    if (/not\s*found|no\s*data|does not exist/i.test(msg)) {
      return { empty: true, message: "No pipeline data yet. Click Refresh to import from the tracker." };
    }
    throw e;
  }
}

/** Derive the career-ops dir from the last snapshot, else env/default. */
async function resolveCareerOpsDir() {
  try {
    const cur = await getPipeline();
    if (cur && cur.trackerPath) {
      return cur.trackerPath.replace(/\/data\/applications\.md$/, "");
    }
  } catch { /* fall through to default */ }
  return process.env.CAREER_OPS_DIR || join(homedir(), "git", "career-ops");
}

async function refresh() {
  const careerOpsDir = await resolveCareerOpsDir();
  await swamp([
    "model", MODEL, "method", "run", "import-all", INSTANCE,
    "--input", `careerOpsDir=${careerOpsDir}`,
  ]);
  return getPipeline();
}

/**
 * Change one row's status/note via the swamp set-status method (which routes
 * through career-ops' set-status.mjs, then re-mirrors). Returns the fresh
 * pipeline. A dry run validates without writing the tracker.
 */
async function setStatus({ selector, status, note, dryRun }) {
  if (selector == null || selector === "") throw new Error("selector is required");
  if (!status) throw new Error("status is required");
  const careerOpsDir = await resolveCareerOpsDir();
  const args = [
    "model", MODEL, "method", "run", "set-status", INSTANCE,
    "--input", `careerOpsDir=${careerOpsDir}`,
    "--input", `selector=${selector}`,
    "--input", `status=${status}`,
  ];
  if (note) args.push("--input", `note=${note}`);
  if (dryRun) args.push("--input", "dryRun=true");
  await swamp(args);
  if (dryRun) return { ok: true, dryRun: true };
  return getPipeline();
}

/** Read and JSON-parse a request body (capped). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      data += c;
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(join(HERE, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && url.pathname === "/api/pipeline") {
      return sendJSON(res, 200, await getPipeline());
    }
    if (req.method === "POST" && url.pathname === "/api/refresh") {
      return sendJSON(res, 200, await refresh());
    }
    if (req.method === "POST" && url.pathname === "/api/set-status") {
      return sendJSON(res, 200, await setStatus(await readBody(req)));
    }
    sendJSON(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[server]", e.stderr || e.message || e);
    sendJSON(res, 500, { error: String(e.stderr || e.message || e).slice(0, 500) });
  }
});

server.listen(PORT, () => {
  console.log(`career-ops pipeline webui → http://localhost:${PORT}`);
  console.log(`  swamp repo: ${REPO}`);
});
