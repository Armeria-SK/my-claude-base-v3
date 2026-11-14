#!/usr/bin/env node
// UserPromptExpansion hook: the only path that turns the owner switches ON (CLAUDE.md §0 Env copy,
// §2 Fable mode). When a "/env-copy on" or "/fable on" command expands, this hook writes the mode file
// itself; the scripts no longer accept "on". It checks expansion_type, command_name, command_args ("on"
// only) and the prompt; Claude Code rebuilds that prompt as "/<name> <args>", so this is a check on the
// expanded command, not on the raw text the owner typed (a line elsewhere in a stacked owner message that
// expands to the command also fires). The command files carry disable-model-invocation, which per the
// Claude Code docs refuses the model's own call and a scheduled-task fire of the command; the PreToolUse
// guard block-mode-file-write.js is the second layer. Never blocks; on doubt writes nothing.

const fs = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('./lib/journal-util');
const envCopy = require('./lib/env-copy-mode');
const fable = require('./lib/fable-mode');

const SWITCHES = {
  'env-copy': { file: envCopy.modeFile, body: () => envCopy.ON_JSON, label: 'ENV COPY' },
  fable: { file: fable.modeFile, body: () => fable.toJson(fable.DEFAULT_MAP), label: 'FABLE MODE' },
};

function ownerSwitch(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { hook_event_name: event, expansion_type: type, command_name: name, command_args: args, prompt } = payload;
  if (event !== 'UserPromptExpansion' || type !== 'slash_command') return null;
  if (typeof name !== 'string' || typeof args !== 'string' || typeof prompt !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(SWITCHES, name)) return null;
  if (args.trim() !== 'on' || prompt.trim() !== `/${name} on`) return null;
  return name;
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(data);
    const name = ownerSwitch(payload);
    if (name) {
      const s = SWITCHES[name];
      const root = projectRoot(payload);
      fs.writeFileSync(s.file(root), s.body());
      const where = path.join(root, '.claude').split(path.sep).join('/');
      const context = `${s.label}: ON — written by this hook for the owner's own "/${name} on" (in ${where}). Do not write the file yourself.`;
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptExpansion', additionalContext: context } }));
    }
  } catch {
    /* malformed payload or unwritable file: write nothing, never block the prompt */
  }
  process.exit(0);
});
