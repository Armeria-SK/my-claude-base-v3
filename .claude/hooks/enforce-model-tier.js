#!/usr/bin/env node
// PreToolUse hook (Task|Agent): keep every dispatch on the model tier its agent file declares.
//
// The tier is written once, in each agent's frontmatter `model:` (fable / opus / haiku).
// A per-dispatch `model` parameter beats frontmatter, so it is the one way a tier can be
// silently bypassed — e.g. sending `reviewer` (fable) to opus, or `verifier` (opus) to fable.
//
// Denies (exit 2, message on stderr):
//   - a `model` override whose family differs from the agent's frontmatter family
// One exception, the usage-limit fallback (CLAUDE.md §2): a fable agent may be dispatched on opus
// when the dispatch also carries the mapped `effort` (agent effort low -> medium, medium -> xhigh).
// A missing or different effort is denied, as is every other family pair.
// Allows everything else: no `model` given, same family (e.g. a full ID of the same family),
// built-in agent types without a definition in .claude/agents/ (nothing to compare against).
//
// Input: Claude Code hook event JSON on stdin. Fail-open on malformed input.

const fs = require('node:fs');
const path = require('node:path');

const family = (m) => {
  const s = String(m || '').toLowerCase();
  return ['fable', 'opus', 'sonnet', 'haiku'].find((f) => s.includes(f)) || (s === 'inherit' ? 'inherit' : '');
};

const FALLBACK_EFFORT = { low: 'medium', medium: 'xhigh' };

function frontmatterField(root, agentType, key) {
  if (!/^[\w-]+$/.test(agentType || '')) return '';
  try {
    const text = fs.readFileSync(path.join(root, '.claude', 'agents', `${agentType}.md`), 'utf8');
    const fm = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    const line = fm && fm[1].split('\n').find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).replace(/["'#].*$/, '').trim() : '';
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
  const declared = family(frontmatterField(root, input.subagent_type, 'model'));

  if (input.model && declared && declared !== 'inherit' && requested !== declared) {
    if (requested === 'opus' && declared === 'fable') {
      const want = FALLBACK_EFFORT[frontmatterField(root, input.subagent_type, 'effort')];
      if (want && String(input.effort || '').toLowerCase() === want) process.exit(0);
      process.stderr.write(
        `BLOCKED: the opus fallback for fable agent "${input.subagent_type}" must carry effort="${want || '(none: add the agent\'s effort to FALLBACK_EFFORT)'}" ` +
        '(CLAUDE.md §2, usage-limit fallback).\n'
      );
      process.exit(2);
    }
    process.stderr.write(
      `BLOCKED: agent "${input.subagent_type}" is pinned to ${declared} in its frontmatter; ` +
      `a per-dispatch model="${input.model}" would bypass the tier. Drop the model parameter ` +
      '(CLAUDE.md §2). To change a tier, edit the agent file.\n'
    );
    process.exit(2);
  }
  process.exit(0);
});
