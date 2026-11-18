#!/usr/bin/env node
// Stop hook (on trial): notice a reply to the owner that drifted into English.
// Input:  Claude Code Stop event JSON on stdin; the mode is the first argument of the wired command:
//           observe  never blocks; appends one line per flagged reply to the log
//           enforce  also returns {"decision":"block","reason":...} once per stop chain
//           off / missing / anything else  does nothing
// Output: always exit 0. Nothing on stdout except the enforce block decision.
//
// Checked against https://code.claude.com/docs/en/hooks.md (Stop), 2026-11-18:
//   - `last_assistant_message` is the text of the final reply; `stop_hook_active` is true when
//     Claude Code is already continuing because of a stop hook.
//   - `decision: "block"` + `reason` makes Claude continue; Claude Code ends the turn anyway after
//     8 consecutive continuations. This hook never blocks when `stop_hook_active` is true, so it
//     blocks at most once per chain and does not rely on that cap.
//   - Stop fires for the main conversation only (subagents fire SubagentStop, not wired), not on a
//     user interrupt, and not on an API error (StopFailure).
//
// Judgment: fenced code, inline code, URLs and file paths are removed, then letters are counted.
// Drift = at least MIN_LETTERS letters remain and fewer than MIN_JAPANESE_SHARE of them are
// hiragana / katakana / kanji.
//
// Log: <CLAUDE_PROJECT_DIR>/tasks/reply-language-log.jsonl, flagged replies only, at most
// LOG_MAX_LINES lines. The root is the CLAUDE_PROJECT_DIR environment variable only — never the
// payload's cwd, which follows `cd` and would put the log inside a product repo. No variable -> no log.
//
// Fail-open: unreadable stdin, a missing field, an unwritable log, any exception -> exit 0, no block.
//
// Known limits: a drifted reply under MIN_LETTERS letters is never flagged; an English reply the
// owner asked for is flagged (in enforce, whether it survives depends on the model following the
// exception in the reason); tool descriptions, agent task names and AskUserQuestion text are not
// seen; Chinese text counts as Japanese (kanji); the line cap is checked and then appended without
// a lock, so two sessions stopping at the same moment can exceed it by a line.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIN_LETTERS = 200;
const MIN_JAPANESE_SHARE = 0.2;
const LOG_MAX_LINES = 500;
const LOG_HEAD_CHARS = 80;
const LOG_REL = path.join('tasks', 'reply-language-log.jsonl');

const BLOCK_REASON =
  '持ち主への返事が英語になっています。同じ内容を日本語で書き直してください（コード・識別子は英語のまま）。' +
  '持ち主が英語で頼んだ返事なら、そのまま出し直してください';

function judge(text) {
  const prose = String(text)
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:[A-Za-z]:)?[\w.~-]*[\\/][\w.~\\/-]*/g, ' ');
  const letters = (prose.match(/\p{L}/gu) || []).length;
  const japanese = (prose.match(/[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}]/gu) || []).filter((c) => /\p{L}/u.test(c)).length;
  const share = letters === 0 ? 1 : japanese / letters;
  return { letters, share, drift: letters >= MIN_LETTERS && share < MIN_JAPANESE_SHARE };
}

function appendLog(entry) {
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (!root) return;
  const file = path.join(root, LOG_REL);
  let lines = 0;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').length - 1;
  } catch {
    lines = 0;
  }
  if (lines >= LOG_MAX_LINES) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function main() {
  const mode = process.argv[2];
  if (mode !== 'observe' && mode !== 'enforce') return;
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  const text = payload.last_assistant_message;
  if (typeof text !== 'string') return;
  const verdict = judge(text);
  if (!verdict.drift) return;
  try {
    appendLog({
      time: new Date().toISOString(),
      session: typeof payload.session_id === 'string' ? payload.session_id : null,
      letters: verdict.letters,
      japaneseShare: Math.round(verdict.share * 1000) / 1000,
      mode,
      head: Array.from(text).slice(0, LOG_HEAD_CHARS).join(''),
    });
  } catch {
    /* the log is best-effort */
  }
  if (mode === 'enforce' && payload.stop_hook_active !== true) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: BLOCK_REASON }));
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    /* fail-open */
  }
  process.exitCode = 0;
}

module.exports = { judge, BLOCK_REASON, MIN_LETTERS, MIN_JAPANESE_SHARE, LOG_MAX_LINES };
