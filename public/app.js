import { analyze, boxAreaPct, checkAiAct, score } from "./engine.js";
import { applyFixes } from "./fixer.js";
import { readProvenance, mergeProvenance } from "./provenance.js";
import { setButtonUnavailable } from "./button-state.js";

// Pe Firebase Hosting rămâne "" (rewrite /api/* -> funcții).
// Dacă rulezi local cu `npx serve public`, pune aici URL-ul site-ului deployat, ex. "https://proiect.web.app".
const API_BASE = "";

const $ = (s) => document.querySelector(s);
const S = { kit: null, original: null, base: null, current: null, blocks: [], issues: [],
            llmIssues: [], aiDisclosure: null, cached: false, minAreaPct: 0.5,
            provenance: { hasCredentials: false, aiGenerated: false, files: [] }, sources: [],
            scoreBefore: null, view: "after", busy: false, labelApplied: false };

// ---------------- utilitare ----------------
async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0);
  return c;
}
async function toJpegBase64(canvas, maxSide = 1536) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
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

// Prețul de referință este valid DOAR dacă apare un număr (care nu începe cu 0) însoțit de moneda RON, EUR sau USD
const CURRENCIES = ["RON", "EUR", "USD"];
const REF_CURRENCY_RE = /\b[1-9]\d*(?:[.,]\d+)?\s*\(?(?:RON|EUR|USD)\)?\b/i;
const DISCOUNT_RE = /(?:[−\-–]\s*\d+\s*%|reducere\s*(?:de\s*)?\d*\s*%?|\b\d+\s*%\s*(?:reducere|discount|off)|economise[sșş]ti\s+\d+\s*%)/i;

function hasValidCurrencyPrice(blocks) {
  return REF_CURRENCY_RE.test(blocks.map((b) => b.text).join(" "));
}

function sanitizePriceNumber(val) {
  const cleaned = String(val || "").replace(/[^0-9.,]/g, "").replace(/^[0.,]+/, "");
  const sepIdx = cleaned.search(/[.,]/);
  if (sepIdx === -1) return cleaned;
  const intPart = cleaned.slice(0, sepIdx);
  const decPart = cleaned.slice(sepIdx + 1).replace(/[.,]/g, "");
  return `${intPart}${cleaned[sepIdx]}${decPart}`;
}

function stripInlineRefPrice(text) {
  return (text || "").replace(/\s*\((?:fa[tțţ][aă]\s+de|pre[tțţ][^)]*|de\s+la)[^)]*\)\s*$/i, "").trim();
}

function isRefPriceIssue(i) {
  return i.needsHumanInput || /6a|referin[tțţ][aă]/i.test(`${i.legalBasis || ""} ${i.title || ""}`);
}

function reconcileRefPriceIssues(llmIssues, blocks) {
  if (hasValidCurrencyPrice(blocks)) {
    return llmIssues.filter((i) => !isRefPriceIssue(i));
  }
  const hasFlag = llmIssues.some(isRefPriceIssue);
  if (hasFlag) return llmIssues;
  const discBlock = blocks.find((b) => DISCOUNT_RE.test(b.text));
  if (!discBlock) return llmIssues;
  return [
    ...llmIssues,
    {
      axis: "legal",
      severity: "warning",
      blockId: discBlock.id,
      quote: discBlock.text,
      title: "Reducere fără preț de referință și monedă (RON/EUR/USD)",
      explanation: "Reducerea trebuie însoțită de cel mai mic preț din ultimele 30 de zile cu moneda RON, EUR sau USD.",
      legalBasis: "Dir. 98/6/CE art. 6a",
      needsHumanInput: true,
      suggestedText: null,
    },
  ];
}

function blockPct(b, W, H) {
  return b.effectiveAreaPct ?? boxAreaPct(b.bbox, W, H);
}

// verifică dacă un issue vizează un element (bloc OCR sau regiune vizuală) cu suprafața >= S.minAreaPct%
function isAboveMinArea(i, W, H) {
  if (i.blockId) {
    const b = S.blocks.find((x) => x.id === i.blockId);
    if (b && blockPct(b, W, H) < S.minAreaPct) return false;
  }
  if (i.region && Array.isArray(i.region) && i.region.length === 4) {
    const regPct = ((i.region[2] - i.region[0]) * (i.region[3] - i.region[1])) / 10000;
    if (regPct < S.minAreaPct) return false;
  }
  return true;
}

// recalculează lista de probleme ignorând elementele cu suprafața < S.minAreaPct% din pagină
function recomputeIssues() {
  if (!S.base) return null;
  const W = S.base.width, H = S.base.height;
  const ctx = S.base.getContext("2d", { willReadFrequently: true });
  const det = analyze(ctx, S.blocks, S.kit, S.minAreaPct);
  const allowedBlocks = S.blocks.filter((b) => blockPct(b, W, H) >= S.minAreaPct);
  const adjusted = reconcileRefPriceIssues(S.llmIssues || [], allowedBlocks)
    .filter((i) => isAboveMinArea(i, W, H));
  const fallbackDiscId = allowedBlocks.find((b) => DISCOUNT_RE.test(b.text))?.id || allowedBlocks[0]?.id || null;
  const llm = adjusted.map((i, n) => {
    const visualOnly = i.legalBasis?.includes("12(c)") && i.region;
    const refIssue = !visualOnly && isRefPriceIssue(i);
    const validId = !visualOnly && i.blockId && allowedBlocks.some((b) => b.id === i.blockId) ? i.blockId : null;
    const targetId = refIssue ? (validId || fallbackDiscId) : validId;
    return {
      ...i,
      id: `llm-${n}`,
      blockId: targetId,
      fix: visualOnly ? null
         : refIssue && targetId ? { kind: "humanPrice", blockId: targetId }
         : i.suggestedText && targetId ? { kind: "replaceText", blockId: targetId, text: i.suggestedText } : null,
    };
  });
  S.issues = [...det, ...llm, ...aiActIssues(S.aiDisclosure)];
  return score(S.issues);
}

// ---------------- AI Act: decizia finală (cod), pe baza verdictului vizual (AI) + C2PA ----------------
function aiActIssues(d) {
  const labeled = S.blocks.some((b) => /generat(ă|a)?\s+cu\s+a[il1|](?![\p{L}\p{N}])/iu.test(b.text));
  return checkAiAct(d, S.provenance, S.labelApplied || labeled);
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
    const det = analyze(ctx, S.blocks, S.kit, S.minAreaPct);
    S.issues = det; render({ aiPending: true });
    // 3) auditul AI
    const ai = await api("/api/audit", { imageBase64: b64, blocks: S.blocks.map(({ id, text }) => ({ id, text })),
                                         brandKit: S.kit, provenance: S.provenance });
    S.llmIssues = ai.issues || [];
    S.aiDisclosure = ai.aiDisclosure;
    S.cached = !!ai.cached;
    const sc = recomputeIssues();
    if (S.scoreBefore === null) S.scoreBefore = sc.total;
    render({ score: sc, cached: S.cached });
    if (S.base !== S.original) logAudit(sc);
  } catch (e) {
    console.error(e); render({ error: e.message });
  } finally {
    S.busy = false;
    setButtonUnavailable($("#new-image"), false);
    const n = S.issues.filter((i) => i.fix && !i.fixed && i.fix.kind !== "humanPrice").length;
    setButtonUnavailable($("#fixall"), !n, "Nu există probleme de reparat automat");
  }
}

async function fix(list) {
  if (S.busy) return;
  await Promise.all([400, 500, 600, 700].map((w) => document.fonts?.load(w + " 24px Poppins")).concat(document.fonts?.ready));
  for (const i of list) {
    i.fixed = true;
    if (i.fix?.kind === "label") S.labelApplied = true;
  }
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
  if (!file || S.busy) return;
  S.busy = true;
  setButtonUnavailable($("#new-image"), true, "Așteaptă încărcarea imaginii");
  try {
    const original = await fileToCanvas(file);
    const source = await readProvenance(file);
    S.original = S.base = S.current = original;
    S.issues = []; S.blocks = []; S.llmIssues = []; S.aiDisclosure = null; S.scoreBefore = null; S.labelApplied = false;
    S.sources = [source]; S.provenance = mergeProvenance(S.sources);
    S.cached = false; S.view = "after"; shown = 0;
    cancelAnimationFrame(scoreFrame);
    $("#srcfile").value = "";
    $("#score").textContent = "-";
    $("#ring").style.removeProperty("--p");
    $("#ring").style.removeProperty("--c");
    for (const axis of Object.keys(AX)) {
      const chip = $(`#chip-${axis}`);
      chip.querySelector("b").textContent = "-";
      chip.className = "chip";
    }
    $("#empty").hidden = true; $("#stage").hidden = false;
    S.busy = false;
    await runPreflight();
  } catch (e) {
    render({ error: `Imaginea nu a putut fi încărcată: ${e.message}` });
  } finally {
    S.busy = false;
    setButtonUnavailable($("#new-image"), false);
  }
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
    S.issues.filter((i) => !i.fixed && (i.blockId || i.region)).forEach((i, n) => {
      const b = i.blockId ? S.blocks.find((x) => x.id === i.blockId) : null;
      const r = !b && i.region ? {
        x: (i.region[1] / 1000) * src.width,
        y: (i.region[0] / 1000) * src.height,
        w: ((i.region[3] - i.region[1]) / 1000) * src.width,
        h: ((i.region[2] - i.region[0]) / 1000) * src.height,
      } : b?.bbox;
      if (!r) return;
      const col = i.severity === "error" ? "#B91C1C" : i.severity === "warning" ? "#B45309" : "#4338CA";
      ctx.strokeStyle = col; ctx.lineWidth = 3 * k; ctx.setLineDash([8 * k, 5 * k]);
      ctx.strokeRect(r.x - 6 * k, r.y - 6 * k, r.w + 12 * k, r.h + 12 * k);
      ctx.setLineDash([]); ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(r.x - 6 * k, r.y - 6 * k, 14 * k, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `700 ${16 * k}px Poppins`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(n + 1), r.x - 6 * k, r.y - 5 * k); ctx.textAlign = "start";
    });
  }
}

let shown = 0, scoreFrame = 0;
function animateScore(to) {
  cancelAnimationFrame(scoreFrame);
  const ring = $("#ring"), num = $("#score"), from = shown, t0 = performance.now();
  const col = to >= 85 ? "var(--green)" : to >= 50 ? "var(--amber-f)" : "var(--red)";
  ring.style.setProperty("--c", col);
  (function step(t) {
    const q = Math.max(0, Math.min(1, (t - t0) / 600)), v = Math.round(from + (to - from) * (1 - (1 - q) ** 3));
    num.textContent = v; ring.style.setProperty("--p", v);
    if (q < 1) scoreFrame = requestAnimationFrame(step); else shown = to;
  })(t0);
}

function attachPriceInputs(el, i) {
  const btn = el.querySelector(".mini");
  if (!btn) return;
  btn.remove();
  const row = document.createElement("div");
  row.className = "price-row";
  row.innerHTML = `<input type="text" inputmode="decimal" class="price-num" placeholder="Preț minim 30 zile (ex: 129)" aria-label="Valoare preț de referință">`
    + `<select class="price-cur" aria-label="Monedă">${CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>`
    + `<button type="button" class="mini price-ok">OK</button>`;
  el.appendChild(row);

  const numInp = row.querySelector(".price-num");
  const curSel = row.querySelector(".price-cur");
  const okBtn = row.querySelector(".price-ok");
  numInp.focus();

  numInp.addEventListener("beforeinput", (e) => {
    if (!e.data) return;
    if (/[^0-9.,]/.test(e.data)) { e.preventDefault(); return; }
    const start = numInp.selectionStart ?? numInp.value.length;
    const end = numInp.selectionEnd ?? numInp.value.length;
    const nextVal = numInp.value.slice(0, start) + e.data + numInp.value.slice(end);
    if (/^[0.,]/.test(nextVal)) e.preventDefault();
  });
  numInp.addEventListener("input", () => {
    const clean = sanitizePriceNumber(numInp.value);
    if (numInp.value !== clean) numInp.value = clean;
  });

  const submit = () => {
    const num = sanitizePriceNumber(numInp.value).replace(/^[0.,]+|[.,]+$/g, "");
    const val = parseFloat(num.replace(",", "."));
    if (!num || /^[0.,]/.test(num) || !Number.isFinite(val) || val <= 0) {
      numInp.focus();
      return;
    }
    const cur = CURRENCIES.includes(curSel.value) ? curSel.value : "RON";
    const blk = S.blocks.find((x) => x.id === i.blockId);
    const cleanText = stripInlineRefPrice(blk ? blk.text : i.quote);
    i.fix = { kind: "refPrice", blockId: i.blockId, cleanText, text: `Preț minim 30 zile: ${num} ${cur}` };
    fix([i]);
  };

  const onKey = (e) => {
    if (e.key === "Escape") render({ score: score(S.issues) });
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  };
  numInp.addEventListener("keydown", onKey);
  curSel.addEventListener("keydown", onKey);
  okBtn.addEventListener("click", submit);
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
    const bRef = i.blockId ? S.blocks.find((x) => x.id === i.blockId) : null;
    const areaTag = bRef && S.base ? ` • ${blockPct(bRef, S.base.width, S.base.height).toFixed(1)}% suprafață` : "";
    el.innerHTML = `<div><div class="sev">${SEV[i.severity]} • ${AX[i.axis]}${areaTag}</div><b>${esc(i.title)}</b>
      <div class="why">${esc(i.explanation)}</div>${i.legalBasis ? `<div class="law">${esc(i.legalBasis)}</div>` : ""}
      ${i.fix?.kind === "replaceText" && !i.fixed ? `<div class="sugg">→ „${esc(i.fix.text)}”</div>` : ""}</div>${btn}`;
    const b = el.querySelector("button");
    if (b && i.fix.kind === "humanPrice") b.onclick = () => attachPriceInputs(el, i);
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
    $("#status").textContent = o.cached ? "Rezultat din cache (aceeași imagine)" : open.length === 1 ? "1 problemă deschisă" : `${open.length} probleme deschise`;
  }
  const fixable = open.filter((i) => i.fix && i.fix.kind !== "humanPrice").length;
  setButtonUnavailable($("#fixall"), !fixable || S.busy, S.busy ? "Așteaptă finalizarea verificării" : "Nu există probleme de reparat automat");
  $("#fixall").textContent = fixable ? `Fix all (${fixable} ${fixable === 1 ? "automat" : "automate"})` : "Nimic de reparat automat";
  setButtonUnavailable($("#new-image"), S.busy, "Așteaptă finalizarea verificării");
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
  $("#new-image").onclick = () => {
    if (S.busy) return;
    $("#file").value = ""; // permite și selectarea aceluiași fișier
    $("#file").click();
  };
  $("#srcfile").onchange = (e) => addSources([...e.target.files]);
  const minAreaEl = $("#min-area");
  if (minAreaEl) {
    minAreaEl.oninput = (e) => {
      S.minAreaPct = Number(e.target.value);
      const fmt = Number.isInteger(S.minAreaPct) ? String(S.minAreaPct) : S.minAreaPct.toFixed(1);
      $("#min-area-val").textContent = `${fmt}%`;
      $("#min-area-inline").textContent = fmt;
      if (S.base && !S.busy && S.blocks.length) {
        const sc = recomputeIssues();
        render({ score: sc, cached: S.cached });
      }
    };
  }
  $("#run").onclick = () => { S.base = S.current; runPreflight(); };
  $("#fixall").onclick = fixAll;
  $("#before").onclick = () => { S.view = "before"; render({}); };
  $("#after").onclick = () => { S.view = "after"; render({}); };
  $("#download").onclick = () => S.current.toBlob((b) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "preflight-aprobat.png"; a.click();
  });
  $("#reset").onclick = () => { S.current = S.base = S.original; S.issues = []; S.llmIssues = []; S.aiDisclosure = null; S.scoreBefore = null; S.labelApplied = false; shown = 0; runPreflight(); };
})();
