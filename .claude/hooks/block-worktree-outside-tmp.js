#!/usr/bin/env node
// PreToolUse hook: every git worktree lives under <workspace>/tmp/worktrees/ (CLAUDE.md §0, user ruling
// 2026-10-29) -- for this repo and for every dev/<product>/ repo. Worktrees created elsewhere (the session
// scratchpad, a sibling folder) are outside the workspace, so the cleanup hooks never saw them and they piled up.
// Input:  Claude Code hook event JSON on stdin
// Output: a violating command -> message on stderr + exit 2 (block); otherwise exit 0.
//
// Checked: `git worktree add <path>` (the new worktree) and `git worktree move <worktree> <new-path>` (the
// destination). The target must resolve strictly INSIDE <workspace>/tmp/worktrees/ (a descendant; the folder
// itself is not a valid target). list / remove / prune / lock / repair and every other git command pass.
//
// Path resolution, all lexical (symlinks and junctions are not followed, like every sibling hook):
//   - workspace = lib/journal-util projectRoot (CLAUDE_PROJECT_DIR first); cwd = payload.cwd || workspace.
//   - a relative target resolves against the `git -C <dir>` chain (each -C against the previous one), else the cwd.
//     This hook does not follow cd: a cd / chdir / pushd / popd / Set-Location / sl (or Push/Pop-Location) token
//     ANYWHERE in the command -- also inside `bash -c`, `{ }`, `( )` -- makes the cwd unknown, and then a relative
//     target (or relative -C) not anchored by an absolute -C or an absolute target is refused.
//   - Git Bash drive spelling `/d/foo` -> `D:\foo`, only for tool_name Bash on win32 (in PowerShell it really is
//     `\d\foo` on the current drive).
//   - compared with path.relative: case-insensitive on win32 only, separator-aware, `..` normalized first.
//   - options before / after the path are skipped (-b/-B <branch>, --reason <text>, -f, --detach, --lock, ...).
//   - the command (heredoc bodies removed first) is split by splitCommand below at every newline, `;`, `|`, `||`
//     and `&&` that is OUTSIDE quotes, honouring escapes, and each piece goes to the shared segments(). Doing the
//     split here matters because parse-cmd's own operator split is escape-unaware (after `echo \" && git worktree
//     add ../x` or `echo don\'t && ...` it reads the rest of the line as one string and hides the git command)
//     and never splits on a bare newline; a newline inside a quoted commit message / node -e text, on the other
//     hand, must stay inside it. A `#` comment is dropped and an escaped quote (\' in Bash, `' in PowerShell) does
//     not open a string, so neither can swallow the text after it.
//     Residual: segments() re-splits each piece with its escape-unaware splitter, so a piece that holds a string
//     with an escaped quote and an operator inside it (echo "a\"b; c") can be cut in the wrong place -- extra
//     fragments only, which can cause a false deny but never hides a command.
//
// Fail-closed when the target cannot be pinned down (same stance as block-destructive-fs.js for rm):
//   - `$` / backtick (variable, command substitution), a leading `~`, glob or brace characters, glued quotes;
//   - an unquoted backslash path in the Bash tool (bash drops the backslashes, so the real path differs);
//   - a relative target (or -C) while the cwd is unknown (see above).
// Fail-open only when the payload is not JSON (cannot know anything), as the siblings do.
//
// Not covered: `& git ...` call operator, a lone `&` (background) or `|&` as a separator, `{ git worktree add ... }`
// blocks and `then`/`do`/`else` prefixes (the shared tokenizer reports the keyword as the command), `git worktree
// add` reached through a git alias or an unlisted wrapper (env with options), WSL's git, bash `$'...\'...'` strings,
// PowerShell `<# ... #>` block comments, `$( ... )` / backtick command substitution, and a non-drive `/x/y` path
// in Git Bash.

const path = require('node:path');
const { segments, stripHeredocs } = require('./lib/parse-cmd');
const { findSubcmdIndex } = require('./lib/git-parse');
const { projectRoot } = require('./lib/journal-util');

const CD_CMDS = new Set(['cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl', 'push-location', 'pop-location']);

const UNRESOLVABLE = /[$`*?[\]{}"']|^~/;

function msysToWin(p) {
  const m = /^\/([A-Za-z])(?:\/(.*))?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:\\${m[2] || ''}` : p;
}

// Split a command into simple commands at every newline, `;`, `|`, `||` and `&&` that is outside quotes. Newlines
// inside '...' / "..." stay in the piece, an escape char (esc) followed by a newline joins the lines, an escaped
// char never opens or closes a quote, and a `#` that starts a word outside quotes drops the rest of its line.
// esc is a backslash for Bash and a backtick for PowerShell. This replaces the operator split that
// segments() does (parse-cmd.js is escape-unaware: after `echo \"` it reads the rest of the line as one string).
function splitCommand(s, esc) {
  const lines = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === esc && quote !== "'") {
      const crlf = s[i + 1] === '\r' && s[i + 2] === '\n';
      if (s[i + 1] === '\n' || crlf) {
        cur += ' ';
        i += crlf ? 2 : 1;
      } else {
        cur += ch + (s[i + 1] ?? '');
        i++;
      }
    } else if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '#' && /^$|[\s;&|(]$/.test(cur.slice(-1))) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++;
    } else if (ch === '\n' || ch === ';' || ch === '|' || (ch === '&' && s[i + 1] === '&')) {
      if (ch === '&') i++;
      lines.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  lines.push(cur);
  return lines;
}

const isCdToken = (t) => CD_CMDS.has(t.replace(/^[$({`]+/, '').toLowerCase());

// Positional arguments of `git worktree add|move`, skipping options and the values of -b/-B/--reason.
function positionals(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') {
      out.push(...tokens.slice(i + 1));
      break;
    }
    if (t.startsWith('--')) {
      const name = t.slice(2);
      if (!name.includes('=') && name.length >= 3 && 'reason'.startsWith(name)) i++;
    } else if (t.length > 1 && t.startsWith('-')) {
      if (t.search(/[bB]/) === t.length - 1) i++; // -b <branch>, -fb <branch>; -bfeat carries its value
    } else {
      out.push(t);
    }
  }
  return out;
}

function unresolvable(t, raw, toolName) {
  if (UNRESOLVABLE.test(t)) return true;
  return toolName === 'Bash' && t.includes('\\') && !raw.includes(`'${t}'`) && !raw.includes(`"${t}"`);
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let payload;
  let command = '';
  try {
    payload = JSON.parse(data);
    command = payload.tool_input?.command || '';
  } catch {
    process.exit(0);
  }
  const root = projectRoot(payload);
  const verdict = checkCommand(command, payload.cwd || root, root, payload.tool_name);
  if (verdict) {
    console.error(verdict);
    process.exit(2);
  }
  process.exit(0);
});

function checkCommand(command, cwd, root, toolName) {
  const wtRoot = path.join(root, 'tmp', 'worktrees');
  const shown = wtRoot.split(path.sep).join('/');
  const msys = process.platform === 'win32' && toolName === 'Bash';
  const pieces = splitCommand(stripHeredocs(command), toolName === 'PowerShell' ? '`' : '\\');
  const hint = `worktree は必ずワークスペース直下の「${shown}/<名前>」に作ってください（このリポジトリも dev/<product>/ も同じ。CLAUDE.md §0）。`;

  const toNative = (p) => (msys ? msysToWin(p) : p);
  const segs = pieces.flatMap((p) => segments(p));
  const cwdKnown = !segs.some(({ cmd, args }) => isCdToken(cmd) || args.some(isCdToken));
  for (const { cmd, args, raw } of segs) {
    if (cmd !== 'git') continue;
    const subIdx = findSubcmdIndex(args);
    if (subIdx === -1 || args[subIdx] !== 'worktree') continue;
    const op = args[subIdx + 1];
    if (op !== 'add' && op !== 'move') continue;

    const dirs = [];
    for (let i = 0; i < subIdx; i++) {
      if (args[i] === '-C') dirs.push(args[++i] ?? '');
    }
    const pos = positionals(args.slice(subIdx + 2));
    const target = op === 'add' ? pos[0] : pos[1];
    if (target === undefined) continue;

    const bad = [...dirs, target].find((t) => unresolvable(t, raw, toolName));
    if (bad !== undefined) {
      return (
        `BLOCKED: git worktree ${op} のパス「${bad}」は、変数展開（$）・ワイルドカード・引用符の組み合わせ・~ ・` +
        `Bash でのバックスラッシュ（クォートなし）などを含み、実際にどこへ作られるか事前に特定できません。` +
        `文字どおりのパスを書き直してください。${hint}`
      );
    }

    let base = cwd;
    let anchored = false;
    for (const d of dirs) {
      const n = toNative(d);
      anchored = anchored || path.isAbsolute(n);
      base = path.resolve(base, n);
    }
    const nt = toNative(target);
    anchored = anchored || path.isAbsolute(nt);
    if (!cwdKnown && !anchored) {
      return (
        `BLOCKED: コマンドのどこかに cd / pushd / popd / Set-Location があり、作業ディレクトリを確定できないため、` +
        `git worktree ${op} の相対パス「${target}」がどこを指すか判断できません。cd をやめて、絶対パス、` +
        `または git -C <絶対パス> worktree ${op} ... で書いてください。${hint}`
      );
    }

    const abs = path.resolve(base, nt);
    const rel = path.relative(wtRoot, abs);
    const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
    if (outside || rel === '') {
      return (
        `BLOCKED: git worktree ${op} の${op === 'add' ? '作成先' : '移動先'}「${target}」（解決後のパス:「${abs}」）は` +
        `${rel === '' ? '「tmp/worktrees」フォルダそのものです（その中に名前を付けて作ります）' : '「tmp/worktrees」の外です'}。` +
        `${hint}例: git -C <リポジトリ> worktree add ${shown}/<名前> -b <ブランチ名> main`
      );
    }
  }
  return null;
}
