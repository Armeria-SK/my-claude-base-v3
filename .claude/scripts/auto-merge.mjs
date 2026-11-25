#!/usr/bin/env node
// Auto-merge (CLAUDE.md §0): node .claude/scripts/auto-merge.mjs [off|status]   (on: only the owner, by typing /auto-merge on)
//                            node .claude/scripts/auto-merge.mjs check <product> <PR#> [<head-sha>]
//                            node .claude/scripts/auto-merge.mjs merge <product> <PR#> <head-sha>
// merge merges one PR of the dev/<product> repo into its default branch with a merge commit, and only when
// every check below holds; check prints the same verdict and merges nothing. Every reason is collected and
// printed as "REFUSED: ..."; anything that cannot be inspected is a reason (fail closed). The workspace
// repository itself can never be the target. The pure rules live in ../hooks/lib/auto-merge-mode.js.
// check / merge take the workspace root from this file's own location, never from CLAUDE_PROJECT_DIR.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const lib = require("../hooks/lib/auto-merge-mode.js");

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd = "status", ...args] = process.argv.slice(2);

function usage(problem) {
  if (problem) console.error(`REFUSED: ${problem}`);
  console.error("usage: auto-merge.mjs [off|status] | check <product> <PR#> [<head-sha>] | merge <product> <PR#> <head-sha>");
  process.exit(2);
}

if (cmd === "on") {
  console.error("REFUSED: only the owner turns auto-merge on, by typing /auto-merge on in the prompt box; this script cannot.");
  process.exit(1);
}
if (cmd === "off" || cmd === "status") {
  const root = process.env.CLAUDE_PROJECT_DIR || here;
  if (cmd === "off") fs.rmSync(lib.modeFile(root), { force: true });
  const mode = lib.readAutoMergeMode(root);
  console.log(
    mode.on
      ? `AUTO MERGE: ON (${lib.FILE})`
      : mode.error
        ? `AUTO MERGE: OFF — ${mode.error}; run "off" to remove it, or the owner types /auto-merge on to rewrite it`
        : "AUTO MERGE: OFF"
  );
  process.exit(0);
}
if (cmd !== "check" && cmd !== "merge") usage();

const merging = cmd === "merge";
if (args.length < 2 || args.length > 3 || (merging && args.length !== 3)) usage("wrong number of arguments (no flags, nothing extra)");
const [product, prNumber, expectedSha = null] = args;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(product)) usage("product must be a plain folder name under dev/");
if (!/^[1-9]\d{0,5}$/.test(prNumber)) usage("PR must be a number (not a URL)");
if (expectedSha !== null && !/^[0-9a-f]{40}$/.test(expectedSha)) usage("head-sha must be the full 40-character commit id, lower case");

const win = process.platform === "win32";
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};
const norm = (p) => {
  const s = p.split("\\").join("/").replace(/\/+$/, "");
  return win ? s.toLowerCase() : s;
};
const same = (a, b) => typeof a === "string" && typeof b === "string" && !!a && norm(a) === norm(b);
const isDir = (p) => {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

const TIMEOUT_MS = 30000;
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_.*|GH_REPO|GH_HOST)$/i.test(k)));
childEnv.GH_PROMPT_DISABLED = "1";
const git = (dir, ...a) => {
  const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-C", dir, ...a], { encoding: "utf8", env: childEnv, timeout: TIMEOUT_MS });
  return !r.error && r.status === 0 ? r.stdout.trim() : null;
};
let ghCwd = here;
function gh(...a) {
  const r = spawnSync("gh", a, { encoding: "utf8", env: childEnv, cwd: ghCwd, timeout: TIMEOUT_MS });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.code || "error" : `exit ${r.status}`;
    const said = String(r.stderr || "").trim().split(/\r?\n/)[0].slice(0, 200);
    throw new Error(`gh ${a[0]} ${a[1]} failed (${why})${said ? `: ${said}` : ""}`);
  }
  return r.stdout;
}
function ghJson(...a) {
  const out = gh(...a);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`gh ${a[0]} ${a[1]} printed something that is not JSON`);
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const reasons = [];
const info = { repo: "not inspected", head: "not inspected", mergeable: "not inspected", checks: "checks: not inspected" };
let target = null; // { repo, head }: set only when the PR itself was read; merge needs it and zero reasons

function inspect() {
  // 1. the workspace's main checkout
  const root = real(here);
  if (!root) {
    reasons.push("the script's own workspace folder cannot be resolved");
    return "nothing else";
  }
  ghCwd = root;
  const top = git(root, "rev-parse", "--show-toplevel");
  if (!isDir(path.join(root, ".git")) || !same(top && real(top), root)) {
    reasons.push("this copy of the script is not in the workspace's main checkout (its root has no .git folder of its own); run the workspace root's copy by absolute path");
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir && !same(real(projectDir), root)) {
    reasons.push("CLAUDE_PROJECT_DIR points at another folder; check / merge only ever use the workspace this script file is in");
  }

  // 2. the switch
  const mode = lib.readAutoMergeMode(root);
  if (!mode.on) reasons.push(`the auto-merge switch is off${mode.error ? ` (${mode.error})` : ""}; the owner turns it on with /auto-merge on`);

  // 3. the product repo
  const P = path.join(root, "dev", product);
  const pReal = real(P);
  let productOk = false;
  if (!pReal || !isDir(pReal)) reasons.push(`dev/${product} does not exist`);
  else if (!same(pReal, P)) reasons.push(`dev/${product} is a link or an alias of another name, not a real folder`);
  else if (!isDir(path.join(P, ".git"))) reasons.push(`dev/${product} is not a git repository of its own (no .git folder: a plain folder, or a worktree)`);
  else {
    const pTop = git(P, "rev-parse", "--show-toplevel");
    if (!same(pTop && real(pTop), pReal)) reasons.push(`dev/${product} is not the top of its own git repository`);
    else productOk = true;
  }

  // 4. GitHub identity, first on the origin strings
  const wsParsed = lib.parseGithubRemote(git(root, "remote", "get-url", "origin"));
  if (!wsParsed) reasons.push("the workspace's origin is missing or is not a github.com repository");
  const pParsed = productOk ? lib.parseGithubRemote(git(P, "remote", "get-url", "origin")) : null;
  if (productOk && !pParsed) reasons.push(`dev/${product}'s origin is missing or is not a github.com repository`);
  if (!wsParsed || !pParsed) return "the GitHub repository and the PR";
  const early = lib.identityReasons(pParsed, wsParsed, null, null);
  if (early.length) {
    reasons.push(...early);
    return "the GitHub repository and the PR";
  }

  // 4-5. the names GitHub itself returns, and the repository's settings
  let repo, wsRepo;
  try {
    repo = ghJson("repo", "view", `${pParsed.owner}/${pParsed.name}`, "--json", "nameWithOwner,defaultBranchRef,mergeCommitAllowed");
    wsRepo = ghJson("repo", "view", `${wsParsed.owner}/${wsParsed.name}`, "--json", "nameWithOwner");
  } catch (e) {
    reasons.push(e.message);
    return "the GitHub repository and the PR";
  }
  const canonical = repo && typeof repo === "object" ? repo.nameWithOwner : undefined;
  const identity = lib.identityReasons(pParsed, wsParsed, canonical ?? "", wsRepo && typeof wsRepo === "object" ? (wsRepo.nameWithOwner ?? "") : "");
  if (identity.length) {
    reasons.push(...identity);
    return "the PR";
  }
  info.repo = `${canonical} (origin: ${pParsed.owner}/${pParsed.name})`;
  reasons.push(...lib.repoReasons(repo));
  const defaultBranch = repo.defaultBranchRef && typeof repo.defaultBranchRef === "object" ? repo.defaultBranchRef.name : undefined;

  // 6-8. the PR, read from the canonical repository only
  let pr;
  try {
    const fields = "state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup";
    pr = lib.settleMergeable(() => ghJson("pr", "view", prNumber, "--repo", canonical, "--json", fields), sleep);
  } catch (e) {
    reasons.push(e.message);
    return "the PR";
  }
  const verdict = lib.prReasons(pr, defaultBranch, expectedSha);
  reasons.push(...verdict.reasons);
  info.mergeable = verdict.mergeable;
  const isPr = pr && typeof pr === "object" && !Array.isArray(pr);
  const head = isPr && typeof pr.headRefOid === "string" && /^[0-9a-f]{40}$/.test(pr.headRefOid) ? pr.headRefOid : null;
  info.head = head || "unreadable";
  const checks = lib.checksVerdict(isPr ? pr.statusCheckRollup : undefined);
  info.checks = checks.line;
  reasons.push(...checks.reasons);
  if (head) target = { repo: canonical, head };
  return null;
}

let skipped;
try {
  skipped = inspect();
} catch (e) {
  target = null;
  reasons.push(`internal error while inspecting (${(e && e.code) || (e && e.name) || "error"})`);
  skipped = "everything after the error";
}
if (skipped) reasons.push(`not inspected: ${skipped} (an earlier check ended the inspection)`);

console.log(`product: dev/${product}`);
console.log(`repo: ${info.repo}`);
console.log(`PR: #${prNumber}`);
console.log(`head: ${info.head}`);
console.log(`mergeable: ${info.mergeable}`);
console.log(info.checks);
for (const r of reasons) console.log(`REFUSED: ${r}`);
if (reasons.length) {
  console.log(`VERDICT: not merged (${reasons.length} reason${reasons.length === 1 ? "" : "s"})`);
  process.exit(1);
}
if (!merging) {
  console.log("VERDICT: every check holds (check only: nothing was merged)");
  process.exit(0);
}
// Reached only with zero reasons, a PR that was read, and a caller-pinned head equal to the PR's head.
if (!target || target.head !== expectedSha) {
  console.log("REFUSED: internal error: no inspected PR head to merge");
  process.exit(1);
}
try {
  gh("pr", "merge", prNumber, "--repo", target.repo, "--merge", "--match-head-commit", target.head);
} catch (e) {
  console.log(`REFUSED: ${e.message}`);
  console.log("VERDICT: not merged (the merge command failed; look at the PR before retrying)");
  process.exit(1);
}
console.log(`MERGED: ${target.repo} #${prNumber} at ${target.head} (merge commit; the work branch was left in place)`);
