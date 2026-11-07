import addOnUISdk, { RuntimeType } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";
import { checkContrast, checkPalette, checkDisclaimer, score } from "./engine.js";
import { render, initChips } from "./render.js";
import KIT from "./brandkit.json";
import "./styles.css";

const API_AUDIT = "https://preflightadapt.web.app/api/audit";
// Citirea C2PA nu e încă în add-on: proveniența e „necunoscută”, deci rămâne doar verdictul vizual al AI-ului.
const provenance = { hasCredentials: false, aiGenerated: false, generator: null, known: false };

const runBtn = document.getElementById("run");
let sandbox, scan, issues = [];

async function renderPng() {
    const [r] = await addOnUISdk.app.document.createRenditions(
        { range: addOnUISdk.constants.Range.currentPage, format: addOnUISdk.constants.RenditionFormat.png },
        addOnUISdk.constants.RenditionIntent.preview
    );
    return r.blob;
}

async function toJpegBase64(blob, maxSide = 1024) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const buf = new Uint8Array(await (await cv.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer());
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

async function runPreflight() {
    runBtn.disabled = true;
    render({ loading: true });
    try {
        scan = await sandbox.scanPage();
        if (!scan.texts.length) { // o imagine plată nu poate fi verificată: nu afișăm un scor fals bun
            issues = [];
            render({ noText: true });
            return;
        }
        const png = await renderPng();
        const det = [...await checkContrast(png, scan), ...checkPalette(scan, KIT), ...checkDisclaimer(scan, KIT)];
        issues = det;
        render({ issues, aiPending: true }); // rezultatele deterministe apar imediat

        let ai;
        try {
            ai = await callAudit(png);
        } catch (e) {
            console.error(e);
            render({ issues, aiError: e.message || String(e) });
            return;
        }
        const llm = (ai.issues || []).map((i) => ({ ...i, nodeId: i.blockId,
            fix: !i.needsHumanInput && i.suggestedText && i.blockId
                ? { kind: "replaceText", nodeId: i.blockId, text: i.suggestedText } : null }));
        issues = [...det, ...llm, ...aiActIssues(ai.aiDisclosure)];
        render({ issues, score: score(issues), cached: ai.cached });
    } catch (e) {
        console.error(e);
        render({ error: e.message || String(e) });
    } finally {
        runBtn.disabled = false;
    }
}

document.getElementById("kit").textContent = `Brand kit: ${KIT.name}`;
render({ idle: true });
initChips();

addOnUISdk.ready.then(async () => {
    sandbox = await addOnUISdk.instance.runtime.apiProxy(RuntimeType.documentSandbox);
    runBtn.addEventListener("click", runPreflight);
    runBtn.disabled = false;
});
