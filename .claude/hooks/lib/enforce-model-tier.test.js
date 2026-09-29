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
const agent = (name, model) =>
  fs.writeFileSync(path.join(root, '.claude', 'agents', `${name}.md`), `---\r\nname: ${name}\r\nmodel: ${model}\r\n---\r\nbody\r\n`);
agent('reviewer', 'opus');
agent('executor', 'sonnet');
agent('explorer', 'haiku');
agent('rogue', 'fable');

function verdict(toolInput) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: toolInput, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  return { exit: r.status, stderr: r.stderr };
}

const cases = [
  ['no override on a pinned agent', { subagent_type: 'reviewer', prompt: 'x' }, 0],
  ['same-family alias override', { subagent_type: 'reviewer', model: 'opus', prompt: 'x' }, 0],
  ['same-family full id override', { subagent_type: 'executor', model: 'claude-sonnet-5-5', prompt: 'x' }, 0],
  ['reviewer downgraded to sonnet', { subagent_type: 'reviewer', model: 'sonnet', prompt: 'x' }, 2],
  ['executor upgraded to opus', { subagent_type: 'executor', model: 'opus', prompt: 'x' }, 2],
  ['explorer upgraded via full id', { subagent_type: 'explorer', model: 'claude-opus-5-5', prompt: 'x' }, 2],
  ['inherit on a pinned agent', { subagent_type: 'reviewer', model: 'inherit', prompt: 'x' }, 2],
  ['fable requested explicitly', { subagent_type: 'reviewer', model: 'fable', prompt: 'x' }, 2],
  ['fable via full id', { subagent_type: 'general-purpose', model: 'claude-fable-5-1', prompt: 'x' }, 2],
  ['agent file itself pinned to fable', { subagent_type: 'rogue', prompt: 'x' }, 2],
  ['built-in agent, no override', { subagent_type: 'general-purpose', prompt: 'x' }, 0],
  ['built-in agent, non-fable override', { subagent_type: 'Explore', model: 'haiku', prompt: 'x' }, 0],
  ['no subagent_type', { prompt: 'x' }, 0],
  ['path-traversal agent name is ignored', { subagent_type: '../../etc/passwd', model: 'opus', prompt: 'x' }, 0],
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
