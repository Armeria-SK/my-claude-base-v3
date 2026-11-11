// Shared helper for session-start.js / block-destructive-fs.js / block-worktree-outside-tmp.js.
// The filename is historical: the journal (tasks/YYYY-MM/DD.md) now holds only the human reports
// appended by /save-session, and no hook writes to it, so the only helper left is projectRoot.

const fs = require('node:fs');
const path = require('node:path');

// Resolve the workspace root defensively: normalize each candidate (path.resolve absorbs
// drive-relative forms like "D:my-claude-base-v2" — a real v1 incident class), then walk up
// until a directory containing .claude/ is found. Prevents a malformed cwd from silently
// planting a tasks/ tree in the wrong place.
function projectRoot(payload) {
  const candidates = [process.env.CLAUDE_PROJECT_DIR, payload.cwd, process.cwd()];
  for (let c of candidates) {
    if (!c) continue;
    let dir = path.resolve(c);
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, '.claude'))) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return path.resolve(payload.cwd || process.cwd());
}

module.exports = { projectRoot };
