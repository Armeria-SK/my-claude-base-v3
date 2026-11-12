#!/usr/bin/env node
// Fable mode toggle (CLAUDE.md §2): node .claude/scripts/fable-mode.mjs [on|off|status]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DEFAULT_MAP, FILE, modeFile, toJson, readFableMode } = require("../hooks/lib/fable-mode.js");

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = modeFile(root);
const cmd = process.argv[2] || "status";

if (cmd === "on") fs.writeFileSync(file, toJson(DEFAULT_MAP));
else if (cmd === "off") fs.rmSync(file, { force: true });
else if (cmd !== "status") {
  console.error("usage: fable-mode.mjs [on|off|status]");
  process.exit(2);
}

const mode = readFableMode(root);
if (mode.on) console.log(`FABLE MODE: ON (${FILE}) — ${Object.entries(mode.map).map(([a, e]) => `${a}=${e}`).join(", ")}`);
else if (mode.error) console.log(`FABLE MODE: OFF — ${mode.error}; run "off" to remove it or "on" to rewrite it`);
else console.log("FABLE MODE: OFF");
