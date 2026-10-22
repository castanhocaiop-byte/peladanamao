// Aviso de senha trocada (Minha conta): a função notifyPasswordChanged e as contas puras de functions/account-email.js (dia e hora de Brasília, texto do e-mail).
// O Firebase não manda aviso nenhum quando a senha muda pelo app; o app chama o servidor logo depois da troca e o servidor manda o e-mail pelo Resend, só se o cadastro do
// Firebase mostrar que a senha mudou há poucos minutos (tokensValidAfterTime). Firestore, Admin Auth e Resend falsos em memória; que o Firebase de verdade atualiza esse horário
// quando a senha muda (e não quando a pessoa só entra de novo ou troca o nome) foi conferido no emulador (ver emulator-test.js).
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

// ── Admin Auth falso: a conta de cada uid, com o horário em que o Firebase passou a valer os tokens (muda quando a senha muda) ──
const authUsers = new Map();   // uid -> { uid, email, providerData, tokensValidAfterTime }
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
  }),
};

// ── Resend falso ──────────────────────────────────────────────────────────────────────────────────────
let secretValue = 'chave-de-teste';   // o valor do segredo RESEND_API_KEY ("" ou PENDENTE_CONFIGURAR = não configurado)
const sent = [];                     // cada e-mail que o servidor mandou ao Resend
let resendStatus = 200;              // status da resposta do Resend
let resendThrows = false;            // true = a chamada ao Resend dá erro de rede
global.fetch = async (url, opts) => {
  if (resendThrows) throw new Error('rede fora do ar');
  sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  return { ok: resendStatus < 300, status: resendStatus };
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
const authOf = uid => ({ uid, token: { email: uid + '@x.com', auth_time: nowSec() - 5 } });
const call = (data, auth) => fns.notifyPasswordChanged({ data, auth });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const errOf = async p => { try { await p; return null; } catch (e) { return e; } };
const utc = ms => new Date(ms).toUTCString();   // como o Admin SDK devolve o tokensValidAfterTime (sem os milissegundos)
const ago = ms => utc(Date.now() - ms);
const MIN = 60 * 1000;
let e;   // o último erro capturado
const setValid = (uid, when) => authUsers.set(uid, { ...authUsers.get(uid), tokensValidAfterTime: when });
const reset = () => {
  store.clear(); sent.length = 0; logs.length = 0;
  secretValue = 'chave-de-teste'; resendStatus = 200; resendThrows = false;
  authUsers.clear();
  authUsers.set('u1', { uid: 'u1', email: 'ana@x.com', providerData: [{ providerId: 'password' }], tokensValidAfterTime: ago(30 * 1000) });
  authUsers.set('u2', { uid: 'u2', email: 'bia@x.com', providerData: [{ providerId: 'password' }], tokensValidAfterTime: ago(30 * 1000) });
  authUsers.set('u_google', { uid: 'u_google', email: 'g@gmail.com', providerData: [{ providerId: 'google.com' }], tokensValidAfterTime: ago(30 * 1000) });
  authUsers.set('u_misto', { uid: 'u_misto', email: 'm@x.com', providerData: [{ providerId: 'google.com' }, { providerId: 'password' }], tokensValidAfterTime: ago(30 * 1000) });
  authUsers.set('u_semmail', { uid: 'u_semmail', email: '', providerData: [{ providerId: 'password' }], tokensValidAfterTime: ago(30 * 1000) });
};

(async () => {
  reset();

  // ══ 1. AS CONTAS PURAS (functions/account-email.js) ══════════════════════════════════════════════
  const bs = acct.brasiliaStamp;
  check('brasiliaStamp: 13h31 em UTC é 10h31 em Brasília (UTC-3)', bs(Date.UTC(2026, 9, 22, 13, 31, 0)) === '22/10/2026 às 10:31', bs(Date.UTC(2026, 9, 22, 13, 31, 0)));
  check('brasiliaStamp: meia-noite é 00:00 (e não 24:00)', bs(Date.UTC(2026, 9, 22, 3, 0, 0)) === '22/10/2026 às 00:00' && bs(Date.UTC(2026, 9, 22, 3, 5, 0)) === '22/10/2026 às 00:05', [bs(Date.UTC(2026, 9, 22, 3, 0, 0)), bs(Date.UTC(2026, 9, 22, 3, 5, 0))]);
  check('brasiliaStamp: vira o dia e o ano no fuso de Brasília, não no UTC (02h59 UTC de 1º/1 ainda é 23h59 de 31/12)', bs(Date.UTC(2027, 0, 1, 2, 59, 0)) === '31/12/2026 às 23:59' && bs(Date.UTC(2027, 0, 1, 3, 0, 0)) === '01/01/2027 às 00:00', [bs(Date.UTC(2027, 0, 1, 2, 59, 0)), bs(Date.UTC(2027, 0, 1, 3, 0, 0))]);
  check('brasiliaStamp: dia, mês, hora e minuto sempre com 2 dígitos', bs(Date.UTC(2026, 2, 5, 12, 5, 0)) === '05/03/2026 às 09:05', bs(Date.UTC(2026, 2, 5, 12, 5, 0)));
  const WHEN = Date.UTC(2026, 9, 22, 13, 31, 0);
  const nm = acct.passwordNoticeMessage({ whenMs: WHEN, contactEmail: 'suporte@peladanamao.com.br' });
  check('passwordNoticeMessage: assunto próprio e o dia e a hora da troca (horário de Brasília) no HTML e no texto', nm.subject === 'A senha da sua conta no Pelada na Mão foi trocada' && nm.html.includes('foi trocada em 22/10/2026 às 10:31 (horário de Brasília).') && nm.text.includes('foi trocada em 22/10/2026 às 10:31 (horário de Brasília).'), nm);
  check('passwordNoticeMessage: diz que, se foi a pessoa, não precisa fazer nada, e o que fazer se não foi (Esqueci minha senha na tela de entrada, escrever ao suporte ou responder o aviso)', /Se foi você, está tudo certo: não precisa fazer nada neste e-mail\./.test(nm.text) && /Não foi você\? Alguém pode ter entrado na sua conta\./.test(nm.text) && /Na tela de entrada, toque em “Esqueci minha senha” para criar uma senha nova/.test(nm.text) && /escreva agora para suporte@peladanamao\.com\.br \(ou responda este e-mail\), contando o que aconteceu\./.test(nm.text), nm.text);
  check('passwordNoticeMessage: SEM link, SEM botão e SEM código (nada no aviso confirma ou desfaz a troca)', !/https?:\/\//i.test(nm.html + nm.text) && !/<a[\s>]/i.test(nm.html) && !/oobCode|mode=/i.test(nm.html + nm.text), nm);
  check('passwordNoticeMessage: o HTML tem 4 parágrafos (a troca, o "está tudo certo", o "não foi você?" em negrito e o rodapé com o contato); o texto simples tem os mesmos 4, separados por linha em branco e sem HTML', (nm.html.match(/<p /g) || []).length === 4 && /font-weight:700">Não foi você\?/.test(nm.html) && nm.text.split('\n\n').length === 4 && !/<[a-z]/i.test(nm.text) && /Dúvidas: suporte@peladanamao\.com\.br/.test(nm.html) && /Dúvidas: suporte@peladanamao\.com\.br/.test(nm.text), nm.html);
  check('passwordNoticeMessage: o aviso cita o contato duas vezes no HTML (no "não foi você?" e no rodapé)', (nm.html.match(/suporte@peladanamao\.com\.br/g) || []).length === 2, nm.html);
  check('passwordNoticeMessage: sem o instante da troca (vazio, nulo ou texto) diz "agora há pouco", sem "undefined", "NaN" nem "Brasília"', [undefined, null, NaN, 'ontem'].every(w => { const m = acct.passwordNoticeMessage({ whenMs: w, contactEmail: 'c@x.com' }); return m.text.includes('foi trocada agora há pouco.') && !/undefined|NaN|null|Brasília/.test(m.html + m.text); }));
  check('passwordNoticeMessage: o contato nunca vira HTML solto (aspas e < são escapados) e o texto simples o leva como está', (() => { const c = acct.passwordNoticeMessage({ whenMs: WHEN, contactEmail: 'c"<i>@x.com' }); return !/<i>/.test(c.html) && (c.html.match(/c&quot;&lt;i&gt;@x\.com/g) || []).length === 2 && c.text.includes('c"<i>@x.com') && !/&quot;|&lt;/.test(c.text); })());

  // ══ 2. A FUNÇÃO: O CAMINHO CERTO ═════════════════════════════════════════════════════════════════
  check('a função existe e é uma callable', typeof fns.notifyPasswordChanged === 'function' && callableOpts.length > 0);
  check('sem login → unauthenticated, e nada é enviado', await codeOf(call({}, null)) === 'unauthenticated' && sent.length === 0);
  const changedAt = Date.parse(authUsers.get('u1').tokensValidAfterTime);
  let res = await call({}, authOf('u1'));
  check('a senha mudou há 30 s: responde só { ok: true }', JSON.stringify(res) === '{"ok":true}', res);
  check('manda UM e-mail ao Resend, só para o e-mail da conta (lido do cadastro do Firebase), do remetente "Pelada na Mão", com o contato do suporte para resposta', sent.length === 1 && sent[0].url === 'https://api.resend.com/emails' && JSON.stringify(sent[0].body.to) === '["ana@x.com"]' && sent[0].body.from === 'Pelada na Mão <avisos@notificacoes.peladanamao.com.br>' && sent[0].body.reply_to === 'suporte@peladanamao.com.br' && /^Bearer chave-de-teste$/.test(sent[0].headers.Authorization), sent[0]);
  check('o e-mail: assunto do aviso e o dia e a hora em que o Firebase registrou a troca (horário de Brasília)', sent[0].body.subject === 'A senha da sua conta no Pelada na Mão foi trocada' && sent[0].body.html.includes(acct.brasiliaStamp(changedAt)) && sent[0].body.text.includes(`foi trocada em ${acct.brasiliaStamp(changedAt)} (horário de Brasília).`), sent[0].body.text);
  check('o e-mail não leva link, nem o endereço do Firebase, nem a senha nova ou antiga (o servidor nunca as vê)', !/https?:\/\/|firebaseapp\.com/.test(sent[0].body.html + sent[0].body.text) && !/senha123|nova123/.test(JSON.stringify(sent[0].body)), sent[0].body.text);
  check('o horário no e-mail é o da troca que o Firebase registrou (5 minutos atrás), e não o do momento do envio', await (async () => {
    reset(); setValid('u1', ago(5 * MIN + 17 * 1000)); await call({}, authOf('u1'));
    const when = Date.parse(authUsers.get('u1').tokensValidAfterTime);
    return sent.length === 1 && sent[0].body.text.includes(`foi trocada em ${acct.brasiliaStamp(when)} (horário de Brasília).`) && acct.brasiliaStamp(when) !== acct.brasiliaStamp(Date.now());
  })());
  check('nada que vem do app muda quem recebe: outros campos (e-mail, uid, destinatário, senha) são ignorados', await (async () => {
    reset();
    await call({ email: 'outro@x.com', uid: 'u2', to: ['vitima@x.com'], newPassword: 'nova123', whenMs: 1 }, authOf('u1'));
    return sent.length === 1 && JSON.stringify(sent[0].body.to) === '["ana@x.com"]';
  })());
  check('o registro do servidor guarda só uma frase fixa: sem e-mail, sem o horário da troca', await (async () => {
    reset();
    await call({}, authOf('u1'));
    const all = JSON.stringify(logs);
    return logs.some(l => l.level === 'info' && l.m === 'notifyPasswordChanged: aviso enviado' && l.d === undefined) && !all.includes('ana@x.com') && !all.includes('ana') && !/\d{2}:\d{2}/.test(all);
  })());
  check('a função só grava o controle de limite (rate_limits); não mexe no cadastro nem em nada mais', [...store.keys()].every(k => k.startsWith('rate_limits/')), [...store.keys()]);
  check('quem tem Google E senha também é avisado (a senha existe)', await (async () => { reset(); await call({}, authOf('u_misto')); return sent.length === 1 && JSON.stringify(sent[0].body.to) === '["m@x.com"]'; })());
  check('conta que acabou de ser criada (o horário do Firebase é o da criação) também recebe; a função só é chamada pelo app depois de uma troca de senha, e o aviso vai sempre para o e-mail da própria conta', await (async () => { reset(); setValid('u1', ago(5 * 1000)); await call({}, authOf('u1')); return sent.length === 1; })());

  // ══ 3. QUANDO NÃO AVISA ══════════════════════════════════════════════════════════════════════════
  const quiet = async (label, mut, who = 'u1') => {
    reset();
    mut();
    const r = await call({}, authOf(who));
    check(label, JSON.stringify(r) === '{"ok":true}' && sent.length === 0 && logs.some(l => l.level === 'info' && l.m === 'notifyPasswordChanged: nada a avisar'), [r, sent.length, logs]);
  };
  await quiet('a senha mudou há 11 minutos (passou da janela de 10) → responde ok e NÃO avisa', () => setValid('u1', ago(11 * MIN)));
  await quiet('a conta é antiga e a senha nunca mudou há pouco (horário de dias atrás) → não avisa: a função não serve para mandar avisos falsos', () => setValid('u1', ago(3 * 24 * 60 * MIN)));
  await quiet('horário do Firebase no futuro (2 minutos adiante) → não avisa', () => setValid('u1', utc(Date.now() + 2 * MIN)));
  await quiet('sem horário no cadastro → não avisa', () => setValid('u1', undefined));
  await quiet('horário vazio → não avisa', () => setValid('u1', ''));
  await quiet('horário que não é data → não avisa', () => setValid('u1', 'lixo'));
  await quiet('quem entra SÓ com o Google (não tem senha) → não avisa', () => {}, 'u_google');
  await quiet('conta sem lista de formas de entrada → não avisa', () => authUsers.set('u1', { uid: 'u1', email: 'ana@x.com', tokensValidAfterTime: ago(30 * 1000) }));
  await quiet('conta sem e-mail → não avisa', () => {}, 'u_semmail');
  check('janela de 10 minutos: 9 min 30 s atrás avisa e 10 min 30 s atrás não avisa', await (async () => {
    reset(); setValid('u1', ago(9 * MIN + 30 * 1000)); await call({}, authOf('u1')); const dentro = sent.length;
    reset(); setValid('u1', ago(10 * MIN + 30 * 1000)); await call({}, authOf('u1')); const fora = sent.length;
    return dentro === 1 && fora === 0;
  })());
  check('tolerância de relógio: 30 s no futuro ainda avisa; 2 minutos no futuro não', await (async () => {
    reset(); setValid('u1', utc(Date.now() + 30 * 1000)); await call({}, authOf('u1')); const perto = sent.length;
    reset(); setValid('u1', utc(Date.now() + 2 * MIN)); await call({}, authOf('u1')); const longe = sent.length;
    return perto === 1 && longe === 0;
  })());
  check('conta que não existe mais no Firebase → not-found, sem enviar nada', await codeOf(call({}, authOf('fantasma'))) === 'not-found' && sent.length === 0);

  // ══ 4. FALHAS E ENVIO DESLIGADO ══════════════════════════════════════════════════════════════════
  for (const value of ['', 'PENDENTE_CONFIGURAR']) {
    reset();
    secretValue = value;
    res = await call({}, authOf('u1'));
    check(`Resend não configurado (segredo "${value || '(vazio)'}", como no site de teste de antes): responde ok, não chama o Resend e o registro diz que o aviso não saiu`, JSON.stringify(res) === '{"ok":true}' && sent.length === 0 && logs.some(l => l.level === 'warn' && l.m === 'notifyPasswordChanged: o aviso não saiu') && !logs.some(l => l.m === 'notifyPasswordChanged: aviso enviado'), [res, logs]);
  }
  reset();
  resendStatus = 500;
  res = await call({}, authOf('u1'));
  check('o Resend recusa (HTTP 500): responde ok (a senha já foi trocada) e o registro diz só que o aviso não saiu, sem endereço', JSON.stringify(res) === '{"ok":true}' && sent.length === 1 && logs.some(l => l.level === 'warn' && l.m === 'notifyPasswordChanged: o aviso não saiu' && l.d === undefined) && !logs.some(l => l.m === 'notifyPasswordChanged: aviso enviado') && !JSON.stringify(logs).includes('ana@x.com'), [res, logs]);
  reset();
  resendThrows = true;
  res = await call({}, authOf('u1'));
  check('a rede do Resend cai: a função não quebra, responde ok e registra que o aviso não saiu', JSON.stringify(res) === '{"ok":true}' && logs.some(l => l.level === 'warn' && l.m === 'notifyPasswordChanged: o aviso não saiu'), [res, logs]);

  // ══ 5. LIMITES ═══════════════════════════════════════════════════════════════════════════════════
  reset();
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push(await codeOf(call({}, authOf('u1'))));
  check('3 chamadas por hora passam e a 4ª é recusada (resource-exhausted)', codes.slice(0, 3).every(c => c === 'ok') && codes[3] === 'resource-exhausted', codes);
  check('…a 4ª não mandou e-mail (3 e-mails, não 4)', sent.length === 3, sent.length);
  e = await errOf(call({}, authOf('u1')));
  check('a recusa diz que são muitos avisos seguidos e NÃO manda "aguarde um minuto" (o limite é por hora)', e && e.code === 'resource-exhausted' && /Muitos avisos de troca de senha seguidos/.test(e.message) && !/um minuto/.test(e.message), e && e.message);
  check('o limite é por conta: outra pessoa continua podendo', await codeOf(call({}, authOf('u2'))) === 'ok' && sent.length === 4);
  store.set('rate_limits/u1_notifyPasswordChanged', { count: 3, windowStart: Date.now() - 61 * MIN });
  check('passada a hora, o limite recomeça', await codeOf(call({}, authOf('u1'))) === 'ok');
  reset();
  store.set('rate_limits/u1_notifyPasswordChanged', { count: 3, windowStart: Date.now() - 30 * MIN });
  check('com 3 na última hora (meia hora atrás) ainda vale a recusa', await codeOf(call({}, authOf('u1'))) === 'resource-exhausted' && sent.length === 0);
  reset();
  setValid('u1', ago(3 * 24 * 60 * MIN));
  for (let i = 0; i < 3; i++) await call({}, authOf('u1'));
  check('chamadas que não tinham nada a avisar também contam no limite (não dá para insistir sem fim)', (store.get('rate_limits/u1_notifyPasswordChanged') || {}).count === 3 && await codeOf(call({}, authOf('u1'))) === 'resource-exhausted', store.get('rate_limits/u1_notifyPasswordChanged'));

  // ══ 6. COMO ESTÁ LIGADO NO CÓDIGO ════════════════════════════════════════════════════════════════
  const src = require('fs').readFileSync(path, 'utf8');
  const body = src.slice(src.indexOf('const PASSWORD_NOTICE_WINDOW_MS'), src.indexOf('// ── Anonimizar meu nome no histórico'));
  check('a janela é de 10 minutos', /const PASSWORD_NOTICE_WINDOW_MS = 10 \* 60 \* 1000;/.test(body));
  check('a função declara o segredo do Resend (RESEND_API_KEY) e usa a região e o limite de instâncias de todas', /exports\.notifyPasswordChanged = onCall\(\{ \.\.\.CALLABLE, secrets: \[RESEND_API_KEY\] \}/.test(body));
  check('o limite é de 3 por hora', /checkRateLimit\(auth\.uid, "notifyPasswordChanged", 3, 60 \* 60 \* 1000\)/.test(body));
  check('a função NUNCA lê nada de request.data: o e-mail e o horário saem do cadastro do Firebase (getUser)', !/request\.data/.test(body) && /admin\.auth\(\)\.getUser\(auth\.uid\)/.test(body));
  check('o aviso vai só para o e-mail da conta (to: [email]) e é montado com o horário do Firebase e o contato do suporte', /sendResendEmail\(\{ to: \[email\], subject, html, text \}\)/.test(body) && /passwordNoticeMessage\(\{ whenMs: changedAt, contactEmail: CONTACT_EMAIL \}\)/.test(body));
  check('a janela é conferida nos dois lados (nem antigo demais, nem no futuro) e a conta precisa ter senha e e-mail', /changedAt <= Date\.now\(\) \+ 60 \* 1000 && Date\.now\(\) - changedAt <= PASSWORD_NOTICE_WINDOW_MS/.test(body) && /providerId === "password"/.test(body) && /!email \|\| !hasPassword \|\| !justChanged/.test(body));
  check('a função responde sempre { ok: true } (não conta se avisou ou não) e nunca devolve e-mail nem horário', (body.match(/return \{ ok: true \};/g) || []).length === 2 && !/return\s*\{[^}]*(email|changedAt|when)/i.test(body), body.match(/return [^;]+;/g));
  const ci = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  check('o CI roda este teste (passo "aviso de senha trocada")', /run: node test\/password-notice-test\.js/.test(ci) && /aviso de senha trocada/.test(ci));
  const loggerCalls = body.match(/logger\.[a-z]+\([^;]+;/g) || [];
  check('o registro (logger) só leva frases fixas: nunca e-mail, horário nem dado do pedido', loggerCalls.length === 3 && loggerCalls.every(c => /^logger\.(info|warn)\("[^"]*"\);$/.test(c)), loggerCalls);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(err => { console.error('ERRO NO TESTE', err); process.exit(1); });
