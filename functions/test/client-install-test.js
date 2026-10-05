// Botão "Instalar o app" (index.html), isolado: extrai as funções reais e as executa num ambiente simulado,
// sem navegador. O botão só aparece em celular/tablet, logado, com o app ainda não instalado e sem ter sido
// dispensado; abre a janela nativa quando o navegador entregou o pedido de instalação e, senão, o passo a passo.
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
};

function makeEnv({ ua = UA.android, platform = 'Linux armv81', touchPoints = 5, standalone = false, navStandalone = undefined, authUser = { uid: 'u' }, storage = {}, storageThrows = false } = {}) {
  const calls = { render: 0, toasts: [] };
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
    render: () => { calls.render++; },
    toast: (m, t) => { calls.toasts.push([m, t]); },
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { installOsOf, installBannerInfo, readInstallEnv, installBanner, dismissInstallBanner, installApp, openInstallHelp, getPrompt: () => _installPrompt };')(...names.map(n => env[n]));
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

  // ── onde a faixa aparece na página ────────────────────────────────────────────────────────
  check('a faixa está no topo da liga, depois do aviso de plano e do de notificações', /main\.innerHTML=planBanner\(\)\+notifBanner\(\)\+installBanner\(\)\+content/.test(html));
  const picker = html.slice(html.indexOf('function vSelectLeague()'), html.indexOf('function vPending()'));
  check('a faixa também aparece na tela "Escolha a liga"', picker.includes('${installBanner()}'));
  const login = html.slice(html.indexOf('function vLogin()'), html.indexOf('function slugify('));
  check('a tela de login NÃO tem a faixa (instalar no meio de um convite faria o app abrir sem o convite)', !login.includes('installBanner'));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
