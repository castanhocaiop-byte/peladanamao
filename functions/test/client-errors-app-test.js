// Monitor de travamentos no app (index.html): o bloco do <head> roda aqui dentro de um navegador simulado (vm), e as
// funções do app (avisos dos erros que o app esconde, painel do dono) são extraídas e executadas de verdade. O que se
// confere: nunca vai dado de pessoa, a limpeza do app é IGUAL à do servidor, só fala no site de verdade, respeita os
// limites, nunca derruba o app, e o painel do dono mostra tudo escapado.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ce = require(path.join(__dirname, '..', 'client-errors.js'));

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
let fails = 0, oks = 0;
const check = (label, cond, extra) => {
  if (cond) oks++; else fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}

// ═══ o bloco do <head> ═══════════════════════════════════════════════════════════════════════════════════════════
const heads = html.match(/<script>\s*\/\* Monitor de travamentos\.[\s\S]*?<\/script>/g) || [];
check('existe UM bloco do monitor, e ele fica no <head>, antes de qualquer outro script do app', heads.length === 1 && html.indexOf(heads[0]) < html.indexOf('</head>') && html.indexOf(heads[0]) < html.indexOf('/firebasejs/') && html.indexOf(heads[0]) < html.indexOf("'use strict';") && html.indexOf(heads[0]) < html.indexOf('window.LP_ALLOWED'), heads.length);
const headSrc = heads[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
const headCode = headSrc.replace(/\/\*[\s\S]*?\*\//g, ''); // o código, sem os comentários
const es5Problems = [];
if (/=>/.test(headCode)) es5Problems.push('seta');
if (/\b(?:let|const)\s/.test(headCode)) es5Problems.push('let/const');
if (/\$\{/.test(headCode)) es5Problems.push('template');
if (/\b(?:async|await|class)\b/.test(headCode)) es5Problems.push('async/await/class');
if (/\?\.|\?\?/.test(headCode.replace(/'[^'\n]*'/g, "''"))) es5Problems.push('?. ou ??');
if (/\.\.\.[A-Za-z]/.test(headCode)) es5Problems.push('spread');
const backtickLines = headSrc.split('\n').filter(l => l.includes('`'));
if (backtickLines.length !== 1 || !/var QUOTED/.test(backtickLines[0])) es5Problems.push('crase fora da regra das aspas');
check('o monitor é ES5 puro (sem seta, let, const, template, async, ?. nem spread): precisa rodar até em navegador velho', es5Problems.length === 0, es5Problems);
check('…e o texto do bloco não tem nenhum "undefined"/"console" solto (nada vai para o console da pessoa)', !/console\./.test(headSrc));

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.169 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 12; SM-A525F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.29.110 Android (31/12; 480dpi; 1080x2186; samsung; SM-A525F; a52q; qcom; pt_BR; 493205287)',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.30.114;FBBV/12345;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBID/phone;FBLC/pt_BR]',
  webviewAndroid: 'Mozilla/5.0 (Linux; Android 11; Moto G Build/RPP1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.0.0 Mobile Safari/537.36',
  operaWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  unknown: 'SomeBot/1.0',
};

// Navegador simulado: tudo o que o monitor toca (janela, endereço, navegador, documento, armazenamento da aba, envio, relógio de
// timers). Nada sai de verdade: os envios ficam em `beacons` e `xhrs`.
function makeBrowser(o = {}) {
  const { host = 'peladanamao.com.br', ua = UA.chromeAndroid, onLine = true, beacon = 'ok', xhr = 'ok', lastModified = '2026-10-06T21:50:34Z', visibility = 'visible', session = 'ok', preset = {}, media = false, mediaThrows = false, navStandalone, firebase } = o;
  const listeners = [], timers = [], beacons = [], xhrs = [], data = { ...preset };
  const win = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: capture === true }),
    sessionStorage: session === 'throws' ? { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } } : { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } },
    matchMedia: mediaThrows ? () => { throw new Error('sem suporte'); } : () => ({ matches: media }),
  };
  const navigator = { userAgent: ua, onLine, standalone: navStandalone, sendBeacon: beacon === 'none' ? undefined : (url, blob) => { if (beacon === 'throws') throw new Error('x'); if (beacon === 'ok') beacons.push({ url, blob }); return beacon === 'ok'; } };
  win.navigator = navigator;
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } }
  class XHR { open(m, u, a) { this.m = m; this.u = u; this.async = a; this.headers = {}; } setRequestHeader(k, v) { this.headers[k] = v; } send(b) { if (xhr === 'throws') throw new Error('x'); this.body = b; xhrs.push(this); } }
  const sandbox = { window: win, location: { hostname: host, protocol: 'https:', host, href: 'https://' + host + '/?invite=SEGREDO123&liga=pelada-do-ze#frag' }, navigator, document: { lastModified, visibilityState: visibility }, Blob, XMLHttpRequest: xhr === 'none' ? undefined : XHR, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } };
  if (firebase) sandbox.firebase = firebase;
  win.document = sandbox.document;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(headSrc, ctx);
  const on = (type, capture) => listeners.filter(l => l.type === type && (capture === undefined || l.capture === capture));
  const payloads = () => beacons.map(b => JSON.parse(b.blob.parts[0])).concat(xhrs.map(x => JSON.parse(x.body)));
  const errEv = (e = {}) => ({ target: win, message: 'x', ...e });
  return { win, listeners, timers, beacons, xhrs, data, on, payloads, errEv, fireError: e => on('error')[0].fn(errEv(e)), fireReject: reason => on('unhandledrejection')[0].fn({ reason }) };
}
const errLike = (name, message, stack) => ({ name, message, stack });
const HOME = 'https://peladanamao.com.br/';

// ── só fala no site de verdade ───────────────────────────────────────────────────────────────────────────────────
for (const [host, project] of [['peladanamao.com.br', 'seriebaceoma'], ['www.peladanamao.com.br', 'seriebaceoma'], ['seriebaceoma-staging.web.app', 'seriebaceoma-staging'], ['seriebaceoma-staging.firebaseapp.com', 'seriebaceoma-staging']]) {
  const b = makeBrowser({ host });
  b.win.pnmReport('error', 'algo quebrou');
  check(`em ${host}: manda para a função do projeto ${project} (us-east1/reportClientError), como texto simples (sem pré-voo do CORS)`, b.beacons.length === 1 && b.beacons[0].url === `https://us-east1-${project}.cloudfunctions.net/reportClientError` && b.beacons[0].blob.type === 'text/plain;charset=UTF-8', b.beacons);
}
for (const host of ['localhost', '127.0.0.1', 'aceoma.vercel.app', 'aceoma-git-x.vercel.app', 'exemplo.com', 'peladanamao.com.br.exemplo.com', 'constructor', '__proto__', 'toString', '']) {
  const b = makeBrowser({ host });
  b.win.pnmReport('error', 'algo quebrou');
  check(`em "${host}": fica quieto (nenhum ouvinte, nenhum timer, nenhum envio)`, b.listeners.length === 0 && b.timers.length === 0 && b.beacons.length === 0 && b.xhrs.length === 0 && typeof b.win.pnmReport === 'function', [b.listeners.length, b.timers.length]);
}

// ── o relato ─────────────────────────────────────────────────────────────────────────────────────────────────────
let b = makeBrowser();
check('registra o ouvinte de erros na fase de CAPTURA (para pegar também arquivo que não carregou) e o de promessas rejeitadas', b.on('error', true).length === 1 && b.on('unhandledrejection').length === 1 && b.listeners.length === 2, b.listeners);
b.win.pnmCtx = () => ({ w: 'ranking' });
b.fireError({ error: errLike('TypeError', "Cannot read properties of undefined (reading 'x')", "TypeError: Cannot read properties of undefined (reading 'x')\n    at renderChamp (https://peladanamao.com.br/?invite=SEGREDO123&liga=pelada-do-ze:1234:56)\n    at render (https://peladanamao.com.br/:99:5)"), filename: HOME, lineno: 1234, colno: 56 });
let pl = b.payloads()[0];
check('erro de código: tipo, mensagem "Nome: texto", pilha limpa (convite some), versão pela data do arquivo, tela, navegador, sistema', pl.k === 'error' && pl.m === "TypeError: Cannot read properties of undefined (reading 'x')" && pl.s === "TypeError: Cannot read properties of undefined (reading 'x')\nat renderChamp ((página):1234:56)\nat render ((página):99:5)" && pl.v === '20261006.2150' && pl.w === 'ranking' && pl.b === 'Chrome 118' && pl.o === 'Android 13' && pl.a === 0 && pl.i === 0 && JSON.stringify(pl.x) === '{}', pl);
check('…só as chaves do formato (nada de uid, e-mail, liga, endereço da página, IP)', Object.keys(pl).sort().join() === 'a,b,i,k,m,o,s,v,w,x', Object.keys(pl));
check('…e NADA do convite, da liga nem do endereço sai do navegador', !/SEGREDO|pelada-do-ze|invite|liga=/.test(JSON.stringify(pl)));
check('o servidor aceita o relato do app do jeito que veio, e agrupa pelo trecho do código', (() => { const r = ce.parseReport(pl); return r.ok && r.report.kind === 'error' && r.report.fn === 'renderChamp' && r.report.browser === 'Chrome 118' && r.report.os === 'Android 13' && r.report.version === '20261006.2150' && r.report.view === 'ranking'; })(), ce.parseReport(pl));
b = makeBrowser();
b.fireError({ error: undefined, message: 'Uncaught ReferenceError: foo is not defined', filename: 'https://peladanamao.com.br/?invite=ABC', lineno: 77, colno: 3 });
pl = b.payloads()[0];
check('erro sem objeto (navegador não deu a pilha): usa a mensagem e monta um trecho com arquivo, linha e coluna (sem a consulta do endereço)', pl.m === 'Uncaught ReferenceError: foo is not defined' && pl.s === 'at (página):77:3' && !/ABC|invite/.test(JSON.stringify(pl)), pl);
check('…e o servidor acha o lugar do código nesse trecho', ce.parseReport(pl).report.loc === '(página):77', ce.parseReport(pl).report);
b = makeBrowser();
b.fireError({ error: 'lançaram um texto', message: 'Uncaught lançaram um texto', filename: '', lineno: 0, colno: 0 });
check('quem lança um texto (não um Error): a mensagem do navegador é usada', b.payloads()[0]?.m === 'Uncaught lançaram um texto', b.payloads());
b = makeBrowser({ ua: UA.chromeWin });
b.fireReject(errLike('FirebaseError', 'Missing or insufficient permissions.', ''));
b.fireReject('texto solto');
b.fireReject({ code: 'functions/internal', message: 'INTERNAL', name: 'FirebaseError' });
b.fireReject({ code: 'firestore/unavailable', message: 'The service is currently unavailable.', name: 'FirebaseError' });
b.fireReject({ code: 'auth/popup-closed-by-user', message: 'Firebase: Error (auth/popup-closed-by-user).' });
b.fireReject(undefined);
const rejs = b.payloads();
check('promessa rejeitada: Error, texto solto e objeto do Firebase (o código sai sem o prefixo "functions/" e "firestore/")', rejs.length === 4 && rejs[0].k === 'rejection' && rejs[0].m === 'FirebaseError: Missing or insufficient permissions.' && rejs[1].m === 'texto solto' && rejs[2].x.code === 'internal' && rejs[3].x.code === 'unavailable', rejs);
check('…a janela de login fechada pela pessoa e a rejeição vazia não são relatadas', !rejs.some(r => /popup-closed|undefined/.test(r.m)));

// ── arquivos que não carregaram ─────────────────────────────────────────────────────────────────────────────────
b = makeBrowser();
const el = (tagName, props) => ({ tagName, ...props });
b.fireError({ target: el('SCRIPT', { src: 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js?x=1' }) });
b.fireError({ target: el('SCRIPT', { src: 'https://peladanamao.com.br/algum-script.js' }) });
b.fireError({ target: el('SCRIPT', { src: 'https://peladanamao.com.br/_vercel/insights/script.js' }) });
b.fireError({ target: el('SCRIPT', { src: 'https://cdn.exemplo.com/lib.js' }) });
b.fireError({ target: el('IMG', { src: 'https://res.cloudinary.com/x/foto.jpg' }) });
b.fireError({ target: el('LINK', { href: 'https://fonts.googleapis.com/css2?family=Inter', rel: 'stylesheet' }) });
b.fireError({ target: el('IMG', { src: 'https://peladanamao.com.br/logo.webp' }) });
b.fireError({ target: el('LINK', { href: 'https://peladanamao.com.br/estilo.css', rel: 'stylesheet' }) });
const res = b.payloads();
check('arquivo que não carregou: só o Firebase e os scripts do próprio site; contador da Vercel, outros CDNs, imagens e fontes ficam de fora (muita gente bloqueia)', res.length === 2 && res.every(r => r.k === 'resource') && res[0].m === 'Falha ao carregar www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js' && /Falha ao carregar \/algum-script\.js/.test(res[1].m), res);
check('…e relato de arquivo não leva trecho de código', res.every(r => r.s === ''), res);

// ── a limpeza é a mesma do servidor ─────────────────────────────────────────────────────────────────────────────
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261006);
const frags = ['ana.souza@gmail.com', '+55 (11) 99999-8888', '123.456.789-09', '192.168.0.10', 'https://peladanamao.com.br/?invite=SEGREDO&liga=x', 'https://www.gstatic.com/firebasejs/10.14.1/a.js:12:5', 'http://127.0.0.1:8798/lab:218:33', 'https://localhost:3000/', 'https://u:p@exemplo.com/a/b?t=1#f', 'Xk9fPq2LmN7vB4tZ8cD1wE5yH3aG', 'leagues/pelada-do-ze/championships/AbCdEfGhIjKlMnOpQrSt', 'projects/p/databases/(default)/documents/users/UID123', "reading 'Jogador Muito Comprido Da Silva Pereira'", '"texto entre aspas bem comprido para sumir"', 'x', 'falhou', 'linha 1234 coluna 56', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg', 'chrome-extension://abcdef/c.js:1:2', '\n', '\t', 'at renderChamp (https://peladanamao.com.br/:1234:56)', 'renderChamp@https://peladanamao.com.br/index.html:9:9', 'çãõ é ü', '<script>alert(1)</script>', 'a'.repeat(80), '2026-10-06T21:50:34Z', 'v10.14.1', 'checkLeagueStillMineAndReloadEverything', "Cannot read properties of undefined (reading 'João Silva')", "(setting 'Neymar')", "(reading 'champion_players')", 'can\'t access property "Maria", x is undefined', 'a' + String.fromCharCode(7) + 'b', String.fromCharCode(0), String.fromCharCode(0x2028)];
const mismatches = [];
let n = 0;
for (let i = 0; i < 400; i++) {
  const parts = []; const len = 1 + Math.floor(rand() * 7);
  for (let j = 0; j < len; j++) parts.push(frags[Math.floor(rand() * frags.length)]);
  const s = parts.join(rand() < 0.5 ? ' ' : '');
  const expectedMsg = ce.sanitizeText(s, 300);
  const stackIn = parts.join('\n');
  const expectedStack = ce.sanitizeStack(stackIn);
  // o relato usa a mensagem + a pilha; cada um passa pela limpeza do app e deve dar o mesmo que a do servidor
  const pb = makeBrowser(); // cada texto numa abertura nova do app (o limite é de 5 por abertura)
  pb.win.pnmReport('error', { name: 'Error', message: s + ' #' + i, stack: stackIn });
  const sent = pb.beacons.length ? JSON.parse(pb.beacons[0].blob.parts[0]) : null;
  if (sent) {
    n++;
    const wantM = ce.sanitizeText('Error: ' + s + ' #' + i, 300);
    if (sent.m !== wantM || sent.s !== expectedStack) mismatches.push({ s, got: [sent.m, sent.s], want: [wantM, expectedStack] });
  }
}
check('limpeza do app e a do servidor dão EXATAMENTE o mesmo resultado (400 textos sorteados com e-mails, telefones, endereços, ids, aspas…, cada um numa abertura nova do app)', mismatches.length === 0 && n >= 300, { n, primeiro: mismatches[0] }); // os que faltam para 400 são os ignorados de propósito (extensão do navegador nos primeiros trechos da pilha)
{
  const msgs = ['Falhou para ana@x.com', 'at https://peladanamao.com.br/?invite=A:1:2', "reading 'Jogador Muito Comprido Da Silva Pereira'", 'uid Xk9fPq2LmN7vB4tZ8cD1wE5yH3aG', 'x'.repeat(900), '+55 (11) 99999-8888', 'documents/leagues/L/championships/AbCdEfGhIjKlMnOpQrSt'];
  const got = [];
  for (const m of msgs) { const small = makeBrowser(); small.win.pnmReport('error', m); if (small.beacons.length) got.push(JSON.parse(small.beacons[0].blob.parts[0]).m); }
  check('…e nos casos do teste do servidor também (um a um)', got.length === msgs.length && got.every((g, i) => g === ce.sanitizeText(msgs[i], 300)), got.map((g, i) => [g, ce.sanitizeText(msgs[i], 300)]));
}

// ── limites e cuidados ──────────────────────────────────────────────────────────────────────────────────────────
b = makeBrowser();
for (let i = 0; i < 3; i++) b.win.pnmReport('error', 'o mesmo erro de sempre');
check('o mesmo erro só vai UMA vez por abertura do app', b.payloads().length === 1);
b = makeBrowser();
for (let i = 0; i < 9; i++) b.win.pnmReport('error', 'erro diferente número ' + String.fromCharCode(97 + i) + 'x');
check('no máximo 5 relatos por abertura do app (um defeito em laço não vira enxurrada)', b.payloads().length === 5, b.payloads().length);
check('…e a aba guarda a conta (sessionStorage), então recarregar a página não zera o limite de 15 por aba', b.data.pnm_err_n === '5' && makeBrowser({ preset: { pnm_err_n: '15' } }).win.pnmReport('error', 'x') === undefined && (() => { const c = makeBrowser({ preset: { pnm_err_n: '15' } }); c.win.pnmReport('error', 'alguma coisa'); return c.payloads().length === 0; })() && (() => { const c = makeBrowser({ preset: { pnm_err_n: '14' } }); c.win.pnmReport('error', 'alguma coisa'); return c.payloads().length === 1 && c.data.pnm_err_n === '15'; })());
b = makeBrowser({ session: 'throws' });
b.win.pnmReport('error', 'com o armazenamento bloqueado'); b.win.pnmReport('error', 'outro com o armazenamento bloqueado');
check('armazenamento da aba bloqueado (modo privado): ainda relata, respeitando os 5 por abertura', b.payloads().length === 2);
b = makeBrowser();
const reported = errLike('Error', 'já avisado pelo app', ''); reported.pnmReported = true;
b.win.pnmReport('callable', reported); b.win.pnmReport('error', reported);
check('erro que o app já relatou (marca pnmReported) não é relatado de novo pelo ouvinte global', b.payloads().length === 0);
b = makeBrowser();
b.win.pnmReport('error', ''); b.win.pnmReport('error', '   '); b.win.pnmReport('error', null); b.win.pnmReport('error', undefined);
check('mensagem vazia: não manda nada', b.payloads().length === 0);
b = makeBrowser();
const ignoredCases = [
  'ResizeObserver loop limit exceeded', 'ResizeObserver loop completed with undelivered notifications.', 'Script error.', 'Firebase: Error (auth/popup-closed-by-user).', 'auth/cancelled-popup-request', 'AbortError: Share canceled',
];
ignoredCases.forEach(m => b.win.pnmReport('error', m));
b.win.pnmReport('error', errLike('Error', 'boom', 'Error: boom\n    at x (chrome-extension://abcdef/content.js:1:1)'));
b.win.pnmReport('error', errLike('Error', 'boom2', 'x@moz-extension://abcdef/c.js:1:1'));
b.win.pnmReport('error', 'veio de safari-web-extension://abc/x.js');
check('ruído conhecido e erro de extensão do navegador não são relatados (nem saem do aparelho)', b.payloads().length === 0, b.payloads());
b.win.pnmReport('error', errLike('Error', 'extensão só no fundo', 'at a (https://peladanamao.com.br/:1:1)\nat b (https://peladanamao.com.br/:2:2)\nat c (https://peladanamao.com.br/:3:3)\nat d (chrome-extension://x/y.js:1:1)'));
check('…mas extensão só no fundo da pilha não esconde um erro do app', b.payloads().length === 1);
b = makeBrowser({ onLine: false });
b.win.pnmReport('error', 'TypeError: Failed to fetch'); b.win.pnmReport('error', 'TypeError: outro erro qualquer sem internet');
check('sem internet: falha de rede não é relatada (não é defeito), outro erro continua sendo', b.payloads().length === 1 && /outro erro qualquer/.test(b.payloads()[0].m), b.payloads());
b = makeBrowser();
b.win.pnmReport('error', 'TypeError: Failed to fetch');
check('com internet: falha de rede é relatada (o servidor a guarda como "rede", fora das contas de defeito)', b.payloads().length === 1 && ce.parseReport(b.payloads()[0]).report.kind === 'network');

// ── contexto: tela, instalado, embutido, versão ─────────────────────────────────────────────────────────────────
b = makeBrowser(); b.win.pnmCtx = () => ({ w: 'financeiro' }); b.win.pnmReport('error', 'a');
check('a tela vem do app (pnmCtx)', b.payloads()[0].w === 'financeiro');
b = makeBrowser(); b.win.pnmCtx = () => { throw new Error('app quebrado'); }; b.win.pnmReport('error', 'a');
check('…se pnmCtx quebrar ou não existir, vai sem tela e sem estourar', b.payloads()[0].w === '' && (() => { const c = makeBrowser(); c.win.pnmReport('error', 'a'); return c.payloads()[0].w === ''; })());
b = makeBrowser(); b.win.pnmCtx = () => ({ w: { a: 1 } }); b.win.pnmReport('error', 'a');
check('…e tela que não é texto vira texto (o servidor descarta o que não for nome de tela)', typeof b.payloads()[0].w === 'string' && ce.parseReport(b.payloads()[0]).report.view === '');
for (const [rotulo, opts, esperado] of [['app instalado (display-mode: standalone)', { media: true }, 1], ['iPhone na tela inicial (navigator.standalone)', { navStandalone: true }, 1], ['navegador comum', {}, 0], ['sem matchMedia (quebra)', { mediaThrows: true }, 0]]) {
  const c = makeBrowser(opts); c.win.pnmReport('error', 'a');
  check(`instalado: ${rotulo} → a = ${esperado}`, c.payloads()[0].a === esperado, c.payloads()[0]);
}
const expectUa = { chromeAndroid: ['Chrome 118', 'Android 13', 0], chromeWin: ['Chrome 119', 'Windows', 0], safariIos: ['Safari 17', 'iOS 17', 0], chromeIos: ['Chrome 119', 'iOS 17', 0], firefoxLinux: ['Firefox 120', 'Linux', 0], edgeWin: ['Edge 119', 'Windows', 0], samsung: ['Samsung 23', 'Android 13', 0], instagramAndroid: ['Instagram 300', 'Android 12', 1], facebookIos: ['Facebook 430', 'iOS 17', 1], webviewAndroid: ['WebView 110', 'Android 11', 1], operaWin: ['Opera 105', 'Windows', 0], mac: ['Safari 17', 'macOS', 0], unknown: ['Outro', 'Outro', 0] };
for (const [nome, [bw, os, inapp]] of Object.entries(expectUa)) {
  const c = makeBrowser({ ua: UA[nome] }); c.win.pnmReport('error', 'a');
  const p = c.payloads()[0], srv = ce.parseReport(p).report;
  check(`navegador "${nome}" → ${bw} · ${os}${inapp ? ' · embutido' : ''} (e o servidor reconhece, sem trocar por "Outro")`, p.b === bw && p.o === os && p.i === inapp && srv.browser === bw && srv.os === os && srv.inapp === !!inapp, [p.b, p.o, p.i, srv.browser, srv.os]);
}
for (const [rotulo, lm, esperado] of [['data de publicação conhecida', '2026-10-06T21:50:34Z', '20261006.2150'], ['outra data', '2027-01-02T03:04:05Z', '20270102.0304'], ['texto sem data', 'não é data', 'x'], ['vazio', '', 'x'], ['"agora" (servidor não mandou o cabeçalho)', new Date().toString(), 'x'], ['há 1 minuto (também conta como "agora")', new Date(Date.now() - 60000).toString(), 'x']]) {
  const c = makeBrowser({ lastModified: lm }); c.win.pnmReport('error', 'a');
  check(`versão do app: ${rotulo} → ${esperado}`, c.payloads()[0].v === esperado, c.payloads()[0].v);
}
check('a versão é sempre em UTC (não depende do fuso de quem usa) e o servidor a aceita', (() => { const c = makeBrowser({ lastModified: '2026-10-06T23:59:59-03:00' }); c.win.pnmReport('error', 'a'); return c.payloads()[0].v === '20261007.0259' && ce.parseReport(c.payloads()[0]).report.version === '20261007.0259'; })());

// ── envio ───────────────────────────────────────────────────────────────────────────────────────────────────────
b = makeBrowser({ beacon: 'false' });
b.win.pnmReport('error', 'a');
check('sendBeacon recusa (fila cheia): usa XMLHttpRequest POST assíncrono, texto simples', b.xhrs.length === 1 && b.xhrs[0].m === 'POST' && b.xhrs[0].async === true && b.xhrs[0].u === 'https://us-east1-seriebaceoma.cloudfunctions.net/reportClientError' && b.xhrs[0].headers['Content-Type'] === 'text/plain;charset=UTF-8' && JSON.parse(b.xhrs[0].body).m === 'a', b.xhrs);
b = makeBrowser({ beacon: 'throws' }); b.win.pnmReport('error', 'a');
check('sendBeacon estoura: usa XMLHttpRequest', b.xhrs.length === 1 && b.beacons.length === 0);
b = makeBrowser({ beacon: 'none' }); b.win.pnmReport('error', 'a');
check('navegador sem sendBeacon: usa XMLHttpRequest', b.xhrs.length === 1);
let threw = false;
try { const c = makeBrowser({ beacon: 'none', xhr: 'none' }); c.win.pnmReport('error', 'a'); const d = makeBrowser({ beacon: 'throws', xhr: 'throws' }); d.win.pnmReport('error', 'a'); } catch (e) { threw = true; }
check('sem nenhum jeito de enviar: não estoura (o relato some em silêncio)', !threw);
b = makeBrowser();
b.win.pnmReport('error', errLike('Error', 'm'.repeat(100000), 'at f (https://peladanamao.com.br/:1:1)\n'.repeat(50000)));
check('mensagem e pilha gigantes: o relato continua pequeno (cabe nos 6 KB que o servidor aceita) e é aceito', b.beacons.length === 1 && b.beacons[0].blob.parts[0].length < ce.MAX_BODY_BYTES && ce.parseReport(JSON.parse(b.beacons[0].blob.parts[0])).ok, b.beacons[0]?.blob.parts[0].length);
b = makeBrowser();
const poison = { get name() { throw new Error('veneno'); }, get message() { throw new Error('veneno'); }, get stack() { throw new Error('veneno'); }, toString() { throw new Error('veneno'); } };
const circular = {}; circular.self = circular; circular.message = circular;
threw = false;
try { b.win.pnmReport('error', poison); b.win.pnmReport('error', circular); b.win.pnmReport('nada', Symbol ? 'ok' : 'ok'); b.fireError({ error: poison }); b.fireReject(poison); b.fireError(undefined); b.fireError({ target: { get tagName() { throw new Error('veneno'); } } }); b.on('error')[0].fn(null); b.on('unhandledrejection')[0].fn(undefined); } catch (e) { threw = true; }
check('entrada envenenada (getters que estouram, objeto circular, evento nulo): nada estoura para fora do monitor', !threw);

// ── a abertura travou? ──────────────────────────────────────────────────────────────────────────────────────────
b = makeBrowser();
b.win.pnmReport('error', errLike('Error', 'pilha longa', Array.from({ length: 30 }, (_, i) => '    at f' + i + ' (https://peladanamao.com.br/:' + (i + 10) + ':1)').join('\n') + '\n' + 'x'.repeat(5000)));
const longPl = b.payloads()[0];
check('pilha longa: o app manda no máximo 8 linhas e 1200 caracteres, iguais ao que o servidor faria', longPl.s.split('\n').length === 8 && longPl.s.length <= 1200 && longPl.s === ce.sanitizeStack(Array.from({ length: 30 }, (_, i) => '    at f' + i + ' (https://peladanamao.com.br/:' + (i + 10) + ':1)').join('\n') + '\n' + 'x'.repeat(5000)), longPl.s.length);

// ── nomes que o app conhece saem do texto ──
{
  const mk = names => { const c = makeBrowser(); c.win.pnmNames = typeof names === 'function' ? names : () => names; return c; };
  let c = mk(['Ana Souza', 'Caio', 'Pelada do Zé', 'Zé', 'Beto Silva']);
  c.win.pnmReport('error', errLike('TypeError', "Cannot read properties of undefined (reading 'caio') em Ana Souza e na Pelada do Zé, ana souza de novo", 'TypeError: x\n    at f (https://peladanamao.com.br/:1:1)\n    at Caio (https://peladanamao.com.br/:2:2)\n    at g (https://peladanamao.com.br/:3:3) Beto Silva'));
  let q = c.payloads()[0];
  check('nome de jogador, de liga e da pessoa, mesmo escrito de outro jeito (maiúscula, minúscula), sai da mensagem e da pilha (<nome>)', q.m === "TypeError: Cannot read properties of undefined (reading '<prop>') em <nome> e na <nome>, <nome> de novo" && /at <nome> \(\(página\):2:2\)/.test(q.s) && /\(página\):3:3\) <nome>$/.test(q.s) && !/Ana|Souza|Caio|Beto|Pelada do/.test(JSON.stringify(q)), q);
  c = mk(['Ana']);
  c.win.pnmReport('error', 'Canal Ana, Anabela, Anão, ana-maria, banana e ANA!');
  check('só palavra inteira (Canal, Anabela, Anão e banana ficam), sem diferenciar maiúscula, e o hífen separa palavras', c.payloads()[0].m === 'Canal <nome>, Anabela, Anão, <nome>-maria, banana e <nome>!', c.payloads()[0].m);
  c = mk(['Zé', 'Jo', ' ', '', null, 5, undefined, 'x'.repeat(200)]);
  c.win.pnmReport('error', 'Zé e Jo e x');
  check('nome de menos de 3 letras, vazio, número, nulo ou comprido demais (mais de 80) não entra na lista', c.payloads()[0].m === 'Zé e Jo e x', c.payloads()[0].m);
  c = mk(['Ana (Jr.)', 'a+b*c', '[xy]', 'Maria|Joana', '$&$1']);
  c.win.pnmReport('error', 'falhou com Ana (Jr.) e a+b*c e [xy] e Maria|Joana e $&$1 mas não com Maria nem Joana');
  check('nome com caracteres especiais de expressão regular é tratado como texto comum', c.payloads()[0].m === 'falhou com <nome> e <nome> e <nome> e <nome> e <nome> mas não com Maria nem Joana', c.payloads()[0].m);
  c = mk(['Beto', 'Beto Silva', 'beto silva']);
  c.win.pnmReport('error', 'Beto Silva e Beto');
  check('nome repetido ou dentro de outro: o mais comprido sai primeiro (nada de "<nome> Silva" sobrando)', c.payloads()[0].m === '<nome> e <nome>', c.payloads()[0].m);
  c = mk(['a'.repeat(100)]);
  c.win.pnmReport('error', 'veja ' + 'a'.repeat(100) + ' fim');
  check('nome comprido demais (mais de 80 letras) não entra na lista: o texto fica como veio', c.payloads()[0].m === 'veja ' + 'a'.repeat(100) + ' fim', c.payloads()[0].m.length);
  c = mk(Array.from({ length: 1000 }, (_, i) => 'Jogador' + String.fromCharCode(97 + (i % 26)) + i));
  c.win.pnmReport('error', 'Jogadorw100 e Jogadory700');
  check('a lista de nomes é limitada (os 400 mais compridos): o 100º sai, o 700º fica (limite que protege o tempo do relato)', c.payloads()[0].m === '<nome> e Jogadory700', c.payloads()[0].m);
  c = mk(Array(500).fill('Ana Souza').concat(['Caio']));
  c.win.pnmReport('error', 'Ana Souza e Caio');
  check('nome repetido na lista conta uma vez só (500 cópias não ocupam o limite e deixam os outros nomes de fora)', c.payloads()[0].m === '<nome> e <nome>', c.payloads()[0].m);
  c = mk(() => { throw new Error('lista quebrada'); });
  c.win.pnmReport('error', 'Falhou para Ana Souza');
  check('lista de nomes quebrada: o relato sai mesmo assim (só sem a limpeza dos nomes)', c.payloads().length === 1 && c.payloads()[0].m === 'Falhou para Ana Souza', c.payloads());
  c = mk(() => 'não é lista');
  c.win.pnmReport('error', 'Falhou para Ana Souza');
  check('lista de nomes que não é lista: ignorada, sem estourar', c.payloads().length === 1);
  c = mk(Array.from({ length: 1000 }, (_, i) => 'Jogador' + String.fromCharCode(97 + (i % 26)) + i));
  const t1 = Date.now(); c.win.pnmReport('error', 'Falhou para Jogadora0 e Jogadorb1');
  check('mil nomes: o relato continua saindo rápido (a lista é limitada)', c.payloads().length === 1 && Date.now() - t1 < 1000, Date.now() - t1);
  c = makeBrowser();
  c.win.pnmReport('error', 'Falhou para Ana Souza');
  check('sem lista de nomes (o app ainda não carregou): a limpeza normal vale', c.payloads()[0].m === 'Falhou para Ana Souza');
}

b = makeBrowser();
check('um timer de 20 segundos para conferir a abertura', b.timers.length === 1 && b.timers[0].ms === 20000, b.timers.map(t => t.ms));
b.timers[0].fn();
let bootPl = b.payloads()[0];
check('20 s sem o app ficar pronto e sem etapa nem Firebase: relato "boot" na etapa "sem-firebase" (o SDK nem carregou)', bootPl.k === 'boot' && bootPl.m === 'Carregamento não terminou em 20 s' && bootPl.x.step === 'sem-firebase' && bootPl.s === '', bootPl);
b = makeBrowser({ firebase: {} }); b.timers[0].fn();
check('…com o Firebase carregado mas o script do app sem começar: etapa "inicio"', b.payloads()[0].x.step === 'inicio');
for (const stage of ['main', 'init', 'auth', 'user', 'listeners']) {
  b = makeBrowser({ firebase: {} }); b.win.__pnmStage = stage; b.timers[0].fn();
  check(`…travado na etapa "${stage}": o relato diz qual (o servidor aceita o nome)`, b.payloads()[0].x.step === stage && ce.parseReport(b.payloads()[0]).report.x.step === stage, b.payloads()[0]);
}
b = makeBrowser(); b.win.__pnmBooted = true; b.timers[0].fn();
check('abertura concluída a tempo: nada é relatado', b.payloads().length === 0);
b = makeBrowser({ visibility: 'hidden' }); b.timers[0].fn();
check('aba em segundo plano (o navegador atrasa tudo): nada é relatado', b.payloads().length === 0);
b = makeBrowser({ visibility: undefined }); b.timers[0].fn();
check('navegador antigo sem visibilityState: relata normalmente', b.payloads().length === 1);

// ═══ o app (script principal) ════════════════════════════════════════════════════════════════════════════════════
const at = s => { const i = html.indexOf(s); if (i < 0) throw new Error('trecho não encontrado: ' + s); return i; };
check('etapas da abertura marcadas no código na ordem em que acontecem: main → init → auth → user (e a de listeners fica dentro de startListeners)', at("window.__pnmStage = 'main'") < at("window.__pnmStage = 'init'") && at("window.__pnmStage = 'init'") < at("window.__pnmStage = 'auth'") && at("window.__pnmStage = 'auth'") < at("window.__pnmStage = 'user'") && at("window.__pnmStage = 'listeners'") > 0);
check('…"main" é a primeira coisa do script principal', /<script>\s*'use strict';\s*window\.__pnmStage = 'main';/.test(html));
check('…"init" é a primeira linha de initFirebase e "listeners" a de startListeners', /function initFirebase\(\) \{\s*try \{\s*window\.__pnmStage = 'init';/.test(html) && /function startListeners\(\) \{\s*window\.__pnmStage = 'listeners';/.test(html));
check('…"auth" abre a volta da entrada e "user" vem depois de ler a conta, antes de decidir a liga', /onAuthStateChanged\(async user => \{\s*window\.__pnmStage = 'auth';/.test(html) && /window\.__pnmStage = 'user';\s*if \(!st\.leagueId\) \{/.test(html));
check('render(): a primeira linha marca a abertura como concluída quando o app está pronto (antes do desvio da apresentação, senão visitante novo nunca "abriu")', /function render\(\) \{\s*if \(st\.ready\) window\.__pnmBooted = true;/.test(html));
check('o contexto do relato é a tela atual do app', /window\.pnmCtx = \(\) => \(\{ w: st\.view \}\);/.test(html));
{
  const namesCode = slice('window.pnmNames = () =>', '\nconst CALL_BUG_CODES');
  const names = st => { const w = {}; new Function('st', 'window', namesCode)(st, w); return w.pnmNames(); };
  const lista = names({ players: [{ name: 'Ana' }, { name: 5 }], ranks: [{ name: 'Beto' }], finAvulsos: [{ nome: 'Convidado' }, {}], availableLeagues: [{ name: 'Liga X' }], authUser: { displayName: 'Dono' }, userDoc: { displayName: 'Dono D', name: 'Nome Dele' } });
  check('a lista de nomes do app: elenco, ranking, convidados avulsos, ligas, a conta e o cadastro da pessoa (só o que é texto)', JSON.stringify(lista.sort()) === JSON.stringify(['Ana', 'Beto', 'Convidado', 'Dono', 'Dono D', 'Liga X', 'Nome Dele'].sort()), lista);
  check('…com o app ainda vazio ou com dados incompletos: lista vazia, sem estourar', names({}).length === 0 && names({ players: null, authUser: null, userDoc: null }).length === 0);
}
const sl = slice('function startListeners() {', '// Move para "contacts"');
const colls = [...sl.matchAll(/col\('([a-z_]+)'\)\.onSnapshot\(/g)].map(m => m[1]);
check('as 10 listas em tempo real são as esperadas', colls.join() === 'championships,player_titles,player_registry,financeiro_config,financeiro_mensalidades,financeiro_despesas,financeiro_avulsos,app_config,player_photos,contacts', colls);
check('cada uma tem o aviso de erro com o próprio nome, e nenhuma ficou com o erro engolido em silêncio', colls.every(c => new RegExp(`listenerFailed\\('${c}', err\\)`).test(sl)) && (sl.match(/listenerFailed\(/g) || []).length === 10 && !/\}, \(\)\s*=>\s*\{\s*\}/.test(sl), (sl.match(/listenerFailed\(/g) || []).length);
check('…e a lista de campeonatos continua fazendo o que fazia ao falhar (liberar a tela e conferir se a pessoa ainda é da liga)', /listenerFailed\('championships', err\); st\.ready = true; render\(\); checkLeagueStillMine\(\);/.test(sl) && /listenerFailed\('player_titles', err\); st\.ranksReady = true; render\(\);/.test(sl) && /listenerFailed\('player_registry', err\); st\.playersReady = true; render\(\);/.test(sl) && /listenerFailed\('app_config', err\); st\.cfgReady = true; render\(\);/.test(sl));
check('entrada que caiu no padrão e falha ao conectar são relatadas (mas "unavailable"/"cancelled" na entrada não: é conexão)', /authCode !== 'unavailable' && authCode !== 'cancelled'\) pnmErr\('auth', e, \{ code: authCode \}\)/.test(html) && /pnmErr\('boot', e, \{ step: 'init' \}\);\s*st\.ready = true; render\(\);\s*toast\('Erro ao conectar/.test(html));

// funções reais, com o ambiente simulado
const helpers = slice('async function callFn(name, data) {', '// Multi-tenant helpers');
function makeApp({ fnImpl, reportThrows = false } = {}) {
  const reported = [];
  const win = { pnmReport: (k, e, x) => { if (reportThrows) throw new Error('monitor quebrado'); reported.push({ k, e, x }); } };
  const env = { st: { view: 'ranking' }, window: win, FN: fnImpl ? { httpsCallable: name => data => fnImpl(name, data) } : null };
  const names = Object.keys(env);
  const api = new Function(...names, helpers + '\nreturn { callFn, listenerFailed, pnmErr, CALL_BUG_CODES };')(...names.map(n => env[n]));
  return { api, reported, win };
}
(async () => {
  for (const [code, relata] of [['functions/internal', true], ['functions/unknown', true], ['functions/data-loss', true], ['functions/deadline-exceeded', true], ['internal', true], ['functions/permission-denied', false], ['functions/unauthenticated', false], ['functions/invalid-argument', false], ['functions/not-found', false], ['functions/unavailable', false], ['functions/resource-exhausted', false], ['functions/failed-precondition', false], ['functions/already-exists', false], ['', false]]) {
    const app = makeApp({ fnImpl: async () => { throw Object.assign(new Error('mensagem do servidor'), { code }); } });
    let err; try { await app.api.callFn('trackEvent', {}); } catch (e) { err = e; }
    const cc = code.replace('functions/', '');
    check(`função do servidor falhou com "${code}": ${relata ? 'o monitor é avisado (função e código)' : 'não é defeito, o monitor não é avisado'}; a pessoa continua vendo o mesmo erro de antes`, relata ? app.reported.length === 1 && app.reported[0].k === 'callable' && app.reported[0].x.code === cc && app.reported[0].x.fn === 'trackEvent' && err.pnmReported === true && err.code === cc : app.reported.length === 0 && !err.pnmReported, { reported: app.reported.length, err: err?.code });
  }
  const appOk = makeApp({ fnImpl: async () => ({ data: { ok: true } }) });
  check('função que deu certo: nada é relatado e o resultado vem igual', (await appOk.api.callFn('x', {})).ok === true && appOk.reported.length === 0);
  const appThrow = makeApp({ fnImpl: async () => { throw Object.assign(new Error('x'), { code: 'functions/internal' }); }, reportThrows: true });
  let err2; try { await appThrow.api.callFn('x', {}); } catch (e) { err2 = e; }
  check('monitor quebrado não atrapalha o app: a função falhou e o erro certo continua chegando a quem chamou', err2 && err2.code === 'internal' && /Não foi possível concluir agora/.test(err2.message), err2?.message);
  const appInternalMsg = makeApp({ fnImpl: async () => { throw Object.assign(new Error('INTERNAL'), { code: 'functions/internal' }); } });
  let err3; try { await appInternalMsg.api.callFn('trackEvent', {}); } catch (e) { err3 = e; }
  check('o relato da função leva o erro ORIGINAL do Firebase (e o erro novo, que a tela mostra, leva a marca de "já relatado")', appInternalMsg.reported[0].e.message === 'INTERNAL' && err3.pnmReported === true);
  check('sem conexão com o servidor (FN ausente): erro de antes, sem relato', await (async () => { const a = makeApp({}); try { await a.api.callFn('x', {}); } catch (e) { return /Sem conexão/.test(e.message) && a.reported.length === 0; } return false; })());
  for (const [code, relata] of [['permission-denied', false], ['firestore/permission-denied', false], ['cancelled', false], ['firestore/cancelled', false], ['unavailable', true], ['firestore/unavailable', true], ['failed-precondition', true], ['resource-exhausted', true], ['internal', true], ['deadline-exceeded', true], ['', true]]) {
    const app = makeApp({});
    app.api.listenerFailed('championships', Object.assign(new Error('x'), { code }));
    check(`lista em tempo real falhou com "${code}": ${relata ? 'relatada, com a coleção e o código sem prefixo' : 'ignorada (normal quando a pessoa sai da liga ou a lista é fechada)'}`, relata ? app.reported.length === 1 && app.reported[0].k === 'listener' && app.reported[0].x.col === 'championships' && app.reported[0].x.code === code.replace('firestore/', '') : app.reported.length === 0, app.reported);
  }
  check('lista com erro sem objeto (undefined/null): não estoura', (() => { const app = makeApp({}); try { app.api.listenerFailed('x', undefined); app.api.listenerFailed('x', null); return true; } catch (e) { return false; } })());
  check('o aviso ao monitor nunca estoura, mesmo com o monitor quebrado ou ausente', (() => { const a = makeApp({ reportThrows: true }); const c = makeApp({}); delete c.win.pnmReport; try { a.api.pnmErr('error', new Error('x')); c.api.pnmErr('error', new Error('x')); a.api.listenerFailed('c', new Error('y')); return true; } catch (e) { return false; } })());
  check('os códigos que contam como defeito do servidor são só estes: internal, unknown, data-loss, deadline-exceeded', JSON.stringify(makeApp({}).api.CALL_BUG_CODES) === '["internal","unknown","data-loss","deadline-exceeded"]');

  // ═══ painel do dono: seção "Erros do app" ═══════════════════════════════════════════════════════════════════
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const panelCode = slice('/* ── Painel do dono: métricas do funil', '/* ── Excluir a própria conta');
  function makePanel({ callFn, copyOk = true, owner = true } = {}) {
    const layers = [];
    let errBox = null;
    const doc = {
      getElementById: id => {
        const layer = layers.find(x => x.id === id);
        if (layer) return Object.assign(layer, { remove: () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); errBox = null; } });
        if (id === 'owner-errors') { const root = layers.find(x => x.id === 'owner-metrics'); return root && /id="owner-errors"/.test(root.innerHTML) ? (errBox = errBox || { innerHTML: '' }) : null; }
        return null;
      },
      createElement: () => { const el = { id: '', className: '', innerHTML: '', remove() { const i = layers.indexOf(el); if (i >= 0) layers.splice(i, 1); errBox = null; } }; return el; },
      body: { appendChild: el => layers.push(el) },
    };
    const copied = [], toasts = [], calls = [];
    const env = { st: { authUser: owner ? { email: 'castanho.caiop@gmail.com', emailVerified: true } : null }, callFn: async (n, d) => { calls.push(n); return callFn(n, d); }, esc, document: doc, pixCopyText: async t => { copied.push(t); return copyOk; }, toast: (m, t) => toasts.push([m, t]) };
    const names = Object.keys(env);
    const api = new Function(...names, panelCode + '\nreturn { openOwnerMetrics, clientErrorsHtml, errorReportText, copyErrorReport, ownerMetricsHtml, getErrors: () => _ownerErrors, setErrors: v => { _ownerErrors = v; } };')(...names.map(n => env[n]));
    return { api, layers, copied, toasts, calls, errBox: () => errBox };
  }
  const E = (over = {}) => ({
    ok: true, generatedAt: '2026-10-06T15:00:00.000Z',
    totals: { reports7d: 14, crashes7d: 12, today: 5, groups7d: 3, newGroups48h: 1 },
    days: Array.from({ length: 14 }, (_, i) => ({ day: '2026-09-' + (23 + i), total: i, dropped: 0 })),
    groups: [
      { fp: 'a1', kind: 'error', message: 'TypeError: renderChamp is not a function', fn: 'renderChamp', loc: '(página):1234', stack: "TypeError: x\nat renderChamp ((página):1234:56)", count: 30, last7: 9, today: 4, yesterday: 3, spark: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2, 3, 4], firstSeen: '2026-09-20T12:00:00.000Z', lastSeen: '2026-10-06T14:00:00.000Z', isNew: false, versions: [{ name: '20261006.2150', count: 7 }, { name: 'x', count: 2 }], browsers: [{ name: 'Chrome 118', count: 6 }, { name: 'Safari 17', count: 3 }], oses: [{ name: 'Android 13', count: 9 }], views: [{ name: 'ranking', count: 9 }], codes: [], extra: { fn: '', col: '', step: '' }, standalone: 2, inapp: 1 },
      { fp: 'b2', kind: 'boot', message: 'Carregamento não terminou em 20 s', fn: '', loc: '', stack: '', count: 3, last7: 3, today: 1, yesterday: 2, spark: Array(14).fill(0), firstSeen: '2026-10-05T12:00:00.000Z', lastSeen: '2026-10-06T14:00:00.000Z', isNew: true, versions: [], browsers: [{ name: 'Instagram 300', count: 3 }], oses: [{ name: 'iOS 17', count: 3 }], views: [], codes: [], extra: { fn: '', col: '', step: 'auth' }, standalone: 0, inapp: 3 },
      { fp: 'c3', kind: 'network', message: 'TypeError: Failed to fetch', fn: '', loc: '', stack: '', count: 2, last7: 2, today: 0, yesterday: 0, spark: Array(14).fill(0), firstSeen: '2026-10-01T12:00:00.000Z', lastSeen: '2026-10-04T14:00:00.000Z', isNew: false, versions: [], browsers: [], oses: [], views: [], codes: [{ name: 'unavailable', count: 2 }], extra: { fn: 'trackEvent', col: 'championships', step: '' }, standalone: 0, inapp: 0 },
    ],
    omitted: 4, ...over,
  });
  const P = makePanel({ callFn: async () => ({}) }).api;
  check('seção de erros: carregando', /Erros do app \(14 dias\)/.test(P.clientErrorsHtml(null)) && /Carregando…/.test(P.clientErrorsHtml(null)));
  const failed = P.clientErrorsHtml({ e: new Error('Só o dono <b>vê</b>') });
  check('…falhou: mostra a mensagem ESCAPADA, sem derrubar o resto', /Só o dono &lt;b&gt;vê&lt;\/b&gt;/.test(failed) && !/<b>vê/.test(failed));
  check('…falhou sem mensagem: texto padrão', /Não foi possível carregar agora/.test(P.clientErrorsHtml({ e: {} })));
  const empty = P.clientErrorsHtml({ r: { ok: true, totals: {}, groups: [], days: [] } });
  check('…sem nenhum erro: mensagem de comemoração e o que o monitor não conta', /Nenhum erro registrado nos últimos 14 dias/.test(empty) && /🎉/.test(empty) && /extensão do navegador/.test(empty) && !/Copiar relatório/.test(empty));
  const full = P.clientErrorsHtml({ r: E() });
  const plain = full.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('…com erros: totais de hoje, de 7 dias (defeitos e rede), tipos e novos', /Relatos hoje\s*5/.test(plain) && /Relatos em 7 dias\s*14 \(12 defeitos · 2 de rede\)/.test(plain) && /Tipos de erro em 7 dias\s*3/.test(plain) && /Tipos novos nas últimas 48 h\s*1/.test(plain), plain.slice(0, 500));
  check('…cada grupo: tipo em português, mensagem e quantos nos últimos 7 dias; o novo tem 🆕 e os outros o ícone do tipo', /Erro no código/.test(plain) && /App travado na abertura/.test(plain) && /Rede/.test(plain) && /💥/.test(full) && /🆕/.test(full) && /📶/.test(full) && /9\s*\/7 dias/.test(plain) && /3\s*\/7 dias/.test(plain), plain.slice(0, 900));
  check('…os detalhes: hoje/ontem/total, datas, telas, navegadores, sistemas, versões, códigos, instalado, embutido, onde e a pilha', /Hoje: 4 · ontem: 3 · total: 30/.test(plain) && /Primeira vez: 20\/09/.test(plain) && /Telas: ranking \(9\)/.test(plain) && /Navegadores: Chrome 118 \(6\), Safari 17 \(3\)/.test(plain) && /Sistemas: Android 13 \(9\)/.test(plain) && /Versões do app: 20261006\.2150 \(7\), x \(2\)/.test(plain) && /Códigos: unavailable \(2\)/.test(plain) && /Com o app instalado: 2 · Em navegador embutido \(Instagram, Facebook…\): 1/.test(plain) && /Onde: função renderChamp · \(página\):1234/.test(plain) && /Onde: parou em auth/.test(plain) && /Onde: função do servidor trackEvent · lista championships/.test(plain) && /at renderChamp \(\(página\):1234:56\)/.test(plain), plain.slice(500, 2200));
  check('…gráfico de 14 barras por grupo, botão de copiar e o aviso dos que ficaram de fora', (full.match(/<i style="display:block;width:4px/g) || []).length === 14 * 3 && /onclick="copyErrorReport\(\)"/.test(full) && /E mais 4 tipo\(s\) de erro menos frequentes/.test(plain));
  check('…nenhum "undefined", "NaN" ou "null" na tela', !/undefined|NaN|null/.test(full), full.match(/.{20}(undefined|NaN|null).{20}/)?.[0]);
  const evil = '<img src=x onerror=alert(1)>';
  const evilHtml = P.clientErrorsHtml({ r: E({ groups: [{ ...E().groups[0], message: evil, fn: evil, loc: evil, stack: evil, versions: [{ name: evil, count: 1 }], browsers: [{ name: evil, count: 1 }], views: [{ name: evil, count: 1 }], codes: [{ name: evil, count: 1 }], oses: [{ name: evil, count: 1 }], extra: { fn: evil, col: evil, step: evil }, kind: evil }] }) });
  check('texto que veio de fora (mensagem, função, trecho, pilha, versões, navegadores, telas, códigos, tipo) sai todo ESCAPADO: nada executa', !/<img/.test(evilHtml) && (evilHtml.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 9, (evilHtml.match(/&lt;img/g) || []).length);
  check('resposta estranha (campos faltando, grupos nulos) não quebra a seção', (() => { try { P.clientErrorsHtml({ r: {} }); P.clientErrorsHtml({ r: { groups: [{}] } }); P.clientErrorsHtml({ r: { groups: [{ kind: 'zzz', spark: null, versions: null }], totals: null } }); P.clientErrorsHtml({}); return true; } catch (e) { return false; } })());
  const rep = P.errorReportText(E());
  check('relatório para copiar: texto simples (sem HTML) com os totais, cada grupo, contagens, telas, navegadores, onde e a pilha indentada', !/<[a-z]/i.test(rep) && /^Relatório de erros do app \(14 dias\), gerado em /.test(rep) && /Relatos: hoje 5 · 7 dias 14 \(12 defeitos\) · tipos em 7 dias 3 · novos em 48 h 1/.test(rep) && /1\. \[Erro no código\] TypeError: renderChamp is not a function\n   7 dias: 9 · hoje: 4 · ontem: 3 · total: 30/.test(rep) && /2\. \[App travado na abertura\] Carregamento não terminou em 20 s  \(NOVO\)/.test(rep) && /Telas: ranking \(9\) · Navegadores: Chrome 118 \(6\), Safari 17 \(3\)/.test(rep) && /Onde: função renderChamp · \(página\):1234/.test(rep) && /   Pilha:\n     TypeError: x\n     at renderChamp/.test(rep) && /\(mais 4 tipo\(s\) de erro menos frequentes não listados\)$/.test(rep), rep);
  check('…aguenta resposta vazia sem estourar', P.errorReportText({}).startsWith('Relatório de erros do app') && P.errorReportText(undefined).startsWith('Relatório'));

  // abrir o painel: funil e erros juntos
  let p = makePanel({ callFn: async n => (n === 'getFunnelMetrics' ? { funnel: { accounts: {}, leagues: {}, states: {}, rates: {}, trialCohort: {}, revenue: {} }, events: {}, history: [] } : E()) });
  await p.api.openOwnerMetrics();
  check('painel do dono: mostra o funil E a seção de erros (as duas chamadas saem juntas)', p.layers.length === 1 && /Métricas do sistema/.test(p.layers[0].innerHTML) && /id="owner-errors"/.test(p.layers[0].innerHTML) && /Erros do app \(14 dias\)/.test(p.layers[0].innerHTML) && p.errBox() && /Tipos novos nas últimas 48 h/.test(p.errBox().innerHTML) && p.api.getErrors().r.totals.today === 5, { box: p.errBox()?.innerHTML.slice(0, 120) });
  let releaseErr; const slowErr = new Promise(r => { releaseErr = r; });
  p = makePanel({ callFn: async n => { if (n === 'getClientErrors') { await slowErr; return E(); } return { funnel: {}, events: {}, history: [] }; } });
  const opening = p.api.openOwnerMetrics();
  await new Promise(r => setTimeout(r, 10));
  check('erros demoram mais que o funil: o funil aparece sem esperar e a seção mostra "Carregando…"', p.layers.length === 1 && /Métricas do sistema/.test(p.layers[0].innerHTML) && /Calculando|Funil/.test(p.layers[0].innerHTML) && /Carregando…/.test(p.layers[0].innerHTML), p.layers[0]?.innerHTML.slice(-300));
  releaseErr(); await opening;
  check('…e quando chegam entram no lugar', /Relatos hoje/.test(p.errBox().innerHTML) && !/Carregando…/.test(p.errBox().innerHTML));
  p = makePanel({ callFn: async n => { if (n === 'getClientErrors') throw new Error('Só o dono do sistema vê os erros do app.'); return { funnel: {}, events: {}, history: [] }; } });
  await p.api.openOwnerMetrics();
  check('só os erros falharam: o funil continua na tela e a seção diz o motivo', /Métricas do sistema/.test(p.layers[0].innerHTML) && /Só o dono do sistema vê os erros do app/.test(p.errBox().innerHTML), p.errBox()?.innerHTML);
  p = makePanel({ callFn: async n => { if (n === 'getFunnelMetrics') throw new Error('funil fora do ar'); return E(); } });
  await p.api.openOwnerMetrics();
  check('só o funil falhou: a mensagem do funil aparece e os erros do app continuam acessíveis', /funil fora do ar/.test(p.layers[0].innerHTML) && /id="owner-errors"/.test(p.layers[0].innerHTML) && /Relatos hoje/.test(p.errBox().innerHTML));
  p = makePanel({ callFn: async () => { throw new Error('tudo fora'); } });
  let thrown = false; try { await p.api.openOwnerMetrics(); } catch (e) { thrown = true; }
  check('as duas falharam: nada estoura e a camada mostra os dois motivos', !thrown && /tudo fora/.test(p.layers[0].innerHTML) && /tudo fora/.test(p.errBox().innerHTML));
  let relErr2; const slowErr2 = new Promise(r => { relErr2 = r; });
  p = makePanel({ callFn: async n => { if (n === 'getClientErrors') { await slowErr2; return E(); } return { funnel: {}, events: {}, history: [] }; } });
  const op3 = p.api.openOwnerMetrics();
  await new Promise(r => setTimeout(r, 10));
  p.layers[0].remove();
  relErr2(); await op3;
  check('a pessoa fechou o painel antes dos erros chegarem: nada ressuscita nem estoura', p.layers.length === 0);
  let relFunnel; const slowFunnel = new Promise(r => { relFunnel = r; });
  p = makePanel({ callFn: async n => { if (n === 'getFunnelMetrics') { await slowFunnel; return { funnel: {}, events: {}, history: [] }; } return E(); } });
  const op4 = p.api.openOwnerMetrics();
  await new Promise(r => setTimeout(r, 10));
  const chamadasAntes = p.calls.slice();
  relFunnel(); await op4;
  check('as duas chamadas saem JUNTAS: com o funil ainda carregando, os erros do app já foram pedidos (não esperam um pelo outro)', chamadasAntes.join() === 'getFunnelMetrics,getClientErrors', chamadasAntes);
  // abrir o painel de novo antes de os erros do primeiro chegarem: os erros velhos não escrevem no painel novo
  let relA; const slowA = new Promise(r => { relA = r; }); let nErr = 0;
  p = makePanel({ callFn: async n => {
    if (n === 'getClientErrors') { nErr++; if (nErr === 1) { await slowA; return E({ totals: { ...E().totals, today: 5 } }); } return E({ totals: { ...E().totals, today: 9 } }); }
    return { funnel: {}, events: {}, history: [] };
  } });
  const first = p.api.openOwnerMetrics();
  await new Promise(r => setTimeout(r, 10));
  await p.api.openOwnerMetrics();
  const hoje = () => (p.errBox().innerHTML.replace(/<[^>]+>/g, ' ').match(/Relatos hoje\s*(\d+)/) || [])[1];
  check('painel aberto de novo (o segundo carregou rápido): mostra os erros do segundo', hoje() === '9', hoje());
  relA(); await first;
  check('…e quando os erros do primeiro (que demorou) chegam, NÃO escrevem por cima do painel novo nem trocam o que o botão de copiar copia', hoje() === '9' && p.api.getErrors().r.totals.today === 9, [hoje(), p.api.getErrors().r.totals.today]);
  p = makePanel({ callFn: async () => ({}), owner: false });
  await p.api.openOwnerMetrics();
  check('quem não é o dono: o painel nem abre e nenhuma das duas funções é chamada', p.layers.length === 0);

  // copiar o relatório
  p = makePanel({ callFn: async n => (n === 'getFunnelMetrics' ? { funnel: {}, events: {}, history: [] } : E()) });
  await p.api.openOwnerMetrics();
  await p.api.copyErrorReport();
  check('"Copiar relatório": copia o texto do relatório e avisa que é só colar na conversa com o Claude', p.copied.length === 1 && /^Relatório de erros do app/.test(p.copied[0]) && p.toasts.length === 1 && /Relatório copiado/.test(p.toasts[0][0]) && p.toasts[0][1] === 'ok', { copied: p.copied.length, toasts: p.toasts });
  p = makePanel({ callFn: async n => (n === 'getFunnelMetrics' ? { funnel: {}, events: {}, history: [] } : E()), copyOk: false });
  await p.api.openOwnerMetrics(); await p.api.copyErrorReport();
  check('…se o navegador não deixar copiar: diz que não foi possível (sem "ok")', /Não foi possível copiar/.test(p.toasts[0][0]) && p.toasts[0][1] === undefined, p.toasts);
  p = makePanel({ callFn: async () => ({}) });
  await p.api.copyErrorReport();
  p.api.setErrors({ e: new Error('x') }); await p.api.copyErrorReport();
  check('…sem relatório carregado (ainda carregando ou falhou): não copia nada', p.copied.length === 0 && p.toasts.length === 0);

  // ═══ texto de privacidade ═════════════════════════════════════════════════════════════════════════════════════
  const priv = slice('function openPrivacyPolicy() {', 'Responsável pelos seus dados');
  check('a política de privacidade do app explica os relatos de erro: o que vai, o que NÃO vai, o IP só na memória e os 45 dias', /<strong>Relatos de erro:<\/strong>/.test(priv) && /mensagem do erro, o trecho do código, a versão do app, a tela em que você estava e o tipo do navegador/.test(priv) && /Não leva nome, e-mail, WhatsApp, nome da liga, o que você digitou nem o endereço completo da página/.test(priv) && /endereço de IP só é visto na hora, na memória, para barrar abuso, e o app não o guarda/.test(priv) && /o app ainda tira do texto os nomes que conhece \(jogadores, convidados, o seu e o da liga\)/.test(priv) && /apagados depois de 45 dias/.test(priv) && ce.KEEP_GROUP_DAYS === 45);

  console.log(`\n${fails === 0 ? `Todos os testes passaram (${oks})` : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
