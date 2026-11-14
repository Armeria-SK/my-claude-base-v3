#!/usr/bin/env node
// PreToolUse hook: agents never write the owner switch files .claude/env-copy.json and .claude/fable-mode.json
// (CLAUDE.md §0 Env copy, §2 Fable mode). Turning a switch ON is the owner's own "/env-copy on" / "/fable on"
// (owner-mode-on.js); turning it OFF goes through the scripts, whose commands never name these files.
//   - Write / Edit / MultiEdit / NotebookEdit: denied when the target's file name is one of the two switch files.
//   - Bash / PowerShell: denied when the command text names either file at all (read, write, delete alike;
//     the scripts' status / off subcommands are the way to see or clear a switch).
//   - CronCreate / ScheduleWakeup / RemoteTrigger / SendMessage / mcp__scheduled-tasks__* / mcp__ccd_session__* /
//     mcp__ccd_session_mgmt__*: denied when any string in the input holds "/env-copy on" or "/fable on"
//     (any case, any spacing), or when the input is too deep / large to walk (fail closed).
//   - Agent / Task / Workflow: denied when any input string is, as a whole, "/env-copy on" or "/fable on".
//   - .claude/scheduled_tasks.json (the durable cron store, read back as typed prompts): a Write / Edit that puts
//     the command in it is denied, and any shell command naming the file is denied.
//   - A nested Claude Code run from the shell (claude / claude.exe, npx @anthropic-ai/claude-code, node <cli>):
//     denied when the command text holds the switch-on command (the pattern is applied only when such a run is in it).
//   - File names are compared as Windows opens them: cut at the first ":" ("::$DATA"), trailing dots / spaces dropped.
// Residual (string matching only): a command that builds the name at run time (string concatenation,
// variables, base64, a script file that writes it) is not caught. That gap is documented, not chased.
// Input: hook event JSON on stdin. Output: deny -> message on stderr + exit 2; otherwise exit 0.

const { segments } = require('./lib/parse-cmd');

const NAMES = ['env-copy.json', 'fable-mode.json'];
const CRON_STORE = 'scheduled_tasks.json';
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];
const PROMPT_TOOLS = /^(CronCreate|ScheduleWakeup|RemoteTrigger|SendMessage|mcp__scheduled-tasks__.+|mcp__ccd_session__.+|mcp__ccd_session_mgmt__.+)$/;
const DISPATCH_TOOLS = ['Agent', 'Task', 'Workflow'];
const OWNER_ON = /\/\s*(env-copy|fable)\s+on\b/i;
const OWNER_ON_WHOLE = /^\s*\/\s*(env-copy|fable)\s+on\s*$/i;
const WALK_MAX_DEPTH = 32;
const WALK_MAX_NODES = 10000;
const PLANTED = 'a queued or sent prompt that would turn a switch on ("/env-copy on" or "/fable on"); agents may not queue or send one';

// Windows treats "x.json." / "x.json " / "x.json::$DATA" as x.json, so compare the name Windows would open.
const baseName = (p) =>
  p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().split(':')[0].replace(/[. ]+$/, '').trim().toLowerCase();

// A nested Claude Code run (claude / claude.exe, npx @anthropic-ai/claude-code, node .../claude-code/cli.js).
const isClaude = ({ cmd, args }) =>
  cmd === 'claude' ||
  (['npx', 'bunx', 'pnpx'].includes(cmd) && args.some((a) => /claude-code|^claude$/i.test(a))) ||
  (cmd === 'node' && typeof args[0] === 'string' && /claude-code|[\\/]claude(\.m?js)?$/i.test(args[0]));

function verdict(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const tool = payload.tool_name;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (FILE_TOOLS.includes(tool)) {
    for (const key of ['file_path', 'notebook_path']) {
      if (typeof input[key] !== 'string') continue;
      const base = baseName(input[key]);
      if (NAMES.includes(base)) return `${base} is an owner switch file; agents may not create, write, read or delete it directly`;
      if (base === CRON_STORE) return plantedOn(input, OWNER_ON);
    }
    return null;
  }
  if (SHELL_TOOLS.includes(tool) && typeof input.command === 'string') {
    const text = input.command.toLowerCase();
    const named = NAMES.find((n) => text.includes(n));
    if (named) return `${named} is an owner switch file; agents may not create, write, read or delete it directly`;
    if (text.includes(CRON_STORE)) return `${CRON_STORE} holds queued prompts; agents may not touch it from the shell`;
    let nested = false;
    try {
      nested = segments(input.command).some(isClaude);
    } catch {
      nested = /\bclaude\b/i.test(input.command);
    }
    return nested && OWNER_ON.test(input.command) ? 'a nested Claude Code run given "/env-copy on" or "/fable on"; agents may not start one' : null;
  }
  if (typeof tool === 'string' && PROMPT_TOOLS.test(tool)) return plantedOn(payload.tool_input, OWNER_ON);
  if (DISPATCH_TOOLS.includes(tool)) return plantedOn(payload.tool_input, OWNER_ON_WHOLE);
  return null;
}

// A queued prompt (scheduled task, wake-up, remote trigger, message to another session, the durable cron
// store, a dispatch whose whole prompt is the command) must not carry an owner command: it would reach
// UserPromptExpansion as if typed. Walk every string with a depth / node cap; anything too big to walk is
// denied (fail closed).
function plantedOn(value, pattern) {
  const stack = [[value, 0]];
  let seen = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++seen > WALK_MAX_NODES || depth > WALK_MAX_DEPTH) return 'a tool input too large or deep to inspect';
    if (typeof v === 'string') {
      if (pattern.test(v)) return PLANTED;
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) stack.push([v[k], depth + 1]);
    }
  }
  return null;
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let hit = null;
  try {
    hit = verdict(JSON.parse(data));
  } catch {
    process.exit(0);
  }
  if (hit) {
    console.error(
      `BLOCKED: ${hit}. ` +
        'Only the owner turns a switch on, by typing "/env-copy on" or "/fable on" themselves. ' +
        'To see or turn one off, run the script with status / off (node "<root>/.claude/scripts/env-copy.mjs" off, ' +
        'node "<root>/.claude/scripts/fable-mode.mjs" off).'
    );
    process.exit(2);
  }
  process.exit(0);
});
