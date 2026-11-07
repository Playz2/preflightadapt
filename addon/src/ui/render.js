const $ = (id) => document.getElementById(id);
const SEV = { error: "EROARE", warning: "ATENȚIE", info: "INFO" };
const AX = { brand: "Brand", accessibility: "Accesibilitate", legal: "Legal", ai_act: "AI Act" };
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let shown = 0, last = {}, filter = null;

function animateScore(to) { // numărare 400 ms + culoarea inelului
    const ring = $("ring"), num = $("score"), from = shown, t0 = performance.now();
    ring.style.setProperty("--c", to >= 85 ? "var(--green)" : to >= 50 ? "var(--amber-f)" : "var(--red)");
    shown = to;
    (function step(t) {
        const k = Math.min(1, (t - t0) / 400), v = Math.round(from + (to - from) * k);
        num.textContent = v; ring.style.setProperty("--p", v);
        if (k < 1) requestAnimationFrame(step);
    })(t0);
}

function clearScore() {
    shown = 0;
    $("score").textContent = "-";
    $("ring").style.setProperty("--p", 0);
    for (const chip of document.querySelectorAll(".chip")) { chip.className = "chip"; chip.querySelector("b").textContent = "-"; }
}

function card(i, idx, busy) {
    const off = busy ? " disabled" : "";
    const btn = i.fixed ? "" : i.needsHumanInput ? `<button class="mini" data-price="${idx}"${off}>Cere preț</button>`
        : i.fix ? `<button class="mini" data-fix="${idx}"${off}>Fix</button>` : "";
    const sugg = i.fix?.kind === "replaceText" && !i.fixed ? `<div class="sugg">→ „${esc(i.fix.text)}”</div>` : "";
    const law = i.legalBasis ? `<div class="law">${esc(i.legalBasis)}</div>` : "";
    return `<div class="card ${esc(i.severity)}${i.fixed ? " fixed" : ""}"><div>
        <div class="sev">${SEV[i.severity] || "INFO"} • ${AX[i.axis] || ""}</div>
        <b>${esc(i.title)}</b><div class="why">${esc(i.explanation)}</div>${law}${sugg}</div>${btn}</div>`;
}

const techCard = (title, why) => `<div class="card error"><div><div class="sev">EROARE TEHNICĂ</div>
    <b>${esc(title)}</b><div class="why">${esc(why)}</div></div></div>`;
const SKELETONS = '<div class="skeleton"></div><div class="skeleton"></div>';

// render({ idle, loading, noText, error, issues, aiPending, aiError, score, cached, busy, from, fixErrors })
export function render(o) {
    last = o;
    const list = $("issues"), status = $("status");
    const issues = o.issues || [];
    const open = issues.filter((i) => !i.fixed), done = issues.filter((i) => i.fixed);
    const visible = [...open, ...done].filter((i) => !filter || i.axis === filter);
    let html = visible.map((i) => card(i, issues.indexOf(i), o.busy)).join("");

    if (o.score) {
        if (o.score.total !== shown) animateScore(o.score.total); // la filtrare scorul nu se schimbă, deci nu reluăm animația
        for (const [a, v] of Object.entries(o.score.axes)) {
            const chip = $(`chip-${a}`);
            chip.querySelector("b").textContent = v;
            chip.className = `chip ${v >= 85 ? "ok" : v >= 50 ? "warn" : "bad"}${filter === a ? " active" : ""}`;
        }
        const change = o.from != null && o.from !== o.score.total ? `Scor ${o.from} → ${o.score.total} • ` : "";
        status.textContent = `${change}${open.length} ${open.length === 1 ? "problemă deschisă" : "probleme deschise"}${o.cached ? " • audit AI din cache" : ""}`;
        if (filter && !visible.length) html = `<div class="empty">Nicio problemă pe această axă.</div>`;
        if (!issues.length) html = `<div class="empty">Nicio problemă găsită.</div>`;
    } else {
        if (!o.loading && !o.aiPending) clearScore(); // la re-verificare păstrăm scorul vechi, ca animația să pornească de la el
        status.textContent = "";
    }

    if (o.loading) { // la re-verificare lăsăm cardurile tăiate vizibile până vine rezultatul nou
        html = issues.length ? html + SKELETONS : SKELETONS + SKELETONS;
        status.textContent = issues.length ? "Re-verific documentul…" : "Citesc pagina…";
    }
    if (o.aiPending) { html += SKELETONS; status.textContent = "Analizez claim-urile și imaginea…"; }
    if (o.aiError) {
        html = techCard("Auditul AI nu a răspuns", `Legal și AI Act nu au fost verificate, așa că scorul nu e afișat. ${o.aiError}`) + html;
        status.textContent = "Verificare incompletă";
    }
    if (o.error) html = techCard("Verificarea nu a reușit", o.error);
    if (o.noText) html = `<div class="empty">Nu am găsit texte editabile. Folosește text nativ sau aplicația web.</div>`;
    if (o.idle) html = `<div class="empty">Apasă „Rulează PreFlight” pentru pagina curentă.</div>`;
    if (o.fixErrors?.length) html = techCard("Unele corecții nu s-au aplicat", o.fixErrors.join(" ")) + html;
    list.innerHTML = html;

    const fixable = open.filter((i) => i.fix).length;
    $("fixall").textContent = fixable ? `Fix all (${fixable} automate)` : "Fix all";
    $("fixall").disabled = !fixable || !!o.busy;
}

// butoanele de pe carduri: „Fix” aplică direct, „Cere preț” deschide un câmp pentru omul care decide
export function initCards({ onFix, onPrice }) {
    const list = $("issues");
    list.addEventListener("click", (e) => {
        const fix = e.target.closest("[data-fix]"), ask = e.target.closest("[data-price]");
        if (fix) onFix(last.issues[Number(fix.dataset.fix)]);
        if (!ask) return;
        const input = document.createElement("input");
        input.className = "price";
        input.placeholder = "Preț minim din ultimele 30 de zile, ex. 129 lei";
        input.setAttribute("aria-label", "Preț de referință: prețul minim din ultimele 30 de zile");
        const issue = last.issues[Number(ask.dataset.price)];
        input.addEventListener("keydown", (ev) => {
            if (ev.key === "Escape") render(last);
            if (ev.key === "Enter" && input.value.trim()) onPrice(issue, input.value.trim());
        });
        ask.replaceWith(input);
        input.focus();
    });
}

// click pe chip: filtrează lista după axă; al doilea click scoate filtrul
export function initChips() {
    for (const chip of document.querySelectorAll(".chip")) {
        chip.addEventListener("click", () => {
            filter = filter === chip.dataset.axis ? null : chip.dataset.axis;
            for (const c of document.querySelectorAll(".chip")) c.classList.toggle("active", c.dataset.axis === filter);
            render(last);
        });
    }
}

