#!/usr/bin/env node
// Auto-merge (CLAUDE.md §0): node .claude/scripts/auto-merge.mjs [off|status]   (on: only the owner, by typing /auto-merge on)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { FILE, modeFile, readAutoMergeMode } = require("../hooks/lib/auto-merge-mode.js");

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd = "status"] = process.argv.slice(2);

function usage() {
  console.error("usage: auto-merge.mjs [off|status]");
  process.exit(2);
}

if (cmd === "on") {
  console.error("REFUSED: only the owner turns auto-merge on, by typing /auto-merge on in the prompt box; this script cannot.");
  process.exit(1);
}
if (cmd === "off" || cmd === "status") {
  const root = process.env.CLAUDE_PROJECT_DIR || here;
  if (cmd === "off") fs.rmSync(modeFile(root), { force: true });
  const mode = readAutoMergeMode(root);
  console.log(
    mode.on
      ? `AUTO MERGE: ON (${FILE})`
      : mode.error
        ? `AUTO MERGE: OFF — ${mode.error}; run "off" to remove it, or the owner types /auto-merge on to rewrite it`
        : "AUTO MERGE: OFF"
  );
  process.exit(0);
}
usage();
