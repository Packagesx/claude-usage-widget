// Antigravity CLI quota: `agy -p /usage --output-format json` prints
// { status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ displayName, buckets: [...] }] } } }.
// Undocumented format (field names follow CodexBar's parser) — may change with agy updates.
const { execFile } = require('child_process');
const os = require('os');

function parseAgyUsage(stdout) {
  const s = String(stdout || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!j || j.status !== 'SUCCESS' || !j.command || j.command.name !== 'usage') return null;
  const rows = [];
  for (const g of (j.command.data && j.command.data.groups) || []) {
    const buckets = (g.buckets || []).filter((k) => !k.disabled);
    for (const k of buckets) {
      const r = k.remaining || {};
      const f = [k.remaining_fraction, k.remainingFraction, r.remaining_fraction, r.remainingFraction,
        r.case === 'remainingFraction' ? r.value : undefined].find((v) => typeof v === 'number' && Number.isFinite(v));
      if (f === undefined) continue;
      const group = (g.displayName || g.display_name || g.name || '').trim().replace(/\s+models$/i, '');
      // one bucket per group (agy today: weekly) → the group name alone is the clearest label
      const name = buckets.length > 1 ? (k.window || k.displayName || k.name || k.id || '').trim() : '';
      rows.push({ name: [group, name].filter(Boolean).join(' · ') || 'Quota',
        pct: Math.max(0, Math.min(100, (1 - f) * 100)), resetsAt: k.reset_time || k.resetTime || null });
    }
  }
  return rows.length ? { rows } : null;
}

// Resolves to { rows } | null (no data) ; rejects with code 'ENOENT' when agy isn't installed.
function fetchAgyUsage() {
  return new Promise((resolve, reject) => {
    execFile('agy', ['-p', '/usage', '--output-format', 'json', '--print-timeout', '90s'], {
      shell: process.platform === 'win32', // resolves agy.cmd / agy.exe from PATH
      windowsHide: true, timeout: 100000, maxBuffer: 1 << 20, cwd: os.tmpdir(),
      env: { ...process.env, BROWSER: 'none' }, // never pop a sign-in page from the background
    }, (err, stdout, stderr) => {
      const missing = err && (err.code === 'ENOENT' || /not recognized|not found/i.test(String(stderr)));
      if (missing) return reject(Object.assign(new Error('agy not installed'), { code: 'ENOENT' }));
      resolve(parseAgyUsage(stdout));
    });
  });
}

module.exports = { parseAgyUsage, fetchAgyUsage };

if (require.main === module) { // self-check: node src/agy.js
  const assert = require('assert');
  // real `agy -p /usage --output-format json` output (2026-10)
  const real = '{"conversation_id":"","status":"SUCCESS","response":"x","command":{"name":"usage","data":{"description":"d","groups":[{"name":"Gemini Models","description":"Gemini Flash, Gemini Pro","buckets":[{"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.979200005531311,"reset_time":"2026-11-04T07:33:02Z"}]},{"name":"Claude and GPT models","buckets":[{"id":"3p-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.8406019806861877,"reset_time":"2026-11-04T07:49:48Z"}]}]}}}';
  const r = parseAgyUsage(real).rows;
  assert.deepStrictEqual(r.map(x => [x.name, Math.round(x.pct), x.resetsAt]),
    [['Gemini', 2, '2026-11-04T07:33:02Z'], ['Claude and GPT', 16, '2026-11-04T07:49:48Z']]);
  // camelCase / multi-bucket variant
  const multi = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ displayName: 'Gemini', buckets: [
    { bucketId: 'a', window: 'session', remaining: { case: 'remainingFraction', value: 0.5 } },
    { bucketId: 'b', window: 'weekly', remainingFraction: 0.25 }, { bucketId: 'c', disabled: true, remainingFraction: 0 }] }] } } });
  assert.deepStrictEqual(parseAgyUsage(multi).rows.map(x => [x.name, x.pct]), [['Gemini · session', 50], ['Gemini · weekly', 75]]);
  assert.strictEqual(parseAgyUsage('{"status":"ERROR"}'), null);
  assert.strictEqual(parseAgyUsage('garbage'), null);
  console.log('agy parser ok');
}
