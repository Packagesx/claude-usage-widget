(() => {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  document.documentElement.dataset.material = params.get('material') || 'acrylic';
  document.documentElement.dataset.font = params.get('font') || 'anuphan';

  // ---- browser preview / mock (when not running inside Electron) ----
  const api = window.widget || (() => {
    const mock = params.get('mock') || 'ok';
    const h = 36e5, now = Date.now();
    const data = {
      ok: { state: 'ok', org: 'Pro · you@example.com', updatedAt: now,
        burn: (() => { const start = now - 2.7 * h, pts = []; let p = 0;
          for (let t = start; t <= now; t += 6 * 6e4) { p = Math.min(42, p + Math.random() * 2.2 + (t > now - 1.2 * h ? 0.8 : 0)); pts.push([t, p]); }
          pts[pts.length - 1][1] = 42;
          return { rate: 18, eta: now + (58 / 18) * h * (params.get('burn') === 'safe' ? 1 : 0.55), verdict: params.get('burn') || 'runout', spark: pts, start, end: now + 2.3 * h }; })(),
        products: { title: 'This week’s usage by product', rows: [{ name: 'Claude Code', pct: 12 }, { name: 'Chats', pct: 23 }, { name: 'Cowork', pct: 65 }, { name: 'Other', pct: 0 }] },
        items: [
        { key: 'five_hour', th: 'เซสชันนี้', sub: 'รอบ 5 ชั่วโมง', pct: 42, resetsAt: new Date(now + 2.3 * h).toISOString() },
        { key: 'seven_day', th: 'สัปดาห์นี้', sub: 'ทุกโมเดล', pct: 83, resetsAt: new Date(now + 76 * h).toISOString() },
        { key: 'iguana_necktie', kind: 'credit', th: 'เครดิต Cloud', sub: 'Claude Code บนคลาวด์', pct: 33, limit: 100, used: 33, left: 67, resetsAt: new Date(now + 38 * 24 * h).toISOString() },
      ] },
      auth: { state: 'auth' },
    }[mock];
    let cb = () => {};
    return {
      getInitial: async () => ({ payload: null, glass: { mode: params.get('glass') || 'frost', hex: params.get('ghex') ? '#' + params.get('ghex') : '#7b5cff', strength: Number(params.get('gs') || 55) }, color: { mode: params.get('color') || 'mono', hex: params.get('hex') ? '#' + params.get('hex') : '#3a7bff', speed: 8, warn: true } }),
      setColor() {}, setGlass() {},
      onUsage: (f) => { cb = f; setTimeout(() => f(data), 300); },
      refresh: () => { cb({ ...data, state: 'loading' }); setTimeout(() => cb({ ...data, updatedAt: Date.now() }), 600); },
      login() {}, hide() {}, menu() {}, openUsage() {}, resize() {}, setUiState() {},
      setSessionKey: async (k) => (k.startsWith('sk-ant-') ? { ok: true } : { ok: false, error: 'sessionKey ควรขึ้นต้นด้วย sk-ant-' }),
    };
  })();

  // ---- helpers ----
  const level = (p) => (p >= 90 ? 'hot' : p >= 70 ? 'warn' : p >= 50 ? 'mid' : 'ok');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- local interpolation: numbers and rings glide toward the latest value ----
  const tweens = new Map(); let raf = 0;
  function tween(key, target, apply) {
    const t = tweens.get(key);
    if (t) { t.target = target; t.apply = apply; } else tweens.set(key, { cur: 0, target, apply, shown: null });
    if (!raf) raf = requestAnimationFrame(stepTweens);
  }
  function stepTweens() {
    raf = 0; let moving = false;
    for (const t of tweens.values()) {
      const d = t.target - t.cur;
      if (Math.abs(d) < 0.05) t.cur = t.target; else { t.cur += d * 0.12; moving = true; }
      t.apply(t.cur);
    }
    if (moving) raf = requestAnimationFrame(stepTweens); // rAF is paused automatically while the window is hidden
  }
  function shortReset(iso) {
    if (!iso) return '—';
    const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'รีเซ็ตแล้ว';
    const m = Math.round(ms / 6e4), h = Math.floor(m / 60);
    if (h < 24) return h ? `${h}ชม. ${m % 60}น.` : `${m} นาที`;
    const d = new Date(iso);
    return `${d.toLocaleDateString('th-TH', { weekday: 'short' })} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
  }

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
    const num = `0<span>%</span>`;
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
      orbItems.forEach((it) => { const t = tweens.get('orb:' + it.key); if (t) t.shown = null; });
      $('#rows').innerHTML = rowItems.map(rowHTML).join('');
      lastKeys = keys;
    } else {
      // update numbers in place so the liquid animates smoothly
      orbItems.forEach((it) => {
        const g = $(`.gauge[data-key="${it.key}"]`); if (!g) return;
        g.querySelector('.reset').dataset.reset = it.resetsAt || '';
      });
      const rows = [...document.querySelectorAll('.row')];
      rowItems.forEach((it, i) => { const r = rows[i]; if (!r) return;
        r.querySelector('.rp').textContent = rpText(it); r.querySelector('.rr').dataset.reset = it.resetsAt || ''; });
    }
    // set fill levels on next frame so the transition runs
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('.gauge').forEach((g, i) => { g.querySelector('.orb').style.setProperty('--p', orbItems[i].pct / 100); });
      orbItems.forEach((it) => tween('orb:' + it.key, it.pct, (v) => {
        const r = Math.round(v), t = tweens.get('orb:' + it.key); if (t.shown === r) return; t.shown = r;
        document.querySelectorAll(`.gauge[data-key="${it.key}"] .num`).forEach((n) => (n.innerHTML = `${r}<span>%</span>`));
      }));
      document.querySelectorAll('#rows .capsule').forEach((c, i) => rowItems[i] && c.style.setProperty('--p', rowItems[i].pct / 100));
    }));
    tickResets();
  }

  // "This week's usage by product" (read from claude.ai/settings/usage)
  const PRODUCT_TH = { 'Claude Code': 'Claude Code', Chats: 'แชท', Chat: 'แชท', Cowork: 'Cowork', Other: 'อื่น ๆ' };
  function renderProducts(pr) {
    const el = $('#products');
    if (!pr || !pr.rows || !pr.rows.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="ph"><b>การใช้สัปดาห์นี้ตามผลิตภัณฑ์</b></div>` + pr.rows.map((r) => `
      <div class="prow${r.pct > 0 ? '' : ' zero'}">
        <span class="pn">${esc(PRODUCT_TH[r.name] || r.name)}</span>
        <div class="capsule slim" data-level="ok" style="--p:${Math.max(0, Math.min(100, r.pct)) / 100}"><i></i></div>
        <span class="pp">${Math.round(r.pct)}%</span>
      </div>`).join('');
  }

  // ---- compact pill: two minimalist rings ----
  let pillKeys = '';
  function renderPill(items) {
    const segs = [['five_hour', 'เซสชัน'], ['seven_day', 'สัปดาห์']].map(([k, label]) => [items.find((i) => i.key === k), label]).filter(([it]) => it);
    const keys = segs.map(([it]) => it.key).join('|');
    if (keys !== pillKeys) {
      $('#pill').innerHTML = segs.map(([it, label]) => `
        <div class="pseg" data-key="${it.key}" data-level="${level(it.pct)}">
          <span class="rwrap"><svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
            <circle class="track" cx="20" cy="20" r="16"/>
            <circle class="arc" cx="20" cy="20" r="16" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          </svg><b class="rn">0</b></span>
          <span class="pl"><span>${label}</span><em data-short="${esc(it.resetsAt || '')}">${shortReset(it.resetsAt)}</em></span>
        </div>`).join('');
      pillKeys = keys;
      segs.forEach(([it]) => { const t = tweens.get('pill:' + it.key); if (t) t.shown = null; });
    }
    segs.forEach(([it]) => {
      const seg = $(`.pseg[data-key="${it.key}"]`); if (!seg) return;
      seg.dataset.level = level(it.pct);
      seg.querySelector('[data-short]').dataset.short = it.resetsAt || '';
      const arc = seg.querySelector('.arc'), rn = seg.querySelector('.rn');
      tween('pill:' + it.key, it.pct, (v) => {
        arc.style.strokeDashoffset = String(100 - Math.max(0.5, v));
        const r = Math.round(v), t = tweens.get('pill:' + it.key); if (t.shown !== r) { t.shown = r; rn.textContent = r; }
      });
    });
  }

  function skeleton() {
    $('#orbs').innerHTML = [0, 1].map(() => `
      <div class="gauge"><div class="orb skeleton"><div class="liquid"></div><div class="shine"></div></div>
      <div class="glabel"><b>&nbsp;</b><em>กำลังโหลด…</em></div></div>`).join('');
    lastKeys = '';
  }

  function tickResets() {
    document.querySelectorAll('[data-short]').forEach((el) => (el.textContent = shortReset(el.dataset.short || null)));
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

    authState = auth;
    if (auth) { $('#org').textContent = 'ยังไม่ได้เชื่อมบัญชี'; $('#updated').textContent = ''; applyLayout(); return; }

    if (p.items && p.items.length) renderItems(p.items);
    else if (p.state === 'loading' || !p.items) skeleton();
    else { $('#orbs').innerHTML = '<p style="grid-column:1/-1;color:var(--ink-2);text-align:center">ไม่มีข้อมูล usage สำหรับบัญชีนี้</p>'; }

    renderProducts(p.products);
    if (p.items && p.items.length) {
      renderPill(p.items); hasData = true;
      const top = Math.max(0, ...p.items.filter((i) => i.key === 'five_hour' || i.key === 'seven_day').map((i) => i.pct));
      document.documentElement.dataset.alert = top >= 90 ? 'hot' : top >= 80 ? 'warn' : '';
    }
    renderBurn(p.burn, (p.items || []).find((i) => i.key === 'five_hour'));
    drawTrayIcon((p.items || []).find((i) => i.key === 'five_hour'));
    updateChevMini(p.items);
    if (p.org) $('#org').textContent = p.org;
    const u = $('#updated');
    if (p.state === 'error') {
      u.innerHTML = `<span class="dot bad"></span><span class="err">ดึงข้อมูลไม่ได้</span> · ${esc(p.error || '')}`;
    } else if (p.updatedAt) {
      const t = new Date(p.updatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      u.innerHTML = `<span class="dot"></span>อัปเดต ${t}`;
    } else u.textContent = 'กำลังโหลด…';
    applyLayout();
  }

  // ---- auto-fit window height to content ----
  function fit() {
    requestAnimationFrame(() => {
      const r = $('#glass').getBoundingClientRect();
      api.resize({ w: Math.ceil(r.width), h: Math.ceil(r.height) });
    });
  }
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
  // ---- gimmick: poke the liquid ----
  const QUIPS = ['blub!', 'ปุ๊ง~', 'บุ๋ง บุ๋ง', 'อย่าจิ้มแรงสิ', 'เย็นชื่นใจ 🧊', 'plop'];
  const pokes = new WeakMap();
  function poke(orb, ev) {
    const r = orb.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const p = parseFloat(getComputedStyle(orb).getPropertyValue('--p')) || 0;
    const liquidTop = r.height * (1 - p);
    const now = Date.now();
    const hist = (pokes.get(orb) || []).filter((t) => now - t < 2500); hist.push(now); pokes.set(orb, hist);

    // ripple where you tapped
    const rip = document.createElement('span'); rip.className = 'ripple';
    rip.style.left = `${x}px`; rip.style.top = `${y}px`; orb.appendChild(rip);
    setTimeout(() => rip.remove(), 750);

    // spin the liquid if poked a lot, otherwise slosh it
    const spin = hist.length >= 6;
    orb.classList.remove('slosh', 'whirl'); void orb.offsetWidth;
    orb.classList.add(spin ? 'whirl' : 'slosh');
    clearTimeout(orb._t); orb._t = setTimeout(() => orb.classList.remove('slosh', 'whirl'), spin ? 1650 : 1350);

    // bubbles rise through the liquid
    const liquid = orb.querySelector('.liquid');
    if (p > 0.04) {
      const n = spin ? 14 : 7;
      for (let i = 0; i < n; i++) {
        const b = document.createElement('span'); b.className = 'bubble';
        const size = 4 + Math.random() * 7;
        b.style.cssText = `left:${15 + Math.random() * 70}%;--s:${size}px;--d:${0.9 + Math.random() * 0.9}s;` +
          `--w:${(Math.random() - 0.5) * 14}px;--h:${Math.max(12, (r.height - 6) * p - 6)}px;animation-delay:${Math.random() * 0.35}s`;
        liquid.appendChild(b); setTimeout(() => b.remove(), 2200);
      }
    }
    // a few droplets splash out of the surface
    const drops = spin ? 8 : 4;
    for (let i = 0; i < drops; i++) {
      const d = document.createElement('span'); d.className = 'drop';
      const ang = (-90 + (Math.random() - 0.5) * 120) * Math.PI / 180, dist = 18 + Math.random() * 22;
      d.style.cssText = `left:${r.width / 2 + (Math.random() - 0.5) * r.width * 0.5}px;top:${Math.max(10, liquidTop)}px;` +
        `--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px`;
      orb.appendChild(d); setTimeout(() => d.remove(), 850);
    }
    // little speech bubble every few pokes
    const gauge = orb.closest('.gauge');
    if (spin && hist.length === 6) showToast(gauge, 'เวียนหัวแล้ว~ 🌀');
    else if (hist.length === 3) showToast(gauge, QUIPS[Math.floor(Math.random() * QUIPS.length)]);
  }
  function showToast(host, text) {
    host.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    host.appendChild(t); setTimeout(() => t.remove(), 1850);
  }
  $('#orbs').addEventListener('click', (ev) => { const orb = ev.target.closest('.orb'); if (orb && !orb.classList.contains('skeleton')) poke(orb, ev); });

  // ---- collapse / expand the details ----
  let collapsed = params.get('collapsed') === '1';
  function applyCollapsed(animate = true) {
    const d = $('#details');
    if (!animate) d.style.transition = 'none';
    d.classList.toggle('closed', collapsed);
    document.documentElement.classList.toggle('collapsed', collapsed);
    $('#btn-chev').setAttribute('aria-expanded', String(!collapsed));
    $('#btn-chev').title = collapsed ? 'แสดงรายละเอียด' : 'ซ่อนรายละเอียด';
    if (!animate) requestAnimationFrame(() => (d.style.transition = ''));
    // follow the height animation so the window shrinks/grows smoothly
    const t0 = performance.now();
    (function track() { fit(); if (performance.now() - t0 < 420) requestAnimationFrame(track); })();
  }
  function toggleCollapsed() { collapsed = !collapsed; applyCollapsed(); api.setPref && api.setPref({ collapsed }); }
  $('#btn-chev').onclick = toggleCollapsed;
  api.onToggleCollapse && api.onToggleCollapse(toggleCollapsed);
  applyCollapsed(false);
  function updateChevMini(items) {
    const credit = (items || []).find((i) => i.kind === 'credit');
    $('#chev-mini').textContent = credit ? `เครดิตเหลือ $${credit.left.toFixed(2)}` : 'รายละเอียด';
  }

  // ---- lock position ----
  const setLocked = (v) => (document.documentElement.dataset.locked = v ? '1' : '');
  setLocked(params.get('locked') === '1');
  api.onLocked && api.onLocked(setLocked);
  api.onRefit && api.onRefit(fit);

  // ---- session pace: burn rate + sparkline ----
  function renderBurn(b, sess) {
    const el = $('#burn');
    if (!sess) { el.hidden = true; return; }
    el.hidden = false;
    if (!b || !b.start || !b.end) {
      el.innerHTML = '<span class="bh">จังหวะการใช้เซสชัน</span><span class="bv">ยังไม่เริ่มรอบเซสชัน</span>'; return;
    }
    if (!b.spark || b.spark.length < 2) {
      el.innerHTML = `<span class="bh">จังหวะการใช้เซสชัน</span><span class="bv">กำลังเก็บข้อมูล… กราฟจะขึ้นในไม่กี่นาที</span>
        <svg class="spark" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true"><line class="cap" x1="0" y1="0.5" x2="300" y2="0.5"/>
        <line class="proj" x1="0" y1="29.5" x2="300" y2="29.5"/></svg>`;
      return;
    }
    const W = 300, H = 30, span = b.end - b.start;
    const X = (t) => Math.max(0, Math.min(W, ((t - b.start) / span) * W));
    const Y = (p) => H - (Math.max(0, Math.min(100, p)) / 100) * H;
    const pts = b.spark.filter(([t]) => t >= b.start - 6e4).map(([t, p]) => [X(t), Y(p)]);
    if (pts.length < 2) pts.unshift([0, pts[0] ? pts[0][1] : 30]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z`;
    const [nx, ny] = pts[pts.length - 1];
    let proj = '';
    if (b.eta && b.verdict !== 'idle') {
      const ex = X(Math.min(b.eta, b.end)), ey = b.eta <= b.end ? 0 : Y(sess.pct + (b.rate || 0) * ((b.end - Date.now()) / 36e5));
      proj = `<path class="proj" d="M${nx.toFixed(1)},${ny.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}"/>`;
    }
    const hm = (t) => new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const txt = {
      learning: ['', 'กำลังเก็บข้อมูล…'],
      idle: ['', 'ช่วงนี้แทบไม่ได้ใช้'],
      safe: ['safe', `+${Math.round(b.rate)}%/ชม. · พอใช้ถึงรีเซ็ต ✓`],
      runout: ['runout', `+${Math.round(b.rate)}%/ชม. · คาดว่าเต็ม ${b.eta ? hm(b.eta) : ''}`],
    }[b.verdict] || ['', ''];
    el.innerHTML = `<span class="bh">จังหวะการใช้เซสชัน</span><span class="bv ${txt[0]}">${txt[1]}</span>
      <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="cap" x1="0" y1="0.5" x2="${W}" y2="0.5"/>
        <path class="area" d="${area}"/><path class="line" d="${line}"/>${proj}
        <circle class="now" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="2.8"/>
      </svg>
      <div class="bf"><span>${hm(b.start)}</span><span>รีเซ็ต ${hm(b.end)}</span></div>`;
  }

  // ---- tray icon: a tiny ring showing the session % ----
  let lastTray = '';
  function drawTrayIcon(sess) {
    if (!api.setTrayIcon || !sess) return;
    const pct = Math.round(sess.pct), key = `${pct}|${level(sess.pct)}|${document.documentElement.dataset.color}`;
    if (key === lastTray) return; lastTray = key;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const mono = document.documentElement.dataset.color === 'mono';
    const g = c.getContext('2d'), col = { ok: mono ? '#ffffff' : '#4aa3ff', mid: mono ? '#f5c542' : '#4aa3ff', warn: '#ff9a3c', hot: '#ff3b5c' }[level(sess.pct)];
    g.lineWidth = 9; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = col; g.beginPath(); g.arc(32, 32, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, pct / 100)); g.stroke();
    g.fillStyle = '#fff'; g.font = `bold ${pct >= 100 ? 22 : 28}px "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3; g.fillText(String(pct), 32, 34);
    api.setTrayIcon(c.toDataURL('image/png'));
  }

  // ---- progressive disclosure: pill ⇄ full panel on hover ----
  var layout = params.get('layout') || 'full', expanded = false, hasData = false, authState = false;
  var ghost = params.get('ghost') === '1', lastHover = false, enterT = 0, leaveT = 0;
  const isBusy = () => panelOpen || authState || !$('#key-form').hidden || (document.activeElement && document.activeElement.tagName === 'INPUT');
  function applyLayout() {
    root.dataset.layout = layout;
    const pill = layout === 'compact' && hasData && !expanded && !isBusy();
    root.classList.toggle('pillmode', pill);
    api.setUiState && api.setUiState({ expanded: !pill, busy: isBusy() });
    fit();
  }
  function expand() {
    if (expanded) return;
    expanded = true; root.classList.remove('shrink'); root.classList.add('pop');
    applyLayout(); setTimeout(() => root.classList.remove('pop'), 320);
  }
  function collapse() {
    if (!expanded || isBusy() || lastHover) return;
    root.classList.add('shrink');
    setTimeout(() => { root.classList.remove('shrink'); if (lastHover) return; expanded = false; applyLayout(); }, 150);
  }
  function onHover(v) {
    lastHover = v;
    if (layout !== 'compact' || ghost) return;
    clearTimeout(enterT); clearTimeout(leaveT);
    if (v) enterT = setTimeout(expand, 120); else leaveT = setTimeout(collapse, 450);
  }
  api.onHover && api.onHover(onHover);
  api.onLayout && api.onLayout((v) => { layout = v; expanded = false; applyLayout(); });
  const setGhost = (v) => { ghost = v; root.dataset.ghost = v ? '1' : ''; if (v) { expanded = false; applyLayout(); } };
  setGhost(ghost);
  api.onGhost && api.onGhost(setGhost);
  api.onDock && api.onDock((d) => { root.dataset.dock = d.hidden ? d.side : ''; if (d.hidden) { expanded = false; applyLayout(); } });
  api.onAnchor && api.onAnchor((a) => { root.dataset.ax = a.right ? 'r' : 'l'; root.dataset.ay = a.bottom ? 'b' : 't'; });
  api.onPaused && api.onPaused((v) => root.classList.toggle('paused', v));
  // leaving a busy state (colour panel, login) should let the pill come back
  document.addEventListener('focusout', () => setTimeout(() => { if (!lastHover) collapse(); applyLayout(); }, 50));
  if (params.get('expanded')) { expanded = true; }

  // ---- header icon ----
  const SPARK = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3a27d"/><stop offset="1" stop-color="#c8603c"/></linearGradient></defs><path fill="url(#g)" d="M12 1.8c.7 5.6 3.1 8.1 10.2 10.2-7.1 2.1-9.5 4.6-10.2 10.2-.7-5.6-3.1-8.1-10.2-10.2C8.9 9.9 11.3 7.4 12 1.8z"/></svg>');
  function setIcon(v) {
    const img = document.querySelector('.mark img'); if (!img) return;
    img.src = !v || v === 'box' ? 'box.png' : v === 'spark' ? SPARK : v;
    document.querySelector('.mark').classList.toggle('custom', !!v && v.startsWith('data:image/') && v !== SPARK);
  }
  api.onIcon && api.onIcon(setIcon);

  api.onUsage(render);
  // ---- colour customisation: liquid + glass ----
  const PRESETS = ['#3a7bff', '#7b5cff', '#ff4fa3', '#ff5a5a', '#ff9a3c', '#d9774f', '#1fc8a0'];
  let color = { mode: 'mono', hex: '#3a7bff', speed: 8, warn: true };
  let glass = { mode: 'frost', hex: '#7b5cff', strength: 55 };
  let tab = 'liquid';
  const MODES = {
    liquid: [['mono', 'โมโน'], ['level', 'ตามระดับ'], ['solid', 'สีเดียว'], ['rgb', 'RGB']],
    glass: [['none', 'ใส'], ['frost', 'ฝ้า'], ['solid', 'ใส่สี'], ['rgb', 'RGB']],
  };
  const HINTS = {
    liquid: { mono: 'ขาว/เทาตามธีม · เริ่มมีสีเหลือง→ส้ม→แดง เมื่อใช้เกิน 50%', level: 'ฟ้า → ส้ม → แดง ตาม % ที่ใช้', solid: 'เลือกสีด้านล่าง หรือกด + เลือกสีเอง', rgb: 'ของเหลวไล่สีรุ้งวนตลอดเวลา' },
    glass: { none: 'ใสจริง ไม่มีสี ไม่เบลอ · สลับโหมดนี้แอปจะรีสตาร์ตแป๊บนึง', frost: 'กระจกฝ้าเบลอพื้นหลัง (แบบเดิม)', solid: 'กระจกย้อมสีแบบ Liquid Glass', rgb: 'แสงรุ้งเบลอๆ ลอยอยู่ข้างในกระจก' },
  };
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, s * 100, l * 100];
  }
  const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${Math.min(100, s).toFixed(0)}% ${Math.max(0, Math.min(100, l)).toFixed(0)}%)`;
  const cur = () => (tab === 'liquid' ? color : glass);

  function applyColor() {
    const root = document.documentElement;
    root.dataset.color = color.mode;
    root.dataset.warn = color.warn ? 'on' : 'off';
    root.dataset.glass = glass.mode;
    const [h, s, l] = hexToHsl(color.mode === 'rgb' ? '#ff4d6d' : color.hex);
    root.style.setProperty('--u2', hsl(h, s, Math.min(l, 58)));
    root.style.setProperty('--u1', hsl(h, s * 0.95, Math.min(l, 58) + 22));
    root.style.setProperty('--rgb-speed', `${color.speed}s`);
    root.style.setProperty('--g', glass.hex);
    root.style.setProperty('--gs', String(glass.strength / 100));

    // panel
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const c = cur();
    $('#seg').innerHTML = MODES[tab].map(([m, t]) => `<button type="button" role="radio" data-mode="${m}" aria-checked="${c.mode === m}">${t}</button>`).join('');
    $('#seg').querySelectorAll('button').forEach((btn) => (btn.onclick = () => { cur().mode = btn.dataset.mode; save(); }));
    $('#mode-hint').textContent = HINTS[tab][c.mode];
    document.querySelectorAll('.swatch[data-hex]').forEach((b) => b.setAttribute('aria-checked', String(c.mode === 'solid' && b.dataset.hex.toLowerCase() === c.hex.toLowerCase())));
    $('#color-input').value = c.hex;
    $('#view-color').classList.toggle('dim-swatches', c.mode !== 'solid');
    $('#strength-row').hidden = tab !== 'glass' || !['solid', 'rgb'].includes(glass.mode);
    $('#strength').value = glass.strength; $('#strength-val').textContent = `${glass.strength}%`;
    $('#speed-row').hidden = c.mode !== 'rgb';
    $('#speed').value = color.speed; $('#speed-val').textContent = `${color.speed} วิ`;
    $('#warn-row').hidden = tab !== 'liquid' || color.mode === 'level' || color.mode === 'mono';
    $('#warn').checked = color.warn;
    fit();
  }
  function save() { applyColor(); api.setColor && api.setColor(color); api.setGlass && api.setGlass(glass); }

  PRESETS.forEach((hex) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.hex = hex; b.title = hex; b.setAttribute('role', 'radio');
    const [h, s, l] = hexToHsl(hex); b.style.setProperty('--s1', hsl(h, s, l + 22)); b.style.setProperty('--s2', hex);
    b.onclick = () => { const c = cur(); c.hex = hex; c.mode = 'solid'; save(); };
    $('#swatches').insertBefore(b, $('.swatch.custom'));
  });
  $('#color-input').oninput = (e) => { const c = cur(); c.hex = e.target.value; c.mode = 'solid'; applyColor(); };
  $('#color-input').onchange = () => save();
  $('#speed').oninput = (e) => { color.speed = Number(e.target.value); applyColor(); };
  $('#speed').onchange = () => save();
  $('#strength').oninput = (e) => { glass.strength = Number(e.target.value); applyColor(); };
  $('#strength').onchange = () => save();
  $('#warn').onchange = (e) => { color.warn = e.target.checked; save(); };
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; applyColor(); }));

  var panelOpen = false, prevView = null; // var: render() may read these early
  function toggleColorPanel(open = !panelOpen) {
    panelOpen = open;
    if (open) {
      prevView = ['#view-usage', '#view-auth'].find((v) => !$(v).hidden) || '#view-usage';
      $('#view-usage').hidden = true; $('#view-auth').hidden = true; $('#view-color').hidden = false;
    } else {
      $('#view-color').hidden = true; $(prevView || '#view-usage').hidden = false;
      setTimeout(() => { if (!lastHover) collapse(); }, 300);
    }
    $('#btn-color').setAttribute('aria-pressed', String(open));
    applyLayout();
  }
  $('#btn-color').onclick = () => toggleColorPanel();
  $('#btn-color-done').onclick = () => toggleColorPanel(false);
  api.onOpenColor && api.onOpenColor(() => toggleColorPanel(true));
  if (params.get('panel')) { tab = params.get('panel') === 'glass' ? 'glass' : 'liquid'; setTimeout(() => toggleColorPanel(true), 50); }

  api.getInitial().then((r) => {
    if (r && r.color) color = { ...color, ...r.color };
    if (r && r.glass) glass = { ...glass, ...r.glass };
    if (r && r.icon) setIcon(r.icon);
    applyColor();
    if (r && r.payload) render(r.payload); else skeleton();
  });
})();
