'use strict';
/* ============================================================
 * 工具函数：随机数 / 缓动 / 路径 / base64 / 文本排版
 * ==========================================================*/

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = t => t * t * (3 - 2 * t);
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => { const c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const easeOutElastic = t =>
  t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;

function tracePoly(g, x, y, r, sides, rot) {
  g.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}

function traceStar(g, x, y, r, points, rot) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * 0.46 : r;
    const a = rot + (i * Math.PI) / points;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}

function drawPiece(g, kind, color, x, y, r, rot) {
  if (r <= 0) return;
  g.save();
  g.translate(x, y);
  g.rotate(rot || 0);
  switch (kind) {
    case 'circle':
      g.fillStyle = color;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      break;
    case 'ring':
      g.strokeStyle = color;
      g.lineWidth = Math.max(2, r * 0.3);
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();
      break;
    case 'square':
      g.fillStyle = color;
      g.fillRect(-r, -r, r * 2, r * 2);
      break;
    case 'triangle':
      g.fillStyle = color;
      tracePoly(g, 0, 0, r * 1.2, 3, -Math.PI / 2); g.fill();
      break;
    case 'diamond':
      g.fillStyle = color;
      tracePoly(g, 0, 0, r * 1.15, 4, 0); g.fill();
      break;
    case 'hexagon':
      g.fillStyle = color;
      tracePoly(g, 0, 0, r * 1.1, 6, 0); g.fill();
      break;
    case 'star':
      g.fillStyle = color;
      traceStar(g, 0, 0, r * 1.25, 5, -Math.PI / 2); g.fill();
      break;
    case 'cross': {
      g.fillStyle = color;
      const w = r * 0.62;
      g.fillRect(-r, -w / 2, r * 2, w);
      g.fillRect(-w / 2, -r, w, r * 2);
      break;
    }
  }
  g.restore();
}

function strokePartial(g, pts, lens, vis) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = lens[i - 1];
    if (acc + seg <= vis) {
      g.lineTo(pts[i].x, pts[i].y);
      acc += seg;
    } else {
      const f = seg > 0 ? (vis - acc) / seg : 0;
      const tx = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f;
      const ty = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f;
      g.lineTo(tx, ty);
      return { x: tx, y: ty };
    }
  }
  return pts[pts.length - 1];
}

/* 小游戏环境没有 atob：手写 base64 → ArrayBuffer */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

function b64ToArrayBuffer(b64) {
  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 61) len--; // 去掉尾部 '='
  const out = new Uint8Array((len * 3) >> 2);
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    buffer = (buffer << 6) | B64_LOOKUP[b64.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return out.buffer;
}

/* 带字距的文本绘制（模拟 CSS letter-spacing，单位 px）。
   返回实际占用宽度，便于居中/测量。 */
function fillSpacedText(g, text, x, y, letterSpacing, align = 'center') {
  const chars = [...text];
  let total = 0;
  const widths = chars.map((ch) => {
    const w = g.measureText(ch).width;
    total += w + letterSpacing;
    return w;
  });
  total -= chars.length ? letterSpacing : 0;

  let cursor = x;
  if (align === 'center') cursor = x - total / 2;
  else if (align === 'right') cursor = x - total;

  for (let i = 0; i < chars.length; i++) {
    g.fillText(chars[i], cursor, y);
    cursor += widths[i] + letterSpacing;
  }
  return total;
}

/* 八边形切角路径（对应 CSS clip-path: polygon(...) 切角矩形）。
   x/y/w/h 为外框，c 为切角尺寸；inset 后再缩小的外框由调用方计算。 */
function traceChamferRect(g, x, y, w, h, c) {
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w - c, y);
  g.lineTo(x + w, y + c);
  g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h);
  g.lineTo(x + c, y + h);
  g.lineTo(x, y + h - c);
  g.lineTo(x, y + c);
  g.closePath();
}

/* 仿 CSS clip-path 百分比八边形（用于红点等 32%/68% 切角） */
function traceChamferRectPercent(g, x, y, w, h, p1, p2) {
  const ax = x + w * p1, bx = x + w * p2;
  const ay = y + h * p1, by = y + h * p2;
  g.beginPath();
  g.moveTo(ax, y);
  g.lineTo(bx, y);
  g.lineTo(x + w, ay);
  g.lineTo(x + w, by);
  g.lineTo(bx, y + h);
  g.lineTo(ax, y + h);
  g.lineTo(x, by);
  g.lineTo(x, ay);
  g.closePath();
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w &&
    py >= rect.y && py <= rect.y + rect.h;
}

/* 多行文本逐行绘制（\n 分隔），返回行数组 */
function fillWrappedText(g, text, x, y, lineHeight, align = 'center') {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    g.fillText(lines[i], x, y + i * lineHeight);
  }
  return lines;
}

module.exports = {
  mulberry32, clamp01, smooth, easeOutCubic, easeOutBack, easeOutElastic,
  tracePoly, traceStar, drawPiece, strokePartial,
  b64ToArrayBuffer, fillSpacedText, traceChamferRect, traceChamferRectPercent,
  pointInRect, fillWrappedText,
};
