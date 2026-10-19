// Prova del Worker senza iPhone.
//   node strumenti/prova-push.mjs                      → cifratura, firma VAPID e orari
//   node strumenti/prova-push.mjs --worker <url>       → in più prova completa contro "wrangler dev":
//     /vapid, /sync, cron simulato e push ricevuta e decifrata da un finto servizio push locale.
import http from 'node:http';
import assert from 'node:assert/strict';
import { inviaPush, chiavePubblica, b64uDecode, b64uEncode } from '../worker/src/push.js';
import { daInviare, oraRoma } from '../worker/src/index.js';

const enc = new TextEncoder();
const subtle = crypto.subtle;
const concat = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
async function hmac(k, d) {
  const c = await subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', c, d));
}

// Lato "telefono": chiavi del browser.
async function nuovoBrowser(endpoint) {
  const coppia = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await subtle.exportKey('raw', coppia.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { coppia, pub, auth, sub: { endpoint, keys: { p256dh: b64uEncode(pub), auth: b64uEncode(auth) } } };
}

// Decifra come farebbe il browser (RFC 8291) e verifica la firma VAPID.
async function ricevi(browser, intestazioni, corpo, audAtteso) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(intestazioni.authorization || '');
  assert.ok(m, 'Authorization VAPID presente');
  const [h, c, f] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claims.aud, audAtteso, 'aud = origine del servizio push');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'exp entro 24 ore');
  assert.match(claims.sub, /^(mailto:|https:)/, 'sub valido');
  const kPub = await subtle.importKey('raw', b64uDecode(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kPub, b64uDecode(f), enc.encode(`${h}.${c}`)), 'firma VAPID valida');
  assert.equal(intestazioni['content-encoding'], 'aes128gcm');

  const sale = corpo.slice(0, 16);
  const idlen = corpo[20];
  const asPub = corpo.slice(21, 21 + idlen);
  const cifrato = corpo.slice(21 + idlen);
  const asChiave = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segreto = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asChiave }, browser.coppia.privateKey, 256));
  const ikm = await hmac(await hmac(browser.auth, segreto), concat(enc.encode('WebPush: info\0'), browser.pub, asPub, [1]));
  const prk = await hmac(sale, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const chiaro = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cifrato));
  assert.equal(chiaro[chiaro.length - 1], 2, 'delimitatore di ultimo record');
  return JSON.parse(new TextDecoder().decode(chiaro.slice(0, -1)));
}

// Finto servizio push: riceve una richiesta e la passa a chi aspetta.
function servizioPush() {
  const attese = [];
  const server = http.createServer((req, res) => {
    const pezzi = [];
    req.on('data', (p) => pezzi.push(p));
    req.on('end', () => {
      res.writeHead(201); res.end();
      const a = attese.shift();
      if (a) a({ intestazioni: req.headers, corpo: new Uint8Array(Buffer.concat(pezzi)) });
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    server, url: `http://127.0.0.1:${server.address().port}/push`,
    prossima: (ms = 15000) => new Promise((ok2, ko) => { attese.push(ok2); setTimeout(() => ko(new Error('nessuna push ricevuta')), ms); }),
  })));
}

const passi = [];
const fatto = (s) => { passi.push(s); console.log('  ok  ' + s); };

// 1. Orari in ora di Roma (ora legale e solare)
assert.deepEqual(oraRoma(Date.parse('2026-10-19T05:30:00Z')), { data: '2026-10-19', ora: '07:30' });
assert.deepEqual(oraRoma(Date.parse('2026-10-26T06:30:00Z')), { data: '2026-10-26', ora: '07:30' });
assert.deepEqual(oraRoma(Date.parse('2026-10-19T22:00:00Z')), { data: '2026-10-20', ora: '00:00' });
fatto('ora di Roma (CEST, CET, mezzanotte)');

// 2. Scelta delle voci da notificare
const disp = {
  voci: [
    { id: 'r1', testo: 'Acqua', ora: '07:30', tipo: 'routine' },
    { id: 'r2', testo: 'Già fatta', ora: '07:30', tipo: 'routine' },
    { id: 't1', testo: 'Task oggi', ora: '07:30', data: '2026-10-19', tipo: 'task' },
    { id: 't2', testo: 'Task domani', ora: '07:30', data: '2026-10-20', tipo: 'task' },
    { id: 'r3', testo: 'Altro orario', ora: '08:00', tipo: 'routine' },
  ],
  fatte: { data: '2026-10-19', ids: ['r2'] },
};
assert.deepEqual(daInviare(disp, Date.parse('2026-10-19T05:30:20Z')).map((v) => v.id), ['r1', 't1']);
assert.deepEqual(daInviare(disp, Date.parse('2026-10-20T05:30:00Z')).map((v) => v.id), ['r1', 'r2', 't2'], 'le spunte di ieri non contano oggi');
fatto('voci del minuto, spuntate escluse, task solo nel loro giorno');

// Revisione settimanale: solo la domenica (0). Il 25/10/2026 è domenica e c'è il cambio d'ora.
const rev = { voci: [{ id: 'revisione', testo: 'Revisione', ora: '20:00', giorno: 0, tipo: 'revisione', url: './?vista=inbox&revisione=1' }] };
assert.equal(daInviare(rev, Date.parse('2026-10-25T19:00:00Z')).length, 1, 'domenica 20:00 (CET)');
assert.equal(daInviare(rev, Date.parse('2026-10-18T18:00:00Z')).length, 1, 'domenica 20:00 (CEST)');
assert.equal(daInviare(rev, Date.parse('2026-10-19T18:00:00Z')).length, 0, 'lunedì niente');
fatto('revisione settimanale solo la domenica all\'ora scelta');

// 3. Push cifrata e firmata, decifrata dal lato browser
const vapid = await subtle.exportKey('jwk', (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])).privateKey);
assert.equal(b64uDecode(chiavePubblica(vapid)).length, 65);
const push = await servizioPush();
const browser = await nuovoBrowser(push.url);
const arrivo = push.prossima();
const r = await inviaPush(browser.sub, { titolo: 'Routine', testo: 'Acqua è già ora ✓', tag: 'r1' }, vapid, 'mailto:agenda@example.com');
assert.equal(r.status, 201);
const { intestazioni, corpo } = await arrivo;
assert.deepEqual(await ricevi(browser, intestazioni, corpo, new URL(push.url).origin), { titolo: 'Routine', testo: 'Acqua è già ora ✓', tag: 'r1' });
assert.equal(intestazioni.ttl, '600');
fatto('push cifrata aes128gcm + VAPID ES256 decifrata e verificata');

// 4. Prova completa contro wrangler dev
const i = process.argv.indexOf('--worker');
if (i > 0) {
  const W = process.argv[i + 1].replace(/\/$/, '');
  const { chiave } = await (await fetch(W + '/vapid')).json();
  assert.equal(b64uDecode(chiave).length, 65);
  fatto('/vapid risponde con la chiave pubblica');

  const ora = oraRoma(Date.now());
  const corpoSync = {
    id: 'prova-locale-0001', sub: browser.sub,
    voci: [
      { id: 'r1', testo: 'Routine adesso', ora: ora.ora, tipo: 'routine' },
      { id: 'r2', testo: 'Spuntata', ora: ora.ora, tipo: 'routine' },
      { id: 'revisione', testo: 'Revisione', ora: ora.ora, giorno: new Date(ora.data + 'T12:00:00Z').getUTCDay(), tipo: 'revisione', url: './?vista=inbox&revisione=1' },
    ],
    fatte: { data: ora.data, ids: ['r2'] },
  };
  const s = await (await fetch(W + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoSync) })).json();
  assert.equal(s.ok, true, JSON.stringify(s));
  fatto('/sync salva subscription e orari in KV');

  const prima = push.prossima();
  await fetch(W + '/prova', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: corpoSync.id }) });
  const p1 = await prima;
  assert.equal((await ricevi(browser, p1.intestazioni, p1.corpo, new URL(push.url).origin)).tag, 'prova');
  fatto('/prova manda la notifica di prova');

  const ricevute = [];
  const raccogli = (async () => { for (;;) ricevute.push(await push.prossima(6000)); })().catch(() => {});
  await fetch(W + '/__scheduled?cron=*+*+*+*+*');
  await raccogli;
  const arrivate = [];
  for (const x of ricevute) arrivate.push(await ricevi(browser, x.intestazioni, x.corpo, new URL(push.url).origin));
  assert.deepEqual(arrivate.map((p) => p.testo).sort(), ['Revisione', 'Routine adesso'], 'arriva tutto tranne la voce spuntata');
  assert.equal(arrivate.find((p) => p.tag === 'revisione').url, './?vista=inbox&revisione=1');
  assert.equal(arrivate.find((p) => p.tag === 'revisione').titolo, 'Revisione settimanale');
  fatto('cron: push per le voci dovute, spuntata esclusa, revisione con link all\'Inbox');
}

push.server.close();
console.log(`\nTutto ok (${passi.length} controlli).`);
process.exit(0);
