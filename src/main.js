// Claude Usage Widget — main process
const {
  app, BrowserWindow, Tray, Menu, ipcMain, session, screen,
  nativeImage, Notification, shell, nativeTheme,
} = require('electron');
const path = require('path');
const { modelShare } = require('./models');
const fs = require('fs');

const PARTITION = 'persist:claude';
const BASE = 'https://claude.ai';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.pack.claudeusagewidget');

// ---------- settings ----------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  bounds: null,
  alwaysOnTop: true,
  refreshMinutes: 2,
  material: 'acrylic',        // acrylic | mica | clear
  font: 'anuphan',            // anuphan | plex | prompt | noto
  color: { mode: 'level', hex: '#3a7bff', speed: 8, warn: true }, // liquid: level | solid | rgb
  glass: { mode: 'none', hex: '#7b5cff', strength: 55 },         // glass tint: none | solid | rgb
  orgId: null,
  notify: true,
  notified: {},               // { key: resets_at|threshold }
};
let settings = { ...DEFAULTS };
function loadSettings() {
  try { const f = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = { ...DEFAULTS, ...f, color: { ...DEFAULTS.color, ...(f.color || {}) }, glass: { ...DEFAULTS.glass, ...(f.glass || {}) } }; }
  catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch {}
}

// ---------- state ----------
let win = null, tray = null, fetcher = null, loginWin = null;
let timer = null, orgs = [], lastPayload = null, quitting = false;

const claudeSession = () => session.fromPartition(PARTITION);

// ---------- widget window ----------
function defaultBounds(w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24, width: w, height: h };
}

function createWidget() {
  const W = 340, H = 300;
  let b = settings.bounds || defaultBounds(W, H);
  // keep on a visible display
  const d = screen.getDisplayMatching(b).workArea;
  if (b.x < d.x || b.y < d.y || b.x > d.x + d.width - 40 || b.y > d.y + d.height - 40) b = defaultBounds(W, H);

  const material = settings.material;
  const opts = {
    x: b.x, y: b.y, width: W, height: b.height || H,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    hasShadow: true,
    roundedCorners: true,
    title: 'Claude Usage',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (process.platform === 'win32' && material !== 'clear') {
    opts.backgroundMaterial = material; // Windows 11 22H2+: real desktop blur
    opts.backgroundColor = '#00000000';
  } else {
    opts.transparent = true;
    opts.backgroundColor = '#00000000';
  }

  win = new BrowserWindow(opts);
  win.loadFile(path.join(__dirname, 'index.html'), { query: { material, font: settings.font } });
  win.once('ready-to-show', () => win.showInactive());
  win.on('moved', () => { settings.bounds = win.getBounds(); saveSettings(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function toggleWidget() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else { win.show(); win.focus(); }
}

// ---------- tray ----------
function trayIcon() {
  const f = path.join(__dirname, '..', 'build', 'tray.png');
  const img = nativeImage.createFromPath(f);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function buildTrayMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings();
  const mat = (id, label) => ({
    label, type: 'radio', checked: settings.material === id,
    click: () => { if (settings.material !== id) { settings.material = id; saveSettings(); relaunch(); } },
  });
  const interval = (m) => ({
    label: m === 1 ? 'ทุก 1 นาที' : `ทุก ${m} นาที`, type: 'radio', checked: settings.refreshMinutes === m,
    click: () => { settings.refreshMinutes = m; saveSettings(); schedule(); buildTrayMenu(); },
  });
  const orgItems = orgs.length > 1 ? [{
    label: 'องค์กร / บัญชี',
    submenu: orgs.map(o => ({
      label: o.name || o.uuid, type: 'radio', checked: settings.orgId === o.uuid,
      click: () => { settings.orgId = o.uuid; saveSettings(); refresh(); buildTrayMenu(); },
    })),
  }] : [];

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'แสดง / ซ่อน widget', click: toggleWidget },
    { label: 'รีเฟรชตอนนี้', click: () => refresh() },
    { type: 'separator' },
    { label: 'อยู่บนสุดเสมอ', type: 'checkbox', checked: settings.alwaysOnTop,
      click: (i) => { settings.alwaysOnTop = i.checked; saveSettings(); win && win.setAlwaysOnTop(i.checked); } },
    { label: 'เปิดพร้อม Windows', type: 'checkbox', checked: login.openAtLogin,
      click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked }); } },
    { label: 'แจ้งเตือนเมื่อใช้ถึง 80% / 95%', type: 'checkbox', checked: settings.notify,
      click: (i) => { settings.notify = i.checked; saveSettings(); } },
    { label: 'ความถี่รีเฟรช', submenu: [1, 2, 5, 10].map(interval) },
    { label: 'สีของเหลว / RGB…', click: () => { if (win) { win.show(); win.webContents.send('open-color'); } } },
    { label: 'ฟอนต์', submenu: [
      ['anuphan', 'Anuphan (โมเดิร์น — ค่าเริ่มต้น)'], ['plex', 'IBM Plex Sans Thai (เรียบ คม)'],
      ['prompt', 'Prompt (กลมมน)'], ['noto', 'Noto Sans Thai (มาตรฐาน)'],
    ].map(([id, label]) => ({ label, type: 'radio', checked: settings.font === id,
      click: () => { settings.font = id; saveSettings(); win && win.webContents.send('font', id); buildTrayMenu(); } })) },
    { label: 'วัสดุกระจก', submenu: [
      mat('acrylic', 'Acrylic (เบลอ desktop — แนะนำ)'),
      mat('mica', 'Mica (เนียน ๆ ตามวอลเปเปอร์)'),
      mat('clear', 'Clear Glass (ใส — ใช้ถ้าเครื่องไม่รองรับ)'),
    ] },
    ...orgItems,
    { type: 'separator' },
    { label: 'เปิด claude.ai/settings/usage', click: () => shell.openExternal(`${BASE}/settings/usage`) },
    { label: 'ออกจากระบบ', click: signOut },
    { label: 'จัดตำแหน่งกลับมุมขวาล่าง', click: () => {
      const b = win.getBounds(); const nb = defaultBounds(b.width, b.height);
      win.setBounds(nb); settings.bounds = nb; saveSettings(); win.show();
    } },
    { type: 'separator' },
    { label: 'ปิดโปรแกรม', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Claude Usage');
  tray.on('click', toggleWidget);
  buildTrayMenu();
}

function relaunch() { quitting = true; app.relaunch(); app.exit(0); }

// ---------- data fetching (runs inside a hidden claude.ai page, so cookies + Cloudflare just work) ----------
function ensureFetcher() {
  return new Promise((resolve, reject) => {
    if (fetcher && !fetcher.isDestroyed() && fetcher.__ready) return resolve(fetcher);
    if (fetcher && !fetcher.isDestroyed()) fetcher.destroy();
    fetcher = new BrowserWindow({
      show: false, width: 400, height: 300,
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
    });
    const t = setTimeout(() => reject(new Error('timeout loading claude.ai')), 30000);
    fetcher.webContents.once('did-finish-load', () => { clearTimeout(t); fetcher.__ready = true; resolve(fetcher); });
    fetcher.webContents.once('did-fail-load', (_e, code, desc) => { clearTimeout(t); reject(new Error(desc || `load failed ${code}`)); });
    fetcher.loadURL(`${BASE}/robots.txt`);
  });
}

async function apiGet(p) {
  const f = await ensureFetcher();
  const js = `fetch(${JSON.stringify(p)}, {credentials:'include', headers:{'accept':'application/json'}})
    .then(async r => ({ status: r.status, text: await r.text() }))
    .catch(e => ({ status: 0, text: String(e) }))`;
  const r = await f.webContents.executeJavaScript(js, true);
  if (r.status === 401 || r.status === 403) {
    // could be logged-out or a Cloudflare challenge; reload page once
    if (/cf-|challenge|cloudflare/i.test(r.text)) { fetcher.__ready = false; }
    const err = new Error('auth'); err.code = 'AUTH'; throw err;
  }
  if (r.status !== 200) { const err = new Error(`HTTP ${r.status}`); err.code = 'HTTP'; throw err; }
  try { return JSON.parse(r.text); } catch { throw new Error('bad json'); }
}

async function hasSessionCookie() {
  const c = await claudeSession().cookies.get({ url: BASE, name: 'sessionKey' });
  return c.length > 0;
}

function pickOrg(list) {
  if (settings.orgId && list.find(o => o.uuid === settings.orgId)) return settings.orgId;
  const caps = (o) => (o.capabilities || []).join(',');
  const paid = list.find(o => /claude_max|claude_pro|raven|team|enterprise/i.test(caps(o)));
  const chat = list.find(o => /chat/.test(caps(o)));
  return (paid || chat || list[0]).uuid;
}

// Only show quotas we know how to name. claude.ai also returns internal codename keys
// (e.g. "iguana_necktie") that aren't meaningful to users — those are hidden.
const LABELS = {
  five_hour:            { th: 'เซสชันนี้',   sub: 'รอบ 5 ชั่วโมง' },
  seven_day:            { th: 'สัปดาห์นี้',  sub: 'ทุกโมเดล' },
  seven_day_opus:       { th: 'Opus',        sub: 'โควตารายสัปดาห์' },
  seven_day_sonnet:     { th: 'Sonnet',      sub: 'โควตารายสัปดาห์' },
  seven_day_oauth_apps: { th: 'แอปที่เชื่อมต่อ', sub: 'โควตารายสัปดาห์' },
  seven_day_cowork:     { th: 'Cowork',      sub: 'โควตารายสัปดาห์' },
  extra_usage:          { th: 'Extra usage', sub: 'เครดิตเพิ่มเติม' },
  iguana_necktie:       { th: 'เครดิต Cloud', sub: 'Claude Code บนคลาวด์' }, // fallback if no dollar fields
};

const CREDIT_LABELS = {
  iguana_necktie: { th: 'เครดิต Cloud', sub: 'Claude Code บนคลาวด์' },
};

function normalize(usage) {
  const items = [];
  for (const [key, v] of Object.entries(usage || {})) {
    if (!v || typeof v !== 'object') continue;
    // Dollar credit grants (e.g. iguana_necktie = Claude Code cloud-session credits):
    // { limit_dollars, used_dollars, remaining_dollars, resets_at (= expiry) }
    const lim = Number(v.limit_dollars);
    if (lim > 0) {
      let used = Number(v.used_dollars), left = Number(v.remaining_dollars);
      if (!Number.isFinite(used)) used = Number.isFinite(left) ? lim - left : 0;
      if (!Number.isFinite(left)) left = lim - used;
      const meta = CREDIT_LABELS[key] || { th: 'เครดิต', sub: key.replace(/_/g, ' ') };
      items.push({ key, kind: 'credit', pct: Math.max(0, Math.min(100, (used / lim) * 100)),
        limit: lim, used, left: Math.max(0, left), resetsAt: v.resets_at || null, ...meta });
      continue;
    }
    const u = v.utilization;
    if (typeof u !== 'number') continue;
    if (key === 'extra_usage' && v.is_enabled === false) continue;
    const meta = LABELS[key]; // unknown codename quotas (e.g. nimbus_quill) are not shown
    if (!meta) continue;
    items.push({ key, pct: Math.max(0, Math.min(100, u)), resetsAt: v.resets_at || null, ...meta });
  }
  const order = Object.keys(LABELS);
  const rank = (k) => (order.indexOf(k) + 1) || (CREDIT_LABELS[k] ? 90 : 99);
  items.sort((a, b) => rank(a.key) - rank(b.key));
  return items;
}

// "pack@x.com's Organization" + capabilities → "Max · pack@x.com"
function orgLabel(o) {
  if (!o) return '';
  const caps = (o.capabilities || []).join(',');
  const plan = /claude_max/.test(caps) ? 'Max' : /claude_pro/.test(caps) ? 'Pro'
    : /enterprise/.test(caps) ? 'Enterprise' : /team|raven/.test(caps) ? 'Team' : '';
  const name = String(o.name || '').replace(/['’]s Organi[sz]ation$/i, '');
  return [plan, name].filter(Boolean).join(' · ');
}

function maybeNotify(items) {
  if (!settings.notify || !Notification.isSupported()) return;
  for (const it of items) {
    if (!['five_hour', 'seven_day'].includes(it.key)) continue;
    const level = it.pct >= 95 ? 95 : it.pct >= 80 ? 80 : 0;
    if (!level) continue;
    const mark = `${it.resetsAt}|${level}`;
    if (settings.notified[it.key] === mark) continue;
    settings.notified[it.key] = mark; saveSettings();
    new Notification({
      title: `Claude ${it.th} ใช้ไป ${Math.round(it.pct)}%`,
      body: it.resetsAt ? `รีเซ็ต ${new Date(it.resetsAt).toLocaleString('th-TH', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
    }).show();
  }
}

function send(payload) {
  lastPayload = payload;
  if (win && !win.isDestroyed()) win.webContents.send('usage', payload);
}

let inflight = false;
async function refresh() {
  if (inflight) return; inflight = true;
  send({ ...(lastPayload || {}), state: 'loading' });
  try {
    if (!(await hasSessionCookie())) throw Object.assign(new Error('auth'), { code: 'AUTH' });
    const list = await apiGet('/api/organizations');
    orgs = Array.isArray(list) ? list : [];
    if (!orgs.length) throw new Error('ไม่พบองค์กรในบัญชีนี้');
    const orgId = pickOrg(orgs);
    if (settings.orgId !== orgId) { settings.orgId = orgId; saveSettings(); }
    buildTrayMenu();
    const usage = await apiGet(`/api/organizations/${orgId}/usage`);
    const items = normalize(usage);
    const org = orgs.find(o => o.uuid === orgId);
    // Per-model: use real per-model quotas if the plan has them, otherwise
    // fall back to the share of Claude Code usage per model on this PC.
    let models = null;
    if (!items.some(i => /^seven_day_(opus|sonnet)$/.test(i.key))) {
      const wk = items.find(i => i.key === 'seven_day');
      const since = wk && wk.resetsAt ? Date.parse(wk.resetsAt) - 7 * 864e5 : Date.now() - 7 * 864e5;
      try { models = await modelShare(since); } catch { models = null; }
    }
    send({ state: 'ok', items, models, org: orgLabel(org), updatedAt: Date.now() });
    maybeNotify(items);
    const five = items.find(i => i.key === 'five_hour');
    tray && tray.setToolTip(`Claude Usage${five ? ` — Session ${Math.round(five.pct)}%` : ''}`);
  } catch (e) {
    if (e.code === 'AUTH') send({ state: 'auth' });
    else send({ ...(lastPayload || {}), state: 'error', error: e.message });
  } finally { inflight = false; }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(refresh, Math.max(1, settings.refreshMinutes) * 60 * 1000);
}

// ---------- login ----------
// Google blocks sign-in inside embedded browsers ("This browser or app may not be secure"),
// so we intercept Google and steer the user to claude.ai's email login (works for Google-linked emails too).
const isGoogle = (u) => { try { return /(^|\.)accounts\.google\.com$|(^|\.)google\.com$/.test(new URL(u).hostname); } catch { return false; } };
const BANNER_JS = (flash) => `(() => {
  if (!location.hostname.endsWith('claude.ai')) return;
  let b = document.getElementById('cuw-banner');
  if (!b) {
    b = document.createElement('div'); b.id = 'cuw-banner';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:12px 14px;border-radius:14px;' +
      'font:13px/1.5 "Segoe UI","Leelawadee UI",sans-serif;color:#1b1b1f;background:rgba(255,244,236,.97);' +
      'box-shadow:0 10px 30px rgba(0,0,0,.25),inset 0 0 0 1px rgba(217,119,79,.45);transition:transform .2s';
    b.innerHTML = '<b style="color:#c4623d">⚠ ปุ่ม Google ใช้ในแอปนี้ไม่ได้ (Google บล็อก)</b><br>' +
      'ให้กรอก <b>อีเมล</b> ในช่อง Email แล้วกด <b>Continue with email</b> แทน — ใช้อีเมลเดียวกับบัญชี Google ได้เลย ' +
      'จากนั้นกรอกโค้ดจากอีเมล หรือถ้าอีเมลส่งมาเป็นลิงก์ ให้คลิกขวาที่ลิงก์ → Copy link แล้ววางด้านล่าง' +
      '<form id="cuw-f" style="display:flex;gap:6px;margin-top:8px">' +
      '<input id="cuw-i" placeholder="วางลิงก์จากอีเมล (https://claude.ai/magic-link#...)" style="flex:1;min-width:0;height:32px;border-radius:999px;border:1px solid #e3c2b3;padding:0 12px;font:inherit">' +
      '<button style="height:32px;border:0;border-radius:999px;padding:0 14px;color:#fff;font:inherit;font-weight:600;background:#d9774f;cursor:pointer">เปิด</button></form>' +
      '<div id="cuw-m" style="font-size:12px;color:#b3261e;margin-top:4px"></div>';
    document.documentElement.appendChild(b);
    b.querySelector('#cuw-f').onsubmit = (e) => { e.preventDefault();
      const v = b.querySelector('#cuw-i').value.trim();
      if (/^https:\\/\\/([a-z0-9-]+\\.)?claude\\.ai\\//i.test(v)) location.href = v;
      else b.querySelector('#cuw-m').textContent = 'ต้องเป็นลิงก์ที่ขึ้นต้นด้วย https://claude.ai/'; };
  }
  if (${flash}) { b.style.transform = 'scale(1.03)'; setTimeout(() => b.style.transform = '', 250);
    const em = document.querySelector('input[type=email],input[name=email]'); if (em) em.focus(); }
})()`;

function openLogin() {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 500, height: 760, title: 'เข้าสู่ระบบ claude.ai', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
  });
  const wc = loginWin.webContents;
  loginWin.loadURL(`${BASE}/login`);
  const banner = (flash) => { if (!loginWin || loginWin.isDestroyed()) return;
    wc.executeJavaScript(BANNER_JS(flash ? 'true' : 'false'), true).catch(() => {}); };
  wc.on('did-finish-load', () => banner(false));
  wc.on('did-navigate-in-page', () => banner(false));
  // block Google in-page redirects & popups; point the user to email login instead
  const blockGoogle = (e, url) => { if (isGoogle(url)) { e.preventDefault(); banner(true); } };
  wc.on('will-navigate', blockGoogle);
  wc.on('will-redirect', blockGoogle);
  wc.setWindowOpenHandler(({ url }) => {
    if (isGoogle(url)) { banner(true); return { action: 'deny' }; }
    if (/^https:\/\/([a-z0-9-]+\.)?claude\.ai\//i.test(url)) { loginWin.loadURL(url); return { action: 'deny' }; }
    shell.openExternal(url); return { action: 'deny' };
  });
  const check = setInterval(async () => {
    if (!loginWin || loginWin.isDestroyed()) return clearInterval(check);
    const url = wc.getURL();
    if ((await hasSessionCookie()) && !/\/login|\/magic-link|\/onboarding/.test(url)) {
      clearInterval(check); loginWin.close(); loginWin = null;
      if (fetcher && !fetcher.isDestroyed()) fetcher.destroy(); fetcher = null;
      refresh();
    }
  }, 1500);
  loginWin.on('closed', () => { clearInterval(check); loginWin = null; });
}

// read a sessionKey straight from the clipboard (user copied it from their browser's DevTools)
ipcMain.handle('read-clipboard-key', () => {
  const t = require('electron').clipboard.readText() || '';
  const m = t.match(/sk-ant-[A-Za-z0-9_\-]+/);
  return m ? m[0] : null;
});
ipcMain.on('open-claude-browser', () => shell.openExternal(`${BASE}/`));

async function setSessionKey(key) {
  key = String(key || '').trim().replace(/^sessionKey=/, '');
  if (!key.startsWith('sk-ant-')) return { ok: false, error: 'sessionKey ควรขึ้นต้นด้วย sk-ant-' };
  await claudeSession().cookies.set({
    url: BASE, domain: '.claude.ai', path: '/', name: 'sessionKey', value: key,
    secure: true, httpOnly: true, sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });
  if (fetcher && !fetcher.isDestroyed()) fetcher.destroy(); fetcher = null;
  refresh();
  return { ok: true };
}

async function signOut() {
  await claudeSession().clearStorageData();
  if (fetcher && !fetcher.isDestroyed()) fetcher.destroy(); fetcher = null;
  orgs = []; settings.orgId = null; saveSettings(); buildTrayMenu();
  send({ state: 'auth' });
}

// ---------- IPC ----------
ipcMain.handle('get-initial', () => ({ payload: lastPayload, material: settings.material, color: settings.color, glass: settings.glass }));
ipcMain.on('set-color', (_e, c) => {
  if (!c || typeof c !== 'object') return;
  const hex = /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : settings.color.hex;
  const mode = ['level', 'solid', 'rgb'].includes(c.mode) ? c.mode : 'level';
  const speed = Math.max(2, Math.min(30, Number(c.speed) || 8));
  settings.color = { mode, hex, speed, warn: c.warn !== false };
  saveSettings(); buildTrayMenu();
});
ipcMain.on('set-glass', (_e, g) => {
  if (!g || typeof g !== 'object') return;
  settings.glass = {
    mode: ['none', 'solid', 'rgb'].includes(g.mode) ? g.mode : 'none',
    hex: /^#[0-9a-f]{6}$/i.test(g.hex) ? g.hex : settings.glass.hex,
    strength: Math.max(10, Math.min(100, Number(g.strength) || 55)),
  };
  saveSettings();
});
ipcMain.on('refresh', () => refresh());
ipcMain.on('login', () => openLogin());
ipcMain.handle('set-session-key', (_e, k) => setSessionKey(k));
ipcMain.on('hide', () => win && win.hide());
ipcMain.on('menu', () => tray && tray.popUpContextMenu());
ipcMain.on('open-usage', () => shell.openExternal(`${BASE}/settings/usage`));
ipcMain.on('resize', (_e, h) => {
  if (!win) return;
  const b = win.getBounds(); const nh = Math.round(Math.max(120, Math.min(700, h)));
  if (Math.abs(b.height - nh) > 1) {
    // grow upward if near screen bottom so it stays anchored
    const wa = screen.getDisplayMatching(b).workArea;
    const nearBottom = b.y + b.height > wa.y + wa.height - 60;
    win.setBounds({ ...b, height: nh, y: nearBottom ? b.y + b.height - nh : b.y });
  }
});

// ---------- boot ----------
app.whenReady().then(() => {
  loadSettings();
  claudeSession().setUserAgent(CHROME_UA);
  app.userAgentFallback = CHROME_UA;
  createWidget();
  createTray();
  refresh();
  schedule();
  // refresh when waking from sleep / display changes
  require('electron').powerMonitor.on('resume', () => setTimeout(refresh, 4000));
  nativeTheme.on('updated', () => win && win.webContents.send('theme'));
});
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { quitting = true; });
