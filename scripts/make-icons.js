'use strict';
// Gera, a partir do logo.webp, as imagens que o site publica: ícones do app instalável, o ícone do iPhone e
// a imagem de prévia que aparece quando alguém compartilha o link (WhatsApp, Telegram, redes sociais).
// Só precisa rodar de novo se o logo mudar; os PNGs gerados ficam no repositório.
//
//   npm install --no-save sharp        (na raiz do projeto; não vira dependência)
//   node scripts/make-icons.js
//
// Saídas na raiz do projeto: icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, og-image.png
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const BG = '#0d1117'; // o mesmo fundo escuro do app (--bg) e do theme-color

// O logo é um adesivo com contorno escuro em fundo transparente: nas imagens sempre vai sobre o fundo do app.
async function trimmedLogo() {
  const { data, info } = await sharp(path.join(ROOT, 'logo.webp')).ensureAlpha().trim({ threshold: 8 }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Quadrado `size`, fundo sólido, logo inteiro dentro de uma caixa de `fill` (0–1) do lado, centralizado.
// `glow` põe um clarão suave atrás do logo (só no que é maior, como a imagem de prévia).
async function square(logo, size, fill, glow = false) {
  const box = Math.round(size * fill);
  const resized = await sharp(logo.data).resize({ width: box, height: box, fit: 'inside' }).toBuffer();
  const layers = [];
  if (glow) layers.push({ input: Buffer.from(glowSvg(size, size)), top: 0, left: 0 });
  layers.push({ input: resized, gravity: 'center' });
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } }).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

function glowSvg(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="g" cx="50%" cy="48%" r="60%">
    <stop offset="0%" stop-color="#1f3a34" stop-opacity="0.95"/><stop offset="55%" stop-color="#14231f" stop-opacity="0.55"/><stop offset="100%" stop-color="${BG}" stop-opacity="0"/>
  </radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
}

(async () => {
  const logo = await trimmedLogo();
  const out = (name, buf) => { fs.writeFileSync(path.join(ROOT, name), buf); console.log(`${name}: ${buf.length} bytes`); };

  // Ícones "qualquer": o logo ocupa quase tudo (o sistema só arredonda os cantos, se quiser).
  out('icon-512.png', await square(logo, 512, 0.9));
  out('icon-192.png', await sharp(await square(logo, 512, 0.9)).resize(192, 192).png({ compressionLevel: 9 }).toBuffer());
  // Ícone "maskable": o Android recorta em círculo/gota; o que importa tem de caber nos 80% centrais.
  out('icon-maskable-512.png', await square(logo, 512, 0.58));
  // iPhone: PNG opaco 180×180 (o iOS arredonda sozinho; fundo transparente viraria preto sem graça).
  out('apple-touch-icon.png', await sharp(await square(logo, 512, 0.9)).resize(180, 180).png({ compressionLevel: 9 }).toBuffer());

  // Prévia do link: 1200×630 (proporção que o WhatsApp e as redes usam), logo centralizado sobre um clarão suave.
  const W = 1200, H = 630;
  const h = Math.round(H * 0.84);
  const lg = await sharp(logo.data).resize({ height: h, fit: 'inside' }).toBuffer();
  out('og-image.png', await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
    .composite([{ input: Buffer.from(glowSvg(W, H)), top: 0, left: 0 }, { input: lg, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer());
})().catch(e => { console.error(e); process.exit(1); });
