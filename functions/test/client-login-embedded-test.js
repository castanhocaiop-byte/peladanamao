// Login dentro do navegador de outro aplicativo (Instagram, TikTok, Facebook…), no index.html. Extrai o código real e o executa num ambiente
// simulado, sem navegador. O Google barra o login com a conta Google nesses navegadores (erro 403 disallowed_useragent) e o link de acesso do
// e-mail abre em outro navegador, que não tem o e-mail guardado. Antes: o botão do Google falhava com o texto técnico "Erro Google: …" e o link
// de acesso aberto em outro navegador não fazia nada. Agora: aviso com a saída (abrir no Chrome/Safari, copiar o link, e-mail e senha),
// mensagens em português e confirmação do e-mail no link de acesso.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim();

// O código real, em quatro pedaços: o link do Chrome (Android), o link de acesso por e-mail, o login do Google e a tela de login com os ajudantes.
const siteSrc = slice('function parseSiteOrigin(origin) {', '// Decide se mostra o convite');
const authSrc = slice('async function sendMagicLink(email) {', 'async function doLoginEmail(mode) {');
const googleSrc = slice('// Texto em português para quem não conseguiu entrar com o Google', 'async function doLoginMagicLink() {');
const loginSrc = slice('function vLogin() {', 'function slugify(');

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
  operaAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 OPR/80.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariIpadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  edgeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android (34/14; 480dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; pt_BR; 000000000)',
  instagramIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 350.0.0.0.0 (iPhone14,5; iOS 17_5; pt_BR; pt; scale=3.00; 1170x2532; 000000000)',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A.231105.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0.0;]',
  facebookIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0.0;FBBV/0;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/pt_BR;FBOP/5]',
  messengerIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0.0.0;FBBV/0;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/pt_BR;FBOP/5]',
  messengerAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A.231105.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/470.0.0.0.0;]',
  tiktokAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 trill_350000 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/35.0.0 BytedanceWebview/d8a21c6',
  tiktokIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/pt Region/BR',
  linkedinIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.0',
  snapchatIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.80.0.34 (like Safari/8618.2.12.0.0, iOS 17.5)',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/13.4.0',
  wechatAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50',
  webviewAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  webviewIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};

function makeEnv({ ua = UA.chromeAndroid, standalone = false, navStandalone = undefined, matchMediaThrows = false, noNavigator = false, pathname = '/', search = '', st = {}, clipboard = 'ok', execCommand = 'ok', storage = {}, storageThrows = false, emailLink = false, signIn = async () => ({}), popup = async () => ({}), loginErrEl = true } = {}) {
  const calls = { render: 0, toasts: [], signIn: [], replaced: [], popups: 0, copied: [], layers: [] };
  const store = { ...storage };
  const loginErr = { textContent: '' };
  const confirmInput = { value: '' };
  const doc = {
    getElementById: id => (id === 'login-err' ? (loginErrEl ? loginErr : null) : id === 'li-confirm-email' ? confirmInput : null),
    createElement: () => { const el = { value: '', style: {}, attrs: {}, setAttribute(k, v) { el.attrs[k] = v; }, select() {}, setSelectionRange() {}, remove() { const i = calls.layers.indexOf(el); if (i >= 0) calls.layers.splice(i, 1); } }; return el; },
    body: { appendChild: el => calls.layers.push(el) },
    execCommand: cmd => { if (execCommand === 'throws') throw new Error('sem permissão'); calls.copied.push([cmd, calls.layers[calls.layers.length - 1]?.value]); return execCommand === 'ok'; },
  };
  const location = { origin: 'https://peladanamao.com.br', pathname, search, href: 'https://peladanamao.com.br' + pathname + search + '#x' };
  const env = {
    st: { ...st },
    window: { LP_ALLOWED: false, matchMedia: matchMediaThrows ? () => { throw new Error('indisponível'); } : q => ({ matches: standalone && /standalone/.test(q) }) },
    navigator: noNavigator ? undefined : {
      userAgent: ua, standalone: navStandalone,
      clipboard: clipboard === 'none' ? undefined : { writeText: async t => { if (clipboard !== 'ok') throw new Error('negado'); calls.copied.push(['clipboard', t]); } },
    },
    location,
    document: doc,
    localStorage: storageThrows
      ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); }, removeItem() { throw new Error('indisponível'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    history: { replaceState: (a, b, url) => { calls.replaced.push(url); } },
    AUTH: {
      isSignInWithEmailLink: () => emailLink,
      signInWithEmailLink: (email, href) => { calls.signIn.push([email, href]); return signIn(email, href); },
      signInWithPopup: p => { calls.popups++; return popup(p); },
    },
    firebase: { auth: { GoogleAuthProvider: function () { this.nome = 'google'; } } },
    toast: (m, t) => { calls.toasts.push([m, t]); },
    render: () => { calls.render++; },
    esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
  };
  const names = Object.keys(env);
  const body = siteSrc + '\n' + authSrc + '\n' + googleSrc + '\n' + loginSrc +
    '\nreturn { parseSiteOrigin, chromeIntentUrl, handleEmailLinkOnLoad, emailLinkFailed, emailLinkErrMsg, doConfirmEmailLink, skipEmailLink, emailLinkAskNew, googleLoginErrMsg, doLoginGoogle, vLogin, embeddedBrowserOf, embeddedLoginInfo, embeddedNotice, copyAppLink, emailLinkPanel };';
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, store, loginErr, confirmInput };
}

const E = makeEnv().api;

// ══ 1. Quem é "navegador embutido" ═══════════════════════════════════════════════════════════
const casos = [
  ['Instagram no Android', UA.instagramAndroid, 'Instagram'], ['Instagram no iPhone', UA.instagramIphone, 'Instagram'],
  ['Facebook no Android', UA.facebookAndroid, 'Facebook'], ['Facebook no iPhone', UA.facebookIphone, 'Facebook'],
  ['Messenger no iPhone (traz FBAN também: é Messenger, não Facebook)', UA.messengerIphone, 'Messenger'], ['Messenger no Android', UA.messengerAndroid, 'Messenger'],
  ['TikTok no Android', UA.tiktokAndroid, 'TikTok'], ['TikTok no iPhone', UA.tiktokIphone, 'TikTok'],
  ['LinkedIn no iPhone', UA.linkedinIphone, 'LinkedIn'], ['Snapchat no iPhone', UA.snapchatIphone, 'Snapchat'],
  ['LINE no Android', UA.lineAndroid, 'LINE'], ['WeChat no Android', UA.wechatAndroid, 'WeChat'],
];
for (const [rotulo, ua, nome] of casos) {
  const r = E.embeddedBrowserOf(ua);
  check(`embutido, ${rotulo}: reconhece e dá o nome "${nome}"`, !!r && r.name === nome && r.named === true, r);
}
for (const [rotulo, ua] of [['WebView do Android (aplicativo sem nome conhecido)', UA.webviewAndroid], ['WebView do iPhone (sem "Safari" na identificação)', UA.webviewIphone]]) {
  const r = E.embeddedBrowserOf(ua);
  check(`embutido, ${rotulo}: reconhece, sem nome`, !!r && r.name === '' && r.named === false, r);
}
for (const [rotulo, ua] of Object.entries({
  'Chrome no Android': UA.chromeAndroid, 'Samsung Internet': UA.samsung, 'Firefox no Android': UA.firefoxAndroid, 'Edge no Android': UA.edgeAndroid, 'Opera no Android': UA.operaAndroid,
  'Safari no iPhone': UA.safariIphone, 'Safari no iPad (modo computador)': UA.safariIpadDesktop, 'Chrome no iPhone': UA.chromeIphone, 'Firefox no iPhone': UA.firefoxIphone, 'Edge no iPhone': UA.edgeIphone,
  'Chrome no Windows': UA.windowsChrome, 'Safari no Mac': UA.macSafari,
})) {
  check(`navegador de verdade, ${rotulo}: NÃO é embutido (nada muda na tela de login)`, E.embeddedBrowserOf(ua) === null);
}
check('identificação vazia, ausente ou estranha: não é embutido (na dúvida, a tela de login continua como sempre)', E.embeddedBrowserOf('') === null && E.embeddedBrowserOf(undefined) === null && E.embeddedBrowserOf(null) === null && E.embeddedBrowserOf(42) === null && E.embeddedBrowserOf({}) === null);
check('app instalado na tela inicial (standalone) NUNCA é embutido, mesmo com a identificação sem "Safari" do iPhone', E.embeddedBrowserOf(UA.webviewIphone, { standalone: true }) === null && E.embeddedBrowserOf(UA.webviewAndroid, { standalone: true }) === null && E.embeddedBrowserOf(UA.instagramAndroid, { standalone: true }) === null);
check('…e fora do app instalado a mesma identificação do iPhone é embutida (a regra depende do standalone)', E.embeddedBrowserOf(UA.webviewIphone, { standalone: false })?.named === false);
check('"Line" só vale como o aplicativo LINE ("Line/"): nomes parecidos não disparam', E.embeddedBrowserOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36') === null && E.embeddedBrowserOf('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36 Timeline/1.0') === null);

// ══ 2. O link que abre a página no Chrome (Android) ══════════════════════════════════════════
const base = 'intent://peladanamao.com.br/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fpeladanamao.com.br%2F;end';
check('chromeIntentUrl só com o endereço do site: igual ao de sempre (o do Samsung Internet não mudou)', E.chromeIntentUrl('https://peladanamao.com.br') === base, E.chromeIntentUrl('https://peladanamao.com.br'));
const conv = E.chromeIntentUrl('https://peladanamao.com.br', '/?invite=ab12CD&liga=pelada-x');
check('com o caminho e os parâmetros da página (convite, origem): vão junto, no link e no endereço de reserva', conv === 'intent://peladanamao.com.br/?invite=ab12CD&liga=pelada-x#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fpeladanamao.com.br%2F%3Finvite%3Dab12CD%26liga%3Dpelada-x;end', conv);
check('?ref= também vai junto (a origem sobrevive à troca de navegador)', E.chromeIntentUrl('https://peladanamao.com.br', '/?ref=instagram').includes('/?ref=instagram#Intent;') && E.chromeIntentUrl('https://peladanamao.com.br', '/?ref=instagram').includes('%3Fref%3Dinstagram'));
for (const ruim of ['/?x=1;package=com.malvado.app', '/?x=1#Intent;end', '/ ?a=b', '/?a="b"', '/?a=<b>', '/?a=`b`', '/\\x', 'sem-barra-inicial', '//outro.com/', '', undefined, null, 42]) {
  check(`caminho fora do padrão (${JSON.stringify(ruim)}): volta para a raiz do site, sem levar nada do que veio na página`, E.chromeIntentUrl('https://peladanamao.com.br', ruim) === base, E.chromeIntentUrl('https://peladanamao.com.br', ruim));
}
check('endereço do site inválido: nada é montado', E.chromeIntentUrl('', '/') === '' && E.chromeIntentUrl('javascript:alert(1)', '/') === '' && E.chromeIntentUrl('https://a.com/x', '/') === '');
check('o link de reserva (S.browser_fallback_url) leva o MESMO caminho: se o Chrome não existir, volta para a mesma página', conv.includes('S.browser_fallback_url=' + encodeURIComponent('https://peladanamao.com.br/?invite=ab12CD&liga=pelada-x')));

// ══ 3. O que a tela de login descobre sobre o navegador ══════════════════════════════════════
let e = makeEnv({ ua: UA.chromeAndroid });
check('embeddedLoginInfo no Chrome: null', e.api.embeddedLoginInfo() === null);
e = makeEnv({ ua: UA.instagramAndroid, pathname: '/', search: '?ref=instagram' });
let info = e.api.embeddedLoginInfo();
check('no Instagram do Android: nome, "named" e o link do Chrome com a origem junto', info?.name === 'Instagram' && info.named === true && info.chromeUrl.startsWith('intent://peladanamao.com.br/?ref=instagram#Intent;') && info.chromeUrl.includes('package=com.android.chrome'), info);
e = makeEnv({ ua: UA.instagramIphone });
info = e.api.embeddedLoginInfo();
check('no Instagram do iPhone: sem link do Chrome (o iPhone não tem como abrir de dentro do aplicativo): só as instruções', info?.name === 'Instagram' && info.chromeUrl === '', info);
check('app instalado (display-mode: standalone) dentro de um WebView: não é embutido', makeEnv({ ua: UA.webviewAndroid, standalone: true }).api.embeddedLoginInfo() === null);
check('app instalado no iPhone (navigator.standalone): não é embutido', makeEnv({ ua: UA.webviewIphone, navStandalone: true }).api.embeddedLoginInfo() === null);
check('matchMedia indisponível ou com erro: a decisão segue só pela identificação e nada quebra', makeEnv({ ua: UA.instagramAndroid, matchMediaThrows: true }).api.embeddedLoginInfo()?.name === 'Instagram');
check('sem navigator (ambiente estranho): null, a tela de login não quebra', makeEnv({ noNavigator: true }).api.embeddedLoginInfo() === null);

// ══ 4. A tela de login ═══════════════════════════════════════════════════════════════════════
const tela = (opts) => { const x = makeEnv(opts); return { x, html: x.api.vLogin() }; };
let t = tela({ ua: UA.chromeAndroid });
check('Chrome: a tela é a de sempre (botão "Entrar com Google", e-mail e senha) e SEM aviso', t.html.includes('Entrar com Google') && t.html.includes('onclick="doLoginGoogle()"') && !t.html.includes('embedded-notice') && t.html.includes('id="li-email"') && t.html.includes('id="li-pw"'), plain(t.html).slice(0, 200));
t = tela({ ua: UA.chromeAndroid, st: { _loginIntent: 'signup' } });
check('Chrome, "Criar minha liga grátis": "Continuar com Google" no lugar de destaque', t.html.includes('Continuar com Google') && !t.html.includes('embedded-notice'));
t = tela({ ua: UA.instagramAndroid, pathname: '/', search: '?ref=instagram' });
let p = plain(t.html);
check('Instagram no Android: aparece o aviso com o nome do navegador e o motivo (o Google não deixa entrar por aqui)', t.html.includes('id="embedded-notice"') && /Você está no navegador do Instagram/.test(p) && /O Google não deixa entrar com a conta Google por aqui/.test(p), p.slice(0, 300));
check('…com a saída: abrir no Chrome ou no Safari pelos três pontinhos → Abrir no navegador', /abra o Pelada na Mão no Chrome \(ou no Safari\): toque nos três pontinhos \(⋯\) e escolha Abrir no navegador/.test(p), p);
check('…e a alternativa que funciona ali mesmo: e-mail e senha', /entre com e-mail e senha logo abaixo: funciona aqui mesmo/.test(p) && t.html.includes('id="li-email"') && t.html.includes('id="li-pw"') && /Entrar sem senha/.test(p));
check('…com os botões Abrir no Chrome (link do Android, com a origem junto) e Copiar link', /Abrir no Chrome/.test(p) && t.html.includes('href="intent://peladanamao.com.br/?ref=instagram#Intent;') && t.html.includes('onclick="copyAppLink()"') && /Copiar link/.test(p), t.html.match(/href="intent[^"]*"/)?.[0]);
check('…o botão grande do Google SAI (ele falharia): sobra só o "Tentar com o Google mesmo assim", pequeno, para o caso de a identificação estar errada', !/Entrar com Google/.test(p) && !/Continuar com Google/.test(p) && /Tentar com o Google mesmo assim/.test(p) && t.html.split('doLoginGoogle()').length === 2, p);
check('…o link do Chrome vai escapado no HTML (o & dos parâmetros vira &amp;): nenhum & solto dentro de um atributo', !/href="[^"]*&(?!amp;)[^"]*"/.test(t.html), t.html.match(/href="[^"]*"/g));
t = tela({ ua: UA.instagramAndroid, pathname: '/', search: '?invite=ab12CD&liga=pelada-x' });
check('…com convite (dois parâmetros no endereço): o link do Chrome leva o convite inteiro e o & vira &amp; dentro do atributo (um & solto quebraria o HTML)', t.html.includes('href="intent://peladanamao.com.br/?invite=ab12CD&amp;liga=pelada-x#Intent;') && !/href="[^"]*&(?!amp;)[^"]*"/.test(t.html), t.html.match(/href="intent[^"]*"/)?.[0]);
t = tela({ ua: UA.instagramIphone });
p = plain(t.html);
check('Instagram no iPhone: o aviso aparece, SEM o botão do Chrome (só instruções e Copiar link)', /Você está no navegador do Instagram/.test(p) && !/Abrir no Chrome/.test(p) && /Copiar link/.test(p) && !t.html.includes('intent://'), p.slice(0, 300));
t = tela({ ua: UA.tiktokAndroid });
check('TikTok: o aviso diz "no navegador do TikTok"', /Você está no navegador do TikTok/.test(plain(t.html)));
t = tela({ ua: UA.facebookIphone });
check('Facebook: o aviso diz "no navegador do Facebook"', /Você está no navegador do Facebook/.test(plain(t.html)));
t = tela({ ua: UA.webviewAndroid });
check('aplicativo sem nome conhecido (WebView): "dentro de outro aplicativo"', /Você está dentro de outro aplicativo/.test(plain(t.html)) && t.html.includes('id="embedded-notice"'), plain(t.html).slice(0, 200));
t = tela({ ua: UA.instagramAndroid, st: { _loginIntent: 'signup' } });
check('Instagram, "Criar minha liga grátis": o aviso aparece e o formulário é o de criar conta', t.html.includes('id="embedded-notice"') && /Crie a sua conta/.test(plain(t.html)) && />Criar conta</.test(t.html) && !/Continuar com Google/.test(plain(t.html)));
t = tela({ ua: UA.instagramAndroid, st: { _loginTab: 'link' } });
check('"Entrar sem senha" (link por e-mail): sem aviso do Google (ali não tem Google)', !t.html.includes('embedded-notice') && /Enviaremos um link de acesso/.test(plain(t.html)));
t = tela({ ua: UA.webviewIphone, navStandalone: true });
check('app instalado no iPhone: a tela de login é a de sempre, com o botão do Google', t.html.includes('Entrar com Google') && !t.html.includes('embedded-notice'));

// ══ 5. Confirmar o e-mail do link de acesso ══════════════════════════════════════════════════
t = tela({ ua: UA.chromeAndroid, st: { _emailLink: { mode: 'confirm', msg: '', typed: '' } } });
p = plain(t.html);
check('link de acesso aberto em outro navegador: a tela pede para confirmar o e-mail (e some o formulário e o Google)', /Confirme o seu e-mail/.test(p) && /digite o mesmo e-mail em que recebeu o link/.test(p) && t.html.includes('id="li-confirm-email"') && t.html.includes('onclick="doConfirmEmailLink()"') && !t.html.includes('id="li-pw"') && !/Entrar com Google/.test(p), p);
check('…com Cancelar (volta ao login)', t.html.includes('onclick="skipEmailLink()"') && /Cancelar/.test(p));
t = tela({ ua: UA.chromeAndroid, st: { _emailLink: { mode: 'confirm', msg: 'Este não é o e-mail que recebeu o link. Digite o mesmo e-mail.', typed: 'errado@x.com' } } });
check('e-mail errado: o motivo aparece e o que a pessoa digitou volta preenchido', /Este não é o e-mail que recebeu o link/.test(plain(t.html)) && t.html.includes('value="errado@x.com"'));
t = tela({ ua: UA.chromeAndroid, st: { _emailLink: { mode: 'confirm', msg: '<img src=x onerror=alert(1)>', typed: '"><script>alert(1)</script>' } } });
check('o que a pessoa digitou e a mensagem vão escapados (nada de marcação solta na tela)', !t.html.includes('<img src=x') && !t.html.includes('<script>alert(1)') && t.html.includes('&lt;img src=x') && t.html.includes('&lt;script>') && t.html.includes('value="&quot;'), t.html.slice(t.html.indexOf('value=') - 20, t.html.indexOf('value=') + 80));
t = tela({ ua: UA.chromeAndroid, st: { _emailLink: { mode: 'dead', msg: 'Este link de acesso já foi usado ou venceu. Peça um novo.', typed: '' } } });
p = plain(t.html);
check('link já usado ou vencido: a tela explica e oferece "Pedir um novo link" e "Voltar ao login"', /Link de acesso vencido/.test(p) && /já foi usado ou venceu/.test(p) && t.html.includes('onclick="emailLinkAskNew()"') && t.html.includes('onclick="skipEmailLink()"') && !t.html.includes('id="li-confirm-email"'), p);
t = tela({ ua: UA.instagramAndroid, st: { _emailLink: { mode: 'confirm', msg: '', typed: '' } } });
check('dentro do Instagram, a confirmação do link também aparece (e o aviso do Google não atrapalha)', t.html.includes('id="li-confirm-email"') && !t.html.includes('embedded-notice'));

// handleEmailLinkOnLoad
e = makeEnv({ emailLink: false, storage: { aceoma_emailForSignIn: 'a@b.com' } });
e.api.handleEmailLinkOnLoad();
check('endereço que não é link de acesso: nada acontece (não entra, não pede e-mail)', e.calls.signIn.length === 0 && e.env.st._emailLink === undefined);
e = makeEnv({ emailLink: true, storage: { aceoma_emailForSignIn: 'a@b.com' } });
e.api.handleEmailLinkOnLoad();
check('link aberto no mesmo navegador (e-mail guardado): entra com o e-mail guardado e o endereço do link, sem pedir nada', e.calls.signIn.length === 1 && e.calls.signIn[0][0] === 'a@b.com' && e.calls.signIn[0][1].includes('peladanamao.com.br') && e.env.st._emailLink === undefined, e.calls.signIn);

(async () => {
  // entrou: limpa o e-mail guardado e o endereço
  e = makeEnv({ emailLink: true, pathname: '/', storage: { aceoma_emailForSignIn: 'a@b.com' } });
  e.api.handleEmailLinkOnLoad();
  await new Promise(r => setTimeout(r, 5));
  check('…entrou: o e-mail guardado é apagado e o endereço do link (código de acesso) sai da barra', e.store.aceoma_emailForSignIn === undefined && JSON.stringify(e.calls.replaced) === JSON.stringify(['/']), { store: e.store, replaced: e.calls.replaced });

  // sem e-mail guardado: confirmação
  e = makeEnv({ emailLink: true });
  e.api.handleEmailLinkOnLoad();
  check('link aberto em OUTRO navegador ou aparelho (sem e-mail guardado): não tenta entrar e abre a confirmação do e-mail', e.calls.signIn.length === 0 && e.env.st._emailLink?.mode === 'confirm' && e.env.st._emailLink.msg === '', e.env.st);
  e = makeEnv({ emailLink: true, storageThrows: true });
  e.api.handleEmailLinkOnLoad();
  check('armazenamento indisponível (modo privado): cai na confirmação do e-mail, sem quebrar', e.env.st._emailLink?.mode === 'confirm' && e.calls.signIn.length === 0);

  // falhas com o e-mail guardado
  for (const [code, modo, trecho] of [['auth/invalid-action-code', 'dead', 'já foi usado ou venceu'], ['auth/expired-action-code', 'dead', 'já foi usado ou venceu'], ['auth/invalid-email', 'confirm', 'Este não é o e-mail que recebeu o link'], ['auth/network-request-failed', 'confirm', 'Sem conexão'], ['auth/too-many-requests', 'confirm', 'Muitas tentativas'], ['auth/algo-novo', 'dead', 'Não foi possível entrar com este link']]) {
    e = makeEnv({ emailLink: true, storage: { aceoma_emailForSignIn: 'a@b.com' }, signIn: async () => { const err = new Error('texto técnico do Firebase'); err.code = code; throw err; } });
    e.api.handleEmailLinkOnLoad();
    await new Promise(r => setTimeout(r, 5));
    check(`link com e-mail guardado que falha (${code}): ${modo === 'dead' ? 'tela de link vencido' : 'volta à confirmação, para tentar de novo'}, em português, sem o texto técnico, e redesenha a tela`, e.env.st._emailLink?.mode === modo && e.env.st._emailLink.msg.includes(trecho) && !/Firebase|Error/.test(e.env.st._emailLink.msg) && e.calls.render >= 1, e.env.st);
  }
  e = makeEnv({ emailLink: true, storage: { aceoma_emailForSignIn: 'a@b.com' }, signIn: async () => { throw new Error('sem código'); } });
  e.api.handleEmailLinkOnLoad();
  await new Promise(r => setTimeout(r, 5));
  check('erro sem código: cai na mensagem geral (nunca "undefined")', e.env.st._emailLink?.mode === 'dead' && !/undefined/.test(e.env.st._emailLink.msg));
  check('e o e-mail guardado NÃO é apagado quando o link falha (só quando entra)', e.store.aceoma_emailForSignIn === 'a@b.com');

  // doConfirmEmailLink
  e = makeEnv({ emailLink: true, st: { _emailLink: { mode: 'confirm', msg: '', typed: '' } } });
  e.confirmInput.value = '   ';
  await e.api.doConfirmEmailLink();
  check('confirmar sem digitar: pede o e-mail e não tenta entrar', e.calls.signIn.length === 0 && e.env.st._emailLink.msg === 'Digite o seu e-mail.' && e.env.st._emailLink.mode === 'confirm' && e.calls.render === 1, e.env.st);
  e = makeEnv({ emailLink: true, st: { _emailLink: { mode: 'confirm', msg: '', typed: '' } }, storage: { aceoma_emailForSignIn: 'velho@x.com' } });
  e.confirmInput.value = '  Pessoa@Exemplo.com ';
  await e.api.doConfirmEmailLink();
  check('confirmar o e-mail: entra com o e-mail digitado (sem espaços nas pontas) e o endereço do link; limpa a confirmação, o e-mail guardado e a barra de endereço', e.calls.signIn.length === 1 && e.calls.signIn[0][0] === 'Pessoa@Exemplo.com' && e.env.st._emailLink === null && e.store.aceoma_emailForSignIn === undefined && e.calls.replaced.length === 1, { signIn: e.calls.signIn, st: e.env.st, store: e.store });
  e = makeEnv({ emailLink: true, st: { _emailLink: { mode: 'confirm', msg: '', typed: '' } }, signIn: async () => { const er = new Error('x'); er.code = 'auth/invalid-email'; throw er; } });
  e.confirmInput.value = 'errado@x.com';
  await e.api.doConfirmEmailLink();
  check('e-mail que não é o do link: continua na confirmação, com o motivo e o que foi digitado de volta no campo', e.env.st._emailLink.mode === 'confirm' && /Este não é o e-mail que recebeu o link/.test(e.env.st._emailLink.msg) && e.env.st._emailLink.typed === 'errado@x.com', e.env.st);
  e = makeEnv({ emailLink: true, st: { _emailLink: { mode: 'confirm', msg: '', typed: '' } }, signIn: async () => { const er = new Error('x'); er.code = 'auth/expired-action-code'; throw er; } });
  e.confirmInput.value = 'a@b.com';
  await e.api.doConfirmEmailLink();
  check('link vencido na hora de confirmar: vai para a tela de link vencido', e.env.st._emailLink.mode === 'dead');

  // sair da confirmação
  e = makeEnv({ st: { _emailLink: { mode: 'confirm', msg: '', typed: '' }, _loginTab: 'email' } });
  e.api.skipEmailLink();
  check('Cancelar / Voltar ao login: sai da confirmação, limpa o endereço do link e redesenha o login de sempre', e.env.st._emailLink === null && e.calls.replaced.length === 1 && e.calls.render === 1 && e.env.st._loginTab === 'email');
  e = makeEnv({ st: { _emailLink: { mode: 'dead', msg: 'x', typed: '' }, _loginTab: 'email' } });
  e.api.emailLinkAskNew();
  check('"Pedir um novo link": abre direto o "Entrar sem senha"', e.env.st._emailLink === null && e.env.st._loginTab === 'link' && e.calls.render === 1);
  check('mensagens do link de acesso: todas em português, nenhuma vazia', ['auth/invalid-action-code', 'auth/expired-action-code', 'auth/invalid-email', 'auth/network-request-failed', 'auth/too-many-requests', 'auth/x', undefined, ''].every(c => /[a-zà-ú]{3}/i.test(E.emailLinkErrMsg(c)) && !/undefined|auth\//.test(E.emailLinkErrMsg(c))));

  // ══ 6. Login com o Google: mensagens em português ═══════════════════════════════════════════
  for (const c of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']) {
    e = makeEnv({ popup: async () => { const er = new Error('texto técnico'); er.code = c; throw er; } });
    e.loginErr.textContent = 'erro antigo';
    await e.api.doLoginGoogle();
    check(`Google: a pessoa fechou a janela (${c}): não é erro, nada é mostrado (nem aviso nem o erro antigo)`, e.loginErr.textContent === '' && e.calls.toasts.length === 0, { err: e.loginErr.textContent, toasts: e.calls.toasts });
  }
  for (const [c, trecho] of [['auth/popup-blocked', 'bloqueou a janela do Google'], ['auth/operation-not-supported-in-this-environment', 'Abra o Pelada na Mão no Chrome ou no Safari'], ['auth/web-storage-unsupported', 'Abra o Pelada na Mão no Chrome ou no Safari'], ['auth/network-request-failed', 'Sem conexão'], ['auth/too-many-requests', 'Muitas tentativas'], ['auth/account-exists-with-different-credential', 'criada com e-mail e senha'], ['auth/qualquer-outro', 'Não foi possível entrar com o Google agora']]) {
    e = makeEnv({ popup: async () => { const er = new Error('Firebase: Error (' + c + ').'); er.code = c; throw er; } });
    await e.api.doLoginGoogle();
    check(`Google falhou (${c}): a mensagem em português aparece no próprio login, sem o texto técnico nem "Erro Google:"`, e.loginErr.textContent.includes(trecho) && !/Firebase|Erro Google|auth\//.test(e.loginErr.textContent) && e.calls.toasts.length === 0, e.loginErr.textContent);
  }
  e = makeEnv({ loginErrEl: false, popup: async () => { const er = new Error('x'); er.code = 'auth/popup-blocked'; throw er; } });
  await e.api.doLoginGoogle();
  check('Google falhou sem o campo de erro na tela: a mesma mensagem vai num aviso (toast)', e.calls.toasts.length === 1 && /bloqueou a janela do Google/.test(e.calls.toasts[0][0]), e.calls.toasts);
  e = makeEnv({ popup: async () => { throw new Error('sem código nenhum'); } });
  await e.api.doLoginGoogle();
  check('erro sem código (texto solto): mensagem geral, nunca o texto técnico', /Não foi possível entrar com o Google agora/.test(e.loginErr.textContent) && !/sem código/.test(e.loginErr.textContent));
  e = makeEnv({ popup: async () => { throw undefined; } });
  await e.api.doLoginGoogle();
  check('erro vazio (undefined): não quebra e mostra a mensagem geral', /Não foi possível entrar com o Google agora/.test(e.loginErr.textContent));
  e = makeEnv();
  e.loginErr.textContent = 'erro antigo';
  await e.api.doLoginGoogle();
  check('Google funcionou: abre a janela do Google UMA vez e apaga o erro antigo da tela', e.calls.popups === 1 && e.loginErr.textContent === '', { popups: e.calls.popups, err: e.loginErr.textContent });
  check('todas as mensagens do Google estão em português, sem "undefined" nem códigos do Firebase', ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported', 'auth/network-request-failed', 'auth/too-many-requests', 'auth/account-exists-with-different-credential', 'auth/x', undefined, ''].every(c => /[a-zà-ú]{3}/i.test(E.googleLoginErrMsg(c)) && !/undefined|auth\//.test(E.googleLoginErrMsg(c))));

  // ══ 7. Copiar o link ═════════════════════════════════════════════════════════════════════════
  e = makeEnv({ pathname: '/', search: '?ref=instagram' });
  await e.api.copyAppLink();
  check('Copiar link: copia o endereço da página SEM o "#…" (com o ?ref= ou o convite, se houver) e avisa que foi copiado', JSON.stringify(e.calls.copied) === JSON.stringify([['clipboard', 'https://peladanamao.com.br/?ref=instagram']]) && e.calls.toasts.length === 1 && /Link copiado/.test(e.calls.toasts[0][0]) && e.calls.toasts[0][1] === 'ok', { copied: e.calls.copied, toasts: e.calls.toasts });
  e = makeEnv({ clipboard: 'negado' });
  await e.api.copyAppLink();
  check('área de transferência negada (comum em navegador embutido): tenta a cópia à moda antiga e avisa que copiou; o campo temporário é removido', e.calls.copied.length === 1 && e.calls.copied[0][0] === 'copy' && e.calls.copied[0][1] === 'https://peladanamao.com.br/' && /Link copiado/.test(e.calls.toasts[0][0]) && e.calls.layers.length === 0, { copied: e.calls.copied, toasts: e.calls.toasts, layers: e.calls.layers.length });
  e = makeEnv({ clipboard: 'none' });
  await e.api.copyAppLink();
  check('sem área de transferência no navegador: também cai na cópia antiga', e.calls.copied[0]?.[0] === 'copy' && /Link copiado/.test(e.calls.toasts[0][0]));
  e = makeEnv({ clipboard: 'negado', execCommand: 'falha' });
  await e.api.copyAppLink();
  check('nenhuma das duas cópias funciona: avisa para segurar o endereço na barra do navegador (não promete o que não fez)', e.calls.toasts.length === 1 && /Não consegui copiar/.test(e.calls.toasts[0][0]) && e.calls.toasts[0][1] === 'err' && e.calls.layers.length === 0, e.calls.toasts);
  e = makeEnv({ clipboard: 'negado', execCommand: 'throws' });
  let jogou = false; try { await e.api.copyAppLink(); } catch (_) { jogou = true; }
  check('a cópia antiga lança erro: nada quebra e a pessoa recebe o aviso', !jogou && /Não consegui copiar/.test(e.calls.toasts[0]?.[0] || ''));

  // ══ 8. Como está ligado no app ═══════════════════════════════════════════════════════════════
  const init = slice('function initFirebase() {', 'AUTH.onAuthStateChanged');
  check('a abertura do app chama handleEmailLinkOnLoad() (e não tem mais o tratamento solto que não fazia nada sem o e-mail guardado)', /\bhandleEmailLinkOnLoad\(\);/.test(init) && !/isSignInWithEmailLink/.test(init) && !/Erro no link de acesso/.test(html));
  check('o texto técnico "Erro Google: " saiu do app', !/Erro Google:/.test(html));
  check('o login do Google continua em UM lugar (doLoginGoogle) e a reautenticação para excluir a conta não foi mexida', (html.match(/AUTH\.signInWithPopup\(/g) || []).length === 1 && (html.match(/reauthenticateWithPopup\(/g) || []).length === 1);
  check('a tela de login chama o detector e escolhe entre o aviso e o botão do Google', /const emb = embeddedLoginInfo\(\);/.test(loginSrc) && /\$\{emb \? embeddedNotice\(emb\) : googleBtn\}/.test(loginSrc) && /if \(st\._emailLink\) \{\s*body = emailLinkPanel\(st\._emailLink\);/.test(loginSrc));
  check('PRIVACIDADE: nada do aviso lê, grava ou manda dado da pessoa (sem contador, sem rede, sem armazenamento; o login ainda nem existe)', !/trackEvent|callFn|fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage/.test(slice('function embeddedBrowserOf(', 'function emailLinkPanel(')), 'ajudantes do aviso');

  // ══ 9. Manual ════════════════════════════════════════════════════════════════════════════════
  const caixa = manual.indexOf('id="login-navegador-embutido"') >= 0 ? plain(manual.slice(manual.indexOf('id="login-navegador-embutido"'), manual.indexOf('id="login-navegador-embutido"') + 4500)) : '';
  check('manual (seção 27): o quadro "Entrar pelo Instagram, TikTok ou Facebook" existe, explica o bloqueio do Google (403 disallowed_useragent), o aviso e as saídas (Abrir no navegador, Abrir no Chrome, Copiar link, e-mail e senha)', /Entrar pelo Instagram, TikTok ou Facebook/.test(caixa) && /disallowed_useragent/.test(caixa) && /Abrir no navegador/.test(caixa) && /Abrir no Chrome/.test(caixa) && /em qualquer aparelho, o botão Copiar link para colar no navegador/.test(caixa) && /e-mail e senha/.test(caixa), caixa.slice(0, 300));
  check('manual: explica o link de acesso aberto em outro navegador (pede para confirmar o e-mail) e o link vencido', /Entrar sem senha/.test(caixa) && /confirmar o e-mail/.test(caixa) && /vencid/.test(caixa), caixa.slice(0, 300));
  check('manual: diz que o app instalado na tela inicial não é tratado como navegador embutido e que o iPhone não tem o botão do Chrome', /instalado na tela inicial/.test(caixa) && /iPhone/.test(caixa), caixa.slice(0, 300));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
