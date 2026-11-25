// node --test .claude/hooks/lib/auto-merge-mode.test.js
// The pure rules behind scripts/auto-merge.mjs check / merge, on fixtures (no git, no network).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseGithubRemote,
  identityReasons,
  repoReasons,
  prReasons,
  settleMergeable,
  checksVerdict,
  repoRunsChecks,
  ghArgs,
  inspectRemote,
  mergeCommand,
  mergeOutcome,
} = require('./auto-merge-mode');

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const one = (reasons, re) => {
  assert.strictEqual(reasons.length, 1, JSON.stringify(reasons));
  assert.match(reasons[0], re);
};

test('parseGithubRemote: https with and without .git, the two ssh forms', () => {
  for (const url of [
    'https://github.com/Acme/prod.git',
    'https://github.com/Acme/prod',
    'https://github.com/Acme/prod/',
    'git@github.com:Acme/prod.git',
    'git@github.com:Acme/prod',
    'ssh://git@github.com/Acme/prod.git',
    '  https://github.com/Acme/prod.git\n',
  ]) {
    assert.deepStrictEqual(parseGithubRemote(url), { owner: 'Acme', name: 'prod' }, url);
  }
  assert.deepStrictEqual(parseGithubRemote('https://github.com/a-b/x.y_z-1.git'), { owner: 'a-b', name: 'x.y_z-1' });
});

test('parseGithubRemote: another host, credentials, extra path parts and garbage are null', () => {
  for (const url of [
    'https://gitlab.com/acme/prod.git',
    'https://github.com.evil.example/acme/prod.git',
    'https://example.invalid/github.com/acme/prod',
    'https://user:token@github.com/acme/prod.git',
    'http://github.com/acme/prod.git',
    'https://github.com/acme',
    'https://github.com/acme/prod/extra',
    'https://github.com/acme/..',
    'https://github.com/-acme/prod',
    'git@github.com:acme/prod/x.git',
    'git@gitlab.com:acme/prod.git',
    'D:/somewhere/local.git',
    '../prod',
    '',
    'garbage',
    null,
    undefined,
    42,
    { owner: 'acme', name: 'prod' },
  ]) {
    assert.strictEqual(parseGithubRemote(url), null, String(url));
  }
});

const P = { owner: 'acme', name: 'prod' };
const W = { owner: 'acme', name: 'ws' };

test('identityReasons: the normal case passes, on the strings alone and with the names GitHub returned', () => {
  assert.deepStrictEqual(identityReasons(P, W, null, null), []);
  assert.deepStrictEqual(identityReasons(P, W, 'acme/prod', 'acme/ws'), []);
  assert.deepStrictEqual(identityReasons(P, W, 'Acme/prod-renamed', 'ACME/ws'), [], 'a renamed product of the same owner passes');
});

test('identityReasons: another owner on the origin strings is refused', () => {
  one(identityReasons({ owner: 'other', name: 'x' }, W, null, null), /owner mismatch: the product's origin belongs to "other", the workspace to "acme"/);
});

test('identityReasons: origin strings equal to the workspace (other case, .git already dropped) are refused', () => {
  for (const p of [{ owner: 'acme', name: 'ws' }, { owner: 'ACME', name: 'WS' }, { owner: 'Acme', name: 'Ws' }]) {
    one(identityReasons(p, W, null, null), /the product's origin is the workspace repository itself/);
  }
});

test('identityReasons: the canonical name equals the workspace although the origin strings differ (other case, old name)', () => {
  one(identityReasons({ owner: 'acme', name: 'old-ws-name' }, W, 'acme/ws', 'acme/ws'), /reaches the workspace repository itself \("acme\/ws"\)/);
  one(identityReasons({ owner: 'acme', name: 'old-ws-name' }, W, 'ACME/WS', 'acme/ws'), /reaches the workspace repository itself/);
});

test('identityReasons: the canonical owner differs from the origin string owner (repository transferred away)', () => {
  one(identityReasons(P, W, 'someone-else/prod', 'acme/ws'), /owner mismatch on GitHub: the product repository is "someone-else\/prod", the workspace is "acme\/ws"/);
});

test('identityReasons: unreadable canonical names or unparsed origins are reasons (fail closed)', () => {
  for (const bad of ['', 'no-slash', 'a/b/c', 'acme/', undefined, 7, { x: 1 }]) {
    one(identityReasons(P, W, bad, 'acme/ws'), /GitHub's name for the product repository is unreadable/);
    one(identityReasons(P, W, 'acme/prod', bad), /GitHub's name for the workspace repository is unreadable/);
  }
  one(identityReasons(P, W, null, 'acme/ws'), /product repository is unreadable/);
  one(identityReasons(null, W, null, null), /not inspected/);
  one(identityReasons(P, null, 'acme/prod', 'acme/ws'), /not inspected/);
});

const REPO = { nameWithOwner: 'acme/prod', defaultBranchRef: { name: 'main' }, mergeCommitAllowed: true };

test('repoReasons: main / master with merge commits allowed pass', () => {
  assert.deepStrictEqual(repoReasons(REPO), []);
  assert.deepStrictEqual(repoReasons({ ...REPO, defaultBranchRef: { name: 'master' } }), []);
});

test('repoReasons: default branch develop, merge commits disallowed, unreadable data', () => {
  one(repoReasons({ ...REPO, defaultBranchRef: { name: 'develop' } }), /default branch is "develop" — only main \/ master/);
  one(repoReasons({ ...REPO, defaultBranchRef: null }), /default branch is undefined/);
  one(repoReasons({ ...REPO, mergeCommitAllowed: false }), /does not allow merge commits/);
  one(repoReasons({ ...REPO, mergeCommitAllowed: undefined }), /does not allow merge commits/);
  one(repoReasons({ ...REPO, mergeCommitAllowed: 'true' }), /does not allow merge commits/);
  assert.strictEqual(repoReasons({ nameWithOwner: 'acme/prod' }).length, 2);
  for (const bad of [null, undefined, 'x', []]) one(repoReasons(bad), /repository data unreadable/);
});

const PR = {
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  headRefName: '2026-11-25-topic',
  headRefOid: SHA,
  isCrossRepository: false,
  mergeable: 'MERGEABLE',
  statusCheckRollup: [],
};

test('prReasons: an open, mergeable PR on the pinned head passes (with and without the pin)', () => {
  assert.deepStrictEqual(prReasons(PR, 'main', SHA), { reasons: [], mergeable: 'MERGEABLE' });
  assert.deepStrictEqual(prReasons(PR, 'main', null), { reasons: [], mergeable: 'MERGEABLE' });
  assert.deepStrictEqual(prReasons({ ...PR, baseRefName: 'master' }, 'master', SHA).reasons, []);
});

test('prReasons: closed / merged with mergeable UNKNOWN gives only the state reason; mergeable is "not applicable"', () => {
  for (const state of ['MERGED', 'CLOSED']) {
    const v = prReasons({ ...PR, state, mergeable: 'UNKNOWN' }, 'main', null);
    one(v.reasons, new RegExp(`^state ${state} — only an OPEN PR is merged$`));
    assert.strictEqual(v.mergeable, 'not applicable');
  }
});

test('prReasons: a draft with mergeable UNKNOWN gives only the draft reason; mergeable is "not applicable"', () => {
  const v = prReasons({ ...PR, isDraft: true, mergeable: 'UNKNOWN' }, 'main', SHA);
  one(v.reasons, /the PR is a draft/);
  assert.strictEqual(v.mergeable, 'not applicable');
});

test('prReasons: open + UNKNOWN + another reason reports both', () => {
  const v = prReasons({ ...PR, mergeable: 'UNKNOWN', baseRefName: 'release' }, 'main', SHA);
  assert.strictEqual(v.reasons.length, 2, JSON.stringify(v.reasons));
  assert.match(v.reasons.join('\n'), /base is "release", not the default branch "main"/);
  assert.match(v.reasons.join('\n'), /mergeable still UNKNOWN after re-querying/);
  assert.strictEqual(v.mergeable, 'UNKNOWN');
});

test('prReasons: each single fault is one reason', () => {
  for (const [patch, re, sha = SHA] of [
    [{ baseRefName: 'develop' }, /base is "develop", not the default branch "main"/],
    [{ headRefName: 'main' }, /head branch is "main" — it must be a work branch/],
    [{ headRefName: undefined }, /head branch is undefined/],
    [{ isCrossRepository: true }, /another repository \(a fork\)/],
    [{ isCrossRepository: undefined }, /another repository \(a fork\)/],
    [{ mergeable: 'CONFLICTING' }, /mergeable CONFLICTING/],
    [{ mergeable: 'SOMETHING_NEW' }, /mergeable is SOMETHING_NEW, not MERGEABLE/],
    [{ mergeable: undefined }, /mergeable is undefined, not MERGEABLE/],
    [{ isDraft: undefined }, /draft flag unreadable/],
    [{ state: 'open' }, /state "open" — only an OPEN PR/],
    [{ state: undefined }, /state undefined/],
    [{ headRefOid: SHA2 }, new RegExp(`head moved: the PR head is ${SHA2}, not the reviewed commit "${SHA}"`)],
  ]) {
    one(prReasons({ ...PR, ...patch }, 'main', sha).reasons, re);
  }
});

test('prReasons: a bad head sha is a reason by itself, and a second one against the pin', () => {
  for (const bad of ['abc123', SHA.toUpperCase(), SHA + 'a', '', undefined, 7]) {
    one(prReasons({ ...PR, headRefOid: bad }, 'main', null).reasons, /head commit unreadable/);
    const pinned = prReasons({ ...PR, headRefOid: bad }, 'main', SHA).reasons;
    assert.strictEqual(pinned.length, 2, JSON.stringify(pinned));
    assert.match(pinned[1], /head moved: the PR head is unreadable/);
  }
});

test('prReasons: several reasons at once are all reported', () => {
  const v = prReasons(
    { state: 'OPEN', isDraft: false, baseRefName: 'develop', headRefName: 'main', headRefOid: SHA2, isCrossRepository: true, mergeable: 'CONFLICTING' },
    'main',
    SHA
  );
  assert.strictEqual(v.reasons.length, 5, JSON.stringify(v.reasons));
  for (const re of [/base is "develop"/, /head branch is "main"/, /another repository/, /head moved/, /mergeable CONFLICTING/]) {
    assert.ok(v.reasons.some((r) => re.test(r)), String(re));
  }
});

test('prReasons: an unknown default branch means the base is "not inspected", and unreadable PR data is a reason', () => {
  for (const branch of [undefined, null, 'develop', '']) {
    one(prReasons({ ...PR, baseRefName: branch }, branch, SHA).reasons, /base branch not inspected/);
  }
  for (const bad of [null, undefined, 'x', [], 3]) {
    assert.deepStrictEqual(prReasons(bad, 'main', SHA), { reasons: ['PR data unreadable'], mergeable: 'not inspected' });
  }
});

test('settleMergeable: UNKNOWN then MERGEABLE passes, with the later read (and its head) returned', () => {
  const reads = [
    { ...PR, mergeable: 'UNKNOWN', headRefOid: SHA },
    { ...PR, mergeable: 'UNKNOWN', headRefOid: SHA },
    { ...PR, mergeable: 'MERGEABLE', headRefOid: SHA2 },
  ];
  const slept = [];
  let n = 0;
  const pr = settleMergeable(() => reads[n++], (ms) => slept.push(ms));
  assert.strictEqual(n, 3);
  assert.deepStrictEqual(slept, [2000, 2000]);
  assert.strictEqual(pr.headRefOid, SHA2);
  assert.deepStrictEqual(prReasons(pr, 'main', SHA2).reasons, []);
  one(prReasons(pr, 'main', SHA).reasons, /head moved/);
});

test('settleMergeable: UNKNOWN on every read stops after 5 re-queries and is a reason', () => {
  let n = 0;
  let sleeps = 0;
  const pr = settleMergeable(() => (n++, { ...PR, mergeable: 'UNKNOWN' }), () => sleeps++);
  assert.strictEqual(n, 6, 'the first read plus 5 re-queries');
  assert.strictEqual(sleeps, 5);
  one(prReasons(pr, 'main', SHA).reasons, /mergeable still UNKNOWN after re-querying/);
});

test('settleMergeable: no re-query when mergeable is settled or is not judged (merged, closed, draft, unreadable)', () => {
  for (const first of [
    PR,
    { ...PR, mergeable: 'CONFLICTING' },
    { ...PR, state: 'MERGED', mergeable: 'UNKNOWN' },
    { ...PR, state: 'CLOSED', mergeable: 'UNKNOWN' },
    { ...PR, isDraft: true, mergeable: 'UNKNOWN' },
    null,
    'garbage',
  ]) {
    let n = 0;
    assert.strictEqual(settleMergeable(() => (n++, first), () => assert.fail('must not sleep')), first);
    assert.strictEqual(n, 1);
  }
});

test('settleMergeable: a PR that turns into a draft / gets merged while UNKNOWN stops being re-queried; a throwing read propagates', () => {
  const reads = [{ ...PR, mergeable: 'UNKNOWN' }, { ...PR, state: 'MERGED', mergeable: 'UNKNOWN' }];
  let n = 0;
  assert.strictEqual(settleMergeable(() => reads[n++], () => {}).state, 'MERGED');
  assert.strictEqual(n, 2);
  assert.throws(() => settleMergeable(() => { throw new Error('gh pr view failed'); }, () => {}), /gh pr view failed/);
});

const run = (status, conclusion) => ({ __typename: 'CheckRun', name: 'ci', status, conclusion });
const ctx = (state) => ({ __typename: 'StatusContext', context: 'ci/x', state });
const verdict = (rollup) => checksVerdict(rollup, false);
const ZERO = { passed: 0, failed: 0, pending: 0, unknown: 0 };

test('checksVerdict: no checks at all, on a repository that runs none, is "none" and not a reason', () => {
  assert.deepStrictEqual(checksVerdict([], false), { counts: ZERO, line: 'checks: none', reasons: [] });
});

test('checksVerdict: rollup [] while the repository is known to run checks is a "not yet" reason', () => {
  const v = checksVerdict([], true);
  assert.deepStrictEqual(v.counts, ZERO);
  assert.strictEqual(v.line, 'checks: none yet (this repository runs checks)');
  one(v.reasons, /^no checks are registered on this head yet, although the repository runs checks — re-run the same merge later$/);
});

test('checksVerdict: rollup [] when it could not be read whether the repository runs checks is a reason (fail closed)', () => {
  for (const unknown of [null, undefined, 0, '', 'false', 1, {}]) {
    const v = checksVerdict([], unknown);
    assert.strictEqual(v.line, 'checks: none listed (could not read whether the repository runs checks)');
    one(v.reasons, /lists no checks and it could not be read whether the repository runs any — not merged/);
  }
  one(checksVerdict([]).reasons, /could not be read whether/);
});

test('checksVerdict: a rollup with entries is judged the same whatever is known about the repository', () => {
  for (const known of [true, false, null, undefined]) {
    assert.deepStrictEqual(checksVerdict([run('COMPLETED', 'SUCCESS')], known).reasons, []);
    one(checksVerdict([run('COMPLETED', 'FAILURE')], known).reasons, /^1 check failed/);
  }
});

const WF = (...states) => ({ total_count: states.length, workflows: states.map((state) => ({ name: 'ci', state })) });
const TIP = (rollup) => ({ data: { repository: { defaultBranchRef: { target: { statusCheckRollup: rollup } } } } });

test('repoRunsChecks: no workflows and no checks on the default branch tip is false', () => {
  assert.strictEqual(repoRunsChecks(WF(), TIP(null)), false);
  assert.strictEqual(repoRunsChecks(WF('disabled_manually', 'disabled_inactivity', 'disabled_fork', 'deleted'), TIP(null)), false);
});

test('repoRunsChecks: an active (or unlisted-state) workflow, or checks on the default branch tip, is true', () => {
  assert.strictEqual(repoRunsChecks(WF('active'), TIP(null)), true);
  assert.strictEqual(repoRunsChecks(WF('disabled_manually', 'active'), TIP(null)), true);
  assert.strictEqual(repoRunsChecks(WF('some_new_state'), TIP(null)), true);
  assert.strictEqual(repoRunsChecks({ total_count: 1, workflows: [null] }, TIP(null)), true);
  assert.strictEqual(repoRunsChecks(WF('active'), 'unreadable'), true, 'an active workflow settles it without the tip');
  assert.strictEqual(repoRunsChecks(WF(), TIP({ state: 'FAILURE' })), true);
  assert.strictEqual(repoRunsChecks(WF(), TIP({ state: 'SUCCESS' })), true);
});

test('repoRunsChecks: anything unreadable or incomplete is null, never false', () => {
  for (const wf of [null, undefined, 'x', [], {}, { total_count: 0 }, { workflows: [] }, { total_count: '0', workflows: [] }]) {
    assert.strictEqual(repoRunsChecks(wf, TIP(null)), null, JSON.stringify(wf));
  }
  for (const tip of [null, undefined, 'x', {}, { data: null }, { data: { repository: null } }, { data: { repository: { defaultBranchRef: null } } },
    { data: { repository: { defaultBranchRef: { target: null } } } }, { data: { repository: { defaultBranchRef: { target: {} } } } }, TIP(undefined), TIP('SUCCESS'), TIP(0)]) {
    assert.strictEqual(repoRunsChecks(WF(), tip), null, JSON.stringify(tip));
  }
  assert.strictEqual(repoRunsChecks({ total_count: 101, workflows: [{ state: 'disabled_manually' }] }, TIP(null)), null, 'more workflows than were listed');
});

test('ghArgs: the exact argument lists', () => {
  assert.deepStrictEqual(ghArgs.repoView('acme/prod', 'nameWithOwner'), ['repo', 'view', 'acme/prod', '--json', 'nameWithOwner']);
  assert.deepStrictEqual(ghArgs.prView('5', 'acme/prod'), ['pr', 'view', '5', '--repo', 'acme/prod', '--json', 'state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup']);
  assert.deepStrictEqual(ghArgs.workflows('acme/prod'), ['api', 'repos/acme/prod/actions/workflows?per_page=100']);
  const tip = ghArgs.tipChecks('acme/prod');
  assert.deepStrictEqual([tip[0], tip[1], tip[2], tip.slice(4)], ['api', 'graphql', '-f', ['-f', 'o=acme', '-f', 'n=prod']]);
  assert.match(tip[3], /^query=query\(\$o:String!,\$n:String!\)\{repository\(owner:\$o,name:\$n\)\{defaultBranchRef\{target\{\.\.\. on Commit\{statusCheckRollup\{state\}\}\}\}\}\}$/);
  assert.deepStrictEqual(ghArgs.merge('5', 'acme/prod', SHA), ['pr', 'merge', '5', '--repo', 'acme/prod', '--merge', '--match-head-commit', SHA]);
});

test('mergeCommand: only with zero reasons, a read PR, and the pinned head; then exactly --repo <canonical> --merge --match-head-commit <head>', () => {
  const target = { repo: 'acme/prod-renamed', head: SHA };
  assert.deepStrictEqual(mergeCommand([], target, '5', SHA), ['pr', 'merge', '5', '--repo', 'acme/prod-renamed', '--merge', '--match-head-commit', SHA]);
  for (const [reasons, t, sha] of [
    [['state MERGED'], target, SHA],
    [[], null, SHA],
    [[], target, SHA2],
    [[], target, null],
    [[], { repo: 'acme/prod', head: SHA2 }, SHA],
    [[], { repo: 'acme/prod', head: 'abc' }, 'abc'],
    [[], { repo: 'no-slash', head: SHA }, SHA],
    [[], { repo: '--admin', head: SHA }, SHA],
    [[], { head: SHA }, SHA],
    [undefined, target, SHA],
    ['', target, SHA],
  ]) {
    assert.strictEqual(mergeCommand(reasons, t, '5', sha), null, JSON.stringify([reasons, t, sha]));
  }
});

test('mergeOutcome: exit 0 is merged; a gh failure is not merged; a timeout or kill is unknown', () => {
  assert.deepStrictEqual(mergeOutcome({ errorCode: null, signal: null, status: 0, stderr: '' }), { merged: true, why: '' });
  const failed = mergeOutcome({ errorCode: null, signal: null, status: 1, stderr: 'Head sha was changed\nmore' });
  assert.deepStrictEqual(failed, { merged: false, why: 'gh pr merge failed (exit 1): Head sha was changed' });
  assert.deepStrictEqual(mergeOutcome({ errorCode: 'ENOENT', signal: null, status: null }), { merged: false, why: 'gh could not be started (ENOENT)' });
  for (const r of [
    { errorCode: 'ETIMEDOUT', signal: 'SIGTERM', status: null },
    { errorCode: null, signal: 'SIGTERM', status: null },
    { errorCode: null, signal: null, status: null },
    { errorCode: 'ETIMEDOUT', signal: null, status: 0 },
    null,
    undefined,
  ]) {
    const o = mergeOutcome(r);
    assert.strictEqual(o.merged, null, JSON.stringify(r));
    assert.match(o.why, /did not finish|no result/);
  }
});

// inspectRemote on a fake io: json(args) answers by the kind of call and records every argument list.
const OPEN_PR = { ...PR, statusCheckRollup: [run('COMPLETED', 'SUCCESS')] };
function fakeIo(over = {}) {
  const calls = [];
  const answers = {
    product: { nameWithOwner: 'acme/prod', defaultBranchRef: { name: 'main' }, mergeCommitAllowed: true },
    workspace: { nameWithOwner: 'acme/ws' },
    pr: OPEN_PR,
    workflows: WF(),
    tip: TIP(null),
    ...over,
  };
  const kind = (a) =>
    a[0] === 'repo' ? (a[4] === 'nameWithOwner' ? 'workspace' : 'product') : a[0] === 'pr' ? 'pr' : a[1] === 'graphql' ? 'tip' : 'workflows';
  const io = {
    json(args) {
      calls.push(args);
      const answer = answers[kind(args)];
      const value = typeof answer === 'function' ? answer(calls.filter((c) => kind(c) === kind(args)).length) : answer;
      if (value instanceof Error) throw value;
      return value;
    },
    sleep: () => {},
  };
  return { io, calls, kinds: () => calls.map(kind) };
}
const INPUT = { product: P, workspace: W, prNumber: '5', expectedSha: SHA };

test('inspectRemote: everything holds — no reasons, the target is the canonical repo and the PR head, PR read by --repo <canonical>', () => {
  const f = fakeIo({ product: { nameWithOwner: 'acme/prod-renamed', defaultBranchRef: { name: 'main' }, mergeCommitAllowed: true } });
  const r = inspectRemote(INPUT, f.io);
  assert.deepStrictEqual(r.reasons, []);
  assert.strictEqual(r.skipped, null);
  assert.deepStrictEqual(r.target, { repo: 'acme/prod-renamed', head: SHA });
  assert.deepStrictEqual(r.info, { repo: 'acme/prod-renamed (origin: acme/prod)', head: SHA, mergeable: 'MERGEABLE', checks: 'checks: 1 passed, 0 failed, 0 pending, 0 unknown' });
  assert.deepStrictEqual(f.calls, [
    ghArgs.repoView('acme/prod', 'nameWithOwner,defaultBranchRef,mergeCommitAllowed'),
    ghArgs.repoView('acme/ws', 'nameWithOwner'),
    ghArgs.prView('5', 'acme/prod-renamed'),
  ]);
  assert.deepStrictEqual(mergeCommand(r.reasons, r.target, '5', SHA), ghArgs.merge('5', 'acme/prod-renamed', SHA));
});

test('inspectRemote: origin strings that fail identity end before any gh call', () => {
  for (const product of [{ owner: 'other', name: 'x' }, { owner: 'ACME', name: 'WS' }]) {
    const f = fakeIo();
    const r = inspectRemote({ ...INPUT, product }, f.io);
    assert.strictEqual(f.calls.length, 0);
    assert.strictEqual(r.reasons.length, 1);
    assert.strictEqual(r.skipped, 'the GitHub repository and the PR');
    assert.strictEqual(r.target, null);
  }
});

test('inspectRemote: a canonical name that is the workspace, or another owner, ends before the PR is read', () => {
  for (const [product, re] of [
    [{ nameWithOwner: 'ACME/WS', defaultBranchRef: { name: 'main' }, mergeCommitAllowed: true }, /reaches the workspace repository itself/],
    [{ nameWithOwner: 'someone-else/prod', defaultBranchRef: { name: 'main' }, mergeCommitAllowed: true }, /owner mismatch on GitHub/],
    [{ defaultBranchRef: { name: 'main' }, mergeCommitAllowed: true }, /name for the product repository is unreadable/],
    ['garbage', /name for the product repository is unreadable/],
  ]) {
    const f = fakeIo({ product });
    const r = inspectRemote(INPUT, f.io);
    one(r.reasons, re);
    assert.deepStrictEqual(f.kinds(), ['product', 'workspace']);
    assert.strictEqual(r.skipped, 'the PR');
    assert.strictEqual(r.target, null);
    assert.strictEqual(mergeCommand(r.reasons, r.target, '5', SHA), null);
  }
  const f = fakeIo({ workspace: {} });
  one(inspectRemote(INPUT, f.io).reasons, /name for the workspace repository is unreadable/);
  assert.deepStrictEqual(f.kinds(), ['product', 'workspace']);
});

test('inspectRemote: a failing gh call is a reason with its message, and ends the inspection', () => {
  let f = fakeIo({ product: new Error('gh repo view failed (exit 1): Could not resolve') });
  let r = inspectRemote(INPUT, f.io);
  assert.deepStrictEqual(r.reasons, ['gh repo view failed (exit 1): Could not resolve']);
  assert.deepStrictEqual([f.kinds(), r.skipped, r.target], [['product'], 'the GitHub repository and the PR', null]);
  f = fakeIo({ workspace: new Error('gh repo view failed (ETIMEDOUT)') });
  r = inspectRemote(INPUT, f.io);
  assert.deepStrictEqual([r.reasons, f.kinds(), r.skipped, r.target], [['gh repo view failed (ETIMEDOUT)'], ['product', 'workspace'], 'the GitHub repository and the PR', null]);
  f = fakeIo({ pr: new Error('gh pr view failed (exit 1)') });
  r = inspectRemote(INPUT, f.io);
  assert.deepStrictEqual([r.reasons, r.skipped, r.target], [['gh pr view failed (exit 1)'], 'the PR', null]);
});

test('inspectRemote: repository faults, PR faults, the head pin and failed checks are all carried into the reasons', () => {
  const f = fakeIo({
    product: { nameWithOwner: 'acme/prod', defaultBranchRef: { name: 'develop' }, mergeCommitAllowed: false },
    pr: { ...PR, state: 'CLOSED', headRefOid: SHA2, statusCheckRollup: [run('COMPLETED', 'FAILURE'), run('IN_PROGRESS', '')] },
  });
  const r = inspectRemote(INPUT, f.io);
  for (const re of [/default branch is "develop"/, /does not allow merge commits/, /state CLOSED/, /base branch not inspected/, /head moved: the PR head is b{40}/, /^1 check failed/, /^1 check still running/]) {
    assert.ok(r.reasons.some((x) => re.test(x)), `${re} in ${JSON.stringify(r.reasons)}`);
  }
  assert.strictEqual(r.reasons.length, 7);
  assert.deepStrictEqual(r.info, { repo: 'acme/prod (origin: acme/prod)', head: SHA2, mergeable: 'not applicable', checks: 'checks: 0 passed, 1 failed, 1 pending, 0 unknown' });
  assert.strictEqual(r.skipped, null);
  assert.strictEqual(mergeCommand(r.reasons, r.target, '5', SHA), null);
});

test('inspectRemote: a single fault in each part is enough to refuse', () => {
  for (const [over, re, input = INPUT] of [
    [{ product: { nameWithOwner: 'acme/prod', defaultBranchRef: { name: 'main' }, mergeCommitAllowed: false } }, /does not allow merge commits/],
    [{ pr: { ...OPEN_PR, isDraft: true } }, /the PR is a draft/],
    [{ pr: { ...OPEN_PR, baseRefName: 'release' } }, /base is "release"/],
    [{ pr: { ...OPEN_PR, headRefOid: SHA2 } }, /head moved/],
    [{}, /head moved/, { ...INPUT, expectedSha: SHA2 }],
    [{ pr: { ...OPEN_PR, statusCheckRollup: [run('COMPLETED', 'FAILURE')] } }, /^1 check failed/],
    [{ pr: { ...OPEN_PR, statusCheckRollup: [run('QUEUED', '')] } }, /^1 check still running/],
    [{ pr: { ...OPEN_PR, statusCheckRollup: null } }, /check results could not be read/],
    [{ pr: 'garbage' }, /PR data unreadable/],
  ]) {
    const r = inspectRemote(input, fakeIo(over).io);
    assert.ok(r.reasons.length >= 1 && r.reasons.some((x) => re.test(x)), `${re} in ${JSON.stringify(r.reasons)}`);
    assert.strictEqual(mergeCommand(r.reasons, r.target, input.prNumber, input.expectedSha), null);
  }
  assert.strictEqual(inspectRemote(INPUT, fakeIo({ pr: 'garbage' }).io).target, null, 'no target without a readable PR head');
});

test('inspectRemote: mergeable UNKNOWN is re-read through io, and the settled read is the one judged', () => {
  const f = fakeIo({ pr: (n) => (n < 3 ? { ...OPEN_PR, mergeable: 'UNKNOWN' } : OPEN_PR) });
  const r = inspectRemote(INPUT, f.io);
  assert.deepStrictEqual(r.reasons, []);
  assert.strictEqual(f.kinds().filter((k) => k === 'pr').length, 3);
  const stuck = fakeIo({ pr: { ...OPEN_PR, mergeable: 'UNKNOWN' } });
  one(inspectRemote(INPUT, stuck.io).reasons, /mergeable still UNKNOWN/);
  assert.strictEqual(stuck.kinds().filter((k) => k === 'pr').length, 6);
});

test('inspectRemote: an empty rollup asks whether the repository runs checks — none: no reason; runs checks: "not yet"; unreadable: refused', () => {
  const empty = { ...PR, statusCheckRollup: [] };
  let f = fakeIo({ pr: empty });
  let r = inspectRemote(INPUT, f.io);
  assert.deepStrictEqual([r.reasons, r.info.checks], [[], 'checks: none']);
  assert.deepStrictEqual(f.calls.slice(3), [ghArgs.workflows('acme/prod'), ghArgs.tipChecks('acme/prod')]);
  assert.deepStrictEqual(r.target, { repo: 'acme/prod', head: SHA });

  for (const over of [{ workflows: WF('active') }, { tip: TIP({ state: 'FAILURE' }) }]) {
    r = inspectRemote(INPUT, fakeIo({ pr: empty, ...over }).io);
    one(r.reasons, /no checks are registered on this head yet, although the repository runs checks — re-run the same merge later/);
    assert.strictEqual(r.info.checks, 'checks: none yet (this repository runs checks)');
    assert.strictEqual(mergeCommand(r.reasons, r.target, '5', SHA), null);
  }

  for (const over of [{ workflows: 'garbage' }, { tip: {} }]) {
    r = inspectRemote(INPUT, fakeIo({ pr: empty, ...over }).io);
    one(r.reasons, /could not be read whether the repository runs any — not merged/);
  }
  for (const over of [{ workflows: new Error('gh api repos/acme/prod/actions/workflows?per_page=100 failed (exit 1)') }, { tip: new Error('gh api graphql failed (ETIMEDOUT)') }]) {
    r = inspectRemote(INPUT, fakeIo({ pr: empty, ...over }).io);
    assert.strictEqual(r.reasons.length, 2, JSON.stringify(r.reasons));
    assert.match(r.reasons[0], /^gh api .* failed/);
    assert.match(r.reasons[1], /could not be read whether the repository runs any — not merged/);
    assert.strictEqual(mergeCommand(r.reasons, r.target, '5', SHA), null);
  }
});

test('inspectRemote: a rollup with entries never asks about workflows', () => {
  const f = fakeIo({ workflows: new Error('must not be called'), tip: new Error('must not be called') });
  assert.deepStrictEqual(inspectRemote(INPUT, f.io).reasons, []);
  assert.deepStrictEqual(f.kinds(), ['product', 'workspace', 'pr']);
});

for (const [name, entry, cls] of [
  ['check run QUEUED', run('QUEUED', ''), 'pending'],
  ['check run IN_PROGRESS', run('IN_PROGRESS', ''), 'pending'],
  ['check run WAITING', run('WAITING', ''), 'pending'],
  ['check run PENDING', run('PENDING', ''), 'pending'],
  ['check run REQUESTED', run('REQUESTED', ''), 'pending'],
  ['check run COMPLETED / SUCCESS', run('COMPLETED', 'SUCCESS'), 'passed'],
  ['check run COMPLETED / NEUTRAL', run('COMPLETED', 'NEUTRAL'), 'passed'],
  ['check run COMPLETED / SKIPPED', run('COMPLETED', 'SKIPPED'), 'passed'],
  ['check run COMPLETED / FAILURE', run('COMPLETED', 'FAILURE'), 'failed'],
  ['check run COMPLETED / TIMED_OUT', run('COMPLETED', 'TIMED_OUT'), 'failed'],
  ['check run COMPLETED / CANCELLED', run('COMPLETED', 'CANCELLED'), 'failed'],
  ['check run COMPLETED / ACTION_REQUIRED', run('COMPLETED', 'ACTION_REQUIRED'), 'failed'],
  ['check run COMPLETED / STARTUP_FAILURE', run('COMPLETED', 'STARTUP_FAILURE'), 'failed'],
  ['check run COMPLETED / STALE', run('COMPLETED', 'STALE'), 'failed'],
  ['commit status SUCCESS', ctx('SUCCESS'), 'passed'],
  ['commit status FAILURE', ctx('FAILURE'), 'failed'],
  ['commit status ERROR', ctx('ERROR'), 'failed'],
  ['commit status PENDING', ctx('PENDING'), 'pending'],
  ['commit status EXPECTED', ctx('EXPECTED'), 'pending'],
  ['unknown conclusion', run('COMPLETED', 'SOMETHING_NEW'), 'unknown'],
  ['empty conclusion on a completed run', run('COMPLETED', ''), 'unknown'],
  ['missing conclusion on a completed run', { status: 'COMPLETED' }, 'unknown'],
  ['unknown status', run('SOMETHING_NEW', 'SUCCESS'), 'unknown'],
  ['lower-case status', run('completed', 'SUCCESS'), 'unknown'],
  ['a status that is not a string, beside a passing state', { status: 1, state: 'SUCCESS' }, 'unknown'],
  ['unknown commit status state', ctx('SOMETHING_NEW'), 'unknown'],
  ['a prototype key as state', ctx('constructor'), 'unknown'],
  ['an entry with neither status nor state', { name: 'ci' }, 'unknown'],
  ['an entry that is null', null, 'unknown'],
  ['an entry that is a string', 'SUCCESS', 'unknown'],
  ['an entry that is an array', [run('COMPLETED', 'SUCCESS')], 'unknown'],
]) {
  test(`checksVerdict: ${name} is ${cls}`, () => {
    const v = verdict([entry]);
    assert.deepStrictEqual(v.counts, { passed: 0, failed: 0, pending: 0, unknown: 0, [cls]: 1 });
    assert.strictEqual(v.line, `checks: ${v.counts.passed} passed, ${v.counts.failed} failed, ${v.counts.pending} pending, ${v.counts.unknown} unknown`);
    if (cls === 'passed') assert.deepStrictEqual(v.reasons, []);
    if (cls === 'failed') one(v.reasons, /^1 check failed — not merged; fix the cause and run merge again with the new head, or report to the owner$/);
    if (cls === 'pending') one(v.reasons, /^1 check still running — re-run the same merge later$/);
    if (cls === 'unknown') one(v.reasons, /^1 check in a state this script does not know — not merged$/);
  });
}

test('checksVerdict: all passed is no reason; one failed among passed is a reason; counts line in each case', () => {
  const ok = verdict([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), ctx('SUCCESS')]);
  assert.deepStrictEqual(ok.reasons, []);
  assert.strictEqual(ok.line, 'checks: 3 passed, 0 failed, 0 pending, 0 unknown');
  const bad = verdict([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'FAILURE'), ctx('SUCCESS')]);
  one(bad.reasons, /^1 check failed/);
  assert.strictEqual(bad.line, 'checks: 2 passed, 1 failed, 0 pending, 0 unknown');
});

test('checksVerdict: pending only is a reason; failed + pending + unknown are all counted and all reported', () => {
  const pend = verdict([run('IN_PROGRESS', ''), ctx('PENDING')]);
  one(pend.reasons, /^2 checks still running/);
  assert.strictEqual(pend.line, 'checks: 0 passed, 0 failed, 2 pending, 0 unknown');
  const mix = verdict([run('COMPLETED', 'FAILURE'), ctx('ERROR'), run('QUEUED', ''), run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'WHAT')]);
  assert.strictEqual(mix.line, 'checks: 1 passed, 2 failed, 1 pending, 1 unknown');
  assert.deepStrictEqual(mix.reasons.map((r) => r.split(' — ')[0]), ['2 checks failed', '1 check still running', '1 check in a state this script does not know']);
});

test('checksVerdict: a rollup that is not an array is unknown and a reason, never read as one check', () => {
  for (const bad of [null, undefined, 'SUCCESS', 0, {}, run('COMPLETED', 'SUCCESS'), { length: 0 }]) {
    const v = verdict(bad);
    assert.deepStrictEqual(v.counts, { passed: 0, failed: 0, pending: 0, unknown: 1 });
    assert.strictEqual(v.line, 'checks: 0 passed, 0 failed, 0 pending, 1 unknown');
    one(v.reasons, /the check results could not be read \(not a list\) — not merged/);
  }
});
