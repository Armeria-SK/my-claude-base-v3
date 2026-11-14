#!/usr/bin/env node
// Env copy (CLAUDE.md §0): node .claude/scripts/env-copy.mjs [off|status]   (on: only the owner, by typing /env-copy on)
//                          node .claude/scripts/env-copy.mjs copy <product> <worktree> [--overwrite]
// copy puts dev/<product>/.env and .env.* (not .env.example, which git already carries) into a git
// worktree of that same repo under tmp/worktrees/. Refused unless the switch is on. Prints only file
// names and sizes, never contents. An existing different file is kept unless --overwrite is given.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { FILE, modeFile, readEnvCopyMode } = require("../hooks/lib/env-copy-mode.js");

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd = "status", ...args] = process.argv.slice(2);

const stateLine = () => {
  const mode = readEnvCopyMode(root);
  if (mode.on) return `ENV COPY: ON (${FILE})`;
  return mode.error ? `ENV COPY: OFF — ${mode.error}; run "off" to remove it, or the owner types /env-copy on to rewrite it` : "ENV COPY: OFF";
};

if (cmd === "on") {
  console.error("REFUSED: only the owner turns env copy on, by typing /env-copy on in the prompt box; this script cannot.");
  process.exit(1);
}
if (cmd === "off" || cmd === "status") {
  if (cmd === "off") fs.rmSync(modeFile(root), { force: true });
  console.log(stateLine());
  process.exit(0);
}
if (cmd !== "copy") usage();

const flags = args.filter((a) => a.startsWith("--"));
const pos = args.filter((a) => !a.startsWith("--"));
if (pos.length !== 2 || flags.some((f) => f !== "--overwrite")) usage();
const overwrite = flags.includes("--overwrite");
const [product, wtArg] = pos;

function usage() {
  console.error("usage: env-copy.mjs [off|status] | copy <product> <worktree> [--overwrite]");
  process.exit(2);
}
function refuse(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

const win = process.platform === "win32";
const norm = (p) => {
  const r = path.resolve(p);
  return win ? r.toLowerCase() : r;
};
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};
const gitRun = (dir, ...a) => spawnSync("git", ["-c", "core.fsmonitor=false", "-C", dir, ...a], { encoding: "utf8" });
const git = (dir, ...a) => {
  const r = gitRun(dir, ...a);
  return r.status === 0 ? r.stdout.trim() : null;
};
const ignored = (name) => gitRun(wtReal, "check-ignore", "-q", "--", name).status === 0;

const mode = readEnvCopyMode(root);
if (!mode.on) refuse(`the env copy switch is off${mode.error ? ` (${mode.error})` : ""}; the owner turns it on with /env-copy on`);

if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(product)) refuse("product must be a plain folder name under dev/");
const rootReal = real(root) || root;
const src = path.join(rootReal, "dev", product);
const srcReal = real(src);
if (!srcReal || !fs.statSync(srcReal).isDirectory()) refuse(`dev/${product} does not exist`);
if (norm(srcReal) !== norm(src)) refuse(`dev/${product} is a link, not a real folder`);
const srcTop = git(src, "rev-parse", "--show-toplevel");
if (!srcTop || norm(srcTop) !== norm(srcReal)) refuse(`dev/${product} is not the top of its own git repository`);

const wtBaseLexical = path.join(rootReal, "tmp", "worktrees");
const wtReal = real(wtArg);
const wtBase = real(wtBaseLexical);
if (!wtReal || !wtBase) refuse("the worktree does not exist");
if (norm(wtBase) !== norm(wtBaseLexical)) refuse("tmp/ or tmp/worktrees/ is a link, not a real folder");
const inside = (p) => !!p && norm(p).startsWith(norm(wtBase) + path.sep);
if (!inside(wtReal)) refuse("the worktree must be under tmp/worktrees/ of the workspace");
const wtTop = git(wtReal, "rev-parse", "--show-toplevel");
if (!wtTop || norm(wtTop) !== norm(wtReal)) refuse("the worktree path is not the top of a git worktree");
const common = (d) => {
  const c = git(d, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return c && real(c);
};
const srcCommon = common(src);
const wtCommon = common(wtReal);
if (!srcCommon || !wtCommon || norm(srcCommon) !== norm(wtCommon)) refuse(`the worktree is not a worktree of dev/${product}`);

const names = fs
  .readdirSync(srcReal, { withFileTypes: true })
  .filter((e) => e.isFile() && (e.name === ".env" || e.name.startsWith(".env.")) && e.name !== ".env.example")
  .map((e) => e.name)
  .sort();
if (!names.length) refuse(`dev/${product} has no .env file to copy`);

const gitDirOut = git(wtReal, "rev-parse", "--path-format=absolute", "--git-dir");
const tmpDir = gitDirOut && real(gitDirOut);
if (!tmpDir) refuse("cannot find the worktree's own git folder");

const plan = [];
for (const name of names) {
  const from = path.join(srcReal, name);
  const to = path.join(wtReal, name);
  if (!ignored(name)) refuse(`${name} is not gitignored in the worktree; add it to .gitignore first`);
  let st = null;
  try {
    st = fs.lstatSync(to);
  } catch {
    /* absent */
  }
  if (st && !st.isFile()) refuse(`${name} in the worktree is not a regular file`);
  if (st && st.nlink !== 1) refuse(`${name} in the worktree is a hard link (${st.nlink} names); remove it first`);
  const same = st && fs.readFileSync(from).equals(fs.readFileSync(to));
  if (st && !same && !overwrite) refuse(`${name} already exists in the worktree with different content; pass --overwrite to replace it`);
  plan.push({ name, from, to, tmp: path.join(tmpDir, `env-copy-${process.pid}${name}.tmp`), action: !st ? "copied" : same ? "unchanged" : "overwritten" });
}
const unchangedSince = (p) => {
  if (real(wtArg) !== wtReal || !inside(real(wtReal))) return false;
  let st = null;
  try {
    st = fs.lstatSync(p.to);
  } catch (e) {
    return p.action === "copied" && e.code === "ENOENT";
  }
  return p.action === "overwritten" && st.isFile() && st.nlink === 1;
};
for (const p of plan) {
  if (p.action !== "unchanged") {
    fs.copyFileSync(p.from, p.tmp, fs.constants.COPYFILE_EXCL);
    let problem = unchangedSince(p) ? null : `${p.name} or the worktree changed while copying; nothing written`;
    if (!problem) {
      try {
        fs.renameSync(p.tmp, p.to);
      } catch (e) {
        problem = `could not move ${p.name} into the worktree (${e.code || "error"})`;
      }
    }
    fs.rmSync(p.tmp, { force: true });
    if (problem) refuse(problem);
  }
  console.log(`${p.action}: ${p.name} (${fs.statSync(p.to).size} bytes)`);
}
console.log(`ENV COPY: ${plan.length} file(s) from dev/${product} into ${path.relative(root, wtReal).split(path.sep).join("/")}`);
