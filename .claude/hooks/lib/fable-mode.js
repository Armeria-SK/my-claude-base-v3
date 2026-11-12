// Fable mode (CLAUDE.md §2): .claude/fable-mode.json maps agent -> { model: "fable", effort }.
// Present and valid = on; absent = off; anything malformed = off, with the problem returned so the
// callers (enforce-model-tier.js, session-start.js, scripts/fable-mode.mjs) can surface it.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAP = { planner: 'low', executor: 'low', reviewer: 'low', 'planner-deep': 'medium', 'reviewer-deep': 'medium' };
const AGENTS = Object.keys(DEFAULT_MAP);
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FILE = path.join('.claude', 'fable-mode.json');

const modeFile = (root) => path.join(root, FILE);

const toJson = (map) =>
  JSON.stringify(Object.fromEntries(Object.entries(map).map(([a, e]) => [a, { model: 'fable', effort: e }])), null, 2) + '\n';

function readFableMode(root) {
  let text;
  try {
    text = fs.readFileSync(modeFile(root), 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? { on: false } : { on: false, error: `cannot read ${FILE}: ${e.code || e.message}` };
  }
  try {
    return validate(JSON.parse(text));
  } catch (e) {
    return { on: false, error: `${FILE} is not a valid mode file (${e.message})` };
  }
}

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : typeof v);

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) {
    return { on: false, error: `${FILE} must be a non-empty object of agent -> { "model": "fable", "effort": ... }` };
  }
  const map = {};
  for (const [agent, v] of Object.entries(data)) {
    if (!AGENTS.includes(agent)) return { on: false, error: `${FILE}: unknown agent "${agent}" (allowed: ${AGENTS.join(', ')})` };
    const keys = v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().join(',') : '';
    if (keys !== 'effort,model') return { on: false, error: `${FILE}: "${agent}" must be exactly { "model": "fable", "effort": ... }` };
    if (v.model !== 'fable') return { on: false, error: `${FILE}: "${agent}" model must be "fable" (got ${show(v.model)})` };
    if (!EFFORTS.includes(v.effort)) return { on: false, error: `${FILE}: "${agent}" effort must be one of ${EFFORTS.join('/')} (got ${show(v.effort)})` };
    map[agent] = v.effort;
  }
  return { on: true, map };
}

module.exports = { DEFAULT_MAP, AGENTS, FILE, modeFile, toJson, readFableMode };
