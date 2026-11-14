// Env copy switch (CLAUDE.md §0, "Env copy"): .claude/env-copy.json = { "enabled": true }.
// Present and valid = on; absent = off; anything malformed = off, with the problem returned so the
// callers (session-start.js, scripts/env-copy.mjs, validate.mjs) can surface it. Never throws, and
// never echoes file-derived values (only their type), so a hostile or huge file cannot crash a caller.

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join('.claude', 'env-copy.json');
const ON_JSON = JSON.stringify({ enabled: true }, null, 2) + '\n';

const modeFile = (root) => path.join(root, FILE);

function readEnvCopyMode(root) {
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

module.exports = { FILE, ON_JSON, modeFile, readEnvCopyMode };
