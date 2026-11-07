// ---------- culori ----------
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05); };
const INK = [15, 23, 42], WHITE = [255, 255, 255];
export const bestTextOn = (bg) => (contrast(INK, bg) >= contrast(WHITE, bg) ? "#0F172A" : "#FFFFFF");
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

function rgbToLab([r, g, b]) { // sRGB -> CIE Lab (D65)
    [r, g, b] = [r, g, b].map(lin);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722,
        z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    [x, y, z] = [f(x), f(y), f(z)];
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(...rgbToLab(a).map((v, i) => v - rgbToLab(b)[i]));
const chroma = (rgb) => { const [, a, b] = rgbToLab(rgb); return Math.hypot(a, b); };

export function boxAreaPct(box, page) {
    if (!box || !page?.width || !page?.height) return 0;
    return ((Math.max(0, box.w) * Math.max(0, box.h)) / (page.width * page.height)) * 100;
}

// ---------- 1. contrast WCAG pe pixeli reali ----------
export async function checkContrast(pngBlob, scan, minAreaPct = 0) {
    const bmp = await createImageBitmap(pngBlob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const sx = bmp.width / scan.page.width, sy = bmp.height / scan.page.height;
    const issues = [];
    for (const t of scan.texts) {
        if (boxAreaPct(t.bounds, scan.page) < minAreaPct) continue;
        const x = Math.max(0, Math.floor(t.bounds.x * sx)), y = Math.max(0, Math.floor(t.bounds.y * sy));
        const w = Math.max(1, Math.min(bmp.width - x, Math.ceil(t.bounds.w * sx)));
        const h = Math.max(1, Math.min(bmp.height - y, Math.ceil(t.bounds.h * sy)));
        const px = ctx.getImageData(x, y, w, h).data, fg = hexToRgb(t.color);
        const R = [], G = [], B = [];
        for (let i = 0; i < px.length; i += 12) { // 1 din 3 pixeli
            const d = Math.abs(px[i] - fg[0]) + Math.abs(px[i + 1] - fg[1]) + Math.abs(px[i + 2] - fg[2]);
            if (d > 100) { R.push(px[i]); G.push(px[i + 1]); B.push(px[i + 2]); } // doar fundal
        }
        if (R.length < 20) { // text aproape identic cu fundalul sau casetă foarte mică: citim fundalul de pe marginea casetei
            R.length = G.length = B.length = 0;
            for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) {
                if (j && k && j < h - 1 && k < w - 1) continue;
                const i = (j * w + k) * 4; R.push(px[i]); G.push(px[i + 1]); B.push(px[i + 2]);
            }
        }
        const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
        const bg = [med(R), med(G), med(B)];
        const ratio = contrast(fg, bg), min = t.fontSize >= 24 ? 3 : 4.5;
        if (ratio < min) issues.push({
            axis: "accessibility", severity: "error", nodeId: t.id, quote: t.text,
            title: `Contrast ${ratio.toFixed(1)}:1 (minim ${min}:1)`,
            explanation: `Textul „${t.text.slice(0, 40)}” e greu de citit pe fundalul ${toHex(bg)}.`,
            legalBasis: "WCAG 2.2, criteriul 1.4.3",
            fix: { kind: "textColor", nodeId: t.id, hex: bestTextOn(bg) },
        });
    }
    return issues;
}

// ---------- 2. culori în afara paletei (doar forme colorate, ignorăm neutrele și suprafețele < minAreaPct%) ----------
export function checkPalette(scan, kit, minAreaPct = 0) {
    const pal = kit.palette.map(hexToRgb), issues = [];
    for (const s of scan.shapes) {
        if (boxAreaPct(s.bounds, scan.page) < minAreaPct) continue;
        const c = hexToRgb(s.fill);
        if (chroma(c) < 12) continue; // gri/alb/negru: nu sunt "culori de brand"
        const dists = pal.map((p) => deltaE(c, p)), dmin = Math.min(...dists);
        if (dmin <= 20) continue;
        const target = pal[dists.indexOf(dmin)], targetHex = toHex(target);
        const inside = scan.texts.filter((t) => t.bounds.x >= s.bounds.x && t.bounds.y >= s.bounds.y &&
            t.bounds.x + t.bounds.w <= s.bounds.x + s.bounds.w + 1 &&
            t.bounds.y + t.bounds.h <= s.bounds.y + s.bounds.h + 1);
        const textFixes = inside.filter((t) => contrast(hexToRgb(t.color), target) < 4.5)
            .map((t) => ({ nodeId: t.id, hex: bestTextOn(target) }));
        issues.push({ axis: "brand", severity: "warning", nodeId: s.id,
            title: `Culoare ${s.fill} în afara paletei`, explanation: `ΔE ${dmin.toFixed(0)} față de ${targetHex}.`,
            legalBasis: "Ghid de brand", fix: { kind: "fill", nodeId: s.id, hex: targetHex, textFixes } });
    }
    return issues;
}

// ---------- 3. disclaimer obligatoriu din ghid ----------
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export function checkDisclaimer(scan, kit) {
    if (!kit.requiredDisclaimer) return [];
    const ok = scan.texts.some((t) => norm(t.text).includes(norm(kit.requiredDisclaimer).slice(0, 40)));
    return ok ? [] : [{ axis: "brand", severity: "warning", title: "Lipsește disclaimerul obligatoriu",
        explanation: kit.requiredDisclaimer, legalBasis: "Ghid de brand", fix: { kind: "disclaimer" } }];
}

// ---------- 4. scor ----------
const WEIGHTS = { brand: 0.25, accessibility: 0.25, legal: 0.30, ai_act: 0.20 };
export function score(issues) {
    const axes = {};
    for (const a in WEIGHTS) {
        const open = issues.filter((i) => i.axis === a && !i.fixed);
        const e = open.filter((i) => i.severity === "error").length,
            w = open.filter((i) => i.severity === "warning").length;
        axes[a] = Math.max(0, 100 - 40 * e - 15 * w);
    }
    const total = Math.round(Object.keys(WEIGHTS).reduce((s, a) => s + axes[a] * WEIGHTS[a], 0));
    return { total, axes };
}
