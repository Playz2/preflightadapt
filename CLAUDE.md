# PreFlight: context pentru Claude Code

## Ce construim
Hackathon Adobe de 12 ore (7 noiembrie 2026). Criterii: problem solving 25%, AI-driven innovation 25%, technical excellence 25%, third-party integrations 15%, product & demo 10%, bonus cost vs value +10%.

**PreFlight** face o verificare de conformitate înainte de publicarea unei reclame. Scorul 0–100 are 4 axe:
- **Brand (25%)**: culori în afara paletei (ΔE > 20), disclaimer obligatoriu lipsă, ton
- **Accesibilitate (25%)**: contrast WCAG 2.2 (4.5:1 text normal, 3:1 text mare)
- **Legal (30%)**: claim-uri de sănătate (Reg. UE 1169/2011 art. 7(3)), recomandări de la medici (Reg. CE 1924/2006 art. 12(c)), superlative (Legea 158/2008), reduceri fără preț de referință (Dir. 98/6/CE art. 6a), urgență artificială (Legea 363/2007)
- **AI Act (20%)**: imagine AI fotorealistă fără etichetă (EU AI Act art. 50(4)), plus Content Credentials (C2PA)

Scor pe axă = max(0, 100 − 40×erori − 15×atenționări). Totalul e media ponderată. **Scorul îl calculează codul, nu LLM-ul.**
Demo: reclama VitaBoost (supliment, brand fictiv) urcă de la ~54–59 la ~96 după „Fix all”. Rămâne o singură atenționare („-70%” are nevoie de preț de referință introdus de om, ca moment human-in-the-loop). O reclamă cu medic nu poate ajunge la ~96: eroarea art. 12(c) din imagine rămâne până când omul schimbă poza.

Principiu de arhitectură: **cod determinist pentru ce e măsurabil** (contrast, culori, disclaimer, scor), **AI doar pentru judecată** (claim-uri, ton, fotorealism / risc de deepfake).

## Structura repo-ului
```
preflightadapt/
  addon/        Add-on Adobe Express (template swc-javascript-with-document-sandbox). Planul A.
                Rulează cu `npm run start` pe https://localhost:5241
    src/sandbox/code.js  citește documentul și aplică fix-urile
    src/ui/              index.js (flux), engine.js (motor determinist), render.js (panou), brandkit.json
  public/       Aplicația web (planul B), servită de Firebase Hosting
    app.js        fluxul: OCR -> motor determinist -> audit AI -> Fix all -> re-verificare
    engine.js     contrast WCAG, paletă ΔE (Lab), disclaimer, scor
    fixer.js      aplică fix-urile pe un canvas nou (originalul rămâne neatins)
    provenance.js C2PA prin @contentauth/c2pa-web (CDN esm.sh) + rezervă: caută markerii în octeți
    brandkit.json brand kit VitaBoost
  functions/    Cloud Functions v2, Node 22, JavaScript, regiune europe-west1
    index.js      ocr (Google Cloud Vision), audit (Gemini, JSON cu responseSchema, filtru anti-halucinație), log (Firestore)
  demo/vitaboost_test.png   reclamă de test
  firebase.json  hosting + rewrites /api/ocr, /api/audit, /api/log -> funcții
  firestore.rules  totul blocat pentru client (doar Admin SDK)
```

## Infrastructură (deja configurată)
- Proiect Firebase: `preflightadapt` (plan Blaze), Firestore în eur3, Cloud Vision API activat
- URL: https://preflightadapt.web.app
- Secret: `GEMINI_API_KEY` (în Secret Manager, citit cu defineSecret). Nu pune niciodată cheia în cod.
- Model Gemini: `gemini-4-argon` (`thinkingLevel: "MEDIUM"`). Rezervă: `gemini-3.8-flash` (`thinkingLevel: "LOW"`). Modelele 2.5 nu mai sunt disponibile, iar SDK-ul folosește API v1, unde `gemini-flash-latest` nu există.
- Cache în Firestore (colecția `cache`) după hash-ul imaginii. Se salvează doar răspunsurile reușite. Cheia auditului are o versiune (`audit-v5-`): crește-o când schimbi prompt-ul sau schema.

## Comenzi
- Deploy totul: `firebase deploy`
- Doar o funcție: `firebase deploy --only functions:audit`
- Doar frontend: `firebase deploy --only hosting`
- Log-uri: `firebase functions:log --only audit`
- Verificare sintaxă: `node --check functions/index.js`
- Shell: Windows PowerShell (folosește `Select-String`, nu `grep`)

## Capcane deja întâlnite
- **Salvează fișierele înainte de deploy.** Firebase urcă ce e pe disc, nu ce e în editor.
- Dacă `firebase deploy` spune „Deploy complete”, dar `firebase functions:list` e gol, `functions/index.js` nu exportă nimic.
- Add-on-ul Express se conectează la localhost doar dacă pornești Chrome cu
  `start chrome --disable-web-security --user-data-dir="c:\temp\chrome"` (profil separat, folosit doar pentru Express).
- Add-on-ul nu poate apela http (emulator), doar URL-urile https deployate.
- Erorile 503 de la Gemini sunt temporare: e nevoie de reîncercare cu backoff.
- `httpOptions.timeout` din SDK e trimis și către Google ca termen pe server: o limită prea mică produce erori 504.
- Fără `thinkingLevel: "LOW"`, auditul poate dura peste 40 s și depășește limita de timp. Nivelul `MINIMAL` nu e acceptat de modele.
- Add-on-ul vede doar elemente native. O imagine plată lipită în Express nu are texte de citit sau de reparat.
- Fișierele din `public/` sunt ținute în cache de browser o oră: după deploy, verifică cu `Ctrl+F5`.

## Reguli pentru modificări
- Fă modificări mici și țintite, fără refactorizări nesolicitate. E hackathon, stabilitatea demo-ului contează cel mai mult.
- Nu schimba formula de scor, schema JSON sau prompt-ul fără să fie cerut explicit.
- După orice modificare: `node --check` pe fișierele JS atinse, apoi deploy-ul relevant.
- Interfața și mesajele sunt în limba română, cu diacritice.
- Paleta UI: Ink #0F172A, Indigo #4338CA, Green #15803D, Amber #B45309 / #F59E0B, Red #B91C1C, Slate #475569. Fonturi: Poppins (titluri), Inter (text).
- Afirmațiile juridice trebuie să rămână corecte: Art. 50 se aplică din 2 aug. 2026. Amenzi Art. 99(4): până la 15 mil. € / 3%, iar pentru IMM-uri se aplică valoarea mai mică. PreFlight e suport decizional, nu consultanță juridică.
