/* Jarvis — il cervello
   Un piccolo servizio Cloudflare Workers (gratuito) che custodisce la chiave dell'IA e risponde a Jarvis.
   La chiave non sta mai nella pagina pubblica: la conosce solo questo servizio.

   Segreti da impostare in Cloudflare (Settings › Variables and Secrets):
     TOKEN               una parola lunga a caso, che fa da password dell'indirizzo
     GEMINI_API_KEY      chiave di Google AI Studio (piano gratuito)        — oppure —
     ANTHROPIC_API_KEY   chiave della Claude Console (a consumo)
   Facoltativi:
     GEMINI_MODEL        predefinito: gemini-flash-lite-latest
     CLAUDE_MODEL        predefinito: claude-haiku-5-5

   Indirizzo da incollare in Jarvis:  https://<nome-del-worker>.<tuo-account>.workers.dev/<TOKEN>/chat */

const ORIGINS = ['https://marcopigozzi99-prog.github.io'];
const MAX_TURNS = 16;          // messaggi di conversazione ricordati
const MAX_CHARS = 2000;        // lunghezza massima di ogni messaggio

const SYSTEM = `Sei Jarvis, l'assistente personale di Marco. Marco è italiano, vive in provincia di Verona, lavora in Lidl dal lunedì al venerdì (8-17/18), scrive libri che pubblica su Amazon KDP, ha un garage-laboratorio (falegnameria e resina), un giardino da sistemare, va in palestra 2-3 volte a settimana e sta costruendo un'entrata secondaria.
Le tue risposte vengono LETTE AD ALTA VOCE dal telefono, quindi:
- rispondi in italiano, in modo naturale e diretto, come in una conversazione;
- di solito 1-3 frasi; arriva a 5-6 solo se Marco chiede una spiegazione o un elenco;
- niente markdown, asterischi, elenchi puntati, emoji o link: scrivi frasi complete che suonano bene parlate;
- se un elenco serve, dillo a voce ("primo…, poi…, infine…");
- sii concreto e pratico; se non sai qualcosa o non hai dati aggiornati, dillo senza inventare;
- puoi fare una domanda di chiarimento quando serve davvero.
Non puoi registrare spese, leggere il ricettario o cambiare nulla: quelle cose le fa l'app Jarvis con i suoi comandi. Se Marco te le chiede, digli la frase da usare, ad esempio "ho speso 12 euro al bar", "cosa mangiamo stasera", "quanto posso spendere oggi", "aggiungi latte alla spesa".`;

const cors = (origin) => ({
  'access-control-allow-origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'vary': 'origin',
});
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } });

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cleanMessages(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list.slice(-MAX_TURNS) : []) {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    const content = String((m && m.content) || '').slice(0, MAX_CHARS).trim();
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function askClaude(env, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-haiku-5-5', max_tokens: 500, system, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Claude ' + r.status);
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// Modelli gratuiti provati in ordine: se Google ne ritira uno, passa al successivo.
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
async function askGemini(env, system, messages) {
  const list = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...GEMINI_MODELS] : GEMINI_MODELS;
  let lastErr;
  for (const model of list) {
    try { return await askGeminiModel(env, model, system, messages); }
    catch (e) { lastErr = e; if (!e.tryNext) throw e; }
  }
  throw lastErr;
}
async function askGeminiModel(env, model, system, messages) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 500, temperature: 0.6 },
    }),
  });
  const j = await r.json();
  if (r.status === 429) throw new Error('limite');
  if (!r.ok) {
    const e = new Error((j.error && j.error.message) || 'Gemini ' + r.status);
    e.tryNext = r.status === 404 || /not found|not supported|is not available|deprecated/i.test(e.message);
    throw e;
  }
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || '').join('').trim();
}

// Dal Comando Rapido di iPhone: { q: "domanda", history: "Marco: …\nJarvis: …" }
function fromShortcut(body) {
  const msgs = [];
  String(body.history || '').split('\n').forEach((line) => {
    const m = line.match(/^(Marco|Jarvis):\s*(.+)$/);
    if (m) msgs.push({ role: m[1] === 'Jarvis' ? 'assistant' : 'user', content: m[2] });
  });
  msgs.push({ role: 'user', content: String(body.q) });
  return msgs;
}
const nowRome = () => new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url);
    const [token, action] = url.pathname.split('/').filter(Boolean);
    if (!env.TOKEN || !sameToken(token, env.TOKEN)) return json({ error: 'Indirizzo non valido' }, 404, origin);
    if (action === 'ping') {
      const provider = env.ANTHROPIC_API_KEY ? 'claude' : env.GEMINI_API_KEY ? 'gemini' : null;
      if (!provider) return json({ ok: true, provider: null }, 200, origin);
      try {   // prova vera: una domanda minuscola, per scoprire subito chiavi sbagliate
        const test = [{ role: 'user', content: 'Rispondi solo: ok' }];
        if (provider === 'claude') await askClaude(env, 'Rispondi in una parola.', test); else await askGemini(env, 'Rispondi in una parola.', test);
        return json({ ok: true, provider }, 200, origin);
      } catch (e) {
        const msg = /API key|API_KEY|invalid|permission|unauth/i.test(String(e.message)) ? 'La chiave dell\'IA non è valida: ricopiala in Cloudflare.' : /limite/.test(String(e.message)) ? 'Chiave valida, ma per oggi il limite gratuito è finito.' : 'L\'IA ha risposto con un errore: ' + String(e.message).slice(0, 120);
        return json({ ok: false, provider, error: msg }, 200, origin);
      }
    }
    if (action !== 'chat' || request.method !== 'POST') return json({ error: 'Non trovato' }, 404, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Richiesta non valida' }, 400, origin); }
    const messages = cleanMessages(typeof body.q === 'string' ? fromShortcut(body) : body.messages);
    if (!messages.length) return json({ error: 'Nessun messaggio' }, 400, origin);
    const context = String(body.context || ('Data e ora: ' + nowRome() + '.')).slice(0, 1500);
    const system = SYSTEM + (context ? '\n\nSituazione attuale (dall\'app):\n' + context : '');

    try {
      let text;
      if (env.ANTHROPIC_API_KEY) text = await askClaude(env, system, messages);
      else if (env.GEMINI_API_KEY) text = await askGemini(env, system, messages);
      else return json({ error: 'Manca la chiave dell\'IA nel servizio' }, 500, origin);
      return json({ text: text || 'Non ho una risposta per questo.' }, 200, origin);
    } catch (e) {
      const limit = /limite|rate|quota|429/i.test(String(e.message));
      return json({ error: limit ? 'limite' : String(e.message).slice(0, 200) }, limit ? 429 : 502, origin);
    }
  },
};
