// Worker delle notifiche: riceve dall'app la subscription e gli orari, ogni minuto manda le push dovute.
import { inviaPush, chiavePubblica } from './push.js';

const MAX_DISPOSITIVI = 10;
const MAX_VOCI = 300;

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(dati, env, stato = 200) {
  return new Response(JSON.stringify(dati), { status: stato, headers: { 'Content-Type': 'application/json', ...cors(env) } });
}

function chiaveVapid(env) {
  if (!env.VAPID_PRIVATE_JWK) throw new Error('Chiave VAPID mancante: esegui  node vapid.js | npx wrangler secret put VAPID_PRIVATE_JWK');
  return JSON.parse(env.VAPID_PRIVATE_JWK);
}

// Data e ora (HH:MM) a Roma per un istante in millisecondi.
export function oraRoma(istante) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(istante))) p[x.type] = x.value;
  return { data: `${p.year}-${p.month}-${p.day}`, ora: `${p.hour}:${p.minute}` };
}

// Voci da notificare in quel minuto: orario uguale, data giusta (task), giorno della settimana giusto
// (revisione, 0 = domenica), non spuntate oggi.
export function daInviare(dispositivo, istante) {
  const { data, ora } = oraRoma(istante);
  const giorno = new Date(data + 'T12:00:00Z').getUTCDay();
  const fatte = dispositivo.fatte && dispositivo.fatte.data === data ? dispositivo.fatte.ids : [];
  return (dispositivo.voci || []).filter((v) => v.ora === ora
    && (!v.data || v.data === data)
    && (v.giorno === undefined || v.giorno === giorno)
    && !fatte.includes(v.id));
}

const TITOLI = { routine: 'Routine', task: 'Task', revisione: 'Revisione settimanale' };

const testoBreve = (s) => String(s || '').slice(0, 200);
const valido = (s, re) => typeof s === 'string' && re.test(s);

function leggiSync(b, env) {
  if (!b || !valido(b.id, /^[a-zA-Z0-9-]{8,64}$/)) throw new Error('id non valido');
  const sub = b.sub;
  // http solo nella prova locale (wrangler dev --var PROVA_LOCALE:1)
  if (!sub || !valido(sub.endpoint, env.PROVA_LOCALE ? /^https?:\/\// : /^https:\/\//) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('subscription non valida');
  const voci = (Array.isArray(b.voci) ? b.voci : []).slice(0, MAX_VOCI)
    .filter((v) => v && valido(v.id, /^[a-zA-Z0-9-]{1,64}$/) && valido(v.ora, /^\d\d:\d\d$/))
    .map((v) => ({
      id: v.id, testo: testoBreve(v.testo), ora: v.ora, tipo: TITOLI[v.tipo] ? v.tipo : 'routine',
      ...(valido(v.data, /^\d{4}-\d\d-\d\d$/) ? { data: v.data } : {}),
      ...(Number.isInteger(v.giorno) && v.giorno >= 0 && v.giorno <= 6 ? { giorno: v.giorno } : {}),
      ...(valido(v.url, /^\.\/\??[\w=&-]*$/) ? { url: v.url } : {}),
    }));
  const f = b.fatte || {};
  const fatte = { data: valido(f.data, /^\d{4}-\d\d-\d\d$/) ? f.data : '', ids: (Array.isArray(f.ids) ? f.ids : []).filter((x) => typeof x === 'string').slice(0, MAX_VOCI) };
  return { id: b.id, dispositivo: { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, voci, fatte, aggiornato: Date.now() } };
}

async function controlla(env, istante) {
  const indice = (await env.AGENDA.get('indice', 'json')) || [];
  if (!indice.length) return;
  const chiave = chiaveVapid(env);
  const restano = [];
  for (const id of indice) {
    const d = await env.AGENDA.get('d:' + id, 'json');
    if (!d) continue;
    let vivo = true;
    for (const v of daInviare(d, istante)) {
      const r = await inviaPush(d.sub, { titolo: TITOLI[v.tipo], testo: v.testo, tag: v.id, url: v.url || './' }, chiave, env.VAPID_SUBJECT);
      if (r.status === 404 || r.status === 410) { vivo = false; break; }
      if (!r.ok) console.log('push fallita', r.status, await r.text());
    }
    if (vivo) restano.push(id);
    else await env.AGENDA.delete('d:' + id);
  }
  if (restano.length !== indice.length) await env.AGENDA.put('indice', JSON.stringify(restano));
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'GET' && pathname === '/vapid') {
        return json({ chiave: chiavePubblica(chiaveVapid(env)) }, env);
      }
      if (req.method === 'POST' && pathname === '/sync') {
        const { id, dispositivo } = leggiSync(await req.json(), env);
        await env.AGENDA.put('d:' + id, JSON.stringify(dispositivo));
        const indice = (await env.AGENDA.get('indice', 'json')) || [];
        if (!indice.includes(id)) {
          if (indice.length >= MAX_DISPOSITIVI) indice.shift();
          indice.push(id);
          await env.AGENDA.put('indice', JSON.stringify(indice));
        }
        return json({ ok: true, voci: dispositivo.voci.length }, env);
      }
      if (req.method === 'POST' && pathname === '/prova') {
        const { id } = await req.json();
        const d = valido(id, /^[a-zA-Z0-9-]{8,64}$/) && (await env.AGENDA.get('d:' + id, 'json'));
        if (!d) return json({ ok: false, errore: 'Dispositivo non registrato: premi prima "Attiva notifiche"' }, env, 404);
        const r = await inviaPush(d.sub, { titolo: 'Agenda', testo: 'Notifiche attive ✓', tag: 'prova' }, chiaveVapid(env), env.VAPID_SUBJECT);
        return json({ ok: r.ok, stato: r.status, dettaglio: r.ok ? '' : await r.text() }, env, r.ok ? 200 : 502);
      }
      return json({ errore: 'non trovato' }, env, 404);
    } catch (e) {
      return json({ ok: false, errore: String(e.message || e) }, env, 400);
    }
  },

  async scheduled(evento, env, ctx) {
    ctx.waitUntil(controlla(env, evento.scheduledTime));
  },
};
