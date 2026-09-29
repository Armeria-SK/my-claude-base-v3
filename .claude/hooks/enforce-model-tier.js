#!/usr/bin/env node
// PreToolUse hook (Task|Agent): keep every dispatch on the model tier its agent file declares.
//
// The tier is written once, in each agent's frontmatter `model:` (opus / sonnet / haiku).
// A per-dispatch `model` parameter beats frontmatter, so it is the one way a tier can be
// silently bypassed — e.g. sending `reviewer` to sonnet, or any agent to fable.
//
// Denies (exit 2, message on stderr):
//   - any dispatch whose `model` resolves to fable (not part of this harness's tiers)
//   - a `model` override whose family differs from the agent's frontmatter family
// Allows everything else: no `model` given, same family (e.g. a full ID of the same family),
// built-in agent types without a definition in .claude/agents/ (only the fable rule applies).
//
// Input: Claude Code hook event JSON on stdin. Fail-open on malformed input.

const fs = require('node:fs');
const path = require('node:path');

const family = (m) => {
  const s = String(m || '').toLowerCase();
  return ['fable', 'opus', 'sonnet', 'haiku'].find((f) => s.includes(f)) || (s === 'inherit' ? 'inherit' : '');
};

function frontmatterModel(root, agentType) {
  if (!/^[\w-]+$/.test(agentType || '')) return '';
  try {
    const text = fs.readFileSync(path.join(root, '.claude', 'agents', `${agentType}.md`), 'utf8');
    const fm = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    const line = fm && fm[1].split('\n').find((l) => /^model:/.test(l));
    return line ? line.replace(/^model:\s*/, '').replace(/["'#].*$/, '').trim() : '';
  } catch {
    return '';
  }
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let input;
  let cwd;
  try {
    const payload = JSON.parse(data);
    input = payload.tool_input || {};
    cwd = payload.cwd;
  } catch {
    process.exit(0);
  }

  const requested = family(input.model);
  const root = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  const declared = family(frontmatterModel(root, input.subagent_type));

  if (requested === 'fable' || (!input.model && declared === 'fable')) {
    process.stderr.write(
      'BLOCKED: fable is not part of this harness\'s model tiers (opus / sonnet / haiku). ' +
      'Use the agent\'s own model — see CLAUDE.md §2.\n'
    );
    process.exit(2);
  }
  if (input.model && declared && declared !== 'inherit' && requested !== declared) {
    process.stderr.write(
      `BLOCKED: agent "${input.subagent_type}" is pinned to ${declared} in its frontmatter; ` +
      `a per-dispatch model="${input.model}" would bypass the tier. Drop the model parameter ` +
      '(CLAUDE.md §2). To change a tier, edit the agent file.\n'
    );
    process.exit(2);
  }
  process.exit(0);
});
