#!/usr/bin/env node
// Make an HTML reading document self-contained, then prove it.
//   node .claude/scripts/inline-assets.mjs <in.html> [out.html]   (out defaults to overwriting in)
//   node .claude/scripts/inline-assets.mjs --check <file.html>     (lint only)
// 1. Every local image referenced by <img src="..."> or CSS url(...) is replaced by a data: URI,
//    so a generated picture (e.g. from chatgpt-image-gen) travels inside the single file.
// 2. Lint: any remaining external reference (http(s)://, //host, or a relative path in
//    href/src/srcset/url()/@import) is reported and exits 1. Text inside <code>/<pre> is ignored,
//    as are same-document fragments (#id) and xmlns namespace URIs.

import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
const isLocal = (u) => u && !/^(data:|#|https?:|\/\/|mailto:|about:)/i.test(u);

function inline(html, baseDir) {
  const embed = (u) => {
    const file = path.resolve(baseDir, decodeURI(u.split(/[?#]/)[0]));
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime || !fs.existsSync(file)) return null;
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  };
  html = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, u) => {
    const d = isLocal(u) && embed(u);
    return d ? `${pre}${q}${d}${q}` : m;
  });
  html = html.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, u) => {
    const d = isLocal(u) && embed(u);
    return d ? `url("${d}")` : m;
  });
  return html;
}

function lint(html) {
  const body = html.replace(/<(code|pre)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const hits = [];
  const refs = [
    ...[...body.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]),
    ...[...body.matchAll(/\bsrcset\s*=\s*(["'])(.*?)\1/gi)].flatMap((m) => m[2].split(',').map((s) => s.trim().split(/\s+/)[0])),
    ...[...body.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((m) => m[2]),
    ...[...body.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)].map((m) => m[1]),
  ];
  for (const r of refs) if (r && !/^(data:|#)/i.test(r)) hits.push(r.length > 80 ? r.slice(0, 80) + '…' : r);
  return hits;
}

const args = process.argv.slice(2);
const checkOnly = args[0] === '--check';
const input = checkOnly ? args[1] : args[0];
if (!input) {
  console.error('usage: inline-assets.mjs <in.html> [out.html] | --check <file.html>');
  process.exit(2);
}
let html = fs.readFileSync(input, 'utf8');
if (!checkOnly) {
  html = inline(html, path.dirname(path.resolve(input)));
  fs.writeFileSync(args[1] || input, html);
}
const hits = lint(html);
for (const h of hits) console.log(`EXTERNAL  ${h}`);
console.log(`${hits.length ? 'FAIL' : 'PASS'}: ${hits.length} external reference(s) — ${args[1] || input} (${Buffer.byteLength(html)} bytes)`);
process.exit(hits.length ? 1 : 0);
