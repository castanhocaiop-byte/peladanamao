// App instalável e prévia do link: confere que o manifesto, os ícones e as etiquetas de compartilhamento
// existem, têm o tamanho certo e estão liberados para o deploy (.vercelignore é uma lista de permitidos:
// arquivo que o site cita e não está lá devolve 404 — foi o que aconteceu com o icon-192.png das notificações).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// Tamanho de um PNG, lido do cabeçalho (sem depender de biblioteca de imagem).
function pngSize(file) {
  const b = fs.readFileSync(path.join(root, file));
  const ok = b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return ok ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
}

const html = read('index.html');
const head = html.slice(0, html.indexOf('</head>'));
const allowed = read('.vercelignore').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('!')).map(l => l.slice(1));
const meta = (attr, name) => (head.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];
const SITE = 'https://peladanamao.com.br/';

// ── manifesto ──────────────────────────────────────────────────────────────────────────────────
let manifest = null;
try { manifest = JSON.parse(read('manifest.webmanifest')); } catch (e) { /* abaixo */ }
check('manifest.webmanifest existe e é um JSON válido', !!manifest);
manifest = manifest || {};
check('manifesto: nome, nome curto e idioma', manifest.name === 'Pelada na Mão' && manifest.short_name === 'Pelada na Mão' && manifest.lang === 'pt-BR', manifest);
check('manifesto: abre como app (standalone) na raiz do site', manifest.display === 'standalone' && manifest.start_url === '/' && manifest.scope === '/' && manifest.id === '/', manifest);
check('manifesto: cores iguais às do app (fundo escuro #0d1117)', manifest.background_color === '#0d1117' && manifest.theme_color === '#0d1117' && meta('name', 'theme-color') === '#0d1117' && /--bg:\s*#0d1117/.test(html), manifest);
const icons = manifest.icons || [];
const find = (size, purpose) => icons.find(i => i.sizes === size && i.purpose === purpose && i.type === 'image/png');
check('manifesto: tem os ícones 192 e 512 ("any") e o 512 "maskable" que o Chrome exige para instalar', !!find('192x192', 'any') && !!find('512x512', 'any') && !!find('512x512', 'maskable'), icons);
for (const i of icons) {
  const f = (i.src || '').replace(/^\//, '');
  const [w, h] = String(i.sizes).split('x').map(Number);
  const real = exists(f) ? pngSize(f) : null;
  check(`ícone ${i.src}: o arquivo existe, é PNG e tem mesmo o tamanho que o manifesto diz (${i.sizes})`, !!real && real.w === w && real.h === h, { f, real });
  check(`ícone ${i.src}: está liberado no .vercelignore (senão o site publicado daria 404)`, allowed.includes(f), allowed);
}

// ── ícone do iPhone, prévia do link e arquivos de busca ───────────────────────────────────────
check('iPhone: apple-touch-icon é um PNG 180×180 e está citado no site', /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/.test(head) && pngSize('apple-touch-icon.png')?.w === 180 && pngSize('apple-touch-icon.png')?.h === 180);
check('o site cita o manifesto', /<link rel="manifest" href="\/manifest\.webmanifest">/.test(head));
const og = { type: meta('property', 'og:type'), title: meta('property', 'og:title'), desc: meta('property', 'og:description'), url: meta('property', 'og:url'), image: meta('property', 'og:image'), w: meta('property', 'og:image:width'), h: meta('property', 'og:image:height'), alt: meta('property', 'og:image:alt'), locale: meta('property', 'og:locale') };
check('prévia do link: título, descrição, endereço e texto da imagem preenchidos, em português', !!og.title && !!og.desc && og.url === SITE && !!og.alt && og.locale === 'pt_BR' && og.type === 'website', og);
check('prévia do link: o endereço da imagem é ABSOLUTO, no domínio do site, e o arquivo existe', og.image === SITE + 'og-image.png' && exists('og-image.png'), og);
check('prévia do link: a imagem está liberada no .vercelignore (senão o WhatsApp não mostra nada: o endereço é absoluto e não entra na conferência dos arquivos locais)', !!og.image && allowed.includes(String(og.image).slice(SITE.length)), { image: og.image, allowed });
check('prévia do link: a imagem é PNG de 1200×630 e a etiqueta diz o mesmo tamanho', pngSize('og-image.png')?.w === 1200 && pngSize('og-image.png')?.h === 630 && og.w === '1200' && og.h === '630', { real: pngSize('og-image.png'), og });
check('prévia do link: título e descrição curtos o bastante para não serem cortados (≤ 70 e ≤ 160 caracteres)', (og.title || '').length <= 70 && (og.desc || '').length <= 160, { t: (og.title || '').length, d: (og.desc || '').length });
check('prévia do link: cartão grande do Twitter/X', meta('name', 'twitter:card') === 'summary_large_image');
check('busca: description (≤ 160), canonical e título da página', (meta('name', 'description') || '').length > 40 && (meta('name', 'description') || '').length <= 160 && head.includes(`<link rel="canonical" href="${SITE}">`) && /<title>Pelada na Mão — [^<]+<\/title>/.test(head));
check('iPhone: nome do app na tela inicial', meta('name', 'apple-mobile-web-app-title') === 'Pelada na Mão');
check('robots.txt libera tudo e aponta o sitemap do site', /^Allow: \//m.test(read('robots.txt')) && read('robots.txt').includes(`Sitemap: ${SITE}sitemap.xml`));
const sitemapUrls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
check('sitemap.xml lista só páginas que existem e estão liberadas', sitemapUrls.length >= 1 && sitemapUrls.every(u => u.startsWith(SITE) && exists(u.slice(SITE.length) || 'index.html') && allowed.includes(u.slice(SITE.length) || 'index.html')), sitemapUrls);
check('robots.txt e sitemap.xml estão liberados no .vercelignore', allowed.includes('robots.txt') && allowed.includes('sitemap.xml') && allowed.includes('manifest.webmanifest'), allowed);

// ── toda imagem/ícone local citada no site, nas notificações e no manifesto existe e está liberada ──
const refs = new Set();
const grab = (text, re) => { for (const m of text.matchAll(re)) refs.add(m[1]); };
const asset = /['"(=]\s*\/([A-Za-z0-9._-]+\.(?:png|webp|ico|svg|webmanifest|jpg|jpeg))(?=[?'")\s])/g;
grab(html, asset); grab(read('firebase-messaging-sw.js'), asset); grab(read('manifest.webmanifest'), asset);
const missing = [...refs].filter(f => !exists(f));
const notAllowed = [...refs].filter(f => exists(f) && !allowed.includes(f));
check(`todo arquivo local citado existe (${refs.size} conferidos: ${[...refs].join(', ')})`, refs.size >= 6 && missing.length === 0, missing);
check('…e está na lista de permitidos do deploy (senão dá 404 no site publicado)', notAllowed.length === 0, notAllowed);
check('as notificações push usam o ícone que agora existe (antes dava 404)', refs.has('icon-192.png') && exists('icon-192.png'));

// ── um endereço só: o antigo (aceoma.vercel.app) redireciona para o domínio do produto ─────────────────
let vercel = null;
try { vercel = JSON.parse(read('vercel.json')); } catch (e) { /* abaixo */ }
check('vercel.json existe e é um JSON válido', !!vercel);
const rules = (vercel && vercel.redirects) || [];
const rule = rules[0] || {};
check('há UM redirecionamento, só para o host aceoma.vercel.app (o domínio do produto nunca redireciona)', rules.length === 1 && Array.isArray(rule.has) && rule.has.length === 1 && rule.has[0].type === 'host' && rule.has[0].value === 'aceoma.vercel.app', rules);
// Atenção: o padrão `/:path*` NÃO pega a raiz (/) na Vercel (confirmado em produção) — e a raiz é o endereço dos convites (/?invite=…). O padrão `/(.*)` pega tudo, inclusive a raiz.
check('…leva para o domínio do produto mantendo o caminho e a raiz (convites e páginas antigas continuam abrindo): /(.*) → /$1', rule.source === '/(.*)' && rule.destination === 'https://peladanamao.com.br/$1', rule);
check('…e o tipo (temporário/permanente) está declarado de forma explícita', typeof rule.permanent === 'boolean', rule);
check('vercel.json está liberado no .vercelignore (sem isso a Vercel nem o recebe e o redirecionamento não vale)', allowed.includes('vercel.json'), allowed);
const { siteFiles } = require(path.join(root, 'scripts', 'staging.js'));
check('o site de teste NÃO leva o vercel.json (é configuração da Vercel), mas leva todos os outros arquivos liberados', !siteFiles().includes('vercel.json') && allowed.filter(f => f !== 'vercel.json').every(f => siteFiles().includes(f)), siteFiles());
console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
