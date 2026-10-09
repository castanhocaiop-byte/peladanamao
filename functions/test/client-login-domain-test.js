// Endereço da janela de login do Google (index.html + vercel.json): o site repassa /__/auth/ ao Firebase e, na produção, o login
// pode usar peladanamao.com.br como "authDomain" em vez de seriebaceoma.firebaseapp.com. Nesta etapa é opcional (?login=proprio
// liga neste aparelho, ?login=google desliga): o padrão NÃO muda até o endereço de retorno ser autorizado no Google Cloud e o
// login ser testado ao vivo. Extrai o código real do index.html e o executa num navegador simulado.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vercelRaw = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const vercelIgnore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');
const vercel = JSON.parse(vercelRaw);

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const at = s => { const i = html.indexOf(s); if (i < 0) throw new Error('trecho não encontrado: ' + s); return i; };
function slice(from, to) { const a = at(from); const b = html.indexOf(to, a); if (b < 0) throw new Error('marcador não encontrado: ' + to); return html.slice(a, b); }

// ── vercel.json: repasse transparente ───────────────────────────────────────────────────────────
const rw = vercel.rewrites || [];
check('vercel.json: existe UM repasse (rewrite) de /__/auth/ para o Firebase, com o caminho e a pergunta preservados', rw.length === 1 && rw[0].source === '/__/auth/:path*' && rw[0].destination === 'https://seriebaceoma.firebaseapp.com/__/auth/:path*', rw);
check('…é repasse de verdade (o navegador continua no nosso endereço), não redirecionamento: sem "permanent" nem "statusCode"', rw.length === 1 && !('permanent' in rw[0]) && !('statusCode' in rw[0]) && !('headers' in rw[0]), rw[0]);
const prodAuth = (/production: \{[\s\S]*?authDomain: "([^"]+)"/.exec(html) || [])[1];
const stagAuth = (/staging: \{[\s\S]*?authDomain: "([^"]+)"/.exec(html) || [])[1];
check('…e o destino é o authDomain da PRODUÇÃO que está na tabela de ambientes (nunca o do teste)', rw.length === 1 && rw[0].destination === `https://${prodAuth}/__/auth/:path*` && !/staging/.test(JSON.stringify(rw)), { prodAuth, rw });
check('o redirecionamento do endereço antigo (aceoma.vercel.app) continua igual: só para aquele endereço e provisório', vercel.redirects.length === 1 && vercel.redirects[0].source === '/(.*)' && vercel.redirects[0].has[0].value === 'aceoma.vercel.app' && vercel.redirects[0].destination === 'https://peladanamao.com.br/$1' && vercel.redirects[0].permanent === false, vercel.redirects);
check('vercel.json continua liberado no .vercelignore (senão a configuração nem chega à Vercel)', /^!vercel\.json\s*$/m.test(vercelIgnore));
check('vercel.json só tem redirects e rewrites (nada de cabeçalhos ou outras regras que mexam no resto do site)', JSON.stringify(Object.keys(vercel).sort()) === JSON.stringify(['redirects', 'rewrites']), Object.keys(vercel));

// ── a tabela de ambientes NÃO mudou nesta etapa ─────────────────────────────────────────────────
check('o padrão da produção continua seriebaceoma.firebaseapp.com e o do teste seriebaceoma-staging.firebaseapp.com (a troca só vale com ?login=proprio)', prodAuth === 'seriebaceoma.firebaseapp.com' && stagAuth === 'seriebaceoma-staging.firebaseapp.com', { prodAuth, stagAuth });

// ── a chave ?login=proprio ──────────────────────────────────────────────────────────────────────
const fnCode = slice("const OWN_AUTH_DOMAIN", "if (APP_ENV.name === 'production' && ownLoginDomainOn())");
const afterLine = html.slice(at("if (APP_ENV.name === 'production' && ownLoginDomainOn())"));
const overrideLine = afterLine.slice(0, afterLine.indexOf('\n'));
function boot({ search = '', stored = null, throws = false, env = 'production' } = {}) {
  const store = stored === null ? {} : { aceoma_login_proprio: stored };
  const localStorage = throws
    ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); }, removeItem() { throw new Error('indisponível'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const firebaseConfig = { apiKey: 'k', authDomain: env === 'production' ? 'seriebaceoma.firebaseapp.com' : 'seriebaceoma-staging.firebaseapp.com', projectId: 'p' };
  const APP_ENV = { name: env, firebaseConfig };
  const api = new Function('location', 'localStorage', 'APP_ENV', 'firebaseConfig', fnCode + '\n' + overrideLine + '\nreturn { ownLoginDomainOn, OWN_AUTH_DOMAIN };')({ search }, localStorage, APP_ENV, firebaseConfig);
  return { api, store, firebaseConfig };
}
let b = boot();
check('sem pedir nada: o login continua no endereço padrão do Firebase e nada é guardado', b.firebaseConfig.authDomain === 'seriebaceoma.firebaseapp.com' && b.api.ownLoginDomainOn() === false && Object.keys(b.store).length === 0, b.firebaseConfig);
b = boot({ search: '?login=proprio' });
check('?login=proprio: liga o endereço do próprio site (peladanamao.com.br), só no authDomain, e guarda a escolha neste aparelho', b.firebaseConfig.authDomain === 'peladanamao.com.br' && b.store.aceoma_login_proprio === '1' && b.api.OWN_AUTH_DOMAIN === 'peladanamao.com.br', { cfg: b.firebaseConfig, store: b.store });
check('…as outras chaves da configuração do Firebase ficam exatamente como eram (o Google manda não mexer em nada além do authDomain)', b.firebaseConfig.apiKey === 'k' && b.firebaseConfig.projectId === 'p' && Object.keys(b.firebaseConfig).join() === 'apiKey,authDomain,projectId');
b = boot({ stored: '1' });
check('na visita seguinte (sem o parâmetro) a escolha guardada continua valendo', b.firebaseConfig.authDomain === 'peladanamao.com.br' && b.api.ownLoginDomainOn() === true);
b = boot({ search: '?login=google', stored: '1' });
check('?login=google: desliga, apaga a escolha guardada e volta ao endereço padrão', b.firebaseConfig.authDomain === 'seriebaceoma.firebaseapp.com' && !('aceoma_login_proprio' in b.store) && b.api.ownLoginDomainOn() === false, { cfg: b.firebaseConfig, store: b.store });
for (const [rotulo, search] of [['valor desconhecido', '?login=outra'], ['valor vazio', '?login='], ['maiúsculas', '?login=PROPRIO'], ['parâmetro sem valor', '?login'], ['parâmetro com outro nome', '?entrar=proprio']]) {
  const sem = boot({ search }); const com = boot({ search, stored: '1' });
  check(`parâmetro ${rotulo} (${search}): não liga nem desliga nada`, sem.firebaseConfig.authDomain === 'seriebaceoma.firebaseapp.com' && !('aceoma_login_proprio' in sem.store) && com.firebaseConfig.authDomain === 'peladanamao.com.br' && com.store.aceoma_login_proprio === '1', { sem: sem.firebaseConfig, com: com.firebaseConfig });
}
b = boot({ search: '?invite=abc123&liga=minha-liga&login=proprio' });
check('junto com convite e liga na mesma endereço: o parâmetro é lido e o convite não atrapalha', b.firebaseConfig.authDomain === 'peladanamao.com.br');
for (const guardado of ['true', '0', '', 'sim', ' 1']) {
  b = boot({ stored: guardado });
  check(`valor guardado "${guardado}" (qualquer coisa diferente de 1): não liga`, b.firebaseConfig.authDomain === 'seriebaceoma.firebaseapp.com' && b.api.ownLoginDomainOn() === false);
}
b = boot({ search: '?login=proprio', throws: true });
check('sem acesso ao armazenamento do navegador (modo privado): não quebra e fica no endereço padrão', b.firebaseConfig.authDomain === 'seriebaceoma.firebaseapp.com' && b.api.ownLoginDomainOn() === false);
b = boot({ search: '?login=proprio', env: 'staging' });
check('no ambiente de TESTE nada muda, mesmo com o parâmetro (o login do teste é por e-mail e senha e tem projeto próprio)', b.firebaseConfig.authDomain === 'seriebaceoma-staging.firebaseapp.com', b.firebaseConfig);
b = boot({ stored: '1', env: 'staging' });
check('…nem com a escolha guardada de outra visita', b.firebaseConfig.authDomain === 'seriebaceoma-staging.firebaseapp.com');

// ── como está escrito no código ─────────────────────────────────────────────────────────────────
check('a troca acontece DEPOIS de escolher o ambiente e ANTES de iniciar o Firebase (initFirebase usa a mesma configuração)', at('const firebaseConfig = APP_ENV.firebaseConfig;') < at("if (APP_ENV.name === 'production' && ownLoginDomainOn())") && at("if (APP_ENV.name === 'production' && ownLoginDomainOn())") < at('function initFirebase()') && /firebase\.initializeApp\(firebaseConfig\);/.test(html));
check('só a produção é trocada (a condição olha o nome do ambiente) e só o authDomain muda', /^if \(APP_ENV\.name === 'production' && ownLoginDomainOn\(\)\) firebaseConfig\.authDomain = OWN_AUTH_DOMAIN;/m.test(html) && (html.match(/firebaseConfig\.authDomain\s*=/g) || []).length === 1);
check('o endereço próprio aparece escrito uma vez só no código, e é o do site', (html.match(/OWN_AUTH_DOMAIN = '/g) || []).length === 1 && /const OWN_AUTH_DOMAIN = 'peladanamao\.com\.br';/.test(html));
check('a chave guardada tem nome próprio e o login do Google (popup) segue usando o AUTH criado com essa configuração', /aceoma_login_proprio/.test(fnCode) && /AUTH\.signInWithPopup\(provider\)/.test(html));

// ── manual ──────────────────────────────────────────────────────────────────────────────────────
check('manual: explica o endereço do login, o repasse, o URI de retorno autorizado, o erro que aparece sem ele e as chaves ?login=proprio e ?login=google', /Endereço que aparece na janela de login do Google/.test(manual) && /\/__\/auth\/handler/.test(manual) && /redirect_uri_mismatch/.test(manual) && /\?login=proprio/.test(manual) && /\?login=google/.test(manual));
check('manual: diz que o texto "continuar para…" vem da tela de consentimento do Google Cloud (e não do código)', /continuar para…/.test(manual) && /tela de consentimento OAuth/.test(manual));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
