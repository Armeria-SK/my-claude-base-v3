// node --test .claude/hooks/lib/enforce-model-tier.test.js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'enforce-model-tier.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
const agent = (name, model, effort) =>
  fs.writeFileSync(
    path.join(root, '.claude', 'agents', `${name}.md`),
    `---\r\nname: ${name}\r\nmodel: ${model}\r\n${effort ? `effort: ${effort}\r\n` : ''}---\r\nbody\r\n`
  );
agent('reviewer', 'fable', 'low');
agent('executor', 'fable', 'low');
agent('reviewer-deep', 'fable', 'medium');
agent('legacy', 'fable');
agent('verifier', 'opus', 'medium');
agent('explorer', 'haiku');
agent('cheap', 'haiku', 'low');
agent('steady', 'sonnet', 'low');
agent('quoted', '"fable"', "'low'");
agent('commented', 'fable # first pass', 'low # note');

function verdict(toolInput) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: toolInput, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  return { exit: r.status, stderr: r.stderr };
}

const cases = [
  ['no override on a fable agent', { subagent_type: 'reviewer', prompt: 'x' }, 0],
  ['fable agent, same-family alias override', { subagent_type: 'reviewer', model: 'fable', prompt: 'x' }, 0],
  ['fable agent, same-family full id override', { subagent_type: 'executor', model: 'claude-fable-5-1', prompt: 'x' }, 0],
  ['opus agent, same-family alias override', { subagent_type: 'verifier', model: 'opus', prompt: 'x' }, 0],
  ['opus agent, same-family full id override', { subagent_type: 'verifier', model: 'claude-opus-5-5', prompt: 'x' }, 0],
  ['fable agent on opus without effort', { subagent_type: 'reviewer', model: 'opus', prompt: 'x' }, 2],
  ['low fable agent, opus fallback with effort medium', { subagent_type: 'reviewer', model: 'opus', effort: 'medium', prompt: 'x' }, 0],
  ['low fable agent, opus full id fallback with effort medium', { subagent_type: 'executor', model: 'claude-opus-5-5', effort: 'medium', prompt: 'x' }, 0],
  ['-deep fable agent, opus fallback with effort xhigh', { subagent_type: 'reviewer-deep', model: 'opus', effort: 'xhigh', prompt: 'x' }, 0],
  ['low fable agent, opus fallback with the -deep effort', { subagent_type: 'reviewer', model: 'opus', effort: 'xhigh', prompt: 'x' }, 2],
  ['low fable agent, opus fallback keeping its own effort', { subagent_type: 'reviewer', model: 'opus', effort: 'low', prompt: 'x' }, 2],
  ['-deep fable agent, opus fallback with effort medium', { subagent_type: 'reviewer-deep', model: 'opus', effort: 'medium', prompt: 'x' }, 2],
  ['fable agent with no effort in its file, opus fallback', { subagent_type: 'legacy', model: 'opus', effort: 'medium', prompt: 'x' }, 2],
  ['opus fallback with a non-string effort', { subagent_type: 'reviewer', model: 'opus', effort: ['medium'], prompt: 'x' }, 2],
  ['fable agent downgraded to sonnet', { subagent_type: 'executor', model: 'sonnet', prompt: 'x' }, 2],
  ['fable agent, sonnet with the mapped effort', { subagent_type: 'reviewer', model: 'sonnet', effort: 'medium', prompt: 'x' }, 2],
  ['fable agent, haiku with the mapped effort', { subagent_type: 'reviewer', model: 'haiku', effort: 'medium', prompt: 'x' }, 2],
  ['opus agent switched to fable', { subagent_type: 'verifier', model: 'fable', prompt: 'x' }, 2],
  ['opus agent, sonnet with an effort', { subagent_type: 'verifier', model: 'sonnet', effort: 'medium', prompt: 'x' }, 2],
  ['haiku agent upgraded to fable', { subagent_type: 'explorer', model: 'fable', prompt: 'x' }, 2],
  ['haiku agent upgraded via full id', { subagent_type: 'explorer', model: 'claude-opus-5-5', prompt: 'x' }, 2],
  ['haiku agent, opus with effort medium', { subagent_type: 'explorer', model: 'opus', effort: 'medium', prompt: 'x' }, 2],
  ['haiku agent that carries an effort, opus with the mapped effort', { subagent_type: 'cheap', model: 'opus', effort: 'medium', prompt: 'x' }, 2],
  ['sonnet agent, opus with the mapped effort', { subagent_type: 'steady', model: 'opus', effort: 'medium', prompt: 'x' }, 2],
  ['inherit on a pinned agent', { subagent_type: 'reviewer', model: 'inherit', prompt: 'x' }, 2],

  ['no model, effort differs from the pinned one', { subagent_type: 'reviewer', effort: 'xhigh', prompt: 'x' }, 2],
  ['no model, effort equal to the pinned one', { subagent_type: 'reviewer', effort: 'low', prompt: 'x' }, 0],
  ['effort compared case-insensitively', { subagent_type: 'reviewer', effort: 'LOW', prompt: 'x' }, 0],
  ['same-family override with a different effort', { subagent_type: 'verifier', model: 'opus', effort: 'xhigh', prompt: 'x' }, 2],
  ['same-family override with the pinned effort', { subagent_type: 'verifier', model: 'opus', effort: 'medium', prompt: 'x' }, 0],
  ['haiku agent given an effort', { subagent_type: 'explorer', effort: 'low', prompt: 'x' }, 2],
  ['haiku agent given its model and an effort', { subagent_type: 'explorer', model: 'haiku', effort: 'low', prompt: 'x' }, 2],
  ['non-string effort without a model', { subagent_type: 'reviewer', effort: ['low'], prompt: 'x' }, 2],
  ['empty effort counts as not given', { subagent_type: 'reviewer', effort: '', prompt: 'x' }, 0],

  ['quoted frontmatter model still pins the tier', { subagent_type: 'quoted', model: 'sonnet', prompt: 'x' }, 2],
  ['quoted frontmatter: opus fallback with the mapped effort', { subagent_type: 'quoted', model: 'opus', effort: 'medium', prompt: 'x' }, 0],
  ['quoted frontmatter effort still pins', { subagent_type: 'quoted', effort: 'xhigh', prompt: 'x' }, 2],
  ['frontmatter with trailing comments still pins', { subagent_type: 'commented', model: 'sonnet', prompt: 'x' }, 2],
  ['frontmatter with trailing comments, pinned effort', { subagent_type: 'commented', effort: 'low', prompt: 'x' }, 0],

  ['built-in agent, no override', { subagent_type: 'general-purpose', prompt: 'x' }, 0],
  ['built-in agent, fable override', { subagent_type: 'general-purpose', model: 'claude-fable-5-1', prompt: 'x' }, 0],
  ['built-in agent, non-fable override', { subagent_type: 'Explore', model: 'haiku', prompt: 'x' }, 0],
  ['built-in agent, any effort', { subagent_type: 'general-purpose', effort: 'xhigh', prompt: 'x' }, 0],
  ['built-in agent, model and effort', { subagent_type: 'Explore', model: 'haiku', effort: 'low', prompt: 'x' }, 0],
  ['no subagent_type', { prompt: 'x' }, 0],
  ['no subagent_type, any effort', { effort: 'xhigh', prompt: 'x' }, 0],
  ['path-traversal agent name is ignored', { subagent_type: '../../etc/passwd', model: 'opus', prompt: 'x' }, 0],
  ['path-traversal agent name is ignored, any effort', { subagent_type: '../../etc/passwd', effort: 'xhigh', prompt: 'x' }, 0],
];

for (const [name, input, exit] of cases) {
  test(name, () => {
    const r = verdict(input);
    assert.strictEqual(r.exit, exit, r.stderr);
    if (exit === 2) assert.match(r.stderr, /BLOCKED/);
  });
}

test('malformed stdin fails open', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});
