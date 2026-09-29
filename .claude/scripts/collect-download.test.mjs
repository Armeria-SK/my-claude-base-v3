// node --test .claude/scripts/collect-download.test.mjs
// Runs collect-download.mjs against temp folders (never the real Downloads) with a file written mid-run,
// the way a browser download lands after the user presses Save. The temp root is removed in after().
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, moveFile } from './collect-download.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'collect-download.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-download-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x40, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);

let cases = 0;
function newCase() {
  const base = path.join(root, `case${cases++}`);
  const dl = path.join(base, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  return { dl, out: path.join(base, 'assets'), since: Date.now() - 2000 };
}

function run(args, at = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timers = at.map(([ms, fn]) => setTimeout(fn, ms));
    const guard = setTimeout(() => child.kill(), 30_000);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => {
      [guard, ...timers].forEach(clearTimeout);
      resolve({ status, stdout, stderr });
    });
  });
}

describe('collect-download', { concurrency: true }, () => {
  test('moves a file that appears after the script starts', async () => {
    const { dl, out, since } = newCase();
    const src = path.join(dl, 'ChatGPT Image 2026年9月29日 13_45_12.png');
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10'], [[1500, () => fs.writeFileSync(src, PNG)]]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), `MOVED ${src} -> ${to} (${PNG.length} bytes, png)`);
    assert.ok(fs.readFileSync(to).equals(PNG));
    assert.ok(!fs.existsSync(src));
  });

  test('ignores a file older than --since', async () => {
    const { dl, out, since } = newCase();
    const old = path.join(dl, 'ChatGPT Image old.png');
    const fresh = path.join(dl, 'ChatGPT Image new.png');
    fs.writeFileSync(old, PNG);
    const past = new Date(since - 60_000);
    fs.utimesSync(old, past, past);
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10'], [[1500, () => fs.writeFileSync(fresh, JPEG)]]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /ChatGPT Image new\.png ->/);
    assert.ok(fs.readFileSync(to).equals(JPEG));
    assert.ok(fs.existsSync(old), 'the older download must stay where it was');
  });

  test('ignores .crdownload/.tmp/.partial until the final name appears', async () => {
    const { dl, out, since } = newCase();
    const partial = path.join(dl, 'ChatGPT Image a.png.crdownload');
    fs.writeFileSync(partial, PNG.subarray(0, 10));
    fs.writeFileSync(path.join(dl, 'ChatGPT Image b.png.tmp'), PNG);
    fs.writeFileSync(path.join(dl, 'ChatGPT Image c.png.partial'), PNG);
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10'], [
      [1500, () => fs.writeFileSync(partial, PNG)],
      [1600, () => fs.renameSync(partial, path.join(dl, 'ChatGPT Image a.png'))],
    ]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /ChatGPT Image a\.png ->/);
    assert.ok(fs.readFileSync(to).equals(PNG));
    assert.ok(fs.existsSync(path.join(dl, 'ChatGPT Image b.png.tmp')) && fs.existsSync(path.join(dl, 'ChatGPT Image c.png.partial')));
  });

  test('waits until the file size stops changing', async () => {
    const { dl, out, since } = newCase();
    const src = path.join(dl, 'ChatGPT Image grow.png');
    fs.writeFileSync(src, PNG);
    const to = path.join(out, 'hero.png');
    const appends = [300, 600, 900, 1200].map((ms) => [ms, () => fs.appendFileSync(src, Buffer.alloc(1000, 4))]);
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10'], appends);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.statSync(to).size, PNG.length + 4000);
  });

  test('two candidates: exits 1, moves nothing, lists both', async () => {
    const { dl, out, since } = newCase();
    fs.writeFileSync(path.join(dl, 'ChatGPT Image one.png'), PNG);
    fs.writeFileSync(path.join(dl, 'ChatGPT Image two.png'), PNG);
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /2 candidate files/);
    assert.match(r.stderr, /ChatGPT Image one\.png/);
    assert.match(r.stderr, /ChatGPT Image two\.png/);
    assert.ok(!fs.existsSync(to));
    assert.strictEqual(fs.readdirSync(dl).length, 2);
  });

  test('existing target: exits 1, overwrites nothing', async () => {
    const { dl, out, since } = newCase();
    const src = path.join(dl, 'ChatGPT Image x.png');
    fs.writeFileSync(src, PNG);
    fs.mkdirSync(out);
    const to = path.join(out, 'hero.png');
    fs.writeFileSync(to, 'KEEP ME');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /already exists/);
    assert.strictEqual(fs.readFileSync(to, 'utf8'), 'KEEP ME');
    assert.ok(fs.existsSync(src));
  });

  test('non-image bytes: exits 1 and names the problem', async () => {
    const { dl, out, since } = newCase();
    fs.writeFileSync(path.join(dl, 'ChatGPT Image html.png'), '<html>403 Forbidden</html>');
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /not a PNG\/JPEG\/WebP image/);
    assert.doesNotMatch(r.stdout, /MOVED/);
    assert.ok(fs.existsSync(to), 'left at the target, as specified');
  });

  test('timeout: exits 1 and tells the caller to ask the user about Save', async () => {
    const { dl, out, since } = newCase();
    const to = path.join(out, 'hero.png');
    const t0 = Date.now();
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '2']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /pressed Save/);
    assert.strictEqual(r.stdout, '');
    assert.ok(Date.now() - t0 >= 1800, 'must poll for the whole timeout');
  });

  test('moves across folders and creates missing parent directories', async () => {
    const { dl, out, since } = newCase();
    fs.writeFileSync(path.join(dl, 'ChatGPT Image x.png'), PNG);
    const to = path.join(out, 'nested', 'deeper', 'hero-fintech-teal.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.readFileSync(to).equals(PNG));
  });

  test('--match selects by glob; the default pattern does not match other names', async () => {
    const { dl, out, since } = newCase();
    fs.writeFileSync(path.join(dl, 'hero-1.png'), PNG);
    fs.writeFileSync(path.join(dl, 'other.png'), JPEG);
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--match', 'hero*', '--timeout', '10']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.readFileSync(to).equals(PNG));
    assert.ok(fs.existsSync(path.join(dl, 'other.png')));
    const miss = await run(['--since', since, '--to', path.join(out, 'x.png'), '--dir', dl, '--timeout', '2']);
    assert.strictEqual(miss.status, 1, 'default "ChatGPT Image*" must not match other.png');
  });

  for (const [ext, bytes, type] of [['.png', PNG, 'png'], ['.jpg', JPEG, 'jpeg'], ['.jpeg', JPEG, 'jpeg'], ['.webp', WEBP, 'webp']]) {
    test(`accepts ${ext} and reports the ${type} magic bytes`, async () => {
      const { dl, out, since } = newCase();
      fs.writeFileSync(path.join(dl, `ChatGPT Image x${ext}`), bytes);
      const to = path.join(out, `hero${ext}`);
      const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10']);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(r.stdout.trim().endsWith(`(${bytes.length} bytes, ${type})`), r.stdout);
      assert.strictEqual(r.stderr, '', 'matching extension and content must not warn');
    });
  }

  test('warns on stderr, still exits 0, when the --to extension does not match the image type', async () => {
    const { dl, out, since } = newCase();
    fs.writeFileSync(path.join(dl, 'ChatGPT Image x.png'), WEBP);
    const to = path.join(out, 'hero.png');
    const r = await run(['--since', since, '--to', to, '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.trim().endsWith(`(${WEBP.length} bytes, webp)`), r.stdout);
    assert.match(r.stderr, /WARNING: .*hero\.png is named \.png but the content is webp/);
    assert.ok(fs.readFileSync(to).equals(WEBP));
  });

  test('--find-only prints FOUND and leaves the file where it is', async () => {
    const { dl, since } = newCase();
    const src = path.join(dl, 'ChatGPT Image x.png');
    fs.writeFileSync(src, PNG);
    const r = await run(['--since', since, '--find-only', '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), `FOUND ${src} (${PNG.length} bytes, png)`);
    assert.ok(fs.readFileSync(src).equals(PNG));
    assert.deepStrictEqual(fs.readdirSync(dl), ['ChatGPT Image x.png']);
  });

  test('--find-only on non-image bytes exits 1 without a FOUND line', async () => {
    const { dl, since } = newCase();
    fs.writeFileSync(path.join(dl, 'ChatGPT Image x.png'), 'not an image');
    const r = await run(['--since', since, '--find-only', '--dir', dl, '--timeout', '10']);
    assert.strictEqual(r.status, 1);
    assert.doesNotMatch(r.stdout, /FOUND/);
  });

  test('a missing downloads folder exits 1 at once', async () => {
    const { dl, out, since } = newCase();
    const r = await run(['--since', since, '--to', path.join(out, 'x.png'), '--dir', path.join(dl, 'nope'), '--timeout', '10']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /downloads folder not found/);
  });

  for (const [name, args] of [
    ['no arguments', []],
    ['--since missing', ['--find-only']],
    ['--since not a number', ['--since', 'soon', '--find-only']],
    ['neither --to nor --find-only', ['--since', '1']],
    ['both --to and --find-only', ['--since', '1', '--to', 'x.png', '--find-only']],
    ['unknown flag', ['--since', '1', '--find-only', '--wat']],
    ['flag without a value', ['--since', '1', '--to']],
  ]) {
    test(`usage error exits 2: ${name}`, async () => {
      const r = await run(args);
      assert.strictEqual(r.status, 2, r.stderr);
      assert.match(r.stderr, /usage:/);
    });
  }
});

const simulated = (code) => Object.assign(new Error(`${code} simulated`), { code });
const exdev = () => {
  throw simulated('EXDEV');
};
function failing(code, times, then) {
  const fn = (...args) => {
    fn.calls++;
    if (fn.calls <= times) throw simulated(code);
    return then?.(...args);
  };
  fn.calls = 0;
  return fn;
}

describe('moveFile', () => {
  function setup() {
    const { dl, out } = newCase();
    const src = path.join(dl, 'a.png');
    fs.writeFileSync(src, PNG);
    return { src, dst: path.join(out, 'sub', 'a.png') };
  }

  test('falls back to copy + unlink when rename crosses drives (EXDEV)', async () => {
    const { src, dst } = setup();
    const r = await moveFile(src, dst, { rename: exdev, retryMs: 1 });
    assert.deepStrictEqual(r, { leftBehind: false });
    assert.ok(fs.readFileSync(dst).equals(PNG));
    assert.ok(!fs.existsSync(src));
  });

  test('does not swallow other rename errors, does not retry them, and keeps the source', async () => {
    const { src, dst } = setup();
    const rename = failing('EIO', Infinity);
    await assert.rejects(moveFile(src, dst, { rename, retryMs: 1 }), /EIO simulated/);
    assert.strictEqual(rename.calls, 1);
    assert.ok(fs.existsSync(src));
    assert.ok(!fs.existsSync(dst));
  });

  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    test(`retries rename on ${code} until it succeeds`, async () => {
      const { src, dst } = setup();
      const rename = failing(code, 3, fs.renameSync);
      const r = await moveFile(src, dst, { rename, retryMs: 1 });
      assert.deepStrictEqual(r, { leftBehind: false });
      assert.strictEqual(rename.calls, 4);
      assert.ok(fs.readFileSync(dst).equals(PNG));
      assert.ok(!fs.existsSync(src));
    });
  }

  test('gives up on a rename that stays busy after 5 retries (6 attempts) and keeps the source', async () => {
    const { src, dst } = setup();
    const rename = failing('EBUSY', Infinity);
    await assert.rejects(moveFile(src, dst, { rename, retryMs: 1 }), /EBUSY simulated/);
    assert.strictEqual(rename.calls, 6);
    assert.ok(fs.existsSync(src));
  });

  test('retries the cross-drive copy and the unlink on EBUSY/EPERM', async () => {
    const { src, dst } = setup();
    const copy = failing('EBUSY', 2, fs.copyFileSync);
    const unlink = failing('EPERM', 2, fs.unlinkSync);
    const r = await moveFile(src, dst, { rename: exdev, copy, unlink, retryMs: 1 });
    assert.deepStrictEqual(r, { leftBehind: false });
    assert.strictEqual(copy.calls, 3);
    assert.strictEqual(unlink.calls, 3);
    assert.ok(fs.readFileSync(dst).equals(PNG));
    assert.ok(!fs.existsSync(src));
  });

  test('an unlink that never succeeds after a good copy reports leftBehind and keeps the copy', async () => {
    const { src, dst } = setup();
    const unlink = failing('EBUSY', Infinity);
    const r = await moveFile(src, dst, { rename: exdev, unlink, retryMs: 1 });
    assert.deepStrictEqual(r, { leftBehind: true });
    assert.strictEqual(unlink.calls, 6);
    assert.ok(fs.readFileSync(dst).equals(PNG));
    assert.ok(fs.existsSync(src));
  });

  test('an unlink failing for a non-busy reason is not swallowed', async () => {
    const { src, dst } = setup();
    await assert.rejects(moveFile(src, dst, { rename: exdev, unlink: failing('EIO', Infinity), retryMs: 1 }), /EIO simulated/);
  });

  test('refuses an existing target before touching anything', async () => {
    const { src, dst } = setup();
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, 'KEEP ME');
    const rename = failing('EIO', 0, fs.renameSync);
    await assert.rejects(moveFile(src, dst, { rename, retryMs: 1 }), /already exists/);
    assert.strictEqual(rename.calls, 0);
    assert.strictEqual(fs.readFileSync(dst, 'utf8'), 'KEEP ME');
    assert.ok(fs.existsSync(src));
  });
});

describe('collect with an original that cannot be deleted', () => {
  test('returns the MOVED line plus a warning that the source is still in the downloads folder', async () => {
    const { dl, out, since } = newCase();
    const src = path.join(dl, 'ChatGPT Image x.png');
    fs.writeFileSync(src, PNG);
    const to = path.join(out, 'hero.png');
    const r = await collect(
      { dir: dl, match: 'ChatGPT Image*', since, timeout: 10, to, findOnly: false },
      { rename: exdev, unlink: failing('EBUSY', Infinity), retryMs: 1 },
    );
    assert.strictEqual(r.line, `MOVED ${src} -> ${to} (${PNG.length} bytes, png)`);
    assert.strictEqual(r.warnings.length, 1);
    assert.match(r.warnings[0], /still in the downloads folder/);
    assert.ok(r.warnings[0].includes(src));
    assert.ok(fs.readFileSync(to).equals(PNG));
    assert.ok(fs.existsSync(src));
  });
});
