// Botão "Instalar o app" (index.html), isolado: extrai as funções reais e as executa num ambiente simulado,
// sem navegador. O botão só aparece em celular/tablet, logado, com o app ainda não instalado e sem ter sido
// dispensado; abre a janela nativa quando o navegador entregou o pedido de instalação e, senão, o passo a passo.
// No Samsung Internet (que monta um pacote do app barrado pelo Android: "App de risco bloqueado") o botão leva ao Chrome.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const code = slice('const INSTALL_SNOOZE_MS', '/* ── Faixa do plano');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const DAY = 86400000;
const NOW = Date.parse('2026-10-10T12:00:00.000Z');

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  instagram: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 330.0.0.0',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]',
  webview: 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  chromeNoSamsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', // só a marca do aparelho, sem o navegador da Samsung
  samsungSite: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36', // "site para computador"
};

function makeEnv({ ua = UA.android, platform = 'Linux armv81', touchPoints = 5, standalone = false, navStandalone = undefined, authUser = { uid: 'u' }, storage = {}, storageThrows = false, origin = 'https://peladanamao.com.br' } = {}) {
  const calls = { render: 0, toasts: [], events: [] };
  const store = { ...storage };
  const listeners = {};
  // elementos soltos no body, NA ORDEM em que foram postos (um id repetido aparece repetido, como num navegador de verdade)
  const layerList = [];
  const layers = { has: id => layerList.some(x => x.id === id), get: id => layerList.find(x => x.id === id), keys: () => layerList.map(x => x.id) };
  const doc = {
    getElementById: id => { const el = layerList.find(x => x.id === id); return el ? { remove: () => layerList.splice(layerList.indexOf(el), 1) } : null; },
    createElement: () => { const el = { id: '', className: '', innerHTML: '', remove() { const i = layerList.indexOf(el); if (i >= 0) layerList.splice(i, 1); } }; return el; },
    body: { appendChild: el => layerList.push(el) },
  };
  const env = {
    st: { authUser },
    window: {
      addEventListener: (n, fn) => { listeners[n] = fn; },
      matchMedia: q => ({ matches: standalone && /standalone/.test(q) }),
    },
    navigator: { userAgent: ua, platform, maxTouchPoints: touchPoints, standalone: navStandalone },
    localStorage: storageThrows
      ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: doc,
    location: { origin },
    render: () => { calls.render++; },
    toast: (m, t) => { calls.toasts.push([m, t]); },
    trackEvent: (n, once = true) => { calls.events.push([n, once]); }, // contador de uso (anônimo)
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { installOsOf, installBannerInfo, readInstallEnv, installBanner, dismissInstallBanner, installApp, installNative, openInstallHelp, isSamsungInternet, parseSiteOrigin, chromeIntentUrl, getPrompt: () => _installPrompt };')(...names.map(n => env[n]));
  return { api, env, calls, store, listeners, layers };
}
const info = (over = {}) => makeEnv().api.installBannerInfo({ ua: UA.android, now: NOW, ...over });

// ── quem vê o convite ───────────────────────────────────────────────────────────────────────
check('Android (Chrome): vê, como android', info()?.os === 'android', info());
check('iPhone (Safari): vê, como ios', info({ ua: UA.iphone })?.os === 'ios');
check('iPad (que se apresenta como Mac, mas tem toque): vê, como ios', info({ ua: UA.ipadMac, platform: 'MacIntel', touchPoints: 5 })?.os === 'ios');
check('computador Windows: não vê (o navegador já oferece instalar na barra de endereço)', info({ ua: UA.windows, platform: 'Win32', touchPoints: 0 }) === null);
check('Mac de verdade (sem toque): não vê', info({ ua: UA.mac, platform: 'MacIntel', touchPoints: 0 }) === null);
check('app já instalado e aberto pelo ícone (standalone): não vê', info({ standalone: true }) === null);
check('app instalado por aqui (marca guardada): não vê', info({ installed: true }) === null);
check('dispensado há pouco (×): não vê', info({ snoozeUntil: NOW + 3 * DAY }) === null);
check('dispensado, mas o prazo de 7 dias já acabou: volta a ver', info({ snoozeUntil: NOW - 1000 })?.os === 'android');
for (const [nome, ua] of [['Instagram', UA.instagram], ['Facebook', UA.facebook], ['WebView do Android', UA.webview]]) {
  check(`navegador embutido (${nome}): não vê, porque ali não dá para instalar`, info({ ua }) === null);
}

// ── o que o app lê do aparelho ──────────────────────────────────────────────────────────────
let e = makeEnv({ standalone: true });
check('lê "aberto como app" pelo display-mode standalone', e.api.readInstallEnv().standalone === true);
e = makeEnv({ navStandalone: true });
check('lê "aberto como app" do iPhone (navigator.standalone)', e.api.readInstallEnv().standalone === true);
e = makeEnv({ storage: { aceoma_installed: '1', aceoma_install_snooze: String(NOW + DAY) } });
const env1 = e.api.readInstallEnv();
check('lê a marca de instalado e o prazo de silêncio guardados', env1.installed === true && env1.snoozeUntil === NOW + DAY, env1);
e = makeEnv({ storageThrows: true });
check('sem acesso ao armazenamento (modo privado): não quebra, e mostra o convite', e.api.readInstallEnv().installed === false && e.api.installBanner() !== '');

// ── a faixa na tela ─────────────────────────────────────────────────────────────────────────
e = makeEnv();
let b = e.api.installBanner();
check('Android: a faixa tem o botão "Instalar" e o ×, e fala em tela cheia', /installApp\(\)/.test(b) && />Instalar</.test(b) && /dismissInstallBanner\(\)/.test(b) && /tela cheia/.test(b), b);
e = makeEnv({ ua: UA.iphone, platform: 'iPhone', touchPoints: 5 });
b = e.api.installBanner();
check('iPhone: a faixa fala da Tela de Início e dos avisos (único jeito de ter notificação no iPhone)', /Tela de Início/.test(b) && /avisos da liga/.test(b), b);
check('sem login: nenhuma faixa (nem na tela de entrada, para não atrapalhar convites)', makeEnv({ authUser: null }).api.installBanner() === '');
check('computador: nenhuma faixa', makeEnv({ ua: UA.windows, platform: 'Win32', touchPoints: 0 }).api.installBanner() === '');

// ── o × ─────────────────────────────────────────────────────────────────────────────────────
e = makeEnv();
const antes = Date.now();
e.api.dismissInstallBanner();
const until = Number(e.store.aceoma_install_snooze);
check('×: guarda 7 dias de silêncio e redesenha a tela', e.calls.render === 1 && until >= antes + 7 * DAY - 1000 && until <= Date.now() + 7 * DAY + 1000, { until, render: e.calls.render });
check('…e depois do × a faixa some', e.api.installBanner() === '');
e = makeEnv({ storageThrows: true });
e.api.dismissInstallBanner();
check('×, com o armazenamento indisponível: não quebra e redesenha', e.calls.render === 1);

// ── o clique em "Instalar" ──────────────────────────────────────────────────────────────────
function fakePrompt(outcome) {
  const p = { prevented: false, prompts: 0, preventDefault() { this.prevented = true; }, async prompt() { this.prompts++; }, userChoice: Promise.resolve({ outcome }) };
  return p;
}
(async () => {
  // o navegador entrega o pedido de instalação
  e = makeEnv();
  const ev = fakePrompt('accepted');
  e.listeners.beforeinstallprompt(ev);
  check('o pedido de instalação do navegador é guardado e a faixa própria do Chrome é suprimida (preventDefault)', ev.prevented === true && e.api.getPrompt() === ev);

  await e.api.installApp();
  check('com o pedido guardado, "Instalar" abre a janela NATIVA de instalar (e não o passo a passo)', ev.prompts === 1 && !e.layers.has('install-help'), { prompts: ev.prompts, layers: [...e.layers.keys()] });
  check('…aceitou: avisa que está instalando, e a faixa não é dispensada', e.calls.toasts.some(([m, t]) => /Instalando/.test(m) && t === 'ok') && e.store.aceoma_install_snooze === undefined, e.calls.toasts);
  check('…o pedido é de uma vez só: guardado de novo, não se repete', e.api.getPrompt() === null);
  await e.api.installApp();
  check('…um segundo clique sem novo pedido cai no passo a passo', e.layers.has('install-help') && ev.prompts === 1);

  // recusou na janela nativa
  e = makeEnv();
  const ev2 = fakePrompt('dismissed');
  e.listeners.beforeinstallprompt(ev2);
  await e.api.installApp();
  check('disse "agora não" na janela nativa: a faixa descansa 7 dias', e.store.aceoma_install_snooze !== undefined && e.calls.render === 1 && e.api.installBanner() === '', e.store);

  // a janela nativa falha
  e = makeEnv();
  const ev3 = { preventDefault() {}, prompt: async () => { throw new Error('não deu'); }, userChoice: new Promise(() => {}) };
  e.listeners.beforeinstallprompt(ev3);
  await e.api.installApp();
  check('a janela nativa falhou: mostra o passo a passo em vez de ficar parado', e.layers.has('install-help'));

  // sem pedido (iPhone, ou Chrome ainda não liberou)
  e = makeEnv();
  await e.api.installApp();
  const helpAndroid = e.layers.get('install-help')?.innerHTML || '';
  check('Android sem pedido do navegador: passo a passo com o menu ⋮ e "Instalar app"', /⋮/.test(helpAndroid) && /Instalar app/.test(helpAndroid) && /Adicionar à tela inicial/.test(helpAndroid) && !/Safari/.test(helpAndroid), helpAndroid);
  check('…o passo a passo tem 3 passos e um botão para fechar', (helpAndroid.match(/<li /g) || []).length === 3 && /Entendi/.test(helpAndroid));
  e = makeEnv({ ua: UA.iphone, platform: 'iPhone', touchPoints: 5 });
  await e.api.installApp();
  const helpIos = e.layers.get('install-help')?.innerHTML || '';
  check('iPhone: passo a passo com Compartilhar → Adicionar à Tela de Início → Adicionar, no Safari, e o aviso das notificações', /Compartilhar/.test(helpIos) && /Adicionar à Tela de Início/.test(helpIos) && /Adicionar<\/b>/.test(helpIos) && /Safari/.test(helpIos) && /notificações/.test(helpIos), helpIos);
  e.api.openInstallHelp();
  check('abrir o passo a passo duas vezes não duplica a camada', [...e.layers.keys()].filter(k => k === 'install-help').length === 1);

  // depois de instalar
  e = makeEnv();
  await e.api.installApp(); // abre o passo a passo
  e.listeners.appinstalled();
  check('instalou (evento appinstalled): guarda a marca, fecha o passo a passo, avisa e redesenha', e.store.aceoma_installed === '1' && !e.layers.has('install-help') && e.calls.toasts.some(([m]) => /App instalado/.test(m)) && e.calls.render === 1, { store: e.store, layers: [...e.layers.keys()], toasts: e.calls.toasts });
  check('…e a faixa não volta mais', e.api.installBanner() === '');

  // ── Samsung Internet: o pacote que ele monta é barrado pelo Android; "Instalar" leva ao Chrome ───────
  const api0 = makeEnv().api;
  check('Samsung Internet: reconhecido pela identificação do navegador', api0.isSamsungInternet(UA.samsung) === true);
  check('Chrome num celular Samsung NÃO é Samsung Internet (a identificação dele não traz SamsungBrowser/)', api0.isSamsungInternet(UA.android) === false);
  check('Chrome com "SAMSUNG" só como marca do aparelho: não é Samsung Internet', api0.isSamsungInternet(UA.chromeNoSamsung) === false);
  check('Samsung Internet no modo "site para computador" (sem Android na identificação): não conta', api0.isSamsungInternet(UA.samsungSite) === false);
  check('identificação vazia ou ausente: não conta e não quebra', api0.isSamsungInternet('') === false && api0.isSamsungInternet(undefined) === false && api0.isSamsungInternet(null) === false);
  check('a decisão do convite diz que é Samsung Internet, e só nele', info({ ua: UA.samsung })?.samsung === true && info()?.samsung === false && info({ ua: UA.iphone })?.samsung === false, [info({ ua: UA.samsung }), info()]);
  check('Samsung Internet continua vendo o convite como Android', info({ ua: UA.samsung })?.os === 'android');

  e = makeEnv({ ua: UA.samsung });
  b = e.api.installBanner();
  check('Samsung Internet: a faixa manda abrir no Chrome, mantém o botão "Instalar" e o ×, e não fala em tela cheia', /Chrome/.test(b) && />Instalar</.test(b) && /installApp\(\)/.test(b) && /dismissInstallBanner\(\)/.test(b) && !/tela cheia/.test(b) && /data-ev="installBannerSeen"/.test(b), b);
  const bChrome = makeEnv().api.installBanner();
  check('Chrome (inclusive num celular Samsung): a faixa continua a de sempre, sem falar em Chrome', /tela cheia/.test(bChrome) && !/Chrome/.test(bChrome), bChrome);

  const evS = fakePrompt('accepted');
  e.listeners.beforeinstallprompt(evS);
  await e.api.installApp();
  check('Samsung Internet: "Instalar" NÃO abre a janela do Samsung (é ela que cria o pacote barrado), abre o passo a passo', evS.prompts === 0 && e.layers.has('install-help'), { prompts: evS.prompts, layers: [...e.layers.keys()] });
  check('…e conta um clique em Instalar, uma vez só', JSON.stringify(e.calls.events) === JSON.stringify([['installClick', false]]), e.calls.events);
  const sheetS = e.layers.get('install-help')?.innerHTML || '';
  const hrefS = (/<a href="([^"]*)"/.exec(sheetS) || [])[1];
  check('…o passo a passo tem o botão "Abrir no Chrome", com o link do Android que abre o Chrome (e volta ao mesmo endereço se não houver Chrome)', hrefS === 'intent://peladanamao.com.br/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fpeladanamao.com.br%2F;end' && />Abrir no Chrome<\/a>/.test(sheetS), hrefS);
  check('…avisa o que fazer se o Chrome não abrir (digitar o endereço)', /Se o Chrome não abrir, abra-o por conta própria e digite <b>peladanamao\.com\.br<\/b>/.test(sheetS), sheetS);
  check('…explica o aviso "App de risco bloqueado" e que ele não é do Pelada na Mão', /App de risco bloqueado/.test(sheetS) && /não sobre o Pelada na Mão/.test(sheetS), sheetS);
  check('…tem 3 passos (Chrome, mesma conta do Google, Instalar), não manda procurar o menu ⋮, tem título próprio e o botão para fechar', (sheetS.match(/<li /g) || []).length === 3 && /Toque em <b>Abrir no Chrome<\/b>/.test(sheetS) && /mesma conta do Google/.test(sheetS) && /Toque em <b>Instalar<\/b> na faixa verde/.test(sheetS) && !/⋮/.test(sheetS) && /Instalar o app pelo Chrome/.test(sheetS) && /Entendi/.test(sheetS), sheetS);
  check('…e oferece instalar por este navegador mesmo assim, porque o navegador entregou o pedido de instalação', /Prefiro instalar por este navegador mesmo assim/.test(sheetS), sheetS);
  const anywayClick = (/<button onclick="([^"]*installNative\(\)[^"]*)"/.exec(sheetS) || [])[1] || '';
  check('…esse botão fecha o passo a passo e chama installNative()', anywayClick === "document.getElementById('install-help')?.remove();installNative()", anywayClick);
  e.layers.get('install-help').remove();
  await e.api.installNative();
  check('…installNative() abre a janela nativa (uma vez) e avisa que está instalando', evS.prompts === 1 && e.calls.toasts.some(([m, t]) => /Instalando/.test(m) && t === 'ok') && !e.layers.has('install-help'), { prompts: evS.prompts, toasts: e.calls.toasts });
  check('…sem contar um segundo clique em Instalar (o clique foi um só)', JSON.stringify(e.calls.events) === JSON.stringify([['installClick', false]]), e.calls.events);
  await e.api.installNative();
  check('…sem pedido guardado, installNative() cai no passo a passo em vez de ficar parado', e.layers.has('install-help'));

  e = makeEnv({ ua: UA.samsung });
  await e.api.installApp();
  const sheetS2 = e.layers.get('install-help')?.innerHTML || '';
  check('Samsung Internet sem pedido do navegador: o passo a passo do Chrome aparece igual, sem a segunda opção', />Abrir no Chrome<\/a>/.test(sheetS2) && !/mesmo assim/.test(sheetS2), sheetS2);

  for (const [rotulo, origin] of [['"null" (página sem endereço)', 'null'], ['endereço com HTML', 'https://a.com"><img src=x onerror=alert(1)>'], ['vazio', '']]) {
    e = makeEnv({ ua: UA.samsung, origin });
    await e.api.installApp();
    const s3 = e.layers.get('install-help')?.innerHTML || '';
    check(`Samsung Internet, endereço do site ${rotulo}: sem botão nem link, e o passo 1 manda abrir o Chrome e digitar peladanamao.com.br`, !/<a /.test(s3) && !/intent:/.test(s3) && !/onerror|<img/.test(s3) && /Abra o <b>Chrome<\/b> e digite <b>peladanamao\.com\.br<\/b>/.test(s3) && (s3.match(/<li /g) || []).length === 3, s3);
  }
  e = makeEnv({ ua: UA.samsung, origin: 'http://localhost:3000' });
  await e.api.installApp();
  check('Samsung Internet num servidor local (http + porta): o link e o endereço levam a porta', /intent:\/\/localhost:3000\/#Intent;scheme=http;/.test(e.layers.get('install-help')?.innerHTML || '') && /digite <b>localhost:3000<\/b>/.test(e.layers.get('install-help')?.innerHTML || ''), e.layers.get('install-help')?.innerHTML);

  const cu = api0.chromeIntentUrl;
  check('link do Chrome: https com domínio', cu('https://peladanamao.com.br') === 'intent://peladanamao.com.br/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fpeladanamao.com.br%2F;end', cu('https://peladanamao.com.br'));
  check('link do Chrome: maiúsculas viram minúsculas e a porta fica', cu('HTTP://Localhost:3000') === 'intent://localhost:3000/#Intent;scheme=http;package=com.android.chrome;S.browser_fallback_url=http%3A%2F%2Flocalhost%3A3000%2F;end', cu('HTTP://Localhost:3000'));
  for (const ruim of ['', null, undefined, 'null', 'javascript:alert(1)', 'https://a.com/caminho', 'https://a.com?x=1', 'https://a.com#x', 'https://a.com"><script>', 'https://user@a.com', 'ftp://a.com', 'a.com', 'https://', 'https://a.com:']) {
    check(`link do Chrome: endereço inválido (${JSON.stringify(ruim)}) não gera link`, cu(ruim) === '' && api0.parseSiteOrigin(ruim) === null, cu(ruim));
  }
  check('o endereço do site é lido em partes (esquema e domínio com porta)', JSON.stringify(api0.parseSiteOrigin('https://Peladanamao.com.br')) === JSON.stringify({ scheme: 'https', host: 'peladanamao.com.br' }) && api0.parseSiteOrigin('http://localhost:8080').host === 'localhost:8080');

  // quem não é Samsung Internet não muda nada
  e = makeEnv();
  await e.api.installApp();
  const helpChrome = e.layers.get('install-help')?.innerHTML || '';
  check('Chrome: o passo a passo continua o de sempre (menu ⋮), sem botão do Chrome nem segunda opção', /⋮/.test(helpChrome) && !/Abrir no Chrome/.test(helpChrome) && !/intent:/.test(helpChrome) && !/mesmo assim/.test(helpChrome) && /<div[^>]*>📲 Instalar o app<\/div>/.test(helpChrome), helpChrome);
  e = makeEnv();
  e.listeners.beforeinstallprompt(fakePrompt('accepted'));
  e.api.openInstallHelp();
  check('Chrome com o pedido de instalação guardado: o passo a passo não oferece a segunda opção do Samsung', !/mesmo assim/.test(e.layers.get('install-help')?.innerHTML || ''));
  e = makeEnv({ ua: UA.iphone, platform: 'iPhone', touchPoints: 5 });
  await e.api.installApp();
  const helpIos2 = e.layers.get('install-help')?.innerHTML || '';
  check('iPhone: o passo a passo continua o do Safari, sem nada do Chrome', /Safari/.test(helpIos2) && !/Chrome/.test(helpIos2) && !/intent:/.test(helpIos2), helpIos2);

  // ── contadores de uso (anônimos) ──────────────────────────────────────────────────────────
  e = makeEnv();
  check('a faixa vem marcada para contar quem a viu (data-ev="installBannerSeen")', /data-ev="installBannerSeen"/.test(e.api.installBanner()));
  await e.api.installApp();
  check('tocar em Instalar conta um clique (sempre, não só o primeiro da sessão)', JSON.stringify(e.calls.events) === JSON.stringify([['installClick', false]]), e.calls.events);
  e.listeners.appinstalled();
  check('instalar o app conta uma instalação', e.calls.events.some(([n, once]) => n === 'appInstalled' && once === false), e.calls.events);
  check('nenhum contador carrega dado da pessoa (só o nome do evento)', e.calls.events.every(ev => ev.length === 2 && typeof ev[0] === 'string'));
  // ── onde a faixa aparece na página ────────────────────────────────────────────────────────
  check('a faixa está no topo da liga, depois do aviso de plano e do de notificações', /main\.innerHTML=termsNotice\(\)\+planBanner\(\)\+notifBanner\(\)\+installBanner\(\)\+content/.test(html));
  const picker = html.slice(html.indexOf('function vSelectLeague()'), html.indexOf('function vPending()'));
  check('a faixa também aparece na tela "Escolha a liga"', picker.includes('${installBanner()}'));
  const login = html.slice(html.indexOf('function vLogin()'), html.indexOf('function slugify('));
  check('a tela de login NÃO tem a faixa (instalar no meio de um convite faria o app abrir sem o convite)', !login.includes('installBanner'));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
