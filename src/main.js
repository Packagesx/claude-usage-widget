// Claude Usage Widget — main process
const {
  app, BrowserWindow, Tray, Menu, ipcMain, session, screen, globalShortcut,
  nativeImage, Notification, shell, nativeTheme, dialog,
} = require('electron');
const path = require('path');
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
  scale: 1,                   // widget size: 0.75 | 0.85 | 1 | 1.15
  collapsed: false,           // hide the details below the orbs
  locked: false,              // lock position (no dragging)
  icon: 'box',                // header icon: box | spark | custom
  pets: ['orange', 'sleepy'], // pixel cats walking in the glass (ids of built-ins or custom-*)
  customPets: [],             // [{ id, mime }] images the user added
  layout: 'compact',          // compact = small pill that expands on hover | full = always the full panel
  snap: true,                 // magnetic snap to screen edges
  edgeHide: false,            // slide away into the screen edge when not in use
  ghost: false,               // click-through
  fade: 0.3,                  // idle opacity (1 = never fade)
  color: { mode: 'mono', hex: '#3a7bff', speed: 8, warn: true },  // liquid: mono | level | solid | rgb
  glass: { mode: 'frost', hex: '#7b5cff', strength: 55 },        // none (truly clear) | frost | solid | rgb
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
let win = null, tray = null, fetcher = null, loginWin = null, currentMaterial = null;
// 'Clear' glass means no blur at all, so it needs a fully transparent window;
// the other glass modes sit on the blur material chosen in the tray (Acrylic by default).
const windowMaterial = () => (settings.glass && settings.glass.mode === 'none' ? 'clear' : settings.material);
let timer = null, orgs = [], lastPayload = null, quitting = false;

const claudeSession = () => session.fromPartition(PARTITION);

// ---------- widget window ----------
function defaultBounds(w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24, width: w, height: h };
}

function createWidget() {
  const W = Math.round(340 * settings.scale), H = Math.round(300 * settings.scale);
  let b = settings.bounds || defaultBounds(W, H);
  // keep on a visible display
  const d = screen.getDisplayMatching(b).workArea;
  if (b.x < d.x || b.y < d.y || b.x > d.x + d.width - 40 || b.y > d.y + d.height - 40) b = defaultBounds(W, H);

  const material = windowMaterial();
  currentMaterial = material;
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
  win.loadFile(path.join(__dirname, 'index.html'), { query: { material, font: settings.font, collapsed: settings.collapsed ? '1' : '', locked: settings.locked ? '1' : '', layout: settings.layout, ghost: settings.ghost ? '1' : '' } });
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.scale));
  win.once('ready-to-show', () => { win.showInactive(); if (settings.ghost) win.setIgnoreMouseEvents(true, { forward: true }); });
  win.on('moved', () => { if (!dock.hidden && !sliding) { snapToEdges(); settings.bounds = win.getBounds(); saveSettings(); } });
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
    click: () => { if (settings.material !== id) { settings.material = id; saveSettings(); if (windowMaterial() !== currentMaterial) relaunch(); else buildTrayMenu(); } },
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
    { label: 'ขนาด widget', submenu: [[0.75, 'เล็ก (75%)'], [0.85, 'กลาง (85%)'], [1, 'ปกติ (100%)'], [1.15, 'ใหญ่ (115%)']].map(([v, label]) => ({
      label, type: 'radio', checked: settings.scale === v,
      click: () => { settings.scale = v; saveSettings(); applyScale(); buildTrayMenu(); } })) },
    { label: 'ย่อ / ขยายรายละเอียด', click: () => win && win.webContents.send('toggle-collapse') },
    { label: 'ล็อกตำแหน่ง (ลากไม่ได้)', type: 'checkbox', checked: settings.locked,
      click: (i) => { settings.locked = i.checked; saveSettings(); win && win.webContents.send('locked', i.checked); } },
    { label: 'รูปแบบ', submenu: [['compact', 'กะทัดรัด — ชี้เมาส์แล้วค่อยกางออก'], ['full', 'เต็ม — แสดงแผงตลอด']].map(([v, label]) => ({
      label, type: 'radio', checked: settings.layout === v,
      click: () => { settings.layout = v; saveSettings(); win && win.webContents.send('layout', v); buildTrayMenu(); } })) },
    { label: 'ดูดติดขอบจอ', type: 'checkbox', checked: settings.snap,
      click: (i) => { settings.snap = i.checked; saveSettings(); snapToEdges(); } },
    { label: 'แอบชิดขอบเมื่อไม่ใช้ (ต้องติดขอบซ้าย/ขวา)', type: 'checkbox', checked: settings.edgeHide,
      click: (i) => { settings.edgeHide = i.checked; saveSettings(); snapToEdges(); if (!i.checked) showFromEdge(); } },
    { label: 'โหมดผี — คลิกทะลุ (Ctrl+Alt+G)', type: 'checkbox', checked: settings.ghost, click: (i) => setGhost(i.checked) },
    { label: 'จางลงเมื่อเมาส์อยู่ไกล', submenu: [[1, 'ไม่จาง'], [0.5, 'จางเหลือ 50%'], [0.3, 'จางเหลือ 30%'], [0.2, 'จางเหลือ 20%']].map(([v, label]) => ({
      label, type: 'radio', checked: settings.fade === v,
      click: () => { settings.fade = v; saveSettings(); buildTrayMenu(); } })) },
    { label: 'คีย์ลัด: Ctrl+Alt+C แสดง/ซ่อน · Ctrl+Alt+G โหมดผี', enabled: false },
    { label: 'อยู่บนสุดเสมอ', type: 'checkbox', checked: settings.alwaysOnTop,
      click: (i) => { settings.alwaysOnTop = i.checked; saveSettings(); win && win.setAlwaysOnTop(i.checked); } },
    { label: 'เปิดพร้อม Windows', type: 'checkbox', checked: login.openAtLogin,
      click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked }); } },
    { label: 'แจ้งเตือนเมื่อใช้ถึง 80% / 95%', type: 'checkbox', checked: settings.notify,
      click: (i) => { settings.notify = i.checked; saveSettings(); } },
    { label: 'ความถี่รีเฟรช', submenu: [1, 2, 5, 10].map(interval) },
    { label: 'สีของเหลว / RGB…', click: () => { if (win) { win.show(); win.webContents.send('open-color'); } } },
    { label: 'น้องแมว 🐾', submenu: [
      ...PETS.map(([id, label]) => ({ label, type: 'checkbox', checked: (settings.pets || []).includes(id), click: (i) => togglePet(id, i.checked) })),
      { type: 'separator' },
      ...(settings.customPets || []).map((c, n) => ({ label: `น้องของฉัน ${n + 1}`, submenu: [
        { label: 'แสดง', type: 'checkbox', checked: (settings.pets || []).includes(c.id), click: (i) => togglePet(c.id, i.checked) },
        { label: 'ลบออก', click: () => removeCustomPet(c.id) } ] })),
      { label: 'เพิ่มน้องจากรูปเอง…', click: () => addCustomPet() },
      { label: 'ซ่อนทั้งหมด', click: () => { settings.pets = []; pushPets(); } },
    ] },
    { label: 'ไอคอนมุมซ้ายบน', submenu: [
      { label: 'กล่อง', type: 'radio', checked: settings.icon === 'box', click: () => setIcon('box') },
      { label: 'ประกายดาว', type: 'radio', checked: settings.icon === 'spark', click: () => setIcon('spark') },
      { label: 'เลือกรูปเอง…', type: 'radio', checked: settings.icon === 'custom', click: () => pickCustomIcon() },
    ] },
    { label: 'ฟอนต์', submenu: [
      ['anuphan', 'Anuphan (โมเดิร์น — ค่าเริ่มต้น)'], ['plex', 'IBM Plex Sans Thai (เรียบ คม)'],
      ['prompt', 'Prompt (กลมมน)'], ['noto', 'Noto Sans Thai (มาตรฐาน)'],
    ].map(([id, label]) => ({ label, type: 'radio', checked: settings.font === id,
      click: () => { settings.font = id; saveSettings(); win && win.webContents.send('font', id); buildTrayMenu(); } })) },
    { label: 'วัสดุเบลอ (โหมดฝ้า / ใส่สี / RGB)', submenu: [
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

function applyScale() {
  if (!win) return;
  const b = win.getBounds();
  win.webContents.setZoomFactor(settings.scale);
  win.webContents.send('refit');
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

// ---------- session history -> burn rate & sparkline ----------
const histPath = () => path.join(app.getPath('userData'), 'history.json');
let history = null; // { resetsAt, samples: [[t, pct], ...] } for the current 5-hour window
function loadHistory() { try { history = JSON.parse(fs.readFileSync(histPath(), 'utf8')); } catch { history = null; } }
function recordSession(it) {
  if (!it) return null;
  const sameWindow = history && history.resetsAt && it.resetsAt
    && Math.abs(Date.parse(history.resetsAt) - Date.parse(it.resetsAt)) < 20 * 60 * 1000;
  if (!sameWindow) history = { resetsAt: it.resetsAt, samples: [] };
  else history.resetsAt = it.resetsAt;
  const now = Date.now(), last = history.samples[history.samples.length - 1];
  if (!last || now - last[0] > 50 * 1000) history.samples.push([now, it.pct]);
  if (history.samples.length > 400) history.samples.splice(0, history.samples.length - 400);
  try { fs.writeFileSync(histPath(), JSON.stringify(history)); } catch {}
  // rate over the last ~45 minutes (needs at least 10 minutes of data)
  const recent = history.samples.filter(([t]) => now - t <= 45 * 60 * 1000);
  let rate = null, eta = null, verdict = 'learning';
  if (recent.length >= 2 && recent[recent.length - 1][0] - recent[0][0] >= 10 * 60 * 1000) {
    const [t0, p0] = recent[0], [t1, p1] = recent[recent.length - 1];
    rate = Math.max(0, (p1 - p0) / ((t1 - t0) / 36e5)); // % per hour
    const resetT = it.resetsAt ? Date.parse(it.resetsAt) : null;
    if (rate < 0.5) verdict = 'idle';
    else {
      eta = now + ((100 - it.pct) / rate) * 36e5;
      verdict = resetT && eta < resetT ? 'runout' : 'safe';
    }
  }
  return { rate, eta, verdict, spark: history.samples.slice(),
    start: it.resetsAt ? Date.parse(it.resetsAt) - 5 * 36e5 : null, end: it.resetsAt ? Date.parse(it.resetsAt) : null };
}

let prevSession = null;
function notifyReset(it) {
  if (!it) return;
  if (prevSession && prevSession.resetsAt && it.resetsAt !== prevSession.resetsAt && prevSession.pct >= 50 && it.pct < prevSession.pct
      && settings.notify && Notification.isSupported()) {
    new Notification({ title: 'เซสชัน Claude รีเซ็ตแล้ว 🎉', body: 'โควตา 5 ชั่วโมงกลับมาเต็มแล้ว ใช้ต่อได้เลย',
      icon: path.join(__dirname, '..', 'build', 'icon.png') }).show();
  }
  prevSession = { resetsAt: it.resetsAt, pct: it.pct };
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
// ---------- "This week's usage by product" ----------
// claude.ai shows a per-product breakdown (Claude Code / Chats / Cowork / Other) on
// /settings/usage, but there's no documented API for it. We load that page in a hidden
// window with the user's session and read the section's text, so whatever claude.ai
// shows is what the widget shows. Throttled because it loads a full page.
let lastProducts = null, productsAt = 0, productsBusy = false;
const PRODUCTS_EVERY = 10 * 60 * 1000;
const SCRAPE_JS = `(() => {
  const RX = /usage by product|ตามผลิตภัณฑ์/i;
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,span,strong')]
    .filter(e => e.children.length === 0 && RX.test(e.textContent || ''));
  if (!heads.length) return null;
  let box = heads[0];
  for (let i = 0; i < 8 && box; i++) {
    if (((box.innerText || '').match(/\\d+(?:\\.\\d+)?\\s*%/g) || []).length >= 2) break;
    box = box.parentElement;
  }
  if (!box) return null;
  const lines = (box.innerText || '').split(/[\\n\\t]/).map(s => s.trim()).filter(Boolean);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^(<?\\s*\\d+(?:\\.\\d+)?)\\s*%$/);
    if (m && !/%$/.test(lines[i - 1]) && !RX.test(lines[i - 1]))
      rows.push({ name: lines[i - 1], pct: parseFloat(m[1].replace(/[<\\s]/g, '')) });
  }
  return rows.length ? { title: heads[0].textContent.trim(), rows } : null;
})()`;

async function scrapeProducts() {
  const w = new BrowserWindow({ show: false, width: 1100, height: 1400,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    await w.loadURL(`${BASE}/settings/usage`);
    for (let i = 0; i < 25; i++) {            // SPA renders after load; poll up to ~25 s
      await new Promise(r => setTimeout(r, 1000));
      if (w.isDestroyed()) return null;
      const r = await w.webContents.executeJavaScript(SCRAPE_JS, true).catch(() => null);
      if (r) return r;
    }
    return null;
  } finally { if (!w.isDestroyed()) w.destroy(); }
}

async function refreshProducts(force = false) {
  if (productsBusy || (!force && Date.now() - productsAt < PRODUCTS_EVERY && lastProducts)) return;
  productsBusy = true;
  try {
    const r = await scrapeProducts();
    productsAt = Date.now();
    if (r) { lastProducts = r; if (lastPayload && lastPayload.state === 'ok') send({ ...lastPayload, products: r }); }
  } catch {} finally { productsBusy = false; }
}

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
    const sess = items.find(i => i.key === 'five_hour');
    const burn = recordSession(sess);
    notifyReset(sess);
    send({ state: 'ok', items, burn, products: lastProducts, org: orgLabel(org), updatedAt: Date.now() });
    refreshProducts(); // "This week's usage by product" — throttled, arrives a moment later
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
ipcMain.handle('get-initial', () => ({ payload: lastPayload, material: currentMaterial, color: settings.color, glass: settings.glass, icon: iconDataUrl(), pets: petList() }));

// ---------- pets: pixel cats that wander around the glass ----------
const PETS = [
  ['orange', 'ส้มจี๊ด — เดินเล่น'], ['black', 'ดำ — นั่งเฝ้า'], ['calico', 'สามสี — เล่นไหมพรม'],
  ['reader', 'นักอ่าน — อ่านหนังสือ'], ['sleepy', 'ขี้เซา — นอนหลับ'], ['siamese', 'วิเชียรมาศ — วิ่งไล่ปลา'],
];
const petsDir = () => path.join(app.getPath('userData'), 'pets');
function petList() {
  return (settings.pets || []).map((id) => {
    if (!id.startsWith('custom-')) return PETS.some(([k]) => k === id) ? { id, kind: id, src: `cats/${id}.png` } : null;
    const meta = (settings.customPets || []).find((c) => c.id === id);
    if (!meta) return null;
    try { return { id, kind: 'custom', src: `data:${meta.mime};base64,` + fs.readFileSync(path.join(petsDir(), id)).toString('base64') }; }
    catch { return null; }
  }).filter(Boolean);
}
function pushPets() { saveSettings(); buildTrayMenu(); if (win) win.webContents.send('pets', petList()); }
function togglePet(id, on) {
  const set = new Set(settings.pets || []);
  if (on) set.add(id); else set.delete(id);
  settings.pets = [...set].slice(0, 6); // keep it light: at most 6 on screen
  pushPets();
}
async function addCustomPet() {
  const r = await dialog.showOpenDialog({ title: 'เลือกรูปน้อง (PNG/GIF/WEBP พื้นหลังใส)', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'gif', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return;
  const f = r.filePaths[0], ext = path.extname(f).slice(1).toLowerCase(), buf = fs.readFileSync(f);
  if (buf.length > 1024 * 1024) { dialog.showErrorBox('รูปใหญ่เกินไป', 'ใช้รูปขนาดไม่เกิน 1 MB (แนะนำภาพพิกเซลเล็กๆ พื้นหลังใส)'); return; }
  fs.mkdirSync(petsDir(), { recursive: true });
  const id = 'custom-' + Date.now().toString(36);
  fs.writeFileSync(path.join(petsDir(), id), buf);
  settings.customPets = [...(settings.customPets || []), { id, mime: { png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] }];
  togglePet(id, true);
}
function removeCustomPet(id) {
  settings.customPets = (settings.customPets || []).filter((c) => c.id !== id);
  try { fs.unlinkSync(path.join(petsDir(), id)); } catch {}
  togglePet(id, false);
}

// ---------- header icon: built-in box / sparkle, or any image the user picks ----------
const customIconPath = () => path.join(app.getPath('userData'), 'custom-icon');
function iconDataUrl() {
  if (settings.icon === 'custom') {
    try {
      const meta = JSON.parse(fs.readFileSync(customIconPath() + '.json', 'utf8'));
      return `data:${meta.mime};base64,` + fs.readFileSync(customIconPath()).toString('base64');
    } catch { /* fall back to built-in */ }
  }
  return settings.icon === 'spark' ? 'spark' : 'box';
}
async function pickCustomIcon() {
  const r = await dialog.showOpenDialog({ title: 'เลือกรูปไอคอน', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'] }] });
  if (r.canceled || !r.filePaths[0]) return;
  const f = r.filePaths[0], ext = path.extname(f).slice(1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon' }[ext];
  const buf = fs.readFileSync(f);
  if (!mime || buf.length > 2 * 1024 * 1024) { dialog.showErrorBox('ใช้รูปนี้ไม่ได้', 'รองรับ PNG / JPG / WEBP / GIF / SVG / ICO ขนาดไม่เกิน 2 MB'); return; }
  fs.writeFileSync(customIconPath(), buf);
  fs.writeFileSync(customIconPath() + '.json', JSON.stringify({ mime }));
  setIcon('custom');
}
function setIcon(v) {
  settings.icon = v; saveSettings(); buildTrayMenu();
  if (win) win.webContents.send('icon', iconDataUrl());
}
ipcMain.on('set-color', (_e, c) => {
  if (!c || typeof c !== 'object') return;
  const hex = /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : settings.color.hex;
  const mode = ['mono', 'level', 'solid', 'rgb'].includes(c.mode) ? c.mode : 'mono';
  const speed = Math.max(2, Math.min(30, Number(c.speed) || 8));
  settings.color = { mode, hex, speed, warn: c.warn !== false };
  saveSettings(); buildTrayMenu();
});
ipcMain.on('set-glass', (_e, g) => {
  if (!g || typeof g !== 'object') return;
  settings.glass = {
    mode: ['none', 'frost', 'solid', 'rgb'].includes(g.mode) ? g.mode : 'frost',
    hex: /^#[0-9a-f]{6}$/i.test(g.hex) ? g.hex : settings.glass.hex,
    strength: Math.max(10, Math.min(100, Number(g.strength) || 55)),
  };
  saveSettings();
  // switching between truly-clear and blurred glass needs a new window
  if (windowMaterial() !== currentMaterial) setTimeout(relaunch, 350);
});
ipcMain.on('refresh', () => { productsAt = 0; refresh(); });
ipcMain.on('set-pref', (_e, p) => {
  if (p && typeof p.collapsed === 'boolean') settings.collapsed = p.collapsed;
  saveSettings();
});
// the renderer draws a little % ring for the tray icon
ipcMain.on('tray-icon', (_e, dataUrl) => {
  if (!tray || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return;
  const img = nativeImage.createFromDataURL(dataUrl);
  if (!img.isEmpty()) tray.setImage(img.resize({ width: 16, height: 16, quality: 'best' }));
});
ipcMain.on('login', () => openLogin());
ipcMain.handle('set-session-key', (_e, k) => setSessionKey(k));
ipcMain.on('hide', () => win && win.hide());
ipcMain.on('menu', () => tray && tray.popUpContextMenu());
ipcMain.on('open-usage', () => shell.openExternal(`${BASE}/settings/usage`));
ipcMain.on('resize', (_e, size) => {
  if (!win || sliding) return;
  const cssW = typeof size === 'object' ? size.w : 340, cssH = typeof size === 'object' ? size.h : size;
  const w = Math.round(Math.max(60, Math.min(700, cssW * settings.scale)));
  const h = Math.round(Math.max(40, Math.min(1000, cssH * settings.scale)));
  const b = dock.hidden ? dock.shown : win.getBounds();
  if (Math.abs(b.width - w) <= 1 && Math.abs(b.height - h) <= 1) return;
  const nb = anchoredBounds(b, w, h);
  if (dock.hidden) { dock.shown = nb; win.setBounds(hiddenBounds(nb, dock.side)); }
  else win.setBounds(nb);
});

// Keep the corner nearest the screen edge fixed when the widget grows or shrinks,
// so expanding from the pill never jumps away from where you put it.
function anchoredBounds(b, w, h) {
  const wa = screen.getDisplayMatching(b).workArea;
  const right = b.x + b.width / 2 > wa.x + wa.width / 2;
  const bottom = b.y + b.height / 2 > wa.y + wa.height / 2;
  let x = right ? b.x + b.width - w : b.x;
  let y = bottom ? b.y + b.height - h : b.y;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  if (win) win.webContents.send('anchor', { right, bottom });
  return { x, y, width: w, height: h };
}

// ---------- magnetic snap, edge hiding, adaptive opacity ----------
const SNAP = 28, GAP = 8, SLIVER = 6;
const dock = { side: null, hidden: false, shown: null };
let sliding = false, uiState = { expanded: false, busy: false };

function isOuterEdge(b, side) {
  // only hide into an edge that has no other monitor beyond it
  const probe = { x: side === 'left' ? b.x - 20 : b.x + b.width + 20, y: Math.round(b.y + b.height / 2) };
  return !screen.getAllDisplays().some(d => probe.x >= d.bounds.x && probe.x < d.bounds.x + d.bounds.width
    && probe.y >= d.bounds.y && probe.y < d.bounds.y + d.bounds.height);
}
function snapToEdges() {
  if (!win) return;
  const b = win.getBounds(), wa = screen.getDisplayMatching(b).workArea;
  let { x, y } = b; dock.side = null;
  if (settings.snap) {
    if (Math.abs(b.x - wa.x) < SNAP + GAP) { x = wa.x + GAP; }
    else if (Math.abs(wa.x + wa.width - (b.x + b.width)) < SNAP + GAP) { x = wa.x + wa.width - b.width - GAP; }
    if (Math.abs(b.y - wa.y) < SNAP + GAP) y = wa.y + GAP;
    else if (Math.abs(wa.y + wa.height - (b.y + b.height)) < SNAP + GAP) y = wa.y + wa.height - b.height - GAP;
    if (x !== b.x || y !== b.y) win.setBounds({ ...b, x, y });
  }
  const nb = win.getBounds();
  if (Math.abs(nb.x - (wa.x + GAP)) <= 1) dock.side = 'left';
  else if (Math.abs(nb.x + nb.width - (wa.x + wa.width - GAP)) <= 1) dock.side = 'right';
  if (dock.side && !isOuterEdge(nb, dock.side)) dock.side = null;
}
function hiddenBounds(b, side) {
  const wa = screen.getDisplayMatching(b).workArea;
  return { ...b, x: side === 'left' ? wa.x - b.width + SLIVER : wa.x + wa.width - SLIVER };
}
function slideTo(target, done) {
  sliding = true;
  const from = win.getBounds(), steps = 12; let i = 0;
  const tick = () => {
    if (!win || win.isDestroyed()) return;
    i++; const t = 1 - Math.pow(1 - i / steps, 3); // ease-out cubic
    win.setBounds({ ...target, x: Math.round(from.x + (target.x - from.x) * t) });
    if (i < steps) setTimeout(tick, 14); else { sliding = false; done && done(); }
  };
  tick();
}
function hideIntoEdge() {
  if (!win || dock.hidden || !dock.side) return;
  dock.shown = win.getBounds(); dock.hidden = true;
  win.webContents.send('dock', { side: dock.side, hidden: true });
  slideTo(hiddenBounds(dock.shown, dock.side));
}
function showFromEdge() {
  if (!win || !dock.hidden) return;
  dock.hidden = false;
  win.webContents.send('dock', { side: dock.side, hidden: false });
  slideTo(dock.shown);
}

let opacity = 1, awaySince = Date.now(), insideSince = 0, wasInside = false;
function watchCursor() {
  if (!win || win.isDestroyed() || !win.isVisible() || sliding) return;
  const c = screen.getCursorScreenPoint(), b = win.getBounds(), now = Date.now();
  const within = (m) => c.x >= b.x - m && c.x < b.x + b.width + m && c.y >= b.y - m && c.y < b.y + b.height + m;
  const inside = within(0), near = within(70);
  if (inside !== wasInside) { wasInside = inside; win.webContents.send('hover', inside); }
  if (near) awaySince = now;

  // edge hiding
  if (settings.edgeHide && dock.side) {
    if (dock.hidden && inside) showFromEdge();
    else if (!dock.hidden && !near && !uiState.busy && now - awaySince > 1500) hideIntoEdge();
  }
  // adaptive opacity (ghost mode: see through it while the cursor is over it)
  let target = 1;
  if (settings.ghost && inside) target = 0.35;
  else if (settings.fade < 1 && !near && !uiState.busy && !dock.hidden && now - awaySince > 2500) target = settings.fade;
  const step = target > opacity ? 0.34 : 0.06; // come back fast, fade out slowly
  const next = Math.abs(target - opacity) <= step ? target : opacity + Math.sign(target - opacity) * step;
  if (next !== opacity) {
    opacity = next; win.setOpacity(opacity);
    win.webContents.send('paused', opacity < 0.6 || dock.hidden);
  }
}
setInterval(watchCursor, 100);

function setGhost(v) {
  settings.ghost = v; saveSettings();
  if (win) { win.setIgnoreMouseEvents(v, { forward: true }); win.webContents.send('ghost', v); }
  buildTrayMenu();
}
ipcMain.on('ui-state', (_e, st) => { if (st && typeof st === 'object') uiState = { expanded: !!st.expanded, busy: !!st.busy }; });

// ---------- boot ----------
app.whenReady().then(() => {
  loadSettings();
  loadHistory();
  claudeSession().setUserAgent(CHROME_UA);
  app.userAgentFallback = CHROME_UA;
  createWidget();
  createTray();
  refresh();
  schedule();
  // refresh when waking from sleep / display changes
  require('electron').powerMonitor.on('resume', () => setTimeout(refresh, 4000));
  nativeTheme.on('updated', () => win && win.webContents.send('theme'));
  try { globalShortcut.register('CommandOrControl+Alt+C', toggleWidget); } catch {}
  try { globalShortcut.register('CommandOrControl+Alt+G', () => setGhost(!settings.ghost)); } catch {}
  setTimeout(snapToEdges, 1500);
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { quitting = true; });
