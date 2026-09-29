#!/usr/bin/env node
// SessionStart hook: inject the resume context into Claude's context.
//   the latest session report (from the newest tasks/YYYY-MM/DD.md that has one) + todo.md + lessons.md
// Input: Claude Code hook event JSON on stdin. Fail-open.
//
// Budget: combined TOTAL_CAP. On overflow the lowest-priority block is trimmed first
// (lessons -> report -> todo); each block keeps at least MIN_FLOOR.
// lessons keeps its tail (newest entries), the others keep their head.

const fs = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('./lib/journal-util');

const TOTAL_CAP = 16 * 1024;
const MIN_FLOOR = 2 * 1024;
const JOURNAL_CAP = 4 * 1024;
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

  const blocks = [
    { label: 'TODO', file: path.join(tasks, 'todo.md'), empty: '(no todo recorded yet)', keep: 'head' },
    { label: 'LATEST SESSION REPORT', empty: '(no session report saved yet)', keep: 'head', load: () => latestReport(tasks) },
    { label: 'LESSONS', file: path.join(tasks, 'lessons.md'), empty: '(no lessons recorded yet)', keep: 'tail' },
  ];
  for (const b of blocks) {
    try {
      b.text = b.load ? b.load() : fs.readFileSync(b.file, 'utf8');
    } catch {
      b.text = null;
    }
  }
  fit(blocks);

  const out = ['=== CONTEXT: workspace root ==='];
  for (const b of blocks) out.push(`\n=== ${b.label} ===\n${b.text == null ? b.empty : b.text}`);
  const leftovers = tmpLeftovers(path.join(root, 'tmp'));
  if (leftovers) out.push(`\n=== TMP LEFTOVERS ===\n${leftovers}`);
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: out.join('\n') } }));
  process.exit(0);
});

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
    return `[${rel}]
` + clip(text.slice(heads[heads.length - 1].index), JOURNAL_CAP, 'head');
  }
  return null;
}

function clip(text, max, keep) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return text;
  const note = '[trimmed]';
  return keep === 'tail'
    ? `${note}\n` + buf.subarray(buf.length - max).toString('utf8').replace(/^\uFFFD+/, '')
    : buf.subarray(0, max).toString('utf8').replace(/\uFFFD+$/, '') + `\n${note}`;
}

function fit(blocks) {
  const size = (b) => (b.text == null ? 0 : Buffer.byteLength(b.text, 'utf8'));
  let sum = blocks.reduce((a, b) => a + size(b), 0);
  for (let i = blocks.length - 1; i >= 0 && sum > TOTAL_CAP; i--) {
    const b = blocks[i];
    if (b.text == null || size(b) <= MIN_FLOOR) continue;
    const before = size(b);
    b.text = clip(b.text, Math.max(MIN_FLOOR, before - (sum - TOTAL_CAP)), b.keep);
    sum -= before - size(b);
  }
}
