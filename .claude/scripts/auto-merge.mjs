#!/usr/bin/env node
// Auto-merge (CLAUDE.md §0): node .claude/scripts/auto-merge.mjs [off|status]   (on: only the owner, by typing /auto-merge on)
//                            node .claude/scripts/auto-merge.mjs check <product> <PR#> [<head-sha>]
//                            node .claude/scripts/auto-merge.mjs merge <product> <PR#> <head-sha>
// merge merges one PR of the dev/<product> repo into its default branch with a merge commit, and only when
// every check below holds; check prints the same verdict and merges nothing. Every reason is collected and
// printed as "REFUSED: ..."; anything that cannot be inspected is a reason (fail closed). The workspace
// repository itself can never be the target. The rules, the gh argument lists and the composition of the
// GitHub-side checks live in ../hooks/lib/auto-merge-mode.js; this file is the fs / git / gh layer.
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
const slash = (p) => p.split("\\").join("/");

if (cmd === "on") {
  console.error("REFUSED: only the owner turns auto-merge on, by typing /auto-merge on in the prompt box; this script cannot.");
  process.exit(1);
}
if (cmd === "off" || cmd === "status") {
  if (args.length) usage(`${cmd} takes no further arguments`);
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
  console.log(`root: ${slash(root)}`);
  if (!same(real(root) || path.resolve(root), real(here) || here)) {
    console.log(
      `NOTE: that root is the folder CLAUDE_PROJECT_DIR names, not this script's own workspace (${slash(here)}). ` +
        `The switch of ${slash(here)} was not ${cmd === "off" ? "touched" : "read"}; check / merge only ever use that one.`
    );
  }
  process.exit(0);
}
if (cmd !== "check" && cmd !== "merge") usage();

const merging = cmd === "merge";
if (args.length < 2 || args.length > 3 || (merging && args.length !== 3)) usage("wrong number of arguments (no flags, nothing extra)");
const [product, prNumber, expectedSha = null] = args;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(product)) usage("product must be a plain folder name under dev/");
if (!/^[1-9]\d{0,5}$/.test(prNumber)) usage("PR must be a number (not a URL)");
if (expectedSha !== null && !/^[0-9a-f]{40}$/.test(expectedSha)) usage("head-sha must be the full 40-character commit id, lower case");

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
function gh(a) {
  const r = spawnSync("gh", a, { encoding: "utf8", env: childEnv, cwd: ghCwd, timeout: TIMEOUT_MS });
  return { errorCode: r.error ? r.error.code || "error" : null, signal: r.signal || null, status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function ghJson(a) {
  const r = gh(a);
  if (r.errorCode || r.status !== 0) {
    const said = String(r.stderr || "").trim().split(/\r?\n/)[0].slice(0, 200);
    throw new Error(`gh ${a[0]} ${a[1]} failed (${r.errorCode || `exit ${r.status}`})${said ? `: ${said}` : ""}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`gh ${a[0]} ${a[1]} printed something that is not JSON`);
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const reasons = [];
let info = { repo: "not inspected", head: "not inspected", mergeable: "not inspected", checks: "checks: not inspected" };
let target = null;

function inspect() {
  // 1. the workspace's main checkout
  const root = real(here);
  if (!root) {
    reasons.push("the script's own workspace folder cannot be resolved");
    return "everything else";
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

  // 4. the two origins; everything on the GitHub side is lib.inspectRemote
  const wsParsed = lib.parseGithubRemote(git(root, "remote", "get-url", "origin"));
  if (!wsParsed) reasons.push("the workspace's origin is missing or is not a github.com repository");
  const pParsed = productOk ? lib.parseGithubRemote(git(P, "remote", "get-url", "origin")) : null;
  if (productOk && !pParsed) reasons.push(`dev/${product}'s origin is missing or is not a github.com repository`);
  if (!wsParsed || !pParsed) return "the GitHub repository and the PR";
  const remote = lib.inspectRemote({ product: pParsed, workspace: wsParsed, prNumber, expectedSha }, { json: ghJson, sleep });
  reasons.push(...remote.reasons);
  info = remote.info;
  target = remote.target;
  return remote.skipped;
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
const mergeArgs = lib.mergeCommand(reasons, target, prNumber, expectedSha);
if (!mergeArgs) {
  console.log("REFUSED: internal error: no inspected PR head to merge");
  console.log("VERDICT: not merged (1 reason)");
  process.exit(1);
}
const outcome = lib.mergeOutcome(gh(mergeArgs));
if (outcome.merged === true) {
  console.log(`MERGED: ${target.repo} #${prNumber} at ${target.head} (merge commit; the work branch was left in place)`);
  process.exit(0);
}
console.log(`REFUSED: ${outcome.why}`);
console.log(
  outcome.merged === false
    ? "VERDICT: not merged (the merge command failed)"
    : "VERDICT: UNKNOWN — the merge command did not report back, so the PR may or may not be merged. Look at the PR's state before anything else; do not run merge again blindly"
);
process.exit(1);
