// PreFlight: pagina de prezentare. Nu atinge motorul: folosește doar score() din engine.js,
// ca simularea să nu se poată îndepărta de formula reală.
import { score } from "./engine.js";
import { setButtonUnavailable } from "./button-state.js";

// ---------------- configurare ușor de editat ----------------
const ADOBE_EXPRESS_DEMO_URL = "https://new.express.adobe.com/";
const URL_KEY = "preflight.expressUrl";

const ASSETS = {
  a: { url: "demo/vitaboost-postare.png", name: "vitaboost-postare.png", type: "image/png",
       source: { url: "demo/foto_persoana.jpg", name: "foto_persoana.jpg", type: "image/jpeg" } },
  b: { url: "demo/asset-b-brutarie.png", name: "asset-b-brutarie.png", type: "image/png" },
  c: { url: "demo/asset-c-control.png", name: "asset-c-control.png", type: "image/png" },
  person: { url: "demo/foto_persoana.jpg", name: "foto_persoana.jpg", type: "image/jpeg" },
  doctor: { url: "demo/foto_medic.jpg", name: "foto_medic.jpg", type: "image/jpeg" },
};

// ---------------- utilitare ----------------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 960px)");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 });
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fără stocare: câmpul rămâne valabil până la reîncărcare */ } },
};
const scrollBehavior = () => (reduced.matches ? "auto" : "smooth");

document.documentElement.classList.add("ready");

// ---------------- ruta din antet, secțiunea curentă, apariții, butoane magnetice ----------------
function initChrome() {
  const fill = $("#routeFill"), plane = $("#routePlane"), route = $(".route");
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    fill.style.transform = `scaleX(${p})`;
    plane.style.transform = `translateX(${p * (route.clientWidth - 16)}px)`;
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  paint();

  const links = new Map($$("[data-spy]").map((a) => [a.dataset.spy, a]));
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const link = links.get(e.target.id);
      if (!link) continue;
      if (e.isIntersecting) { links.forEach((l) => l.removeAttribute("aria-current")); link.setAttribute("aria-current", "true"); }
      else link.removeAttribute("aria-current");
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$("[data-section]").forEach((s) => spy.observe(s));

  const reveal = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  $$(".passes, .criteria, .law-grid, .plans").forEach((group) => $$(".reveal", group).forEach((el, i) => el.style.setProperty("--d", `${i * 70}ms`)));
  $$(".reveal").forEach((el) => reveal.observe(el));

  if (matchMedia("(pointer: fine)").matches && !reduced.matches) {
    for (const btn of $$(".magnetic")) {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate3d(${dx * 0.12}px, ${dy * 0.22}px, 0)`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.transform = ""; });
    }
  }
}

// ---------------- reclama, clonată din șablon ----------------
function makeAd(label, classes = []) {
  const ad = $("#adTpl").content.firstElementChild.cloneNode(true);
  ad.setAttribute("aria-label", label);
  ad.classList.add(...classes);
  return ad;
}

// ---------------- simularea: reclama + panoul de 320 px ----------------
const CARDS = [
  { id: "contrast", severity: "error", axis: "accessibility", axisLabel: "Accesibilitate", fx: "fx-contrast", hl: "title", areaPct: 5.5,
    title: "Contrast 1,5:1, minimul pentru text mare e 3:1", why: "Titlul #C9C2B8 e greu de citit pe #F3EDE4.", law: "WCAG 2.2, criteriul 1.4.3" },
  { id: "claim", severity: "error", axis: "legal", axisLabel: "Legal", fx: "fx-claim", hl: "title", areaPct: 5.5,
    title: "„Vindecă oboseala în 7 zile!”", why: "Un supliment nu poate pretinde că vindecă o afecțiune.", law: "Reg. (UE) 1169/2011 art. 7(3)", sugg: "Mai multă energie, zi de zi" },
  { id: "ai", severity: "error", axis: "ai_act", axisLabel: "AI Act", fx: "fx-ai", hl: "photo", areaPct: 25.2,
    title: "Imagine AI fotorealistă fără etichetă", why: "Content Credentials o marchează ca AI, iar persoana pare reală.", law: "EU AI Act, art. 50(4)" },
  { id: "sup", severity: "warning", axis: "legal", axisLabel: "Legal", fx: "fx-sup", hl: "sub", areaPct: 2.2,
    title: "„Cel mai bun supliment din România”", why: "Superlativ nedovedit.", law: "Legea 158/2008", sugg: "Formulă cu magneziu și vitamina B6" },
  { id: "cta", severity: "warning", axis: "brand", axisLabel: "Brand", fx: "fx-cta", hl: "cta", areaPct: 3.7,
    title: "CTA #E11D48 în afara paletei", why: "ΔE 48 față de #F97316. Textul trece și el pe #0F172A, contrast 6,4:1.", law: "Ghid de brand" },
  { id: "price", severity: "warning", axis: "legal", axisLabel: "Legal", hl: "deal", human: true, areaPct: 4.1,
    title: "„-70% doar azi”", why: "Lipsește prețul de referință din ultimele 30 de zile.", law: "Dir. 98/6/CE art. 6a, Legea 363/2007" },
];
// Disclaimerul e a șaptea constatare a motorului, dar în dosar e afișat pe cardul 6.
const DISCLAIMER = { id: "disc", severity: "warning", axis: "brand", fx: "fx-disc" };
const AUTO_CARDS = CARDS.filter((c) => !c.human);
const SEV = { error: "EROARE", warning: "ATENȚIE" };
const AXIS_FOR_CARD = (c) => (c.id === "price" ? ["legal", "brand"] : [c.axis]);
const RING_LENGTH = 326.73;
const stateOf = (v) => (v >= 85 ? "ok" : v >= 50 ? "warn" : "bad");

function sanitizePriceNumber(raw) {
  let out = "", hasSep = false;
  for (const ch of String(raw || "")) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if ((ch === "." || ch === ",") && !hasSep) { out += ch; hasSep = true; }
  }
  out = out.replace(/^[0.,]+/, "");
  return out;
}

function initSimulation() {
  const ad = makeAd("Postarea VitaBoost, 1080 × 1080. Se schimbă pe măsură ce aplici reparațiile.");
  $("#simAdSlot").append(ad);
  const list = $("#pfList"), statusEl = $("#pfStatus"), fixBtn = $("#pfFixAll"), ring = $("#pfRing");
  const ringValue = $("#pfRingValue"), scoreEl = $("#pfScore");
  const chips = new Map($$(".pf-chip").map((c) => [c.dataset.axis, c]));
  const tolEl = $("#pfMinArea"), tolVal = $("#pfMinAreaVal"), tolInline = $("#pfMinAreaInline");

  const fixed = new Set();
  let price = null, busy = false, filter = null, raf = 0, asking = false;
  let shown = { total: 0, axes: { brand: 0, accessibility: 0, legal: 0, ai_act: 0 } };

  const minAreaPct = () => Number(tolEl?.value ?? 0.5);
  const inArea = (c) => !c.areaPct || c.areaPct >= minAreaPct();
  const activeCards = () => CARDS.filter(inArea);
  const isFixed = (id) => fixed.has(id);
  const currentScore = () => score([...activeCards(), DISCLAIMER].map((i) => ({ axis: i.axis, severity: i.severity, fixed: isFixed(i.id) })));
  const cardDone = (c) => (c.id === "price" ? isFixed("price") && isFixed("disc") : isFixed(c.id));
  const openCards = () => activeCards().filter((c) => !cardDone(c)).length;
  const openAuto = () => AUTO_CARDS.filter((c) => inArea(c) && !isFixed(c.id)).length;

  function paintScore(s) {
    scoreEl.textContent = Math.round(s.total);
    ring.dataset.state = stateOf(Math.round(s.total));
    ringValue.style.strokeDashoffset = RING_LENGTH * (1 - s.total / 100);
    for (const [axis, chip] of chips) {
      const v = Math.round(s.axes[axis]);
      chip.querySelector("b").textContent = v;
      chip.dataset.state = stateOf(v);
      chip.setAttribute("aria-label", `${chip.querySelector("span").textContent}: ${v} din 100. Filtrează lista.`);
    }
  }
  function animateScore(pop = false) {
    const to = currentScore(), from = shown;
    cancelAnimationFrame(raf);
    shown = to;
    if (reduced.matches) { paintScore(to); return; }
    const t0 = performance.now();
    if (pop) { ring.classList.remove("is-pop"); void ring.getBoundingClientRect(); ring.classList.add("is-pop"); }
    const step = (t) => {
      const q = Math.min(1, (t - t0) / 400), e = 1 - (1 - q) ** 3;
      const mix = (a, b) => a + (b - a) * e;
      paintScore({ total: mix(from.total, to.total), axes: Object.fromEntries(Object.keys(to.axes).map((k) => [k, mix(from.axes[k], to.axes[k])])) });
      if (q < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function setAd() {
    for (const i of [...CARDS, DISCLAIMER]) if (i.fx) ad.classList.toggle(i.fx, isFixed(i.id));
    ad.classList.toggle("fx-price", !!price);
    $(".ad-ref", ad).textContent = price ? `(față de ${price})` : "";
  }

  function cardHtml(c) {
    const done = cardDone(c);
    let action = "";
    if (c.human) {
      if (!isFixed("price") && !asking) action = `<button type="button" class="mini icard-btn" data-ask ${busy ? "disabled" : ""}>Cere</button>`;
    } else if (!done) {
      action = `<button type="button" class="mini icard-btn" data-fix="${c.id}" ${busy ? "disabled" : ""}>Fix</button>`;
    }
    const sub = !c.human ? "" : isFixed("disc")
      ? `<div class="icard-sub is-done"><span>Disclaimerul din ghid a fost adăugat.</span></div>`
      : `<div class="icard-sub"><span>Lipsește și disclaimerul din ghid.</span><button type="button" class="mini" data-fix="disc" ${busy ? "disabled" : ""}>Fix</button></div>`;
    const form = c.human && asking && !isFixed("price")
      ? `<form class="price-form" data-price-form><label for="priceInput">Prețul minim din ultimele 30 de zile</label>
           <div class="price-row"><input id="priceInput" class="price-num" inputmode="decimal" maxlength="16" autocomplete="off" placeholder="ex. 129" /><select id="priceCur" class="price-cur" aria-label="Monedă"><option value="RON">RON</option><option value="EUR">EUR</option><option value="USD">USD</option></select><button type="submit" class="mini">OK</button></div></form>`
      : "";
    const priceDone = c.human && isFixed("price") ? `<p class="sugg" style="display:block">Preț de referință: ${esc(price)}.</p>` : "";
    return `<article class="icard ${done ? "is-fixed" : ""}" data-sev="${c.severity}" data-id="${c.id}" data-hl="${c.hl}" ${visible(c) ? "" : "hidden"}>
      <div class="icard-sev">${done ? "REPARAT" : SEV[c.severity]} • ${c.axisLabel}</div>${action}
      <h3>${esc(c.title)}</h3>
      <p class="why">${esc(c.why)}</p>
      ${c.sugg ? `<p class="sugg">→ „${esc(c.sugg)}”</p>` : ""}
      <p class="icard-law">${esc(c.law)}</p>${form}${sub}${priceDone}
    </article>`;
  }
  const visible = (c) => inArea(c) && (!filter || AXIS_FOR_CARD(c).includes(filter));

  function renderList() {
    list.innerHTML = CARDS.map(cardHtml).join("");
    const f = openAuto();
    const discOpen = !isFixed("disc");
    fixBtn.textContent = busy ? "Aplic modificările…" : f > 1 ? `Fix all (${f} automate)` : f === 1 || discOpen ? "Fix all (1 automat)" : "Nimic de reparat automat";
    setButtonUnavailable(fixBtn, busy || (!f && !discOpen), busy ? "Așteaptă aplicarea modificărilor" : "Nu există probleme de reparat automat");
    fixBtn.setAttribute("aria-busy", busy ? "true" : "false");
    setButtonUnavailable($("#simReset"), busy, "Așteaptă aplicarea modificărilor");
  }
  const problems = (n) => (n === 1 ? "1 problemă deschisă" : `${n} probleme deschise`);

  async function fixAll() {
    if (busy) return;
    const todo = [...AUTO_CARDS.filter(inArea), DISCLAIMER].filter((i) => !isFixed(i.id));
    if (!todo.length) return;
    busy = true;
    renderList();
    statusEl.textContent = "Aplic modificările în Document Sandbox...";
    if (narrow.matches) ad.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    ad.classList.add("is-scanning");
    await wait(reduced.matches ? 0 : 600);
    ad.classList.remove("is-scanning");
    todo.forEach((i) => fixed.add(i.id));
    busy = false;
    setAd();
    renderList();
    animateScore(true);
    const cards = todo.filter((i) => i.id !== "disc").length, disc = todo.some((i) => i.id === "disc");
    statusEl.textContent = !isFixed("price") && inArea(CARDS.find((c) => c.id === "price"))
      ? `${cards === 1 ? "1 problemă reparată" : `${cards} probleme reparate`}${disc ? ", disclaimer adăugat" : ""}. Rămâne prețul de referință, pe care îl știi doar tu.`
      : finalStatus();
    list.scrollTop = 0;
  }
  const finalStatus = () => "Nicio problemă deschisă. Decizia finală rămâne la tine.";

  function fixOne(id) {
    if (busy) return;
    fixed.add(id);
    setAd();
    renderList();
    animateScore();
    const n = openCards();
    statusEl.textContent = n ? problems(n) : finalStatus();
  }

  function submitPrice(value) {
    price = value;
    asking = false;
    fixed.add("price");
    setAd();
    renderList();
    animateScore(true);
    if (narrow.matches) ad.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    const n = openCards();
    statusEl.textContent = n ? problems(n) : finalStatus();
  }

  function reset() {
    if (busy) return;
    fixed.clear();
    price = null; asking = false; filter = null;
    if (tolEl) { tolEl.value = "0.5"; tolVal.textContent = "0.5%"; tolInline.textContent = "0.5"; }
    chips.forEach((c) => c.setAttribute("aria-pressed", "false"));
    setAd();
    renderList();
    animateScore();
    statusEl.textContent = problems(openCards());
    list.scrollTop = 0;
  }

  tolEl?.addEventListener("input", () => {
    const v = tolEl.value;
    if (tolVal) tolVal.textContent = `${v}%`;
    if (tolInline) tolInline.textContent = v;
    renderList();
    animateScore();
    const n = openCards();
    statusEl.textContent = n ? problems(n) : finalStatus();
  });

  // evenimente pe listă: cardurile se redesenează, deci delegăm
  list.addEventListener("click", (e) => {
    const fix = e.target.closest("[data-fix]");
    if (fix) { fixOne(fix.dataset.fix); return; }
    if (e.target.closest("[data-ask]")) {
      asking = true;
      renderList();
      const input = $("#priceInput");
      input.focus();
      input.addEventListener("beforeinput", (ev) => {
        if (ev.data && !/^[0-9.,]+$/.test(ev.data)) ev.preventDefault();
        if (ev.data && /^[0.,]+$/.test(ev.data) && input.selectionStart === 0 && !input.value) ev.preventDefault();
      });
      input.addEventListener("input", () => {
        const cleaned = sanitizePriceNumber(input.value);
        if (input.value !== cleaned) input.value = cleaned;
      });
      input.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { asking = false; renderList(); } });
    }
  });
  list.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-price-form]")) return;
    e.preventDefault();
    const input = $("#priceInput"), cur = $("#priceCur");
    const num = sanitizePriceNumber(input.value).replace(/[.,]$/, "");
    if (!num) { input.focus(); input.setAttribute("aria-invalid", "true"); return; }
    const currency = ["RON", "EUR", "USD"].includes(cur?.value) ? cur.value : "RON";
    submitPrice(`${num} ${currency}`);
  });
  const hover = (e) => {
    const card = e.target.closest?.(".icard");
    if (card && !card.classList.contains("is-fixed")) {
      ad.dataset.hl = card.dataset.hl;
      ad.style.setProperty("--hl", card.dataset.sev === "error" ? "var(--red)" : "var(--amber)");
    } else delete ad.dataset.hl;
  };
  list.addEventListener("pointerover", hover);
  list.addEventListener("focusin", hover);
  list.addEventListener("pointerleave", () => delete ad.dataset.hl);
  list.addEventListener("focusout", () => delete ad.dataset.hl);

  for (const [axis, chip] of chips) {
    chip.addEventListener("click", () => {
      filter = filter === axis ? null : axis;
      chips.forEach((c, a) => c.setAttribute("aria-pressed", String(a === filter)));
      renderList();
    });
  }
  fixBtn.addEventListener("click", fixAll);
  $("#simReset").addEventListener("click", reset);

  // raportul se salvează ca PDF din dialogul de imprimare al browserului
  $("#pfReport").addEventListener("click", () => {
    const s = currentScore();
    const row = (title, law, done) => `<tr><td>${esc(title)}</td><td>${esc(law)}</td><td class="${done ? "ok" : "open"}">${done ? "Reparat" : "Deschis"}</td></tr>`;
    const rows = CARDS.map((c) => row(c.title, c.law, isFixed(c.id))).join("") + row("Disclaimer obligatoriu din ghid", "Ghid de brand", isFixed("disc"));
    const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Raport de conformitate PreFlight - VitaBoost</title><style>
      @page{margin:18mm}body{font:14px/1.5 Inter,Arial,sans-serif;color:#0F172A}h1{font:700 26px Poppins,Arial,sans-serif;margin:0 0 4px}
      .big{font:700 44px Poppins,Arial,sans-serif;margin:16px 0 2px}.muted{color:#475569}table{width:100%;border-collapse:collapse;margin-top:14px}
      th,td{padding:7px 8px;border-bottom:1px solid #E2E8F0;text-align:left;vertical-align:top}th{border-bottom:2px solid #0F172A}.ok{color:#15803D;font-weight:600}.open{color:#B45309;font-weight:600}</style></head><body>
      <h1>Raport de conformitate</h1><div class="muted">Brand kit VitaBoost, ${new Date().toLocaleDateString("ro-RO")}. Generat din simularea de pe pagina PreFlight.</div>
      <div class="big">${s.total} din 100</div>
      <div class="muted">Brand ${s.axes.brand}, Accesibilitate ${s.axes.accessibility}, Legal ${s.axes.legal}, AI Act ${s.axes.ai_act}${price ? `. Preț de referință introdus de om: ${esc(price)}` : ""}.</div>
      <table><thead><tr><th>Problema</th><th>Temei</th><th>Stare</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted" style="margin-top:18px">PreFlight e un instrument de suport decizional, nu consultanță juridică. Semnalează riscul și explică temeiul, iar decizia finală rămâne la om.</p></body></html>`;
    const frame = document.createElement("iframe");
    frame.title = "Raport de conformitate";
    frame.style.cssText = "position:fixed;width:0;height:0;border:0";
    frame.srcdoc = html;
    frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
    document.body.append(frame);
  });

  setAd();
  renderList();
  paintScore(currentScore());
  shown = currentScore();
}

// ---------------- launchpad ----------------
function initLaunchpad() {
  const link = $("#expressLink"), input = $("#urlInput"), hint = $("#urlHint");
  const apply = (url) => { link.href = url; };
  const saved = store.get(URL_KEY);
  apply(saved || ADOBE_EXPRESS_DEMO_URL);
  if (saved) input.value = saved;

  $("#urlForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    hint.classList.remove("is-error");
    if (!value) {
      store.set(URL_KEY, "");
      apply(ADOBE_EXPRESS_DEMO_URL);
      hint.textContent = "Am revenit la linkul implicit Adobe Express.";
      return;
    }
    let url;
    try { url = new URL(value); } catch { url = null; }
    if (!url || !/^https?:$/.test(url.protocol)) {
      hint.classList.add("is-error");
      hint.textContent = "Linkul trebuie să înceapă cu https://.";
      input.focus();
      return;
    }
    store.set(URL_KEY, url.href);
    apply(url.href);
    hint.textContent = "Salvat. Butonul deschide acum acest link.";
  });

  // OPTIONS pe /audit întoarce 204 fără să cheme modelul: un test de viață fără cost
  const dot = $("#pingDot"), text = $("#pingText");
  async function ping() {
    const t0 = performance.now();
    try {
      const r = await fetch("/api/audit", { method: "OPTIONS", cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dot.dataset.state = "ok";
      text.textContent = `Răspunde în ${Math.round(performance.now() - t0)} ms`;
    } catch {
      dot.dataset.state = "fail";
      text.textContent = "Nu răspunde. Folosește simularea.";
    }
  }
  ping();
  setInterval(() => { if (document.visibilityState === "visible") ping(); }, 60000);

  // JSON-ul e pregătit dinainte: scrierea în clipboard trebuie să pornească direct din click
  const copyBtn = $("#copyKit"), copyLabel = copyBtn.textContent;
  const kitText = fetch("brandkit.json").then((r) => r.json()).then((kit) => JSON.stringify(kit, null, 2));
  let kitReady = null;
  kitText.then((t) => { kitReady = t; }).catch((err) => console.warn("brand kit:", err.message));
  const legacyCopy = (text) => {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    const done = document.execCommand("copy");
    ta.remove();
    copyBtn.focus();
    return done;
  };
  copyBtn.addEventListener("click", async () => {
    let ok = false;
    try {
      const text = kitReady ?? await kitText;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
      } else ok = legacyCopy(text);
    } catch (err) { console.warn("brand kit:", err.message); }
    copyBtn.textContent = ok ? "Copiat în clipboard" : "Nu s-a putut copia";
    setTimeout(() => { copyBtn.textContent = copyLabel; }, 2200);
  });
}

// ---------------- sandboxul: aplicația reală, în iframe, fără modificări ----------------
let dragKey = null, toolBusy = false;
let toolRun = null;
const frame = () => $("#toolFrame");
let toolOpener = null;
function openTool() {
  const dialog = $("#toolDialog");
  if (dialog.open) return;
  toolOpener = document.activeElement;
  frame().loading = "eager";
  dialog.showModal();
  document.documentElement.classList.add("tool-open");
}
function closeTool() {
  $("#toolDialog").close();
}

function toolMessage(text, isError = false) {
  const el = $("#toolMsg");
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}
async function toolDoc(signal) {
  const f = frame();
  f.loading = "eager";
  for (let i = 0; i < 150; i++) {
    signal?.throwIfAborted();
    let d = null;
    try { d = f.contentDocument; } catch { d = null; }
    if (d && d.querySelector("#file")?.onchange) return d; // app.js și-a terminat inițializarea
    await wait(100);
  }
  throw new Error("Sandboxul nu s-a încărcat. Reîncarcă pagina sau folosește simularea.");
}
async function toFile({ url, name, type }) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Imaginea ${name} nu s-a găsit (HTTP ${r.status}).`);
  return new File([await r.blob()], name, { type });
}
function setFiles(doc, selector, files) {
  const input = doc.querySelector(selector);
  const dt = new doc.defaultView.DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
}
// așteaptă o rulare completă a aplicației, urmărind textul de stare
function waitForRun(doc, signal, timeout = 120000) {
  const status = doc.querySelector("#status");
  return new Promise((resolve, reject) => {
    let started = false;
    const finish = (fn, arg) => { obs.disconnect(); clearTimeout(timer); signal?.removeEventListener("abort", abort); fn(arg); };
    const abort = () => finish(reject, signal.reason);
    const check = () => {
      const t = status.textContent;
      if (/Citesc|Analizez/.test(t)) started = true;
      if (!started) return;
      const err = doc.querySelector("#issues .card.error .sev")?.textContent.includes("TEHNIC");
      if (err) finish(reject, new Error(doc.querySelector("#issues .card.error b")?.textContent || "Verificarea nu a reușit."));
      else if (/deschis|din cache/.test(t)) finish(resolve);
    };
    const obs = new MutationObserver(check);
    obs.observe(status, { childList: true, characterData: true, subtree: true });
    const timer = setTimeout(() => finish(reject, new Error("Verificarea durează prea mult. Încearcă din nou.")), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function waitForProvenance(doc, signal, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    signal?.throwIfAborted();
    if (/Content Credentials găsite/.test(doc.querySelector("#prov")?.textContent || "")) return;
    await wait(150);
  }
}
const setTestButtons = (off) => $$("[data-test]").forEach((b) => {
  setButtonUnavailable(b, off, "Așteaptă finalizarea testului curent");
});

async function runAsset(key) {
  if (toolBusy) return;
  toolBusy = true;
  const controller = new AbortController();
  toolRun = controller;
  const { signal } = controller;
  setTestButtons(true);
  try {
    openTool();
    toolMessage("Încarc imaginea în sandbox…");
    const doc = await toolDoc(signal);
    signal.throwIfAborted();
    const asset = ASSETS[key];
    const adFile = await toFile(asset);
    signal.throwIfAborted();
    const source = asset.source ? await toFile(asset.source) : null;
    signal.throwIfAborted();
    const first = waitForRun(doc, signal);
    setFiles(doc, "#file", [adFile]);
    toolMessage("Verific reclama…");
    await first;
    signal.throwIfAborted();
    if (source) {
      // postarea exportată nu mai are manifestul: îl citim din imaginea Firefly originală
      toolMessage("Adaug imaginea Firefly originală, pentru Content Credentials…");
      const second = waitForRun(doc, signal);
      setFiles(doc, "#srcfile", [source]);
      await second;
      signal.throwIfAborted();
    }
    toolMessage("");
  } catch (e) {
    if (signal.aborted) return;
    console.error(e);
    toolMessage(`${e.message} Simularea de la începutul paginii merge și fără backend.`, true);
  } finally {
    if (toolRun === controller) {
      toolRun = null;
      toolBusy = false;
      setTestButtons(false);
    }
  }
}

function attachToTool() {
  let doc;
  try { doc = frame().contentDocument; } catch { return; }
  const status = doc?.querySelector("#status");
  if (!status) return;
  // Escape trebuie să închidă și când focusul este în aplicația din iframe.
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeTool(); }
  });
  // cache-ul: starea reală, citită din ultima rulare
  const dot = $("#cacheDot"), text = $("#cacheText");
  new MutationObserver(() => {
    const t = status.textContent;
    if (/din cache/.test(t)) { dot.dataset.state = "ok"; text.textContent = "Activ: ultimul rezultat a venit din cache"; }
    else if (/deschis/.test(t)) { dot.dataset.state = "ok"; text.textContent = "Rezultat salvat pentru următoarea rulare"; }
  }).observe(status, { childList: true, characterData: true, subtree: true });
  // o miniatură trasă din galerie nu aduce fișiere în dataTransfer: o încărcăm noi
  doc.addEventListener("dragover", (e) => { if (dragKey) e.preventDefault(); }, true);
  doc.addEventListener("drop", (e) => {
    if (!dragKey) return;
    e.preventDefault();
    e.stopPropagation();
    doc.querySelectorAll(".over").forEach((el) => el.classList.remove("over"));
    runAsset(dragKey);
  }, true);
}

function initSandbox() {
  $$("[data-open-tool]").forEach((button) => button.addEventListener("click", openTool));
  $("#closeTool").addEventListener("click", closeTool);
  $("#toolDialog").addEventListener("close", () => {
    toolRun?.abort();
    toolRun = null;
    toolBusy = false;
    dragKey = null;
    setTestButtons(false);
    toolMessage("");
    // Un iframe nou elimină imaginea, rezultatele și cererile sesiunii închise.
    const freshFrame = frame().cloneNode(false);
    freshFrame.addEventListener("load", attachToTool);
    frame().replaceWith(freshFrame);
    document.documentElement.classList.remove("tool-open");
    toolOpener?.focus();
  });
  frame().addEventListener("load", attachToTool);
  if (frame().contentDocument?.readyState === "complete") attachToTool();
  $$("[data-test]").forEach((b) => b.addEventListener("click", () => runAsset(b.dataset.test)));
  for (const img of $$("[data-drag]")) {
    const key = Object.keys(ASSETS).find((k) => ASSETS[k].url === img.dataset.drag);
    img.addEventListener("dragstart", (e) => {
      const abs = new URL(img.dataset.drag, location.href).href;
      dragKey = key;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("DownloadURL", `${img.dataset.type}:${img.dataset.name}:${abs}`);
      e.dataTransfer.setData("text/uri-list", abs);
      e.dataTransfer.setData("text/plain", abs);
    });
    img.addEventListener("dragend", () => { dragKey = null; });
  }
}

function selectTab(tab) {
  const tabs = $$('[role="tab"]', tab.parentElement);
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
}
function initTabs() {
  for (const list of $$("[data-tabs]")) {
    const tabs = $$('[role="tab"]', list);
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        selectTab(next);
        next.focus();
      });
    });
  }
}

// ---------------- anatomie: comparație și pini ----------------
function initAnatomy() {
  const cmp = $("#cmp"), range = $("#cmpRange");
  $("#cmpBefore").prepend(makeAd("Postarea VitaBoost înainte de reparații, scor 54."));
  $("#cmpAfter").append(makeAd("Postarea VitaBoost după Fix all, scor 96.", ["fx-contrast", "fx-claim", "fx-sup", "fx-cta", "fx-ai", "fx-disc"]));
  const set = (v) => cmp.style.setProperty("--x", `${v}%`);
  range.addEventListener("input", () => { cmp.classList.remove("is-animating"); set(range.value); });
  const go = (v) => {
    range.value = v;
    cmp.classList.add("is-animating");
    set(v);
    setTimeout(() => cmp.classList.remove("is-animating"), 600);
  };
  $("#cmpShowBefore").addEventListener("click", () => go(100));
  $("#cmpShowAfter").addEventListener("click", () => go(0));

  const hot = (n, on) => {
    $(`.pin[data-pin="${n}"]`)?.classList.toggle("is-hot", on);
    $(`#issuesTable tr[data-row="${n}"]`)?.classList.toggle("is-hot", on);
  };
  for (const row of $$("#issuesTable tr[data-row]")) {
    row.addEventListener("pointerenter", () => hot(row.dataset.row, true));
    row.addEventListener("pointerleave", () => hot(row.dataset.row, false));
  }
  for (const pin of $$(".pin")) {
    const n = pin.dataset.pin;
    pin.addEventListener("pointerenter", () => hot(n, true));
    pin.addEventListener("pointerleave", () => hot(n, false));
    pin.addEventListener("focus", () => hot(n, true));
    pin.addEventListener("blur", () => hot(n, false));
    pin.addEventListener("click", () => $(`#issuesTable tr[data-row="${n}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }));
  }
}

// ---------------- arhitectură: pașii 0 → 4 ----------------
const EDGES = [
  { a: "n0", b: "n1", steps: [0], dir: "h" },
  { a: "n1", b: "n4", steps: [1, 4], dir: "h" },
  { a: "n1", b: "n2", steps: [2], dir: "v", label: "randare PNG" },
  { a: "n2", b: "n3", steps: [3], dir: "v", label: "JPEG + texte + kit" },
  { a: "n3", b: "fs", steps: [3], dir: "h", reverse: true },
  { a: "n3", b: "sm", steps: [3], dir: "h" },
  { a: "n3", b: "ge", steps: [3], dir: "v", label: "prompt + imagine" },
];
const STEPS = [
  { nodes: ["n0", "n1"], text: "<b>0. Poarta C2PA.</b> La încărcare, <code>@contentauth/c2pa-web</code> (WASM) citește Content Credentials din fișierul original, înainte ca o randare nouă să piardă manifestul. Rulează în aplicația web; în add-on urmează." },
  { nodes: ["n1", "n4"], text: "<b>1. Scanare.</b> Panoul cere o randare cu <code>createRenditions()</code>, iar <code>scanPage()</code> citește din document textele exacte, culorile, mărimile și pozițiile. În aplicația web, același pas e făcut de OCR." },
  { nodes: ["n1", "n2"], text: "<b>2. Motor determinist.</b> Contrast WCAG 2.2 pe pixeli reali, cu fundalul estimat ca mediană a pixelilor care nu sunt text, ΔE în spațiul Lab față de paletă, disclaimer și scor. Rulează în browser, cu cost 0 €." },
  { nodes: ["n2", "n3", "fs", "sm", "ge"], text: "<b>3. Audit AI.</b> Gemini răspunde cu <code>responseSchema</code> strictă și temperatura 0,2. Problemele fără citat găsit în document sau fără casetă validă în imagine se elimină. Rezultatul rămâne în cache după SHA-256, iar imaginea nu se stochează." },
  { nodes: ["n1", "n4"], text: "<b>4. Reparare.</b> Fix-urile se aplică direct pe noduri: text, culoare, fill, disclaimer, etichetă AI. Se pot anula cu Undo, iar apoi documentul se verifică din nou, real." },
];

function initArchitecture() {
  const diagram = $("#diagram"), svg = $("#diagramLines"), buttons = $$(".arch-steps button"), text = $("#archText");
  const node = (id) => $(`[data-node="${id}"]`, diagram);
  let current = 0, timer = 0, visibleNow = false, touched = false;

  function draw() {
    const box = diagram.getBoundingClientRect();
    if (getComputedStyle(svg).display === "none" || !box.width) return;
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    const rel = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: (r.left + r.right) / 2 - box.left, cy: (r.top + r.bottom) / 2 - box.top }; };
    let html = `<defs>
      <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8Z" fill="#A5B4FC"/></marker></defs>`;
    EDGES.forEach((e, i) => {
      const A = rel(node(e.a)), B = rel(node(e.b));
      let d, lx, ly;
      if (e.dir === "h") {
        const x1 = e.reverse ? A.l : A.r, x2 = e.reverse ? B.r : B.l;
        d = `M${x1} ${A.cy}C${(x1 + x2) / 2} ${A.cy} ${(x1 + x2) / 2} ${B.cy} ${x2} ${B.cy}`;
      } else {
        const y1 = A.b, y2 = B.t, m = (y1 + y2) / 2;
        d = `M${A.cx} ${y1}C${A.cx} ${m} ${B.cx} ${m} ${B.cx} ${y2}`;
        lx = (A.cx + B.cx) / 2 + 8; ly = m + 4;
      }
      html += `<path data-edge="${i}" d="${d}" marker-end="url(#arrow)"/>`;
      if (e.label) html += `<text data-edge="${i}" x="${lx}" y="${ly}">${e.label}</text>`;
    });
    svg.innerHTML = html;
    mark();
  }
  function mark() {
    const s = STEPS[current];
    $$(".node", diagram).forEach((n) => n.classList.toggle("on", s.nodes.includes(n.dataset.node)));
    $$("[data-edge]", svg).forEach((el) => el.classList.toggle("on", EDGES[+el.dataset.edge].steps.includes(current)));
  }
  function show(i) {
    current = i;
    buttons.forEach((b, n) => b.setAttribute("aria-pressed", String(n === i)));
    text.innerHTML = STEPS[i].text;
    mark();
  }
  const stop = () => { clearInterval(timer); timer = 0; };
  const play = () => {
    if (timer || touched || reduced.matches) return;
    timer = setInterval(() => { if (visibleNow) show((current + 1) % STEPS.length); }, 3600);
  };
  buttons.forEach((b, i) => b.addEventListener("click", () => { touched = true; stop(); show(i); }));
  new IntersectionObserver(([e]) => { visibleNow = e.isIntersecting; if (visibleNow) play(); else stop(); }, { threshold: 0.3 }).observe(diagram);
  new ResizeObserver(draw).observe(diagram);
  document.fonts?.ready.then(draw);
  show(0);
  draw();
}

// ---------------- calculator ----------------
function initCalculator() {
  const range = $("#calcRange");
  const update = () => {
    const assets = +range.value;
    const hours = Math.floor((assets * 20) / 60);         // ~20 min pe asset
    const manual = hours * 25;                            // 25 €/oră
    const plan = assets <= 10 ? { name: "Free", cost: 0 } : assets <= 60 ? { name: "Pro", cost: 19 } : { name: "Agency", cost: 99 };
    $("#calcAssets").textContent = nf.format(assets);
    $("#calcManual").textContent = `${nf.format(manual)} €`;
    $("#calcHours").textContent = nf.format(hours);
    $("#calcPlan").textContent = plan.name;
    $("#calcPlanCost").textContent = `${plan.cost} €`;
    $("#calcInternal").textContent = `${nf.format(assets * 0.02)} €`;
    $("#calcRatio").textContent = plan.cost ? `De ${Math.floor(manual / plan.cost)}× mai ieftin` : "Gratuit, în limita planului Free";
    $("#calcManualBar").style.setProperty("--v", 1);
    $("#calcPlanBar").style.setProperty("--v", plan.cost ? Math.max(0.01, Math.min(1, plan.cost / manual)) : 0);
    range.setAttribute("aria-valuetext", `${nf.format(assets)} reclame pe lună`);
  };
  range.addEventListener("input", update);
  update();
}

initChrome();
initSimulation();
initLaunchpad();
initSandbox();
initTabs();
initAnatomy();
initArchitecture();
initCalculator();
