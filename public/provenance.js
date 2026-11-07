// PreFlight - citirea Content Credentials (C2PA) în browser

let c2paPromise = null;
function getC2pa() {
  // @contentauth/c2pa-web, varianta "inline" (WASM inclus), încărcată ca modul ES de pe CDN
  if (!c2paPromise) c2paPromise = import("https://esm.sh/@contentauth/c2pa-web/inline").then((m) => m.createC2pa());
  return c2paPromise;
}
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

export async function readProvenance(file) {
  // 1. citire completă cu validare, prin SDK-ul oficial CAI
  try {
    const c2pa = await Promise.race([getC2pa(), timeout(10000)]);
    const reader = await c2pa.reader.fromBlob(file.type, file);
    if (reader) {
      const store = await reader.manifestStore();
      await reader.free();
      const s = JSON.stringify(store);
      return {
        hasCredentials: true, validated: true, file: file.name,
        aiGenerated: /trainedAlgorithmicMedia/i.test(s),      // IPTC digitalSourceType pentru AI
        generator: (s.match(/"claim_generator"\s*:\s*"([^"]+)"/) || [])[1] || null,
      };
    }
  } catch (e) {
    console.info("c2pa-web:", e?.message);
  }
  // 2. rezervă: caută marcajele C2PA direct în octeții fișierului (detecție, fără verificarea semnăturii)
  const txt = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
  const has = txt.includes("jumb") && txt.includes("c2pa");
  return { hasCredentials: has, validated: false, file: file.name,
           aiGenerated: has && /trainedAlgorithmicMedia/.test(txt), generator: null };
}

// combină proveniența mai multor fișiere (reclama + imaginile sursă)
export function mergeProvenance(list) {
  return {
    hasCredentials: list.some((p) => p.hasCredentials),
    aiGenerated: list.some((p) => p.aiGenerated),
    validated: list.some((p) => p.validated),
    generator: list.map((p) => p.generator).find(Boolean) || null,
    files: list.map((p) => p.file),
  };
}
