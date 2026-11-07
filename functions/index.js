const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { GoogleGenAI, Type } = require("@google/genai");
const vision = require("@google-cloud/vision");
const crypto = require("crypto");

initializeApp();
setGlobalOptions({ region: "europe-west1", memory: "512MiB", timeoutSeconds: 60 });
const db = getFirestore();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const MODELS = [
  { name: "gemini-4-argon", thinkingLevel: "MEDIUM" },
  { name: "gemini-3.8-flash", thinkingLevel: "LOW" },
]; // trebuie să existe pe API v1 (implicit în SDK)
const visionClient = new vision.ImageAnnotatorClient();

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1] || 0; };
function bbox(vertices) {
  const xs = vertices.map((v) => v.x || 0), ys = vertices.map((v) => v.y || 0);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
async function cached(key, compute) {
  const ref = db.collection("cache").doc(key);
  const hit = await ref.get();
  if (hit.exists) return { ...hit.data().result, cached: true };
  const result = await compute();
  await ref.set({ result, at: FieldValue.serverTimestamp() });
  return result;
}
function handler(fn) {
  return async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      res.json(await fn(req.body || {}));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  };
}

// ---------------------------------------------------------------- OCR (Google Cloud Vision)
exports.ocr = onRequest({ cors: true }, handler(async ({ imageBase64 }) => {
  if (!imageBase64) throw new Error("imageBase64 lipsă");
  return cached("ocr-" + sha(imageBase64), async () => {
    const [r] = await visionClient.documentTextDetection({
      image: { content: imageBase64 }, imageContext: { languageHints: ["ro"] },
    });
    const blocks = [];
    for (const page of r.fullTextAnnotation?.pages || []) {
      for (const block of page.blocks || []) {
        for (const p of block.paragraphs || []) {
          const words = p.words || [];
          const text = words.map((w) => (w.symbols || []).map((s) => s.text).join("")).join(" ")
            .replace(/\s+([.,!?;:%)])/g, "$1").replace(/([(„])\s+/g, "$1").trim();
          if (!text) continue;
          const fontPx = median(words.map((w) => bbox(w.boundingBox.vertices).h));
          blocks.push({ id: `b${blocks.length + 1}`, text, bbox: bbox(p.boundingBox.vertices), fontPx });
        }
      }
    }
    return { blocks };
  });
}));

// ---------------------------------------------------------------- Audit AI (Gemini)
const SYSTEM_PROMPT = `Ești PreFlight, auditor de conformitate pentru reclame publicate în România și UE.
Primești: imaginea reclamei, lista blocurilor de text (id + text), brand kit-ul și proveniența (C2PA).

SARCINI
1. LEGAL (axis "legal"), analizând textele primite și ce se vede în IMAGINE:
   - recomandare din partea unui medic sau profesionist din sănătate (în text SAU vizibilă în imagine: halat, „Dr.”, „MD”, ecuson, stetoscop asociat cu produsul)
     -> "error", legalBasis "Reg. (CE) 1924/2006 art. 12(c)"
   - text din IMAGINE (etichete de produs, ecusoane, inscripții) care conține claim-uri problematice -> le tratezi ca pe textele din design
   - urgență artificială („doar azi”, „ultimele bucăți”) fără termen verificabil -> "warning", "Legea 363/2007";
     rescrierea păstrează restul textului și scoate doar urgența. Dacă același text are și reducere, și urgență, raportezi DOUĂ probleme separate.
   - proprietăți de prevenire/tratare/vindecare a bolilor atribuite unui aliment sau supliment
     -> severity "error", legalBasis "Reg. (UE) 1169/2011 art. 7(3)"
   - mențiuni de sănătate neautorizate ("întărește imunitatea", "detoxifiază") -> "warning", "Reg. (CE) 1924/2006"
   - superlative absolute sau afirmații nedovedibile ("cel mai bun", "nr. 1", "garantat") -> "warning", "Legea 158/2008"
   - reducere procentuală fără preț de referință -> "warning", "Dir. 98/6/CE art. 6a",
     needsHumanInput = true, suggestedText = null
2. BRAND (axis "brand"): doar abateri CLARE de la brandKit.tone.
3. aiDisclosure, analizând IMAGINEA:
   photorealistic = arată ca o fotografie reală (nu ilustrație, desen, 3D stilizat)
   depictsRealPersonLike = conține persoane, locuri sau evenimente care pot fi luate drept reale
   disclosureRequired = (provenance.aiGenerated SAU imaginea pare generată cu AI) ȘI photorealistic ȘI depictsRealPersonLike
   reasoning = o propoziție în română

REGULI STRICTE
- "quote" e copiat EXACT dintr-un text primit ("blockId" = id-ul acelui bloc) sau dintr-o inscripție vizibilă în imagine. Pentru o problemă pur vizuală, fără text: quote = "". Nu inventa texte.
- "region": pentru probleme vizibile în imagine, caseta strânsă în jurul elementului concret (ecuson, halat, stetoscop, inscripție), nu a întregii persoane, în coordonate normalizate 0-1000, [ymin, xmin, ymax, xmax]. Altfel null. Nu raporta o problemă din imagine fără region.
- "confidence": "high", "medium" sau "low", cât de sigur ești că problema există.
- NU raporta contrast, culori, fonturi, disclaimere sau etichete AI: le verifică alt modul.
- Dacă nu ești sigur, folosește "warning", nu "error". Fără probleme -> issues: [].
- "explanation": maxim 20 de cuvinte, în română, pentru un marketer.
- "suggestions": 2-3 rescrieri alternative ale ÎNTREGULUI bloc de text, în română, în tonul brandului, fără problema semnalată, fiecare cel mult la fel de lungă ca originalul. "suggestedText" = prima dintre ele. Dacă needsHumanInput e true sau problema nu e într-un bloc primit: suggestions = [], suggestedText = null.
- toneScore: 0-100.`;

const T = Type;
const SCHEMA = {
  type: T.OBJECT,
  properties: {
    issues: { type: T.ARRAY, items: { type: T.OBJECT, properties: {
      axis: { type: T.STRING, enum: ["brand", "legal"] },
      severity: { type: T.STRING, enum: ["error", "warning", "info"] },
      blockId: { type: T.STRING, nullable: true },
      quote: { type: T.STRING },
      title: { type: T.STRING },
      explanation: { type: T.STRING },
      legalBasis: { type: T.STRING },
      suggestedText: { type: T.STRING, nullable: true },
      needsHumanInput: { type: T.BOOLEAN },
      suggestions: { type: T.ARRAY, items: { type: T.STRING } },
      region: { type: T.ARRAY, items: { type: T.INTEGER }, nullable: true },
      confidence: { type: T.STRING, enum: ["high", "medium", "low"] },
    }, required: ["axis", "severity", "quote", "title", "explanation", "suggestions", "region", "confidence"] } },
    aiDisclosure: { type: T.OBJECT, properties: {
      photorealistic: { type: T.BOOLEAN }, depictsRealPersonLike: { type: T.BOOLEAN },
      disclosureRequired: { type: T.BOOLEAN }, reasoning: { type: T.STRING },
    }, required: ["photorealistic", "depictsRealPersonLike", "disclosureRequired", "reasoning"] },
    toneScore: { type: T.INTEGER },
  },
  required: ["issues", "aiDisclosure", "toneScore"],
};

// Reîncercare pentru erorile temporare, apoi modelul de rezervă. Totul încape în limita de 60 s.
const RETRY_SAME_MODEL = new Set([429, 500, 503]);
const ATTEMPTS_PER_MODEL = 2, ATTEMPT_TIMEOUT_MS = 30000, TOTAL_BUDGET_MS = 52000, MIN_ATTEMPT_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateWithRetry(ai, params) {
  const start = Date.now();
  let lastError;
  for (const { name: model, thinkingLevel } of MODELS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const remaining = TOTAL_BUDGET_MS - (Date.now() - start);
      if (remaining < MIN_ATTEMPT_MS) throw lastError || new Error("Timp epuizat pentru audit");
      try {
        return await ai.models.generateContent({ ...params, model, config: { ...params.config,
          thinkingConfig: { thinkingLevel },
          httpOptions: { timeout: Math.min(ATTEMPT_TIMEOUT_MS, remaining) } } });
      } catch (e) {
        lastError = e;
        console.warn(`Gemini ${model}, încercarea ${attempt}: ${e.status || "fără status"} ${e.message}`);
        // fără status = timeout sau rețea; 504 = termen depășit; 404 = model indisponibil: trecem direct la rezervă
        if (!e.status || e.status === 504 || e.status === 404) break;
        if (!RETRY_SAME_MODEL.has(e.status)) throw e; // 400/401/403 nu se rezolvă prin reîncercare
        if (attempt < ATTEMPTS_PER_MODEL) await sleep(1000 * attempt);
      }
    }
  }
  throw lastError;
}

const validRegion = (r) => Array.isArray(r) && r.length === 4 && r.every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)
  && r[0] < r[2] && r[1] < r[3];

// anti-halucinație: păstrăm doar problemele cu citat găsit într-un bloc sau cu o casetă validă în imagine
function cleanIssues(issues, blocks) {
  const out = [];
  for (const i of issues || []) {
    const q = norm(i.quote);
    const b = q ? blocks.find((x) => { const t = norm(x.text); return t && (t.includes(q) || q.includes(t)); }) : null;
    const region = validRegion(i.region) ? i.region : null;
    if (!b && !region) continue;
    const confidence = ["high", "medium", "low"].includes(i.confidence) ? i.confidence : "medium";
    // o problemă incertă nu poate costa cât o eroare sigură
    const severity = confidence === "low" && i.severity === "error" ? "warning" : i.severity;
    const lb = i.legalBasis || "";
    const legalBasis = lb.includes("1169/2011") ? "Reg. (UE) 1169/2011 art. 7(3)"
      : lb.includes("1924/2006") && lb.includes("12(c)") ? "Reg. (CE) 1924/2006 art. 12(c)"
      : lb.includes("1924/2006") ? "Reg. (CE) 1924/2006"
      : lb.includes("158/2008") ? "Legea 158/2008"
      : lb.includes("98/6") ? "Dir. 98/6/CE art. 6a"
      : lb.includes("363/2007") ? "Legea 363/2007"
      : lb || null;
    const isVisualMedic = legalBasis === "Reg. (CE) 1924/2006 art. 12(c)" && !!region;
    // rescrierile se aplică doar pe un bloc existent și nu au voie să fie mai lungi decât el
    let suggestions = [];
    if (b && !i.needsHumanInput && !isVisualMedic) {
      const all = [...new Set([...(i.suggestions || []), i.suggestedText].map((s) => (s || "").trim()).filter(Boolean))];
      const fit = all.filter((s) => s.length <= b.text.length);
      suggestions = fit.length ? fit : all.sort((x, y) => x.length - y.length).slice(0, 1);
    }
    out.push({ ...i, legalBasis, blockId: b && !isVisualMedic ? b.id : null, region, confidence, severity, suggestions,
      suggestedText: suggestions[0] || null,
      needsHumanInput: !!(b && !isVisualMedic && i.needsHumanInput) }); // pe o problemă doar din imagine nu are ce completa omul
  }
  return out;
}

exports.audit = onRequest({ cors: true, secrets: [GEMINI_API_KEY] }, handler(async (body) => {
  const { imageBase64, blocks = [], brandKit = {}, provenance = {} } = body;
  if (!imageBase64) throw new Error("imageBase64 lipsă");
  // la schimbarea prompt-ului sau a schemei crește versiunea, ca să nu primim răspunsuri vechi din cache
  const key = "audit-v5-" + sha(imageBase64 + JSON.stringify(provenance) + (brandKit.name || ""));
  return cached(key, async () => {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const resp = await generateWithRetry(ai, {
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        { text: JSON.stringify({ blocks, brandKit, provenance }) },
      ] }],
      config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json",
                responseSchema: SCHEMA, temperature: 0.2 },
    });
    const out = JSON.parse(resp.text);
    out.issues = cleanIssues(out.issues, blocks);
    return out;
  });
}));

// ---------------------------------------------------------------- Jurnal de audit
exports.log = onRequest({ cors: true }, handler(async (b) => {
  const ref = await db.collection("audits").add({
    kit: b.kit || null, scoreBefore: b.scoreBefore ?? null, scoreAfter: b.scoreAfter ?? null,
    axes: b.axes || {}, provenance: b.provenance || {}, issues: (b.issues || []).slice(0, 50),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
}));
