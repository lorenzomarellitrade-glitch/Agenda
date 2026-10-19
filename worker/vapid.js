// Genera una coppia di chiavi VAPID.
// La privata esce solo su stdout, da passare direttamente a wrangler senza salvarla in un file:
//   node vapid.js | npx wrangler secret put VAPID_PRIVATE_JWK
// La pubblica non serve copiarla: l'app la chiede al Worker (/vapid).
const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', privateKey);
process.stdout.write(JSON.stringify({ kty, crv, x, y, d }));
process.stderr.write('Chiave VAPID generata e passata a wrangler (la privata non viene salvata).\n');
