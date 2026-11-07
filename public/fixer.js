// PreFlight - aplică fix-urile pe un canvas nou (imaginea originală rămâne neatinsă)

import { bestTextOn, fitTextInBox, hexToRgb } from "./engine.js";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function regionAlign(b, W) {
  const third = W / 3;
  const cx = b.x + b.w / 2;
  if (b.x < third && b.x + b.w <= 2 * third) return "left";
  if (b.x >= third && b.x + b.w > 2 * third) return "right";
  if (cx < third) return "left";
  if (cx > 2 * third) return "right";
  return "center";
}

// Keep every rewritten block inside its original bounds (or button shape).
function drawBlock(ctx, st, k) {
  if (!st.redrawText) return;
  const box = st.shape || st.bbox;
  const inset = st.shape ? Math.min(box.h * 0.15, 12 * k) : 0;
  const target = { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset };
  const weight = st.bold ? 700 : 500;
  const layout = fitTextInBox(ctx, st.text, {
    width: target.w, height: target.h, fontSize: st.fontPx,
    minFontSize: Math.min(st.fontPx, 14 * k), weight,
  });
  if (!layout) throw new Error("Textul nu \u00eencape lizibil \u00een spa\u021biul original. Scurteaz\u0103 formularea \u00een editor \u0219i re\u00eencarc\u0103 imaginea.");
  const erase = st.shape ? box : st.erase;
  ctx.save();
  ctx.beginPath(); ctx.rect(erase.x, erase.y, erase.w, erase.h); ctx.clip();
  ctx.fillStyle = st.bg || "#FFFFFF";
  if (st.shape) { roundRect(ctx, box.x, box.y, box.w, box.h, Math.min(box.h / 2, 46 * k)); ctx.fill(); }
  else ctx.fillRect(erase.x, erase.y, erase.w, erase.h);
  ctx.fillStyle = st.color || bestTextOn(hexToRgb(st.bg || "#FFFFFF"));
  ctx.font = `${weight} ${layout.size}px Poppins, sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const align = st.shape ? "center" : regionAlign(box, ctx.canvas.width);
  let y = target.y + (target.h - layout.height) / 2 + layout.ascent;
  for (const line of layout.lines) {
    const width = ctx.measureText(line).width;
    const x = align === "center" ? target.x + (target.w - width) / 2 : align === "right" ? target.x + target.w - width : target.x;
    ctx.fillText(line, x, y);
    y += layout.lineHeight;
  }
  ctx.restore();
}

export function applyFixes(baseCanvas, blocks, issues, kit) {
  const out = document.createElement("canvas");
  out.width = baseCanvas.width; out.height = baseCanvas.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(baseCanvas, 0, 0);
  const W = out.width, H = out.height, k = W / 1080;

  // starea fiecărui bloc modificat
  const state = new Map();
  const st = (id) => {
    if (!state.has(id)) {
      const b = blocks.find((x) => x.id === id);
      if (!b) throw new Error("Blocul de text nu mai există. Re-verifică imaginea.");
      // Curăță și conturul antialias, fără să atingă alt bloc OCR.
      const padding = 3 * k;
      const x = Math.max(0, b.bbox.x - padding), y = Math.max(0, b.bbox.y - padding);
      const expanded = { x, y, w: Math.min(W, b.bbox.x + b.bbox.w + padding) - x,
        h: Math.min(H, b.bbox.y + b.bbox.h + padding) - y };
      const touchesNeighbor = blocks.some((other) => other.id !== id &&
        expanded.x < other.bbox.x + other.bbox.w && expanded.x + expanded.w > other.bbox.x &&
        expanded.y < other.bbox.y + other.bbox.h && expanded.y + expanded.h > other.bbox.y);
      state.set(id, {
        bbox: b.bbox, text: b.text, color: b.textColor, bg: b.bgColor, fontPx: b.fontPx,
        erase: touchesNeighbor ? b.bbox : expanded,
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
    if (f.kind === "label") label = f.text || "Imagine generată cu AI";
    if (f.kind === "disclaimer") disclaimer = true;
  }
  // Additional text gets its own space below the original image.
  // This also works for flat photos, where no editable shape boundaries exist.
  const notes = [...state.values()].filter((s) => s.subText).map((s) => ({ text: `${s.text} \u2014 ${s.subText}`, weight: 600, size: 22 * k }));
  if (disclaimer && kit.requiredDisclaimer) notes.push({ text: kit.requiredDisclaimer, weight: 400, size: 18 * k });
  if (label) notes.push({ text: label, weight: 700, size: 22 * k });
  const margin = 24 * k, gap = 16 * k;
  const rows = notes.map((note) => {
    const layout = fitTextInBox(ctx, note.text, { width: W - 2 * margin, height: 160 * k, fontSize: note.size, minFontSize: 14 * k, weight: note.weight });
    if (!layout) throw new Error("Textul ad\u0103ugat este prea lung pentru o afi\u0219are lizibil\u0103.");
    return { ...note, ...layout };
  });
  if (rows.length) {
    out.height = H + Math.ceil(2 * margin + rows.reduce((sum, row) => sum + row.height, 0) + gap * (rows.length - 1));
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, H, W, out.height - H);
  }
  for (const s of state.values()) drawBlock(ctx, s, k);
  let top = H + margin;
  for (const row of rows) {
    ctx.font = `${row.weight} ${row.size}px Poppins, sans-serif`;
    ctx.fillStyle = "#0F172A"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    let y = top + row.ascent;
    for (const line of row.lines) { ctx.fillText(line, margin, y); y += row.lineHeight; }
    top += row.height + gap;
  }
  return out;
}
