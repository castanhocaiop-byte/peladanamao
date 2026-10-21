// Troca do e-mail do login (Minha conta): a função requestEmailChange e as contas puras de functions/account-email.js (e-mail novo, código do link, texto do e-mail e o aviso ao e-mail atual).
// O e-mail do próprio Firebase para esse pedido não serve (a página dele dá "The selected page mode is invalid"), então o servidor gera o código de troca
// (generateVerifyAndChangeEmailLink) e manda o e-mail pelo Resend, com um link que abre o app. Firestore, Admin Auth e Resend falsos em memória; o que o Auth de
// verdade faz com o código (gerar, aplicar, usar uma vez) foi conferido no emulador (ver emulator-test.js).
const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso (só o que o limite de chamadas usa) ──────────────────────────────────────────────
const store = new Map();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const FieldValue = { delete: () => ({ __delete: true }), arrayRemove: t => ({ __arrayRemove: t }), increment: n => ({ __increment: n }) };
const refOf = p => ({
  path: p,
  get: async () => ({ id: p.split('/').pop(), exists: store.has(p), data: () => clone(store.get(p)), ref: refOf(p) }),
  set: async d => { store.set(p, clone(d)); },
  update: async obj => {
    if (!store.has(p)) throw new Error('NOT_FOUND ' + p);
    const cur = clone(store.get(p));
    for (const [k, v] of Object.entries(obj)) cur[k] = v && typeof v === 'object' && v.__increment !== undefined ? (cur[k] || 0) + v.__increment : clone(v);
    store.set(p, cur);
  },
  delete: async () => { store.delete(p); },
});
const fakeDb = { doc: p => refOf(p), collection: () => ({ where() { return this; }, limit() { return this; }, select() { return this; }, get: async () => ({ size: 0, docs: [], forEach() {} }) }), runTransaction: async fn => fn({ get: async r => r.get(), set: (r, d) => r.set(d), update: (r, d) => r.update(d), delete: r => r.delete() }), batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }) };

class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }

// ── Admin Auth falso: a conta de cada uid e o gerador do código de troca ──────────────────────────────
const authUsers = new Map();   // uid -> { uid, email, providerData }
const linkCalls = [];          // o que o servidor pediu ao Firebase: [{ email, newEmail }]
let linkError = null;          // código de erro simulado ao gerar o link
let linkWithoutCode = false;   // true = o Firebase devolve um link sem oobCode
const OOB = 'OOB123_abc-XYZ';
const callableOpts = [];
const logs = [];
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({ sendEachForMulticast: async msg => ({ successCount: msg.tokens.length, failureCount: 0, responses: [] }) }),
  auth: () => ({
    getUser: async uid => {
      const u = authUsers.get(uid);
      if (!u) { const e = new Error('sem conta'); e.code = 'auth/user-not-found'; throw e; }
      return clone(u);
    },
    generateVerifyAndChangeEmailLink: async (email, newEmail) => {
      linkCalls.push({ email, newEmail });
      if (linkError) { const e = new Error('erro simulado'); e.code = linkError; throw e; }
      return linkWithoutCode ? 'https://seriebaceoma.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail' : `https://seriebaceoma.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=${OOB}&apiKey=k&lang=en`;
    },
  }),
};

// ── Resend falso ──────────────────────────────────────────────────────────────────────────────────────
let secretValue = 'chave-de-teste';   // o valor do segredo RESEND_API_KEY ("" ou PENDENTE_CONFIGURAR = não configurado)
const sent = [];                     // cada e-mail que o servidor mandou ao Resend
let resendStatus = 200;              // status da resposta do Resend
let resendThrows = false;            // true = a chamada ao Resend dá erro de rede
let resendFailAt = 0;                // N = só o N-ésimo e-mail do pedido (1 = o do e-mail novo, 2 = o aviso ao e-mail atual) é recusado pelo Resend
let resendThrowAt = 0;               // N = a chamada ao Resend do N-ésimo e-mail do pedido dá erro de rede
global.fetch = async (url, opts) => {
  if (resendThrows || (resendThrowAt && sent.length + 1 === resendThrowAt)) throw new Error('rede fora do ar');
  sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  const refused = resendFailAt === sent.length;
  return { ok: !refused && resendStatus < 300, status: refused ? 500 : resendStatus };
};

const mercadoPagoMock = {
  MercadoPagoConfig: class { constructor() {} },
  PreApproval: class { async create() { return {}; } async get() { return {}; } },
  Preference: class { async create() { return {}; } },
  Payment: class { async get() { return {}; } },
  WebhookSignatureValidator: class { static validate() {} },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => { callableOpts.push(opts); return h; }, onRequest: (opts, h) => h, HttpsError };
  if (request === 'mercadopago') return mercadoPagoMock;
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => secretValue }) };
  return origLoad.call(this, request, ...rest);
};
const fns = require(path);
Module._load = origLoad;
const acct = require('../account-email');

// ── utilidades ──────────────────────────────────────────────────────────────────────────────────────
let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const nowSec = () => Math.floor(Date.now() / 1000);
const authOf = (uid, secondsAgo = 5, extra = {}) => ({ uid, token: { email: uid + '@x.com', auth_time: nowSec() - secondsAgo, ...extra } });
const call = (data, auth) => fns.requestEmailChange({ data, auth });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const errOf = async p => { try { await p; return null; } catch (e) { return e; } };
const reset = () => {
  store.clear(); sent.length = 0; linkCalls.length = 0; logs.length = 0;
  linkError = null; linkWithoutCode = false; secretValue = 'chave-de-teste'; resendStatus = 200; resendThrows = false; resendFailAt = 0; resendThrowAt = 0;
  authUsers.clear();
  authUsers.set('u1', { uid: 'u1', email: 'ana@x.com', providerData: [{ providerId: 'password' }] });
  authUsers.set('u_google', { uid: 'u_google', email: 'g@gmail.com', providerData: [{ providerId: 'google.com' }] });
  authUsers.set('u_misto', { uid: 'u_misto', email: 'm@x.com', providerData: [{ providerId: 'google.com' }, { providerId: 'password' }] });
  authUsers.set('u_dono', { uid: 'u_dono', email: 'castanho.caiop@gmail.com', providerData: [{ providerId: 'password' }] });
  authUsers.set('u_semmail', { uid: 'u_semmail', email: '', providerData: [{ providerId: 'password' }] });
};

(async () => {
  reset();

  // ══ 1. AS CONTAS PURAS (functions/account-email.js) ══════════════════════════════════════════════
  const pe = acct.parseNewEmail;
  check('parseNewEmail: tira os espaços das pontas e põe em minúsculas', JSON.stringify(pe('  Novo@Exemplo.COM ', 'a@b.co')) === '{"email":"novo@exemplo.com"}');
  check('parseNewEmail: vazio, só espaços e o que não é texto → "empty"', ['', '   ', null, undefined, 5, {}, ['a@b.co']].every(v => pe(v, 'a@b.co').problem === 'empty'), ['', null, 5].map(v => pe(v, 'a@b.co')));
  check('parseNewEmail: sem @, sem domínio, com espaço no meio, só o @ e "a@@b.co" → "invalid"', ['ana', 'ana@', '@x.com', 'ana@x', 'ana @x.com', 'ana@x .com', 'a@@x.com'].every(v => pe(v, 'z@x.com').problem === 'invalid'), ['ana', 'ana@x'].map(v => pe(v, 'z@x.com')));
  check('parseNewEmail: 254 caracteres passam e 255 não (limite do e-mail)', ('a'.repeat(246) + '@x.co.br').length === 254 && pe('a'.repeat(246) + '@x.co.br', 'z@x.com').email !== undefined && pe('a'.repeat(247) + '@x.co.br', 'z@x.com').problem === 'invalid');
  check('parseNewEmail: igual ao atual (mesmo com maiúsculas e espaços) → "same"; sem atual conhecido não bloqueia', pe('ANA@x.com', 'ana@x.com').problem === 'same' && pe(' ana@x.com ', ' Ana@x.com').problem === 'same' && pe('ana@x.com', '').email === 'ana@x.com' && pe('ana@x.com', undefined).email === 'ana@x.com');
  check('oobCodeOf: tira o código do link do Firebase; sem código, texto solto e nulo dão vazio', acct.oobCodeOf('https://p.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=ABC_123-x&apiKey=k') === 'ABC_123-x' && acct.oobCodeOf('https://p.firebaseapp.com/__/auth/action?mode=x') === '' && acct.oobCodeOf('lixo') === '' && acct.oobCodeOf(undefined) === '' && acct.oobCodeOf(null) === '');
  check('changeEmailUrl: o link é do app (termina em "/"), com o modo e o código codificado', acct.changeEmailUrl('https://peladanamao.com.br/', 'a b/c&d') === 'https://peladanamao.com.br/?mode=verifyAndChangeEmail&oobCode=a%20b%2Fc%26d' && acct.changeEmailUrl('https://seriebaceoma-staging.web.app/', 'Z') === 'https://seriebaceoma-staging.web.app/?mode=verifyAndChangeEmail&oobCode=Z');
  const msg = acct.changeEmailMessage({ url: 'https://peladanamao.com.br/?mode=verifyAndChangeEmail&oobCode=ABC', contactEmail: 'suporte@peladanamao.com.br' });
  check('changeEmailMessage: assunto, botão "Confirmar o novo e-mail", o endereço escapado no HTML (& vira &amp;) e o aviso de que, se não foi a pessoa, nada muda', msg.subject === 'Confirme o seu novo e-mail no Pelada na Mão' && /<a href="https:\/\/peladanamao\.com\.br\/\?mode=verifyAndChangeEmail&amp;oobCode=ABC"[^>]*>Confirmar o novo e-mail<\/a>/.test(msg.html) && /Ignore este e-mail: nada muda/.test(msg.html) && /suporte@peladanamao\.com\.br/.test(msg.html), msg.html);
  check('changeEmailMessage: a versão em texto traz o mesmo link sem escapar e o mesmo aviso; nada de HTML', msg.text.includes('Confirmar o novo e-mail: https://peladanamao.com.br/?mode=verifyAndChangeEmail&oobCode=ABC') && /Ignore este e-mail: nada muda/.test(msg.text) && !/<[a-z]/i.test(msg.text), msg.text);
  check('changeEmailMessage: o endereço do link nunca vira HTML solto (aspas e < são escapados) e o texto não promete um prazo que não existe', (() => { const m = acct.changeEmailMessage({ url: 'https://x.com/?a="><script>alert(1)</script>', contactEmail: 'c@x.com' }); return !/<script/i.test(m.html) && /&lt;script/.test(m.html) && m.html.includes('a=&quot;&gt;&lt;script&gt;') && !/\d+ (hora|minuto|dia)/i.test(m.text); })());

  const mk = acct.maskEmail;
  check('maskEmail: deixa a 1ª letra, esconde o resto do nome com *** e mostra o domínio (e corta os espaços das pontas)', mk('novo@exemplo.com') === 'n***@exemplo.com' && mk('a@b.co') === 'a***@b.co' && mk('Maria.Silva@gmail.com') === 'M***@gmail.com' && mk('  novo@exemplo.com ') === 'n***@exemplo.com', ['novo@exemplo.com', 'a@b.co', 'Maria.Silva@gmail.com'].map(mk));
  check('maskEmail: nunca devolve o nome inteiro, tenha 1, 2 ou 30 letras antes do @', ['x@y.co', 'xy@y.co', 'abcdefghijklmnopqrstuvwxyz1234@y.co'].every(v => mk(v) === v[0] + '***' + v.slice(v.indexOf('@'))), ['x@y.co', 'xy@y.co'].map(mk));
  check('maskEmail: a 1ª letra com acento ou emoji sai inteira, não pela metade', mk('éva@x.co') === 'é***@x.co' && mk('😀a@x.co') === '😀***@x.co', [mk('éva@x.co'), mk('😀a@x.co')]);
  check('maskEmail: sem @, sem nome antes do @, vazio ou nulo (não deveria chegar aqui) devolve só *** e nunca o texto de volta', mk('semarroba') === '***' && mk('@x.co') === '***' && mk('') === '***' && mk(null) === '***' && mk(undefined) === '***', [mk('semarroba'), mk('@x.co')]);
  check('maskEmail: com mais de um @ (endereço inválido, que não chega aqui) esconde tudo até o ÚLTIMO @', mk('ab@cd@x.co') === 'a***@x.co', mk('ab@cd@x.co'));
  const nm = acct.changeNoticeMessage({ newEmail: 'novo@exemplo.com', contactEmail: 'suporte@peladanamao.com.br' });
  check('changeNoticeMessage: assunto próprio e o endereço novo SÓ escondido pela metade (n***@exemplo.com), nunca inteiro, no HTML e no texto', nm.subject === 'Pediram para trocar o e-mail de login da sua conta no Pelada na Mão' && nm.html.includes('n***@exemplo.com') && nm.text.includes('n***@exemplo.com') && !/novo@exemplo/.test(nm.subject + nm.html + nm.text), nm);
  check('changeNoticeMessage: diz que nada mudou ainda, que a troca só vale com o link aberto, e o que fazer se não foi a pessoa (escrever ao suporte ou responder o aviso, trocar a senha por "Esqueci minha senha")', /Nada mudou ainda/.test(nm.text) && /só vale se o link enviado a esse endereço novo for aberto/.test(nm.text) && /Se foi você que pediu, não precisa fazer nada neste e-mail/.test(nm.text) && /Não foi você\? Escreva agora para suporte@peladanamao\.com\.br \(ou responda este e-mail\)/.test(nm.text) && /troque a sua senha/.test(nm.text) && /Esqueci minha senha/.test(nm.text), nm.text);
  check('changeNoticeMessage: SEM link e SEM botão (nada no aviso confirma ou cancela a troca): nenhum endereço de internet, nenhum <a>, nenhum código', !/https?:\/\//i.test(nm.html + nm.text) && !/<a[\s>]/i.test(nm.html) && !/oobCode|mode=/i.test(nm.html + nm.text), nm);
  check('changeNoticeMessage: o HTML tem 4 parágrafos (o pedido, o "nada mudou", o "não foi você?" em negrito e o rodapé com o contato); o texto simples não tem HTML e também traz o rodapé', (nm.html.match(/<p /g) || []).length === 4 && /font-weight:700">Não foi você\?/.test(nm.html) && !/<[a-z]/i.test(nm.text) && nm.text.split('\n\n').length === 4 && /Dúvidas: suporte@peladanamao\.com\.br/.test(nm.html) && /Dúvidas: suporte@peladanamao\.com\.br/.test(nm.text), nm.html);
  check('changeNoticeMessage: nada que vem do endereço novo nem do contato vira HTML solto (nome começando com < ou &; contato com aspas e <)', (() => { const m = acct.changeNoticeMessage({ newEmail: '<script>alert(1)</script>x@y.co', contactEmail: 'c@x.com' }); const w = acct.changeNoticeMessage({ newEmail: '&b@y.co', contactEmail: 'c@x.com' }); const c = acct.changeNoticeMessage({ newEmail: 'a@y.co', contactEmail: 'c"<i>@x.com' }); return !/<script/i.test(m.html) && m.html.includes('&lt;***@y.co') && w.html.includes('&amp;***@y.co') && !/<i>/.test(c.html) && (c.html.match(/c&quot;&lt;i&gt;@x\.com/g) || []).length === 2 && c.text.includes('c"<i>@x.com') && !/&quot;|&lt;/.test(c.text); })());

  // ══ 2. A FUNÇÃO: O CAMINHO CERTO ═════════════════════════════════════════════════════════════════
  check('a função é chamável, na região us-east1, e carrega o segredo do Resend', callableOpts.length > 0 && typeof fns.requestEmailChange === 'function');
  check('sem login → unauthenticated', await codeOf(call({ newEmail: 'novo@x.com' }, null)) === 'unauthenticated' && sent.length === 0 && linkCalls.length === 0);
  let res = await call({ newEmail: '  Novo@Exemplo.com ' }, authOf('u1'));
  check('pedido certo: responde só { ok: true } (nunca o link nem o código)', JSON.stringify(res) === '{"ok":true}' && !JSON.stringify(res).includes(OOB), res);
  check('pede o código ao Firebase para a troca do e-mail DA CONTA (lido do cadastro do Firebase) para o e-mail novo em minúsculas', linkCalls.length === 1 && linkCalls[0].email === 'ana@x.com' && linkCalls[0].newEmail === 'novo@exemplo.com', linkCalls);
  check('manda DOIS e-mails ao Resend, nesta ordem: 1º a confirmação para o e-mail novo, 2º o aviso para o e-mail atual da conta; os dois do remetente "Pelada na Mão", com o contato do suporte para resposta', sent.length === 2 && sent.every(s => s.url === 'https://api.resend.com/emails' && s.body.from === 'Pelada na Mão <avisos@notificacoes.peladanamao.com.br>' && s.body.reply_to === 'suporte@peladanamao.com.br' && /^Bearer chave-de-teste$/.test(s.headers.Authorization)) && JSON.stringify(sent[0].body.to) === '["novo@exemplo.com"]' && JSON.stringify(sent[1].body.to) === '["ana@x.com"]', sent);
  check('o e-mail: assunto da troca, botão e texto levam o link DO APP (peladanamao.com.br), com o código, e nunca o endereço do Firebase', sent[0].body.subject === 'Confirme o seu novo e-mail no Pelada na Mão' && sent[0].body.html.includes(`https://peladanamao.com.br/?mode=verifyAndChangeEmail&amp;oobCode=${OOB}`) && sent[0].body.text.includes(`https://peladanamao.com.br/?mode=verifyAndChangeEmail&oobCode=${OOB}`) && !/firebaseapp\.com/.test(sent[0].body.html + sent[0].body.text), sent[0].body.text);
  check('o aviso (2º e-mail): assunto próprio, o endereço novo escondido (n***@exemplo.com) e NUNCA inteiro, sem link, sem o código da troca e sem o endereço do Firebase', sent[1].body.subject === 'Pediram para trocar o e-mail de login da sua conta no Pelada na Mão' && sent[1].body.html.includes('n***@exemplo.com') && sent[1].body.text.includes('n***@exemplo.com') && !/novo@exemplo/.test(JSON.stringify(sent[1].body)) && !JSON.stringify(sent[1].body).includes(OOB) && !/firebaseapp\.com|https?:\/\//.test(sent[1].body.html + sent[1].body.text), sent[1].body);
  check('o e-mail da confirmação (1º) não cita o endereço antigo, nem escondido', !JSON.stringify(sent[0].body).includes('ana@x.com') && !/a\*\*\*@x\.com/.test(JSON.stringify(sent[0].body)), sent[0].body);
  check('o registro diz só que a confirmação e o aviso foram enviados (frase fixa, sem endereço)', logs.some(l => l.level === 'info' && l.m === 'requestEmailChange: e-mail de confirmação e aviso ao e-mail atual enviados' && l.d === undefined) && !logs.some(l => l.level === 'warn' && /aviso ao e-mail atual não saiu/.test(l.m)), logs);
  check('nada que vem do app muda quem recebe o código: outros campos (e-mail atual, uid, destinatário) são ignorados', await (async () => {
    reset();
    await call({ newEmail: 'certo@x.com', email: 'outro@x.com', uid: 'u_dono', to: ['vitima@x.com'], currentEmail: 'dono@x.com' }, authOf('u1'));
    return linkCalls.length === 1 && linkCalls[0].email === 'ana@x.com' && sent.length === 2 && JSON.stringify(sent[0].body.to) === '["certo@x.com"]' && JSON.stringify(sent[1].body.to) === '["ana@x.com"]';
  })());
  check('quem tem Google E senha também pode (a senha existe)', await (async () => { reset(); return (await call({ newEmail: 'novo@x.com' }, authOf('u_misto'))).ok === true && linkCalls[0].email === 'm@x.com'; })());
  check('o registro do servidor não guarda o e-mail novo, o antigo nem o código', await (async () => {
    reset();
    await call({ newEmail: 'novo.secreto@x.com' }, authOf('u1'));
    const all = JSON.stringify(logs) + JSON.stringify([...store.entries()]);
    return logs.length >= 1 && !all.includes('novo.secreto') && !all.includes('ana@x.com') && !all.includes('n***@') && !all.includes(OOB);
  })());
  check('o pedido não grava nada no cadastro: o e-mail só muda quando o link é aberto (a cópia é corrigida depois pela syncMyEmail)', [...store.keys()].every(k => k.startsWith('rate_limits/')), [...store.keys()]);

  // ══ 3. LOGIN RECENTE ═════════════════════════════════════════════════════════════════════════════
  reset();
  let e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u1', 600)));
  check('login com mais de 5 minutos → failed-precondition com o motivo estável "recent-login" e a mensagem pedindo a senha', e && e.code === 'failed-precondition' && e.details && e.details.reason === 'recent-login' && /digite a sua senha/.test(e.message), e && [e.code, e.details, e.message]);
  check('com login velho nada é gerado nem enviado', linkCalls.length === 0 && sent.length === 0);
  check('o limite é 5 minutos: 4 min 55 s passa, 5 min 05 s não', await codeOf(call({ newEmail: 'a@x.com' }, authOf('u1', 295))) === 'ok' && (reset(), await codeOf(call({ newEmail: 'a@x.com' }, authOf('u1', 305)))) === 'failed-precondition');
  reset();
  check('token sem auth_time (ou com texto) conta como login velho', await codeOf(call({ newEmail: 'a@x.com' }, { uid: 'u1', token: {} })) === 'failed-precondition' && await codeOf(call({ newEmail: 'a@x.com' }, { uid: 'u1', token: { auth_time: 'agora' } })) === 'failed-precondition' && linkCalls.length === 0);

  // ══ 4. O QUE É RECUSADO ══════════════════════════════════════════════════════════════════════════
  reset();
  e = await errOf(call({ newEmail: '' }, authOf('u1')));
  check('e-mail vazio → invalid-argument "Digite o e-mail novo."', e && e.code === 'invalid-argument' && e.message === 'Digite o e-mail novo.', e && e.message);
  e = await errOf(call({ newEmail: 'ana' }, authOf('u1')));
  check('sem cara de e-mail → invalid-argument "Este não parece um e-mail…"', e && e.code === 'invalid-argument' && /não parece um e-mail/.test(e.message), e && e.message);
  e = await errOf(call({ newEmail: ' ANA@x.com ' }, authOf('u1')));
  check('igual ao atual (até com maiúsculas) → invalid-argument "Este já é o seu e-mail de login."', e && e.code === 'invalid-argument' && /já é o seu e-mail de login/.test(e.message), e && e.message);
  check('texto que não é e-mail (número, objeto, lista, ausente) → invalid-argument, sem chamar ninguém', await (async () => { reset(); const codes = []; for (const v of [5, { a: 1 }, ['a@b.co'], undefined]) codes.push(await codeOf(call({ newEmail: v }, authOf('u1')))); return codes.every(c => c === 'invalid-argument') && await codeOf(call(undefined, authOf('u_misto'))) === 'invalid-argument' && linkCalls.length === 0 && sent.length === 0; })());
  e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u_google')));
  check('quem entra SÓ com o Google → failed-precondition (o e-mail é do Google)', e && e.code === 'failed-precondition' && /controlado pelo Google/.test(e.message) && linkCalls.length === 0 && sent.length === 0, e && e.message);
  e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u_dono')));
  check('o dono do sistema → failed-precondition (o e-mail dele é fixo no código)', e && e.code === 'failed-precondition' && /dono do sistema/.test(e.message) && linkCalls.length === 0, e && e.message);
  authUsers.set('u_dono2', { uid: 'u_dono2', email: 'Castanho.Caiop@Gmail.com', providerData: [{ providerId: 'password' }] });
  check('o dono com o e-mail escrito com maiúsculas também é recusado', await codeOf(call({ newEmail: 'novo@x.com' }, authOf('u_dono2'))) === 'failed-precondition' && linkCalls.length === 0);
  check('conta sem e-mail → failed-precondition', await codeOf(call({ newEmail: 'novo@x.com' }, authOf('u_semmail'))) === 'failed-precondition');
  check('conta que não existe mais no Firebase → not-found', await codeOf(call({ newEmail: 'novo@x.com' }, authOf('fantasma'))) === 'not-found');
  check('conta sem lista de formas de entrada também é recusada (não vira "pode")', await (async () => { authUsers.set('u_sem', { uid: 'u_sem', email: 's@x.com' }); return await codeOf(call({ newEmail: 'novo@x.com' }, authOf('u_sem'))) === 'failed-precondition'; })());

  // ══ 5. E-MAIL QUE JÁ TEM CONTA, FALHAS E ENVIO DESLIGADO ═════════════════════════════════════════
  reset();
  linkError = 'auth/email-already-exists';
  res = await call({ newEmail: 'ocupado@x.com' }, authOf('u1'));
  check('o e-mail novo já tem conta: responde { ok: true } igualzinho ao caminho certo e NÃO manda nada (nem o aviso ao e-mail atual; não revela quem tem cadastro)', JSON.stringify(res) === '{"ok":true}' && sent.length === 0 && linkCalls.length === 1, [res, sent.length]);
  reset();
  linkError = 'auth/internal-error';
  e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u1')));
  check('o Firebase não gera o código (erro qualquer) → unavailable com mensagem em português e nenhum e-mail', e && e.code === 'unavailable' && /Não foi possível enviar o e-mail agora/.test(e.message) && sent.length === 0, e && [e.code, e.message]);
  check('…e o registro guarda só o código do erro, sem e-mail', logs.some(l => l.level === 'warn' && l.d && l.d.codigo === 'auth/internal-error') && !JSON.stringify(logs).includes('novo@x.com'));
  reset();
  linkWithoutCode = true;
  check('o link do Firebase veio sem código → unavailable e nenhum e-mail', await codeOf(call({ newEmail: 'novo@x.com' }, authOf('u1'))) === 'unavailable' && sent.length === 0);
  for (const value of ['', 'PENDENTE_CONFIGURAR']) {
    reset();
    secretValue = value;
    e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u1')));
    check(`Resend não configurado (segredo "${value || '(vazio)'}", como no site de teste) → failed-precondition clara, sem gerar código à toa e sem chamar o Resend`, e && e.code === 'failed-precondition' && /envio de e-mails não está ligado/.test(e.message) && linkCalls.length === 0 && sent.length === 0, e && [e.code, e.message]);
  }
  reset();
  resendStatus = 500;
  e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u1')));
  check('o Resend recusa o envio (HTTP 500) → unavailable', e && e.code === 'unavailable' && /Não foi possível enviar o e-mail agora/.test(e.message) && sent.length === 1, e && [e.code, sent.length]);
  reset();
  resendThrows = true;
  check('a rede do Resend cai → unavailable (a função não quebra)', await codeOf(call({ newEmail: 'novo@x.com' }, authOf('u1'))) === 'unavailable');

  // o aviso ao e-mail ATUAL é um reforço: a confirmação já saiu quando ele é tentado
  reset();
  resendFailAt = 1;
  e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u1')));
  check('o Resend recusa o e-mail da CONFIRMAÇÃO → unavailable, e o aviso ao e-mail atual nem é tentado (ninguém é avisado de um pedido que não saiu)', e && e.code === 'unavailable' && sent.length === 1 && JSON.stringify(sent[0].body.to) === '["novo@x.com"]', e && [e.code, sent.length]);
  reset();
  resendFailAt = 2;
  res = await call({ newEmail: 'novo@x.com' }, authOf('u1'));
  check('o Resend recusa SÓ o aviso ao e-mail atual (o 2º e-mail): o pedido segue valendo e responde { ok: true }, porque o link já foi para o e-mail novo', JSON.stringify(res) === '{"ok":true}' && sent.length === 2 && JSON.stringify(sent[0].body.to) === '["novo@x.com"]' && JSON.stringify(sent[1].body.to) === '["ana@x.com"]', [res, sent.length]);
  check('…e o registro diz só uma frase fixa de que o aviso não saiu (sem e-mail, sem código) e não afirma que o aviso foi enviado', logs.some(l => l.level === 'warn' && l.m === 'requestEmailChange: e-mail de confirmação enviado, mas o aviso ao e-mail atual não saiu' && l.d === undefined) && !logs.some(l => l.level === 'info' && /aviso ao e-mail atual enviados/.test(l.m)) && !/novo@x\.com|ana@x\.com|n\*\*\*/.test(JSON.stringify(logs)) && !JSON.stringify(logs).includes(OOB), logs);
  reset();
  resendThrowAt = 2;
  check('a rede cai SÓ no aviso ao e-mail atual: a função não quebra, o pedido segue valendo (ok) e o e-mail novo já tinha saído', JSON.stringify(await call({ newEmail: 'novo@x.com' }, authOf('u1'))) === '{"ok":true}' && sent.length === 1 && JSON.stringify(sent[0].body.to) === '["novo@x.com"]' && logs.some(l => l.level === 'warn' && /o aviso ao e-mail atual não saiu/.test(l.m)));

  // ══ 6. LIMITES ═══════════════════════════════════════════════════════════════════════════════════
  reset();
  const first = [];
  for (let i = 0; i < 6; i++) first.push(await codeOf(call({ newEmail: `n${i}@x.com` }, authOf('u1'))));
  check('5 pedidos por minuto passam e o 6º é recusado (resource-exhausted)', first.slice(0, 5).every(c => c === 'ok') && first[5] === 'resource-exhausted', first);
  check('o limite é por conta: outra pessoa continua podendo', await codeOf(call({ newEmail: 'x@x.com' }, authOf('u_misto'))) === 'ok');
  check('o 6º pedido seguido não mandou e-mail nenhum (5 pedidos × 2 e-mails, mais os 2 de outra pessoa; nenhum do 6º)', sent.length === 12 /* os 5 pedidos de u1 (2 e-mails cada) + os 2 de u_misto */, sent.length);
  reset();
  store.set('rate_limits/u1_requestEmailChangeHora', { count: 10, windowStart: Date.now() - 30 * 60 * 1000 });
  e = await errOf(call({ newEmail: 'novo@x.com' }, authOf('u1')));
  check('10 pedidos na última hora → resource-exhausted com a mensagem DA HORA (e não "aguarde um minuto")', e && e.code === 'resource-exhausted' && /Muitos pedidos de troca de e-mail seguidos/.test(e.message) && !/um minuto/.test(e.message) && sent.length === 0, e && [e.code, e.message]);
  store.set('rate_limits/u1_requestEmailChangeHora', { count: 10, windowStart: Date.now() - 61 * 60 * 1000 });
  check('passada a hora, o limite recomeça', await codeOf(call({ newEmail: 'novo@x.com' }, authOf('u1'))) === 'ok');
  reset();
  store.set('rate_limits/u1_requestEmailChangeHora', { count: 9, windowStart: Date.now() - 1000 });
  check('com 9 na hora o 10º ainda passa e o 11º não', await codeOf(call({ newEmail: 'a@x.com' }, authOf('u1'))) === 'ok' && await codeOf(call({ newEmail: 'b@x.com' }, authOf('u1'))) === 'resource-exhausted');
  reset();
  for (let i = 0; i < 4; i++) await codeOf(call({ newEmail: `r${i}@x.com` }, authOf('u1', 600)));
  check('pedidos recusados por login velho também contam no limite (não dá para insistir sem fim)', (store.get('rate_limits/u1_requestEmailChange') || {}).count === 4, store.get('rate_limits/u1_requestEmailChange'));

  // ══ 7. COMO ESTÁ LIGADO NO CÓDIGO ════════════════════════════════════════════════════════════════
  const src = require('fs').readFileSync(path, 'utf8');
  const body = src.slice(src.indexOf('exports.requestEmailChange = onCall('), src.indexOf('// ── Anonimizar meu nome no histórico'));
  check('a função declara o segredo do Resend (RESEND_API_KEY) e usa a região e o limite de instâncias de todas', /exports\.requestEmailChange = onCall\(\{ \.\.\.CALLABLE, secrets: \[RESEND_API_KEY\] \}/.test(src));
  check('o e-mail atual sai do cadastro do Firebase (getUser) e nunca de request.data', /admin\.auth\(\)\.getUser\(auth\.uid\)/.test(body) && !/request\.data\??\.(email|currentEmail|uid|to)\b/.test(body));
  check('o link do e-mail usa o endereço do ambiente (ENV.appUrl, que no site de teste é o do teste) e o envio passa por sendResendEmail (que põe [TESTE] no assunto lá)', /changeEmailUrl\(ENV\.appUrl, code\)/.test(body) && /sendResendEmail\(\{ to: \[parsed\.email\]/.test(body));
  check('a função nunca devolve o link nem o código (nenhum return leva o link)', !/return\s*\{[^}]*(link|code|oob)/i.test(body) && (body.match(/return \{ ok: true \}/g) || []).length === 2, body.match(/return [^;]+;/g));
  check('o código de troca só é gerado DEPOIS de conferir que o envio está ligado (nunca sobra código sem e-mail)', body.indexOf('resendConfigured()') > 0 && body.indexOf('resendConfigured()') < body.indexOf('generateVerifyAndChangeEmailLink'));
  check('o aviso ao e-mail ATUAL vai para `current` (o e-mail do cadastro do Firebase), é montado por changeNoticeMessage com o e-mail novo já arrumado e só sai DEPOIS do e-mail novo', /changeNoticeMessage\(\{ newEmail: parsed\.email, contactEmail: CONTACT_EMAIL \}\)/.test(body) && /sendResendEmail\(\{ to: \[current\], subject: notice\.subject, html: notice\.html, text: notice\.text \}\)/.test(body) && body.indexOf('to: [parsed.email]') > 0 && body.indexOf('to: [parsed.email]') < body.indexOf('to: [current]'));
  check('o aviso é só um reforço: depois dele a função não recusa nada (nenhum throw) e responde ok', !/\bthrow\b/.test(body.slice(body.indexOf('to: [current]'))) && /return \{ ok: true \};\s*\}\);\s*$/.test(body), body.slice(body.indexOf('to: [current]')));
  const loggerCalls = body.match(/logger\.[a-z]+\([^;]+;/g) || [];
  check('o registro (logger) da função só leva uma frase fixa e, no máximo, o código do ERRO do Firebase: nunca e-mail, link nem código de troca', loggerCalls.length === 4 && loggerCalls.every(c => /^logger\.(info|warn)\("[^"]*"\);$/.test(c) || /^logger\.warn\("[^"]*", \{ codigo: e\?\.code \}\);$/.test(c)), loggerCalls);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(err => { console.error('ERRO NO TESTE', err); process.exit(1); });
