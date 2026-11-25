// Auto-merge switch (CLAUDE.md §0, "Auto-merge"): .claude/auto-merge.json = { "enabled": true }.
// Present and valid = on; absent = off; anything malformed = off, with the problem returned so the
// callers (session-start.js, scripts/auto-merge.mjs, validate.mjs) can surface it. Never throws, and
// never echoes file-derived values (only their type), so a hostile or huge file cannot crash a caller.

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join('.claude', 'auto-merge.json');
const ON_JSON = JSON.stringify({ enabled: true }, null, 2) + '\n';

const modeFile = (root) => path.join(root, FILE);

function readAutoMergeMode(root) {
  let text;
  try {
    text = fs.readFileSync(modeFile(root), 'utf8');
  } catch (e) {
    return e && e.code === 'ENOENT' ? { on: false } : { on: false, error: `cannot read ${FILE}: ${(e && e.code) || 'error'}` };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { on: false, error: `${FILE} is not valid JSON` };
  }
  try {
    const ok =
      data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).join(',') === 'enabled' && data.enabled === true;
    if (ok) return { on: true };
    const got = data && typeof data === 'object' && !Array.isArray(data) ? `enabled is ${typeof data.enabled}` : Array.isArray(data) ? 'array' : typeof data;
    return { on: false, error: `${FILE} must be exactly { "enabled": true } (got ${got})` };
  } catch {
    return { on: false, error: `${FILE} must be exactly { "enabled": true }` };
  }
}

// ---- The pure checks of scripts/auto-merge.mjs check / merge. No fs, git or network here, so every
// rule is unit-tested on fixtures. Each returns reasons (strings); any reason means "do not merge".
// Values that came from GitHub or a remote URL are echoed only through show().

const show = (v) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 80)) : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const NAME = '[A-Za-z0-9._-]+';
const REMOTE_FORMS = [
  new RegExp(`^https://github\\.com/(${OWNER})/(${NAME}?)(?:\\.git)?/?$`),
  new RegExp(`^git@github\\.com:(${OWNER})/(${NAME}?)(?:\\.git)?/?$`),
  new RegExp(`^ssh://git@github\\.com/(${OWNER})/(${NAME}?)(?:\\.git)?/?$`),
];
const CANONICAL = new RegExp(`^(${OWNER})/(${NAME})$`);
const SHA = /^[0-9a-f]{40}$/;
const DEFAULT_BRANCHES = ['main', 'master']; // the names block-direct-to-main.js protects

// "https://github.com/o/n(.git)", "git@github.com:o/n(.git)", "ssh://git@github.com/o/n(.git)" -> { owner, name }.
// Anything else (another host, credentials in the URL, extra path parts, not a string) -> null.
function parseGithubRemote(url) {
  if (typeof url !== 'string') return null;
  for (const re of REMOTE_FORMS) {
    const m = re.exec(url.trim());
    if (m && m[2] !== '.' && m[2] !== '..') return { owner: m[1], name: m[2] };
  }
  return null;
}

const lower = (p) => `${p.owner}/${p.name}`.toLowerCase();

// Step 4. product / workspace: parsed origins. productCanonical / workspaceCanonical: the nameWithOwner
// GitHub returned for them, or null before GitHub was asked (then only the origin strings are judged).
function identityReasons(product, workspace, productCanonical, workspaceCanonical) {
  if (!isObj(product) || !isObj(workspace)) return ['repository identity not inspected (an origin could not be read)'];
  const reasons = [];
  if (product.owner.toLowerCase() !== workspace.owner.toLowerCase()) {
    reasons.push(`owner mismatch: the product's origin belongs to ${show(product.owner)}, the workspace to ${show(workspace.owner)} — only the workspace owner's own products are auto-merged`);
  }
  if (lower(product) === lower(workspace)) reasons.push("the product's origin is the workspace repository itself — workspace PRs are never auto-merged");
  if (productCanonical === null && workspaceCanonical === null) return reasons;
  const pc = typeof productCanonical === 'string' ? CANONICAL.exec(productCanonical) : null;
  const wc = typeof workspaceCanonical === 'string' ? CANONICAL.exec(workspaceCanonical) : null;
  if (!pc) reasons.push(`GitHub's name for the product repository is unreadable (${show(productCanonical)})`);
  if (!wc) reasons.push(`GitHub's name for the workspace repository is unreadable (${show(workspaceCanonical)})`);
  if (!pc || !wc) return reasons;
  if (pc[1].toLowerCase() !== wc[1].toLowerCase()) {
    reasons.push(`owner mismatch on GitHub: the product repository is ${show(productCanonical)}, the workspace is ${show(workspaceCanonical)} — only the workspace owner's own products are auto-merged`);
  }
  if (productCanonical.toLowerCase() === workspaceCanonical.toLowerCase()) {
    reasons.push(`the product's origin reaches the workspace repository itself (${show(workspaceCanonical)}) — workspace PRs are never auto-merged`);
  }
  return reasons;
}

// Step 5, on `gh repo view --json nameWithOwner,defaultBranchRef,mergeCommitAllowed`.
function repoReasons(repo) {
  if (!isObj(repo)) return ['repository data unreadable'];
  const reasons = [];
  const branch = isObj(repo.defaultBranchRef) ? repo.defaultBranchRef.name : undefined;
  if (!DEFAULT_BRANCHES.includes(branch)) reasons.push(`default branch is ${show(branch)} — only main / master are merged into`);
  if (repo.mergeCommitAllowed !== true) reasons.push('the repository does not allow merge commits (the only merge style used here)');
  return reasons;
}

const mergeableJudged = (pr) => isObj(pr) && pr.state === 'OPEN' && pr.isDraft === false;

// Steps 6 and 7, on one `gh pr view --json state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,...`.
// expectedSha: the head the caller reviewed (null = not given, check only). Returns { reasons, mergeable },
// mergeable being the text to print ("not applicable" when it is not judged: only an open, non-draft PR has one).
function prReasons(pr, defaultBranch, expectedSha) {
  if (!isObj(pr)) return { reasons: ['PR data unreadable'], mergeable: 'not inspected' };
  const reasons = [];
  if (pr.state !== 'OPEN') reasons.push(`state ${typeof pr.state === 'string' && /^[A-Z_]{1,20}$/.test(pr.state) ? pr.state : show(pr.state)} — only an OPEN PR is merged`);
  if (pr.isDraft !== false) reasons.push(pr.isDraft === true ? 'the PR is a draft' : `draft flag unreadable (${show(pr.isDraft)})`);
  if (!DEFAULT_BRANCHES.includes(defaultBranch)) reasons.push('base branch not inspected (the default branch is not main / master)');
  else {
    if (pr.baseRefName !== defaultBranch) reasons.push(`base is ${show(pr.baseRefName)}, not the default branch "${defaultBranch}"`);
    if (typeof pr.headRefName !== 'string' || !pr.headRefName || pr.headRefName === defaultBranch) {
      reasons.push(`head branch is ${show(pr.headRefName)} — it must be a work branch, not the default branch`);
    }
  }
  if (pr.isCrossRepository !== false) reasons.push('the PR comes from another repository (a fork), or that could not be read');
  const head = typeof pr.headRefOid === 'string' && SHA.test(pr.headRefOid) ? pr.headRefOid : null;
  if (!head) reasons.push(`head commit unreadable (${show(pr.headRefOid)})`);
  if (expectedSha !== null && head !== expectedSha) {
    reasons.push(`head moved: the PR head is ${head || 'unreadable'}, not the reviewed commit ${show(expectedSha)} — the new head has not passed the gate`);
  }
  let mergeable = 'not applicable';
  if (mergeableJudged(pr)) {
    mergeable = typeof pr.mergeable === 'string' && /^[A-Z_]{1,20}$/.test(pr.mergeable) ? pr.mergeable : show(pr.mergeable);
    if (pr.mergeable === 'CONFLICTING') reasons.push('mergeable CONFLICTING — the PR conflicts with its base');
    else if (pr.mergeable === 'UNKNOWN') reasons.push('mergeable still UNKNOWN after re-querying — re-run the same command once');
    else if (pr.mergeable !== 'MERGEABLE') reasons.push(`mergeable is ${mergeable}, not MERGEABLE`);
  }
  return { reasons, mergeable };
}

// GitHub answers mergeable: UNKNOWN for a few seconds after a PR is created or pushed. Re-read the whole
// PR (so the head that is judged is the one that was settled) up to `tries` more times, `waitMs` apart.
// fetchPr and sleep are injected; a throw from fetchPr goes to the caller.
function settleMergeable(fetchPr, sleep, tries = 5, waitMs = 2000) {
  let pr = fetchPr();
  for (let i = 0; i < tries && mergeableJudged(pr) && pr.mergeable === 'UNKNOWN'; i++) {
    sleep(waitMs);
    pr = fetchPr();
  }
  return pr;
}

const RUN_PENDING = ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED'];
const RUN_PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
const RUN_FAILED = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'];
const STATUS_CLASS = { SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'pending', EXPECTED: 'pending' };

function classifyCheck(e) {
  if (!isObj(e)) return 'unknown';
  if (typeof e.status === 'string' && e.status) {
    if (RUN_PENDING.includes(e.status)) return 'pending';
    if (e.status !== 'COMPLETED') return 'unknown';
    return RUN_PASSED.includes(e.conclusion) ? 'passed' : RUN_FAILED.includes(e.conclusion) ? 'failed' : 'unknown';
  }
  if (e.status !== undefined && e.status !== null && e.status !== '') return 'unknown';
  return (typeof e.state === 'string' && Object.prototype.hasOwnProperty.call(STATUS_CLASS, e.state) && STATUS_CLASS[e.state]) || 'unknown';
}

// Does this repository run checks at all? Asked only when a PR lists none, to tell "no checks" from "not
// registered yet" (GitHub registers check runs a moment after a push). workflows: `gh api
// repos/<o>/<n>/actions/workflows`; tip: the GraphQL answer for the default branch tip's statusCheckRollup.
// true = an Actions workflow that is not switched off, or checks on the default branch tip (any app);
// false = neither, read in full; null = could not be read (the caller refuses).
const WORKFLOW_OFF = ['disabled_manually', 'disabled_inactivity', 'disabled_fork', 'deleted'];
function repoRunsChecks(workflows, tip) {
  if (!isObj(workflows) || !Array.isArray(workflows.workflows) || !Number.isInteger(workflows.total_count)) return null;
  if (workflows.workflows.some((w) => !isObj(w) || !WORKFLOW_OFF.includes(w.state))) return true;
  const target = isObj(tip) && isObj(tip.data) && isObj(tip.data.repository) && isObj(tip.data.repository.defaultBranchRef) ? tip.data.repository.defaultBranchRef.target : null;
  if (!isObj(target) || !Object.prototype.hasOwnProperty.call(target, 'statusCheckRollup')) return null;
  if (target.statusCheckRollup !== null) return isObj(target.statusCheckRollup) ? true : null;
  return workflows.total_count > workflows.workflows.length ? null : false;
}

// Step 8, on statusCheckRollup. Any failed, pending or unknown entry is a reason. No entries at all is not a
// reason only when runsChecks is exactly false (repoRunsChecks): true means the checks are not registered yet,
// anything else that it could not be read.
function checksVerdict(rollup, runsChecks) {
  const counts = { passed: 0, failed: 0, pending: 0, unknown: 0 };
  if (Array.isArray(rollup) && !rollup.length && runsChecks !== false) {
    return runsChecks === true
      ? { counts, line: 'checks: none yet (this repository runs checks)', reasons: ['no checks are registered on this head yet, although the repository runs checks — re-run the same merge later'] }
      : { counts, line: 'checks: none listed (could not read whether the repository runs checks)', reasons: ['the PR lists no checks and it could not be read whether the repository runs any — not merged'] };
  }
  const listed = Array.isArray(rollup);
  if (listed) for (const e of rollup) counts[classifyCheck(e)]++;
  else counts.unknown = 1; // the rollup itself is the unknown thing; its content is never read as one check
  const n = (k) => `${counts[k]} check${counts[k] === 1 ? '' : 's'}`;
  const reasons = [];
  if (counts.failed) reasons.push(`${n('failed')} failed — not merged; fix the cause and run merge again with the new head, or report to the owner`);
  if (counts.pending) reasons.push(`${n('pending')} still running — re-run the same merge later`);
  if (counts.unknown) reasons.push(listed ? `${n('unknown')} in a state this script does not know — not merged` : 'the check results could not be read (not a list) — not merged');
  const line =
    listed && !rollup.length
      ? 'checks: none'
      : `checks: ${counts.passed} passed, ${counts.failed} failed, ${counts.pending} pending, ${counts.unknown} unknown`;
  return { counts, line, reasons };
}

// The exact gh argument lists scripts/auto-merge.mjs runs (no shell). Every call after the first two names
// the repository by the canonical name GitHub returned.
const REPO_FIELDS = 'nameWithOwner,defaultBranchRef,mergeCommitAllowed';
const PR_FIELDS = 'state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup';
const TIP_QUERY = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){defaultBranchRef{target{... on Commit{statusCheckRollup{state}}}}}}';
const ghArgs = {
  repoView: (name, fields) => ['repo', 'view', name, '--json', fields],
  prView: (pr, repo) => ['pr', 'view', pr, '--repo', repo, '--json', PR_FIELDS],
  workflows: (repo) => ['api', `repos/${repo}/actions/workflows?per_page=100`],
  tipChecks: (repo) => ['api', 'graphql', '-f', `query=${TIP_QUERY}`, '-f', `o=${repo.split('/')[0]}`, '-f', `n=${repo.split('/')[1]}`],
  merge: (pr, repo, head) => ['pr', 'merge', pr, '--repo', repo, '--merge', '--match-head-commit', head],
};

// Steps 4-8 as one composition. product / workspace: parsed origins (both non-null). io.json(args) runs gh
// with that argument list and returns the parsed JSON, or throws an Error whose message is printable;
// io.sleep(ms) waits. Returns { reasons, info, target, skipped }: target = { repo, head } only when the PR
// itself was read; skipped names what was not inspected when a reason ended the inspection early.
const REMOTE = 'the GitHub repository and the PR';
function inspectRemote({ product, workspace, prNumber, expectedSha }, io) {
  const reasons = [];
  const info = { repo: 'not inspected', head: 'not inspected', mergeable: 'not inspected', checks: 'checks: not inspected' };
  const end = (skipped, target = null) => ({ reasons, info, target, skipped });
  const said = (e) => String((e && e.message) || 'a gh call failed').slice(0, 300);
  const read = (args) => {
    try {
      return { value: io.json(args) };
    } catch (e) {
      reasons.push(said(e));
      return null;
    }
  };

  const early = identityReasons(product, workspace, null, null);
  if (early.length) {
    reasons.push(...early);
    return end(REMOTE);
  }
  const repoRead = read(ghArgs.repoView(`${product.owner}/${product.name}`, REPO_FIELDS));
  const wsRead = repoRead && read(ghArgs.repoView(`${workspace.owner}/${workspace.name}`, 'nameWithOwner'));
  if (!repoRead || !wsRead) return end(REMOTE);
  const repo = repoRead.value;
  const canonical = isObj(repo) ? repo.nameWithOwner : undefined;
  const identity = identityReasons(product, workspace, canonical ?? '', isObj(wsRead.value) ? (wsRead.value.nameWithOwner ?? '') : '');
  if (identity.length) {
    reasons.push(...identity);
    return end('the PR');
  }
  info.repo = `${canonical} (origin: ${product.owner}/${product.name})`;
  reasons.push(...repoReasons(repo));
  const defaultBranch = isObj(repo.defaultBranchRef) ? repo.defaultBranchRef.name : undefined;

  let pr;
  try {
    pr = settleMergeable(() => io.json(ghArgs.prView(prNumber, canonical)), io.sleep);
  } catch (e) {
    reasons.push(said(e));
    return end('the PR');
  }
  const verdict = prReasons(pr, defaultBranch, expectedSha);
  reasons.push(...verdict.reasons);
  info.mergeable = verdict.mergeable;
  const head = isObj(pr) && typeof pr.headRefOid === 'string' && SHA.test(pr.headRefOid) ? pr.headRefOid : null;
  info.head = head || 'unreadable';
  const rollup = isObj(pr) ? pr.statusCheckRollup : undefined;
  let runsChecks = null;
  if (Array.isArray(rollup) && !rollup.length) {
    const workflows = read(ghArgs.workflows(canonical));
    const tip = workflows && read(ghArgs.tipChecks(canonical));
    if (tip) runsChecks = repoRunsChecks(workflows.value, tip.value);
  }
  const checks = checksVerdict(rollup, runsChecks);
  info.checks = checks.line;
  reasons.push(...checks.reasons);
  return end(null, head ? { repo: canonical, head } : null);
}

// The merge is run only with zero reasons, a PR that was read, and a caller-pinned head equal to the PR's
// head. Returns the gh argument list, or null (then nothing is run).
function mergeCommand(reasons, target, prNumber, expectedSha) {
  if (!Array.isArray(reasons) || reasons.length) return null;
  if (!isObj(target) || typeof target.repo !== 'string' || !CANONICAL.test(target.repo)) return null;
  if (typeof expectedSha !== 'string' || !SHA.test(expectedSha) || target.head !== expectedSha) return null;
  return ghArgs.merge(prNumber, target.repo, target.head);
}

// What the finished `gh pr merge` process says about the merge. r = { errorCode, signal, status, stderr }.
// merged: true / false / null. null = the command was started but did not report back (timeout, killed):
// the merge may have happened, so the caller must look at the PR instead of retrying.
function mergeOutcome(r) {
  if (!isObj(r)) return { merged: null, why: 'no result from the merge command' };
  if (!r.errorCode && !r.signal && r.status === 0) return { merged: true, why: '' };
  if (r.errorCode === 'ENOENT') return { merged: false, why: 'gh could not be started (ENOENT)' };
  if (r.errorCode || r.signal || typeof r.status !== 'number') {
    return { merged: null, why: `gh pr merge did not finish (${r.errorCode || r.signal || 'no exit status'})` };
  }
  const first = String(r.stderr || '').trim().split(/\r?\n/)[0].slice(0, 200);
  return { merged: false, why: `gh pr merge failed (exit ${r.status})${first ? `: ${first}` : ''}` };
}

module.exports = {
  repoRunsChecks,
  ghArgs,
  inspectRemote,
  mergeCommand,
  mergeOutcome,
  FILE,
  ON_JSON,
  modeFile,
  readAutoMergeMode,
  parseGithubRemote,
  identityReasons,
  repoReasons,
  prReasons,
  settleMergeable,
  checksVerdict,
};
