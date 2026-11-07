import addOnUISdk, { RuntimeType } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";
import { checkContrast, checkPalette, checkDisclaimer, score } from "./engine.js";
import { render, initChips, initCards } from "./render.js";
import KIT from "./brandkit.json";
import "./styles.css";

const API_AUDIT = "https://preflightadapt.web.app/api/audit";
// Citirea C2PA nu e încă în add-on: proveniența e „necunoscută”, deci rămâne doar verdictul vizual al AI-ului.
const provenance = { hasCredentials: false, aiGenerated: false, generator: null, known: false };

const runBtn = document.getElementById("run");
const fixAllBtn = document.getElementById("fixall");
let sandbox, scan, issues = [];
let busy = false, lastScore = null, from = null, fixErrors = [];

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
    if (!d || scan.texts.some((t) => /generat(ă|a)?\s+cu\s+ai/i.test(t.text))) return []; // eticheta există deja
    if (d.disclosureRequired) return [{ axis: "ai_act", severity: provenance.aiGenerated ? "error" : "warning",
        title: "Imagine AI fotorealistă fără etichetă", explanation: d.reasoning,
        legalBasis: "EU AI Act, art. 50(4)", fix: { kind: "label" } }];
    if (provenance.aiGenerated) return [{ axis: "ai_act", severity: "info",
        title: "Conținut AI: etichetă recomandată, nu obligatorie", explanation: d.reasoning,
        legalBasis: "Bună practică (Codul de conduită UE)", fix: { kind: "label" } }];
    return [];
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

// întoarce starea finală de afișat; butoanele se reactivează abia după ce s-a terminat tot
async function verify() {
    scan = await sandbox.scanPage();
    if (!scan.texts.length) { // o imagine plată nu poate fi verificată: nu afișăm un scor fals bun
        issues = [];
        return { noText: true };
    }
    const png = await renderPng();
    const det = [...await checkContrast(png, scan), ...checkPalette(scan, KIT), ...checkDisclaimer(scan, KIT)];
    issues = det;
    show({ issues, aiPending: true }); // rezultatele deterministe apar imediat

    let ai;
    try {
        ai = await callAudit(png);
    } catch (e) {
        console.error(e);
        return { issues, aiError: e.message || String(e) };
    }
    const llm = (ai.issues || []).map((i) => ({ ...i, nodeId: i.blockId,
        fix: !i.needsHumanInput && i.suggestedText && i.blockId
            ? { kind: "replaceText", nodeId: i.blockId, text: i.suggestedText } : null }));
    issues = [...det, ...llm, ...aiActIssues(ai.aiDisclosure)];
    const s = score(issues);
    lastScore = s.total;
    return { issues, score: s, cached: ai.cached };
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

function addPrice(i, price) {
    const node = scan.texts.find((t) => t.id === i.nodeId);
    i.fix = { kind: "replaceText", nodeId: i.nodeId, text: `${node ? node.text : i.quote} (față de ${price})` };
    applyFixes([i]);
}

document.getElementById("kit").textContent = `Brand kit: ${KIT.name}`;
show({ idle: true });
initChips();
initCards({ onFix: (i) => applyFixes([i]), onPrice: addPrice });

addOnUISdk.ready.then(async () => {
    sandbox = await addOnUISdk.instance.runtime.apiProxy(RuntimeType.documentSandbox);
    runBtn.addEventListener("click", () => { from = null; fixErrors = []; runPreflight(); });
    fixAllBtn.addEventListener("click", fixAll);
    runBtn.disabled = false;
});
