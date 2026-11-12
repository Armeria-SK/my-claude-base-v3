// node --test .claude/hooks/lib/session-start.test.js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'session-start.js');

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function inject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: root, session_id: 'abcd1234' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

const report = (title, next) => `## 10:00 セッションレポート — ${title}\n\n**次にやること**: ${next}\n`;

test('a report saved on an earlier day is injected today', () => {
  const ctx = inject({
    'tasks/2026-09/27.md': '# 2026-09-27\n\n' + report('前回の結論', 'NEXT-FROM-OLD-DAY'),
    'tasks/2026-09/29.md': '# 2026-09-29\n\n- 09:00:00 [aaaaaaaa] SESSION START (startup)\n',
  });
  assert.match(ctx, /NEXT-FROM-OLD-DAY/);
  assert.match(ctx, /tasks\/2026-09\/27\.md/);
});

test('the newest report wins, across days and within a file', () => {
  const ctx = inject({
    'tasks/2026-08/31.md': report('古い', 'OLDEST'),
    'tasks/2026-09/01.md': report('中', 'MIDDLE-A') + '\n' + report('新しい', 'NEWEST'),
  });
  assert.match(ctx, /NEWEST/);
  assert.doesNotMatch(ctx, /OLDEST|MIDDLE-A/);
});

test('legacy marker lines left in old day files are not mistaken for a report', () => {
  const ctx = inject({ 'tasks/2026-09/29.md': '- 09:00:00 [aaaaaaaa] SESSION START (startup)\n' });
  assert.match(ctx, /no session report saved yet/);
  assert.doesNotMatch(ctx, /SESSION START/);
});

test('no tasks directory at all still injects a well-formed context', () => {
  const ctx = inject({});
  assert.match(ctx, /no session report saved yet/);
  assert.match(ctx, /no todo recorded yet/);
});

test('todo and lessons are injected alongside the report; a leftover session-state.md is not', () => {
  const ctx = inject({
    'tasks/session-state.md': 'STATE-POINTER',
    'tasks/todo.md': 'TODO-ITEM',
    'tasks/lessons.md': 'LESSON-RULE',
    'tasks/2026-09/29.md': report('x', 'y'),
  });
  for (const w of ['TODO-ITEM', 'LESSON-RULE']) assert.match(ctx, new RegExp(w));
  assert.doesNotMatch(ctx, /STATE-POINTER|SESSION STATE/);
});

const reportBlock = (ctx) => ctx.split('=== LATEST SESSION REPORT ===\n')[1].split('\n\n=== ')[0];

test('non-journal entries in tasks/ are never mistaken for a day file', () => {
  const ctx = inject({
    'tasks/todo.md': report('todo', 'FROM-TODO'),
    'tasks/notes/01.md': report('stray dir', 'FROM-NOTES-DIR'),
    'tasks/2026-10': report('a file named like a month', 'FROM-MONTH-FILE'),
    'tasks/2026-09/readme.txt': report('not a day file', 'FROM-README'),
    'tasks/2026-09/30.md/inner.md': report('a dir named like a day', 'FROM-DAY-DIR'),
    'tasks/2026-09/28.md': report('本物', 'REAL-DAY'),
  });
  const block = reportBlock(ctx);
  assert.match(block, /^\[tasks\/2026-09\/28\.md\]/);
  assert.match(block, /REAL-DAY/);
  assert.doesNotMatch(block, /FROM-/);
});

test('leftovers in tmp/ are reported with size, not deleted', () => {
  const ctx = inject({ 'tmp/probe/run.log': 'x'.repeat(4096), 'tmp/old.txt': 'y' });
  assert.match(ctx, /=== TMP LEFTOVERS ===/);
  assert.match(ctx, /tmp\/probe\/  4 KB/);
  assert.match(ctx, /tmp\/old\.txt/);
  assert.match(ctx, /delete-after-use/);
});

test('an empty or missing tmp/ adds no leftovers block', () => {
  assert.doesNotMatch(inject({}), /TMP LEFTOVERS/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.mkdirSync(path.join(root, 'tmp'));
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
  assert.doesNotMatch(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /TMP LEFTOVERS/);
});

const fableBlock = (ctx) => ctx.split('=== FABLE MODE ===\n')[1].split('\n\n=== ')[0];
const toggleCmd = (arg) => `node "${path.join(roots[roots.length - 1], '.claude', 'scripts', 'fable-mode.mjs').split(path.sep).join('/')}" ${arg}`;

test('Fable mode OFF: the state and the once-per-session question are injected', () => {
  const block = fableBlock(inject({}));
  assert.match(block, /^FABLE MODE: OFF — planner, executor, reviewer, planner-deep, reviewer-deep/);
  assert.match(block, /ask the owner once in plain Japanese via AskUserQuestion: stay on the normal Opus roster, or turn Fable mode on/);
  assert.ok(block.includes(`run \`${toggleCmd('on')}\``), block);
  assert.ok(path.isAbsolute(roots[roots.length - 1]));
  assert.match(block, /never dispatch these agents need not ask/);
  assert.doesNotMatch(block, /WARNING/);
});

test('Fable mode ON: the mapping and the keep-or-stop question are injected', () => {
  const on = { executor: { model: 'fable', effort: 'low' }, 'reviewer-deep': { model: 'fable', effort: 'medium' } };
  const block = fableBlock(inject({ '.claude/fable-mode.json': JSON.stringify(on) }));
  assert.match(block, /^FABLE MODE: ON — executor=low, reviewer-deep=medium; pass model "fable" \+ that effort/);
  assert.match(block, /AskUserQuestion: continue with Fable mode, or turn it off/);
  assert.ok(block.includes(`run \`${toggleCmd('off')}\``), block);
});

test('Fable mode file malformed: warned and treated as OFF', () => {
  const block = fableBlock(inject({ '.claude/fable-mode.json': JSON.stringify({ chore: { model: 'fable', effort: 'low' } }) }));
  assert.match(block, /^WARNING: .*unknown agent "chore"/);
  assert.match(block, /FABLE MODE: OFF/);
  assert.doesNotMatch(block, /FABLE MODE: ON/);
});

test('a deeply nested Fable mode file is warned about, not a crash', () => {
  const deep = '['.repeat(10000) + ']'.repeat(10000);
  const block = fableBlock(inject({ '.claude/fable-mode.json': `{"executor":{"model":${deep},"effort":"low"}}` }));
  assert.match(block, /^WARNING: .*"executor" model must be "fable" \(got object\)/);
  assert.match(block, /FABLE MODE: OFF/);
});
