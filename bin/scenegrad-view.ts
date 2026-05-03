#!/usr/bin/env bun
/**
 * scenegrad-view — local viewer for your own JSONL trajectories.
 *
 * Usage:
 *   npx scenegrad view ./traces            # bulk view of all JSONLs in ./traces
 *   npx scenegrad view ./run.jsonl         # single-trace view of one file
 *   npx scenegrad view                     # default: ./traces in cwd
 *   npx scenegrad view ./traces --port 7400 --no-open
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

interface CliArgs {
  target:  string;
  port:    number;
  open:    boolean;
}

function parseArgs(argv: string[]): CliArgs {
  // Strip leading "view" subcommand if present (npx scenegrad view ./traces)
  const args = argv[0] === "view" ? argv.slice(1) : argv;
  const out: CliArgs = { target: "./traces", port: 7400, open: true };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port") out.port = parseInt(args[++i]!, 10);
    else if (a === "--no-open") out.open = false;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else if (a && !a.startsWith("--")) positional.push(a);
  }
  if (positional[0]) out.target = positional[0];
  return out;
}

function printHelp() {
  console.log(`scenegrad view — view your trajectory JSONLs in a browser

Usage:
  scenegrad view [path]              path may be a directory of .jsonl files
                                      (default: ./traces) or a single .jsonl

Options:
  --port <n>     port to serve on (default: 7400)
  --no-open      don't auto-open browser
  --help         this help

Examples:
  scenegrad view                     # ./traces, bulk view, opens browser
  scenegrad view ./run.jsonl         # single file, opens single-trace viewer
  scenegrad view ./logs --port 8080  # serve on a custom port
`);
}

// ---------------------------------------------------------------------------
// Locate the bundled viewer files (shipped with the npm package).
// ---------------------------------------------------------------------------

function findViewerDir(): string {
  // When installed via npm, this file is at <pkg>/bin/scenegrad-view.ts
  // (or a compiled .js). Viewer lives at <pkg>/viewer/.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, "..", "viewer");
  try { statSync(candidate); return candidate; } catch {}
  throw new Error(`scenegrad-view: cannot find viewer/ relative to ${here}`);
}

// ---------------------------------------------------------------------------
// Build the manifest from a directory of JSONLs.
// ---------------------------------------------------------------------------

interface ManifestEntry {
  file:           string;
  id:             string;
  subject:        string;
  customer:       string;
  final_status:   string;
  success:        boolean;
  steps:          number;
  duration_ms:    number;
  model:          string;
}

function buildManifest(tracesDir: string): ManifestEntry[] {
  const files = readdirSync(tracesDir)
    .filter(f => extname(f) === ".jsonl")
    .filter(f => f !== "manifest.json");

  const entries: ManifestEntry[] = [];
  for (const file of files) {
    try {
      const text = readFileSync(join(tracesDir, file), "utf8");
      const firstLine = text.split(/\r?\n/).find(l => l.trim());
      if (!firstLine) continue;
      const span = JSON.parse(firstLine);
      const a = span.attributes ?? {};

      // Try to extract the final scene (last scene.set with key=scene)
      const sceneEvents = (span.events ?? []).filter((e: any) =>
        e.name === "scene.set"
        && e.attributes?.["scene.key"] === "scene"
        && e.attributes?.["scene.kind"] === "actual");
      const lastScene = sceneEvents[sceneEvents.length - 1];
      let finalScene: any = {};
      if (lastScene) {
        try { finalScene = JSON.parse(lastScene.attributes["scene.value"]); } catch {}
      }

      entries.push({
        file:         `/traces/${encodeURIComponent(file)}`,
        id:           finalScene.id ?? a["bench.task_id"] ?? basename(file, ".jsonl"),
        subject:      finalScene.subject ?? span.name ?? basename(file, ".jsonl"),
        customer:     finalScene.customer ?? "—",
        final_status: finalScene.status ?? (a["bench.success"] ? "completed" : "stuck"),
        success:      a["bench.success"] ?? false,
        steps:        a["bench.steps"] ?? 0,
        duration_ms:  a["bench.duration_ms"] ?? 0,
        model:        a["bench.model"] ?? "unknown",
      });
    } catch {
      // skip invalid
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolve(args.target);
  let isFile = false;
  let tracesDir = target;
  let singleFileName: string | undefined;
  try {
    const s = statSync(target);
    if (s.isFile()) {
      isFile = true;
      tracesDir = dirname(target);
      singleFileName = basename(target);
    } else if (!s.isDirectory()) {
      console.error(`scenegrad-view: ${args.target} is neither a file nor a directory`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`scenegrad-view: ${args.target} not found.\n  hint: dump JSONLs from your agent and pass the directory:\n      const t = trace.start();\n      ... your loop ...\n      t.dump("./traces/run.jsonl");\n`);
    process.exit(1);
  }

  const viewerDir = findViewerDir();
  const manifest = isFile ? [] : buildManifest(tracesDir);

  if (!isFile) {
    console.log(`scenegrad-view: indexed ${manifest.length} trajectory file${manifest.length === 1 ? "" : "s"} in ${tracesDir}`);
  }

  const server = Bun.serve({
    port: args.port,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;

      // Generated manifest
      if (p === "/api/manifest.json") {
        return Response.json(manifest);
      }

      // Trace files
      if (p.startsWith("/traces/")) {
        const filename = decodeURIComponent(p.slice("/traces/".length));
        const filepath = join(tracesDir, filename);
        try {
          statSync(filepath);
          return new Response(Bun.file(filepath), { headers: { "content-type": "application/x-ndjson" } });
        } catch { return new Response("not found", { status: 404 }); }
      }

      // Root → bulk view (or single-trace if user passed a file)
      if (p === "/" || p === "") {
        if (isFile) {
          const traceUrl = `/traces/${encodeURIComponent(singleFileName!)}`;
          return Response.redirect(`/index.html?trace=${encodeURIComponent(traceUrl)}`, 302);
        }
        return Response.redirect(`/bulk.html?manifest=${encodeURIComponent("/api/manifest.json")}`, 302);
      }

      // Static viewer files
      const filepath = join(viewerDir, p);
      // Prevent path traversal
      if (!filepath.startsWith(viewerDir)) return new Response("forbidden", { status: 403 });
      try {
        const f = Bun.file(filepath);
        if (await f.exists()) return new Response(f);
      } catch {}

      return new Response("not found", { status: 404 });
    },
  });

  const homeUrl = isFile
    ? `http://localhost:${server.port}/index.html?trace=${encodeURIComponent(`/traces/${encodeURIComponent(singleFileName!)}`)}`
    : `http://localhost:${server.port}/bulk.html?manifest=${encodeURIComponent("/api/manifest.json")}`;

  console.log(`scenegrad-view ready at ${homeUrl}`);
  console.log(`  ${isFile ? "viewing" : "watching"} ${target}`);
  console.log(`  press ctrl-c to stop\n`);

  if (args.open) {
    const opener = process.platform === "darwin" ? "open"
                  : process.platform === "win32"  ? "start"
                  : "xdg-open";
    Bun.spawn([opener, homeUrl], { stdio: ["ignore", "ignore", "ignore"] });
  }
}

main().catch(e => {
  console.error("scenegrad-view:", e?.message ?? e);
  process.exit(1);
});
