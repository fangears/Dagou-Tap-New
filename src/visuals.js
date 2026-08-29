'use strict';
/* ============================================================
 * 视觉层：全屏特效引擎 / 角色渲染 / 分区闪光 / 村民受击 / 连击 / 署名
 * 全部绘制到单一主画布（移植自网页版 fx 引擎与 DOM/CSS 动画）
 * ==========================================================*/
const config = require('./config.js');
const state = require('./state.js');
const utils = require('./utils.js');
const assets = require('./assets.js');
const audioEngine = require('./audio-engine.js');

const { C, ACCENTS } = config;
const FX_IN = 0.55;
const FX_OUT = 0.4;

let g = null;                 // 主画布 2d context
let mainCanvas = null;        // 主画布（全幅清除用）
let fxW = 0, fxH = 0;
let fxList = [];
const zoneFlashes = [];       // { zi, born }
const villagerParticles = []; // { born, dx, dy, size, rot, delay, color }
let knockback = null;         // { start, direction, offset, rebound }
let flashAnim = null;         // { start }（村民受击红闪）

/* ---------- 时钟 ---------- */
function nowSec() {
  const audio = audioEngine.getAudio();
  return audio && state.started && audio.ctx
    ? audio.ctx.currentTime
    : Date.now() / 1000;
}

const prog = (t, delay, dur = FX_IN) => utils.clamp01((t - delay) / dur);
const cx0 = () => fxW / 2;
const cy0 = () => fxH / 2;

/* cubic-bezier(x1,y1,x2,y2) 缓动求解（CSS 动画参数移植用） */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const currentX = sampleX(t) - x;
      if (Math.abs(currentX) < 1e-5) break;
      const dx = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(dx) < 1e-6) break;
      t -= currentX / dx;
    }
    return sampleY(t);
  };
}

const KNOCK_EASE = cubicBezier(0.18, 0.78, 0.28, 1);
const PARTICLE_EASE = cubicBezier(0.18, 0.68, 0.26, 1);

function pickColor(rng) {
  const r = rng();
  if (r < 0.62) return C.amber;
  if (r < 0.9) return C.gray;
  return ACCENTS[(rng() * ACCENTS.length) | 0];
}

/* ============================================================
 * 全屏特效引擎（BUILD/DRAW 与网页版一致）
 * ==========================================================*/
const BUILD = {
  rings(inst, rng) {
    const minD = Math.min(fxW, fxH);
    for (let i = 0; i < 7; i++) inst.shapes.push({
      delay: i * 0.05,
      rEnd: minD * (0.13 + rng() * 0.29),
      w: 5 + rng() * 9,
      color: pickColor(rng),
    });
    inst.dotR = minD * 0.07;
  },
  poly(inst, rng) {
    const sides = 3 + (rng() * 5 | 0);
    const minD = Math.min(fxW, fxH);
    [[0.46, C.amber, 0], [0.3, C.gray, 0.09], [0.17, C.amber, 0.18]].forEach(([s, color, d], i) =>
      inst.shapes.push({
        sides, delay: d, color,
        rEnd: minD * s,
        w: minD * (0.034 - i * 0.007),
      }));
  },
  spiral(inst, rng) {
    const minD = Math.min(fxW, fxH);
    for (let i = 0; i < 36; i++) inst.shapes.push({
      ang: i * 0.55,
      rad: 6 + i * minD * 0.0125,
      size: minD * (0.009 + i * 0.0008),
      delay: i * 0.018,
      color: pickColor(rng),
    });
  },
  rays(inst, rng) {
    const minD = Math.min(fxW, fxH);
    const n = 13 + (rng() * 4 | 0);
    inst.r0 = minD * 0.06;
    for (let i = 0; i < n; i++) inst.shapes.push({
      ang: (i / n) * 2 * Math.PI + rng() * 0.15,
      w: 0.09 + rng() * 0.13,
      len: minD * (0.36 + rng() * 0.1),
      delay: rng() * 0.12,
      color: rng() < 0.12 ? ACCENTS[(rng() * 3) | 0] : (i % 2 ? C.gray : C.amber),
    });
  },
  confetti(inst, rng) {
    const maxD = Math.hypot(fxW, fxH);
    const minD = Math.min(fxW, fxH);
    const kinds = ['square', 'circle', 'triangle', 'diamond'];
    for (let i = 0; i < 30; i++) inst.shapes.push({
      ang: rng() * 2 * Math.PI,
      dist: maxD * (0.12 + rng() * 0.46),
      size: minD * (0.026 + rng() * 0.05),
      spin: inst.dir * (1 + rng() * 2) * 2.2,
      delay: rng() * 0.18,
      kind: kinds[(rng() * 4) | 0],
      color: pickColor(rng),
    });
  },
  zigzag(inst, rng) {
    const minD = Math.min(fxW, fxH);
    const horiz = rng() < 0.5;
    const n = 5 + (rng() * 3 | 0);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (horiz) pts.push({
        x: -fxW * 0.08 + f * fxW * 1.16,
        y: fxH * (i % 2 ? 0.72 + rng() * 0.14 : 0.14 + rng() * 0.14),
      });
      else pts.push({
        x: fxW * (i % 2 ? 0.7 + rng() * 0.16 : 0.14 + rng() * 0.16),
        y: -fxH * 0.08 + f * fxH * 1.16,
      });
    }
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      lens.push(l); total += l;
    }
    inst.shapes.push({ pts, lens, total, w: minD * (0.026 + rng() * 0.024), color: C.amber });
  },
  pop(inst, rng) {
    const minD = Math.min(fxW, fxH);
    const kinds = ['circle', 'square', 'ring', 'triangle', 'hexagon'];
    for (let i = 0; i < 16; i++) inst.shapes.push({
      x: fxW * (0.06 + rng() * 0.88),
      y: fxH * (0.06 + rng() * 0.88),
      size: minD * (0.036 + rng() * 0.06),
      delay: rng() * 0.28,
      rot: rng() * Math.PI,
      kind: kinds[(rng() * kinds.length) | 0],
      color: pickColor(rng),
    });
  },
  cross(inst, rng) {
    const minD = Math.min(fxW, fxH);
    const size = minD * (0.6 + rng() * 0.25);
    inst.shapes.push({
      size,
      w: size * (0.14 + rng() * 0.08),
      color: rng() < 0.2 ? ACCENTS[(rng() * 3) | 0] : C.amber,
    });
  },
  orbit(inst, rng) {
    const minD = Math.min(fxW, fxH);
    const kinds = ['circle', 'square', 'triangle', 'ring'];
    const n = 10;
    for (let i = 0; i < n; i++) inst.shapes.push({
      ang0: (i / n) * 2 * Math.PI,
      rad: minD * (0.18 + rng() * 0.24),
      speed: inst.dir * (0.45 + rng() * 0.5),
      size: minD * (0.026 + rng() * 0.032),
      delay: rng() * 0.15,
      kind: kinds[i % 4],
      color: pickColor(rng),
    });
    inst.coreR = minD * 0.055;
  },
  wave(inst, rng) {
    const minD = Math.min(fxW, fxH);
    for (let i = 0; i < 4; i++) inst.shapes.push({
      y0: fxH * (0.14 + i * 0.24) + (rng() - 0.5) * fxH * 0.08,
      amp: minD * (0.03 + rng() * 0.05),
      wl: fxW * (0.45 + rng() * 0.4),
      speed: inst.dir * (1 + rng() * 1.2),
      th: minD * (0.07 + rng() * 0.06),
      side: i % 2 ? 1 : -1,
      delay: i * 0.08,
      color: rng() < 0.12 ? ACCENTS[(rng() * 3) | 0] : (i % 2 ? C.gray : C.amber),
    });
  },
  stars(inst, rng) {
    const minD = Math.min(fxW, fxH);
    for (let i = 0; i < 12; i++) inst.shapes.push({
      x: fxW * (0.07 + rng() * 0.86),
      y: fxH * (0.07 + rng() * 0.86),
      r: minD * (0.034 + rng() * 0.055),
      delay: rng() * 0.25,
      rot: rng() * Math.PI,
      color: pickColor(rng),
    });
  },
  grid(inst, rng) {
    const minD = Math.min(fxW, fxH);
    const n = 11;
    const radius = minD * (0.4 + rng() * 0.04);
    const lines = [];
    for (let i = 0; i < n; i++) lines.push({
      y: (i - (n - 1) / 2) * (radius * 2 / n),
      w: 4.5 + ((i * 7) % 3) * 4,
      delay: i * 0.045,
      color: i % 2 ? C.gray : C.amber,
    });
    inst.shapes.push({ radius, lines });
  },
};

const DRAW = {
  rings(g, inst, t, fade) {
    const minD = Math.min(fxW, fxH);
    inst.shapes.forEach((s, i) => {
      const k = utils.easeOutCubic(prog(t, s.delay));
      if (k <= 0) return;
      const r = k * s.rEnd * (1 + 0.04 * Math.sin(t * 1.4 + i)) + state.beatP * minD * 0.012;
      g.globalAlpha = (1 - k * 0.5) * fade;
      g.strokeStyle = s.color;
      g.lineWidth = s.w * (1 + state.beatP * 0.5);
      g.beginPath(); g.arc(inst.cx, inst.cy, r, 0, 7); g.stroke();
    });
    const dk = utils.easeOutBack(prog(t, 0));
    if (dk > 0) {
      g.globalAlpha = fade;
      g.fillStyle = C.amber;
      g.beginPath(); g.arc(inst.cx, inst.cy, inst.dotR * dk * (1 + state.beatP * 0.2), 0, 7); g.fill();
    }
  },
  poly(g, inst, t, fade) {
    const minD = Math.min(fxW, fxH);
    inst.shapes.forEach((s, i) => {
      const k = utils.easeOutCubic(prog(t, s.delay));
      if (k <= 0) return;
      const r = k * s.rEnd * (1 + state.beatP * 0.035 + 0.03 * Math.sin(t * 1.1 + i * 1.9));
      const rot = inst.rot0 + inst.dir * (1 - k) * 1.3 + t * 0.18 * inst.dir;
      g.globalAlpha = (1 - k * 0.3) * fade;
      g.strokeStyle = s.color;
      g.lineWidth = s.w * (1 + state.beatP * 0.4) + state.beatP * minD * 0.0015;
      utils.tracePoly(g, inst.cx, inst.cy, r, s.sides, rot);
      g.stroke();
    });
  },
  spiral(g, inst, t, fade) {
    const rot = inst.rot0 + t * 0.45 * inst.dir + state.beatP * 0.05 * inst.dir;
    inst.shapes.forEach((s, i) => {
      const k = utils.easeOutBack(prog(t, s.delay));
      if (k <= 0) return;
      const a = s.ang + rot;
      const r = s.rad * k * (1 + state.beatP * 0.04) + Math.sin(t * 1.5 + i * 0.5) * 4;
      const x = inst.cx + Math.cos(a) * r;
      const y = inst.cy + Math.sin(a) * r;
      const sz = s.size * k * (1 + state.beatP * 0.25);
      g.globalAlpha = fade;
      utils.drawPiece(g, i % 6 === 5 ? 'square' : 'circle', s.color, x, y, sz, a);
    });
  },
  rays(g, inst, t, fade) {
    for (const s of inst.shapes) {
      const k = utils.easeOutCubic(prog(t, s.delay, 0.5));
      if (k <= 0) continue;
      const rot = inst.rot0 + inst.dir * (1 - k) * 0.8 + t * 0.14 * inst.dir;
      const len = s.len * k * (1 + state.beatP * 0.09);
      const a = s.ang + rot;
      g.globalAlpha = 0.88 * fade;
      g.fillStyle = s.color;
      g.beginPath();
      g.moveTo(inst.cx, inst.cy);
      g.arc(inst.cx, inst.cy, inst.r0 + len, a - s.w, a + s.w);
      g.closePath(); g.fill();
    }
  },
  confetti(g, inst, t, fade) {
    inst.shapes.forEach((s, i) => {
      const k = utils.easeOutBack(prog(t, s.delay));
      if (k <= 0) return;
      const x = inst.cx + Math.cos(s.ang) * s.dist * k * (1 + state.beatP * 0.025);
      const y = inst.cy + Math.sin(s.ang) * s.dist * k * (1 + state.beatP * 0.025)
        + Math.sin(t * 2.2 + i * 1.3) * 6;
      const sz = s.size * k * (1 + state.beatP * 0.18);
      const rot = s.spin * k + t * 0.6 * inst.dir;
      g.globalAlpha = fade;
      utils.drawPiece(g, s.kind, s.color, x, y, sz, rot);
    });
  },
  zigzag(g, inst, t, fade) {
    const s = inst.shapes[0];
    const k = utils.easeOutCubic(prog(t, 0, 0.6));
    if (k <= 0) return;
    g.save();
    g.translate(0, Math.sin(t * 1.6) * 7);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.save();
    g.translate(0, s.w * 2.1);
    g.globalAlpha = 0.4 * fade;
    g.strokeStyle = C.gray;
    g.lineWidth = s.w * (1 + state.beatP * 0.2);
    utils.strokePartial(g, s.pts, s.lens, k * s.total);
    g.stroke();
    g.restore();
    g.globalAlpha = fade;
    g.strokeStyle = s.color;
    g.lineWidth = s.w * (1 + state.beatP * 0.3);
    const tip = utils.strokePartial(g, s.pts, s.lens, k * s.total);
    g.stroke();
    g.fillStyle = C.gray;
    g.beginPath(); g.arc(tip.x, tip.y, s.w * (1.1 + state.beatP * 0.45), 0, 7); g.fill();
    g.restore();
  },
  pop(g, inst, t, fade) {
    inst.shapes.forEach((s, i) => {
      const k = utils.easeOutBack(prog(t, s.delay));
      if (k <= 0) return;
      const y = s.y + Math.sin(t * 2 + i * 1.7) * 7;
      const sz = s.size * k * (1 + state.beatP * 0.2);
      g.globalAlpha = 0.96 * fade;
      utils.drawPiece(g, s.kind, s.color, s.x, y, sz, s.rot + t * 0.4 * inst.dir + state.beatP * 0.08 * inst.dir);
    });
  },
  cross(g, inst, t, fade) {
    const s = inst.shapes[0];
    const k1 = utils.easeOutBack(prog(t, 0));
    const k2 = utils.easeOutBack(prog(t, 0.13));
    if (k1 <= 0) return;
    g.save();
    g.translate(inst.cx, inst.cy);
    g.rotate(inst.rot0 + inst.dir * (1 - k1) * 1.6 + Math.sin(t * 1.3) * 0.07 + state.beatP * 0.02 * inst.dir);
    const pulse = 1 + state.beatP * 0.12;
    g.scale(pulse, pulse);
    const L = s.size / 2, w = s.w / 2;
    g.globalAlpha = fade;
    g.fillStyle = s.color;
    g.fillRect(-L * k1, -w, L * 2 * k1, w * 2);
    if (k2 > 0) g.fillRect(-w, -L * k2, w * 2, L * 2 * k2);
    g.globalAlpha = 0.6 * fade;
    g.strokeStyle = C.gray;
    g.lineWidth = Math.max(2, s.w * 0.28);
    g.beginPath(); g.arc(0, 0, s.size * 0.68 * k1 * (1 + state.beatP * 0.08), 0, 7); g.stroke();
    g.restore();
  },
  orbit(g, inst, t, fade) {
    inst.shapes.forEach(s => {
      const k = utils.easeOutCubic(prog(t, s.delay));
      if (k <= 0) return;
      const a = s.ang0 + t * s.speed + inst.dir * (1 - k) * 1.8;
      const R = s.rad * k * (1 + state.beatP * 0.09);
      const x = inst.cx + Math.cos(a) * R;
      const y = inst.cy + Math.sin(a) * R;
      g.globalAlpha = fade;
      utils.drawPiece(g, s.kind, s.color, x, y, s.size * (0.6 + 0.4 * k) * (1 + state.beatP * 0.15), t * 1.2 * inst.dir);
    });
    const ck = utils.easeOutBack(prog(t, 0));
    if (ck > 0) {
      g.globalAlpha = fade;
      utils.drawPiece(g, 'circle', C.amber, inst.cx, inst.cy,
        inst.coreR * ck * (1 + state.beatP * 0.2), 0);
    }
  },
  wave(g, inst, t, fade) {
    const step = Math.max(14, fxW / 28);
    for (const s of inst.shapes) {
      const k = utils.easeOutCubic(prog(t, s.delay, 0.6));
      if (k <= 0) continue;
      const off = (1 - k) * (fxW + 120) * s.side;
      const amp = s.amp * (0.6 + 0.4 * k) * (1 + state.beatP * 0.3);
      g.globalAlpha = 0.9 * fade;
      g.fillStyle = s.color;
      g.beginPath();
      for (let x = -60; x <= fxW + 60; x += step) {
        const y = s.y0 + Math.sin((x / s.wl) * Math.PI * 2 + t * s.speed) * amp;
        x === -60 ? g.moveTo(x + off, y) : g.lineTo(x + off, y);
      }
      for (let x = fxW + 60; x >= -60; x -= step) {
        const y = s.y0 + s.th * (1 + state.beatP * 0.12)
          + Math.sin((x / s.wl) * Math.PI * 2 + t * s.speed + 0.9) * amp;
        g.lineTo(x + off, y);
      }
      g.closePath(); g.fill();
    }
  },
  stars(g, inst, t, fade) {
    inst.shapes.forEach((s, i) => {
      const k = utils.easeOutElastic(prog(t, s.delay));
      if (k <= 0) return;
      const tw = 1 + 0.15 * Math.sin(t * 3.2 + i * 2.1) + state.beatP * 0.18;
      g.globalAlpha = 0.97 * fade;
      utils.drawPiece(g, 'star', s.color, s.x, s.y, s.r * k * tw, s.rot + t * 0.7 * inst.dir);
    });
  },
  grid(g, inst, t, fade) {
    const s = inst.shapes[0];
    const R = s.radius * (1 + state.beatP * 0.06 + 0.03 * Math.sin(t * 1.3));
    g.save();
    g.translate(inst.cx, inst.cy);
    g.rotate(inst.rot0 + t * 0.22 * inst.dir + state.beatP * 0.025 * inst.dir);
    g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
    for (const ln of s.lines) {
      const k = utils.easeOutCubic(prog(t, ln.delay));
      if (k <= 0) continue;
      g.globalAlpha = 0.92 * fade;
      g.strokeStyle = ln.color;
      g.lineWidth = ln.w * (1 + state.beatP * 0.35);
      g.beginPath();
      g.moveTo(-R * k, ln.y);
      g.lineTo(R * k, ln.y);
      g.stroke();
    }
    g.restore();
    const ok = utils.easeOutBack(prog(t, 0));
    if (ok > 0) {
      g.globalAlpha = fade;
      g.strokeStyle = C.amber;
      g.lineWidth = 6 * (1 + state.beatP * 0.35);
      g.beginPath(); g.arc(inst.cx, inst.cy, R * ok, 0, 7); g.stroke();
    }
  },
};

function buildEffect(type) {
  const rng = utils.mulberry32((Math.random() * 1e9) | 0);
  const inst = {
    type,
    cx: cx0(), cy: cy0(),
    t0: 0, state: 'in', outT0: 0,
    rot0: rng() * Math.PI * 2,
    dir: rng() < 0.5 ? -1 : 1,
    shapes: [],
  };
  BUILD[type](inst, rng);
  return inst;
}

function spawnEffect(zi, when) {
  const type = config.EFFECTS[zi % config.EFFECTS.length];
  const now = nowSec();

  for (const e of fxList) {
    if (e.state !== 'out') { e.state = 'out'; e.outT0 = now; }
  }
  while (fxList.length > 6) fxList.shift();

  const inst = buildEffect(type);
  inst.t0 = Math.min(when, now + 0.05);
  fxList.push(inst);
}

function fxFrame(now) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const inst = fxList[i];
    let outK = 0;
    if (inst.state === 'out') {
      outK = utils.clamp01((now - inst.outT0) / FX_OUT);
      if (outK >= 1) { fxList.splice(i, 1); continue; }
    }
    const t = now - inst.t0;
    if (t < 0) continue;

    const fade = 1 - utils.smooth(outK);
    const sc = inst.state === 'out' ? 1 - 0.22 * outK : 1 + state.beatP * 0.02;
    g.save();
    g.translate(inst.cx, inst.cy);
    g.scale(sc, sc);
    g.translate(-inst.cx, -inst.cy);
    DRAW[inst.type](g, inst, t, fade);
    g.restore();
  }
  g.globalAlpha = 1;
}

/* ============================================================
 * 分区闪光 / 网格线
 * ==========================================================*/
function flashZone(zi) {
  zoneFlashes.push({ zi, born: Date.now() / 1000 });
  if (zoneFlashes.length > 24) zoneFlashes.shift();
}

function drawZoneFlashes() {
  const now = Date.now() / 1000;
  const { width, height } = state.metrics;
  for (let i = zoneFlashes.length - 1; i >= 0; i--) {
    const flash = zoneFlashes[i];
    const t = (now - flash.born) / 0.45;
    if (t >= 1) { zoneFlashes.splice(i, 1); continue; }
    const opacity = 0.45 * (1 - utils.smooth(t)); // zoneFade: .45 → 0, ease-out
    const r = (flash.zi / state.cols) | 0;
    const c = flash.zi % state.cols;
    g.globalAlpha = opacity;
    g.fillStyle = '#fff';
    g.fillRect(
      c * width / state.cols + 3,
      r * height / state.rows + 3,
      width / state.cols - 6,
      height / state.rows - 6
    );
  }
  g.globalAlpha = 1;
}

function drawKeyGrid() {
  if (!state.performanceSettings.showGrid) return;
  const { width, height } = state.metrics;
  g.fillStyle = 'rgba(255, 255, 255, .025)';
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      g.fillRect(c * width / state.cols + 0.5, r * height / state.rows + 0.5,
        width / state.cols - 1, height / state.rows - 1);
    }
  }
  g.strokeStyle = 'rgba(135, 131, 126, .14)';
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 1; c < state.cols; c++) {
    g.moveTo(c * width / state.cols, 0);
    g.lineTo(c * width / state.cols, height);
  }
  for (let r = 1; r < state.rows; r++) {
    g.moveTo(0, r * height / state.rows);
    g.lineTo(width, r * height / state.rows);
  }
  g.stroke();
}

/* ============================================================
 * 角色渲染
 * ==========================================================*/
let bakedCharacter = null;   // 当前角色烘焙产物
let bakedSfxId = null;
let emperorAtlasImage = null;

async function ensureCharacterLoaded(sfxId) {
  if (bakedSfxId === sfxId && bakedCharacter) return bakedCharacter;
  bakedCharacter = await assets.loadCharacterImages(sfxId);
  bakedSfxId = sfxId;
  return bakedCharacter;
}

async function ensureEmperorAtlas() {
  if (emperorAtlasImage) return emperorAtlasImage;
  emperorAtlasImage = await assets.loadEmperorAtlas();
  return emperorAtlasImage;
}

function drawBakedImage(baked, box, alpha) {
  if (!baked || alpha <= 0) return;
  const img = baked.canvas;
  const origW = img.width - 2 * baked.pad;
  const origH = img.height - 2 * baked.pad;
  if (origW <= 0 || origH <= 0) return;
  const scale = box.w / origW;
  g.globalAlpha = alpha;
  g.drawImage(
    img,
    box.x - baked.pad * scale,
    box.y - baked.pad * scale + (box.h - origH * scale),
    img.width * scale,
    img.height * scale
  );
  g.globalAlpha = 1;
}

function renderDog() {
  if (!bakedCharacter) return;
  const m = state.metrics;
  const unit = state.sceneUnit;
  const cx = m.width / 2;
  const cy = m.height / 2;
  const isHajimi = state.selectedSfxId === 'hajimi';
  const showEmperor = isHajimi && state.hajimiAnimationEnabled && state.hajimiAnimationReady;

  // 村民受击红闪透明度（villagerHitFlash 160ms：18% 处最强）
  let flashAlpha = 0;
  if (flashAnim) {
    const t = (Date.now() - flashAnim.start) / 160;
    if (t >= 1) flashAnim = null;
    else flashAlpha = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
  }

  g.save();
  // #dog 层：transform-origin 50% 62%（全屏）
  const dogOriginX = m.width / 2;
  const dogOriginY = m.height * 0.62;
  g.translate(dogOriginX, dogOriginY);
  // tick() 写入的 transform：sway / beatP
  if (state.dogTransform) {
    const t = state.dogTransform;
    g.translate(t.tx, t.ty);
    g.rotate(t.rotate);
    g.scale(t.sx, t.sy);
  }
  g.translate(-dogOriginX, -dogOriginY);

  // #dog-hit 层：村民击退位移
  let knockX = 0;
  if (knockback) {
    const t = (Date.now() - knockback.start) / 180;
    if (t >= 1) knockback = null;
    else {
      const e = KNOCK_EASE(t);
      if (t < 0.24) knockX = knockback.offset * (e / KNOCK_EASE(0.24));
      else if (t < 0.62) {
        const k = (t - 0.24) / 0.38;
        knockX = knockback.offset + (knockback.rebound - knockback.offset) * k;
      } else {
        const k = (t - 0.62) / 0.38;
        knockX = knockback.rebound * (1 - k);
      }
    }
  }
  g.translate(knockX, 0);

  // #dog-inner 层：叫弹簧（origin 50% 50% = 屏幕中心）
  g.translate(cx, cy);
  g.rotate((-3.5 * state.barkPop * Math.PI) / 180);
  g.scale(1 + 0.17 * state.barkPop, 1 + 0.17 * state.barkPop);

  // #dog-jelly 层：果冻抖动 + 缩放
  if (state.jellyTransform) {
    const jt = state.jellyTransform;
    g.translate(jt.tx, jt.ty);
    g.rotate(jt.rotate);
    g.scale(jt.scale, jt.scale);
  }

  const box = { x: -unit / 2, y: -unit / 2, w: unit, h: unit };

  if (showEmperor && emperorAtlasImage) {
    // 帝皇图集当前帧：宽 70% 居中
    const frame = Math.max(0, state.hajimiAnimationFrame);
    const frameW = config.HAJIMI_ATLAS_FRAME_WIDTH;
    const frameH = config.HAJIMI_ATLAS_FRAME_HEIGHT;
    const sourceX = (frame % config.HAJIMI_ATLAS_COLUMNS) * frameW;
    const sourceY = Math.floor(frame / config.HAJIMI_ATLAS_COLUMNS) * frameH;
    const destW = unit * 0.7;
    const destH = destW * (frameH / frameW);
    g.drawImage(
      emperorAtlasImage,
      sourceX, sourceY, frameW, frameH,
      -destW / 2, -destH / 2, destW, destH
    );
  } else {
    // 非哈基米：闭嘴图常驻，张嘴图以透明度叠加（80ms 过渡）；
    // 哈基米两张图轮廓不同：互斥可见、瞬时切换（与原版一致）
    const mouthAlpha = state.mouthAlpha ?? 0;
    if (isHajimi) {
      if (mouthAlpha >= 0.5) drawBakedImage(bakedCharacter.open, box, 1);
      else drawBakedImage(bakedCharacter.close, box, 1);
    } else {
      drawBakedImage(bakedCharacter.close, box, 1);
      if (mouthAlpha > 0) drawBakedImage(bakedCharacter.open, box, mouthAlpha);
    }
    const showOpen = isHajimi ? mouthAlpha >= 0.5 : mouthAlpha > 0.5;
    const tint = showOpen ? bakedCharacter.openTint : bakedCharacter.closeTint;
    if (tint && state.holdLevel > 0.004) {
      drawBakedImage(tint, box, Math.min(1, state.holdLevel));
    }
    if (flashAlpha > 0) {
      const flash = showOpen ? bakedCharacter.flashOpen : bakedCharacter.flashClose;
      if (flash) drawBakedImage(flash, box, flashAlpha);
    }
  }

  g.restore();
  g.globalAlpha = 1;
}

/* ============================================================
 * 村民受击：击退 / 粒子 / 连击胶囊
 * ==========================================================*/
const PARTICLE_COLORS = ['#9b6a3c', '#b88a58', '#6f7b48', '#d0b085'];

function spawnVillagerHitParticles(direction, strength) {
  const m = state.metrics;
  const originX = m.width * 0.5;
  const originY = m.height * 0.43;

  for (let index = 0; index < config.VILLAGER_PARTICLE_COUNT; index++) {
    const spread = (index - (config.VILLAGER_PARTICLE_COUNT - 1) / 2) * 8;
    const jitter = (Math.random() - 0.5) * 18;
    const dx = direction * (24 + strength * 2 + Math.random() * 26) + spread;
    const dy = -(44 + Math.random() * 58) + jitter;
    villagerParticles.push({
      originX,
      originY,
      dx,
      dy,
      size: Math.round(7 + Math.random() * 7),
      rotate: Math.round(direction * (70 + Math.random() * 150)) * Math.PI / 180,
      delay: index * 0.009,
      color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
      born: Date.now(),
    });
  }
}

function drawVillagerParticles() {
  const now = Date.now();
  const DURATION = 0.48;
  const FADE_IN_END = 0.14; // @keyframes 14% 处达到峰值透明度
  for (let i = villagerParticles.length - 1; i >= 0; i--) {
    const p = villagerParticles[i];
    const t = (now - p.born) / 1000 - p.delay;
    if (t >= DURATION) { villagerParticles.splice(i, 1); continue; }
    if (t < 0) continue;
    const progress = t / DURATION;
    const k = PARTICLE_EASE(progress);
    const opacity = progress < FADE_IN_END
      ? (progress / FADE_IN_END) * 0.96
      : 0.96 * (1 - (progress - FADE_IN_END) / (1 - FADE_IN_END));
    const x = p.originX + p.dx * k;
    const y = p.originY + p.dy * k;
    const scale = 0.7 + (0.18 - 0.7) * k;
    g.save();
    g.globalAlpha = Math.max(0, Math.min(0.96, opacity));
    g.translate(x, y);
    g.rotate(p.rotate * k);
    g.scale(scale, scale);
    g.fillStyle = p.color;
    g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    g.restore();
  }
  g.globalAlpha = 1;
}

let comboTextCache = { value: -1, text: '', width: 0 };

function drawCombo() {
  const combo = state.villagerHitUi;
  if (!combo || combo.mode === 'hidden') return;
  const m = state.metrics;
  const vmin = Math.min(m.width, m.height) / 100;
  const fontSize = Math.max(13, Math.min(19, 2.8 * vmin));
  const top = Math.max(86, Math.min(210, m.height * 0.23));

  let alpha = 1;
  let offsetY = 0;
  let scale = 1;
  if (combo.mode === 'visible') {
    const t = utils.clamp01((Date.now() - combo.since) / 180);
    alpha = t;
    offsetY = 8 * (1 - t);
    scale = 0.9 + 0.1 * t;
  } else if (combo.mode === 'fading') {
    const t = utils.clamp01((Date.now() - combo.since) / 180);
    alpha = 1 - t;
    offsetY = -5 * t;
    scale = 1 - 0.04 * t;
  }
  if (alpha <= 0) return;

  if (comboTextCache.value !== combo.value || comboTextCache.fontSize !== fontSize) {
    comboTextCache.value = combo.value;
    comboTextCache.fontSize = fontSize;
    comboTextCache.text = `HIT ×${combo.value}`;
    g.font = `900 ${fontSize}px sans-serif`;
    comboTextCache.width = g.measureText(comboTextCache.text).width;
  }

  g.save();
  g.globalAlpha = alpha;
  g.translate(m.width / 2, top + offsetY);
  g.scale(scale, scale);
  const text = comboTextCache.text;
  const textWidth = comboTextCache.width;
  const padX = 12;
  const pillW = textWidth + padX * 2;
  const pillH = fontSize + 13;
  g.fillStyle = 'rgba(255, 90, 95, .94)';
  g.strokeStyle = 'rgba(255, 250, 240, .88)';
  g.lineWidth = 2;
  const radius = pillH / 2;
  g.beginPath();
  if (g.roundRect) {
    g.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, radius);
  } else {
    utils.traceChamferRect(g, -pillW / 2, -pillH / 2, pillW, pillH, radius / 2);
  }
  g.fill();
  g.stroke();
  g.fillStyle = '#fffaf0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 1);
  g.restore();
  g.globalAlpha = 1;
}

/* ============================================================
 * 署名（右下角 Created by MarkCup，逐字母跟拍）
 * 字母与宽度缓存，避免逐帧 measureText / 数组分配
 * ==========================================================*/
const AUTHOR_NAME = 'MarkCup';
let authorLetterWidths = null;   // 惰性测量一次

function drawAuthorLink(beatPosition) {
  const m = state.metrics;
  const pulse = Number.isFinite(beatPosition)
    ? Math.pow(1 - (((beatPosition % 1) + 1) % 1), 4.5)
    : 0;
  const beatIndex = Number.isFinite(beatPosition) ? Math.floor(beatPosition) : -1;

  const blockW = 124;
  const right = m.width - 18 - blockW;
  const bottom = m.height - Math.max(16, state.safeBottom + 8);

  g.save();
  g.translate(right, bottom - pulse * 1.4);
  g.scale(1 + pulse * 0.032, 1 + pulse * 0.032);

  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = '600 9px sans-serif';
  g.fillStyle = 'rgba(255, 180, 0, .78)';
  g.fillText('CREATED BY', 0, 0);

  g.font = '700 20px serif';
  if (!authorLetterWidths) {
    const widths = [];
    let sum = 0;
    for (const ch of AUTHOR_NAME) {
      const w = g.measureText(ch).width;
      widths.push(w);
      sum += w;
    }
    widths.letterSpacing = (blockW - sum) / AUTHOR_NAME.length;
    widths.total = sum;
    authorLetterWidths = widths;
  }
  g.fillStyle = C.amber;
  let cursor = 0;
  for (let i = 0; i < AUTHOR_NAME.length; i++) {
    const ch = AUTHOR_NAME[i];
    const w = authorLetterWidths[i];
    const scale = i === ((beatIndex % AUTHOR_NAME.length) + AUTHOR_NAME.length) % AUTHOR_NAME.length
      ? 1 + pulse * 0.24
      : 1;
    if (scale !== 1) {
      g.save();
      g.translate(cursor + w / 2, -11);
      g.scale(scale, scale);
      g.fillText(ch, -w / 2, 0);
      g.restore();
    } else {
      g.fillText(ch, cursor, -11);
    }
    cursor += w + authorLetterWidths.letterSpacing;
  }
  g.restore();
}

/* ============================================================
 * 主渲染入口 / 布局
 * ==========================================================*/
function resize() {
  fxW = state.metrics.width;
  fxH = state.metrics.height;
  for (const e of fxList) { e.cx = cx0(); e.cy = cy0(); }
}

function render(beatPosition) {
  // 全幅清除：恒等变换按位图实际尺寸铺底，任何逻辑尺寸错位都不会留下残影
  const bitmapW = mainCanvas ? mainCanvas.width : Math.round(fxW * state.dpr);
  const bitmapH = mainCanvas ? mainCanvas.height : Math.round(fxH * state.dpr);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.cream;
  g.fillRect(0, 0, bitmapW, bitmapH);
  g.restore();

  fxFrame(nowSec());
  drawKeyGrid();
  drawZoneFlashes();
  renderDog();
  drawVillagerParticles();
  drawCombo();
  drawAuthorLink(beatPosition);
}

function init(context2d, canvas) {
  g = context2d;
  mainCanvas = canvas ?? null;
}

function resetVillagerHitVisual() {
  knockback = null;
  flashAnim = null;
  villagerParticles.length = 0;
}

module.exports = {
  init, resize, render, spawnEffect, flashZone,
  spawnVillagerHitParticles, resetVillagerHitVisual,
  ensureCharacterLoaded, ensureEmperorAtlas,
  setKnockback(direction, offset, rebound) {
    knockback = { start: Date.now(), direction, offset, rebound };
  },
  setFlash() {
    flashAnim = { start: Date.now() };
  },
};
