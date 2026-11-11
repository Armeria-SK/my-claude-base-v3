#!/usr/bin/env node
// PreToolUse hook (Task|Agent): keep every dispatch on the model tier and effort its agent file declares.
//
// The tier is written once, in each agent's frontmatter `model:` (fable / opus / haiku) and `effort:`.
// A per-dispatch `model` or `effort` parameter beats frontmatter, so those are the ways a tier can be
// silently bypassed — e.g. sending `reviewer` (fable) to opus, `verifier` (opus) to fable, or
// `reviewer` at effort xhigh.
//
// Denies (exit 2, message on stderr):
//   - a `model` override whose family differs from the agent's frontmatter family
//   - an `effort` that is not a string equal to the agent's frontmatter effort (an agent with no
//     frontmatter effort, e.g. haiku, accepts none)
// One exception, the usage-limit fallback (CLAUDE.md §2): a fable agent may be dispatched on opus
// when the dispatch also carries the mapped `effort` (agent effort low -> medium, medium -> xhigh).
// A missing or different effort is denied, as is every other family pair.
// Allows everything else: no `model` / `effort` given, same family and same effort, built-in agent
// types without a definition in .claude/agents/ (nothing to compare against).
//
// Input: Claude Code hook event JSON on stdin. Fail-open on malformed input.

const fs = require('node:fs');
const path = require('node:path');

const family = (m) => {
  const s = String(m || '').toLowerCase();
  return ['fable', 'opus', 'sonnet', 'haiku'].find((f) => s.includes(f)) || (s === 'inherit' ? 'inherit' : '');
};

const FALLBACK_EFFORT = { low: 'medium', medium: 'xhigh' };

// Frontmatter `key: value` pairs of an agent definition, or null when there is no such file.
// Values are read as validate.mjs reads them (surrounding quotes stripped), plus a trailing `# comment`.
function readFrontmatter(root, agentType) {
  if (!/^[\w-]+$/.test(agentType || '')) return null;
  try {
    const text = fs.readFileSync(path.join(root, '.claude', 'agents', `${agentType}.md`), 'utf8');
    const block = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    const fm = {};
    for (const line of block ? block[1].split('\n') : []) {
      const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
    }
    return fm;
  } catch {
    return null;
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

  const root = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  const fm = readFrontmatter(root, input.subagent_type);
  const declared = family(fm && fm.model);
  const declaredEffort = String((fm && fm.effort) || '').toLowerCase();
  const requested = family(input.model);
  const effortGiven = input.effort != null && input.effort !== '';
  const effort = typeof input.effort === 'string' ? input.effort.toLowerCase() : null;

  const crossFamily = input.model && declared && declared !== 'inherit' && requested !== declared;
  if (crossFamily && requested === 'opus' && declared === 'fable') {
    const want = FALLBACK_EFFORT[declaredEffort];
    if (want && effort === want) process.exit(0);
    process.stderr.write(
      `BLOCKED: the opus fallback for fable agent "${input.subagent_type}" must carry effort="${want || '(none: add the agent\'s effort to FALLBACK_EFFORT)'}" ` +
      '(CLAUDE.md §2, usage-limit fallback).\n'
    );
    process.exit(2);
  }
  if (crossFamily) {
    process.stderr.write(
      `BLOCKED: agent "${input.subagent_type}" is pinned to ${declared} in its frontmatter; ` +
      `a per-dispatch model="${input.model}" would bypass the tier. Drop the model parameter ` +
      '(CLAUDE.md §2). To change a tier, edit the agent file.\n'
    );
    process.exit(2);
  }
  if (fm && effortGiven && effort !== declaredEffort) {
    process.stderr.write(
      `BLOCKED: agent "${input.subagent_type}" is pinned to effort ${declaredEffort || '(none)'} in its frontmatter; ` +
      `a per-dispatch effort=${JSON.stringify(input.effort)} would bypass the tier. Drop the effort parameter ` +
      '(CLAUDE.md §2); the only exception is the usage-limit fallback.\n'
    );
    process.exit(2);
  }
  process.exit(0);
});
