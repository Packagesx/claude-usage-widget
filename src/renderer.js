(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  document.documentElement.dataset.material = params.get('material') || 'acrylic';
  document.documentElement.dataset.font = params.get('font') || 'anuphan';

  // ---- browser preview / mock (when not running inside Electron) ----
  const api = window.widget || (() => {
    const mock = params.get('mock') || 'ok';
    const h = 36e5, now = Date.now();
    const data = {
      ok: { state: 'ok', org: 'Max · you@example.com', updatedAt: now, items: [
        { key: 'five_hour', th: 'เซสชันนี้', sub: 'รอบ 5 ชั่วโมง', pct: 42, resetsAt: new Date(now + 2.3 * h).toISOString() },
        { key: 'seven_day', th: 'สัปดาห์นี้', sub: 'ทุกโมเดล', pct: 83, resetsAt: new Date(now + 76 * h).toISOString() },
        { key: 'seven_day_opus', th: 'Opus', sub: 'โควตารายสัปดาห์', pct: 97, resetsAt: new Date(now + 76 * h).toISOString() },
        { key: 'seven_day_sonnet', th: 'Sonnet', sub: 'โควตารายสัปดาห์', pct: 18, resetsAt: new Date(now + 76 * h).toISOString() },
        { key: 'iguana_necktie', kind: 'credit', th: 'เครดิต Cloud', sub: 'Claude Code บนคลาวด์', pct: 33, limit: 100, used: 33, left: 67, resetsAt: new Date(now + 38 * 24 * h).toISOString() },
      ] },
      auth: { state: 'auth' },
    }[mock];
    let cb = () => {};
    return {
      getInitial: async () => ({ payload: null, color: { mode: params.get('color') || 'level', hex: params.get('hex') ? '#' + params.get('hex') : '#3a7bff', speed: 8, warn: true } }),
      setColor() {},
      onUsage: (f) => { cb = f; setTimeout(() => f(data), 300); },
      refresh: () => { cb({ ...data, state: 'loading' }); setTimeout(() => cb({ ...data, updatedAt: Date.now() }), 600); },
      login() {}, hide() {}, menu() {}, openUsage() {}, resize() {},
      setSessionKey: async (k) => (k.startsWith('sk-ant-') ? { ok: true } : { ok: false, error: 'sessionKey ควรขึ้นต้นด้วย sk-ant-' }),
    };
  })();

  // ---- helpers ----
  const level = (p) => (p >= 90 ? 'hot' : p >= 70 ? 'warn' : 'ok');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function resetText(iso) {
    if (!iso) return 'ยังไม่เริ่มรอบ';
    const t = new Date(iso).getTime(), ms = t - Date.now();
    if (ms <= 0) return 'กำลังรีเซ็ต…';
    const m = Math.round(ms / 6e4);
    if (m < 60) return `รีเซ็ตใน ${m} นาที`;
    const hrs = Math.floor(m / 60), mm = m % 60;
    if (hrs < 24) return `รีเซ็ตใน ${hrs} ชม. ${mm} นาที`;
    const d = new Date(t);
    const hm = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    if (hrs < 24 * 7) return `รีเซ็ต${d.toLocaleDateString('th-TH', { weekday: 'long' })} ${hm} น.`;
    return `รีเซ็ต ${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`;
  }

  function orbHTML(it) {
    const p = Math.round(it.pct);
    const num = `${p}<span>%</span>`;
    return `
      <div class="gauge" data-key="${esc(it.key)}">
        <div class="orb" data-level="${level(it.pct)}" style="--p:0" role="img" aria-label="${esc(it.th)} ${p}%">
          <div class="liquid"><div class="level">
            <svg class="wave back" viewBox="0 0 200 20" preserveAspectRatio="none"><use href="#wavepath"/></svg>
            <svg class="wave front" viewBox="0 0 200 20" preserveAspectRatio="none"><use href="#wavepath"/></svg>
          </div></div>
          <div class="num dark">${num}</div>
          <div class="num light">${num}</div>
          <div class="shine"></div>
        </div>
        <div class="glabel">
          <b>${esc(it.th)}</b>
          <em>${esc(it.sub)}</em>
          <span class="reset" data-reset="${esc(it.resetsAt || '')}">${resetText(it.resetsAt)}</span>
        </div>
      </div>`;
  }

  const usd = (n) => '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  const rpText = (it) => (it.kind === 'credit' ? `เหลือ ${usd(it.left)} / ${usd(it.limit)}` : `${Math.round(it.pct)}%`);
  function expiryText(iso) {
    if (!iso) return 'ไม่มีวันหมดอายุ';
    const d = new Date(iso), days = Math.ceil((d - Date.now()) / 864e5);
    if (days <= 0) return 'หมดอายุแล้ว';
    return `หมดอายุ ${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} · อีก ${days} วัน`;
  }
  function rowHTML(it) {
    const credit = it.kind === 'credit';
    return `
      <div class="row">
        <span class="rl">${esc(it.th)}<em>${esc(it.sub)}</em></span>
        <span class="rp">${rpText(it)}</span>
        <div class="capsule" data-level="${level(it.pct)}" style="--p:0"><i></i></div>
        <span class="rr" data-kind="${credit ? 'credit' : ''}" data-reset="${esc(it.resetsAt || '')}">${credit ? expiryText(it.resetsAt) : resetText(it.resetsAt)}</span>
      </div>`;
  }

  let lastKeys = '';
  function renderItems(items) {
    const orbItems = items.filter((i) => i.key === 'five_hour' || i.key === 'seven_day');
    const rowItems = items.filter((i) => !orbItems.includes(i));
    const keys = items.map((i) => `${i.key}:${level(i.pct)}`).join('|');

    if (keys !== lastKeys) {
      $('#orbs').innerHTML = orbItems.map(orbHTML).join('');
      $('#rows').innerHTML = rowItems.map(rowHTML).join('');
      lastKeys = keys;
    } else {
      // update numbers in place so the liquid animates smoothly
      orbItems.forEach((it) => {
        const g = $(`.gauge[data-key="${it.key}"]`); if (!g) return;
        g.querySelectorAll('.num').forEach((n) => (n.innerHTML = `${Math.round(it.pct)}<span>%</span>`));
        g.querySelector('.reset').dataset.reset = it.resetsAt || '';
      });
      const rows = [...document.querySelectorAll('.row')];
      rowItems.forEach((it, i) => { const r = rows[i]; if (!r) return;
        r.querySelector('.rp').textContent = rpText(it); r.querySelector('.rr').dataset.reset = it.resetsAt || ''; });
    }
    // set fill levels on next frame so the transition runs
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('.gauge').forEach((g, i) => { g.querySelector('.orb').style.setProperty('--p', orbItems[i].pct / 100); });
      document.querySelectorAll('.capsule').forEach((c, i) => c.style.setProperty('--p', rowItems[i].pct / 100));
    }));
    tickResets();
  }

  function skeleton() {
    $('#orbs').innerHTML = [0, 1].map(() => `
      <div class="gauge"><div class="orb skeleton"><div class="liquid"></div><div class="shine"></div></div>
      <div class="glabel"><b>&nbsp;</b><em>กำลังโหลด…</em></div></div>`).join('');
    lastKeys = '';
  }

  function tickResets() {
    document.querySelectorAll('[data-reset]').forEach((el) => (el.textContent = el.dataset.kind === 'credit' ? expiryText(el.dataset.reset || null) : resetText(el.dataset.reset || null)));
  }
  setInterval(tickResets, 30000);

  function render(p) {
    document.body.classList.toggle('loading', p.state === 'loading');
    const auth = p.state === 'auth';
    $('#view-auth').hidden = !auth;
    $('#view-usage').hidden = auth;
    if (panelOpen) { prevView = auth ? '#view-auth' : '#view-usage'; $('#view-auth').hidden = true; $('#view-usage').hidden = true; }
    $('#btn-refresh').hidden = auth;

    if (auth) { $('#org').textContent = 'ยังไม่ได้เชื่อมบัญชี'; $('#updated').textContent = ''; fit(); return; }

    if (p.items && p.items.length) renderItems(p.items);
    else if (p.state === 'loading' || !p.items) skeleton();
    else { $('#orbs').innerHTML = '<p style="grid-column:1/-1;color:var(--ink-2);text-align:center">ไม่มีข้อมูล usage สำหรับบัญชีนี้</p>'; }

    if (p.org) $('#org').textContent = p.org;
    const u = $('#updated');
    if (p.state === 'error') {
      u.innerHTML = `<span class="dot bad"></span><span class="err">ดึงข้อมูลไม่ได้</span> · ${esc(p.error || '')}`;
    } else if (p.updatedAt) {
      const t = new Date(p.updatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      u.innerHTML = `<span class="dot"></span>อัปเดต ${t}`;
    } else u.textContent = 'กำลังโหลด…';
    fit();
  }

  // ---- auto-fit window height to content ----
  function fit() { requestAnimationFrame(() => api.resize(Math.ceil($('#glass').getBoundingClientRect().height))); }
  new ResizeObserver(fit).observe($('#glass'));

  // ---- events ----
  $('#btn-refresh').onclick = () => api.refresh();
  $('#btn-menu').onclick = () => api.menu();
  $('#btn-hide').onclick = () => api.hide();
  $('#btn-open').onclick = () => api.openUsage();
  $('#btn-login').onclick = () => api.login();
  $('#btn-show-key').onclick = () => { $('#key-form').hidden = false; $('#btn-show-key').hidden = true; $('#key-input').focus(); fit(); };

  const submitKey = async (k) => {
    const msg = $('#key-msg');
    const r = await api.setSessionKey(k);
    if (r.ok) { msg.className = ''; msg.textContent = 'บันทึกแล้ว กำลังดึงข้อมูล…'; $('#key-input').value = ''; }
    else { msg.className = 'err'; msg.textContent = r.error; }
    fit();
  };
  $('#btn-open-browser').onclick = () => api.openClaudeBrowser && api.openClaudeBrowser();
  $('#btn-paste').onclick = async () => {
    const k = api.readClipboardKey ? await api.readClipboardKey() : null;
    if (k) submitKey(k);
    else { const m = $('#key-msg'); m.className = 'err'; m.textContent = 'ไม่พบ sessionKey ในคลิปบอร์ด (ต้องขึ้นต้นด้วย sk-ant-)'; fit(); }
  };
  $('#key-form').onsubmit = (e) => { e.preventDefault(); submitKey($('#key-input').value); };
  api.onFont && api.onFont((f) => { document.documentElement.dataset.font = f; fit(); });
  api.onUsage(render);
  // ---- colour customisation ----
  const PRESETS = ['#3a7bff', '#7b5cff', '#ff4fa3', '#ff5a5a', '#ff9a3c', '#d9774f', '#1fc8a0'];
  let color = { mode: 'level', hex: '#3a7bff', speed: 8, warn: true };
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, s * 100, l * 100];
  }
  const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${Math.min(100, s).toFixed(0)}% ${Math.max(0, Math.min(100, l)).toFixed(0)}%)`;
  function applyColor() {
    const root = document.documentElement;
    root.dataset.color = color.mode;
    root.dataset.warn = color.warn ? 'on' : 'off';
    const [h, s, l] = hexToHsl(color.mode === 'rgb' ? '#ff4d6d' : color.hex);
    root.style.setProperty('--u2', hsl(h, s, Math.min(l, 58)));
    root.style.setProperty('--u1', hsl(h, s * 0.95, Math.min(l, 58) + 22));
    root.style.setProperty('--rgb-speed', `${color.speed}s`);
    // panel state
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === color.mode)));
    document.querySelectorAll('.swatch[data-hex]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.hex.toLowerCase() === color.hex.toLowerCase())));
    $('#color-input').value = color.hex;
    $('#speed').value = color.speed; $('#speed-val').textContent = `${color.speed} วิ`;
    $('#warn').checked = color.warn;
    $('#speed-row').hidden = color.mode !== 'rgb';
    $('#view-color').classList.toggle('level-mode', color.mode !== 'solid');
    $('#mode-hint').textContent = { level: 'ฟ้า → ส้ม → แดง ตาม % ที่ใช้', solid: 'เลือกสีจากด้านล่าง หรือกด + เพื่อเลือกสีเอง', rgb: 'ไล่สีรุ้งวนตลอดเวลา + ขอบเรืองแสง' }[color.mode];
    fit();
  }
  const saveColor = () => { applyColor(); api.setColor && api.setColor(color); };
  PRESETS.forEach((hex) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.hex = hex; b.title = hex; b.setAttribute('role', 'radio');
    const [h, s, l] = hexToHsl(hex); b.style.setProperty('--s1', hsl(h, s, l + 22)); b.style.setProperty('--s2', hex);
    b.onclick = () => { color.hex = hex; color.mode = 'solid'; saveColor(); };
    $('#swatches').insertBefore(b, $('.swatch.custom'));
  });
  $('#color-input').oninput = (e) => { color.hex = e.target.value; color.mode = 'solid'; applyColor(); };
  $('#color-input').onchange = () => saveColor();
  document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { color.mode = b.dataset.mode; saveColor(); }));
  $('#speed').oninput = (e) => { color.speed = Number(e.target.value); applyColor(); };
  $('#speed').onchange = () => saveColor();
  $('#warn').onchange = (e) => { color.warn = e.target.checked; saveColor(); };

  var panelOpen = false, prevView = null; // var: render() may read these early
  function toggleColorPanel(open = !panelOpen) {
    panelOpen = open;
    if (open) {
      prevView = ['#view-usage', '#view-auth'].find((v) => !$(v).hidden) || '#view-usage';
      $('#view-usage').hidden = true; $('#view-auth').hidden = true; $('#view-color').hidden = false;
    } else {
      $('#view-color').hidden = true; $(prevView || '#view-usage').hidden = false;
    }
    $('#btn-color').setAttribute('aria-pressed', String(open));
    fit();
  }
  $('#btn-color').onclick = () => toggleColorPanel();
  $('#btn-color-done').onclick = () => toggleColorPanel(false);
  api.onOpenColor && api.onOpenColor(() => toggleColorPanel(true));
  if (params.get('panel')) setTimeout(() => toggleColorPanel(true), 50);

  api.getInitial().then((r) => {
    if (r && r.color) color = { ...color, ...r.color };
    applyColor();
    if (r && r.payload) render(r.payload); else skeleton();
  });
})();
