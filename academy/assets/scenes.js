/* Cinematic Arts Academy · 3D scenes (three.js r160)
   1. the opening stack of film frames   2. the dotted globe, focused on Saudi Arabia   3. the organising diagram of the building
   Each scene draws only while it is on screen; phones get a lighter version; reduced-motion users get no idle movement. */
import * as THREE from './three.module.min.js';

import DATA from './globe-data.js';
const isPhone = matchMedia('(max-width: 760px)').matches;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 2);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// a critically damped follow with a top speed (as in game cameras): no jumps, and fast scrolling can't whip the motion
function follow(cur, target, st, smooth, maxSpeed, dt) {
  if (dt <= 0) return cur;
  const w = 2 / smooth, x = w * dt, k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const lim = maxSpeed * smooth, change = clamp(cur - target, -lim, lim), goal = cur - change;
  const temp = (st.v + w * change) * dt;
  st.v = (st.v - w * temp) * k;
  let out = goal + (change + temp) * k;
  if ((target - cur > 0) === (out > target)) { out = target; st.v = 0; }
  return out;
}
// a smooth curve through keyframes that never overshoots and has no stop at the middle keys (monotone cubic)
function track(keys, pick) {
  const n = keys.length, x = keys.map((k) => k.p), y = keys.map(pick), d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const w1 = 2 * (x[i + 1] - x[i]) + (x[i] - x[i - 1]), w2 = (x[i + 1] - x[i]) + 2 * (x[i] - x[i - 1]);
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (p) => {
    if (p <= x[0]) return y[0];
    if (p >= x[n - 1]) return y[n - 1];
    let i = 0; while (p > x[i + 1]) i++;
    const h = x[i + 1] - x[i], t = (p - x[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const ORANGE = new THREE.Color('#F08A3C'), CREAM = new THREE.Color('#EDE6DA'), TEAL = new THREE.Color('#3E9C97'), MUTE = new THREE.Color('#8C8580');

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

/* ------------------------------------------------------------------ a stage: one canvas, drawn only on screen */
const stages = [];
function makeStage(el, fov) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  el.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 200);
  const s = { el, renderer, scene, camera, w: 1, h: 1, visible: false, update: null, onResize: null };
  const resize = () => {
    const r = el.getBoundingClientRect();
    s.w = Math.max(1, r.width); s.h = Math.max(1, r.height);
    renderer.setSize(s.w, s.h, false);
    camera.aspect = s.w / s.h; camera.updateProjectionMatrix();
    s.onResize && s.onResize();
  };
  new ResizeObserver(resize).observe(el); resize();
  new IntersectionObserver(([e]) => { s.visible = e.isIntersecting; }, { rootMargin: '120px' }).observe(el);
  stages.push(s);
  return s;
}
function toScreen(s, v) {           // world point → px inside the stage, plus whether it is in front of the camera
  const p = v.clone().project(s.camera);
  return { x: (p.x + 1) / 2 * s.w, y: (1 - p.y) / 2 * s.h, front: p.z < 1 };
}

/* ------------------------------------------------------------------ round dots, sized by distance */
function dotMaterial({ globe = false, rise = false } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSize: { value: DPR }, uOpacity: { value: 1 }, uRise: { value: rise ? 0 : 1 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aAlpha; attribute float aSize; attribute float aPeak;
      uniform float uSize; uniform float uRise;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec3 p = position; float a = aAlpha;
        ${globe ? `
        p *= 1.0 + uRise * (0.004 + 0.06 * aPeak);
        vec3 wn = normalize((modelMatrix * vec4(position, 1.0)).xyz);
        vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
        a *= smoothstep(-0.02, 0.28, dot(wn, normalize(cameraPosition - wp)));` : ''}
        ${rise ? 'p.y *= uRise;' : ''}
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * aSize / -mv.z;
        vColor = aColor; vAlpha = a;
      }`,
    fragmentShader: `
      uniform float uOpacity; varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float s = 1.0 - smoothstep(0.3, 0.5, d);
        float a = s * vAlpha * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
  });
}
function dots(list, mat) {              // list of {p:[x,y,z], c:Color, a, s, k}
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), al = new Float32Array(n), sz = new Float32Array(n), pk = new Float32Array(n);
  list.forEach((d, i) => {
    pos.set(d.p, i * 3); col.set([d.c.r, d.c.g, d.c.b], i * 3); al[i] = d.a; sz[i] = d.s; pk[i] = d.k || 0;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('aPeak', new THREE.BufferAttribute(pk, 1));
  return new THREE.Points(g, mat);
}

/* ================================================================== 1. THE CRAFTS: a stack of film frames, one per craft */
const CRAFTS = ['CINEMATOGRAPHY', 'PERFORMANCE', 'WRITING', 'DIRECTING', 'PRODUCING', 'PRODUCTION DESIGN', 'EDITING', 'SOUND'];
const TEX_W = isPhone ? 768 : 1024, TEX_H = Math.round(TEX_W * 0.7);
const CARD_W = 4, CARD_H = 2.8;
const BTN = { w: 410 / 1024, h: 76 / 717, cy: 0.74 };        // the drawn button on the title card, as fractions of the card

function cardCanvas() { const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H; return c; }
function texOf(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function fitFont(g, text, weight, family, size, maxW) {
  for (; size > 10; size -= 2) { g.font = `${weight} ${size}px ${family}`; if (g.measureText(text).width <= maxW) break; }
  return size;
}
function drawCraft(c, kind, num, name, rtl) {
  const W = c.width, H = c.height, g = c.getContext('2d'), u = W / 1024;
  g.save(); g.clearRect(0, 0, W, H);
  const spec = [
    [0.66, 0.32, ['rgba(237,230,218,0.82)', 0], ['rgba(110,104,96,0.78)', 0.30], ['#121110', 0.74]],   // cream
    [0.62, 0.36, ['rgba(62,156,151,0.95)', 0], ['rgba(22,59,57,0.9)', 0.42], ['#0b0a09', 0.80]],      // teal
    [0.64, 0.34, ['rgba(240,138,60,0.95)', 0], ['rgba(120,48,18,0.9)', 0.36], ['#120c09', 0.76]],     // orange
  ][kind];
  const cx = (rtl ? 1 - spec[0] : spec[0]) * W, cy = spec[1] * H, R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  for (const [col, at] of spec.slice(2)) grd.addColorStop(at, col);
  grd.addColorStop(1, spec[4][0]);
  g.fillStyle = '#0b0a09'; g.fillRect(0, 0, W, H);                      // an opaque card: nothing behind shows through
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(14,12,11,0.6)';                                   // halftone
  for (let y = 0; y < H; y += 12.8 * u) for (let x = 0; x < W; x += 12.8 * u) { g.beginPath(); g.arc(x, y, 3.2 * u, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,0.2)';                                      // scan lines
  for (let y = 0; y < H; y += 7.68 * u) g.fillRect(0, y, W, 2.56 * u);
  const sh = g.createLinearGradient(0, H * 0.38, 0, H);                 // shade under the name
  sh.addColorStop(0, 'rgba(8,7,6,0)'); sh.addColorStop(1, 'rgba(8,7,6,0.9)');
  g.fillStyle = sh; g.fillRect(0, H * 0.38, W, H * 0.62);
  g.strokeStyle = 'rgba(237,230,218,0.5)'; g.lineWidth = 3 * u; g.strokeRect(1.5 * u, 1.5 * u, W - 3 * u, H - 3 * u);
  const pad = 58 * u, edge = rtl ? W - pad : pad;
  g.fillStyle = '#F08A3C'; g.fillRect(rtl ? edge - 8 * u : edge, pad, 8 * u, 64 * u);
  g.textBaseline = 'alphabetic'; g.direction = rtl ? 'rtl' : 'ltr'; g.textAlign = rtl ? 'right' : 'left'; g.fillStyle = '#EDE6DA';
  if (rtl) { g.font = `600 ${34 * u}px "IBM Plex Sans Arabic", Tahoma, sans-serif`; g.fillText('الحِرفة', edge - 30 * u, pad + 30 * u); }
  else { g.font = `500 ${26 * u}px "IBM Plex Mono", monospace`; g.letterSpacing = `${6 * u}px`; g.fillText('CRAFT', edge + 30 * u, pad + 26 * u); g.letterSpacing = '0px'; }
  g.font = `600 ${44 * u}px "IBM Plex Mono", monospace`; g.fillStyle = '#F08A3C';
  g.direction = 'ltr'; g.fillText(num + ' / 08', rtl ? edge - 30 * u : edge + 30 * u, pad + 70 * u); g.direction = rtl ? 'rtl' : 'ltr';
  g.fillStyle = '#EDE6DA';
  if (rtl) { fitFont(g, name, 700, '"IBM Plex Sans Arabic", Tahoma, sans-serif', 150 * u, W - 2 * pad); g.fillText(name, edge, H - pad - 18 * u); }
  else { fitFont(g, name, 700, '"Barlow Condensed", sans-serif', 168 * u, W - 2 * pad); g.fillText(name, edge, H - pad); }
  g.restore();
}
function drawTitle(c, label, rtl) {
  const W = c.width, H = c.height, g = c.getContext('2d'), u = W / 1024;
  g.save(); g.clearRect(0, 0, W, H);
  const grd = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.hypot(W / 2, H * 0.58));
  grd.addColorStop(0, '#221d19'); grd.addColorStop(0.78, '#0b0a09'); grd.addColorStop(1, '#0b0a09');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(237,230,218,0.55)'; g.lineWidth = 3 * u; g.strokeRect(1.5 * u, 1.5 * u, W - 3 * u, H - 3 * u);
  const ox = W / 2, oy = H * 0.40, s = 2.0 * u;                         // the eight-ring rosette
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 4;
    g.beginPath(); g.arc(ox + Math.cos(a) * 26 * s, oy + Math.sin(a) * 26 * s, 30 * s, 0, 7);
    g.strokeStyle = k === 7 ? '#3E9C97' : '#EDE6DA'; g.lineWidth = (k === 7 ? 2.8 : 2) * u; g.stroke();
  }
  g.beginPath(); g.arc(ox, oy, 7 * s, 0, 7); g.fillStyle = '#F08A3C'; g.fill();
  const bw = BTN.w * W, bh = BTN.h * H, by = BTN.cy * H;                 // the button outline (the real link sits on top)
  g.fillStyle = 'rgba(240,138,60,0.12)'; g.fillRect(W / 2 - bw / 2, by - bh / 2, bw, bh);
  g.strokeStyle = '#F08A3C'; g.lineWidth = 2.5 * u; g.strokeRect(W / 2 - bw / 2, by - bh / 2, bw, bh);
  g.fillStyle = '#EDE6DA'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = rtl ? 'rtl' : 'ltr';
  if (rtl) g.font = `600 ${32 * u}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
  else { g.font = `500 ${25 * u}px "IBM Plex Mono", monospace`; g.letterSpacing = `${7 * u}px`; }
  g.fillText(rtl ? label : label.toUpperCase(), W / 2 + (rtl ? 0 : 3 * u), by + (rtl ? 3 : 1) * u);
  g.restore();
}

function labelTexture(num) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#F08A3C'; g.fillRect(0, 8, 8, 80);
  g.fillStyle = '#EDE6DA'; g.font = '600 64px "Barlow Condensed", sans-serif'; g.textBaseline = 'middle';
  g.fillText(num, 26, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* The stack keeps its diagonal, receding into depth, and now moves like a pile of folders: swipe or drag
   sideways (or use the buttons, the arrow keys, a sideways trackpad scroll, or the list of crafts) and the
   front card slides out and goes to the back while the next one comes forward. It loops, and moves on by
   itself when nobody touches it. Scrolling the page still fans the pile out. */
function initStack(el, opts = {}) {
  const rtl = !!opts.rtl, dir = rtl ? -1 : 1, side = rtl ? -1 : 1;
  const names = opts.names || CRAFTS, N = names.length + 1;
  const s = makeStage(el, 26);
  const { scene, camera } = s;
  const pivot = new THREE.Group(); scene.add(pivot);
  const C = new THREE.Vector3(4.6, 0.1, -6);            // middle of the stack
  const enter = el.querySelector('.caa-enter');
  const label = enter ? enter.textContent.trim() : 'Tell me more!';
  const geo = new THREE.PlaneGeometry(CARD_W, CARD_H), tabGeo = new THREE.PlaneGeometry(0.72, 0.27);
  const kinds = [0, 1, 2, 0, 1, 2, 0, 1];
  const cards = [];
  const paint = () => cards.forEach((c, i) => {
    if (i === 0) drawTitle(c.canvas, label, rtl); else drawCraft(c.canvas, kinds[i - 1], String(i).padStart(2, '0'), names[i - 1], rtl);
    c.tex.needsUpdate = true;
  });
  for (let i = 0; i < N; i++) {
    const canvas = cardCanvas(), tex = texOf(canvas);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    let tab = null;
    if (i > 0) {                                          // the numbered tab on each folder
      tab = new THREE.Mesh(tabGeo, new THREE.MeshBasicMaterial({ map: labelTexture(String(i).padStart(2, '0')), transparent: true, depthWrite: false }));
      tab.position.set(rtl ? 2 - 0.36 : -2 + 0.36, 1.4 + 0.25, 0.001);
      mesh.add(tab);
    }
    mesh.userData = { i, lift: 0, tab };
    pivot.add(mesh);
    cards.push({ mesh, canvas, tex });
  }
  paint();
  if (document.fonts) Promise.all([
    document.fonts.load('700 100px "Barlow Condensed"'), document.fonts.load('600 64px "Barlow Condensed"'), document.fonts.load('500 30px "IBM Plex Mono"'), document.fonts.load('600 30px "IBM Plex Mono"'),
    rtl ? document.fonts.load('700 100px "IBM Plex Sans Arabic"', 'الحِرفة') : null, rtl ? document.fonts.load('600 30px "IBM Plex Sans Arabic"', 'اعرف') : null,
  ]).then(() => { paint(); cards.forEach((c) => { const t = c.mesh.userData.tab; if (t) { const old = t.material.map; t.material.map = labelTexture(String(c.mesh.userData.i).padStart(2, '0')); old.dispose(); } }); }, paint);

  // controls: two buttons, the list of crafts under the stack, keys, a name tag on hover, and a quiet line for screen readers
  const L = rtl ? { prev: 'الحرفة السابقة', next: 'الحرفة التالية', of: 'من' } : { prev: 'Previous craft', next: 'Next craft', of: 'of' };
  const chev = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${d > 0 ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ctrl = document.createElement('div');
  ctrl.className = 'caa-cf-ctrl';
  ctrl.innerHTML = `<button type="button" class="caa-cf-btn" data-step="-1" aria-label="${L.prev}">${chev(-dir)}</button>`
    + `<button type="button" class="caa-cf-btn" data-step="1" aria-label="${L.next}">${chev(dir)}</button>`;
  el.appendChild(ctrl);
  const tag = document.createElement('div'); tag.className = 'caa-craft-tag'; tag.setAttribute('aria-hidden', 'true'); el.appendChild(tag);
  const live = document.createElement('p'); live.className = 'caa-sr'; live.setAttribute('aria-live', 'polite'); el.appendChild(live);
  el.tabIndex = 0;
  const legend = [...((el.closest('.caa-stack') || el.parentElement).querySelectorAll('.caa-legend li'))];

  let pos = 0, target = 0, idle = 0, lastIdx = -1, said = false, fan = 0, hovered = null;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, inside: false };
  const mod = (a, n) => ((a % n) + n) % n;
  const slot = (i, p = pos) => mod(i - p + 1, N) - 1;    // 0 = front, up to N-1 at the back; below 0 = leaving the front
  const touch = () => { idle = -5; };                     // after a hand-made move, wait longer before moving on
  const go = (k) => { target = Math.round(target) + k; touch(); said = true; };
  const goTo = (i) => { const cur = Math.round(target); let d = mod(i - mod(cur, N), N); if (d > N / 2) d -= N; target = cur + d; touch(); said = true; };
  ctrl.addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) go(+b.dataset.step); });
  ctrl.addEventListener('pointerdown', (e) => e.stopPropagation());
  legend.forEach((li, k) => {
    li.tabIndex = 0; li.setAttribute('role', 'button');
    li.addEventListener('click', () => goTo(k + 1));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(k + 1); } });
  });
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(dir); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-dir); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
  });
  if (enter) enter.addEventListener('focus', () => goTo(0));

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(ev) {
    const r = el.getBoundingClientRect();
    ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(cards.map((c) => c.mesh), true).find((h) => h.object.material.opacity > 0.15);
    return hit ? (hit.object.userData.i !== undefined ? hit.object : hit.object.parent) : null;
  }
  // drag or swipe sideways (vertical swipes still scroll the page: touch-action is pan-y)
  let drag = null;
  const stepPx = () => Math.max(110, s.w * 0.28);
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    if (e.pointerType === 'mouse') { pointer.tx = (e.clientX - r.left) / r.width * 2 - 1; pointer.ty = (e.clientY - r.top) / r.height * 2 - 1; }
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.on) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { drag.on = true; try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('is-dragging'); }
        else if (Math.abs(dy) > 12) { drag = null; return; }
        else return;
      }
      target = drag.t0 - dir * dx / stepPx(); pos = target;
      const now = performance.now(); drag.vx = (e.clientX - drag.lx) / Math.max(1, now - drag.lt) * 1000; drag.lx = e.clientX; drag.lt = now;
      touch(); hovered = null;
      return;
    }
    if (e.pointerType === 'mouse') { hovered = pick(e); el.style.cursor = hovered ? 'pointer' : ''; }
  });
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') pointer.inside = true; });
  el.addEventListener('pointerleave', () => { pointer.inside = false; pointer.tx = 0; pointer.ty = 0; hovered = null; });
  el.addEventListener('pointerdown', (e) => {
    if (e.target === enter || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { x: e.clientX, y: e.clientY, t0: target, on: false, vx: 0, lx: e.clientX, lt: performance.now(), id: e.pointerId };
  });
  const release = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null; el.classList.remove('is-dragging');
    if (d.on) { target = Math.round(target - dir * clamp(d.vx / stepPx() * 0.18, -1.2, 1.2)); said = true; touch(); return; }
    if (!e || e.type !== 'pointerup') return;
    const f = pick(e);                                    // a tap on a card behind brings it forward; on the front card, the next one
    if (!f) return;
    if (Math.abs(slot(f.userData.i, target)) < 0.5) go(1); else goTo(f.userData.i);
  };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
  // sideways scrolling on a trackpad or with shift + wheel; vertical scrolling is left to the page
  let snap = 0;
  el.addEventListener('wheel', (e) => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!dx) return;
    e.preventDefault();
    target += dir * dx / (e.deltaMode === 1 ? 12 : 280); touch(); said = true;
    clearTimeout(snap); snap = setTimeout(() => { target = Math.round(target); }, 160);
  }, { passive: false });

  const ref = new THREE.Object3D(); scene.add(ref);       // where the front card rests, unturned: the buttons sit still under it
  const v = new THREE.Vector3();
  function rest(obj, k, p, out, bob) {
    let x = 2 + 0.66 * k * (1 + 1.5 * p), y = -1.4 + 0.36 * k * (1 + 1.1 * p) + bob, z = -1.5 * k * (1 + 0.45 * p);
    x -= out * 3.4; y -= out * 0.5; z += out * 1.4;       // leaving the front: out to the side, toward you
    obj.position.set(side * (x - C.x), y - C.y, z - C.z);
    obj.rotation.set(0, side * (-0.384 - p * 0.07 * k - out * 0.4), side * p * 0.018 * k);
  }
  function layout(dt, t) {
    if (!drag) {
      idle += dt;
      const front = mod(Math.round(target), N);
      if (!reduce && !pointer.inside && !el.matches(':focus-visible') && idle > (front === 0 ? 6.5 : 3.6)) { target = Math.round(target) + 1; idle = 0; }
      pos = reduce ? target : damp(pos, target, 5, dt);
    }
    const sec = el.closest('section') || el, r = sec.getBoundingClientRect();
    const ft = Math.max(clamp(-r.top / (r.height * 0.4)), pointer.inside ? 0.55 : 0);   // scrolling, or the cursor over the stack, fans the pile
    fan = reduce ? ft : damp(fan, ft, 6, dt);
    const p = ease(fan);
    pointer.x = damp(pointer.x, pointer.tx, 4, dt); pointer.y = damp(pointer.y, pointer.ty, 4, dt);
    pivot.position.set(side * C.x, C.y, C.z);
    pivot.rotation.y = side * pointer.x * 0.16;
    pivot.rotation.x = pointer.y * 0.08;
    ref.position.set(side * 2, -1.4, 0); ref.rotation.set(0, side * -0.384, 0); ref.updateMatrixWorld();
    cards.forEach(({ mesh: m }) => {
      const i = m.userData.i, k0 = slot(i), k = Math.max(k0, 0), out = Math.max(-k0, 0);
      rest(m, k, p, out, reduce ? 0 : Math.sin(t * 0.7 + i * 0.6) * 0.035);
      m.userData.lift = damp(m.userData.lift, m === hovered && k > 0.5 ? 1 : 0, 10, dt);
      m.position.z += m.userData.lift * 0.9; m.position.y += m.userData.lift * 0.25;
      const base = k < 1 ? lerp(1, 0.9, k) : Math.max(0.3, 0.98 - 0.085 * k);
      const arrive = clamp((N - 1 - k0) / 0.8);           // a card reaching the back fades in there
      const a = Math.min(1, base + m.userData.lift * 0.4) * (1 - out) * arrive;
      m.material.opacity = a; m.visible = a > 0.01;
      const b = 1 + m.userData.lift * 0.45; m.material.color.setRGB(b, b, b);
      m.renderOrder = Math.round(100 - k * 10 + out * 20);
      const tab = m.userData.tab;
      if (tab) { tab.material.opacity = Math.min(1, a + 0.15) * (k0 < 0 ? 1 - out : 1); tab.renderOrder = m.renderOrder + 1; }
    });
    const idx = mod(Math.round(pos), N);
    if (idx !== lastIdx) {
      lastIdx = idx;
      legend.forEach((li, k) => { const on = k + 1 === idx; li.classList.toggle('is-on', on); on ? li.setAttribute('aria-current', 'true') : li.removeAttribute('aria-current'); });
    }
    if (said && !drag && Math.abs(pos - target) < 0.3) { live.textContent = idx ? `${idx} ${L.of} 8: ${names[idx - 1]}` : label; said = false; }
  }
  function overlays() {
    const low = toScreen(s, ref.localToWorld(v.set(0, -CARD_H / 2, 0)));
    ctrl.style.top = Math.min(s.h - 50, low.y + 24) + 'px';
    ctrl.style.left = clamp(low.x, 60, s.w - 60) + 'px';
    if (hovered && hovered.userData.i > 0) {
      const q = toScreen(s, hovered.userData.tab.localToWorld(v.set(0.42, 0.05, 0)));
      tag.textContent = String(hovered.userData.i).padStart(2, '0') + '  ' + names[hovered.userData.i - 1];
      tag.style.transform = `translate(${q.x}px, ${q.y}px) translate(${rtl ? '-100%' : '0'}, -50%)`;
      tag.style.opacity = '1';
    } else tag.style.opacity = '0';
    if (!enter) return;
    const m = cards[0].mesh, k0 = slot(0);
    const hx = BTN.w * CARD_W / 2, cy = (0.5 - BTN.cy) * CARD_H, hy = BTN.h * CARD_H / 2;
    const pts = [[-hx, cy - hy], [hx, cy - hy], [-hx, cy + hy], [hx, cy + hy]].map(([x, y]) => toScreen(s, m.localToWorld(v.set(x, y, 0))));
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    Object.assign(enter.style, { left: Math.min(...xs) + 'px', top: Math.min(...ys) + 'px', width: (Math.max(...xs) - Math.min(...xs)) + 'px', height: (Math.max(...ys) - Math.min(...ys)) + 'px' });
    enter.classList.toggle('is-off', Math.abs(k0) > 0.3);
  }
  s.onResize = () => {
    // 1 unit = 100 px at the front card, as in the CSS version; smaller screens zoom out
    const k = clamp(Math.min(s.w / 760, s.h / 560), 0.4, 1);
    const W = s.w / 100 / k, H = s.h / 100 / k, D = 15, n = 0.1;
    const aL = s.w < 600 ? 0.35 : 0.06 * W, aT = Math.max(2.6, (H - 5.1) / 2 + 2.3);   // centre the stack (2.3 above the card's top, 2.8 below)
    const ex = 0.47, ey = -1.72;                          // the eye: a little left of and below the front card's centre
    let l = (-aL - ex) * n / D, r = (W - aL - ex) * n / D;
    const t = (aT - ey) * n / D, b = (aT - H - ey) * n / D;
    if (rtl) { const L0 = l; l = -r; r = -L0; }
    camera.position.set(rtl ? -ex : ex, ey, D); camera.rotation.set(0, 0, 0); camera.updateMatrixWorld();
    camera.projectionMatrix.makePerspective(l, r, t, b, n, 200);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  s.onResize();
  s.update = (dt, t) => { layout(dt, t); s.renderer.render(scene, camera); overlays(); };
  return s;
}

/* ================================================================== 2. GLOBES */
function bitsOf(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return (i) => (u[i >> 3] >> (i & 7)) & 1; }
const RAD = Math.PI / 180;
function sph(lat, lon, r = 1) { const a = lat * RAD, o = lon * RAD; return [r * Math.cos(a) * Math.sin(o), r * Math.sin(a), r * Math.cos(a) * Math.cos(o)]; }
function angDeg(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(a)) / RAD;
}
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const JEDDAH = { lat: 21.49, lon: 39.19 };
const KSA_C = { lat: 23.6, lon: 44.6 };
const GULF_C = { lat: 24.5, lon: 47.5 };
const DARK_ORANGE = new THREE.Color('#C0601F');
function gridDots(G, bitsB64, fn) {
  const b = bitsOf(bitsB64), out = [];
  for (let a = 0; a < G.rows; a++) for (let o = 0; o < G.cols; o++) {
    const idx = a * G.cols + o;
    if (b(idx)) { const d = fn(G.lat0 + (a + 0.5) * G.step, G.lon0 + (o + 0.5 + (a % 2) * 0.5) * G.step, idx); if (d) out.push(d); }
  }
  return out;
}

/* One globe of points. Its pose follows the page: scrolling moves it from the world view to the focus
   (Saudi Arabia, or the Gulf), and a drag turns it by hand; after a moment it settles back on the scroll pose.
   cfg.mode: 'saudi' (Saudi Arabia in orange, Jeddah raised and marked) or 'gulf' (the Gulf in dark orange,
   the comparable schools abroad marked). cfg.frames: [{p, lat, lon, zoom}] along the scroll. */
function initGlobe(el, cfg) {
  const s = makeStage(el, 35);
  const { scene, camera } = s;
  const globe = new THREE.Group(); scene.add(globe);
  const land = bitsOf(DATA.land), ksa = bitsOf(DATA.ksa), gcc = bitsOf(DATA.gcc), N = DATA.N, GA = Math.PI * (3 - Math.sqrt(5));
  const gulfMode = cfg.mode === 'gulf';
  const world = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) * 2 / N, r = Math.sqrt(1 - y * y), ph = i * GA;
    const lat = Math.asin(y) / RAD, lon = Math.atan2(Math.sin(ph) * r, Math.cos(ph) * r) / RAD;
    if (land(i)) {
      if (gulfMode) world.push(gcc(i) ? { p: sph(lat, lon), c: DARK_ORANGE, a: 1, s: 7 } : { p: sph(lat, lon), c: CREAM, a: 0.5, s: 6 });
      else world.push(ksa(i) ? { p: sph(lat, lon), c: ORANGE, a: 1, s: 7 } : { p: sph(lat, lon), c: CREAM, a: 0.5, s: 6 });
    } else if (!isPhone || i % 2 === 0) world.push({ p: sph(lat, lon), c: gulfMode ? MUTE : ORANGE, a: gulfMode ? 0.14 : 0.13, s: 4.5 });
  }
  const worldMat = dotMaterial({ globe: true });
  globe.add(dots(world, worldMat));
  // finer dots near the focus, faded in as the camera comes close
  const nearMat = dotMaterial({ globe: true }); nearMat.uniforms.uOpacity.value = 0;
  const focusMat = dotMaterial({ globe: true }); focusMat.uniforms.uOpacity.value = 0;
  if (gulfMode) {
    const G = DATA.gulf, isG = bitsOf(G.gcc);
    globe.add(dots(gridDots(G, G.bits, (la, lo, idx) => {
      if (isG(idx)) return null;
      const a = 0.45 * (1 - sstep(10, 17, angDeg(la, lo, GULF_C.lat, GULF_C.lon)));
      return a > 0.01 ? { p: sph(la, lo), c: CREAM, a, s: 3.0 } : null;
    }), nearMat));
    globe.add(dots(gridDots(G, G.gcc, (la, lo) => ({ p: sph(la, lo), c: DARK_ORANGE, a: 1, s: 3.8 })), focusMat));
  } else {
    globe.add(dots(gridDots(DATA.region, DATA.region.bits, (la, lo) => {
      const a = 0.45 * (1 - sstep(9, 15.5, angDeg(la, lo, KSA_C.lat, KSA_C.lon)));
      return a > 0.01 ? { p: sph(la, lo), c: CREAM, a, s: 2.0 } : null;
    }), nearMat));
    globe.add(dots(gridDots(DATA.saudi, DATA.saudi.bits, (la, lo) => {
      const d = angDeg(la, lo, JEDDAH.lat, JEDDAH.lon), k = Math.exp(-((d / 1.7) ** 2));
      return { p: sph(la, lo), c: ORANGE.clone().lerp(CREAM, k * 0.55), a: 0.95, s: 2.5 + k * 1.2, k };
    }), focusMat));
  }
  // HTML markers that follow points on the globe
  const marks = (cfg.markers || []).map((m) => {
    const node = document.createElement('div');
    node.className = 'caa-mk' + (m.kind ? ' caa-mk-' + m.kind : '') + (m.side === 'left' ? ' caa-mk-left' : '');
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = '<i></i><b></b>';
    node.querySelector('b').textContent = m.label;
    el.appendChild(node);
    return { ...m, node, b: node.querySelector('b'), left: m.side === 'left', w: 0, v: new THREE.Vector3(...sph(m.lat, m.lon, 1.004)) };
  });
  if (document.fonts) document.fonts.ready.then(() => marks.forEach((m) => { m.w = 0; }));   // measure labels again once the type has loaded
  const pin = el.querySelector('.caa-pin'), area = el.querySelector('.caa-area');

  // pose
  const frames = cfg.frames, lonAt = track(frames, (f) => f.lon), latAt = track(frames, (f) => f.lat), zoomAt = track(frames, (f) => f.zoom);
  const poseAt = (p) => ({ yaw: -lonAt(p) * RAD, pitch: latAt(p) * RAD, zoom: clamp(zoomAt(p)) });
  const st = { p: reduce ? 1 : 0, pv: { v: 0 }, dyaw: 0, dpitch: 0, vy: 0, last: -1e9, rise: 0, zoom: 0 };
  let drag = null;
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, dyaw: st.dyaw, dpitch: st.dpitch, t: performance.now(), lx: e.clientX }; el.classList.add('is-dragging'); });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 3.2 / Math.max(260, s.w) * (1 - st.zoom * 0.55);
    st.dyaw = drag.dyaw + (e.clientX - drag.x) * k;
    if (e.pointerType === 'mouse') st.dpitch = clamp(drag.dpitch + (e.clientY - drag.y) * k, -1, 1);
    const now = performance.now(); st.vy = (e.clientX - drag.lx) * k / Math.max(1, now - drag.t) * 1000; drag.lx = e.clientX; drag.t = now; st.last = now;
  });
  const end = () => { if (drag) { drag = null; el.classList.remove('is-dragging'); st.last = performance.now(); } };
  window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);

  const look = new THREE.Vector3(), tmp = new THREE.Vector3(), cdir = new THREE.Vector3();
  s.update = (dt) => {
    const r = el.getBoundingClientRect(), vh = innerHeight;
    // the turn runs the whole time the globe crosses the screen, from its top edge coming in at the bottom.
    // With figures under it, it ends when they are well in view (their top at 62% of the screen), so the
    // close-up is there when people stop to read them; otherwise when the globe's centre is 22% from the top.
    // The view follows the scroll closely, eased, at a capped speed.
    const from = vh - r.height * 0.05;
    let to = vh * 0.22 - r.height * 0.5;
    if (cfg.figs) to = Math.min(from - 320, vh * 0.62 - (cfg.figs.getBoundingClientRect().top - r.top));
    const target = reduce ? 1 : clamp((from - r.top) / (from - to));
    st.p = reduce ? 1 : follow(st.p, target, st.pv, 0.4, 0.7, dt);
    const P = poseAt(st.p);
    const idle = !drag && performance.now() - st.last > 2600;
    if (!drag) { st.dyaw += st.vy * dt; st.vy = damp(st.vy, 0, 2.5, dt); }
    if (idle) { st.dyaw = damp(st.dyaw, 0, 1.6, dt); st.dpitch = damp(st.dpitch, 0, 1.6, dt); }
    const off = Math.min(1, Math.abs(Math.sin(st.dyaw / 2)) * 3 + Math.abs(st.dpitch) * 2);   // turned away by hand: pull the camera back
    st.zoom = P.zoom * (1 - off);
    globe.rotation.set(P.pitch + st.dpitch, P.yaw + st.dyaw, 0, 'XYZ');
    const z = clamp(st.zoom), narrow = s.w / s.h < 0.9 ? 1.15 : 1;
    camera.position.set(0, lerp(0, -0.5, z), lerp(3.55 * narrow, 1.78 * narrow, z));
    look.set(0, lerp(0, 0.06, z), lerp(0, 1, z));
    camera.lookAt(look);
    worldMat.uniforms.uOpacity.value = 1 - (gulfMode ? 0.75 : 0.93) * z;
    nearMat.uniforms.uOpacity.value = z;
    focusMat.uniforms.uOpacity.value = z;
    st.rise = damp(st.rise, z > 0.6 ? 1 : 0, 2, dt);
    focusMat.uniforms.uRise.value = gulfMode ? 0 : st.rise;
    s.renderer.render(scene, camera);
    cdir.copy(camera.position);
    const place = (node, v3, minFacing, extra = 1) => {
      tmp.copy(v3).applyMatrix4(globe.matrixWorld);
      const q = toScreen(s, tmp), facing = tmp.clone().normalize().dot(cdir.clone().sub(tmp).normalize());
      node.style.transform = `translate(${q.x}px, ${q.y}px)`;
      node.style.opacity = facing > minFacing && q.x > -20 && q.x < s.w + 20 && q.y > -20 && q.y < s.h + 20 ? String(extra) : '0';
    };
    if (pin) place(pin, new THREE.Vector3(...sph(JEDDAH.lat, JEDDAH.lon, 1 + st.rise * 0.064 * z + 0.004)), 0.15);
    marks.forEach((m) => {
      place(m.node, m.v, 0.2);
      // a label that would run past the edge of the globe's box goes to the other side of its dot
      if (!m.w) m.w = m.b.offsetWidth;
      const x = parseFloat(m.node.style.transform.slice(10)) || 0;
      const left = m.left ? x - 12 - m.w >= 0 || x + 14 + m.w > s.w : x + 14 + m.w > s.w && x - 12 - m.w >= 0;
      m.node.classList.toggle('caa-mk-left', left);
    });
    if (area) place(area, new THREE.Vector3(...sph(22.6, 50.5, 1.01)), 0.3, clamp((z - 0.35) / 0.4));
  };
  return s;
}

/* ================================================================== 3. BUILDING DIAGRAM */
function initBuilding(el) {
  const s = makeStage(el, 30);
  const { scene, camera } = s;
  const step = isPhone ? 1.35 : 1;
  // floor of points
  const floor = [];
  for (let x = -6.6; x <= 6.6; x += 0.2 * step) for (let z = -4.6; z <= 4.6; z += 0.2 * step) {
    const e = Math.hypot(x / 6.6, z / 4.6); if (e > 1) continue;
    const near = (cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
    const c = MUTE.clone().lerp(ORANGE, near(-2.5, 1.3, 1.6) * 0.8).lerp(TEAL, near(0.4, -0.4, 1.4) * 0.8).lerp(CREAM, near(3.4, -1.6, 1.5) * 0.6);
    floor.push({ p: [x, 0, z], c, a: 0.75 * (1 - e * e), s: 30 });
  }
  scene.add(dots(floor, dotMaterial()));
  // volumes: dots on faces and edges; "rise" grows them out of the floor
  const vols = [];
  function volume(spec) {
    const list = [], { cx, cz, w, h, d, sp, color } = spec;
    const x0 = cx - w / 2, z0 = cz - d / 2, put = (x, y, z, a, sz) => list.push({ p: [x, y, z], c: color, a, s: sz });
    const n = (L, q) => Math.max(1, Math.round(L / q));
    if (spec.roof) for (let i = 0; i <= n(w, sp); i++) for (let k = 0; k <= n(d, sp); k++) put(x0 + i * w / n(w, sp), h, z0 + k * d / n(d, sp), spec.roofA, 16);
    if (spec.walls) {
      const face = (ax, az, L, fixed) => { const m = n(L, sp * step); for (let i = 0; i <= m; i++) { if (spec.slot && i % spec.slot === 0 && i > 0 && i < m) continue; for (let j = 0; j <= n(h, sp * step); j++) { const u = i * L / m, y = j * h / n(h, sp * step); fixed ? put(ax, y, az + u, spec.wallA, 15) : put(ax + u, y, az, spec.wallA, 15); } } };
      face(x0, z0, w, false); face(x0, z0 + d, w, false); face(x0, z0, d, true); face(x0 + w, z0, d, true);
    }
    if (spec.columns) for (let i = 0; i <= n(w, spec.columns); i++) for (let k = 0; k <= n(d, spec.columns); k++) for (let y = 0; y <= h; y += 0.07) put(x0 + i * w / n(w, spec.columns), y, z0 + k * d / n(d, spec.columns), 0.9, 15);
    // edges
    const E = 0.05 * step, edge = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), m = Math.max(1, Math.round(L / E)); for (let i = 0; i <= m; i++) put(lerp(a[0], b[0], i / m), lerp(a[1], b[1], i / m), lerp(a[2], b[2], i / m), 1, 17); };
    const P = (i, j, k) => [x0 + i * w, j * h, z0 + k * d];
    [[P(0, 1, 0), P(1, 1, 0)], [P(0, 1, 1), P(1, 1, 1)], [P(0, 1, 0), P(0, 1, 1)], [P(1, 1, 0), P(1, 1, 1)]].forEach(([a, b]) => edge(a, b));
    if (spec.walls) [[P(0, 0, 0), P(0, 1, 0)], [P(1, 0, 0), P(1, 1, 0)], [P(0, 0, 1), P(0, 1, 1)], [P(1, 0, 1), P(1, 1, 1)]].forEach(([a, b]) => edge(a, b));
    const mat = dotMaterial({ rise: true });
    const pts = dots(list, mat); scene.add(pts);
    // stem from the roof up to the label
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx, h, cz), new THREE.Vector3(cx, h + spec.stem, cz)]);
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })); scene.add(line);
    vols.push({ ...spec, mat, line, rise: 0 });
  }
  volume({ key: 'public', cx: -2.5, cz: 1.3, w: 3.2, h: 0.85, d: 2.1, sp: 0.13, color: ORANGE, roof: true, roofA: 0.75, columns: 0.8, stem: 1.15, delay: 0 });
  volume({ key: 'peers', cx: 0.4, cz: -0.4, w: 2.3, h: 1.55, d: 1.9, sp: 0.13, color: new THREE.Color('#6CCBC4'), roof: true, roofA: 0.85, walls: true, wallA: 0.75, slot: 3, stem: 1.0, delay: 0.15 });
  volume({ key: 'protected', cx: 2.85, cz: -1.9, w: 1.5, h: 2.35, d: 1.5, sp: 0.075, color: CREAM, roof: true, roofA: 0.8, walls: true, wallA: 0.6, stem: 0.85, delay: 0.3 });
  volume({ key: 'protected2', cx: 4.35, cz: -1.15, w: 1.1, h: 1.9, d: 1.3, sp: 0.075, color: CREAM, roof: true, roofA: 0.8, walls: true, wallA: 0.6, stem: 0, delay: 0.38 });
  const tags = {};
  el.querySelectorAll('[data-vol]').forEach((t) => { tags[t.dataset.vol] = t; });
  const pointer = { x: 0, tx: 0 };
  el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const r = el.getBoundingClientRect(); pointer.tx = (e.clientX - r.left) / r.width * 2 - 1; });
  el.addEventListener('pointerleave', () => { pointer.tx = 0; });
  let drag = null;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; drag = { x: e.clientX, v: pointer.tx }; });
  el.addEventListener('pointermove', (e) => { if (!drag) return; pointer.tx = clamp(drag.v + (e.clientX - drag.x) / s.w * 2, -1, 1); });
  window.addEventListener('pointerup', () => { drag = null; });
  const T = new THREE.Vector3(0.9, 0.7, -0.4);
  let t0 = null;
  s.update = (dt, t) => {
    const sec = el.closest('section') || el, r = sec.getBoundingClientRect(), vh = innerHeight;
    const prog = clamp((vh - r.top) / (vh * 0.9));
    pointer.x = damp(pointer.x, pointer.tx, 3, dt);
    const a = s.w / s.h, back = a < 1.3 ? 1.3 / a : 1;
    const yaw = (a < 1.05 ? -0.62 : -0.14) + pointer.x * 0.22 + (reduce ? 0 : Math.sin(t * 0.15) * 0.05);   // narrow screens look along the diagonal
    const R = 13.8 * Math.min(back, a < 1.05 ? 1.32 : 1.22), elev = 0.56;
    camera.position.set(T.x + Math.sin(yaw) * R * Math.cos(elev), T.y + R * Math.sin(elev), T.z + Math.cos(yaw) * R * Math.cos(elev));
    camera.lookAt(T);
    vols.forEach((v) => {
      const goal = ease(clamp((prog - v.delay) / 0.55));
      v.rise = reduce ? goal : damp(v.rise, goal, 5, dt);
      v.mat.uniforms.uRise.value = v.rise;
      const top = new THREE.Vector3(v.cx, v.h * v.rise, v.cz);
      v.line.geometry.setFromPoints([top, new THREE.Vector3(v.cx, v.h * v.rise + v.stem * v.rise, v.cz)]);
      v.line.material.opacity = clamp((v.rise - 0.6) / 0.4) * 0.8;
      const tag = tags[v.key];
      if (tag) {
        const q = toScreen(s, new THREE.Vector3(v.cx, v.h * v.rise + v.stem * v.rise, v.cz));
        tag.style.transform = `translate(${q.x}px, ${q.y}px) translate(-50%, -100%)`;
        tag.style.opacity = String(clamp((v.rise - 0.7) / 0.3));
      }
    });
    s.renderer.render(scene, camera);
  };
  return s;
}

/* ================================================================== start */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const s of stages) if (s.visible && s.update && !s.dead) {
    try { s.update(dt, now / 1000); } catch (e) { s.dead = true; fail(s.el, e); }
  }
  requestAnimationFrame(frame);
}
function fail(el, e) {
  const box = el.closest('.caa-globebox, .caa-stack') || el;
  box.classList.add('caa-off');
  document.documentElement.dataset.caa3d = 'partial: ' + (e && e.message ? e.message : String(e)).slice(0, 120);
  if (window.console) console.warn('3D scene off:', e);
}
function mount(el, fn) {
  if (!el) return;
  try { fn(el); } catch (e) { fail(el, e); }
}
function start() {
  if (!webglOK()) { document.documentElement.classList.add('caa-no3d'); document.documentElement.dataset.caa3d = 'off: no WebGL'; return; }
  document.documentElement.classList.add('caa-3d');
  document.documentElement.dataset.caa3d = 'on';
  const rtl = document.documentElement.dir === 'rtl';
  const q = (k) => document.querySelector(`[data-caa="${k}"]`);
  mount(q('stack'), (el) => initStack(el, { rtl, names: el.dataset.names ? el.dataset.names.split('|') : null }));
  mount(q('globe'), (el) => initGlobe(el, { mode: 'saudi', figs: (el.closest('section') || document).querySelector('.caa-figs'), frames: [{ p: 0, lat: 20, lon: 18, zoom: 0 }, { p: 0.4, lat: 22, lon: 37, zoom: 0 }, { p: 0.92, lat: KSA_C.lat, lon: KSA_C.lon, zoom: 1 }] }));
  mount(q('examples'), (el) => initGlobe(el, { mode: 'gulf', markers: JSON.parse(el.dataset.markers || '[]'), frames: [{ p: 0, lat: 36, lon: -60, zoom: 0 }, { p: 0.45, lat: 38, lon: 4, zoom: 0 }, { p: 0.9, lat: 27, lon: 45, zoom: 0.78 }] }));
  mount(q('building'), (el) => initBuilding(el));
  requestAnimationFrame(frame);
}
start();
