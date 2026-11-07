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
const MODEL = "gemini-3.8-flash"; // <- pune numele
const FALLBACK_MODEL = "gemini-3.7-flash"; // trebuie să existe pe API v1 (implicit în SDK)
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
1. LEGAL (axis "legal"), analizând DOAR textele primite:
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
- "quote" e copiat EXACT dintr-un text primit; "blockId" e id-ul acelui bloc. Nu inventa texte.
- NU raporta contrast, culori, fonturi, disclaimere sau etichete AI: le verifică alt modul.
- Dacă nu ești sigur, folosește "warning", nu "error". Fără probleme -> issues: [].
- "explanation": maxim 20 de cuvinte, în română, pentru un marketer.
- "suggestedText": rescriere în română, în tonul brandului, fără problema semnalată, cel mult la fel de lungă ca originalul.
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
    }, required: ["axis", "severity", "quote", "title", "explanation"] } },
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
  for (const model of [MODEL, FALLBACK_MODEL]) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const remaining = TOTAL_BUDGET_MS - (Date.now() - start);
      if (remaining < MIN_ATTEMPT_MS) throw lastError || new Error("Timp epuizat pentru audit");
      try {
        return await ai.models.generateContent({ ...params, model, config: { ...params.config,
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

exports.audit = onRequest({ cors: true, secrets: [GEMINI_API_KEY] }, handler(async (body) => {
  const { imageBase64, blocks = [], brandKit = {}, provenance = {} } = body;
  if (!imageBase64) throw new Error("imageBase64 lipsă");
  const key = "audit-" + sha(imageBase64 + JSON.stringify(provenance) + (brandKit.name || ""));
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
    // anti-halucinație: păstrăm doar problemele al căror citat EXISTĂ în imagine
    out.issues = (out.issues || []).filter((i) => {
      const b = blocks.find((x) => norm(x.text).includes(norm(i.quote)) || norm(i.quote).includes(norm(x.text)));
      if (b) i.blockId = b.id;
      return !!b;
    });
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
