#!/usr/bin/env node
// PreToolUse hook: agents never write the owner switch files .claude/env-copy.json and .claude/fable-mode.json
// (CLAUDE.md §0 Env copy, §2 Fable mode). Turning a switch ON is the owner's own "/env-copy on" / "/fable on"
// (owner-mode-on.js); turning it OFF goes through the scripts, whose commands never name these files.
//   - Write / Edit / MultiEdit / NotebookEdit: denied when the target's file name is one of the two.
//   - Bash / PowerShell: denied when the command text names either file at all (read, write, delete alike;
//     the scripts' status / off subcommands are the way to see or clear a switch).
//   - CronCreate / ScheduleWakeup / RemoteTrigger / SendMessage / mcp__scheduled-tasks__* / mcp__ccd_session__* /
//     mcp__ccd_session_mgmt__*: denied when any string in the input holds "/env-copy on" or "/fable on"
//     (any case, any spacing), or when the input is too deep / large to walk (fail closed).
// Residual (string matching only): a command that builds the name at run time (string concatenation,
// variables, base64, a script file that writes it) is not caught. That gap is documented, not chased.
// Input: hook event JSON on stdin. Output: deny -> message on stderr + exit 2; otherwise exit 0.

const NAMES = ['env-copy.json', 'fable-mode.json'];
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];
const PROMPT_TOOLS = /^(CronCreate|ScheduleWakeup|RemoteTrigger|SendMessage|mcp__scheduled-tasks__.+|mcp__ccd_session__.+|mcp__ccd_session_mgmt__.+)$/;
const OWNER_ON = /\/\s*(env-copy|fable)\s+on\b/i;
const WALK_MAX_DEPTH = 32;
const WALK_MAX_NODES = 10000;

function verdict(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const tool = payload.tool_name;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (FILE_TOOLS.includes(tool)) {
    for (const key of ['file_path', 'notebook_path']) {
      const p = input[key];
      if (typeof p !== 'string') continue;
      const base = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().trim().toLowerCase();
      const hit = NAMES.find((n) => base === n);
      if (hit) return hit;
    }
    return null;
  }
  if (SHELL_TOOLS.includes(tool) && typeof input.command === 'string') {
    const text = input.command.toLowerCase();
    return NAMES.find((n) => text.includes(n)) || null;
  }
  if (typeof tool === 'string' && PROMPT_TOOLS.test(tool)) return plantedOn(payload.tool_input);
  return null;
}

// A queued prompt (scheduled task, wake-up, remote trigger, message to another session) must not carry an
// owner command: it would reach UserPromptExpansion as if typed. Walk every string with a depth / node cap;
// anything too big to walk is denied (fail closed).
function plantedOn(value) {
  const stack = [[value, 0]];
  let seen = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++seen > WALK_MAX_NODES || depth > WALK_MAX_DEPTH) return 'a tool input too large or deep to inspect';
    if (typeof v === 'string') {
      if (OWNER_ON.test(v)) return 'an owner-only "/env-copy on" or "/fable on" prompt';
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
    const what = NAMES.includes(hit)
      ? `${hit} is an owner switch file; agents may not create, write, read or delete it directly. `
      : `this tool call carries ${hit}; agents may not queue or send a prompt that turns a switch on. `;
    console.error(
      `BLOCKED: ${what}` +
        'Only the owner turns a switch on, by typing "/env-copy on" or "/fable on" themselves. ' +
        'To see or turn one off, run the script with status / off (node "<root>/.claude/scripts/env-copy.mjs" off, ' +
        'node "<root>/.claude/scripts/fable-mode.mjs" off).'
    );
    process.exit(2);
  }
  process.exit(0);
});
