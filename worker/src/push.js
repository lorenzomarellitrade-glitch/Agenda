// Web Push con sole WebCrypto: cifratura aes128gcm (RFC 8291) e firma VAPID (RFC 8292).
const enc = new TextEncoder();

export function b64uDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64uEncode(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parti) {
  const out = new Uint8Array(parti.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parti) { out.set(p, i); i += p.length; }
  return out;
}

async function hmac(chiave, dati) {
  const k = await crypto.subtle.importKey('raw', chiave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dati));
}

// Chiave pubblica VAPID (65 byte non compressi, base64url) ricavata dalla JWK privata.
export function chiavePubblica(jwk) {
  return b64uEncode(concat(new Uint8Array([4]), b64uDecode(jwk.x), b64uDecode(jwk.y)));
}

async function firmaVapid(jwk, aud, soggetto) {
  const testa = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64uEncode(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: soggetto,
  })));
  const chiave = await crypto.subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chiave, enc.encode(`${testa}.${corpo}`));
  return `${testa}.${corpo}.${b64uEncode(firma)}`;
}

export async function cifra(sub, testo) {
  const uaPub = b64uDecode(sub.keys.p256dh);
  const auth = b64uDecode(sub.keys.auth);
  const coppia = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', coppia.publicKey));
  const uaChiave = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segreto = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaChiave }, coppia.privateKey, 256));

  const uno = new Uint8Array([1]);
  const prkChiave = await hmac(auth, segreto);
  const ikm = await hmac(prkChiave, concat(enc.encode('WebPush: info\0'), uaPub, asPub, uno));
  const sale = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sale, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), uno))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), uno))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const chiaro = concat(enc.encode(testo), new Uint8Array([2])); // 0x02 = ultimo record
  const cifrato = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, chiaro));

  const testa = new Uint8Array(21 + asPub.length);
  testa.set(sale, 0);
  new DataView(testa.buffer).setUint32(16, 4096);
  testa[20] = asPub.length;
  testa.set(asPub, 21);
  return concat(testa, cifrato);
}

export async function inviaPush(sub, dati, jwk, soggetto) {
  const jwt = await firmaVapid(jwk, new URL(sub.endpoint).origin, soggetto);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${chiavePubblica(jwk)}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '600',
      Urgency: 'high',
    },
    body: await cifra(sub, JSON.stringify(dati)),
  });
}
