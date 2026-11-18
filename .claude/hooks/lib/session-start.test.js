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

test('todo is injected alongside the report; a leftover session-state.md is not', () => {
  const ctx = inject({
    'tasks/session-state.md': 'STATE-POINTER',
    'tasks/todo.md': 'TODO-ITEM',
    'tasks/2026-09/29.md': report('x', 'y'),
  });
  assert.match(ctx, /TODO-ITEM/);
  assert.doesNotMatch(ctx, /STATE-POINTER|SESSION STATE/);
});

const inboxBlock = (ctx) => ctx.split('=== LESSONS INBOX ===\n')[1].split('\n\n=== ')[0];
const lesson = (n, rule = `RULE-${n}`) =>
  `### [2026-11-0${n}] HEAD-${n}\n- Trigger: TRIGGER-${n}\n- Mistake: MISTAKE-${n}\n- Fix: FIX-${n}\n${rule ? `- Rule: ${rule}\n` : ''}\n`;

test('lessons inbox: heading and Rule line are shown, Trigger / Mistake / Fix are not', () => {
  const block = inboxBlock(inject({ 'tasks/lessons.md': '# Lessons\n\n' + lesson(1) + lesson(2) }));
  for (const w of ['HEAD-1', 'RULE-1', 'HEAD-2', 'RULE-2']) assert.match(block, new RegExp(w));
  assert.doesNotMatch(block, /TRIGGER|MISTAKE|FIX-/);
  assert.doesNotMatch(block, /more waiting/);
});

test('lessons inbox: 5 entries show the newest 4 and "1 more waiting"', () => {
  const block = inboxBlock(inject({ 'tasks/lessons.md': [1, 2, 3, 4, 5].map((n) => lesson(n)).join('') }));
  for (const n of [2, 3, 4, 5]) assert.match(block, new RegExp(`HEAD-${n}\\n.*RULE-${n}`));
  assert.doesNotMatch(block, /HEAD-1|RULE-1/);
  assert.match(block, /… 1 more waiting — route them at the next \/save-session \(CLAUDE\.md §4\)$/);
});

test('lessons inbox: no file, or a file without entries, reads (inbox empty)', () => {
  assert.strictEqual(inboxBlock(inject({})), '(inbox empty)');
  assert.strictEqual(inboxBlock(inject({ 'tasks/lessons.md': '# Lessons\n\nno entries yet\n' })), '(inbox empty)');
});

test('lessons inbox: an entry without a Rule line shows its heading only', () => {
  const block = inboxBlock(inject({ 'tasks/lessons.md': lesson(1, '') + lesson(2) }));
  assert.match(block, /HEAD-1\n- \[2026-11-02\] HEAD-2\n {2}- Rule: RULE-2$/);
});

test('lessons inbox: a "### " line inside a code fence is not an entry', () => {
  const block = inboxBlock(inject({ 'tasks/lessons.md': lesson(1, '') + '```\n### FENCED\n- Rule: FENCED-RULE\n```\n- Rule: RULE-AFTER-FENCE\n' }));
  assert.strictEqual(block, '- [2026-11-01] HEAD-1\n  - Rule: RULE-AFTER-FENCE');
});

test('lessons inbox: a file starting with a BOM keeps its first entry', () => {
  assert.match(inboxBlock(inject({ 'tasks/lessons.md': '\uFEFF' + lesson(1) })), /^- \[2026-11-01\] HEAD-1\n/);
});

const BUDGETS = { HEAD: 1200, TODO: 5000, 'LATEST SESSION REPORT': 1500, 'LESSONS INBOX': 1200, 'TMP LEFTOVERS': 500 };
// Blocks are joined by one newline and every block after the first opens with "\n=== LABEL ===".
function blockSizes(ctx) {
  const cuts = Object.keys(BUDGETS)
    .slice(1)
    .map((label) => [label, ctx.indexOf(`\n\n=== ${label} ===\n`)])
    .filter(([, i]) => i >= 0)
    .sort((a, b) => a[1] - b[1]);
  const sizes = { HEAD: cuts[0][1] };
  cuts.forEach(([label, i], k) => (sizes[label] = (k + 1 < cuts.length ? cuts[k + 1][1] : ctx.length) - (i + 1)));
  return sizes;
}
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('every block stays within its character budget and the total within 9,500, whatever the files hold', () => {
  const big = (unit, n) => unit.repeat(n);
  const fables = [
    JSON.stringify({ [big('😀あ', 3000)]: { model: 'fable', effort: 'low' } }),
    '{"executor": 😀}', // broken JSON: the parser's message quotes half of the emoji
    JSON.stringify({ executor: { model: 'fable', effort: 'low' }, 'reviewer-deep': { model: 'fable', effort: 'medium' } }),
  ];
  for (const fable of fables) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
    roots.push(base);
    const root = path.join(base, ...Array.from({ length: 14 }, () => big('深い😀', 20)));
    assert.ok(root.length > BUDGETS.HEAD - 100, 'the root path alone must nearly fill the head budget');
    const files = {
      '.claude/fable-mode.json': fable,
      '.claude/env-copy.json': '{"enabled":true}',
      'tasks/todo.md': '## Now\n' + big('- 😀やること\n', 4000),
      'tasks/lessons.md': [1, 2, 3, 4, 5, 6].map((n) => `### ${big('😀見出し', 100)}${n}\n- Rule: ${big('😀決まり', 200)}\n`).join('\n'),
      'tasks/2026-09/29.md': '## 10:00 セッションレポート — ' + big('😀報告', 5000),
    };
    for (let i = 0; i < 12; i++) files[`tmp/${big('😀', 40)}${i}.log`] = 'x';
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    const sizes = blockSizes(ctx);
    assert.deepStrictEqual(Object.keys(sizes).sort(), Object.keys(BUDGETS).sort());
    for (const [label, n] of Object.entries(sizes)) assert.ok(n <= BUDGETS[label], `${label}: ${n} > ${BUDGETS[label]}`);
    assert.ok(sizes.TODO > 4900 && sizes['LATEST SESSION REPORT'] > 1400, 'oversized inputs must fill their budgets');
    assert.ok(ctx.length <= 9500, `total ${ctx.length}`);
    assert.doesNotMatch(ctx, LONE_SURROGATE);
    assert.match(ctx, /=== ENV COPY ===\nENV COPY: ON/);
    assert.match(inboxBlock(ctx), /… 2 more waiting/);
  }
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
  assert.ok(!block.includes(toggleCmd('on')), 'the conductor must never be told to run on itself');
  assert.match(block, /ask them to type `\/fable on` in the prompt box themselves \(agents cannot turn it on/);
  assert.match(block, /the owner types \/fable on to switch/);
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

const envBlock = (ctx) => ctx.split('=== ENV COPY ===\n')[1].split('\n\n=== ')[0];

test('env copy OFF: one line, no copy command', () => {
  const block = envBlock(inject({}));
  assert.strictEqual(block, 'ENV COPY: OFF — never copy .env into worktrees (only the owner can allow it, by typing /env-copy on).');
});

test('env copy ON: one line with the absolute copy command', () => {
  const block = envBlock(inject({ '.claude/env-copy.json': '{"enabled":true}' }));
  const script = path.join(roots[roots.length - 1], '.claude', 'scripts', 'env-copy.mjs').split(path.sep).join('/');
  assert.ok(block.startsWith('ENV COPY: ON'), block);
  assert.ok(block.includes(`\`node "${script}" copy <product> <worktree>\``), block);
  assert.ok(!block.includes('\n'), 'must stay one line');
});

test('env copy file malformed or deeply nested: OFF with the reason, not a crash', () => {
  for (const text of ['{"enabled":"yes"}', `{"enabled":${'['.repeat(10000)}${']'.repeat(10000)}}`]) {
    const block = envBlock(inject({ '.claude/env-copy.json': text }));
    assert.match(block, /^ENV COPY: OFF \(.*must be exactly \{ "enabled": true \} \(got enabled is (string|object)\)\) — never copy/);
  }
});
