import { analyze, score } from "./engine.js";
import { applyFixes } from "./fixer.js";
import { readProvenance, mergeProvenance } from "./provenance.js";

// Pe Firebase Hosting rămâne "" (rewrite /api/* -> funcții).
// Dacă rulezi local cu `npx serve public`, pune aici URL-ul site-ului deployat, ex. "https://proiect.web.app".
const API_BASE = "";

const $ = (s) => document.querySelector(s);
const S = { kit: null, original: null, base: null, current: null, blocks: [], issues: [],
            provenance: { hasCredentials: false, aiGenerated: false, files: [] }, sources: [],
            scoreBefore: null, view: "after", busy: false };

// ---------------- utilitare ----------------
async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0);
  return c;
}
async function toJpegBase64(canvas, maxSide = 1600) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(s), k };
}
async function api(path, body) {
  const r = await fetch(API_BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------------- AI Act: decizia finală (cod), pe baza verdictului vizual (AI) + C2PA ----------------
function aiActIssues(d) {
  const labeled = S.blocks.some((b) => /generat(ă|a)?\s+cu\s+ai/i.test(b.text));
  if (labeled || !d) return [];
  if (d.disclosureRequired) return [{ id: "ai-label", axis: "ai_act", severity: S.provenance.aiGenerated ? "error" : "warning",
    title: "Imagine AI fotorealistă fără etichetă", explanation: d.reasoning,
    legalBasis: "EU AI Act, art. 50(4)", fix: { kind: "label" } }];
  if (S.provenance.aiGenerated) return [{ id: "ai-label", axis: "ai_act", severity: "info",
    title: "Conținut AI: etichetă recomandată, nu obligatorie", explanation: d.reasoning,
    legalBasis: "Bună practică (Codul de conduită UE)", fix: { kind: "label" } }];
  return [];
}

// ---------------- fluxul principal ----------------
async function runPreflight() {
  if (!S.base || S.busy) return;
  S.busy = true; render({ loading: true });
  try {
    const { b64, k } = await toJpegBase64(S.base);
    // 1) OCR: textele și pozițiile lor
    const ocr = await api("/api/ocr", { imageBase64: b64 });
    S.blocks = ocr.blocks.map((b) => ({ ...b, fontPx: b.fontPx / k,
      bbox: { x: b.bbox.x / k, y: b.bbox.y / k, w: b.bbox.w / k, h: b.bbox.h / k } }));
    // 2) motorul determinist: instant
    const ctx = S.base.getContext("2d", { willReadFrequently: true });
    const det = analyze(ctx, S.blocks, S.kit);
    S.issues = det; render({ aiPending: true });
    // 3) auditul AI
    const ai = await api("/api/audit", { imageBase64: b64, blocks: S.blocks.map(({ id, text }) => ({ id, text })),
                                         brandKit: S.kit, provenance: S.provenance });
    const llm = ai.issues.map((i, n) => ({ ...i, id: `llm-${n}`,
      fix: i.needsHumanInput ? { kind: "humanPrice", blockId: i.blockId }
         : i.suggestedText && i.blockId ? { kind: "replaceText", blockId: i.blockId, text: i.suggestedText } : null }));
    S.issues = [...det, ...llm, ...aiActIssues(ai.aiDisclosure)];
    const sc = score(S.issues);
    if (S.scoreBefore === null) S.scoreBefore = sc.total;
    render({ score: sc, cached: ai.cached });
    if (S.base !== S.original) logAudit(sc);
  } catch (e) {
    console.error(e); render({ error: e.message });
  } finally {
    S.busy = false;
    const n = S.issues.filter((i) => i.fix && !i.fixed && i.fix.kind !== "humanPrice").length;
    $("#fixall").disabled = !n;
  }
}

async function fix(list) {
  for (const i of list) i.fixed = true;
  S.current = applyFixes(S.base, S.blocks, S.issues, S.kit);
  S.view = "after";
  render({ score: score(S.issues) });          // feedback instant
  S.base = S.current;                           // re-verificare REALĂ pe imaginea reparată
  await runPreflight();
}
const fixAll = () => fix(S.issues.filter((i) => i.fix && !i.fixed && i.fix.kind !== "humanPrice"));

function logAudit(sc) {
  api("/api/log", { kit: S.kit.name, scoreBefore: S.scoreBefore, scoreAfter: sc.total, axes: sc.axes,
    provenance: S.provenance,
    issues: S.issues.map(({ axis, severity, title, legalBasis = null }) => ({ axis, severity, title, legalBasis })) })
    .catch((e) => console.warn("log:", e.message));
}

// ---------------- încărcare fișiere ----------------
async function loadAd(file) {
  S.original = await fileToCanvas(file); S.base = S.original; S.current = S.original;
  S.issues = []; S.blocks = []; S.scoreBefore = null;
  S.sources = [await readProvenance(file)];
  S.provenance = mergeProvenance(S.sources);
  $("#empty").hidden = true; $("#stage").hidden = false;
  render({});
  runPreflight();
}
async function addSources(files) {
  for (const f of files) S.sources.push(await readProvenance(f));
  S.provenance = mergeProvenance(S.sources);
  render({});
}

// ---------------- randare ----------------
const SEV = { error: "EROARE", warning: "ATENȚIE", info: "INFO" };
const AX = { brand: "Brand", accessibility: "Accesibilitate", legal: "Legal", ai_act: "AI Act" };
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function drawStage() {
  const src = S.view === "before" ? S.original : S.current;
  if (!src) return;
  const c = $("#view"); c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d"); ctx.drawImage(src, 0, 0);
  if (S.view === "after" && S.current === S.base) {          // marcaje de diagnostic
    const k = src.width / 1080;
    S.issues.filter((i) => !i.fixed && i.blockId).forEach((i, n) => {
      const b = S.blocks.find((x) => x.id === i.blockId); if (!b) return;
      const col = i.severity === "error" ? "#B91C1C" : i.severity === "warning" ? "#B45309" : "#4338CA";
      ctx.strokeStyle = col; ctx.lineWidth = 3 * k; ctx.setLineDash([8 * k, 5 * k]);
      ctx.strokeRect(b.bbox.x - 6 * k, b.bbox.y - 6 * k, b.bbox.w + 12 * k, b.bbox.h + 12 * k);
      ctx.setLineDash([]); ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(b.bbox.x - 6 * k, b.bbox.y - 6 * k, 14 * k, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `700 ${16 * k}px Poppins`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(n + 1), b.bbox.x - 6 * k, b.bbox.y - 5 * k); ctx.textAlign = "start";
    });
  }
}

let shown = 0;
function animateScore(to) {
  const ring = $("#ring"), num = $("#score"), from = shown, t0 = performance.now();
  const col = to >= 85 ? "var(--green)" : to >= 50 ? "var(--amber-f)" : "var(--red)";
  ring.style.setProperty("--c", col);
  (function step(t) {
    const q = Math.min(1, (t - t0) / 600), v = Math.round(from + (to - from) * (1 - (1 - q) ** 3));
    num.textContent = v; ring.style.setProperty("--p", v);
    if (q < 1) requestAnimationFrame(step); else shown = to;
  })(t0);
}

function render(o) {
  drawStage();
  const p = S.provenance;
  $("#prov").innerHTML = !S.original ? "" : p.hasCredentials
    ? `<b>Content Credentials găsite</b>${p.aiGenerated ? " • <b>generat cu AI</b>" : ""}${p.validated ? "" : " (detecție, nevalidat)"}${p.generator ? ` • ${esc(p.generator)}` : ""}`
    : "Fără Content Credentials. Adaugă imaginile sursă pentru verificare.";
  const list = $("#issues"); list.innerHTML = "";
  if (o.loading) { list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; $("#status").textContent = "Citesc textele din imagine…"; }
  if (o.error) { list.innerHTML = `<div class="card error"><div><div class="sev">EROARE TEHNICĂ</div><b>${esc(o.error)}</b></div></div>`; $("#status").textContent = ""; }
  const open = S.issues.filter((i) => !i.fixed), done = S.issues.filter((i) => i.fixed);
  [...open, ...done].forEach((i) => {
    const el = document.createElement("div");
    el.className = `card ${i.severity}${i.fixed ? " fixed" : ""}`;
    const btn = i.fixed ? "" : i.fix?.kind === "humanPrice" ? '<button class="mini">Adaugă preț</button>' : i.fix ? '<button class="mini">Fix</button>' : "";
    el.innerHTML = `<div><div class="sev">${SEV[i.severity]} • ${AX[i.axis]}</div><b>${esc(i.title)}</b>
      <div class="why">${esc(i.explanation)}</div>${i.legalBasis ? `<div class="law">${esc(i.legalBasis)}</div>` : ""}
      ${i.fix?.kind === "replaceText" && !i.fixed ? `<div class="sugg">→ „${esc(i.fix.text)}”</div>` : ""}</div>${btn}`;
    const b = el.querySelector("button");
    if (b && i.fix.kind === "humanPrice") b.onclick = () => {
      el.querySelector(".mini").outerHTML = '<input class="price" placeholder="Preț minim 30 zile, ex. 129 lei">';
      const inp = el.querySelector(".price"); inp.focus();
      inp.onkeydown = (e) => { if (e.key === "Enter" && inp.value.trim()) {
        const blk = S.blocks.find((x) => x.id === i.blockId);
        i.fix = { kind: "replaceText", blockId: i.blockId, text: `${blk ? blk.text : i.quote} (față de ${inp.value.trim()})` };
        fix([i]);
      } };
    };
    else if (b) b.onclick = () => fix([i]);
    list.appendChild(el);
  });
  if (o.aiPending) { list.insertAdjacentHTML("beforeend", '<div class="skeleton"></div><div class="skeleton"></div>'); $("#status").textContent = "Analizez claim-urile și imaginea cu AI…"; }
  if (o.score) {
    animateScore(o.score.total);
    for (const [a, v] of Object.entries(o.score.axes)) {
      const chip = $(`#chip-${a}`); chip.querySelector("b").textContent = v;
      chip.className = `chip ${v >= 85 ? "ok" : v >= 50 ? "warn" : "bad"}`;
    }
    $("#status").textContent = o.cached ? "Rezultat din cache (aceeași imagine)" : `${open.length} probleme deschise`;
  }
  const fixable = open.filter((i) => i.fix && i.fix.kind !== "humanPrice").length;
  $("#fixall").disabled = !fixable || S.busy; $("#fixall").textContent = fixable ? `Fix all (${fixable} automate)` : "Nimic de reparat automat";
  $("#before").classList.toggle("on", S.view === "before"); $("#after").classList.toggle("on", S.view === "after");
}

// ---------------- evenimente ----------------
function dropzone(el, cb) {
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("over"); cb([...e.dataTransfer.files]); });
}
(async function init() {
  S.kit = await (await fetch("brandkit.json")).json();
  $("#kit").textContent = `Brand kit: ${S.kit.name}`;
  dropzone($("#empty"), (f) => loadAd(f[0]));
  dropzone($("#sources"), addSources);
  $("#file").onchange = (e) => loadAd(e.target.files[0]);
  $("#srcfile").onchange = (e) => addSources([...e.target.files]);
  $("#run").onclick = () => { S.base = S.current; runPreflight(); };
  $("#fixall").onclick = fixAll;
  $("#before").onclick = () => { S.view = "before"; render({}); };
  $("#after").onclick = () => { S.view = "after"; render({}); };
  $("#download").onclick = () => S.current.toBlob((b) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "preflight-aprobat.png"; a.click();
  });
  $("#reset").onclick = () => { S.current = S.base = S.original; S.issues = []; S.scoreBefore = null; shown = 0; runPreflight(); };
})();
