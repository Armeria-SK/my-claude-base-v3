#!/usr/bin/env node
// Find the image the user just saved from the browser and move it to its destination.
//   node .claude/scripts/collect-download.mjs --since <epoch-ms> --to <target-file> [--match "ChatGPT Image*"] [--timeout 120] [--dir <downloads-dir>]
//   node .claude/scripts/collect-download.mjs --since <epoch-ms> --find-only [--match ...] [--timeout ...] [--dir ...]
// --since is `Date.now()` taken just before the download button was pressed; older files are never picked up.
// Polls --dir (default ~/Downloads) every second, up to --timeout seconds, for exactly one .png/.jpg/.jpeg/.webp
// whose name matches --match (glob: * and ?), whose mtime >= --since, and whose size is unchanged across two polls.
// --to moves it (creating parent dirs, never overwriting) and prints "MOVED <src> -> <dst> (<bytes> bytes, <type>)".
// --find-only leaves it in place and prints "FOUND <path> (<bytes> bytes, <type>)".
// Exit 0 only when the file's magic bytes are PNG/JPEG/WebP. 1 = nothing found / several found / target exists /
// not an image (reason on stderr). 2 = bad arguments. Exit 0 can still carry "WARNING:" lines on stderr
// (original could not be deleted after a cross-drive copy; --to extension differs from the real image type).
// EBUSY/EPERM/EACCES (scanners holding the file) are retried 5 times, 500 ms apart.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPE_BY_EXT = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };
const EXTS = new Set(Object.keys(TYPE_BY_EXT));
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES']);
const POLL_MS = 1000;
const RETRIES = 5;
const USAGE = 'usage: collect-download.mjs --since <epoch-ms> (--to <target-file> | --find-only) [--match "ChatGPT Image*"] [--timeout 120] [--dir <downloads-dir>]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Usage extends Error {}
class Fail extends Error {}

function sniffImage(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    const b = buf.subarray(0, fs.readSync(fd, buf, 0, 12, 0));
    if (b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
    if (b.length >= 3 && b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

async function retryBusy(op, retryMs) {
  for (let attempt = 0; ; attempt++) {
    try {
      return op();
    } catch (e) {
      if (!BUSY.has(e.code) || attempt >= RETRIES) throw e;
      await sleep(retryMs);
    }
  }
}

export async function moveFile(src, dst, { rename = fs.renameSync, copy = fs.copyFileSync, unlink = fs.unlinkSync, retryMs = 500 } = {}) {
  if (fs.existsSync(dst)) throw new Fail(`target already exists, not overwriting: ${dst}. Pick another --to (or ask the user).`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    await retryBusy(() => rename(src, dst), retryMs);
    return { leftBehind: false };
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
  }
  await retryBusy(() => copy(src, dst, fs.constants.COPYFILE_EXCL), retryMs);
  try {
    await retryBusy(() => unlink(src), retryMs);
  } catch (e) {
    if (!BUSY.has(e.code)) throw e;
    return { leftBehind: true };
  }
  return { leftBehind: false };
}

function parseArgs(argv) {
  const o = { match: 'ChatGPT Image*', timeout: 120, dir: path.join(os.homedir(), 'Downloads'), findOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--find-only') {
      o.findOnly = true;
      continue;
    }
    if (!['--since', '--to', '--match', '--timeout', '--dir'].includes(a)) throw new Usage(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Usage(`${a} needs a value`);
    o[a.slice(2)] = v;
  }
  if (o.since === undefined || !Number.isFinite(Number(o.since)) || Number(o.since) < 0) throw new Usage('--since must be epoch milliseconds');
  o.since = Number(o.since);
  if (!Number.isFinite(Number(o.timeout)) || Number(o.timeout) <= 0) throw new Usage('--timeout must be a positive number of seconds');
  o.timeout = Number(o.timeout);
  if (o.findOnly === (o.to !== undefined)) throw new Usage('give exactly one of --to <target-file> or --find-only');
  o.dir = path.resolve(o.dir);
  if (o.to !== undefined) o.to = path.resolve(o.to);
  return o;
}

function globToRegExp(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

function listCandidates(dir, re, since) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (!EXTS.has(path.extname(name).toLowerCase()) || !re.test(name)) continue;
    const file = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (st.isFile() && st.mtimeMs >= since) found.push({ file, size: st.size, mtimeMs: st.mtimeMs });
  }
  return found.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

async function waitForFiles({ dir, re, since, timeout }) {
  const deadline = Date.now() + timeout * 1000;
  let prev = new Map();
  for (;;) {
    const files = listCandidates(dir, re, since);
    if (files.length && files.every((c) => c.size > 0 && prev.get(c.file) === c.size)) return { settled: true, files };
    prev = new Map(files.map((c) => [c.file, c.size]));
    const left = deadline - Date.now();
    if (left <= 0) return { settled: false, files };
    await sleep(Math.min(POLL_MS, left));
  }
}

const describeFile = (c) => `  ${c.file} (${c.size} bytes, modified ${new Date(c.mtimeMs).toISOString()})`;
const notImage = (file) => {
  const head = fs.readFileSync(file).subarray(0, 8).toString('hex').replace(/(..)(?=.)/g, '$1 ');
  return `${file} is not a PNG/JPEG/WebP image (first bytes: ${head || 'none'}). Tell the user; do not report it as saved.`;
};

export async function collect(o, moveOps) {
  if (!fs.existsSync(o.dir)) throw new Fail(`downloads folder not found: ${o.dir}. Ask the user where the browser saves files, then pass --dir.`);
  const { settled, files } = await waitForFiles({ dir: o.dir, re: globToRegExp(o.match), since: o.since, timeout: o.timeout });
  if (!files.length) {
    throw new Fail(
      `no image matching "${o.match}" (.png/.jpg/.jpeg/.webp) newer than ${new Date(o.since).toISOString()} appeared in ${o.dir} within ${o.timeout}s. ` +
        'Ask the user whether they pressed Save; if they changed the file name or folder, re-run with --match / --dir.',
    );
  }
  if (!settled) throw new Fail(`a matching file is still being written (size not stable within ${o.timeout}s):\n${files.map(describeFile).join('\n')}`);
  if (files.length > 1) throw new Fail(`${files.length} candidate files; moved none. Ask the user which one is the image:\n${files.map(describeFile).join('\n')}`);
  const { file } = files[0];
  if (o.findOnly) {
    const type = sniffImage(file);
    if (!type) throw new Fail(notImage(file));
    return { line: `FOUND ${file} (${fs.statSync(file).size} bytes, ${type})`, warnings: [] };
  }
  const { leftBehind } = await moveFile(file, o.to, moveOps);
  const type = sniffImage(o.to);
  if (!type) throw new Fail(`moved ${file} -> ${o.to}, but ${notImage(o.to)}`);
  const warnings = [];
  if (leftBehind) warnings.push(`copied to ${o.to}, but could not delete the original, which is still in the downloads folder: ${file}. Something is holding it open; it can be deleted later.`);
  const ext = path.extname(o.to).toLowerCase();
  if (TYPE_BY_EXT[ext] !== type) warnings.push(`${o.to} is named ${ext || '(no extension)'} but the content is ${type}. Rename it or convert it before using it.`);
  return { line: `MOVED ${file} -> ${o.to} (${fs.statSync(o.to).size} bytes, ${type})`, warnings };
}

async function main() {
  try {
    const { line, warnings } = await collect(parseArgs(process.argv.slice(2)));
    console.log(line);
    for (const w of warnings) console.error(`WARNING: ${w}`);
  } catch (e) {
    console.error(e instanceof Usage ? `${e.message}\n${USAGE}` : `ERROR: ${e.message}`);
    process.exitCode = e instanceof Usage ? 2 : 1;
  }
}

if (fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url))) await main();
