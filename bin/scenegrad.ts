#!/usr/bin/env bun
/**
 * scenegrad — top-level CLI dispatcher.
 *
 * Subcommands:
 *   scenegrad view [path]     — view trajectories in a browser
 *
 * (More subcommands later: `scenegrad bench`, `scenegrad publish`, etc.)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

const sub = argv[0];

if (!sub || sub === "--help" || sub === "-h") {
  console.log(`scenegrad — TDD for AI agents. https://github.com/daslabhq/scenegrad

Usage:
  scenegrad view [path]    view trajectories in a browser
  scenegrad --help         this help

Examples:
  scenegrad view                     # bulk view of ./traces
  scenegrad view ./run.jsonl         # single trace
`);
  process.exit(sub ? 0 : 1);
}

if (sub === "view") {
  // Forward to scenegrad-view
  const target = join(here, "scenegrad-view.ts");
  const child = spawn("bun", [target, ...argv.slice(1)], { stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 0));
} else {
  console.error(`scenegrad: unknown subcommand '${sub}'.\n  try: scenegrad --help`);
  process.exit(1);
}
