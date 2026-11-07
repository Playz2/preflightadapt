// PreFlight - aplică fix-urile pe un canvas nou (imaginea originală rămâne neatinsă)

function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
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

// redesenează un bloc de text: acoperă originalul cu fundalul și scrie textul nou
function drawBlock(ctx, st) {
  const b = st.bbox, pad = Math.max(4, st.fontPx * 0.25);
  if (st.shape) {                                     // buton recolorat
    const s = st.shape;
    ctx.fillStyle = st.bg; roundRect(ctx, s.x - 3, s.y - 3, s.w + 6, s.h + 6, Math.min(s.h / 2 + 3, 46)); ctx.fill();
  } else {
    ctx.fillStyle = st.bg; ctx.fillRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
  }
  ctx.fillStyle = st.color; ctx.textBaseline = "top";
  const size = Math.round(st.fontPx * 1.05);
  ctx.font = `${st.bold ? 700 : 500} ${size}px Poppins, sans-serif`;
  const maxW = st.shape ? st.shape.w - 2 * pad : Math.max(b.w, ctx.canvas.width * 0.85 - b.x);
  const lines = wrapLines(ctx, st.text, maxW);
  const lh = size * 1.2, total = lines.length * lh;
  let y = st.shape ? st.shape.y + (st.shape.h - total) / 2 : b.y + (b.h - total) / 2;
  for (const ln of lines) {
    const x = st.shape ? st.shape.x + (st.shape.w - ctx.measureText(ln).width) / 2 : b.x;
    ctx.fillText(ln, x, y); y += lh;
  }
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
      state.set(id, { bbox: b.bbox, text: b.text, color: b.textColor, bg: b.bgColor, fontPx: b.fontPx,
                      bold: b.fontPx * (1080 / W) >= 40, shape: null });
    }
    return state.get(id);
  };
  let label = false, disclaimer = false;
  for (const i of issues.filter((x) => x.fixed && x.fix)) {
    const f = i.fix;
    if (f.kind === "textColor") st(f.blockId).color = f.hex;
    if (f.kind === "replaceText") st(f.blockId).text = f.text;
    if (f.kind === "fill") { const s = st(f.blockId); s.bg = f.hex; s.color = f.textHex; s.shape = f.shape; }
    if (f.kind === "label") label = true;
    if (f.kind === "disclaimer") disclaimer = true;
  }
  for (const s of state.values()) drawBlock(ctx, s);

  if (disclaimer) {
    ctx.font = `400 ${Math.round(15 * k)}px Poppins, sans-serif`; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#334155"; ctx.fillText(kit.requiredDisclaimer, 28 * k, H - 30 * k);
  }
  if (label) {
    const txt = "Imagine generată cu AI";
    ctx.font = `600 ${Math.round(20 * k)}px Poppins, sans-serif`;
    const tw = ctx.measureText(txt).width, ph = 34 * k, pw = tw + 28 * k;
    const x = W - pw - 24 * k, y = H - ph - (disclaimer ? 54 : 24) * k;
    ctx.fillStyle = "rgba(15,23,42,0.88)"; roundRect(ctx, x, y, pw, ph, 8 * k); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.fillText(txt, x + 14 * k, y + ph / 2 + 1);
  }
  return out;
}
