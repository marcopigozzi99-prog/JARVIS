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
  'access-control-allow-methods': 'GET, POST, OPTIONS',
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
// Per i testi creativi prima il modello più bravo (limite giornaliero più basso), poi i leggeri.
const GEMINI_CREATIVE = ['gemini-flash-latest', ...GEMINI_MODELS];
async function askGemini(env, system, messages, opts = {}) {
  const base = opts.creative ? GEMINI_CREATIVE : GEMINI_MODELS;
  const list = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...base] : base;
  let lastErr;
  for (let i = 0; i < list.length; i++) {
    try { return await askGeminiModel(env, list[i], system, messages, opts.maxTokens || 500); }
    catch (e) { lastErr = e; const more = i < list.length - 1; if (!(e.tryNext || (opts.creative && more && /limite/.test(String(e.message))))) throw e; }
  }
  throw lastErr;
}
async function askGeminiModel(env, model, system, messages, maxTokens = 500) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
  });
  const j = await r.json();
  if (r.status === 429) throw new Error('limite');
  if (!r.ok) {
    const e = new Error((j.error && j.error.message) || 'Gemini ' + r.status);
    e.tryNext = r.status === 404 || r.status >= 500 || /not found|not supported|is not available|deprecated|high demand|overloaded|unavailable/i.test(e.message);
    throw e;
  }
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || '').join('').trim();
}

// ---------- Agenti specializzati ----------
const AGENTS = {
  generale: { name: 'Jarvis', areas: null, creative: false, tokens: 600, prompt: '' },
  vendite: { name: 'Agente Vendite', areas: ['kdp', 'libri', 'resina', 'app', 'vendite', 'entrata'], creative: false, tokens: 900,
    prompt: 'Sei l\'AGENTE VENDITE di Marco. Ti occupi di prezzi, canali di vendita (Amazon KDP cartaceo ed e-book, Etsy, Vinted, mercatini, vendita diretta), schede prodotto, parole chiave e categorie Amazon, analisi della concorrenza e stime di guadagno. Dai numeri concreti ma prudenti e distingui sempre i fatti dalle stime. Ricorda che Marco non ha partita IVA: per vendite continuative di oggetti suggerisci di verificare con un commercialista.' },
  scrittura: { name: 'Agente Scrittura', areas: ['scrittura', 'trilogia', 'gamebook', 'libri'], creative: true, tokens: 2500,
    prompt: 'Sei l\'AGENTE SCRITTURA dei romanzi di Marco (la trilogia young adult e il gamebook "La bussola del cuore", oltre al libro già pubblicato "La ragazza con il mare negli occhi"). Aiuti con trame, personaggi, capitoli, dialoghi, revisioni e titoli. Rispetta le scelte già prese indicate nei progetti; se proponi un elemento nuovo della storia, dì chiaramente che è una proposta e non un fatto già deciso. Quando Marco chiede un testo (un capitolo, una scena, una sinossi), scrivilo per intero in prosa curata, in terza persona come la trilogia, con dettagli visivi e olfattivi.' },
  bambini: { name: 'Agente Bambini', areas: ['kdp', 'bambini', 'libri'], creative: true, tokens: 2500,
    prompt: 'Sei l\'AGENTE SCRITTURA PER BAMBINI di Marco, che firma come "Capitan Scarabocchio". Scrivi le storie della collana di 10 storie illustrate per 6-8 anni (frasi brevi, parole semplici, ripetizioni e ritmo, un piccolo messaggio positivo, circa 24-32 pagine con una scena per pagina), idee per il fantasy 9-12 anni e i quaderni di attività. Per ogni storia puoi proporre anche i prompt per le illustrazioni, pagina per pagina, in uno stile coerente. Quando Marco chiede una storia, scrivila per intero.' },
  pianificazione: { name: 'Agente Pianificazione', areas: null, creative: false, tokens: 1200,
    prompt: 'Sei l\'AGENTE PIANIFICAZIONE di Marco. Marco lavora dal lunedì al venerdì dalle 8 alle 17 o 18, ha 1-2 ore la sera nei giorni feriali per l\'entrata secondaria (weekend escluso), va in palestra 2-3 volte a settimana e vuole al massimo 2-3 priorità per periodo. Trasforma obiettivi e progetti in piani concreti: giorno per giorno, con durate realistiche, un solo passo per sera, cosa rimandare. Basati sui progetti e sulle note, senza inventare scadenze.' },
  marketing: { name: 'Agente Marketing', areas: ['kdp', 'libri', 'app', 'resina', 'marketing'], creative: true, tokens: 1500,
    prompt: 'Sei l\'AGENTE MARKETING di Marco. Ti occupi di lancio dei libri su Amazon (descrizioni, contenuti A+, recensioni ottenute in modo corretto, campagne a basso costo), social (Instagram, TikTok, Facebook, gruppi di genitori e lettori), promozione delle sue app e degli oggetti in resina. Preferisci idee a costo zero o quasi, con passi pratici e testi pronti da copiare quando servono.' },
  grafica: { name: 'Agente Grafica', areas: ['grafica', 'kdp', 'libri', 'bambini', 'trilogia', 'gamebook', 'app', 'resina'], creative: true, tokens: 1800,
    prompt: 'Sei l\'AGENTE GRAFICA di Marco, art director e illustratore. Ti occupi di copertine dei libri KDP (fronte, dorso e retro, misure e margini KDP, titolo leggibile anche in miniatura), illustrazioni per le storie per bambini (stile coerente nella collana, personaggi riconoscibili), impaginazione degli interni, loghi, icone e grafiche delle app, post e immagini per i social, foto e presentazione degli oggetti in resina e legno. Dai indicazioni concrete: palette di colori con codici, font consigliati e gratuiti, composizione, formato e dimensioni in pixel o centimetri. Quando Marco vuole generare un\'immagine con un\'IA, scrivigli un prompt pronto da copiare, dettagliato, prima in inglese e poi spiegato in breve in italiano. Consiglia strumenti gratuiti come Canva, Kittl o GIMP. Mai copiare personaggi, loghi o stili protetti di altri autori: proponi sempre idee originali.' },
};
const ROUTES = [
  ['grafica', /grafic|copertin|illustra|disegn|immagin|logo|icona|impagina|palette|colori|font|caratter|canva|prompt per|foto per|miniatur|banner|locandin|volantin/],
  ['bambini', /bambin|capitan scarabocchio|storia per|storie per|fiab|filastrocc|da colorare|quaderni? di attivit|6-8 anni|9-12/],
  ['marketing', /marketing|pubblicit|promuov|promozion|social|instagram|tiktok|facebook|lancio|lanciare|recension|post |hashtag|sponsor/],
  ['vendite', /vend|prezz|etsy|vinted|mercatin|guadagn|listino|clienti|concorren|royalt|categorie amazon|parole chiave/],
  ['scrittura', /trilogi|romanz|capitol|gamebook|librogame|bussola del cuore|mappa perduta|citt[aà] dei ricordi|ultima fotografia|personagg|trama|sinossi|scrivimi|riscrivi|dialogo/],
  ['pianificazione', /pianific|organizz|settiman|agenda|priorit|programm|calendari|scadenz|cosa faccio (oggi|stasera|domani)|piano (di|per) /],
];
function routeAgent(text, prev) {
  const t = String(text || '').toLowerCase();
  for (const [id, re] of ROUTES) if (re.test(t)) return id;
  return AGENTS[prev] ? prev : 'generale';
}

// ---------- Memoria di Jarvis (progetti, note, creazioni) nel KV ----------
async function memGet(env) { try { return JSON.parse((await env.INBOX.get('memory')) || 'null') || { projects: [], notes: [] }; } catch { return { projects: [], notes: [] }; } }
async function memPut(env, m) { m.notes = (m.notes || []).slice(-200); await env.INBOX.put('memory', JSON.stringify(m)); }
async function worksGet(env) { try { return JSON.parse((await env.INBOX.get('works')) || '[]'); } catch { return []; } }
function memContext(m, agent) {
  const areas = AGENTS[agent] && AGENTS[agent].areas;
  const rel = (x) => !areas || !x.area || areas.some((a) => String(x.area).includes(a));
  const P = (m.projects || []).filter(rel).map((p) => `- ${p.name} [${p.status}]: ${p.summary}${p.next ? ' Prossimo passo: ' + p.next : ''}`).join('\n');
  const N = (m.notes || []).filter(rel).slice(-30).map((n) => `- ${String(n.at).slice(0, 10)} (${n.area || 'generale'}): ${n.text}`).join('\n');
  return `PROGETTI DI MARCO:\n${P || '(nessuno registrato)'}\n\nNOTE, DECISIONI E CREAZIONI RECENTI:\n${N || '(nessuna)'}`;
}
const MEMO_RULE = `\nMEMORIA: quando Marco ti dice di aver fatto, deciso o programmato qualcosa, oppure quando crei qualcosa di nuovo (una storia, un titolo, un piano, una descrizione, una strategia), aggiungi IN FONDO alla risposta una o più righe che iniziano esattamente con "MEMORIA:" seguite da un riassunto di una riga (massimo 200 caratteri) di ciò che va ricordato. Per le domande semplici non aggiungerle. Quelle righe non vengono lette ad alta voce.`;
async function memoryRoute(request, env, url, sub, origin) {
  if (!env.INBOX) return json({ error: 'Memoria non configurata' }, 500, origin);
  if (request.method === 'GET' && !sub) {
    const m = await memGet(env), w = await worksGet(env);
    return json({ ...m, works: w.map((x) => ({ id: x.id, title: x.title, agent: x.agent, at: x.at })) }, 200, origin);
  }
  if (request.method === 'GET' && sub === 'work') {
    const w = (await worksGet(env)).find((x) => x.id === url.searchParams.get('id'));
    return w ? json(w, 200, origin) : json({ error: 'Non trovato' }, 404, origin);
  }
  if (request.method !== 'POST') return json({ error: 'Non trovato' }, 404, origin);
  let b; try { b = await request.json(); } catch { return json({ error: 'Richiesta non valida' }, 400, origin); }
  const m = await memGet(env);
  if (b.op === 'add') {
    const text = String(b.text || '').trim().slice(0, 400); if (!text) return json({ error: 'Testo vuoto' }, 400, origin);
    m.notes.push({ text, area: String(b.area || 'generale').slice(0, 30), at: new Date().toISOString() });
  } else if (b.op === 'del') {
    m.notes.splice(Number(b.i), 1);
  } else if (b.op === 'projects' && Array.isArray(b.projects)) {
    m.projects = b.projects.slice(0, 40).map((p) => ({ name: String(p.name || '').slice(0, 80), area: String(p.area || '').slice(0, 30), status: String(p.status || '').slice(0, 40), summary: String(p.summary || '').slice(0, 600), next: String(p.next || '').slice(0, 300) }));
  } else if (b.op === 'delwork') {
    const w = (await worksGet(env)).filter((x) => x.id !== b.id); await env.INBOX.put('works', JSON.stringify(w));
    return json({ ok: true }, 200, origin);
  } else return json({ error: 'Operazione sconosciuta' }, 400, origin);
  await memPut(env, m);
  return json({ ok: true }, 200, origin);
}

// ---------- Voce (Gemini TTS) ----------
// La voce può essere una delle voci già pronte (es. "Charon") oppure una voce creata con Voice Design
// in Google AI Studio (un identificativo "voice_…", dello stesso progetto della chiave).
const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'];
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function pcmToWav(pcm, rate = 24000) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, str) => { for (let i = 0; i < str.length; i++) h.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  w(36, 'data'); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer), 0); out.set(pcm, 44);
  return out;
}
async function speakGemini(env, text, voice, style) {
  const list = env.TTS_MODEL ? [env.TTS_MODEL, ...TTS_MODELS] : TTS_MODELS;
  let last;
  for (const model of list) {
    const item = { type: 'text', text };
    if (style) item.annotations = [{ type: 'speech_metadata', style }];
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ model, input: [{ type: 'user_input', content: [item] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) { const e = new Error('limite'); e.status = 429; throw e; }
    if (!r.ok) {
      const e = new Error((j.error && j.error.message) || 'Voce ' + r.status); e.status = r.status; last = e;
      if (r.status === 404 && !/voice/i.test(e.message) || /model.*(not found|not supported|not available)/i.test(e.message)) continue;
      throw e;
    }
    let audio = null;
    for (const st of j.steps || []) if (st.type === 'model_output') for (const c of st.content || []) if (c.type === 'audio' && c.data) audio = c;
    if (!audio && j.output_audio && j.output_audio.data) audio = j.output_audio;
    if (!audio) { last = new Error('Nessun audio nella risposta'); continue; }
    let bytes = b64ToBytes(audio.data), mime = audio.mime_type || 'audio/wav';
    if (/l16|pcm/i.test(mime) || !(bytes[0] === 0x52 && bytes[1] === 0x49)) { const m = /rate=(\d+)/.exec(mime); bytes = pcmToWav(bytes, m ? +m[1] : 24000); mime = 'audio/wav'; }
    return { bytes, mime };
  }
  throw last || new Error('Voce non disponibile');
}

// ---------- Casella per Claude ----------
// Jarvis lascia qui le richieste per Claude (KV "INBOX"); un'attività programmata di Claude le legge
// ogni ora, le svolge e scrive la risposta, che Jarvis poi legge a voce.
async function inboxGet(env) { try { return JSON.parse((await env.INBOX.get('items')) || '[]'); } catch { return []; } }
async function inboxPut(env, items) { await env.INBOX.put('items', JSON.stringify(items.slice(-60))); }
const plain = (s, status, origin) => new Response(s, { status: status || 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...cors(origin) } });
async function inboxRoute(request, env, url, sub, origin) {
  if (!env.INBOX) return json({ error: 'Casella non configurata (manca il KV INBOX)' }, 500, origin);
  if (!sub && request.method === 'POST') {
    let b; try { b = await request.json(); } catch { return json({ error: 'Richiesta non valida' }, 400, origin); }
    const text = String(b.text || '').trim().slice(0, 2000);
    if (!text) return json({ error: 'Testo vuoto' }, 400, origin);
    const items = await inboxGet(env);
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, at: new Date().toISOString(), status: 'new', reply: '' };
    items.push(item); await inboxPut(env, items);
    return json({ ok: true, id: item.id }, 200, origin);
  }
  if (sub === 'list') { const items = await inboxGet(env); return json({ items: items.slice(-20) }, 200, origin); }
  if (sub === 'pending') {
    // ?take=1: le richieste lette passano a "presa in carico", così l'ora dopo non vengono rilette
    const all = await inboxGet(env), take = url.searchParams.get('take');
    const items = all.filter((x) => (take ? x.status === 'new' : x.status !== 'done'));
    if (!items.length) return plain('NESSUNA RICHIESTA IN ATTESA', 200, origin);
    if (take) { items.forEach((x) => { x.status = 'taken'; x.takenAt = new Date().toISOString(); }); await inboxPut(env, all); }
    return plain(items.map((x) => `ID: ${x.id}\nRICEVUTA: ${x.at}\nTESTO: ${x.text}`).join('\n---\n'), 200, origin);
  }
  if (sub === 'reply') {
    const id = url.searchParams.get('id'), text = String(url.searchParams.get('text') || '').slice(0, 3000);
    if (!id || !text) return plain('ERRORE: servono id e text', 400, origin);
    const items = await inboxGet(env); const it = items.find((x) => x.id === id);
    if (!it) return plain('ERRORE: richiesta non trovata', 404, origin);
    it.reply = text; it.status = 'done'; it.repliedAt = new Date().toISOString();
    await inboxPut(env, items);
    return plain('OK: risposta salvata per ' + id, 200, origin);
  }
  return json({ error: 'Non trovato' }, 404, origin);
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
// Ora italiana calcolata a mano (ora legale UE: dall'ultima domenica di marzo all'ultima di ottobre, alle 01:00 UTC)
const nowRome = () => {
  const d = new Date(), y = d.getUTCFullYear();
  const lastSun = (m) => { const t = new Date(Date.UTC(y, m + 1, 0, 1)); t.setUTCDate(t.getUTCDate() - t.getUTCDay()); return t; };
  const off = d >= lastSun(2) && d < lastSun(9) ? 2 : 1;
  return new Date(d.getTime() + off * 3600e3).toLocaleString('it-IT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url);
    const [token, action, sub] = url.pathname.split('/').filter(Boolean);
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
    if (action === 'claude') return inboxRoute(request, env, url, sub, origin);
    if (action === 'mem') return memoryRoute(request, env, url, sub, origin);
    if (action === 'speak' && request.method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ error: 'La voce richiede la chiave Gemini' }, 500, origin);
      let b; try { b = await request.json(); } catch { return json({ error: 'Richiesta non valida' }, 400, origin); }
      const text = String(b.text || '').slice(0, 1200).trim();
      if (!text) return json({ error: 'Testo vuoto' }, 400, origin);
      const voice = String(b.voice || env.GEMINI_VOICE || 'Charon').slice(0, 120);
      const style = String(b.style || '').slice(0, 300);
      try {
        const { bytes, mime } = await speakGemini(env, text, voice, style);
        return new Response(bytes, { status: 200, headers: { 'content-type': mime, 'cache-control': 'no-store', ...cors(origin) } });
      } catch (e) {
        return json({ error: e.status === 429 ? 'limite' : String(e.message).slice(0, 200) }, e.status === 429 ? 429 : 502, origin);
      }
    }
    if (action !== 'chat' || request.method !== 'POST') return json({ error: 'Non trovato' }, 404, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Richiesta non valida' }, 400, origin); }
    const messages = cleanMessages(typeof body.q === 'string' ? fromShortcut(body) : body.messages);
    if (!messages.length) return json({ error: 'Nessun messaggio' }, 400, origin);
    const context = String(body.context || ('Data e ora: ' + nowRome() + '.')).slice(0, 1500);
    const lastUser = messages.filter((x) => x.role === 'user').slice(-1)[0].content;
    const agent = AGENTS[body.agent] ? body.agent : routeAgent(lastUser, body.prevAgent);
    const A = AGENTS[agent];
    const mem = env.INBOX ? await memGet(env) : { projects: [], notes: [] };
    const system = SYSTEM + (A.prompt ? '\n\n' + A.prompt + '\nSe la risposta è un testo creativo lungo, puoi superare il limite di frasi: scrivilo per intero, in paragrafi, senza titoli in markdown.' : '')
      + '\n\n' + memContext(mem, agent) + MEMO_RULE + (context ? '\n\nSituazione attuale (dall\'app):\n' + context : '');

    try {
      let text;
      if (env.ANTHROPIC_API_KEY) text = await askClaude(env, system, messages);
      else if (env.GEMINI_API_KEY) text = await askGemini(env, system, messages, { creative: A.creative, maxTokens: A.tokens });
      else return json({ error: 'Manca la chiave dell\'IA nel servizio' }, 500, origin);
      text = text || 'Non ho una risposta per questo.';
      // righe MEMORIA: → note salvate, tolte dalla risposta
      const saved = [];
      text = text.replace(/^\s*\**MEMORIA\**\s*:\s*(.+)$/gim, (_, x) => { saved.push(x.trim().slice(0, 300)); return ''; }).trim();
      let workId = null;
      if (env.INBOX) {
        if (saved.length) { saved.forEach((x) => mem.notes.push({ text: x, area: agent, at: new Date().toISOString() })); await memPut(env, mem); }
        if (A.creative && text.length > 900) {   // testi lunghi: salvati come creazione consultabile
          const works = await worksGet(env);
          workId = Date.now().toString(36);
          const title = (saved[0] || lastUser).slice(0, 90);
          works.push({ id: workId, title, agent, at: new Date().toISOString(), request: lastUser.slice(0, 500), text: text.slice(0, 12000) });
          await env.INBOX.put('works', JSON.stringify(works.slice(-40)));
        }
      }
      return json({ text, agent, agentName: A.name, saved, workId }, 200, origin);
    } catch (e) {
      const limit = /limite|rate|quota|429/i.test(String(e.message));
      return json({ error: limit ? 'limite' : String(e.message).slice(0, 200) }, limit ? 429 : 502, origin);
    }
  },
};
