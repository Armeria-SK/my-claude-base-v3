#!/usr/bin/env node
// PreToolUse hook: blocks destructive file deletion (last-resort guard in bypassPermissions environments)
// Enforces CLAUDE.md §1.5 "File/data deletion -> always confirm".
//
// Policy:
//   - rm/shred: user ruling 2026-08-12 (AskUserQuestion, "ワークスペース直下なら何でも許可") relaxed
//     this from a leaf-name allowlist to workspace-root CONTAINMENT. Each target is resolved against
//     the command's cwd (payload.cwd, falling back to the workspace root) to an absolute path, then:
//       ALLOWED  - the resolved path is strictly INSIDE the workspace root, whatever its original
//                  spelling (relative or absolute) and whatever its leaf name. This supersedes
//                  SAFE_LEAF for rm/shred: a leaf name no longer matters once containment is proven.
//       BLOCKED  - the resolved path is OUTSIDE the workspace root (/, another drive, ~/HOME, a
//                  `../` that actually escapes, ...).
//       BLOCKED  - the resolved path IS the workspace root itself (`rm -rf .` run at the root, or
//                  the root's own absolute path spelled out) — "below the hierarchy" was granted,
//                  not the hierarchy itself.
//       BLOCKED  - the target can't be resolved to a path at all: a `~`-prefix (shell-expanded home,
//                  never expanded by this hook), or anything containing a glob character (* ? [ ])
//                  or `$` (variable/command-substitution expansion, which also covers $HOME). This
//                  hook parses the command STRING, not a shell's post-expansion argv, so it cannot
//                  know what these expand to — verified empirically (tmp/path-probe.js, 2026-08-12)
//                  that Node's path.resolve treats "*", "$HOME", "~" as LITERAL path segments, so
//                  skipping this check would let `rm -rf *` resolve to "<root>/*" and be wrongly
//                  allowed as "inside the root". Deliberate limit, not an oversight.
//     Only rm and shred are touched by this ruling (it named "rm" specifically) — find/xargs/dd/
//     truncate below, and the PowerShell delete cmdlets/Clear-Content further down (still gated by
//     the original FORBIDDEN_TARGET + SAFE_LEAF leaf-allowlist), are unchanged by this ruling (the delete
//     cmdlets later got a tmp/ exemption: see "PowerShell deletes under tmp/" below).
//
//   Disclosure (CLAUDE.md §1.5, user ruling 2026-08-12):
//     1. What's newly allowed: any rm/shred target below the workspace root, any leaf name.
//     2. What's still blocked, and why: outside the root; the root itself; targets this hook
//        cannot resolve (globs, $-expansion, ~) — see BLOCKED cases above.
//     3. Recovery fact the user already accepted when making this ruling: tasks/YYYY-MM/**,
//        tasks/*.md, plans/**, and dev/** are all gitignored (.gitignore) — an
//        rm under this new policy can delete any of them with NO git history to recover from.
//
//   - Recursive deletes (rm -r / -rf) of RELATIVE targets are blocked unless every target's leaf name
//     is a disposable build-output dir (node_modules, dist, ...) -> otherwise Claude confirms with the user.
//   - find ... -delete is blocked unconditionally
//   - find ... -exec/-execdir/-ok rm ... {} is blocked unconditionally (as dangerous as -delete)
//   - ... | xargs rm ... is blocked when it carries a recursive/force flag (stdin-derived targets
//     can't be inspected against FORBIDDEN_TARGET/SAFE_LEAF, so the combination itself is the signal)
//   - dd ... of=<path> / truncate -s 0 <path> targeting an absolute or parent-relative path is blocked
//     (destructive overwrite, not a delete, but equally irreversible; §1.5 covers "data deletion" broadly)
//   - bash -c / sh -c / eval indirection is parsed recursively (checked by shared tokenizer)
//   - Leading env-var assignments (FOO=1 rm ...) and absolute paths (/bin/rm) are normalized
//
// Known limitation: shell-wrapper-mediated deletes via `find -exec`/`-execdir`/`-ok` or `xargs`
// invoking `sh`/`bash`/`dash`/`ash`/`zsh`/`env` are covered (see SHELL_WRAPPERS below) by
// re-tokenizing the wrapper's "-c <script>" argument with the shared tokenizer and checking whether
// any inner segment's command is rm/shred (so git rm / npm rm / a path containing "rm" are not
// false positives), and by peeling off env's own flags/assignments before recursing on the command
// it actually invokes. Forms without "-c" (e.g. `sh script.sh`) or further nested indirection beyond
// that (e.g. a wrapper script invoked by path that itself shells out) remain a structural limit. A
// script reached this way is resolved against the OUTER command's cwd (this hook does not track `cd`
// across segments or within a wrapper's script body), and symlinks are never resolved against the
// real filesystem (path.resolve is purely lexical, matching every other hook in this codebase) — a
// symlink whose lexical target looks inside the root but whose real target is outside it is not caught.
//
// Path comparison for the rm/shred containment check above: resolved absolute paths are compared with
// path.relative (a real separator-aware comparison, not a raw string startsWith, so a sibling dir like
// "<root>-other" is correctly seen as outside), case-folded on win32 only (case-insensitive filesystem
// there; POSIX stays case-sensitive).
//
// MSYS drive paths (added 2026-10-21): on win32 the Bash tool is Git Bash, where `/d/foo` means
// `D:\foo`, but path.resolve reads it as `\d\foo` on the current drive, so a real in-workspace target
// was wrongly blocked as outside. Before resolving, rm/shred targets of the form `/X[/...]` (X =
// exactly one ASCII letter, either case) are rewritten to `X:\...` — see MSYS_DRIVE / msysToWin below.
// Principle: translate only when the real Git Bash target is provably the rewritten path; when in
// doubt, leave the target untouched so it resolves as before (outside the root -> blocked).
//   - Only when process.platform === 'win32' AND the payload's tool_name === 'Bash' (missing or any
//     other tool_name: no rewrite). The PowerShell tool shares this hook, and there `/d/foo` really is
//     `\d\foo` on the current drive, so rewriting it would wrongly allow `rm -r /d/<workspace>/tmp/x`
//     whose real target is `D:\d\<workspace>\tmp\x`.
//   - `/cygdrive/X/...` is NOT translated: Git for Windows mounts drives directly under `/` (see
//     `mount`), so `/cygdrive/d/...` is an ordinary path under the Git install dir, not drive D.
//   - ALLOWLIST: only a target whose text after `/X/` consists solely of plain path characters is
//     translated, i.e. ASCII `[A-Za-z0-9_]` and `. - / + @ , = % #` (see MSYS_DRIVE). Each of those is
//     literal in an unquoted bash word (checked in Git Bash, also with extglob on): `.` and `-` are
//     ordinary name characters (`..` is still normalized by path.resolve); `+ @ ,` only act inside an
//     extglob `+(..)`/`@(..)` or a `{a,b}` brace, and parentheses and braces are not on the list; `=` and
//     `%` are only special in `$`-expansions or assignment-shaped words, which the `$` check and the
//     leading `/` rule out; `#` only starts a comment at the beginning of a word, never inside one. Any
//     other character means "no translation": the target resolves as before, outside the root, and is
//     blocked. This covers, without enumerating them, backslash (Git Bash drops an unquoted `\`, so
//     `/d/<root>\-other` really deletes the sibling `<root>-other`), quotes and braces (quote removal and
//     brace expansion are not modelled here: `/d/<root>/tmp/{x,../../y}` and `/d/<root>/tmp/.""./.""./x`
//     reach `..`), backtick and `(` `)` (command substitution / subshell), `! ; & | < > ^ ~ : *` and
//     space, and everything non-ASCII. Space is left out on purpose: a token only contains one when it
//     was quoted, and quote handling is exactly what this hook does not model. The identical gaps for
//     `D:/...` and relative targets are pre-existing and tracked separately; the translation must not
//     extend them to spellings that were blocked before.
//   - STANDALONE WORD: a target is translated only if every occurrence of its text in the segment is a
//     whole word -- start or whitespace before it, whitespace or end after it, optionally wrapped in one
//     matching pair of quotes. The tokenizer splits `"/d/<root>/tmp/"../../x` into two arguments while
//     bash glues them into one path (`/d/<root>/tmp/../../x`), so a glued occurrence (including one that
//     merely repeats an otherwise standalone target) leaves the target untranslated and blocked.
//     A target that is also the leading text of another argument (`/d/<root>/tmp /d/<root>/tmp/x`) counts
//     as glued too: a fail-closed false positive, accepted for simplicity.
//   - The whole command is NOT translated when (a) any bash/sh segment has a `/` or `\` in its text
//     before the first `-c` token (an explicit path such as `/c/Windows/System32/bash.exe -c '...'`, or a
//     path in a leading env assignment like `FOO=/x bash -c ...`): that may be WSL's bash, where `/d/...`
//     is a Linux path; or (b) the command string contains `PATH=` anywhere, since a changed PATH can put
//     another bash first. Both checks over-approximate on purpose (false positives only fall back to the
//     old blocking). A bare `bash -c` / `sh -c` is Git Bash's own and keeps the translation. Not covered
//     here: lib/parse-cmd.js does not peel env options (`env -u X rm ...`, `env FOO=1 bash -c ...`), so
//     such commands are never parsed into rm/bash segments at all -- a pre-existing gap, tracked separately.
// The rewrite only runs after the `~` / glob / `$` checks and is followed by the same containment test,
// so a drive root (`/d`, `/d/`), another drive (`/c/Windows`), `..` escapes and the workspace root itself
// stay blocked. The other sections (dd, truncate, PowerShell cmdlets) keep FORBIDDEN_TARGET unchanged
// (PowerShell delete cmdlets: except targets under tmp/, see the next section).
//
// PowerShell deletes under tmp/ (user request 2026-11-01): the delete cmdlets (PS_DELETE_CMDS: Remove-Item,
// ri, rd, rmdir, del, erase) blocked every absolute target (FORBIDDEN_TARGET) and every -Recurse delete whose
// leaf name was not in SAFE_LEAF, so tmp/ could not be cleaned from the PowerShell tool. Now a target skips both
// checks when it resolves -- against payload.cwd, falling back to the workspace root like the rm section -- to
// <root>/tmp or <root>/dev/<product>/tmp (CLAUDE.md §0), the directory itself or anything below it. Relative or
// absolute, `\` or `/`, any letter case on win32: decided on the resolved path with the same normalizeRel +
// foldCase comparison as the rm section. Targets are judged one by one; the others in the same command still get
// the old rules.
//   - FAIL CLOSED: the exemption applies only to a target made of plain path characters (PS_PLAIN_PATH: an
//     optional `X:\` or `X:/` drive prefix, then ASCII letters/digits and `_ . - \ /`). This hook reads the
//     command string, PowerShell expands and reinterprets much more: wildcards (-Path expands * ? [ ]), `$`
//     (variables, $env:), backtick escapes, ( ) { } @ ; & | , (subexpressions, splatting, arrays), `~`, a colon
//     anywhere but the drive (drive-relative `D:x`, alternate data stream `x:y`), space (only a quoted path has
//     one) and anything non-ASCII -- notably the Unicode quotes U+2018..U+201F (PowerShell reads them as quote
//     characters, the tokenizer does not) and the dashes U+2013 / U+2014 / U+2015 (PowerShell reads them as a
//     parameter hyphen). Such a target gets today's rules unchanged. The parser's own quote stripping is taken as
//     is, with no second round, so `"'tmp\x'"` (literal quotes in the real path) is not plain.
//   - STANDALONE WORD: as for rm, every occurrence of the target text in the segment must be a whole word
//     (isStandaloneWord). The tokenizer splits `"tmp\x"y\..\..\..\node_modules` into two arguments where
//     PowerShell glues them into one path above the root, so a glued occurrence leaves the target on the old rules.
//   - STILL BLOCKED, as before: outside the root (other drives, UNC, `..` that really escapes, a sibling like
//     `<root>-other`), the root itself, the rest of the workspace (plans/, tasks/, .claude/, dev/<product>/src,
//     ...), a tmp directory deeper down (dev/x/y/tmp), and a relative `tmp\x` when payload.cwd is not the root
//     (it resolves under the cwd). Only the delete cmdlets changed: Clear-Content, rm/shred, find, xargs, dd and
//     truncate are untouched.
//   - ACTION PARAMETERS (ruling 2026-11-01): a token that directly follows -ErrorAction/-ea/-WarningAction/-wa/
//     -InformationAction/-infa (any letter case) and is exactly an ActionPreference name (SilentlyContinue, Stop,
//     Continue, Ignore, Inquire, Suspend, Break) is a parameter value, not a target, so `Remove-Item -Recurse
//     -Force tmp\x -ErrorAction SilentlyContinue` is judged on tmp\x alone. Anything else stays a target (fail
//     closed): any other value (`-ErrorAction plans\x`), an abbreviated parameter (`-ErrorA Stop`), another
//     parameter (`-Include Stop`). This holds for every delete target in the section, not only tmp/ ones: the
//     same idiom after a SAFE_LEAF target (`-Recurse node_modules -ErrorAction Stop`) is allowed now too.
//   - LOCATION CHANGE: if the command text contains Set-Location / sl / cd / chdir / Push-Location / pushd /
//     Pop-Location / popd as a standalone word ANYWHERE (PS_LOCATION_WORD, any case; not preceded or followed by a
//     word character or hyphen, so `cd..`, `cd\`, `(cd`, `{ cd ..}`, `$null = Set-Location ..` and
//     `& { cd .. }` match, `abcd` and `tmp\cdx` do not), relative targets may no longer resolve against
//     payload.cwd. Then no target gets the tmp/ exemption, and a recursive delete is blocked outright -- the
//     SAFE_LEAF pass is off too (`Set-Location ..; Remove-Item -Recurse -Force tmp` and `... node_modules` used to
//     pass on the leaf name alone). It is a text scan, not a parse, so it over-approximates on purpose: a location
//     change AFTER the delete, `cd` as an argument or inside a string, and path text such as `tmp\cd\x` all count
//     (accepted false positives; reword the command or use an absolute path outside the word list).
//   - COLON-BOUND PATH PARAMETERS: `-Path:v` / `-LiteralPath:v` (PowerShell also takes any unambiguous prefix and
//     the alias -PSPath; here every prefix of literalpath -- even `-l` -- and of path / pspath with length >= 2,
//     and -lp, counts) put `v` among the targets, judged exactly like a positional target: FORBIDDEN_TARGET, the
//     tmp/ exemption (its standalone-word check then runs on the whole `-Path:v` token) and SAFE_LEAF. Before, such
//     a token was only a flag, so it was never checked and could hide `plans` behind a tmp/ or SAFE_LEAF target.
//     `-Path: v` (space after the colon) leaves `v` as an ordinary positional token, which is judged as before.
//   - RECURSION AND DASHES: every prefix of -Recurse (-r, -re, -rec, ...) marks a recursive delete (Recurse is the
//     only Remove-Item parameter starting with r), and an UNQUOTED token starting with an en dash, em dash or
//     horizontal bar (U+2013 / U+2014 / U+2015) is a flag like one starting with `-`, never a target. Flag or
//     target is decided on the raw token (rawArgs from lib/parse-cmd), before unquoting: PowerShell reads a quoted
//     '-plans' or '<U+2013>plans' as a plain value (probed: Path=[-plans]), so it is a target and judged as one.
//     Before, the unquoted `-plans` was dropped as a flag, hiding the value behind a SAFE_LEAF/tmp target.
//   - KNOWN LIMITS: (a) any other parameter VALUE still looks like a path here and is judged as a target; (b)
//     only a delete cmdlet at the start of a segment is examined: `& Remove-Item ...` (call operator) and a delete
//     on a later line of a multi-line command are not seen (pre-existing lib/parse-cmd.js limits, pinned by the
//     fs-ps-known-limit-* rows in hook-probes.samples.json, to be flipped when the parser is fixed); (c) the
//     check is purely lexical, like rm: Windows PowerShell 5.1 Remove-Item -Recurse can, depending on the build,
//     descend through a directory junction/symlink inside the target and delete in its real location (a probe on
//     5.1.26100.9711 removed only the link, but nothing here relies on that).
//
// Input: Claude Code hook event JSON on stdin
// Output: matching command -> message on stderr + exit 2 (block); otherwise exit 0

const { segments, stripExeSuffix } = require('./lib/parse-cmd');
const path = require('node:path');
const { projectRoot } = require('./lib/journal-util');
const { normalizeRel } = require('./lib/scope-match');

// Directories that can be safely regenerated after deletion (matched by the trailing path element).
// rm/shred no longer consult this (workspace-root containment supersedes it — see header "Policy:
// rm/shred"); still used by the PowerShell recursive-delete and Clear-Content sections below.
const SAFE_LEAF =
  /^(node_modules|dist|build|out|coverage|target|tmp|temp|__pycache__|\.next|\.nuxt|\.turbo|\.cache|\.pytest_cache|\.venv|venv)\/?$/;

// Unconditional block targets (regardless of whether rm has -r)
// ~/... and $HOME/... cover any subpath under home (e.g. ~/.ssh/id_rsa), not just the bare prefix.
// (note: the leading `\/` alternative is already subsumed by `\/\S*`; left as-is on purpose —
//  this hook's regex is never touched by comment-only fixes.)
const FORBIDDEN_TARGET = /^(\/|~\/?\S*|\.\.(\/.*)?|\/\S*|[A-Za-z]:([\\/]\S*)?|\$HOME\/?\S*|\*)$/;

// Destructive commands that a `find -exec` / `xargs` may invoke
const DESTRUCTIVE_CMDS = new Set(['rm', 'shred']);

// PowerShell delete cmdlets/aliases (the PowerShell tool shares this hook via the
// Bash|PowerShell matcher; `rm` as a PS alias is already covered by the rm section)
const PS_DELETE_CMDS = new Set(['remove-item', 'ri', 'rd', 'rmdir', 'del', 'erase']);

// PowerShell starts a parameter name with a hyphen, an en dash, an em dash or a horizontal bar.
const PS_DASH = /^[-\u2013\u2014\u2015]/;

// `-ErrorAction SilentlyContinue` and friends: the value is an ActionPreference name, not a path, so it is
// not a delete target (see header, ACTION PARAMETERS). Only these exact parameter names and value names count.
const PS_ACTION_PARAM = /^[-\u2013\u2014\u2015](?:erroraction|ea|warningaction|wa|informationaction|infa)$/i;
const PS_ACTION_VALUE = /^(?:silentlycontinue|stop|continue|ignore|inquire|suspend|break)$/i;

// A location-changing cmdlet or alias (also the cd.. / cd\ functions) as a standalone word ANYWHERE in the command
// text: not preceded or followed by a word character or hyphen. Deliberately a text scan, not a parse: it sees
// `$null = Set-Location ..`, `{ cd ..}`, `if (1) { cd .. }`, `& { cd .. }`, and also a mere `tmp\cd\x`, a quoted
// "cd" or a later change (false positives accepted). See header, LOCATION CHANGE.
const PS_LOCATION_WORD = /(?<![\w-])(?:set-location|sl|cd|chdir|push-location|pushd|pop-location|popd)(?![\w-])/i;

// Shell wrappers that can mediate an indirect rm/shred (find -exec sh -c '...', xargs env rm, ...)
const SHELL_WRAPPERS = new Set(['sh', 'bash', 'dash', 'ash', 'zsh', 'env']);

// env options that take a value argument (must be skipped along with their value when peeling
// env off to find the actually-invoked command). e.g. `env -u PATH rm ...`, `env -C /tmp rm ...`.
const ENV_VALUE_FLAGS = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']);

// Given args[] and the index of a command name, resolve it as a basename and, if it's a shell
// wrapper, peel off one layer (e.g. `env`) to find the actually-invoked command. Returns
// { invoked, rest } where `rest` is the remaining args after the invoked command name, or null
// if index is out of range.
function resolveWrapped(args, i) {
  if (i >= args.length) return null;
  const invoked = stripExeSuffix((args[i] || '').split('/').pop().toLowerCase());
  return { invoked, rest: args.slice(i + 1) };
}

// Skip past env's own options (-i, -u NAME, -C DIR, ...) and any NAME=value assignments to find
// the index of the actually-invoked command (env VAR=1 -i rm -rf x -> index of "rm").
function skipEnvPrefix(args) {
  let i = 0;
  while (i < args.length) {
    const t = args[i];
    if (/^\w+=/.test(t)) { i++; continue; }
    if (t.startsWith('-')) {
      i += ENV_VALUE_FLAGS.has(t) ? 2 : 1;
      continue;
    }
    break;
  }
  return i;
}

// True if `invoked` is a shell wrapper (sh/bash/.../env) that mediates an indirect rm/shred.
//   - sh/bash/dash/ash/zsh: only the "-c <script>" form is followed into the script text, which is
//     re-tokenized via segments() so only an actual rm/shred *command* (not a substring/argument/
//     path segment) trips the guard (git rm, npm rm, "echo rm", /var/rm/notes all pass through).
//   - env: env's own flags/assignments are peeled off first, then recurse on the real command,
//     so `env FOO=1 -i rm -rf x` and `env sh -c '...'` are both resolved correctly.
function isWrapperMediatedDelete(invoked, rest) {
  if (!SHELL_WRAPPERS.has(invoked)) return false;
  if (invoked === 'env') {
    const skip = skipEnvPrefix(rest);
    const next = resolveWrapped(rest, skip);
    if (!next) return false;
    if (DESTRUCTIVE_CMDS.has(next.invoked)) return true;
    return isWrapperMediatedDelete(next.invoked, next.rest);
  }
  // sh/bash/dash/ash/zsh: only "-c <script>" carries an inline command to inspect.
  const cIdx = rest.indexOf('-c');
  if (cIdx === -1) return false;
  const script = rest[cIdx + 1];
  if (!script) return false;
  return segments(script).some((seg) => DESTRUCTIVE_CMDS.has(seg.cmd));
}

// --- rm/shred containment (user ruling 2026-08-12; see header "Policy: rm/shred") --------------

// A leading ~ is a shell-expanded home-directory reference. path.resolve does NOT expand it (proven
// empirically, tmp/path-probe.js) -- it treats "~" as a literal path segment -- so without this
// check "~/foo" would resolve to "<root>/~/foo" and be wrongly seen as inside the root. Unresolved,
// blocked unconditionally.
const HOME_PREFIX = /^~/;

// Characters a real shell expands before rm/shred ever sees the literal argument: glob wildcards
// (* ? [ ]) and $ (variable/command-substitution expansion -- covers $HOME too, no separate case
// needed). This hook parses the command STRING, not a shell's post-expansion argv, so it cannot know
// what these expand to; path.resolve treats them as literal characters (same empirical proof as
// HOME_PREFIX above), so leaving them unhandled would let "rm -rf *" resolve to "<root>/*" and be
// wrongly allowed. Unresolved, blocked unconditionally.
const UNRESOLVABLE_TARGET = /[*?[\]$]/;

// Case-fold only on win32 (case-insensitive filesystem there); POSIX filesystems are case-sensitive.
// Applied to both operands before normalizeRel so its path.relative-based comparison -- already
// separator-aware, not a raw string prefix -- also becomes case-insensitive where the real
// filesystem is.
function foldCase(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

// Git Bash (MSYS) spells drive D: as /d. Exactly one letter, so /dd/x and /d-x are ordinary
// directories, not drives. $1 = drive letter, $2 = the rest after the slash (may be empty). The rest
// is an allowlist of plain path characters (see header): any other character means no match at all.
const MSYS_DRIVE = /^\/([A-Za-z])(?:\/([\w.\-\/+@,=%#]*))?$/;

// "/d/foo" -> "D:\foo", "/d" and "/d/" -> "D:\"; anything else is returned unchanged.
function msysToWin(target) {
  const m = MSYS_DRIVE.exec(target);
  return m ? `${m[1].toUpperCase()}:\\${m[2] || ''}` : target;
}

// True for a bash/sh segment with a / or \ anywhere before its first -c token (whole text if none):
// an explicit path, or a path in an env option/assignment -- it may be WSL's bash, which reads /d/x
// as a Linux path. Over-approximates on purpose (see header).
function isPathInvokedShell({ cmd, raw }) {
  if (cmd !== 'bash' && cmd !== 'sh') return false;
  const c = raw.search(/\s-c(\s|$)/);
  return /[\\/]/.test(c === -1 ? raw : raw.slice(0, c));
}

// True when every occurrence of `text` in `raw` is a whole word (see header, STANDALONE WORD).
function isStandaloneWord(raw, text) {
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const standalone = raw.match(new RegExp(`(?<=^|\\s)(["']?)${esc}\\1(?=\\s|$)`, 'g')) || [];
  return standalone.length === raw.split(text).length - 1;
}

// Resolve `target` against the command's cwd, then classify the result against the workspace root.
// `abs` keeps real casing (for messages); outside/isRootItself are decided on folded case.
// `msys`: translate Git Bash drive paths first (win32 + Bash tool only, see header).
function classifyRmTarget(root, cwd, target, msys) {
  const abs = path.resolve(cwd, msys ? msysToWin(target) : target);
  const { rel, outside } = normalizeRel(foldCase(root), foldCase(abs));
  return { abs, outside, isRootItself: !outside && rel === '' };
}

// --- PowerShell deletes under tmp/ (user request 2026-11-01; see header) -------------------------

// Plain path text only: an optional `X:` + separator drive prefix, then ASCII [A-Za-z0-9_] and . - \ /.
// A colon anywhere else (drive-relative `D:x`, alternate data stream `x:y`) is not allowed, so it
// stays on the old rules; so does everything PowerShell expands or reinterprets: wildcards, `$`,
// backtick, quotes, parentheses/braces, `@ ; & | ,`, `~`, space, non-ASCII.
const PS_PLAIN_PATH = /^(?:[A-Za-z]:[\\/])?[\w.\-\\/]+$/;

// Root-relative form (already case-folded on win32 and "/"-separated) of <root>/tmp and
// <root>/dev/<product>/tmp, the directory itself or anything below it.
const PS_TMP_REL = /^(?:dev\/[^/]+\/)?tmp(?:\/|$)/;

// True when a PowerShell delete target provably resolves inside tmp/ (see header). Any doubt -> false,
// and the caller applies the old FORBIDDEN_TARGET / SAFE_LEAF rules to that target. `word` is the token the
// target came from (the same text, or `-Path:<target>`), which must be a whole word in the segment.
function isPsTmpTarget(root, cwd, target, raw, word = target) {
  if (!PS_PLAIN_PATH.test(target) || !isStandaloneWord(raw, word)) return false;
  const abs = path.resolve(cwd, target.replace(/\\/g, '/'));
  const { rel, outside } = normalizeRel(foldCase(root), foldCase(abs));
  return !outside && PS_TMP_REL.test(rel);
}

// The value of a `-Path:value` / `-LiteralPath:value` token, or null. PowerShell accepts any unambiguous prefix
// of a parameter name and the alias -PSPath: every prefix of literalpath (even `-l`), every prefix of path / pspath
// with length >= 2 (`-p` is ambiguous), and -lp, counts here. Over-matching only adds one more target to judge.
function psColonPathValue(token) {
  const m = /^[-\u2013\u2014\u2015]([A-Za-z]+):(.+)$/.exec(token);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const isPath = name === 'lp' || 'literalpath'.startsWith(name) || (name.length >= 2 && ['path', 'pspath'].some((n) => n.startsWith(name)));
  return isPath ? m[2] : null;
}

// -r, -rec, -Recurse, -Recurse:$true ... : Recurse is the only Remove-Item parameter starting with r, so any
// prefix of it counts; anything starting with `rec` too (the old test).
function isPsRecurseFlag(token) {
  if (!PS_DASH.test(token)) return false;
  const name = token.slice(1).split(':')[0].toLowerCase();
  return name !== '' && ('recurse'.startsWith(name) || name.startsWith('rec'));
}

// Delete targets of one PowerShell delete segment as { value, word }: positional and space-separated values
// (flags, cmd.exe-style /s switches and ActionPreference values are not targets) plus the values of colon-bound
// path parameters. Flag or value is decided on the RAW token: PowerShell reads a quoted '-x' as a plain value.
function psDeleteTargets(args, rawArgs) {
  const targets = [];
  args.forEach((t, i) => {
    if (PS_DASH.test(rawArgs[i])) {
      const value = psColonPathValue(t);
      if (value !== null) targets.push({ value, word: t });
    } else if (!/^\/[a-zA-Z]$/.test(t) && !(PS_ACTION_VALUE.test(t) && PS_ACTION_PARAM.test(args[i - 1] || ''))) {
      targets.push({ value: t, word: t });
    }
  });
  return targets;
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let command = '';
  let payload = {};
  try {
    payload = JSON.parse(data);
    command = payload.tool_input?.command || '';
  } catch {
    process.exit(0);
  }

  // Root/cwd resolution: CLAUDE_PROJECT_DIR -> payload.cwd
  // -> process.cwd(), walking up for a .claude dir; see lib/journal-util.js projectRoot).
  const root = projectRoot(payload);
  const cwd = payload.cwd || root;

  const msys = process.platform === 'win32' && payload.tool_name === 'Bash';
  const verdict = checkCommand(command, cwd, root, msys);
  if (verdict) {
    console.error(verdict);
    process.exit(2);
  }
  process.exit(0);
});

function checkCommand(command, cwd, root, msys) {
  const segs = segments(command);
  const useMsys = msys && !command.includes('PATH=') && !segs.some(isPathInvokedShell);
  const moved = PS_LOCATION_WORD.test(command);
  for (const { cmd, args, rawArgs, raw } of segs) {
    // --- find ... -delete ---------------------------------------------------
    if (cmd === 'find') {
      if (args.includes('-delete')) {
        return `BLOCKED: "find ... -delete" is forbidden. File deletion requires user confirmation (CLAUDE.md §1.5).`;
      }
      // --- find ... -exec/-execdir/-ok rm|shred ... {} ; / + ---------------
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-exec' || args[i] === '-execdir' || args[i] === '-ok') {
          const invoked = stripExeSuffix((args[i + 1] || '').split('/').pop().toLowerCase());
          if (DESTRUCTIVE_CMDS.has(invoked)) {
            return `BLOCKED: "find ... ${args[i]} ${invoked} ..." is forbidden. File deletion requires user confirmation (CLAUDE.md §1.5).`;
          }
          // Shell-wrapper-mediated delete: find ... -exec sh -c 'rm -rf $1' _ {} ;
          // Scan only up to the -exec/-execdir/-ok terminator (';' or '+') so unrelated
          // trailing find predicates aren't swept into the check.
          let end = i + 2;
          while (end < args.length && args[end] !== ';' && args[end] !== '+') end++;
          if (isWrapperMediatedDelete(invoked, args.slice(i + 2, end))) {
            return `BLOCKED: "find ... ${args[i]} ${invoked} ..." (shell-wrapper-mediated delete) is forbidden. File deletion requires user confirmation (CLAUDE.md §1.5).`;
          }
        }
      }
    }

    // --- xargs rm/shred (stdin-derived targets can't be checked against
    // FORBIDDEN_TARGET/SAFE_LEAF, so a recursive/force flag on the invoked command is the signal) ---
    if (cmd === 'xargs') {
      // First non-flag token is the invoked command; skip xargs's own flags (-I, -n, -0, -P, ...),
      // including the value-consuming ones (-I repl, -n num).
      const XARGS_VALUE_FLAGS = new Set(['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-e', '-a', '--arg-file']);
      let i = 0;
      while (i < args.length && args[i].startsWith('-')) {
        i += XARGS_VALUE_FLAGS.has(args[i]) ? 2 : 1;
      }
      const invoked = stripExeSuffix((args[i] || '').split('/').pop().toLowerCase());
      if (DESTRUCTIVE_CMDS.has(invoked)) {
        const invokedArgs = args.slice(i + 1);
        const invokedFlags = invokedArgs.filter((t) => t.startsWith('-'));
        const recursiveOrForce = invokedFlags.some((f) => /^-[a-zA-Z]*[rRf]/.test(f)) || invokedFlags.includes('--recursive') || invokedFlags.includes('--force');
        if (recursiveOrForce) {
          return `BLOCKED: "xargs ... ${invoked}" with a recursive/force flag is forbidden (${raw}). Targets come from stdin and can't be safety-checked. File deletion requires user confirmation (CLAUDE.md §1.5).`;
        }
      }
      // Shell-wrapper-mediated delete: xargs sh -c 'rm -rf x' / xargs env rm -rf x
      // Everything after the invoked wrapper is fair game (no find-style terminator for xargs).
      if (isWrapperMediatedDelete(invoked, args.slice(i + 1))) {
        return `BLOCKED: "xargs ... ${invoked}" (shell-wrapper-mediated delete) is forbidden (${raw}). Targets come from stdin and can't be safety-checked. File deletion requires user confirmation (CLAUDE.md §1.5).`;
      }
    }

    // --- dd of=<path> / truncate -s 0 <path> (destructive overwrite) --------
    if (cmd === 'dd') {
      const ofArg = args.find((a) => a.startsWith('of='));
      if (ofArg) {
        const target = ofArg.slice(3).replace(/^["']|["']$/g, '');
        if (FORBIDDEN_TARGET.test(target)) {
          return `BLOCKED: "dd" overwriting "${target}" is forbidden (root/home/parent/absolute path). Confirm with user before proceeding.`;
        }
      }
    }
    if (cmd === 'truncate') {
      const hasZero = args.includes('-s') && args[args.indexOf('-s') + 1] === '0' ||
        args.some((a) => a === '-s0' || a === '--size=0');
      if (hasZero) {
        const targets = args.filter((t) => !t.startsWith('-') && t !== '0');
        for (const t of targets) {
          const unquoted = t.replace(/^["']|["']$/g, '');
          if (FORBIDDEN_TARGET.test(unquoted)) {
            return `BLOCKED: "truncate -s 0" targeting "${unquoted}" is forbidden (root/home/parent/absolute path). Confirm with user before proceeding.`;
          }
        }
      }
    }

    // --- PowerShell delete cmdlets (Remove-Item -Recurse, rd /s, del /s, ...) ---
    const psCmd = cmd.toLowerCase();
    if (PS_DELETE_CMDS.has(psCmd)) {
      const psTargets = psDeleteTargets(args, rawArgs);
      const psRecursive = args.some((t) => isPsRecurseFlag(t) || /^\/s$/i.test(t));
      const psInTmp = new Set(psTargets.filter((x) => !moved && isPsTmpTarget(root, cwd, x.value, raw, x.word)));
      for (const x of psTargets) {
        if (psInTmp.has(x)) continue;
        const unquoted = x.value.replace(/^["']|["']$/g, '').replace(/\\/g, '/');
        if (FORBIDDEN_TARGET.test(unquoted)) {
          return `BLOCKED: "${cmd}" targeting "${unquoted}" is forbidden (root/home/parent/absolute path). Confirm with user before proceeding.`;
        }
      }
      if (psRecursive) {
        const allSafe =
          !moved &&
          psTargets.length > 0 &&
          psTargets.every((x) => {
            if (psInTmp.has(x)) return true;
            const leaf = x.value.replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
            return SAFE_LEAF.test(leaf);
          });
        if (!allSafe) {
          const why = moved ? ' The command contains a location change (Set-Location/cd/Push-Location), so relative targets cannot be resolved.' : '';
          return `BLOCKED: Recursive delete detected (${raw}).${why} File deletion requires user confirmation (CLAUDE.md §1.5). Only disposable build dirs (node_modules, dist, ...) may be removed without asking.`;
        }
      }
    }
    if (psCmd === 'clear-content') {
      for (const t of args.filter((a) => !a.startsWith('-'))) {
        const unquoted = t.replace(/^["']|["']$/g, '').replace(/\\/g, '/');
        if (FORBIDDEN_TARGET.test(unquoted)) {
          return `BLOCKED: "Clear-Content" targeting "${unquoted}" is forbidden (root/home/parent/absolute path). Confirm with user before proceeding.`;
        }
      }
    }

    // --- rm/shred checks: workspace-root containment (user ruling 2026-08-12; see header) --------
    if (cmd !== 'rm' && cmd !== 'shred') continue;

    const targets = args.filter((t) => !t.startsWith('-'));

    for (const t of targets) {
      const unquoted = t.replace(/^["']|["']$/g, '');

      if (HOME_PREFIX.test(unquoted)) {
        return (
          `BLOCKED: "${cmd}" の削除対象「${unquoted}」はホームディレクトリ参照 (~) で、実際にどこを指すか` +
          `このフックでは確認できません。展開後の実際のパスを指定し直してください（CLAUDE.md §1.5）。`
        );
      }
      if (UNRESOLVABLE_TARGET.test(unquoted)) {
        return (
          `BLOCKED: "${cmd}" の削除対象「${unquoted}」はワイルドカード（* ? [ ]）または変数展開（$）を含み、` +
          `実際に何が消えるか事前に特定できません。展開後の実際のパスを1つずつ指定してください（CLAUDE.md §1.5）。`
        );
      }

      const { abs, outside, isRootItself } = classifyRmTarget(root, cwd, unquoted, useMsys && isStandaloneWord(raw, unquoted));
      if (outside) {
        return (
          `BLOCKED: "${cmd}" の削除対象「${unquoted}」（解決後のパス:「${abs}」）はワークスペース` +
          `「${root}」の外です。ワークスペース直下の削除は許可されていますが、外側は削除できません。` +
          `パスを確認し、ワークスペース内を指定し直してください。なお tasks/YYYY-MM・tasks/history・` +
          `tasks/*.md・plans/・dev/ は git 管理外のため、削除すると git 履歴からは復元できません` +
          `（CLAUDE.md §1.5）。`
        );
      }
      if (isRootItself) {
        return (
          `BLOCKED: "${cmd}" の削除対象「${unquoted}」はワークスペース「${root}」そのものです。` +
          `ワークスペース直下（中身）は削除できますが、ワークスペースという入れ物自体は削除できません。` +
          `削除したい中身のパスを指定し直してください（CLAUDE.md §1.5）。`
        );
      }
      // Strictly inside the workspace root: allowed regardless of leaf name -- this supersedes
      // SAFE_LEAF for rm/shred (see header). Falls through to the next target / segment.
    }
  }
  return null;
}
