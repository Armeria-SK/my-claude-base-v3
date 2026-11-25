// node --test .claude/hooks/lib/auto-merge-mode.test.js
// The pure rules behind scripts/auto-merge.mjs check / merge, on fixtures (no git, no network).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseGithubRemote, identityReasons, repoReasons, prReasons, settleMergeable, checksVerdict } = require('./auto-merge-mode');

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
const verdict = (rollup) => checksVerdict(rollup);

test('checksVerdict: no checks at all is "none" and not a reason', () => {
  assert.deepStrictEqual(verdict([]), { counts: { passed: 0, failed: 0, pending: 0, unknown: 0 }, line: 'checks: none', reasons: [] });
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
