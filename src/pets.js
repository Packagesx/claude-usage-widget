// Pixel cats that wander along the bottom of the glass.
//
// Kept deliberately cheap:
//  * no per-frame JavaScript — each cat decides what to do next on a slow timer (every few seconds)
//  * movement is a single CSS transform transition, walking/sleeping are transform/opacity keyframes,
//    so everything runs on the compositor
//  * nothing runs while the widget is a pill, hidden in the screen edge, faded out, or the window is hidden
(() => {
  const root = document.documentElement;
  const layer = document.getElementById('pets');
  if (!layer) return;

  // how each sprite behaves; `face` is the direction the artwork looks
  const KINDS = {
    orange:  { face: 1,  mode: 'walk',  speed: 26 },
    black:   { face: 0,  mode: 'sit',   speed: 0 },
    calico:  { face: -1, mode: 'walk',  speed: 16 },
    reader:  { face: 0,  mode: 'read',  speed: 0 },
    sleepy:  { face: -1, mode: 'sleep', speed: 0 },
    siamese: { face: 1,  mode: 'dash',  speed: 95 },
    custom:  { face: 1,  mode: 'walk',  speed: 22 },
  };
  const MEOWS = ['เมี้ยว~', 'เมี๊ยว!', '♥', 'prrr…', 'เมี้ยววว', '😺'];
  let cats = [];

  const active = () => !document.hidden && !root.classList.contains('pillmode') && !root.classList.contains('paused')
    && !root.dataset.dock && layer.offsetParent !== null;
  const floorWidth = () => layer.clientWidth || 300;
  const rand = (a, b) => a + Math.random() * (b - a);

  function place(c, x, seconds) {
    c.x = x;
    c.el.style.transition = seconds ? `transform ${seconds}s linear` : 'none';
    c.el.style.transform = `translateX(${Math.round(x)}px)`;
  }
  function faceTowards(c, dir) {
    if (!c.def.face) return;
    c.flip.classList.toggle('flipped', dir !== c.def.face);
  }
  function say(c, text) {
    const b = document.createElement('span');
    b.className = 'pet-say'; b.textContent = text;
    c.el.appendChild(b); setTimeout(() => b.remove(), 1400);
  }
  function hop(c) {
    c.img.classList.remove('hop'); void c.img.offsetWidth; c.img.classList.add('hop');
    setTimeout(() => c.img.classList.remove('hop'), 500);
  }

  // one decision per cat every few seconds
  function think(c) {
    clearTimeout(c.timer);
    const later = (ms) => (c.timer = setTimeout(() => think(c), ms));
    if (!active()) return later(4000);
    const max = Math.max(0, floorWidth() - c.w), m = c.def.mode;

    if (m === 'walk' || m === 'dash') {
      const chance = m === 'dash' ? 0.35 : 0.7;
      if (Math.random() < chance) {
        let target = rand(0, max);
        if (Math.abs(target - c.x) < 30) target = c.x < max / 2 ? max : 0;
        const secs = Math.abs(target - c.x) / c.def.speed;
        faceTowards(c, target > c.x ? 1 : -1);
        c.img.classList.add(m === 'dash' ? 'running' : 'walking');
        place(c, target, secs);
        c.timer = setTimeout(() => { c.img.classList.remove('walking', 'running'); later(rand(2500, 7000)); }, secs * 1000);
        return;
      }
      return later(rand(3000, 8000));
    }
    if (m === 'sit') { // the black cat occasionally hops somewhere else
      if (Math.random() < 0.25) { const t = rand(0, max); hop(c); place(c, t, 0.45); }
      return later(rand(6000, 14000));
    }
    if (m === 'read') { c.img.classList.add('page'); setTimeout(() => c.img.classList.remove('page'), 600); return later(rand(5000, 11000)); }
    return later(20000); // sleeping cats stay put
  }

  function spawn(p, i, n) {
    const def = KINDS[p.kind] || KINDS.custom;
    const el = document.createElement('div');
    el.className = `pet pet-${p.kind} mode-${def.mode}`;
    const flip = document.createElement('span'); flip.className = 'pet-flip';
    const img = new Image(); img.className = 'pet-img'; img.alt = ''; img.draggable = false; img.src = p.src;
    flip.appendChild(img); el.appendChild(flip);
    if (def.mode === 'sleep') el.insertAdjacentHTML('beforeend', '<span class="zz">z</span><span class="zz z2">z</span>');
    layer.appendChild(el);
    const c = { id: p.id, def, el, img, flip, x: 0, w: 40, timer: 0 };
    img.onload = () => {
      // keep pixel art crisp: whole-number scale of the source, ~30–36 css px tall
      const s = img.naturalHeight > 60 ? 34 / img.naturalHeight : Math.max(0.5, Math.round((34 / img.naturalHeight) * 4) / 4);
      img.style.width = `${Math.round(img.naturalWidth * s)}px`; img.style.height = `${Math.round(img.naturalHeight * s)}px`;
      c.w = Math.round(img.naturalWidth * s);
      const max = Math.max(0, floorWidth() - c.w);
      place(c, n > 1 ? (max * i) / (n - 1) : max / 2, 0);
      if (def.face) faceTowards(c, Math.random() < 0.5 ? 1 : -1);
      c.timer = setTimeout(() => think(c), rand(800, 3000));
    };
    el.addEventListener('click', (e) => { e.stopPropagation(); hop(c); say(c, MEOWS[Math.floor(Math.random() * MEOWS.length)]); });
    cats.push(c);
  }

  function setPets(list) {
    cats.forEach((c) => { clearTimeout(c.timer); c.el.remove(); });
    cats = [];
    (list || []).forEach((p, i, a) => spawn(p, i, a.length));
    root.classList.toggle('has-pets', cats.length > 0);
  }
  // wake everyone up when the panel opens again
  new MutationObserver(() => { if (active()) cats.forEach((c) => { clearTimeout(c.timer); c.timer = setTimeout(() => think(c), rand(300, 1500)); }); })
    .observe(root, { attributes: true, attributeFilter: ['class', 'data-dock'] });

  window.__pets = { set: setPets };
})();
