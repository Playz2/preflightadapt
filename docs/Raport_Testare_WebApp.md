# Raport de Testare — `https://preflightadapt.web.app` (QA & Edge Cases)

**Data testării:** 7 noiembrie 2026 (după commit-ul `760cf23`)  
**Mediu testat:** Producție Firebase Hosting + Cloud Functions `europe-west1` (`https://preflightadapt.web.app` — `/api/ocr`, `/api/audit`, `/api/log`) + inspecție statică a codului din `public/` și `addon/`.

---

## 1. Sumar executiv: ce funcționează excelent

1. **Hosting & Endpoints stabile (HTTP 200):** Pagina web, `brandkit.json`, `/api/ocr` (Cloud Vision cu hint `ro`) și `/api/audit` (Gemini Flash cu `responseSchema` strictă și filtru anti-halucinație) răspund corect și fără erori CORS.
2. **Diferențierea Art. 50(4) funcționează exact cum promitem în pitch:**
   - Pe **`demo/medic_firefly.jpg`** (medic fotorealist cu C2PA): `photorealistic: true`, `depictsRealPersonLike: true`, `disclosureRequired: true` → declanșează **EROARE EU AI Act, art. 50(4)** + **EROARE Reg. (CE) 1924/2006 art. 12(c)** (`region: [438, 323, 718, 701]`, `confidence: "high"`).
   - Pe **`demo/foto_persoana.jpg`** (persoană obișnuită fotorealistă cu C2PA): `photorealistic: true`, `depictsRealPersonLike: true`, `disclosureRequired: true`, fără eroare art. 12(c).
   - Pe **`demo/brutarie_firefly.jpg`** (ilustrație flat 2D cu C2PA): `photorealistic: false`, `depictsRealPersonLike: false`, `disclosureRequired: false` → cu C2PA activ afișează **INFO: „Conținut AI: etichetă recomandată, nu obligatorie”** (demonstrează judecata contextuală).
3. **Cache-ul din Firestore accelerează de ~22× apelul `/api/audit`:**
   - Apel la rece (fără cache): **8.970 ms – 30.997 ms** (`vitaboost_test.png`: `16.389 ms`, `foto_persoana.jpg`: `30.997 ms`).
   - Apel cu cache cald (`cached: true`): **`745 ms`** pe `/api/audit` și **`708–1.215 ms`** pe `/api/ocr`.
   - *Notă:* Cache-ul de producție este acum deja încălzit pentru `vitaboost_test.png`, `medic_firefly.jpg`, `brutarie_firefly.jpg` și `foto_persoana.jpg`.

---

## 2. Lucruri ciudate / bug-uri găsite la testare (în ordinea impactului în demo)

### [P1 — IMPORTANT PENTRU DEMO] `medic_firefly.jpg` vs `foto_persoana.jpg`: scorul după `Fix all` nu urcă la 96 dacă imaginea are medic!
- **Ce s-a observat:** Pe `demo/medic_firefly.jpg`, noua regulă din `functions/index.js` detectează corect halatul și stetoscopul ca **EROARE `Reg. (CE) 1924/2006 art. 12(c)`** (`blockId: null`, fără `suggestedText`).
- **Efect:** Deoarece o problemă vizuală din fotografie nu are fix automat (`fix: null`), după `Fix all` rămân deschise atât eroarea art. 12(c) (`-40` pe Legal), cât și atenționarea de preț de referință (`-15` pe Legal) → axa Legal rămâne la `45`, iar scorul total se oprește la **~84** (nu **96**).
- **Recomandare pentru demo:**
  - Pentru fluxul principal `54 → 96` din pitch, folosiți în asset-ul A **`demo/foto_persoana.jpg`** (sau pregătiți ca pas final schimbarea pozei medicului cu `foto_persoana.jpg` dacă vreți să arătați și art. 12(c)).

---

### [P1 — WEB APP] Zgomot OCR pe forme grafice (`b5: "-"` în `vitaboost_test.png` și `b1: "7"` în `brutarie_firefly.jpg`)
- **Ce s-a observat în răspunsul real `/api/ocr`:**
  1. Pe `demo/vitaboost_test.png`, Google Cloud Vision returnează un al 5-lea bloc fals:
     `{"id":"b5","text":"-","bbox":{"x":776,"y":588,"w":96,"h":177},"fontPx":177}` — este dreptunghiul verde al flaconului din ilustrația din dreapta! Din fericire, contrastul dintre `#0F766E` și halatul alb `#FFFFFF` trece de `3:1`, dar `engine.js` îl evaluează totuși ca „buton” (din fericire `#0F766E` e în paleta VitaBoost, deci `deltaE = 0`).
  2. Pe `demo/brutarie_firefly.jpg`, OCR-ul detectează colțul copertinei/vitrinei drept cifra `"7"`:
     `{"id":"b1","text":"7","bbox":{"x":74,"y":304,"w":110,"h":121},"fontPx":121}`. În versiunea web (`public/engine.js`), `splitTextAndBg` măsoară contrastul dintre culorile pastel ale ilustrației din acea casetă; dacă e sub `3:1`, raportează o eroare falsă de contrast WCAG pe `"7"`, iar `Fix all` desenează un `"7"` uriaș peste ilustrație!
- **Fix rapid (1 linie în `public/app.js` sau `functions/index.js`, dacă mai umbli la web):** ignoră blocurile OCR de 1 caracter fără litere/cifre relevante sau cu `h > w * 1.6` / fără cuvinte reale (`text.length < 2`). *(În add-on-ul Express problema NU există, fiindcă `scanPage()` citește noduri `Text` native — argument excelent pentru juriu!)*

---

### [P2 — WEB APP & ADD-ON] Dublă penalizare pe „Cel mai bun supliment din România” și dublă problemă pe „-70% doar azi”
- **Ce s-a observat în `/api/audit` pe `vitaboost_test.png`:**
  1. Textul `„Cel mai bun supliment din România”` (`b2`) primește **două** carduri `warning` separate de la Gemini: unul pe `legal` (`Legea 158/2008`) și unul pe `brand` (`Încălcare ton de brand`, cu `legalBasis: null`), ambele cu `replaceText` pe același `b2`. Dacă au `suggestedText` ușor diferit, în `Fix all` câștigă ultimul din listă.
  2. Textul `„-70% doar azi”` (`b3`) primește **două** carduri `warning` pe `legal`:
     - `Dir. 98/6/CE art. 6a` (`needsHumanInput: true`, buton `Adaugă preț`)
     - `Legea 363/2007` — „Urgență artificială” (`suggestedText: "-70% reducere"`, buton `Fix`)
  - **Atenție la ordinea click-urilor în demo:** Dacă apeși întâi **Fix all**, `b3` devine `"-70% reducere"` și la re-verificare rămâne curat doar cardul de preț de referință (scor **96** — funcționează impecabil!). În schimb, dacă utilizatorul introduce prețul *înainte* de `Fix all`, apoi apasă `Fix all`, rescrierea pentru „Urgență artificială” (`"-70% reducere"`) suprascrie prețul tocmai introdus.

---

### [P2 — WEB APP] `demo/vitaboost_test.png` singur nu declanșează EU AI Act Art. 50(4)
- **Ce s-a observat:** Silueta din dreapta din `demo/vitaboost_test.png` este geometrică/abstractă, așa că Gemini întoarce corect `photorealistic: false, depictsRealPersonLike: false, disclosureRequired: false` chiar și când încarci o imagine sursă cu C2PA. Pentru a vedea eroarea Art. 50(4) în aplicația web, reclama încărcată trebuie să conțină efectiv fotografia AI (`foto_persoana.jpg` sau `medic_firefly.jpg`).

---

### [P2 — WEB APP UI] Problemele pur vizuale (`blockId: null`, cu `region`) nu desenează chenar pe canvas în `public/app.js`
- **Ce s-a observat:** În `functions/index.js` (commit `760cf23`), problemele vizuale precum medicul în halat vin cu `blockId: null` și `region: [ymin, xmin, ymax, xmax]` (0–1000). În `public/app.js` linia 131 (`S.issues.filter((i) => !i.fixed && i.blockId)`), chenarul punctat de diagnostic pe canvas se desenează doar pentru problemele cu `blockId`, ignorând `i.region`. De asemenea, `public/app.js` afișează doar `suggestedText`, nu și lista completă `i.suggestions` (care există deja în add-on).

---

### [P3 — C2PA / PROVENANCE] `generator` rămâne `null` pe manifestele C2PA v2
- **Ce s-a observat:** În `public/provenance.js` (linia 23), regex-ul caută `"claim_generator":"..."` (format C2PA v1). Manifestele C2PA v2 (atât Google C2PA Core Generator Library din imaginile din `demo/`, cât și exporturile recente Adobe) stochează numele în `claim_generator_info` (`"name":"..."`), deci `p.generator` iese `null` (afișează doar `Content Credentials găsite • generat cu AI`, fără numele generatorului).

---

### [P3 — ADD-ON] Poarta C2PA la import nu este încă legată în `addon/src/ui/index.js`
- **Ce s-a observat:** În `addon/src/ui/index.js` linia 9, `provenance` este încă hardcodat cu `aiGenerated: false`. Din această cauză:
  - Pe o persoană AI fotorealistă, cardul Art. 50(4) apare ca `ATENȚIE` (`warning`, `-15` pct) în loc de `EROARE` (`error`, `-40` pct).
  - Pe ilustrația stilizată a brutăriei (`brutarie_firefly.jpg`), unde `disclosureRequired: false`, nu mai apare cardul `INFO` („Conținut AI: etichetă recomandată, nu obligatorie”) dacă `provenance.aiGenerated` este `false`.

---

### [P3 — BACKEND] Latența la rece (15–31 s) & cod HTTP 500 pe input lipsă
- **Latență:** Un apel ne-cache-uit la `gemini-3.8-flash` a durat `16,4 s` pe `vitaboost_test.png` și `31,0 s` pe `foto_persoana.jpg`. **Regulă obligatorie înainte de juriu:** rulați verificarea + `Fix all` de 2 ori pe asset-urile finale ca atât starea „înainte”, cât și starea „după” să fie în colecția `cache` din Firestore (`~0,7 s` timp de răspuns).
- **Cod HTTP:** `POST /api/audit` cu body `{}` întoarce `HTTP 500 {"error":"imageBase64 lipsă"}` în loc de `HTTP 400` (wrapper-ul `handler()` mapează orice `Error` la `500`). Nu afectează UI-ul, dar e bine de știut.
