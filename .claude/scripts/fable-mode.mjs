#!/usr/bin/env node
// Fable mode toggle (CLAUDE.md §2): node .claude/scripts/fable-mode.mjs [off|status]   (on: only the owner, by typing /fable on)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { FILE, modeFile, readFableMode } = require("../hooks/lib/fable-mode.js");

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = modeFile(root);
const cmd = process.argv[2] || "status";

if (cmd === "on") {
  console.error("REFUSED: only the owner turns Fable mode on, by typing /fable on in the prompt box; this script cannot.");
  process.exit(1);
} else if (cmd === "off") fs.rmSync(file, { force: true });
else if (cmd !== "status") {
  console.error("usage: fable-mode.mjs [off|status]");
  process.exit(2);
}

const mode = readFableMode(root);
if (mode.on) console.log(`FABLE MODE: ON (${FILE}) — ${Object.entries(mode.map).map(([a, e]) => `${a}=${e}`).join(", ")}`);
else if (mode.error) console.log(`FABLE MODE: OFF — ${mode.error}; run "off" to remove it, or the owner types /fable on to rewrite it`);
else console.log("FABLE MODE: OFF");
