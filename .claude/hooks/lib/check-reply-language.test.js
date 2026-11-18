// node --test .claude/hooks/lib/check-reply-language.test.js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'check-reply-language.js');
const { judge, BLOCK_REASON, MIN_LETTERS, MIN_JAPANESE_SHARE, LOG_MAX_LINES, JUDGE_MAX_CHARS } = require(HOOK);

const LOG_REL = path.join('tasks', 'reply-language-log.jsonl');

const ENGLISH =
  'The change is complete and every test passes. I rewrote the parser so that quoted values are ' +
  'no longer mistaken for flags, added probe rows for each accepted spelling, and confirmed the ' +
  'result by running the hook by hand. Nothing has been pushed yet, so the next step is yours.';
const JAPANESE = (
  '変更は終わり、テストはすべて通りました。引用符の中の文字を旗と見間違えないように読み取り部分を書き直し、' +
  '受け付ける書き方ごとに確認用の行を足し、手で hook を動かして結果を確かめました。' +
  'まだどこにも送っていないので、次の一手はお任せします。'
).repeat(3);
const CODE_BLOCK =
  '```js\n' + 'function example(input) { return input.map((value) => value.trim()).filter(Boolean); }\n'.repeat(60) + '```';

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crl-'));
  roots.push(root);
  return root;
}

// root === null -> run without CLAUDE_PROJECT_DIR.
function run(mode, payload, root, opts = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (root) env.CLAUDE_PROJECT_DIR = root;
  const r = spawnSync(process.execPath, mode === undefined ? [HOOK] : [HOOK, mode], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env,
    cwd: opts.cwd || root || os.tmpdir(),
    encoding: 'utf8',
  });
  return r;
}

const logLines = (root) => {
  const file = path.join(root, LOG_REL);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};

const stop = (text, extra = {}) => ({
  session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: text, ...extra,
});

test('judge: long Japanese is not drift', () => {
  const v = judge(JAPANESE);
  assert.ok(v.letters >= MIN_LETTERS);
  assert.strictEqual(v.drift, false);
});

test('judge: long English is drift', () => {
  const v = judge(ENGLISH);
  assert.ok(v.letters >= MIN_LETTERS);
  assert.ok(v.share < MIN_JAPANESE_SHARE);
  assert.strictEqual(v.drift, true);
});

test('judge: short English (under the letter minimum) is not drift', () => {
  const v = judge('Done. All tests pass and nothing was pushed.');
  assert.ok(v.letters < MIN_LETTERS);
  assert.strictEqual(v.drift, false);
});

test('judge: Japanese prose around a large code block is not drift', () => {
  const text = `${JAPANESE}\n\n${CODE_BLOCK}\n\n以上です。`;
  assert.strictEqual(judge(text).drift, false);
  assert.strictEqual(judge(`${JAPANESE}\n\n${CODE_BLOCK.replace(/```/g, '')}`).drift, true, 'the same code unfenced would count');
});

test('judge: inline code, URLs and file paths are not counted', () => {
  const noise =
    ' `someIdentifierWithAVeryLongEnglishName` https://example.com/a/long/english/path/to/some/page ' +
    'D:/work/project/src/components/widgets/button.js .claude/hooks/lib/parser.js';
  const short = '確認しました。問題ありません。';
  assert.strictEqual(judge(short + noise.repeat(8)).letters, judge(short).letters);
});

test('judge: Japanese punctuation is not counted as a Japanese letter', () => {
  const v = judge('、。「」・'.repeat(50) + 'かな漢字カナ');
  assert.strictEqual(v.letters, 6);
  assert.strictEqual(v.share, 1);
});

test('judge: only the first JUDGE_MAX_CHARS characters are judged', () => {
  const head = 'あ'.repeat(JUDGE_MAX_CHARS);
  const tail = ' english words after the judged part'.repeat(5000);
  const v = judge(head + tail);
  assert.strictEqual(v.letters, JUDGE_MAX_CHARS);
  assert.strictEqual(v.drift, false);
  assert.strictEqual(judge('あ'.repeat(100) + tail).drift, true, 'the same tail inside the judged part counts');
});

test('judge: English prose with a few Japanese words is drift', () => {
  const v = judge(`${ENGLISH} 以上です。ありがとう。`);
  assert.ok(v.share > 0 && v.share < MIN_JAPANESE_SHARE);
  assert.strictEqual(v.drift, true);
});

test('observe: long English is allowed and writes exactly one log line', () => {
  const root = tempRoot();
  const r = run('observe', stop(ENGLISH), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  const lines = logLines(root);
  assert.strictEqual(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.session, 'sess-1');
  assert.strictEqual(entry.mode, 'observe');
  assert.strictEqual(entry.letters, judge(ENGLISH).letters);
  assert.strictEqual(entry.japaneseShare, 0);
  assert.strictEqual(entry.head, ENGLISH.slice(0, 80));
  assert.ok(!Number.isNaN(Date.parse(entry.time)));
});

test('observe: long Japanese is allowed and writes nothing', () => {
  const root = tempRoot();
  const r = run('observe', stop(JAPANESE), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(fs.existsSync(path.join(root, 'tasks')), false);
});

test('enforce: long English is blocked with the reason, and logged', () => {
  const root = tempRoot();
  const r = run('enforce', stop(ENGLISH), root);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.strictEqual(out.reason, BLOCK_REASON);
  assert.strictEqual(logLines(root).length, 1);
  assert.strictEqual(JSON.parse(logLines(root)[0]).mode, 'enforce');
});

test('enforce: long Japanese is allowed', () => {
  const root = tempRoot();
  const r = run('enforce', stop(JAPANESE), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('enforce: stop_hook_active true is never blocked (no second block in one chain)', () => {
  const root = tempRoot();
  const r = run('enforce', stop(ENGLISH, { stop_hook_active: true }), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('enforce: short English is allowed', () => {
  const root = tempRoot();
  const r = run('enforce', stop('Done. All tests pass.'), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('the block reason carries the English-on-request exception', () => {
  assert.match(BLOCK_REASON, /持ち主が英語で頼んだ返事なら、そのまま出し直してください/);
  assert.match(BLOCK_REASON, /日本語で書き直してください/);
});

for (const mode of ['off', undefined, 'bogus']) {
  test(`mode ${mode === undefined ? '(no argument)' : mode}: no output, no log`, () => {
    const root = tempRoot();
    const r = run(mode, stop(ENGLISH), root);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(fs.existsSync(path.join(root, 'tasks')), false);
  });
}

for (const mode of ['observe', 'enforce']) {
  test(`${mode}: malformed stdin, a missing field and a non-string field exit 0 silently`, () => {
    const root = tempRoot();
    for (const input of ['not json', '', '{}', JSON.stringify({ last_assistant_message: [ENGLISH] }), 'null']) {
      const r = run(mode, input, root);
      assert.strictEqual(r.status, 0, `${JSON.stringify(input)}: ${r.stderr}`);
      assert.strictEqual(r.stdout, '');
    }
    assert.strictEqual(fs.existsSync(path.join(root, 'tasks')), false);
  });
}

test('no CLAUDE_PROJECT_DIR: nothing is written anywhere, even with a cwd in the payload', () => {
  const payloadCwd = tempRoot();
  const processCwd = tempRoot();
  const r = run('observe', stop(ENGLISH, { cwd: payloadCwd }), null, { cwd: processCwd });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  assert.deepStrictEqual(fs.readdirSync(payloadCwd), []);
  assert.deepStrictEqual(fs.readdirSync(processCwd), []);
});

test('the log goes under CLAUDE_PROJECT_DIR, not the cwd in the payload', () => {
  const root = tempRoot();
  const payloadCwd = tempRoot();
  run('observe', stop(ENGLISH, { cwd: payloadCwd }), root, { cwd: payloadCwd });
  assert.strictEqual(logLines(root).length, 1);
  assert.deepStrictEqual(fs.readdirSync(payloadCwd), []);
});

test('a log already at the cap is not appended to; one line under the cap still is', () => {
  const root = tempRoot();
  const file = path.join(root, LOG_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n'.repeat(LOG_MAX_LINES - 1));
  run('observe', stop(ENGLISH), root);
  assert.strictEqual(logLines(root).length, LOG_MAX_LINES);
  const r = run('observe', stop(ENGLISH), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(logLines(root).length, LOG_MAX_LINES);
});

test('enforce still blocks when the log cannot be written (the tasks path is a file)', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'tasks'), 'not a directory');
  const r = run('enforce', stop(ENGLISH), root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).decision, 'block');
  const o = run('observe', stop(ENGLISH), root);
  assert.strictEqual(o.status, 0, o.stderr);
  assert.strictEqual(o.stdout, '');
});
