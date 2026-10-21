// Página de apresentação (index.html) e destaque do plano anual: quem vê a apresentação (e quem NÃO vê: convite, volta do
// pagamento, link de acesso por e-mail, quem já entrou neste aparelho, app instalado), os botões, o login com "Criar conta"
// em destaque, o texto da página (preços e prazos conferidos contra o servidor) e a tela de assinatura com o anual primeiro.
// Extrai o código real do index.html e o roda num ambiente simulado, sem navegador.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const termos = fs.readFileSync(path.join(root, 'termos.html'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');
const allowed = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('!')).map(l => l.slice(1));
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// ── o que decide se a apresentação pode aparecer (script do <head>) ─────────────────────────────
const headScript = (html.match(/<script>\s*\/\* Página de apresentação: só para quem chega sem convite[\s\S]*?\}\)\(\);\s*<\/script>/) || [])[0];
check('o <head> tem o script que calcula LP_ALLOWED, antes do </style> de fechamento do <head>', !!headScript && html.indexOf(headScript) < html.indexOf('</head>') && html.indexOf(headScript) > html.indexOf('</style>'));
const headCode = (headScript || '').replace(/^<script>/, '').replace(/<\/script>$/, '');
function allowedFor({ search = '', storage = {}, storageThrows = false, standalone = false, navStandalone = false, noMatchMedia = false } = {}) {
  const win = {};
  if (!noMatchMedia) win.matchMedia = () => ({ matches: standalone });
  const store = { getItem: k => { if (storageThrows) throw new Error('bloqueado'); return k in storage ? storage[k] : null; } };
  new Function('window', 'location', 'localStorage', 'navigator', 'matchMedia', 'URLSearchParams', headCode)(win, { search }, store, { standalone: navStandalone }, win.matchMedia, URLSearchParams);
  return win.LP_ALLOWED;
}
check('visitante novo, endereço limpo: pode ver a apresentação', allowedFor() === true);
for (const q of ['?ref=cartao', '?utm_source=whatsapp&utm_medium=grupo&utm_campaign=cartao', '?fbclid=abc', '?gclid=abc', '?ref=cartao&utm_source=x&fbclid=y']) {
  check(`vindo de cartão compartilhado ou de campanha (${q}): vê a apresentação`, allowedFor({ search: q }) === true);
}
for (const q of ['?invite=abc&liga=aceoma', '?liga=aceoma', '?invite=abc', '?mpReturn=aceoma', '?mode=signIn&oobCode=xyz&apiKey=k', '?apiKey=k', '?x=1', '?ref=cartao&invite=abc', '?utm_source=a&liga=b', '?pagar=1']) {
  check(`convite, volta do pagamento, link de acesso ou parâmetro desconhecido (${q}): abre direto no login, sem apresentação`, allowedFor({ search: q }) === false);
}
check('quem já entrou neste aparelho (aceoma_returning=1): sem apresentação', allowedFor({ storage: { aceoma_returning: '1' } }) === false);
check('…outro valor na marca não conta como "já entrou"', allowedFor({ storage: { aceoma_returning: '0' } }) === true && allowedFor({ storage: { aceoma_returning: '' } }) === true);
check('app instalado (modo standalone, Android/Chrome ou iPhone): sem apresentação', allowedFor({ standalone: true }) === false && allowedFor({ navStandalone: true }) === false);
check('navegador sem matchMedia: não quebra e segue a regra normal', allowedFor({ noMatchMedia: true }) === true);
check('armazenamento bloqueado (modo privado): na dúvida NÃO mostra (cai no login de sempre)', allowedFor({ storageThrows: true }) === false);
check('o script não falha mesmo sem nenhum dos recursos do navegador (cai no login, nunca em tela vazia)', (() => { try { const win = {}; new Function('window', 'location', 'localStorage', 'navigator', 'matchMedia', 'URLSearchParams', headCode)(win, undefined, undefined, undefined, undefined, undefined); return win.LP_ALLOWED === false; } catch (e) { return false; } })());

// ── lpSync, lpGo, lpBack ────────────────────────────────────────────────────────────────────────
const lpCode = slice('/* ── Apresentação (landing)', '/* ── fim da apresentação');
function makeLp(opts = {}) {
  const { st: stOver = {} } = opts, allowed = 'allowed' in opts ? opts.allowed : true; // (passar undefined de propósito vale como "ausente")
  const calls = { renders: 0, scrolls: [] };
  const classes = new Set();
  const win = { LP_ALLOWED: allowed, scrollTo: (...a) => calls.scrolls.push(a) };
  const st = { authUser: null, ready: true, _lpDismissed: false, _loginIntent: '', _loginTab: 'email', ...stOver };
  const doc = { documentElement: { classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); return on; } } } };
  const api = new Function('st', 'window', 'document', 'render', lpCode + '\nreturn { lpSync, lpGo, lpBack };')(st, win, doc, () => { calls.renders++; });
  return { api, st, calls, classes };
}
let L = makeLp();
check('lpSync: ninguém logado, app pronto, apresentação liberada: mostra (classe lp-show no <html>)', L.api.lpSync() === true && L.classes.has('lp-show'));
L = makeLp({ st: { ready: false } });
check('…app ainda carregando: NÃO mostra (fica a tela com o logo, para não piscar para quem já está logado)', L.api.lpSync() === false && !L.classes.has('lp-show'));
L = makeLp({ st: { authUser: { uid: 'u' } } });
check('…com alguém logado: não mostra, e se estava na tela, tira', L.api.lpSync() === false && !L.classes.has('lp-show'));
L.classes.add('lp-show'); L.api.lpSync();
check('…a classe é removida quando a pessoa passa a estar logada (a apresentação some e o app aparece)', !L.classes.has('lp-show'));
for (const v of [false, undefined, null, 'true', 1, 'sim']) check(`…LP_ALLOWED=${JSON.stringify(v)} (só o valor true libera): não mostra`, makeLp({ allowed: v }).api.lpSync() === false);
check('…depois de tocar em Entrar/Criar (dispensada): não mostra', makeLp({ st: { _lpDismissed: true } }).api.lpSync() === false);

L = makeLp();
L.api.lpGo('signup');
check('lpGo("signup"): dispensa a apresentação, marca a intenção de criar conta, abre o login por e-mail, redesenha e volta ao topo', L.st._lpDismissed === true && L.st._loginIntent === 'signup' && L.st._loginTab === 'email' && L.calls.renders === 1 && JSON.stringify(L.calls.scrolls) === '[[0,0]]', { st: L.st, calls: L.calls });
L = makeLp({ st: { _loginTab: 'link', _loginIntent: 'signup' } });
L.api.lpGo('login');
check('lpGo("login"): sem a intenção de criar conta, e volta para o login por e-mail', L.st._lpDismissed === true && L.st._loginIntent === '' && L.st._loginTab === 'email');
for (const v of [undefined, 'qualquer', '', 'SIGNUP', null]) check(`lpGo(${JSON.stringify(v)}): só "signup" vale como criar conta`, makeLp().api.lpGo(v) === undefined && (() => { const x = makeLp(); x.api.lpGo(v); return x.st._loginIntent === '' && x.st._lpDismissed === true; })());
L = makeLp({ st: { _lpDismissed: true, _loginIntent: 'signup' } });
L.api.lpBack();
check('lpBack: volta para a apresentação (limpa a dispensa e a intenção), redesenha e sobe ao topo', L.st._lpDismissed === false && L.st._loginIntent === '' && L.calls.renders === 1 && JSON.stringify(L.calls.scrolls) === '[[0,0]]');
L.api.lpSync();
check('…e a apresentação volta a aparecer', L.classes.has('lp-show'));

// ── ligação com o resto do app ──────────────────────────────────────────────────────────────────
check('render(): a apresentação é decidida ANTES do login e do app (return antecipado)', /function render\(\) \{\s*(?:if \(st\.ready\) window\.__pnmBooted = true;[^\n]*\n\s*)?const app=document\.getElementById\('app'\); if\(!app\) return;\s*if \(lpSync\(\)\) return;[^\n]*\n\s*(?:if \(st\._emailChange\) \{[^\n]*\n\s*if \(document\.getElementById\('main'\)\) app\.innerHTML = '';\r?\n\s*app\.innerHTML = vEmailChange\(st\._emailChange\);\r?\n\s*return;\r?\n\s*\}\r?\n\s*)?if \(!st\.authUser\) \{/.test(html), html.match(/function render\(\) \{[\s\S]{0,260}/)?.[0]);
check('quem entra (login confirmado pelo Firebase) ganha a marca aceoma_returning; quem sai (usuário nulo) NÃO ganha', /if \(!user\) \{[\s\S]*?render\(\); return;\s*\}\s*try \{ localStorage\.setItem\('aceoma_returning', '1'\); \} catch\(_\) \{\}/.test(html), html.match(/if \(!user\) \{[\s\S]{0,700}/)?.[0]);
check('o estado guarda a intenção de login e a dispensa da apresentação', /_loginIntent: '',/.test(html) && /_lpDismissed: false,/.test(html));
check('o app (#app) vem logo depois da apresentação no <body>, e a apresentação é escondida por padrão (só aparece com a classe lp-show)', /<div id="landing" class="lp">[\s\S]*<div id="app"><\/div>/.test(html) && /#landing \{ display: none; \}/.test(html) && /html\.lp-show #landing \{ display: block; \}/.test(html) && /html\.lp-show #app \{ display: none; \}/.test(html));
check('sem JavaScript (rastreadores, leitores simples): a apresentação aparece mesmo assim (noscript no <head>)', /<noscript><style>#landing \{ display: block !important; \} #app \{ display: none; \}<\/style><\/noscript>/.test(html));

// ── o login: "Criar conta" em destaque quando vem da apresentação ───────────────────────────────
const loginCode = slice('function vLogin() {', 'function slugify(');
function loginHtml({ intent = '', tab = 'email', lp = false } = {}) {
  return new Function('st', 'window', loginCode + '\nreturn vLogin();')({ _loginIntent: intent, _loginTab: tab }, { LP_ALLOWED: lp });
}
const txt = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let lg = loginHtml();
check('login comum: "Entrar com Google", botão "Entrar" (entra), "Criar conta" pequeno (cria) e "Entrar sem senha"', /Entrar com Google/.test(lg) && />Entrar<\/button>/.test(lg) && /onclick="doLoginEmail\('login'\)"[^>]*>[^<]*Entrar<\/button>/.test(lg.replace(/\s+/g, ' ').replace(/<button onclick="doLoginEmail\('login'\)"\s+style="[^"]*">/, '<button onclick="doLoginEmail(\'login\')" style="x">')) && /doLoginEmail\('signup'\)"[\s\S]*?>Criar conta<\/button>/.test(lg) && /Entrar sem senha/.test(lg) && !/Crie a sua conta/.test(lg), txt(lg));
check('…o Enter na senha entra (login); os campos e o aviso de erro continuam com os mesmos ids', /id="li-email"/.test(lg) && /id="li-pw"/.test(lg) && /id="login-err"/.test(lg) && /doLoginEmail\('login'\)"/.test(lg.match(/id="li-pw"[^>]*/)?.[0] || ''));
lg = loginHtml({ intent: 'signup' });
check('login vindo de "Criar minha liga grátis": explica ("Crie a sua conta… o teste de 8 dias começa quando a liga é criada") e usa "Continuar com Google"', /Crie a sua conta/.test(lg) && /teste grátis de 8 dias começa quando a liga é criada/.test(lg) && /Continuar com Google/.test(lg) && !/Entrar com Google/.test(lg), txt(lg));
check('…o botão grande vira "Criar conta" e cria (signup); o Enter na senha também cria; "Já tenho conta" volta ao login comum', /doLoginEmail\('signup'\)"\s+style="width:100%[^"]*">Criar conta<\/button>/.test(lg.replace(/\s+/g, ' ').replace(/doLoginEmail\('signup'\)" style/, 'doLoginEmail(\'signup\')"\n style')) || (/Criar conta<\/button>/.test(lg) && !/doLoginEmail\('login'\)/.test(lg)), lg.match(/<button onclick="doLoginEmail[\s\S]{0,260}/)?.[0]);
check('…sem nenhum caminho que ENTRE (login) por engano nesse modo, e com "Já tenho conta" para trocar', !/doLoginEmail\('login'\)/.test(lg) && /st\._loginIntent='';render\(\)[^>]*>\s*Já tenho conta/.test(lg), txt(lg));
check('o login por link (sem senha) não muda com a intenção', txt(loginHtml({ intent: 'signup', tab: 'link' })) === txt(loginHtml({ intent: '', tab: 'link' })) && /Enviaremos um link de acesso/.test(loginHtml({ tab: 'link' })));
check('"← Conhecer o app" só existe para quem veio da apresentação (LP_ALLOWED=true); convite e quem já é de casa não veem', /lpBack\(\)/.test(loginHtml({ lp: true })) && !/lpBack\(\)/.test(loginHtml({ lp: false })) && !/lpBack\(\)/.test(loginHtml({ lp: undefined })) && /Conhecer o app/.test(loginHtml({ lp: true, intent: 'signup' })));
check('Privacidade e Termos de Uso continuam no login nos dois modos', ['', 'signup'].every(i => /openPrivacyPolicy\(\)/.test(loginHtml({ intent: i })) && /href="\/termos\.html"/.test(loginHtml({ intent: i }))));

// ── o texto da apresentação ─────────────────────────────────────────────────────────────────────
const landing = html.slice(html.indexOf('<div id="landing" class="lp">'), html.indexOf('<div id="app"></div>'));
const landingText = landing.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
check('a apresentação existe e tem UM título principal (h1) igual à promessa do <title>', landing.length > 4000 && (landing.match(/<h1[ >]/g) || []).length === 1 && /<h1>Organize sua pelada <em>no celular<\/em><\/h1>/.test(landing) && /<title>Pelada na Mão — organize sua pelada no celular<\/title>/.test(html));
check('seções: como funciona, recursos, cartão, planos, perguntas e chamada final', ['como-funciona', 'recursos', 'cartao', 'planos', 'perguntas'].every(id => landing.includes(`id="${id}"`)) && /Bora organizar a próxima pelada/.test(landing));
check('3 passos, 8 recursos, 3 planos (teste, anual, mensal) e pelo menos 6 perguntas', (landing.match(/<li class="lp-card">/g) || []).length === 3 && (landing.match(/<article class="lp-card">/g) || []).length === 8 && (landing.match(/<div class="lp-card lp-plan/g) || []).length === 3 && (landing.match(/<details class="lp-faq">/g) || []).length >= 6);
const handlers = [...landing.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
check('todo botão da página chama só lpGo("signup"), lpGo("login") ou openPrivacyPolicy() — funções que existem', handlers.length >= 6 && handlers.every(h => /^(lpGo\('(signup|login)'\)|openPrivacyPolicy\(\))$/.test(h)) && /function lpGo\(/.test(html) && /function openPrivacyPolicy\(/.test(html), handlers);
check('"Criar minha liga grátis" aparece no topo, nos planos e no fim (3 chamadas) e todas criam conta', (landing.match(/onclick="lpGo\('signup'\)">Criar minha liga grátis<\/button>/g) || []).length === 3);
check('"Entrar" e "Já tenho conta" levam ao login (lpGo login)', /onclick="lpGo\('login'\)">Entrar<\/button>/.test(landing) && /onclick="lpGo\('login'\)">Já tenho conta<\/button>/.test(landing));
check('não usa as tags header, main e nav (o app tem regras de CSS próprias para elas, que estragariam a página)', !/<(header|main|nav)[ >]/.test(landing));
const imgs = [...landing.matchAll(/<img ([^>]*)>/g)].map(m => m[1]);
check('imagens: todas com texto alternativo, largura e altura (sem pulo de layout), arquivo existente e liberado no deploy', imgs.length === 3 && imgs.every(a => /alt="[^"]{8,}"/.test(a) && /width="\d+"/.test(a) && /height="\d+"/.test(a) && (() => { const f = (a.match(/src="\/([^"]+)"/) || [])[1]; return !!f && fs.existsSync(path.join(root, f)) && allowed.includes(f); })()), imgs);
check('as duas imagens de cartão carregam só quando chegam perto (lazy) e a do logo não', imgs.filter(a => /loading="lazy"/.test(a)).length === 2 && !/loading="lazy"/.test(imgs.find(a => /logo\.webp/.test(a)) || ''));
const hrefs = [...landing.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
check('o aviso de pagamento diz que dá para desistir em até 7 dias e receber o valor de volta, que depois disso não há reembolso, e leva aos Termos na cláusula 10 (link no próprio aviso)', /Você pode desistir em até 7 dias depois de pagar e receber o valor de volta; depois disso, não há reembolso\. Veja os <a href="\/termos\.html#c10">Termos de Uso<\/a>\./.test(landing));
check('os links são só os Termos de Uso (e a cláusula 10), o e-mail de contato — e a cláusula 10 existe nos Termos', hrefs.length >= 3 && hrefs.every(h => ['/termos.html', '/termos.html#c10', 'mailto:suporte@peladanamao.com.br'].includes(h)) && /id="c10"/.test(termos) && /suporte@peladanamao\.com\.br/.test(termos), hrefs);

// preços e prazos: tudo igual ao servidor
const srv = { monthly: Number((server.match(/monthly: \{ amount: ([\d.]+)/) || [])[1]), annual: Number((server.match(/annual: \{ amount: ([\d.]+)/) || [])[1]), trial: Number((server.match(/const TRIAL_DAYS = (\d+)/) || [])[1]) };
const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',');
check('o servidor cobra R$ 29,90 por mês, R$ 238,80 por ano e dá 8 dias de teste (base de todas as conferências abaixo)', srv.monthly === 29.9 && srv.annual === 238.8 && srv.trial === 8, srv);
const perMonth = srv.annual / 12, saving = Math.round((srv.monthly * 12 - srv.annual) * 100) / 100;
check('a apresentação mostra os mesmos valores do servidor: R$ 29,90, R$ 238,80, R$ 19,90 (a parcela de 12x) e a economia de R$ 120 por ano', landingText.includes(brl(srv.monthly)) && landingText.includes(brl(srv.annual)) && landingText.includes(brl(perMonth)) && landingText.includes('R$ ' + saving) && saving === 120, landingText.match(/R\$ [\d.,]+/g));
check('…e NENHUM outro valor em reais (preço antigo ou inventado)', [...landingText.matchAll(/R\$ ?([\d.,]+)/g)].every(m => ['29,90', '238,80', '19,90', '120'].includes(m[1])), landingText.match(/R\$ [\d.,]+/g));
check('o teste de "8 dias" é o do servidor, e a página diz 8 dias nos três lugares (selo, plano, login)', landingText.includes(srv.trial + ' dias') && (landingText.match(/8 dias/g) || []).length >= 2 && /teste grátis de 8 dias começa/.test(loginCode));
check('promessas que o produto cumpre hoje: sem cartão de crédito, jogadores não pagam, sem fidelidade, cancela pelo app, pagamento pelo Mercado Pago, parcelas em até 12x sem juros no cartão de crédito, desistir em até 7 dias e depois sem reembolso (com o link dos Termos)', ['Sem cartão de crédito', 'Seus jogadores não pagam nada', 'Sem fidelidade', 'cancele quando quiser, pelo próprio app', 'Mercado Pago', 'Pagamento único. No cartão de crédito, em até 12x sem juros.', 'desistir em até 7 dias'].every(f => landingText.includes(f)), landingText.slice(0, 200));
check('NÃO promete o que não existe: nada de garantia, "devolvemos", "sem compromisso", número de usuários, ranking de mercado ou depoimentos inventados', !/garantia|devolv|sem compromisso|milhares|milhões|mais de \d+ (ligas|usuários|jogadores|pessoas)|nº ?1|número 1|melhor app|depoimento|avalia[çc][ãa]o/i.test(landingText), landingText.match(/.{20}(garantia|devolv|sem compromisso|milhares|milhões|melhor app|depoimento).{20}/i)?.[0]);
// O combinado com o Mercado Pago (conferido no checkout do anual em 14/10/2026): até 12x SEM juros no cartão de crédito, por configuração da
// conta do dono. Os textos só podem dizer isso: o número vem de PLAN_FREE_INSTALLMENTS (index.html), e "sem juros" só aparece nessa frase.
const PARCELAS_SEM_JUROS = Number((html.match(/const PLAN_FREE_INSTALLMENTS = (\d+);/) || [])[1]);
const parcelasForaDoCombinado = s => /sem acr[ée]scimo|parcel[áa]vel em at[ée]/i.test(s)
  || [...s.matchAll(/(\d+) ?x\b/gi)].some(m => Number(m[1]) !== PARCELAS_SEM_JUROS)
  || [...s.matchAll(/sem juros/gi)].some(m => ![`em até ${PARCELAS_SEM_JUROS}x sem juros`, `${PARCELAS_SEM_JUROS}x de ${brl(srv.annual / PARCELAS_SEM_JUROS)} sem juros`].some(f => s.slice(0, m.index + m[0].length).endsWith(f)));
check('parcelamento do anual: a apresentação diz "No cartão de crédito, em até 12x sem juros" e NADA além disso (nenhum outro número de parcelas, "sem juros" só nessa frase, nem "sem acréscimo" ou "parcelável em até")', PARCELAS_SEM_JUROS === 12 && /Pagamento único\. No cartão de crédito, em até 12x sem juros\./.test(landingText) && !parcelasForaDoCombinado(landingText), landingText.match(/.{30}(juros|parcel).{40}/gi));
check('…e a oferta está em destaque no cartão do anual: "12x de R$ 19,90 sem juros no cartão de crédito" (negrito) logo abaixo do preço de R$ 238,80 por ano, com a economia; a parcela é o preço dividido pelo número de parcelas', /<p class="lp-price"><b>R\$ 238,80<\/b> por ano<\/p>\s*<p class="lp-save"><b>12x de R\$ 19,90 sem juros<\/b> no cartão de crédito\. Você economiza R\$ 120 por ano\.<\/p>/.test(landing) && brl(srv.annual / PARCELAS_SEM_JUROS) === 'R$ 19,90' && /12x de R\$ 19,90 sem juros no cartão de crédito\. Você economiza R\$ 120 por ano\./.test(landingText), landingText.match(/.{40}12x de.{80}/));
check('…a promessa antiga "parcelável em até 12x" (sem dizer os juros) não volta no app, no comentário do servidor nem no manual', !/parcel[áa]vel em at[ée] \d+x/i.test(html) && !/parcel[áa]vel em at[ée] \d+x/i.test(server) && !/parcel[áa]vel em at[ée] \d+x/i.test(manual), [html, server, manual].map(s => (s.match(/.{20}parcel[áa]vel em at[ée].{20}/i) || [])[0]));
const manualParcelas = txt(manual.slice(manual.indexOf('id="assinatura"'), manual.indexOf('id="estender-plano"')));
check('manual (seção 26): a linha do anual diz "em até 12x sem juros" (custo do vendedor, valor cai de uma vez); o quadro explica que é configuração da conta do Mercado Pago (com o endereço da tela), que o custo é do vendedor, que 13x a 18x têm juros pagos pelo comprador, que o app não limita o máximo, que o valor total cai de uma vez e que painel e textos devem ficar em sincronia', /Cobrança única\. No cartão de crédito, em até 12x sem juros \(o custo do parcelamento é do vendedor, configurado na conta do Mercado Pago: veja o quadro abaixo\); o valor cai na conta de uma vez, mesmo parcelado\./.test(manualParcelas) && /Parcelamento no cartão \(plano anual\): até 12x sem juros No cartão de crédito, o plano anual pode ser pago em até 12x sem juros \(12x de R\$ 19,90\)\./.test(manualParcelas) && /configuração da conta do Mercado Pago do dono \( ?mercadopago\.com\.br\/costs-section\/merchant-svcs\/financing\/psj\/installments ?\), não do app/.test(manualParcelas) && /O custo é do vendedor/.test(manualParcelas) && /de 13x a 18x, com juros pagos pelo comprador/.test(manualParcelas) && /payment_methods\.installments não é enviado/.test(manualParcelas) && /o valor total cai de uma vez na conta do vendedor/.test(manualParcelas) && /Mantenha o painel e os textos em sincronia/.test(manualParcelas) && /PLAN_FREE_INSTALLMENTS/.test(manualParcelas), manualParcelas.slice(manualParcelas.indexOf('Parcelamento no cartão'), manualParcelas.indexOf('Parcelamento no cartão') + 200));
check('manual: numa devolução (desistência em 7 dias) o Mercado Pago devolve as taxas ao vendedor, inclusive a do parcelamento sem juros: dito no quadro do parcelamento e no passo a passo da desistência (confirmado com o suporte em 14/10/2026)', /Se a venda for devolvida \(por exemplo, numa desistência em 7 dias\), o Mercado Pago devolve as taxas ao vendedor: confirmado com o suporte do Mercado Pago em 14\/10\/2026/.test(manualParcelas) && /Numa devolução o Mercado Pago devolve as taxas cobradas na venda \(confirmado com o suporte do Mercado Pago em 14\/10\/2026, ao perguntar do parcelamento sem juros\), então desistir dentro dos 7 dias não deixa taxa para você pagar\./.test(txt(manual.slice(manual.indexOf('id="atender-desistencia"'), manual.indexOf('Segurança do webhook')))));
const mensalEmDobro = txt(manual.slice(manual.indexOf('id="mensal-em-dobro"'), manual.indexOf('Fora do app empacotado nas lojas')));
check('manual (seção 26): o quadro "Assinatura mensal em dobro" explica as duas proteções (mesmo link em até 30 minutos; cancela a duplicada autorizada, ficando a de validade mais longa), que a pendente não é tocada, que a devolução do mês em dobro é manual e onde o aviso aparece no registro', /Cada toque em Mensal cria uma assinatura nova no Mercado Pago, e duas assinaturas mensais autorizadas na mesma liga cobrariam em dobro todo mês/.test(mensalEmDobro) && /1\) Reaproveita o checkout pendente: quem toca de novo em até 30 minutos, sendo o mesmo admin e o mesmo valor, recebe o mesmo link/.test(mensalEmDobro) && /2\) Cancela a duplicada autorizada: .*fica a de validade mais longa \(empate: a criada primeiro\) e as outras são canceladas no Mercado Pago/.test(mensalEmDobro) && /pela reconciliação de 6 em 6 horas/.test(mensalEmDobro) && /pendente \(checkout aberto e nunca concluído\) não cobra nada e não é tocada/.test(mensalEmDobro) && /a devolução do mês em dobro é manual, pelo painel do Mercado Pago/.test(mensalEmDobro) && /Assinatura mensal duplicada cancelada/.test(mensalEmDobro), mensalEmDobro.slice(0, 200));
check('manual (seção 30 e quadro "Anual em destaque"): o resumo dos planos diz "12x de R$ 19,90 sem juros no cartão de crédito" e a tela mostra o botão com essa oferta; e o número de parcelas é UM só (constante do app, apresentação e manual)', /\(12x de R\$ 19,90 sem juros no cartão de crédito, economia de R\$ 120 por ano\)/.test(txt(manual)) && /o botão mostra R\$ 238,80 \(12x de R\$ 19,90 sem juros\) ?, e a linha de baixo compara com os R\$ 358,80 de 12 mensalidades de R\$ 29,90\. O botão Estender plano mostra a mesma oferta \(12x de R\$ 19,90 sem juros\)\./.test(txt(manual)) && PARCELAS_SEM_JUROS === 12 && landingText.includes(`em até ${PARCELAS_SEM_JUROS}x sem juros`) && txt(manual).includes(`em até ${PARCELAS_SEM_JUROS}x sem juros`));
check('sem texto de rascunho esquecido (TODO, lorem, undefined, NaN, colchetes)', !/\bTODO\b|lorem|ipsum|undefined|\bNaN\b|\[[^\]]*\]|\bXXX\b/.test(landingText), landingText.match(/.{15}(\bTODO\b|lorem|undefined|\bNaN\b|\bXXX\b).{15}/)?.[0]);
check('o plano gratuito é descrito como o manual e os Termos descrevem: não bloqueia, mantém o histórico, pausa gols/ranking/conquistas novas', /não é bloqueada/.test(landingText) && /todo o histórico fica guardado/.test(landingText) && /registro de gols, o ranking e as conquistas novas ficam pausados/.test(landingText));
check('contato por e-mail e Termos no rodapé, © do ano atual do produto', /© 2026 Pelada na Mão/.test(landing) && /<div class="lp-foot">[\s\S]*Termos de Uso[\s\S]*Privacidade[\s\S]*suporte@peladanamao\.com\.br/.test(landing));

// ── tela de assinatura: o anual primeiro, em destaque, com a economia ─────────────────────────
const subCode = slice('// Valores mostrados na tela de assinatura', 'async function startSubscription(plan) {');
function sub(league) {
  const st = { modal: { type: 'subscription' }, leagueId: 'lg', availableLeagues: [{ id: 'lg', ...league }], _payChecking: false, _subBusy: false };
  const api = new Function('st', 'addMonthsISO', subCode + '\nreturn { mSubscription, PLAN_PRICES, PLAN_SAVING, planBRL };')(st, (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; });
  return { api, html: api.mSubscription(), st };
}
const DAY = 86400000, iso = d => new Date(Date.now() + d * DAY).toISOString();
const livre = sub({ trialEndsAt: iso(-3) }), teste = sub({ trialEndsAt: iso(4) });
check('valores da tela de assinatura: iguais aos do servidor (29,90 e 238,80), economia de R$ 120,00 e R$ 19,90 por mês', livre.api.PLAN_PRICES.monthly === srv.monthly && livre.api.PLAN_PRICES.annual === srv.annual && livre.api.PLAN_SAVING === 120 && livre.api.planBRL(livre.api.PLAN_PRICES.annual / 12) === 'R$ 19,90' && livre.api.planBRL(livre.api.PLAN_PRICES.monthly * 12) === 'R$ 358,80', livre.api.PLAN_PRICES);
for (const [rot, s] of [['plano gratuito', livre], ['em teste', teste]]) {
  const t = txt(s.html);
  check(`${rot}: o ANUAL vem primeiro (botão e texto) e o mensal depois`, s.html.indexOf("startSubscription('annual')") > 0 && s.html.indexOf("startSubscription('annual')") < s.html.indexOf("startSubscription('monthly')") && t.indexOf('Anual') < t.indexOf('Mensal'), t);
  check(`${rot}: selo "MELHOR VALOR · ECONOMIZE R$ 120,00", a oferta "(12x de R$ 19,90 sem juros)" no botão e a conta (R$ 358,80 em 12 meses no mensal)`, /MELHOR VALOR · ECONOMIZE R\$ 120,00/.test(t) && /Anual — R\$ 238,80 \(12x de R\$ 19,90 sem juros\)/.test(t) && /Em vez de R\$ 358,80 em 12 meses no plano mensal: você economiza R\$ 120,00/.test(t), t);
  check(`${rot}: o mensal diz o que o servidor e o e-mail dizem (R$ 29,90/mês, sem fidelidade, cancela no app); parcelamento do anual; aviso de que dá para desistir em 7 dias e depois não há reembolso`, /Mensal — R\$ 29,90\/mês/.test(t) && /sem fidelidade: cancele quando quiser, aqui no app/.test(t) && /Pagamento único\. No cartão de crédito, em até 12x sem juros/.test(t) && /Você pode desistir em até 7 dias depois de pagar e receber o valor de volta \(escreva para suporte@peladanamao\.com\.br\); depois disso, não há reembolso\. Ao assinar, você concorda com os Termos de Uso/.test(t), t);
  check(`${rot}: a tela de assinatura diz só "em até 12x sem juros" (nenhum outro número de parcelas, "sem juros" só nessa frase)`, !parcelasForaDoCombinado(t) && /em até 12x sem juros/.test(t), t.match(/.{30}(juros|parcel).{40}/gi));
  check(`${rot}: o anual tem destaque (borda e fundo verdes); o mensal, o estilo comum`, /startSubscription\('annual'\)"\s*style="[^"]*border:2px solid var\(--accent\)/.test(s.html) && /startSubscription\('monthly'\)"\s*style="[^"]*border:1px solid var\(--border\)/.test(s.html));
}
const mensal = sub({ subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(20), subscriptionRenewsAt: iso(19) });
const anual = sub({ subscriptionPlan: 'annual', subscriptionActiveUntil: iso(200), subscriptionRenewsAt: iso(199) });
const cancelada = sub({ subscriptionPlan: 'monthly', subscriptionCancelledAt: iso(-1), subscriptionActiveUntil: iso(10), subscriptionRenewsAt: iso(9) });
check('mensal ativa: "Estender plano — R$ 238,80" e a conta da economia (R$ 238,80 por ano contra R$ 358,80 em 12 mensalidades) + o aviso de que a mensal é cancelada sozinha', /Estender plano — R\$ 238,80/.test(txt(mensal.html)) && /No anual são R\$ 238,80 por ano, contra R\$ 358,80 em 12 mensalidades: você economiza R\$ 120,00\./.test(txt(mensal.html)) && /a assinatura mensal é cancelada sozinha/.test(txt(mensal.html)) && !/MELHOR VALOR/.test(mensal.html));
check('estender o plano (mensal ativa e anual ativa): o anual também diz "No cartão de crédito, em até 12x sem juros" e nada além disso', [mensal, anual].every(s => /Pagamento único\. No cartão de crédito, em até 12x sem juros/.test(txt(s.html)) && !parcelasForaDoCombinado(txt(s.html))), [txt(mensal.html), txt(anual.html)].map(x => x.slice(0, 200)));
check('estender o plano (mensal ativa, anual ativa e mensal cancelada): o botão mostra a mesma oferta, "Estender plano — R$ 238,80 (12x de R$ 19,90 sem juros)"', [mensal, anual, cancelada].every(s => /Estender plano — R\$ 238,80 \(12x de R\$ 19,90 sem juros\)/.test(txt(s.html))), [mensal, anual, cancelada].map(s => txt(s.html).slice(0, 160)));
check('anual ativa: só estende, sem falar em economia (já é anual) e sem o selo', /Estender plano — R\$ 238,80/.test(txt(anual.html)) && !/economiza|ECONOMIZE|358,80/.test(txt(anual.html)) && !/MELHOR VALOR/.test(anual.html));
check('mensal cancelada (ainda no período pago): estende sem a nota de economia (ela não paga mais mensalidade) nem o aviso de cancelamento automático', /Estender plano/.test(txt(cancelada.html)) && !/economiza/.test(txt(cancelada.html)) && !/cancelada sozinha/.test(txt(cancelada.html)));
const confirmando = sub({ trialEndsAt: iso(-3) }); confirmando.st._payChecking = true;
check('enquanto confirma o pagamento os planos somem (ninguém paga duas vezes por pressa)', !/startSubscription/.test(confirmando.api.mSubscription()) && /Confirmando seu pagamento/.test(confirmando.api.mSubscription()));
const ocupado = sub({ trialEndsAt: iso(-3) }); ocupado.st._subBusy = true;
check('com um pedido em andamento os dois botões ficam desabilitados', (ocupado.api.mSubscription().match(/<button disabled onclick="startSubscription/g) || []).length === 2);
check('o painel de assinatura nem aparece quando não é a janela aberta', (() => { const s = sub({}); s.st.modal = { type: 'outra' }; return s.api.mSubscription() === ''; })());
check('a economia do anual no e-mail de fim de teste é a mesma da tela (R$ 120,00 por ano): o e-mail calcula a partir dos mesmos preços do servidor', /economia de \$\{money\(MP_PLANS\.monthly\.amount \* 12 - MP_PLANS\.annual\.amount\)\} por ano/.test(server) && saving === 120);

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
