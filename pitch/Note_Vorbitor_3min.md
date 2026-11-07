# PreFlight — Script și Note de Vorbitor (Pitch 3 Minute)

Fișier pereche pentru [`PreFlight_Pitch_Deck.pdf`](./PreFlight_Pitch_Deck.pdf).
Timp total: **3:00** (din care **70 secunde** demo live în Adobe Express).

---

## Reguli de aur pe scenă
1. **Deschide direct cu cifra (`3%` / `60.000 €`)** — fără „Bună ziua, noi suntem echipa…”.
2. **În timpul demo-ului**, vorbește despre **ce vede juriul pe ecran**, nu despre cod.
3. **Când scorul urcă la `96`**, fă o **pauză de o secundă** înainte să continui.
4. **Termină cu tagline-ul și taci** — nu adăuga „…mulțumim, cam asta a fost”.
5. **Formulare de siguranță (dacă e nevoie în tranziție sau la prima întrebare):**
   > „PreFlight e un instrument de suport decizional, nu consultanță juridică. Semnalează riscul și explică temeiul, iar decizia finală rămâne la om.”

---

## Cronometru & Script exact pe cele 8 slide-uri

### Slide 1 — Hook (`0:00 – 0:20`) • Fundal `Ink #0F172A`
- **Pe ecran:** `3%` · `din cifra de afaceri · până la 60.000 € pentru o imagine.`
- **Ce spui:**
  > „Din 2 august, a publica o imagine AI fotorealistă fără etichetă poate costa o firmă până la 3% din cifra de afaceri. Pentru un IMM cu 2 milioane de euro cifră de afaceri, asta înseamnă până la 60.000 de euro pentru o singură postare.”

---

### Slide 2 — Problema (`0:20 – 0:45`) • Fundal Alb `#FFFFFF`
- **Pe ecran:** `3 riscuri înainte de „Publică”` (`AI Act Art. 50` · `Claim-uri interzise` · `Contrast ilizibil`)
- **Ce spui:**
  > „Echipele mici publică zilnic reclame făcute cu AI. Nu au jurist, nu au brand manager și nu au GenStudio. Au trei riscuri înainte să apese Publică: legea AI, claim-urile interzise și text pe care nimeni nu-l poate citi.”

---

### Slide 3 — Demo live (`0:45 – 1:55` • 70 secunde) • Fundal `Ink #0F172A` → Adobe Express
- **Pe ecran:** `LIVE în Adobe Express` (`54 → Fix all → 96`), apoi comuți imediat pe tab-ul Adobe Express (sau pornești video-ul de backup de 70 s de pe desktop dacă pică rețeaua: *„Vă arăt înregistrarea de acum o oră”*).
- **Ce spui:**
  > „Aceasta e o reclamă reală pentru un supliment, făcută în Express cu o imagine generată cu AI. **[Click PreFlight]** Contrastul e calculat instant: 1,5 la 1. În paralel, AI-ul a găsit un claim de vindecare interzis de regulamentul UE 1169 și a recunoscut că imaginea e fotorealistă și arată o persoană reală, deci eticheta e obligatorie. Credentials au fost citite la import. Scor 54. **[Click Fix all]** Textul se recolorează, claim-ul se rescrie în tonul brandului, eticheta și disclaimerul sunt adăugate. **Scor 96.** *(pauză 1 secundă)* Rămâne un singur lucru pe care AI-ul nu-l poate ști: prețul de referință pentru reducere, așa că ni-l cere.”

> **Notă importantă de sincronizare cu colegul pe asset-ul din demo:**
> După ultima actualizare din backend (`Reg. (CE) 1924/2006 art. 12(c)`), o imagine cu **medic în halat** primește și o eroare vizuală de recomandare medicală care nu poate fi reparată din text (scorul după Fix all se oprește la ~84 până schimbi poza), pe când cu `demo/foto_persoana.jpg` scorul urcă direct la **~96** după `Fix all`. Verificați împreună înainte de intrare ce imagine e pusă pe artboard-ul A!

---

### Slide 4 — Arhitectura (`1:55 – 2:20`) • Fundal Alb `#FFFFFF`
- **Pe ecran:** Diagrama tehnică pe 3 straturi (`0` Poarta C2PA → `1` Panou PreFlight ↔ `4` Document Sandbox → `2` Motor determinist → `3` Cloud Function `/audit` în `europe-west1`).
- **Ce spui:**
  > „Cod unde răspunsul e exact, AI unde e nevoie de judecată. Textele vin din structura documentului, nu din OCR. Contrastul e matematică. Proveniența e verificată cu Content Credentials la intrare. Doar judecata juridică și vizuală merge la LLM, cu schemă JSON strictă. Datele rămân în UE.”

---

### Slide 5 — De ce AI (`2:20 – 2:30`) • Fundal Alb `#FFFFFF`
- **Pe ecran:** `Cod unde e exact, AI unde e judecată` (`Contrast WCAG & Paletă ΔE` vs. `Deepfake Art. 50 & Claim-uri`)
- **Ce spui:**
  > „AI-ul nu decorează produsul, îl face posibil. Decide dacă o imagine e deepfake sau ilustrație.”

---

### Slide 6 — Cost vs. value (`2:30 – 2:40`) • Fundal Alb `#FFFFFF`
- **Pe ecran:** `0,02 € vs 8 €` (`per asset verificat · secunde vs. 20 minute`)
- **Ce spui:**
  > „O verificare costă sub 2 cenți. Varianta manuală costă 20 de minute de review, în jur de 8 euro, sau o amendă.”

---

### Slide 7 — Business (`2:40 – 2:52`) • Fundal Alb `#FFFFFF`
- **Pe ecran:** `Freemium în marketplace-ul Express` (`Free 0 €` · `Pro 19 €/lună` · `Agency 99 €/lună`)
- **Ce spui:**
  > „Freemium în marketplace-ul Express: 19 euro pe lună pentru freelanceri, 99 pentru agenții. GenStudio protejează Fortune 500. PreFlight protejează pe toți ceilalți, în produsul vostru.”

---

### Slide 8 — Închidere (`2:52 – 3:00`) • Fundal `Ink #0F172A`
- **Pe ecran:** Logo PreFlight + `Verifică înainte să decolezi.`
- **Ce spui:**
  > „Verifică înainte să decolezi.”

---

## Checklist rapid cu 10 minute înainte de scenă
- [ ] Asset-ul A (VitaBoost) + duplicat nemodificat și Asset-ul B (Brutăria) sunt deschise și verificate de 2 ori (cache încălzit în Firestore).
- [ ] Add-on-ul este conectat în Express, DevTools închis, notificările Windows oprite, zoom-ul paginii reglat astfel încât panoul de 320 px să fie lizibil pe proiector.
- [ ] Video de backup de max. 70 s pe desktop, gata de pornit dintr-un singur click.
- [ ] Hotspot-ul de pe telefon este activ ca rezervă pentru Wi-Fi-ul sălii.
