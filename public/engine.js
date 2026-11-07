// PreFlight - motorul determinist (rulează în browser, fără AI, fără rețea)

// ---------- culori ----------
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const INK = [15, 23, 42], WHITE = [255, 255, 255];
export const bestTextOn = (bg) => (contrast(INK, bg) >= contrast(WHITE, bg) ? "#0F172A" : "#FFFFFF");

function rgbToLab([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE = (a, b) => { const A = rgbToLab(a), B = rgbToLab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const chroma = (rgb) => { const [, a, b] = rgbToLab(rgb); return Math.hypot(a, b); };
const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
const median = (arr) => { const a = [...arr].sort((p, q) => p - q); return a[a.length >> 1] ?? 0; };

// ---------- separă textul de fundal într-un bloc: 2-means pe luminanță ----------
export function splitTextAndBg(ctx, b) {
  const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
  const w = Math.max(1, Math.min(ctx.canvas.width - x, Math.ceil(b.w)));
  const h = Math.max(1, Math.min(ctx.canvas.height - y, Math.ceil(b.h)));
  const px = ctx.getImageData(x, y, w, h).data;
  const pts = [];
  for (let i = 0; i < px.length; i += 8) pts.push([px[i], px[i + 1], px[i + 2]]);
  const L = pts.map((p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
  let c0 = Infinity, c1 = -Infinity, lab = [];
  for (const v of L) { if (v < c0) c0 = v; if (v > c1) c1 = v; } // fără spread: un bloc mare depășește limita de argumente
  for (let it = 0; it < 6; it++) {
    lab = L.map((v) => (Math.abs(v - c0) <= Math.abs(v - c1) ? 0 : 1));
    const m0 = L.filter((_, i) => lab[i] === 0), m1 = L.filter((_, i) => lab[i] === 1);
    if (m0.length) c0 = m0.reduce((s, v) => s + v, 0) / m0.length;
    if (m1.length) c1 = m1.reduce((s, v) => s + v, 0) / m1.length;
  }
  const g0 = pts.filter((_, i) => lab[i] === 0), g1 = pts.filter((_, i) => lab[i] === 1);
  if (!g0.length || !g1.length) return null;
  const [txt, bg] = g0.length < g1.length ? [g0, g1] : [g1, g0];   // textul ocupă mai puțini pixeli
  const med = (g) => [0, 1, 2].map((k) => median(g.map((p) => p[k])));
  return { text: med(txt), bg: med(bg) };
}

// culoarea dominantă a marginii imaginii = fundalul paginii
export function pageBackground(ctx) {
  const { width: W, height: H } = ctx.canvas, pts = [];
  for (const [x, y] of [[4, 4], [W - 5, 4], [4, H - 5], [W - 5, H - 5], [W >> 1, 4], [4, H >> 1]]) {
    const d = ctx.getImageData(x, y, 1, 1).data; pts.push([d[0], d[1], d[2]]);
  }
  return [0, 1, 2].map((k) => median(pts.map((p) => p[k])));
}

// extinde caseta textului până la marginea butonului (cât timp pixelii au culoarea butonului)
export function expandToShape(ctx, b, fill, max = 220) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const at = (x, y) => { const d = ctx.getImageData(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y)), 1, 1).data; return [d[0], d[1], d[2]]; };
  const isFill = (x, y) => dist(at(x, y), fill) < 60;
  const cy = Math.round(b.y + b.h / 2), cx = Math.round(b.x + b.w / 2);
  let l = Math.floor(b.x), r = Math.ceil(b.x + b.w), t = Math.floor(b.y), btm = Math.ceil(b.y + b.h);
  while (t > 0 && b.y - t < 20 && !isFill(cx, t - 1)) t--;
  while (t > 0 && b.y - t < max && isFill(cx, t - 1)) t--;
  while (btm < H - 1 && btm - (b.y + b.h) < 20 && !isFill(cx, btm + 1)) btm++;
  while (btm < H - 1 && btm - (b.y + b.h) < max && isFill(cx, btm + 1)) btm++;
  const safeY = b.y - t >= 6 ? Math.round((t + b.y) / 2) : cy;
  for (const y of [cy, safeY]) {
    let l0 = Math.floor(b.x), r0 = Math.ceil(b.x + b.w);
    while (l0 > 0 && b.x - l0 < 24 && !isFill(l0 - 1, y)) l0--;
    while (l0 > 0 && b.x - l0 < max && isFill(l0 - 1, y)) l0--;
    while (r0 < W - 1 && r0 - (b.x + b.w) < 24 && !isFill(r0 + 1, y)) r0++;
    while (r0 < W - 1 && r0 - (b.x + b.w) < max && isFill(r0 + 1, y)) r0++;
    if (l0 < l) l = l0;
    if (r0 > r) r = r0;
  }
  return { x: l, y: t, w: r - l, h: btm - t };
}

// procentul de suprafață ocupat de o casetă (bbox/shape) din întreaga imagine (0-100)
export function boxAreaPct(box, W, H) {
  if (!box || !W || !H) return 0;
  return ((Math.max(0, box.w) * Math.max(0, box.h)) / (W * H)) * 100;
}

// ---------- verificările ----------
export function analyze(ctx, blocks, kit, minAreaPct = 0) {
  const issues = [], pageBg = pageBackground(ctx), pal = kit.palette.map(hexToRgb);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const scale = 1080 / W;
  const norm = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const discPrefix = kit.requiredDisclaimer ? norm(kit.requiredDisclaimer).slice(0, 25) : "";
  for (const b of blocks) {
    if (b.fontPx * scale < 18) continue; // ignoră inscripțiile mici din fotografii (ecusoane, ambalaje)
    if (discPrefix && norm(b.text).includes(discPrefix)) continue;
    if (/(?:generat(ă|a)?\s+cu\s+a[il1|]|\bdeepfake)(?![\p{L}\p{N}])/iu.test(b.text)) continue;
    const s = splitTextAndBg(ctx, b.bbox);
    if (!s) continue;
    b.textColor = toHex(s.text); b.bgColor = toHex(s.bg);
    const hasShape = dist(s.bg, pageBg) > 60 && chroma(s.bg) >= 12;
    const shape = hasShape ? expandToShape(ctx, b.bbox, s.bg) : null;
    b.effectiveAreaPct = shape ? Math.max(boxAreaPct(b.bbox, W, H), boxAreaPct(shape, W, H)) : boxAreaPct(b.bbox, W, H);
    if (b.effectiveAreaPct < minAreaPct) continue; // ignoră elementele cu suprafața < x%
    // 1. contrast WCAG
    const ratio = contrast(s.text, s.bg), large = b.fontPx * scale >= 24, min = large ? 3 : 4.5;
    if (ratio < min) issues.push({
      id: `contrast-${b.id}`, axis: "accessibility", severity: "error", blockId: b.id, quote: b.text,
      title: `Contrast ${ratio.toFixed(1)}:1 (minim ${min}:1)`,
      explanation: `„${b.text.slice(0, 38)}” e greu de citit pe ${toHex(s.bg)}.`,
      legalBasis: "WCAG 2.2, criteriul 1.4.3",
      fix: { kind: "textColor", blockId: b.id, hex: bestTextOn(s.bg) },
    });
    // 2. buton / formă în afara paletei: fundalul blocului diferă de fundalul paginii și e colorat
    if (hasShape && shape) {
      const d = pal.map((p) => deltaE(s.bg, p)), dmin = Math.min(...d);
      if (dmin > 20) {
        const target = pal[d.indexOf(dmin)];
        issues.push({
          id: `palette-${b.id}`, axis: "brand", severity: "warning", blockId: b.id, quote: b.text,
          title: `Culoare ${toHex(s.bg)} în afara paletei`,
          explanation: `ΔE ${dmin.toFixed(0)} față de ${toHex(target)} din brand kit.`,
          legalBasis: "Ghid de brand",
          fix: { kind: "fill", blockId: b.id, hex: toHex(target), textHex: bestTextOn(target), shape },
        });
      }
    }
  }
  // 3. disclaimer obligatoriu
  if (kit.requiredDisclaimer) {
    const all = norm(blocks.map((b) => b.text).join(" "));
    if (!all.includes(norm(kit.requiredDisclaimer).slice(0, 30))) issues.push({
      id: "disclaimer", axis: "brand", severity: "warning", title: "Lipsește disclaimerul obligatoriu",
      explanation: kit.requiredDisclaimer, legalBasis: "Ghid de brand", fix: { kind: "disclaimer" },
    });
  }
  return issues;
}

// ---------- AI Act: regula deterministă pentru riscul de deepfake ----------
// Art. 3(60), 50(4): persoane, obiecte, locuri sau evenimente aparent autentice.
// Indiciile vizuale vin din audit; motorul nu detectează singur conținutul imaginii.
export function checkAiAct(disclosure, provenance = {}, labeled = false) {
  if (labeled || !disclosure) return [];
  const aiGenerated = provenance?.aiGenerated === true;
  const realistic = disclosure.photorealistic === true && disclosure.depictsRealPersonLike === true;
  const deepfakeRisk = realistic && (aiGenerated || disclosure.disclosureRequired === true);
  if (deepfakeRisk) return [{
    id: "ai-label", axis: "ai_act", severity: aiGenerated ? "error" : "warning",
    title: aiGenerated ? "Posibil deepfake fără etichetă AI" : "Posibil deepfake: verifică proveniența",
    explanation: (aiGenerated
      ? "Proveniența indică AI, iar analiza vizuală indică un conținut fotorealist care poate fi confundat cu ceva real. Adaugă eticheta vizibilă «DEEPFAKE»."
      : "Analiza vizuală indică un posibil deepfake, dar proveniența AI nu este confirmată. Verifică sursa; dacă imaginea este generată sau manipulată cu AI, adaugă eticheta vizibilă.")
      + " Art. 50(4) se aplică din 2 august 2026; termenul de 2 decembrie privește doar marcarea tehnică a furnizorilor conform art. 50(2).",
    legalBasis: "EU AI Act, art. 3(60) și art. 50(4)", fix: { kind: "label", text: "DEEPFAKE" },
  }];
  if (aiGenerated) return [{
    id: "ai-label", axis: "ai_act", severity: "info",
    title: "Conținut AI: etichetă recomandată, nu obligatorie",
    explanation: "Analiza vizuală nu întrunește criteriile de risc deepfake. Pentru o ilustrație stilizată, eticheta este o recomandare de transparență și nu scade scorul.",
    legalBasis: "Bună practică de transparență; EU AI Act, art. 50(4): deepfake",
    fix: { kind: "label" },
  }];
  return [];
}

// Încadrează textul fără a extinde caseta peste alte elemente.
export function fitTextInBox(ctx, text, { width, height, fontSize, minFontSize = 10, weight = 500 }) {
  if (!(width > 0 && height > 0 && fontSize > 0)) return null;
  for (let size = Math.max(1, fontSize); size >= minFontSize; size -= 0.5) {
    ctx.font = `${weight} ${size}px Poppins, sans-serif`;
    const lines = [];
    let line = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      if (ctx.measureText(word).width > width) { line = null; break; }
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > width) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line === null) continue;
    if (line) lines.push(line);
    if (!lines.length) return null;
    const metrics = lines.map((value) => ctx.measureText(value));
    const ascent = Math.max(...metrics.map((m) => m.actualBoundingBoxAscent ?? size * 0.8));
    const descent = Math.max(...metrics.map((m) => m.actualBoundingBoxDescent ?? size * 0.2));
    const lineHeight = Math.max(size * 1.2, ascent + descent);
    const usedHeight = ascent + descent + (lines.length - 1) * lineHeight;
    if (usedHeight <= height) return { lines, size, ascent, descent, lineHeight, height: usedHeight };
  }
  return null;
}

// ---------- scor ----------
const WEIGHTS = { brand: 0.25, accessibility: 0.25, legal: 0.3, ai_act: 0.2 };
export function score(issues) {
  const axes = {};
  for (const a in WEIGHTS) {
    const open = issues.filter((i) => i.axis === a && !i.fixed);
    const e = open.filter((i) => i.severity === "error").length;
    const w = open.filter((i) => i.severity === "warning").length;
    axes[a] = Math.max(0, 100 - 40 * e - 15 * w);
  }
  const total = Math.round(Object.keys(WEIGHTS).reduce((s, a) => s + axes[a] * WEIGHTS[a], 0));
  return { total, axes };
}
