// PreFlight - aplică fix-urile pe un canvas nou (imaginea originală rămâne neatinsă)

import { bestTextOn, contrast, hexToRgb } from "./engine.js";

function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);

// determină regiunea orizontală împărțind imaginea în 3 părți egale:
// stânga (< W/3) -> "left", mijloc ([W/3, 2W/3]) -> "center", dreapta (> 2W/3) -> "right"
export function regionAlign(b, W) {
  const third = W / 3;
  const cx = b.x + b.w / 2;
  if (b.x < third && b.x + b.w <= 2 * third) return "left";
  if (b.x >= third && b.x + b.w > 2 * third) return "right";
  if (cx < third) return "left";
  if (cx > 2 * third) return "right";
  return "center";
}

// limitele orizontale libere [leftEdge, rightEdge] pe fundalul blocului, fără a intra peste ilustrații
function freeBounds(baseCtx, b, bgHex) {
  const W = baseCtx.canvas.width, H = baseCtx.canvas.height;
  const margin = Math.round(24 * (W / 1080));
  if (!bgHex) return { left: Math.max(margin, b.x), right: Math.min(W - margin, Math.max(b.x + b.w, W * 0.85)) };
  const bg = hexToRgb(bgHex);
  const yMid = Math.min(H - 1, Math.max(0, Math.round(b.y + b.h / 2)));
  const row = baseCtx.getImageData(0, yMid, W, 1).data;

  let lx = Math.max(0, Math.floor(b.x));
  while (lx > margin) {
    const i = (lx - 1) * 4;
    if (dist([row[i], row[i + 1], row[i + 2]], bg) > 40) break;
    lx--;
  }

  let rx = Math.min(W, Math.ceil(b.x + b.w));
  while (rx < W - margin) {
    const i = rx * 4;
    if (dist([row[i], row[i + 1], row[i + 2]], bg) > 40) break;
    rx++;
  }

  return {
    left: Math.min(b.x, lx + Math.round(12 * (W / 1080))),
    right: Math.max(b.x + b.w, rx - Math.round(20 * (W / 1080))),
  };
}

function drawAlignedLine(ctx, ln, b, align, y) {
  const m = ctx.measureText(ln);
  const w = (m.actualBoundingBoxRight !== undefined && m.actualBoundingBoxLeft !== undefined)
    ? (m.actualBoundingBoxRight - m.actualBoundingBoxLeft)
    : m.width;
  const x = align === "center"
    ? b.x + (b.w - w) / 2
    : align === "right"
      ? b.x + b.w - w
      : b.x;
  ctx.fillText(ln, x, y);
}

function drawSubline(ctx, b, align, topY, maxW, text, colorHex, bgHex, k) {
  const subSize = Math.round(26 * k);
  ctx.font = `600 ${subSize}px Poppins, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const lines = wrapLines(ctx, text, maxW);
  const capH = ctx.measureText("H").actualBoundingBoxAscent || subSize * 0.72;
  const lh = Math.round(subSize * 1.24);
  const pad = Math.round(6 * k);
  const boxH = capH + (lines.length - 1) * lh + 2 * pad;
  const maxLineW = Math.max(b.w, ...lines.map((ln) => ctx.measureText(ln).width));
  const bgX = align === "center"
    ? b.x + (b.w - maxLineW) / 2 - pad
    : align === "right"
      ? b.x + b.w - maxLineW - pad
      : b.x - pad;
  if (bgHex) {
    ctx.fillStyle = bgHex;
    ctx.fillRect(bgX, topY - pad, maxLineW + 2 * pad, boxH);
  }
  const fg = colorHex && bgHex && contrast(hexToRgb(colorHex), hexToRgb(bgHex)) >= 3.5
    ? colorHex
    : (bgHex ? bestTextOn(hexToRgb(bgHex)) : (colorHex || "#0F172A"));
  ctx.fillStyle = fg;
  let y = topY + capH;
  for (const ln of lines) {
    drawAlignedLine(ctx, ln, b, align, y);
    y += lh;
  }
}

// redesenează un bloc de text: acoperă originalul cu fundalul și scrie textul nou
function drawBlock(ctx, baseCtx, st, k) {
  const b = st.bbox, pad = Math.max(4, st.fontPx * 0.25);
  const size = Math.round(st.fontPx * 1.05);

  if (st.shape) {                                     // buton recolorat: centrare optică pe ambele axe
    const s = st.shape;
    ctx.fillStyle = st.bg;
    roundRect(ctx, s.x - 3, s.y - 3, s.w + 6, s.h + 6, Math.min(s.h / 2 + 3, 46));
    ctx.fill();
    ctx.fillStyle = st.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${st.bold ? 700 : 600} ${size}px Poppins, sans-serif`;
    const maxW = Math.max(40, s.w - 2 * Math.max(12, pad));
    const lines = wrapLines(ctx, st.text, maxW);
    const capM = ctx.measureText("H");
    const capAsc = capM.actualBoundingBoxAscent || size * 0.72;
    const capDesc = capM.actualBoundingBoxDescent || 0;
    const lh = size * 1.2;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    let y = cy + (capAsc - capDesc - (lines.length - 1) * lh) / 2;
    for (const ln of lines) {
      const m = ctx.measureText(ln);
      const x = (m.actualBoundingBoxRight !== undefined && m.actualBoundingBoxLeft !== undefined)
        ? cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2
        : cx - m.width / 2;
      ctx.fillText(ln, x, y);
      y += lh;
    }
    return;
  }

  const align = regionAlign(b, baseCtx.canvas.width);
  const bounds = freeBounds(baseCtx, b, st.bg);
  const maxW = align === "right"
    ? Math.max(b.w, (b.x + b.w) - bounds.left)
    : align === "center"
      ? Math.max(b.w, 2 * Math.min((b.x + b.w / 2) - bounds.left, bounds.right - (b.x + b.w / 2)))
      : Math.max(b.w, bounds.right - b.x);

  if (st.redrawText) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
    ctx.fillStyle = st.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${st.bold ? 700 : 500} ${size}px Poppins, sans-serif`;
    const lines = wrapLines(ctx, st.text, maxW);
    const capH = ctx.measureText("H").actualBoundingBoxAscent || size * 0.72;
    const lh = size * 1.2;
    let y = lines.length === 1 ? b.y + (b.h + capH) / 2 : b.y + capH;
    for (const ln of lines) {
      drawAlignedLine(ctx, ln, b, align, y);
      y += lh;
    }
    if (st.subText) {
      const subTop = (y - lh) + Math.round(14 * k);
      drawSubline(ctx, b, align, subTop, maxW, st.subText, st.color, st.bg, k);
    }
  } else if (st.subText) {
    const subTop = b.y + b.h + Math.round(14 * k);
    drawSubline(ctx, b, align, subTop, maxW, st.subText, st.color, st.bg, k);
  }
}

export function applyFixes(baseCanvas, blocks, issues, kit) {
  const out = document.createElement("canvas");
  out.width = baseCanvas.width; out.height = baseCanvas.height;
  const ctx = out.getContext("2d");
  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(baseCanvas, 0, 0);
  const W = out.width, H = out.height, k = W / 1080;

  // starea fiecărui bloc modificat
  const state = new Map();
  const st = (id) => {
    if (!state.has(id)) {
      const b = blocks.find((x) => x.id === id);
      state.set(id, {
        bbox: b.bbox, text: b.text, color: b.textColor, bg: b.bgColor, fontPx: b.fontPx,
        bold: b.fontPx * (1080 / W) >= 36 || /^-\d+%/.test(b.text),
        shape: null, redrawText: false, subText: null,
      });
    }
    return state.get(id);
  };
  let label = false, disclaimer = false;
  for (const i of issues.filter((x) => x.fixed && x.fix)) {
    const f = i.fix;
    if (f.kind === "textColor") { const s = st(f.blockId); s.color = f.hex; s.redrawText = true; }
    if (f.kind === "replaceText") { const s = st(f.blockId); s.text = f.text; s.redrawText = true; }
    if (f.kind === "refPrice") {
      const s = st(f.blockId);
      if (f.cleanText && f.cleanText !== s.text) { s.text = f.cleanText; s.redrawText = true; }
      s.subText = f.text;
    }
    if (f.kind === "fill") { const s = st(f.blockId); s.bg = f.hex; s.color = f.textHex; s.shape = f.shape; s.redrawText = true; }
    if (f.kind === "label") label = true;
    if (f.kind === "disclaimer") disclaimer = true;
  }
  for (const s of state.values()) drawBlock(ctx, baseCtx, s, k);

  if (disclaimer) {
    ctx.font = `400 ${Math.round(15 * k)}px Poppins, sans-serif`;
    ctx.textAlign = "left";
    const dw = ctx.measureText(kit.requiredDisclaimer).width, dh = 26 * k, dx = 20 * k, dy = H - 46 * k;
    ctx.fillStyle = "rgba(255,251,245,0.92)"; roundRect(ctx, dx, dy, dw + 16 * k, dh, 6 * k); ctx.fill();
    ctx.fillStyle = "#1E293B"; ctx.textBaseline = "middle";
    ctx.fillText(kit.requiredDisclaimer, dx + 8 * k, dy + dh / 2 + 1);
  }
  if (label) {
    const txt = "Imagine generată cu AI";
    ctx.font = `600 ${Math.round(20 * k)}px Poppins, sans-serif`;
    ctx.textAlign = "left";
    const tw = ctx.measureText(txt).width, ph = 34 * k, pw = tw + 28 * k;
    const x = W - pw - 24 * k, y = H - ph - (disclaimer ? 54 : 24) * k;
    ctx.fillStyle = "rgba(15,23,42,0.88)"; roundRect(ctx, x, y, pw, ph, 8 * k); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.fillText(txt, x + 14 * k, y + ph / 2 + 1);
  }
  return out;
}
