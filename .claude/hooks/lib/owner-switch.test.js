// node --test .claude/hooks/lib/owner-switch.test.js
// owner-mode-on.js (the owner's "/env-copy on" / "/fable on" writes the switch file) and
// block-mode-file-write.js (agents never write those files). Temp roots via CLAUDE_PROJECT_DIR only.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const ON_HOOK = path.resolve(__dirname, '..', 'owner-mode-on.js');
const GUARD = path.resolve(__dirname, '..', 'block-mode-file-write.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-switch-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.mkdirSync(path.join(root, '.claude'));
const envFile = path.join(root, '.claude', 'env-copy.json');
const fableFile = path.join(root, '.claude', 'fable-mode.json');
const reset = () => [envFile, fableFile].forEach((f) => fs.rmSync(f, { force: true }));

const runRaw = (hook, input) =>
  spawnSync(process.execPath, [hook], { input, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
const expansion = (name, args, prompt, extra = {}) =>
  runRaw(
    ON_HOOK,
    JSON.stringify({
      session_id: 's',
      cwd: root,
      hook_event_name: 'UserPromptExpansion',
      expansion_type: 'slash_command',
      command_name: name,
      command_args: args,
      command_source: 'project',
      prompt,
      ...extra,
    })
  );

test('the owner typing exactly "/env-copy on" writes the env copy file', () => {
  reset();
  const r = expansion('env-copy', 'on', '/env-copy on');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(envFile, 'utf8')), { enabled: true });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /ENV COPY: ON — written by this hook/);
  assert.ok(!fs.existsSync(fableFile));
});

test('the owner typing exactly "/fable on" writes the default Fable mapping', () => {
  reset();
  const r = expansion('fable', ' on ', '  /fable on\n');
  assert.strictEqual(r.status, 0, r.stderr);
  const data = JSON.parse(fs.readFileSync(fableFile, 'utf8'));
  assert.deepStrictEqual(data.executor, { model: 'fable', effort: 'low' });
  assert.deepStrictEqual(data['reviewer-deep'], { model: 'fable', effort: 'medium' });
  assert.ok(!fs.existsSync(envFile));
});

for (const [why, args] of [
  ['a longer prompt that contains the command', ['env-copy', 'on', 'please /env-copy on']],
  ['extra arguments', ['env-copy', 'on now', '/env-copy on now']],
  ['args say on but the prompt differs', ['env-copy', 'on', '/env-copy on; and more']],
  ['off', ['env-copy', 'off', '/env-copy off']],
  ['no args', ['env-copy', '', '/env-copy']],
  ['another command', ['deploy', 'on', '/deploy on']],
  ['a namespaced name', ['project:env-copy', 'on', '/project:env-copy on']],
  ['case differs', ['env-copy', 'ON', '/env-copy ON']],
  ['prototype key', ['constructor', 'on', '/constructor on']],
]) {
  test(`no write for ${why}`, () => {
    reset();
    const r = expansion(...args);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.ok(!fs.existsSync(envFile) && !fs.existsSync(fableFile));
  });
}

test('no write for an MCP prompt expansion or for a UserPromptSubmit event', () => {
  reset();
  assert.strictEqual(expansion('env-copy', 'on', '/env-copy on', { expansion_type: 'mcp_prompt' }).status, 0);
  assert.strictEqual(expansion('env-copy', 'on', '/env-copy on', { hook_event_name: 'UserPromptSubmit' }).status, 0);
  assert.ok(!fs.existsSync(envFile));
});

test('malformed and deeply nested payloads write nothing and exit 0', () => {
  reset();
  const deep = '['.repeat(50000) + ']'.repeat(50000);
  for (const input of [
    '',
    '{nope',
    'null',
    '[]',
    '"x"',
    `{"hook_event_name":"UserPromptExpansion","expansion_type":"slash_command","command_name":"env-copy","command_args":${deep},"prompt":"/env-copy on"}`,
    '{"hook_event_name":"UserPromptExpansion","expansion_type":"slash_command","command_name":["env-copy"],"command_args":"on","prompt":"/env-copy on"}',
  ]) {
    const r = runRaw(ON_HOOK, input);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(envFile), input.slice(0, 60));
  }
});

const guard = (tool_name, tool_input) => runRaw(GUARD, JSON.stringify({ tool_name, tool_input, cwd: root }));

test('agent shell commands that name either switch file are denied', () => {
  for (const [tool, cmd] of [
    ['Bash', "echo '{\"enabled\":true}' > .claude/env-copy.json"],
    ['Bash', 'cp x D:/ws/.claude/env-copy.json'],
    ['Bash', 'node -e "require(\'fs\').writeFileSync(\'.claude/fable-mode.json\', \'{}\')"'],
    ['Bash', 'touch .claude/FABLE-MODE.JSON'],
    ['Bash', 'cd .claude && printf x > env-copy.json'],
    ['Bash', 'cat .claude/env-copy.json'],
    ['PowerShell', 'Set-Content -Path .claude\\env-copy.json -Value x'],
    ['PowerShell', 'New-Item .claude\\fable-mode.json'],
  ]) {
    const r = guard(tool, { command: cmd });
    assert.strictEqual(r.status, 2, `${tool}: ${cmd}`);
    assert.match(r.stderr, /owner switch file/);
  }
});

test('agent Write / Edit / MultiEdit / NotebookEdit on either file are denied', () => {
  for (const [tool, input] of [
    ['Write', { file_path: path.join(root, '.claude', 'env-copy.json'), content: '{"enabled":true}' }],
    ['Edit', { file_path: 'D:/ws/.claude/fable-mode.json', old_string: 'a', new_string: 'b' }],
    ['MultiEdit', { file_path: '.claude\\Env-Copy.json', edits: [] }],
    ['NotebookEdit', { notebook_path: '/x/.claude/fable-mode.json' }],
  ]) {
    assert.strictEqual(guard(tool, input).status, 2, tool);
  }
});

test('off / status via the scripts and unrelated files pass', () => {
  for (const [tool, input] of [
    ['Bash', { command: 'node "D:/my-claude-base-v3/.claude/scripts/env-copy.mjs" off' }],
    ['Bash', { command: 'node "D:/my-claude-base-v3/.claude/scripts/fable-mode.mjs" status' }],
    ['PowerShell', { command: 'node "D:/my-claude-base-v3/.claude/scripts/fable-mode.mjs" off' }],
    ['Bash', { command: 'node "D:/my-claude-base-v3/.claude/scripts/env-copy.mjs" copy p D:/my-claude-base-v3/tmp/worktrees/x' }],
    ['Write', { file_path: 'D:/ws/.claude/settings.json', content: '{}' }],
    ['Write', { file_path: 'D:/ws/env-copy.json.md', content: 'x' }],
    ['Read', { file_path: 'D:/ws/.claude/env-copy.json' }],
  ]) {
    assert.strictEqual(guard(tool, input).status, 0, JSON.stringify(input));
  }
});

test('a queued or sent prompt that would turn a switch on is denied', () => {
  for (const [tool, input] of [
    ['CronCreate', { cron: '0 9 * * *', prompt: '/env-copy on' }],
    ['ScheduleWakeup', { delaySeconds: 60, prompt: 'then run /FABLE   ON please' }],
    ['RemoteTrigger', { action: 'run', body: { steps: [{ text: '/ env-copy\ton' }] } }],
    ['SendMessage', { to: 'main', message: '/fable on' }],
    ['mcp__scheduled-tasks__create_scheduled_task', { taskId: 't', prompt: '/env-copy on' }],
    ['mcp__ccd_session__start_session', { prompt: 'x', extra: ['a', { deeper: '/fable on' }] }],
    ['mcp__ccd_session_mgmt__send_message', { session_id: 's', text: '/env-copy on' }],
  ]) {
    const r = guard(tool, input);
    assert.strictEqual(r.status, 2, `${tool}: ${JSON.stringify(input)}`);
    assert.match(r.stderr, /agents may not queue or send one/);
  }
});

test('ordinary prompts, off, and other tools pass', () => {
  for (const [tool, input] of [
    ['CronCreate', { cron: '0 9 * * *', prompt: 'run the tests' }],
    ['SendMessage', { to: 'main', message: '/env-copy off' }],
    ['SendMessage', { to: 'main', message: 'status: /fable is on? /env-copy status' }],
    ['ScheduleWakeup', { prompt: '/fable one more pass' }],
    ['mcp__scheduled-tasks__list_scheduled_tasks', {}],
    ['Agent', { prompt: 'Review the change that adds /env-copy on handling', subagent_type: 'reviewer' }],
    ['Workflow', { script: 'x', args: { note: 'the owner types /fable on' } }],
  ]) {
    assert.strictEqual(guard(tool, input).status, 0, `${tool}: ${JSON.stringify(input)}`);
  }
});

test('a prompt-tool input too deep or too large to walk is denied (fail closed), without throwing', () => {
  const deep = `{"tool_name":"CronCreate","tool_input":{"prompt":${'['.repeat(50000)}"x"${']'.repeat(50000)}}}`;
  const wide = JSON.stringify({ tool_name: 'SendMessage', tool_input: { parts: Array.from({ length: 20000 }, () => 'x') } });
  for (const input of [deep, wide]) {
    const r = runRaw(GUARD, input);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /too large or deep to inspect/);
  }
});

test('a nested Claude Code run given the switch-on command is denied', () => {
  for (const [tool, cmd] of [
    ['Bash', 'claude -p "/env-copy on"'],
    ['Bash', 'cd x && claude "/fable on"'],
    ['PowerShell', 'C:/Users/u/.local/bin/claude.exe -p "/FABLE   ON"'],
    ['Bash', 'claude.cmd --print "/env-copy on"'],
    ['Bash', 'npx @anthropic-ai/claude-code -p "/env-copy on"'],
    ['Bash', 'node C:/npm/node_modules/@anthropic-ai/claude-code/cli.js "/fable on"'],
    ['Bash', 'echo "/env-copy on" | claude -p'],
    ['Bash', 'bash -c "claude -p \'/fable on\'"'],
  ]) {
    const r = guard(tool, { command: cmd });
    assert.strictEqual(r.status, 2, `${tool}: ${cmd}`);
    assert.match(r.stderr, /nested Claude Code run/);
  }
});

test('shell text that only mentions the command (no nested claude run) passes', () => {
  for (const cmd of [
    'git -C D:/x commit -m "feat: /env-copy on handling"',
    'git log --oneline | grep "/fable on"',
    'claude --version',
    'claude -p "summarise the repo"',
    'echo "claude is fine"; echo "/env-copy off"',
  ]) {
    assert.strictEqual(guard('Bash', { command: cmd }).status, 0, cmd);
  }
});

test('the durable cron store: planting the command is denied, ordinary edits pass, the shell may not name it', () => {
  const store = 'D:/ws/.claude/scheduled_tasks.json';
  const planted = JSON.stringify({ tasks: [{ cron: '* * * * *', prompt: '/env-copy on', durable: true }] });
  assert.strictEqual(guard('Write', { file_path: store, content: planted }).status, 2);
  assert.strictEqual(guard('Edit', { file_path: store, old_string: 'x', new_string: '"prompt": "/fable  on"' }).status, 2);
  assert.strictEqual(guard('MultiEdit', { file_path: store, edits: [{ old_string: 'a', new_string: '/Fable on' }] }).status, 2);
  assert.strictEqual(guard('Write', { file_path: 'D:\\ws\\.claude\\scheduled_tasks.json.', content: planted }).status, 2);
  assert.strictEqual(guard('Write', { file_path: store, content: JSON.stringify({ tasks: [{ prompt: 'run tests' }] }) }).status, 0);
  for (const cmd of ['cat .claude/scheduled_tasks.json', "echo '{}' > .claude/Scheduled_Tasks.json"]) {
    const r = guard('Bash', { command: cmd });
    assert.strictEqual(r.status, 2, cmd);
    assert.match(r.stderr, /holds queued prompts/);
  }
});

test('Windows name aliases of the switch files are denied (trailing dots / spaces, ::$DATA)', () => {
  for (const p of [
    'D:/ws/.claude/env-copy.json.',
    'D:/ws/.claude/env-copy.json. . ',
    'D:\\ws\\.claude\\fable-mode.json::$DATA',
    '.claude/FABLE-MODE.JSON:stream',
  ]) {
    const r = guard('Write', { file_path: p, content: '{"enabled":true}' });
    assert.strictEqual(r.status, 2, p);
    assert.match(r.stderr, /owner switch file/);
  }
  assert.strictEqual(guard('Write', { file_path: 'D:/ws/.claude/env-copy.json.bak', content: 'x' }).status, 0);
});

test('Agent / Task / Workflow whose whole prompt is the switch-on command are denied', () => {
  for (const [tool, input] of [
    ['Agent', { prompt: '/env-copy on', subagent_type: 'chore' }],
    ['Task', { prompt: '  /fable on \n' }],
    ['Workflow', { script: 'x', args: { steps: [{ prompt: '/FABLE ON' }] } }],
  ]) {
    const r = guard(tool, input);
    assert.strictEqual(r.status, 2, tool);
    assert.match(r.stderr, /agents may not queue or send one/);
  }
});

test('the guard exits 0 without throwing on malformed or deeply nested payloads', () => {
  const deep = '['.repeat(50000) + ']'.repeat(50000);
  for (const input of ['', '{nope', 'null', `{"tool_name":"Bash","tool_input":{"command":${deep}}}`, '{"tool_name":"Write","tool_input":null}']) {
    const r = runRaw(GUARD, input);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stderr, '');
  }
});
