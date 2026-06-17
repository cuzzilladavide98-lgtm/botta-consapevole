# 🌿 Botta Consapevole

PWA a schermata unica per il **tracciamento consapevole del consumo**, pensata per la
*riduzione del danno*: registri ogni sessione con un tocco, l'app calcola la tua media
giornaliera e ti colloca su una scala scientifica a 7 livelli. L'interfaccia cambia
radicalmente — da paradiso naturale a degrado glitch — in base alla frequenza, perché
**l'intensità dell'effetto si preserva consumando meno e distanziando le sessioni**, non
potenziando il singolo consumo.

Ottimizzata per **iPhone 13 mini** (notch + safe-area), installabile su iOS, funziona
**100% offline** e **nessun dato lascia il dispositivo**.

---

> [!IMPORTANT]
> **Disclaimer.** Strumento personale di auto-monitoraggio a scopo di riduzione del danno,
> destinato a persone **maggiorenni (18+)** in contesti in cui il consumo è legale.
> Non è un dispositivo medico, non fornisce diagnosi né consigli sanitari, non incoraggia
> il consumo. La scala dei livelli è una sintesi divulgativa della letteratura citata in
> fondo: per qualsiasi decisione di salute rivolgiti a un professionista.

---

## ✨ Caratteristiche

- **Un tocco = una sessione.** Pulsante centrale grande; la media si aggiorna all'istante.
- **Annulla** l'ultimo tocco in caso di errore, con ricalcolo immediato.
- **Zero reset manuale.** Il giorno si chiude da solo (mezzanotte / lunga inattività): i
  dati finiscono nello storico e i giorni di astinenza abbassano correttamente la media.
- **7 livelli** da *Eccellente* a *Terribile*, con UI che evolve per colori, forme e micro-animazioni.
- **Offline-first** via Service Worker + **installabile** (Aggiungi a Home su iOS/Android).
- **Privacy totale:** solo `localStorage`, nessun server, nessun account, nessun tracker.

## 📊 Scala dei livelli

Il livello deriva dalla **media di sessioni al giorno** (`sessioni totali ÷ giorni tracciati`).
Le cadenze di riferimento provengono dal documento scientifico in *Fonti*.

| Livello | Cadenza indicativa | Media / giorno | Stile UI |
|---|---|---|---|
| **Eccellente** | ~1 ogni 3 settimane | ≤ 0.05 | Paradiso naturale: fiori, lucciole, pulsazioni morbide |
| **Sublime** | ~1 ogni 2 settimane | ≤ 0.10 | Candy onirico/psichedelico |
| **Standard** | ~1 a settimana | ≤ 0.20 | Candy pop pastello |
| **Abitudinario** | più volte a settimana | ≤ 0.45 | Pastelli che si spengono |
| **Hard** | ~1 ogni 2 giorni | ≤ 0.70 | Virata grigia, animazioni rigide |
| **Inutile** | ~1 al giorno | ≤ 1.40 | Quasi monocromo, spento |
| **Terribile** | più sessioni al giorno | > 1.40 | Degrado caotico: glitch, distorsione |

La **precisione** della stima cresce fino al massimo dopo ~21 giorni di tracciamento
(finestra di risensibilizzazione dei recettori CB1).

## 🛠️ Stack

HTML5 · CSS3 nativo (custom properties, `color-mix`, safe-area) · JavaScript ESNext
(moduli, nessun framework) · Web App Manifest · Service Worker. **Zero build, zero dipendenze.**

## 📁 Struttura

```
.
├── index.html              # Struttura SPA + meta Apple/PWA
├── styles.css              # 7 temi, animazioni, degrado visivo
├── app.js                  # Logica: tap, undo, rollover, persistenza, livelli
├── sw.js                   # Service Worker (offline-first)
├── manifest.webmanifest    # Manifest PWA
├── icons/                  # 192 / 512 maskable + apple-touch-icon 180
└── .github/workflows/      # Deploy automatico su GitHub Pages
```

## ▶️ Uso in locale

Le funzioni PWA (Service Worker) richiedono `https` **oppure** `localhost`. Apri un server statico:

```bash
# Python
python3 -m http.server 8080
# oppure Node
npx serve .
```

Poi visita `http://localhost:8080`.

## 🚀 Deploy su GitHub Pages

Il repo include un workflow che pubblica automaticamente a ogni push su `main`.

1. Push del codice su GitHub (vedi sotto).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Al push, l'app è online su `https://<utente>.github.io/<repo>/`.

Tutti i percorsi sono **relativi**, quindi l'app funziona correttamente anche servita da
una sottocartella (come fa Pages). Su iPhone: apri il link in **Safari → Condividi →
Aggiungi a Home** per installarla a schermo intero.

## ⚙️ Personalizzazione

- **Soglie dei livelli:** modifica l'array `LIVELLI` in `app.js` (campo `maxMedia`).
- **Formula:** la funzione `calcolaLivelloAttuale()` è il punto di integrazione unico —
  riceve `{ mediaGiornaliera, giorniTotali, totaleSessioni }` e restituisce il livello.
- **Temi/animazioni:** in `styles.css`, blocchi `body[data-level="…"]` (token) e
  `.scene--…` (sfondi). Il degrado è guidato dalle variabili `--decay`, `--anim-speed`,
  `--saturate`, `--skew`.

## 🔒 Privacy

Nessun dato esce dal dispositivo: storico, conteggi e livello sono salvati solo in
`localStorage`. Nessuna analitica, nessun cookie, nessuna chiamata di rete oltre al
caricamento dei file statici dell'app.

## 📚 Fonti scientifiche

La scala e le note divulgative sintetizzano, tra le altre:

- *Mechanisms of Cannabinoid Tolerance* — PMC/NIH: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10528043/>
- *Rapid Changes in CB1 Receptor Availability in Cannabis Users* — PubMed: <https://pubmed.ncbi.nlm.nih.gov/26858993/>
- *Reversible and regionally selective downregulation of brain CB1* — PubMed: <https://pubmed.ncbi.nlm.nih.gov/21747398/>
- *Risk-thresholds for frequency of cannabis use and psychotic outcomes* — PMC: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10317818/>
- *Canada's Lower-Risk Cannabis Use Guidelines* — Canada.ca: <https://www.canada.ca/en/health-canada/services/drugs-medication/cannabis/resources/lower-risk-cannabis-use-guidelines.html>
- *Cannabis Use Disorder* — StatPearls/NCBI: <https://www.ncbi.nlm.nih.gov/books/NBK538131/>

## 📄 Licenza

[MIT](LICENSE) © 2026 Davide
