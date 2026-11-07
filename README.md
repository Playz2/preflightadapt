# PreFlight: planul B (aplicație web pe Firebase)

Testat cap-coadă (cu răspunsuri simulate): VitaBoost trece de la 59 la 96 după Fix all.
Cu o imagine Firefly care are Content Credentials, pornește de la 54.

## Instalare (≈15 min)

1. Copiază conținutul arhivei în folderul `backend/`, înlocuind fișierele generate de `firebase init`.
2. În `backend/`:
   ```
   firebase use --add            # alegi proiectul tău Firebase (plan Blaze)
   cd functions
   npm install
   firebase functions:secrets:set GEMINI_API_KEY      # lipești cheia din Google AI Studio
   cd ..
   ```
3. Activează **Cloud Vision API** pentru proiect (un click, pe pagina API-ului din Google Cloud Console):
   https://console.cloud.google.com/apis/library/vision.googleapis.com
4. În `functions/index.js`, verifică `MODEL` (numele exact al celui mai nou model Flash din AI Studio).
5. Deployează:
   ```
   firebase deploy
   ```
   Dacă te întreabă de „cleanup policy” pentru imagini, răspunde `y`.
6. Deschide `https://<proiect>.web.app` și trage `demo/vitaboost_test.png` în pagină.

## Lucru rapid pe frontend
După primul deploy, modifici doar fișierele din `public/` și rulezi `firebase deploy --only hosting` (≈10 s).

## Structura
- `public/engine.js`: contrast WCAG, paletă ΔE, disclaimer, scor (cod determinist, în browser)
- `public/fixer.js`: aplică fix-urile pe un canvas nou (originalul rămâne neatins)
- `public/provenance.js`: Content Credentials prin c2pa-web; dacă SDK-ul nu se încarcă, detectează marcajele C2PA direct în fișier
- `public/app.js`: fluxul OCR → verificări deterministe → audit AI → Fix all → re-verificare reală
- `functions/index.js`: `/api/ocr` (Google Cloud Vision), `/api/audit` (Gemini, schemă JSON, filtru anti-halucinație), `/api/log` (Firestore); cache după hash

## Pentru demo
- Fă reclama VitaBoost în Express după dosar (secțiunea 8) și export-o ca PNG.
- Imaginea Firefly originală (cu Content Credentials) o tragi în „Imagini sursă”, ca să aprinzi verificarea AI Act.
- Rulează o dată tot fluxul înainte de pitch, ca să se încălzească cache-ul.
