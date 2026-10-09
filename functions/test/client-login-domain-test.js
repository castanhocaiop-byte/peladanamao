// Endereço da janela de login do Google (index.html + vercel.json + firebase-messaging-sw.js): o site repassa /__/auth/ ao Firebase e,
// na produção, o login usa peladanamao.com.br como "authDomain" (a janela do Google diz "Prosseguir para peladanamao.com.br") em vez
// de seriebaceoma.firebaseapp.com. Saída de emergência: ?login=google volta ao endereço antigo neste aparelho (fica guardado) e
// ?login=proprio desfaz. Extrai o código real do index.html e o executa num navegador simulado.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'firebase-messaging-sw.js'), 'utf8');
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

const OWN = 'peladanamao.com.br', LEGACY = 'seriebaceoma.firebaseapp.com', LEGACY_STAGING = 'seriebaceoma-staging.firebaseapp.com';

// ── vercel.json: repasse transparente ───────────────────────────────────────────────────────────
const rw = vercel.rewrites || [];
check('vercel.json: existe UM repasse (rewrite) de /__/auth/ para o Firebase, com o caminho e a pergunta preservados', rw.length === 1 && rw[0].source === '/__/auth/:path*' && rw[0].destination === `https://${LEGACY}/__/auth/:path*`, rw);
check('…é repasse de verdade (o navegador continua no nosso endereço), não redirecionamento: sem "permanent" nem "statusCode"', rw.length === 1 && !('permanent' in rw[0]) && !('statusCode' in rw[0]) && !('headers' in rw[0]), rw[0]);
check('…o destino é o domínio do Firebase da PRODUÇÃO (nunca o do teste) e NÃO é o do próprio site (senão o repasse chamaria a si mesmo, em laço)', rw.length === 1 && !/staging/.test(JSON.stringify(rw)) && !rw[0].destination.includes(OWN), rw);
check('o redirecionamento do endereço antigo (aceoma.vercel.app) continua igual: só para aquele endereço e provisório', vercel.redirects.length === 1 && vercel.redirects[0].source === '/(.*)' && vercel.redirects[0].has[0].value === 'aceoma.vercel.app' && vercel.redirects[0].destination === 'https://peladanamao.com.br/$1' && vercel.redirects[0].permanent === false, vercel.redirects);
check('vercel.json continua liberado no .vercelignore (senão a configuração nem chega à Vercel)', /^!vercel\.json\s*$/m.test(vercelIgnore));
check('vercel.json só tem redirects e rewrites (nada de cabeçalhos ou outras regras que mexam no resto do site)', JSON.stringify(Object.keys(vercel).sort()) === JSON.stringify(['redirects', 'rewrites']), Object.keys(vercel));

// ── a tabela de ambientes ───────────────────────────────────────────────────────────────────────
const prodAuth = (/production: \{[\s\S]*?authDomain: "([^"]+)"/.exec(html) || [])[1];
const stagAuth = (/staging: \{[\s\S]*?authDomain: "([^"]+)"/.exec(html) || [])[1];
check('o padrão da produção é o endereço do próprio site, e o do teste continua o do Firebase de teste', prodAuth === OWN && stagAuth === LEGACY_STAGING, { prodAuth, stagAuth });
const swProd = (/authDomain: "([^"]+)",\s*projectId: "seriebaceoma",/.exec(sw) || [])[1];
check('o service worker repete o mesmo endereço da produção (a tabela de ambientes bate nos três lugares)', swProd === OWN, swProd);

// ── a saída de emergência ?login=google ─────────────────────────────────────────────────────────
const fnCode = slice('const LEGACY_AUTH_DOMAIN', "if (APP_ENV.name === 'production' && legacyLoginDomainOn())");
const afterLine = html.slice(at("if (APP_ENV.name === 'production' && legacyLoginDomainOn())"));
const overrideLine = afterLine.slice(0, afterLine.indexOf('\n'));
function boot({ search = '', stored = null, throws = false, env = 'production' } = {}) {
  const store = stored === null ? {} : { aceoma_login_google: stored };
  const localStorage = throws
    ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); }, removeItem() { throw new Error('indisponível'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const firebaseConfig = { apiKey: 'k', authDomain: env === 'production' ? OWN : LEGACY_STAGING, projectId: 'p' };
  const APP_ENV = { name: env, firebaseConfig };
  const api = new Function('location', 'localStorage', 'APP_ENV', 'firebaseConfig', fnCode + '\n' + overrideLine + '\nreturn { legacyLoginDomainOn, LEGACY_AUTH_DOMAIN };')({ search }, localStorage, APP_ENV, firebaseConfig);
  return { api, store, firebaseConfig };
}
let b = boot();
check('sem pedir nada: o login usa o endereço do próprio site e nada é guardado', b.firebaseConfig.authDomain === OWN && b.api.legacyLoginDomainOn() === false && Object.keys(b.store).length === 0, b.firebaseConfig);
b = boot({ search: '?login=google' });
check('?login=google: volta ao endereço antigo do Firebase, só no authDomain, e guarda a escolha neste aparelho', b.firebaseConfig.authDomain === LEGACY && b.store.aceoma_login_google === '1' && b.api.LEGACY_AUTH_DOMAIN === LEGACY, { cfg: b.firebaseConfig, store: b.store });
check('…as outras chaves da configuração do Firebase ficam exatamente como eram (o Google manda não mexer em nada além do authDomain)', b.firebaseConfig.apiKey === 'k' && b.firebaseConfig.projectId === 'p' && Object.keys(b.firebaseConfig).join() === 'apiKey,authDomain,projectId');
b = boot({ stored: '1' });
check('na visita seguinte (sem o parâmetro) a escolha guardada continua valendo', b.firebaseConfig.authDomain === LEGACY && b.api.legacyLoginDomainOn() === true);
b = boot({ search: '?login=proprio', stored: '1' });
check('?login=proprio: desfaz a saída de emergência, apaga a escolha guardada e volta ao endereço do próprio site', b.firebaseConfig.authDomain === OWN && !('aceoma_login_google' in b.store) && b.api.legacyLoginDomainOn() === false, { cfg: b.firebaseConfig, store: b.store });
for (const [rotulo, search] of [['valor desconhecido', '?login=outra'], ['valor vazio', '?login='], ['maiúsculas', '?login=GOOGLE'], ['parâmetro sem valor', '?login'], ['parâmetro com outro nome', '?entrar=google']]) {
  const sem = boot({ search }); const com = boot({ search, stored: '1' });
  check(`parâmetro ${rotulo} (${search}): não liga nem desliga nada`, sem.firebaseConfig.authDomain === OWN && !('aceoma_login_google' in sem.store) && com.firebaseConfig.authDomain === LEGACY && com.store.aceoma_login_google === '1', { sem: sem.firebaseConfig, com: com.firebaseConfig });
}
b = boot({ search: '?invite=abc123&liga=minha-liga&login=google' });
check('junto com convite e liga no mesmo endereço: o parâmetro é lido e o convite não atrapalha', b.firebaseConfig.authDomain === LEGACY);
for (const guardado of ['true', '0', '', 'sim', ' 1']) {
  b = boot({ stored: guardado });
  check(`valor guardado "${guardado}" (qualquer coisa diferente de 1): não ativa a saída de emergência`, b.firebaseConfig.authDomain === OWN && b.api.legacyLoginDomainOn() === false);
}
b = boot({ search: '?login=google', throws: true });
check('sem acesso ao armazenamento do navegador (modo privado): não quebra e fica no endereço do próprio site', b.firebaseConfig.authDomain === OWN && b.api.legacyLoginDomainOn() === false);
b = boot({ search: '?login=google', env: 'staging' });
check('no ambiente de TESTE nada muda, mesmo com o parâmetro (o login do teste é por e-mail e senha e tem projeto próprio)', b.firebaseConfig.authDomain === LEGACY_STAGING, b.firebaseConfig);
b = boot({ stored: '1', env: 'staging' });
check('…nem com a escolha guardada de outra visita', b.firebaseConfig.authDomain === LEGACY_STAGING);

// ── como está escrito no código ─────────────────────────────────────────────────────────────────
check('a saída de emergência é aplicada DEPOIS de escolher o ambiente e ANTES de iniciar o Firebase (initFirebase usa a mesma configuração)', at('const firebaseConfig = APP_ENV.firebaseConfig;') < at("if (APP_ENV.name === 'production' && legacyLoginDomainOn())") && at("if (APP_ENV.name === 'production' && legacyLoginDomainOn())") < at('function initFirebase()') && /firebase\.initializeApp\(firebaseConfig\);/.test(html));
check('só a produção é trocada (a condição olha o nome do ambiente) e só o authDomain muda', /^if \(APP_ENV\.name === 'production' && legacyLoginDomainOn\(\)\) firebaseConfig\.authDomain = LEGACY_AUTH_DOMAIN;/m.test(html) && (html.match(/firebaseConfig\.authDomain\s*=/g) || []).length === 1);
check('o endereço antigo do Firebase aparece escrito uma vez só na saída de emergência, e é o do projeto de produção', (html.match(/LEGACY_AUTH_DOMAIN = '/g) || []).length === 1 && /const LEGACY_AUTH_DOMAIN = 'seriebaceoma\.firebaseapp\.com';/.test(html));
check('a chave guardada tem nome próprio e o login do Google (popup) segue usando o AUTH criado com essa configuração', /aceoma_login_google/.test(fnCode) && /AUTH\.signInWithPopup\(provider\)/.test(html));
check('o interruptor da fase de teste (?login=proprio ligando o endereço novo) não existe mais: agora ?login=proprio só desfaz a saída de emergência', !/aceoma_login_proprio/.test(html) && !/ownLoginDomainOn/.test(html) && !/OWN_AUTH_DOMAIN/.test(html));

// ── manual ──────────────────────────────────────────────────────────────────────────────────────
check('manual: explica o endereço do login ("Prosseguir para peladanamao.com.br"), o repasse, o URI de retorno que não pode ser removido, o erro que aparece sem ele e a saída de emergência ?login=google / ?login=proprio', /Endereço que aparece na janela de login do Google/.test(manual) && /Prosseguir para peladanamao\.com\.br/.test(manual) && /\/__\/auth\/handler/.test(manual) && /redirect_uri_mismatch/.test(manual) && /não pode ser removido/.test(manual) && /\?login=google/.test(manual) && /\?login=proprio/.test(manual) && /Saída de emergência/.test(manual));
check('manual: não diz mais que a mudança é "opcional até ser testada"', !/opcional até ser testada/.test(manual));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
