# Il cervello di Jarvis

Un servizio gratuito su Cloudflare che custodisce la chiave dell'IA e risponde a Jarvis.
Serve perché la chiave non può stare dentro una pagina pubblica: chiunque potrebbe leggerla.

## 1. Prendi una chiave per l'IA (scegline una)

- **Gratis — Google Gemini:** vai su aistudio.google.com, accedi con Google, "Get API key" › "Create API key". Il piano gratuito ha un limite di richieste al giorno e Google può usare le conversazioni per migliorare i suoi prodotti: non dire a Jarvis cose riservate.
- **A consumo — Claude:** vai su console.anthropic.com, carica qualche euro di credito, "API Keys" › "Create Key". Con un uso quotidiano leggero si spendono pochi euro al mese.

## 2. Crea il servizio su Cloudflare

1. Vai su dash.cloudflare.com e accedi (o crea un account gratuito).
2. Menu **Compute (Workers)** › **Workers & Pages** › **Create** › **Create Worker**.
3. Nome: `jarvis-cervello` › **Deploy**.
4. **Edit code**: cancella tutto, incolla il contenuto di `worker.js` di questa cartella › **Deploy**.
5. Torna al worker › **Settings** › **Variables and Secrets** › **Add**, tipo **Secret**:
   - `TOKEN` = una parola lunga inventata, senza spazi (es. `formica-lampone-scacchiera-2026`)
   - `GEMINI_API_KEY` = la chiave di Google, **oppure** `ANTHROPIC_API_KEY` = la chiave di Claude
6. **Deploy** di nuovo.

## 3. Collega Jarvis

L'indirizzo è: `https://jarvis-cervello.<il-tuo-sottodominio>.workers.dev/<TOKEN>/chat`

In Jarvis: **Comandi** › **Cervello IA** › incolla l'indirizzo › **Collega**.

## 4. Usarlo da app chiusa (Comando Rapido)

Nel Comando Rapido "Jarvis", azione **Ottieni contenuti di URL**:
- URL: lo stesso indirizzo che finisce con `/chat`
- Metodo: **POST**, Corpo richiesta: **JSON**
- Campi: `q` (testo) = Testo dettato; `history` (testo) = la variabile Storia

Poi **Ottieni valore dizionario** per la chiave `text` e **Pronuncia testo**.

## 5. Voce neurale (Gemini TTS)

Il cervello ha anche l'indirizzo `/speak`: riceve `{ text, voice, style }` e restituisce l'audio WAV.
- `voice`: una voce pronta (es. `Charon`, `Orus`, `Algenib`) oppure l'identificativo `voice_…` creato con **Voice Design** in Google AI Studio (aistudio.google.com/generate-speech), nello stesso progetto della chiave.
- In Jarvis: Comandi › Voce › Voce neurale di Gemini.
