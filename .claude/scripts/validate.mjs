#!/usr/bin/env node
// Harness integrity check: node .claude/scripts/validate.mjs   (exit 0 = PASS, 1 = FAIL)
// Mechanizes what CLAUDE.md §2 states as policy: model tiers, effort pins, the medium/-deep
// pairs, read-only tool lists, hook wiring, and dangling references to removed machinery.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const findings = [];
const fail = (where, msg) => findings.push(`${where}: ${msg}`);

// ---- tier table: the single source of truth these checks enforce (mirrors CLAUDE.md §2)
const TIERS = {
  planner: { model: "opus", effort: "medium", twin: "planner-deep" },
  reviewer: { model: "opus", effort: "medium", twin: "reviewer-deep" },
  "planner-deep": { model: "opus", effort: "xhigh" },
  "reviewer-deep": { model: "opus", effort: "xhigh" },
  executor: { model: "sonnet", effort: "xhigh" },
  debugger: { model: "sonnet", effort: "xhigh" },
  verifier: { model: "sonnet", effort: "xhigh" },
  explorer: { model: "haiku", effort: null },
  chore: { model: "haiku", effort: null },
};
const READ_ONLY = ["reviewer", "reviewer-deep", "verifier", "explorer"];
const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"];
const JUDGES = ["planner", "planner-deep", "reviewer", "reviewer-deep"];

function frontmatter(file) {
  const m = read(file).match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    // A line that is neither `key:` nor an indented continuation means the closing `---`
    // was lost and body text is being read as frontmatter.
    else if (line.trim() && !/^\s/.test(line)) fm.__stray = line.slice(0, 60);
  }
  return fm;
}

// ---- 1. agents
const agentDir = path.join(ROOT, ".claude", "agents");
const agentFiles = fs.existsSync(agentDir) ? fs.readdirSync(agentDir).filter((f) => f.endsWith(".md")) : [];
const agents = new Map();
for (const f of agentFiles) {
  const name = f.replace(/\.md$/, "");
  const where = `agents/${f}`;
  const fm = frontmatter(path.join(agentDir, f));
  if (!fm) { fail(where, "missing frontmatter"); continue; }
  if (fm.__stray) fail(where, `frontmatter not closed properly (stray line: "${fm.__stray}")`);
  agents.set(name, fm);
  if (fm.name !== name) fail(where, `frontmatter name "${fm.name}" != filename`);
  if (!fm.description) fail(where, "missing description");
  const tier = TIERS[name];
  if (!tier) { fail(where, "not in the tier table (add it to TIERS here and CLAUDE.md §2, or remove the agent)"); continue; }
  if (fm.model !== tier.model) fail(where, `model must be the alias "${tier.model}" (got "${fm.model}") — pinned IDs break on version bumps`);
  if (tier.effort === null) {
    if ("effort" in fm) fail(where, `haiku-tier agent must not carry an effort key (got "${fm.effort}")`);
  } else if (fm.effort !== tier.effort) fail(where, `effort must be ${tier.effort} (got "${fm.effort ?? "unset"}")`);
  const tools = (fm.tools || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (READ_ONLY.includes(name)) {
    if (!tools.length) fail(where, "read-only agent must list its tools explicitly");
    for (const t of WRITE_TOOLS) if (tools.includes(t)) fail(where, `read-only agent must not have ${t}`);
  }
}
for (const [name, tier] of Object.entries(TIERS)) {
  if (!agents.has(name)) fail(`agents/${name}.md`, "listed in the tier table but missing");
  if (tier.twin && !agents.has(tier.twin)) fail(`agents/${name}.md`, `medium role has no xhigh twin "${tier.twin}"`);
}
for (const name of JUDGES) {
  const f = path.join(agentDir, `${name}.md`);
  if (!fs.existsSync(f)) continue;
  const body = read(f);
  for (const field of ["Status: RESOLVED | UNRESOLVED", "Confidence: high | medium | low", "\nOpen: "]) {
    if (!body.includes(field)) fail(`agents/${name}.md`, `judge report format lost the "${field.trim()}" line — the escalation ladder reads it`);
  }
}

// ---- 2. skills / commands
const skillDir = path.join(ROOT, ".claude", "skills");
if (fs.existsSync(skillDir)) {
  for (const d of fs.readdirSync(skillDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(skillDir, d.name, "SKILL.md");
    if (!fs.existsSync(f)) { fail(`skills/${d.name}`, "missing SKILL.md"); continue; }
    const fm = frontmatter(f);
    if (!fm) fail(`skills/${d.name}/SKILL.md`, "missing frontmatter");
    else if (fm.__stray) fail(`skills/${d.name}/SKILL.md`, `frontmatter not closed properly (stray line: "${fm.__stray}")`);
    else if (fm.name !== d.name) fail(`skills/${d.name}/SKILL.md`, `frontmatter name "${fm.name}" != directory`);
  }
}

// ---- 3. settings.json + hook wiring
const settingsPath = path.join(ROOT, ".claude", "settings.json");
let settings = null;
try { settings = JSON.parse(read(settingsPath)); } catch (e) { fail("settings.json", `invalid JSON: ${e.message}`); }
const wired = new Set();
if (settings) {
  for (const groups of Object.values(settings.hooks || {})) {
    for (const g of groups) {
      for (const h of g.hooks || []) {
        const m = (h.command || "").match(/\.claude\/hooks\/([\w.-]+\.js)/);
        if (!m) continue;
        wired.add(m[1]);
        if (!fs.existsSync(path.join(ROOT, ".claude", "hooks", m[1]))) fail("settings.json", `hook "${m[1]}" is wired but the file is missing`);
      }
    }
  }
  const scriptCmd = settings.statusLine?.command?.match(/\.claude\/scripts\/([\w.-]+)/);
  if (scriptCmd && !fs.existsSync(path.join(ROOT, ".claude", "scripts", scriptCmd[1]))) fail("settings.json", `statusLine script "${scriptCmd[1]}" is missing`);
  if (settings.model !== "opus") fail("settings.json", `conductor model should be the alias "opus" (got "${settings.model}")`);
}
const hookDir = path.join(ROOT, ".claude", "hooks");
for (const f of fs.readdirSync(hookDir)) {
  if (f.endsWith(".js") && !wired.has(f)) fail(`hooks/${f}`, "hook file is not wired in settings.json");
}

// ---- 4. references to removed machinery, and CLAUDE.md § citations
const claudeMd = read(path.join(ROOT, "CLAUDE.md"));
const sections = new Set([...claudeMd.matchAll(/^#{2,3} (\d+(?:\.\d+)?)[. ]/gm)].map((m) => m[1]));
const scan = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "tmp"].includes(e.name)) walk(p); }
    else if (/\.(md|js|mjs|json|sh)$/.test(e.name) && !/\.test\.(js|mjs)$|samples\.json$/.test(e.name)) scan.push(p);
  }
};
walk(path.join(ROOT, ".claude"));
scan.push(path.join(ROOT, "CLAUDE.md"));
const removed = /\.relay-status|\.fable-status|clover\/|RELAY-MODEL|cmd-write-guard|block-review-floor|block-fable-when-off|deliberation-gate|document-author/;
const selfFile = fileURLToPath(import.meta.url);
for (const p of scan) {
  if (p === selfFile) continue;
  const text = read(p);
  const hit = text.match(removed);
  if (hit) fail(rel(p), `references removed v2 machinery "${hit[0]}"`);
  for (const m of text.matchAll(/CLAUDE\.md §(\d+(?:\.\d+)?)/g)) {
    if (!sections.has(m[1])) fail(rel(p), `cites CLAUDE.md §${m[1]}, which does not exist`);
  }
}

// ---- report
for (const f of findings) console.log(`FINDING  ${f}`);
console.log(`agents: ${agents.size}  hooks wired: ${wired.size}  findings: ${findings.length}`);
console.log(`VERDICT: ${findings.length ? "FAIL" : "PASS"}`);
process.exit(findings.length ? 1 : 0);
