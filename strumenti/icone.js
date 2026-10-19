// Disegna le icone PNG dell'app (spunta chiara su fondo scuro) senza dipendenze.
// Uso: node strumenti/icone.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function blocco(tipo, dati) {
  const lun = Buffer.alloc(4); lun.writeUInt32BE(dati.length);
  const td = Buffer.concat([Buffer.from(tipo), dati]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([lun, td, crc]);
}

// Distanza di un punto da un segmento.
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function icona(lato) {
  const fondo = [17, 19, 22], segno = [232, 234, 238];
  const punti = [[0.29, 0.53], [0.44, 0.67], [0.72, 0.36]];
  const spessore = 0.085 * lato / 2;
  const righe = [];
  for (let y = 0; y < lato; y++) {
    const riga = Buffer.alloc(1 + lato * 3);
    for (let x = 0; x < lato; x++) {
      const px = x + 0.5, py = y + 0.5;
      let d = Infinity;
      for (let i = 0; i < punti.length - 1; i++) {
        d = Math.min(d, distSeg(px, py, punti[i][0] * lato, punti[i][1] * lato, punti[i + 1][0] * lato, punti[i + 1][1] * lato));
      }
      const a = Math.max(0, Math.min(1, spessore - d + 0.5));
      for (let c = 0; c < 3; c++) riga[1 + x * 3 + c] = Math.round(fondo[c] + (segno[c] - fondo[c]) * a);
    }
    righe.push(riga);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lato, 0); ihdr.writeUInt32BE(lato, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bit, RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    blocco('IHDR', ihdr),
    blocco('IDAT', zlib.deflateSync(Buffer.concat(righe), { level: 9 })),
    blocco('IEND', Buffer.alloc(0)),
  ]);
}

const cartella = path.join(__dirname, '..', 'docs', 'icone');
fs.mkdirSync(cartella, { recursive: true });
for (const lato of [180, 192, 512]) {
  fs.writeFileSync(path.join(cartella, `icon-${lato}.png`), icona(lato));
  console.log(`icone/icon-${lato}.png`);
}
