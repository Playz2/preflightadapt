import addOnUISdk, { RuntimeType } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";
import { boxAreaPct, checkContrast, checkPalette, checkDisclaimer, checkAiAct, score } from "./engine.js";
import { render, initChips, initCards } from "./render.js";
import KIT from "./brandkit.json";
import "./styles.css";

const API_AUDIT = "https://preflightadapt.web.app/api/audit";
// Citirea C2PA nu e încă în add-on: proveniența e „necunoscută”, deci rămâne doar verdictul vizual al AI-ului.
const provenance = { hasCredentials: false, aiGenerated: false, generator: null, known: false };

// Prețul de referință este valid DOAR dacă apare un număr (care nu începe cu 0) însoțit de moneda RON, EUR sau USD
const REF_CURRENCY_RE = /\b[1-9]\d*(?:[.,]\d+)?\s*\(?(?:RON|EUR|USD)\)?\b/i;
const DISCOUNT_RE = /(?:[−\-–]\s*\d+\s*%|reducere\s*(?:de\s*)?\d*\s*%?|\b\d+\s*%\s*(?:reducere|discount|off)|economise[sșş]ti\s+\d+\s*%)/i;
const hasValidCurrencyPrice = (texts) => REF_CURRENCY_RE.test(texts.map((t) => t.text).join(" "));
const isRefPriceIssue = (i) => i.needsHumanInput || /6a|referin[tțţ][aă]/i.test(`${i.legalBasis || ""} ${i.title || ""}`);
function stripInlineRefPrice(text) {
    return (text || "").replace(/\s*\((?:fa[tțţ][aă]\s+de|pre[tțţ][^)]*|de\s+la)[^)]*\)\s*$/i, "").trim();
}
function reconcileRefPriceIssues(llmIssues, texts) {
    if (hasValidCurrencyPrice(texts)) {
        return llmIssues.filter((i) => !isRefPriceIssue(i));
    }
    if (llmIssues.some(isRefPriceIssue)) return llmIssues;
    const discNode = texts.find((t) => DISCOUNT_RE.test(t.text));
    if (!discNode) return llmIssues;
    return [
        ...llmIssues,
        {
            axis: "legal",
            severity: "warning",
            blockId: discNode.id,
            quote: discNode.text,
            title: "Reducere fără preț de referință și monedă (RON/EUR/USD)",
            explanation: "Reducerea trebuie însoțită de cel mai mic preț din ultimele 30 de zile cu moneda RON, EUR sau USD.",
            legalBasis: "Dir. 98/6/CE art. 6a",
            needsHumanInput: true,
            suggestedText: null,
        },
    ];
}

const runBtn = document.getElementById("run");
const fixAllBtn = document.getElementById("fixall");
const minAreaInput = document.getElementById("min-area");
const minAreaVal = document.getElementById("min-area-val");
const minAreaInline = document.getElementById("min-area-inline");
let sandbox, scan, lastPng = null, lastAi = null, issues = [];
let busy = false, lastScore = null, from = null, fixErrors = [], minAreaPct = 0.5;

const show = (state) => render({ ...state, busy, from, fixErrors });

async function renderPng() {
    const [r] = await addOnUISdk.app.document.createRenditions(
        { range: addOnUISdk.constants.Range.currentPage, format: addOnUISdk.constants.RenditionFormat.png },
        addOnUISdk.constants.RenditionIntent.preview
    );
    return r.blob;
}

async function toJpegBase64(blob, maxSide = 1536) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const buf = new Uint8Array(await (await cv.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
}

function aiActIssues(d) {
    const labeled = scan.texts.some((t) => /generat(ă|a)?\s+cu\s+a[il1|](?![\p{L}\p{N}])/iu.test(t.text));
    return checkAiAct(d, provenance, labeled);
}

async function callAudit(png) {
    const res = await fetch(API_AUDIT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            imageBase64: await toJpegBase64(png),
            blocks: scan.texts.map(({ id, text }) => ({ id, text })),
            brandKit: KIT,
            provenance,
        }),
    });
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
}

function isAboveMinArea(i) {
    if (i.blockId || i.nodeId) {
        const id = i.blockId || i.nodeId;
        const t = scan.texts.find((x) => x.id === id);
        if (t && boxAreaPct(t.bounds, scan.page) < minAreaPct) return false;
    }
    if (i.region && Array.isArray(i.region) && i.region.length === 4) {
        const regPct = ((i.region[2] - i.region[0]) * (i.region[3] - i.region[1])) / 10000;
        if (regPct < minAreaPct) return false;
    }
    return true;
}

async function buildFilteredState(png, ai) {
    const det = [...await checkContrast(png, scan, minAreaPct), ...checkPalette(scan, KIT, minAreaPct), ...checkDisclaimer(scan, KIT)];
    const allowedTexts = scan.texts.filter((t) => boxAreaPct(t.bounds, scan.page) >= minAreaPct);
    const adjusted = reconcileRefPriceIssues(ai.issues || [], allowedTexts).filter(isAboveMinArea);
    const fallbackDiscId = allowedTexts.find((t) => DISCOUNT_RE.test(t.text))?.id || allowedTexts[0]?.id || null;
    const llm = adjusted.map((i) => {
        const refIssue = isRefPriceIssue(i);
        const validId = i.blockId && allowedTexts.some((t) => t.id === i.blockId) ? i.blockId : null;
        const targetId = refIssue ? (validId || fallbackDiscId) : validId;
        return {
            ...i,
            needsHumanInput: refIssue && !!targetId,
            nodeId: targetId,
            fix: !refIssue && i.suggestedText && targetId
                ? { kind: "replaceText", nodeId: targetId, text: i.suggestedText } : null,
        };
    });
    issues = [...det, ...llm, ...aiActIssues(ai.aiDisclosure)];
    const s = score(issues);
    lastScore = s.total;
    return { issues, score: s, cached: ai.cached };
}

// întoarce starea finală de afișat; butoanele se reactivează abia după ce s-a terminat tot
async function verify() {
    scan = await sandbox.scanPage();
    if (!scan.texts.length) { // o imagine plată nu poate fi verificată: nu afișăm un scor fals bun
        issues = [];
        return { noText: true };
    }
    const png = await renderPng();
    lastPng = png;
    const det = [...await checkContrast(png, scan, minAreaPct), ...checkPalette(scan, KIT, minAreaPct), ...checkDisclaimer(scan, KIT)];
    issues = det;
    show({ issues, aiPending: true }); // rezultatele deterministe apar imediat

    let ai;
    try {
        ai = await callAudit(png);
        lastAi = ai;
    } catch (e) {
        console.error(e);
        return { issues, aiError: e.message || String(e) };
    }
    return buildFilteredState(png, ai);
}

async function runPreflight() {
    busy = true;
    runBtn.disabled = true;
    lastScore = null;
    show({ loading: true, issues });
    let state;
    try {
        state = await verify();
    } catch (e) {
        console.error(e);
        state = { error: e.message || String(e) };
    }
    busy = false;
    runBtn.disabled = false;
    show(state);
}

async function applyFix(i) {
    const f = i.fix;
    const results = [];
    if (f.kind === "replaceText") results.push(await sandbox.replaceText(f.nodeId, f.text));
    if (f.kind === "textColor") results.push(await sandbox.setTextColor(f.nodeId, f.hex));
    if (f.kind === "fill") {
        results.push(await sandbox.setFill(f.nodeId, f.hex));
        for (const t of f.textFixes) results.push(await sandbox.setTextColor(t.nodeId, t.hex));
    }
    if (f.kind === "disclaimer") await sandbox.addLabel(KIT.requiredDisclaimer, { corner: "bl", size: 14, color: "#334155", bg: null });
    if (f.kind === "label") await sandbox.addLabel("Imagine generată cu AI", { corner: "br", size: 22 });
    if (results.includes(false)) throw new Error("elementul nu mai există în document.");
}

async function applyFixes(list) {
    if (busy || !list.length) return;
    busy = true;
    runBtn.disabled = true;
    from = lastScore;
    fixErrors = [];
    // ordinea contează: întâi textul (rescriere), apoi culoarea aceluiași nod
    const order = ["replaceText", "textColor", "fill", "disclaimer", "label"];
    const todo = [...list].sort((a, b) => order.indexOf(a.fix.kind) - order.indexOf(b.fix.kind));
    for (const i of todo) {
        try {
            await applyFix(i);
            i.fixed = true; // doar corecțiile aplicate efectiv se bifează
        } catch (e) {
            console.error(e);
            fixErrors.push(`„${i.title}”: ${e.message || e}`);
        }
    }
    show({ issues, score: from === null ? null : score(issues) }); // feedback instant: carduri tăiate, scor animat
    await runPreflight(); // re-verificare REALĂ pe documentul modificat
}

const fixAll = () => applyFixes(issues.filter((i) => i.fix && !i.fixed));

function addPrice(i, formattedPriceWithCurrency) {
    const node = scan.texts.find((t) => t.id === i.nodeId);
    const base = stripInlineRefPrice(node ? node.text : i.quote);
    i.fix = { kind: "replaceText", nodeId: i.nodeId, text: `${base} (preț minim 30 zile: ${formattedPriceWithCurrency})` };
    applyFixes([i]);
}

document.getElementById("kit").textContent = `Brand kit: ${KIT.name}`;
show({ idle: true });
initChips();
initCards({ onFix: (i) => applyFixes([i]), onPrice: addPrice });

if (minAreaInput) {
    minAreaInput.addEventListener("input", async (e) => {
        minAreaPct = Number(e.target.value);
        const fmt = Number.isInteger(minAreaPct) ? String(minAreaPct) : minAreaPct.toFixed(1);
        if (minAreaVal) minAreaVal.textContent = `${fmt}%`;
        if (minAreaInline) minAreaInline.textContent = fmt;
        if (scan && lastPng && lastAi && !busy) {
            const state = await buildFilteredState(lastPng, lastAi);
            show(state);
        }
    });
}

addOnUISdk.ready.then(async () => {
    sandbox = await addOnUISdk.instance.runtime.apiProxy(RuntimeType.documentSandbox);
    runBtn.addEventListener("click", () => { from = null; fixErrors = []; runPreflight(); });
    fixAllBtn.addEventListener("click", fixAll);
    runBtn.disabled = false;
});
