# Regula deepfake în PreFlight

Regula `checkAiAct()` este în motoarele web și add-on. Folosește contractul existent; nu este un detector vizual independent.

Pentru risc deepfake cere simultan `photorealistic === true`, `depictsRealPersonLike === true` și fie proveniență AI, fie `disclosureRequired === true`. Astfel, proveniența AI plus indiciile vizuale pot corecta un verdict final omis; un verdict contradictoriu nu impune etichetarea unei ilustrații stilizate.

| Situație, fără etichetă existentă | Rezultat |
| --- | --- |
| Risc deepfake și proveniență AI | Eroare, fix `label` |
| Risc deepfake fără proveniență AI confirmată | Atenționare, fix `label` |
| Celelalte imagini cu proveniență AI | Info, etichetă recomandată |
| Fără indicii suficiente și fără proveniență AI | Nicio problemă AI Act |

Eticheta existentă elimină constatarea. Lipsa auditului păstrează comportamentul anterior, fără constatare AI Act; nu certifică imaginea. Formula scorului nu se schimbă.

## Temei și termene

Art. 3(60) include persoane, obiecte, locuri, entități sau evenimente care par autentice. Art. 50(4) cere divulgarea conținutului deepfake; simplul fotorealism nu dovedește o încălcare. Pentru lucrări evident artistice sau fictive care constituie deepfake, obligația are o formă adaptată, nu dispare automat.

Art. 50 se aplică din 2 august 2026. Termenul de 2 decembrie 2026 privește marcarea tehnică din art. 50(2) pentru furnizorii sistemelor deja pe piață înainte de 2 august, nu amânarea art. 50(4). Motorul tratează reclame pregătite acum pentru publicare; nu primește data generării și nu decide excepții istorice.

Art. 99(4) prevede până la 15 milioane EUR sau 3% din cifra de afaceri mondială anuală precedentă; pentru IMM-uri se aplică plafonul mai mic, conform art. 99(6). Pentru un IMM cu 2 milioane EUR, plafonul este 60.000 EUR. Acesta nu este o amendă estimată de aplicație și nu intră în scor.

Surse oficiale verificate la 7 noiembrie 2026:

- [Comisia Europeană: transparența conform art. 50](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)
- [Regulamentul (UE) 2024/1689: art. 3, 50 și 99](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng)

## Limite și verificare

Prompt-ul actual explică `depictsRealPersonLike` prin persoane, locuri și evenimente; obiectele nu sunt menționate explicit. Regula nu restrânge subiectul la fețe, însă acoperirea imaginilor doar cu obiecte depinde de audit și nu este garantată. Prompt-ul, schema și cache-ul nu au fost modificate. Add-on-ul continuă să folosească proveniență necunoscută. Detecția C2PA de rezervă nu validează semnătura.

Testele deterministe se rulează cu `node --test tests/ai-act.test.mjs`. Ele nu reprezintă o măsurare a acurateții Gemini și nu înlocuiesc retestarea imaginilor reale.

PreFlight e un instrument de suport decizional, nu consultanță juridică. Semnalează riscul și explică temeiul, iar decizia finală rămâne la om.
