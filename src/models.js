// Per-model usage share, computed from Claude Code's local session logs.
// claude.ai's usage API has no per-model breakdown for Pro plans, so this is
// the only per-model data available on the user's machine. It covers Claude Code
// (CLI / IDE) on THIS computer only — not claude.ai chat or other devices.
//
// Log format: ~/.claude/projects/<project>/<session>.jsonl, one JSON object per line.
// Assistant lines look like:
//   { type: 'assistant', timestamp, requestId, message: { id, model, usage: {
//       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } } }

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const cache = new Map(); // file -> { mtimeMs, size, entries: [{ t, model, tok, id }] }

function roots() {
  const out = [];
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) env.split(',').forEach((d) => out.push(path.join(d.trim(), 'projects')));
  out.push(path.join(os.homedir(), '.claude', 'projects'));
  out.push(path.join(os.homedir(), '.config', 'claude', 'projects'));
  return [...new Set(out)].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

function listJsonl(dir, sinceMs, acc = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(p, sinceMs, acc);
    else if (e.name.endsWith('.jsonl')) {
      try { const st = fs.statSync(p); if (st.mtimeMs >= sinceMs) acc.push({ p, st }); } catch {}
    }
  }
  return acc;
}

function family(model) {
  const m = String(model || '').toLowerCase();
  if (!m || m === '<synthetic>') return null;
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return model;
}

async function parseFile(p) {
  const entries = [];
  const rl = readline.createInterface({ input: fs.createReadStream(p, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const msg = o.message; const u = msg && msg.usage;
    if (!u || o.type !== 'assistant') continue;
    const fam = family(msg.model); if (!fam) continue;
    // cache reads are ~10x cheaper and would swamp the numbers, so weight them down
    const tok = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
      + Math.round((u.cache_read_input_tokens || 0) * 0.1);
    entries.push({ t: Date.parse(o.timestamp) || 0, model: fam, tok, id: `${msg.id || ''}:${o.requestId || ''}` });
  }
  return entries;
}

/** Share of usage per model family since `sinceMs`. Returns null when no logs exist. */
async function modelShare(sinceMs) {
  const dirs = roots();
  if (!dirs.length) return null;
  const files = dirs.flatMap((d) => listJsonl(d, sinceMs));
  for (const { p, st } of files) {
    const c = cache.get(p);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) continue;
    try { cache.set(p, { mtimeMs: st.mtimeMs, size: st.size, entries: await parseFile(p) }); } catch {}
  }
  const seen = new Set(); const totals = {};
  for (const { p } of files) {
    const c = cache.get(p); if (!c) continue;
    for (const e of c.entries) {
      if (e.t < sinceMs) continue;
      if (e.id !== ':' && seen.has(e.id)) continue; // streamed messages are logged more than once
      seen.add(e.id);
      totals[e.model] = (totals[e.model] || 0) + e.tok;
    }
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!sum) return { models: [], total: 0 };
  const order = ['Opus', 'Sonnet', 'Haiku'];
  const models = Object.entries(totals)
    .map(([name, tok]) => ({ name, tok, pct: (tok / sum) * 100 }))
    .sort((a, b) => ((order.indexOf(a.name) + 1) || 9) - ((order.indexOf(b.name) + 1) || 9) || b.tok - a.tok);
  return { models, total: sum };
}

module.exports = { modelShare };
