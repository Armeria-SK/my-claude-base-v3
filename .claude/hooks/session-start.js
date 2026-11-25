#!/usr/bin/env node
// SessionStart hook: inject the resume context into Claude's context.
//   the Fable mode state (CLAUDE.md §2) + the env copy and auto-merge switches (CLAUDE.md §0) + the latest session report (from the newest
//   tasks/YYYY-MM/DD.md that has one) + the head of todo.md + a digest of the lessons inbox (CLAUDE.md §4)
// Input: Claude Code hook event JSON on stdin. Fail-open.
//
// Budget: every block, label line included, is hard-clipped to its own fixed number of characters
// (JS string length), head kept. The budgets sum to 9,721; with the joining newlines the output stays
// under the 10,000-character cap Claude Code puts on additionalContext, whatever the files hold.

const fs = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('./lib/journal-util');
const { AGENTS, readFableMode } = require('./lib/fable-mode');
const { readEnvCopyMode } = require('./lib/env-copy-mode');
const { readAutoMergeMode } = require('./lib/auto-merge-mode');

const AUTO_MAX = 300; // the auto-merge line, added to the head block on top of the 1200 the Fable and env copy text share
const AUTO_LABEL = '\n\n=== AUTO MERGE ===\n';
const BUDGET = { head: 1200 + AUTO_MAX + AUTO_LABEL.length, todo: 5000, report: 1500, inbox: 1200, tmp: 500 };
const ENV_MAX = 500; // the env copy line's share of the head block; the Fable text gets the rest
const INBOX_SHOWN = 4;
const INBOX_HEADING_MAX = 80;
const INBOX_RULE_MAX = 160;
const REPORT_HEADING = /^## \d\d:\d\d .*$/gm; // "## HH:MM セッションレポート — ..." written by /save-session
const SCAN_DAYS = 30; // how many journal day-files back to look for a report
const MONTH_DIR = /^\d{4}-\d{2}$/; // tasks/YYYY-MM/
const DAY_FILE = /^\d{2}\.md$/; // tasks/YYYY-MM/DD.md

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = JSON.parse(data);
  } catch {
    /* defaults */
  }
  const root = projectRoot(payload);
  const tasks = path.join(root, 'tasks');

  const load = (fn) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const block = (label, text, budget) => clipChars(`\n=== ${label} ===\n${text}`, budget);

  const env = clipChars(envCopyLine(root), ENV_MAX);
  const auto = AUTO_LABEL + clipChars(autoMergeLine(root), AUTO_MAX);
  const head = (fable) => `=== CONTEXT: workspace root ===\n\n=== FABLE MODE ===\n${fable}\n\n=== ENV COPY ===\n${env}`;
  const out = [
    head(clipChars(fableLine(root), BUDGET.head - AUTO_MAX - AUTO_LABEL.length - head('').length)) + auto,
    block('TODO', load(() => fs.readFileSync(path.join(tasks, 'todo.md'), 'utf8')) ?? '(no todo recorded yet)', BUDGET.todo),
    block('LATEST SESSION REPORT', load(() => latestReport(tasks)) ?? '(no session report saved yet)', BUDGET.report),
    block('LESSONS INBOX', load(() => inboxDigest(fs.readFileSync(path.join(tasks, 'lessons.md'), 'utf8'))) ?? '(inbox empty)', BUDGET.inbox),
  ];
  const leftovers = tmpLeftovers(path.join(root, 'tmp'));
  if (leftovers) out.push(block('TMP LEFTOVERS', leftovers, BUDGET.tmp));
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: out.join('\n').toWellFormed() } }));
  process.exit(0);
});

// tasks/lessons.md is an inbox (CLAUDE.md §4): show the newest entries as heading + Rule line and
// count the rest, never the file itself. Entries are appended, so the newest are the last ones.
function inboxDigest(text) {
  const entries = [];
  let fenced = false;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (line.startsWith('### [')) fenced = false; // an unclosed fence must not hide the entries after it
    else if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    if (line.startsWith('### ')) entries.push({ heading: line.slice(4).trim() });
    else if (entries.length && !entries[entries.length - 1].rule && /^\s*(?:[-*]\s*)?\**Rule\b/.test(line)) entries[entries.length - 1].rule = line.trim();
  }
  if (!entries.length) return null;
  const lines = [];
  for (const e of entries.slice(-INBOX_SHOWN)) {
    lines.push(clipLine(`- ${e.heading}`, INBOX_HEADING_MAX));
    if (e.rule) lines.push(clipLine(`  ${e.rule}`, INBOX_RULE_MAX));
  }
  const more = entries.length - INBOX_SHOWN;
  if (more > 0) lines.push(`… ${more} more waiting — route them at the next /save-session (CLAUDE.md §4)`);
  return lines.join('\n');
}

// Injected on and off alike: the owner is asked once per session, before the first dispatch of an
// agent the mode covers, whether to keep or switch the mode (CLAUDE.md §2, Fable mode).
function fableLine(root) {
  const mode = readFableMode(root);
  const script = path.join(root, '.claude', 'scripts', 'fable-mode.mjs').split(path.sep).join('/');
  const how = {
    off: `run \`node "${script}" off\``,
    on: 'ask them to type `/fable on` in the prompt box themselves (agents cannot turn it on; never write the mode file)',
  };
  const ask = (choice, arg) =>
    `Before the first dispatch of ${AGENTS.join(' / ')} in this session, ask the owner once in plain Japanese via AskUserQuestion: ` +
    `${choice}; if they choose to switch, ${how[arg]}. Sessions that never dispatch these agents need not ask.`;
  if (mode.on) {
    const map = Object.entries(mode.map).map(([a, e]) => `${a}=${e}`).join(', ');
    return (
      `FABLE MODE: ON — ${map}; pass model "fable" + that effort when dispatching these agents (/fable off to stop).\n` +
      ask('continue with Fable mode, or turn it off', 'off')
    );
  }
  return (
    (mode.error ? `WARNING: ${mode.error}; the file is ignored (mode treated as OFF) until fixed or removed (/fable off).\n` : '') +
    `FABLE MODE: OFF — ${AGENTS.join(', ')} run on their normal settings (the owner types /fable on to switch).\n` +
    ask('stay on the normal roster, or turn Fable mode on', 'on')
  );
}

function envCopyLine(root) {
  const mode = readEnvCopyMode(root);
  const script = path.join(root, '.claude', 'scripts', 'env-copy.mjs').split(path.sep).join('/');
  if (mode.on) {
    return `ENV COPY: ON — copy a product's .env into its worktree only via \`node "${script}" copy <product> <worktree>\`; never cp or read it (/env-copy off to stop).`;
  }
  return `ENV COPY: OFF${mode.error ? ` (${mode.error})` : ''} — never copy .env into worktrees (only the owner can allow it, by typing /env-copy on).`;
}

function autoMergeLine(root) {
  const mode = readAutoMergeMode(root);
  const script = path.join(root, '.claude', 'scripts', 'auto-merge.mjs').split(path.sep).join('/');
  if (mode.on) {
    return `AUTO MERGE: ON — product PRs only (dev/<product>), after review APPROVE + check PASS for the PR head: node "${script}" merge <product> <PR#> <head-sha>; never gh pr merge; workspace PRs stay with the owner`;
  }
  return `AUTO MERGE: OFF${mode.error ? ` (${mode.error})` : ''} — the owner merges every PR`;
}

// tmp/ is delete-after-use (CLAUDE.md §0). Report what is left so it gets cleaned, but never delete
// here: a parallel session may still be using those files. Listing only — no recursion beyond sizes.
const TMP_LIST_MAX = 10;
function tmpLeftovers(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  if (!entries.length) return null;
  const sizeOf = (p) => {
    try {
      const st = fs.statSync(p);
      if (!st.isDirectory()) return st.size;
      return fs.readdirSync(p).reduce((a, n) => a + sizeOf(path.join(p, n)), 0);
    } catch {
      return 0;
    }
  };
  const now = Date.now();
  const rows = entries.map((e) => {
    const p = path.join(dir, e.name);
    let age = 0;
    try {
      age = Math.floor((now - fs.statSync(p).mtimeMs) / 86400000);
    } catch {
      /* unreadable entry: age 0 */
    }
    return { name: e.name + (e.isDirectory() ? '/' : ''), size: sizeOf(p), age };
  });
  rows.sort((a, b) => b.size - a.size);
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const total = rows.reduce((a, r) => a + r.size, 0);
  const lines = rows.slice(0, TMP_LIST_MAX).map((r) => `- tmp/${r.name}  ${kb(r.size)}  ${r.age}d old`);
  if (rows.length > TMP_LIST_MAX) lines.push(`- … ${rows.length - TMP_LIST_MAX} more`);
  return (
    `tmp/ holds ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} (${kb(total)}). tmp/ is delete-after-use (CLAUDE.md §0): ` +
    `delete what an earlier session of yours left once it is no longer needed; ask before deleting anything you cannot attribute.\n` +
    lines.join('\n')
  );
}

// The report is the single home of "next steps / on hold". Walk the day files tasks/YYYY-MM/DD.md
// newest first and return the last "## HH:MM" report section of the first file that has one, tagged
// with its path — so a report saved yesterday (or last week) is still injected today. Everything
// else in tasks/ (todo.md, lessons.md, stray files or dirs) is not a journal entry and is skipped.
function latestReport(tasks) {
  const names = (dir, keep) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(keep)
      .map((e) => e.name)
      .sort()
      .reverse();
  const files = [];
  for (const m of names(tasks, (e) => e.isDirectory() && MONTH_DIR.test(e.name))) {
    for (const d of names(path.join(tasks, m), (e) => e.isFile() && DAY_FILE.test(e.name))) files.push(path.join(tasks, m, d));
    if (files.length >= SCAN_DAYS) break;
  }
  for (const f of files.slice(0, SCAN_DAYS)) {
    const text = fs.readFileSync(f, 'utf8');
    const heads = [...text.matchAll(REPORT_HEADING)];
    if (!heads.length) continue;
    const rel = path.relative(path.dirname(tasks), f).split(path.sep).join('/');
    return `[${rel}]\n` + text.slice(heads[heads.length - 1].index);
  }
  return null;
}

// Cut to at most `max` characters (JS string length), never through a surrogate pair; the mark is
// counted inside `max`.
function cut(text, max, mark) {
  if (text.length <= max) return text;
  let end = Math.max(0, max - mark.length);
  const c = text.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return text.slice(0, end) + mark;
}
const clipChars = (text, max) => cut(text, max, '\n[trimmed]');
const clipLine = (text, max) => cut(text, max, '\u2026');
