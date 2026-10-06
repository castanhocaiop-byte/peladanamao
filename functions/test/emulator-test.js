'use strict';
// Teste de ponta a ponta contra os EMULADORES (Auth + Firestore + Functions) com as regras
// (firestore.rules) e o código (functions/index.js) reais: o que cada tipo de conta consegue ler e
// gravar direto no banco, e o que cada Cloud Function faz com tokens de login de verdade.
// Nada aqui toca o Firebase de verdade: projeto demo-aceoma, contas descartáveis só do emulador.
//
// Rode com:  npm run test:emulators   (dentro de functions/; precisa de Java 21 e Node 20+)
// O script test/run-emulators.js sobe os emuladores, simula o Mercado Pago (test/mp-stub.js) e
// chama este arquivo. Direto, ele só funciona se o ambiente já estiver assim.
const fs = require('fs');

const PROJECT = 'demo-aceoma';
const AUTH_URL = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS_ROOT = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN_URL = `http://127.0.0.1:5001/${PROJECT}/us-east1`;

// Mercado Pago simulado (test/mp-stub.js, carregado nos processos do emulador): o estado fica num
// arquivo, que este teste escreve (assinaturas "existentes") e lê (cancelamentos que a função fez).
const MP_FILE = process.env.MP_STUB_FILE;
if (!MP_FILE) { console.error('Defina MP_STUB_FILE (use npm run test:emulators, em functions/).'); process.exit(1); }
const mpState = partial => fs.writeFileSync(MP_FILE, JSON.stringify({ preapprovals: [], payments: [], updates: [], created: [], preferences: [], ...partial }));
const mpSet = preapprovals => mpState({ preapprovals });
const mpGet = () => JSON.parse(fs.readFileSync(MP_FILE, 'utf8'));

// ── HTTP e codificação do Firestore REST ─────────────────────────────────────
async function http(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json };
}
const enc = v => v === null ? { nullValue: null }
  : typeof v === 'string' ? { stringValue: v }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
const dec = f => 'stringValue' in f ? f.stringValue : 'integerValue' in f ? Number(f.integerValue) : 'doubleValue' in f ? f.doubleValue
  : 'booleanValue' in f ? f.booleanValue : 'nullValue' in f ? null
  : 'arrayValue' in f ? (f.arrayValue.values || []).map(dec)
  : 'mapValue' in f ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : undefined;
const fieldsOf = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)]));
const docData = r => (r.json && r.json.fields) ? Object.fromEntries(Object.entries(r.json.fields).map(([k, v]) => [k, dec(v)])) : undefined;
const mergeEnc = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] && out[k].mapValue && v.mapValue) ? { mapValue: { fields: mergeEnc(out[k].mapValue.fields, v.mapValue.fields) } } : v;
  }
  return out;
};
const nestedFields = (dotted, value) => {
  const segs = dotted.split('.');
  let node = enc(value);
  for (let i = segs.length - 1; i >= 1; i--) node = { mapValue: { fields: { [segs[i]]: node } } };
  return { [segs[0]]: node };
};

const db = {
  get: (tok, path) => http('GET', `${FS_ROOT}/${path}`, tok),
  list: (tok, path) => http('GET', `${FS_ROOT}/${path}`, tok),
  create: (tok, col, id, data) => http('POST', `${FS_ROOT}/${col}?documentId=${encodeURIComponent(id)}`, tok, { fields: fieldsOf(data) }),
  set: (tok, path, data) => http('PATCH', `${FS_ROOT}/${path}`, tok, { fields: fieldsOf(data) }),
  // update parcial: changes = { 'a.b': valor } ; valor undefined = apagar o campo
  update: (tok, path, changes) => {
    let fields = {};
    for (const [p, v] of Object.entries(changes)) if (v !== undefined) fields = mergeEnc(fields, nestedFields(p, v));
    const mask = Object.keys(changes).map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
    return http('PATCH', `${FS_ROOT}/${path}?currentDocument.exists=true&${mask}`, tok, { fields });
  },
  del: (tok, path) => http('DELETE', `${FS_ROOT}/${path}`, tok),
  query: (tok, structuredQuery) => http('POST', `${FS_ROOT}:runQuery`, tok, { structuredQuery }),
};

// ── Contas descartáveis do emulador ──────────────────────────────────────────
const PASSWORD = 'senha-de-teste-123';
async function newUser(email) {
  const r = await http('POST', `${AUTH_URL}/accounts:signUp?key=fake`, null, { email, password: PASSWORD, returnSecureToken: true });
  if (r.status !== 200) throw new Error('signUp falhou ' + JSON.stringify(r.json));
  return { uid: r.json.localId, token: r.json.idToken, email };
}
async function refreshToken(u) {
  const r = await http('POST', `${AUTH_URL}/accounts:signInWithPassword?key=fake`, null, { email: u.email, password: PASSWORD, returnSecureToken: true });
  u.token = r.json.idToken;
}
async function verifyEmail(u) {
  const r = await http('POST', `${AUTH_URL}/projects/${PROJECT}/accounts:update`, 'owner', { localId: u.uid, emailVerified: true });
  if (r.status !== 200) throw new Error('verifyEmail falhou ' + JSON.stringify(r.json));
  await refreshToken(u);
}
const callFn = async (name, tok, data) => {
  const r = await http('POST', `${FN_URL}/${name}`, tok, { data });
  return { status: r.status, result: r.json && r.json.result, error: r.json && r.json.error, raw: r.json };
};

// ── Resultado dos testes ─────────────────────────────────────────────────────
let fails = 0, passes = 0;
const check = (label, cond, extra) => {
  if (cond) passes++; else fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
};
const okW = r => r.status === 200;                    // escrita permitida
const okR = r => r.status === 200 || r.status === 404; // leitura permitida (404 = permitida, mas não existe)
const no = r => r.status === 403;                     // recusada pelas regras
const brief = r => `${r.status} ${r.json && r.json.error ? r.json.error.status + ': ' + r.json.error.message : ''}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = '2026-09-28T12:00:00.000Z';
const CLOUDINARY = 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/teste.jpg';

(async () => {
  // limpa tudo (Auth + Firestore) para começar do zero
  await http('DELETE', `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
  await http('DELETE', `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`);

  const U = {};
  for (const [k, email] of Object.entries({
    owner: 'castanho.caiop@gmail.com', admA: 'adm-a@teste.invalid', pl1: 'jogador1@teste.invalid', pl2: 'jogador2@teste.invalid',
    pend: 'pendente@teste.invalid', outsider: 'fora@teste.invalid', admB: 'adm-b@teste.invalid',
    attacker: 'atacante@teste.invalid', newbie: 'novato@teste.invalid', second: 'segundo@teste.invalid',
  })) U[k] = await newUser(email);
  console.log(`(contas de teste criadas no emulador: ${Object.keys(U).length})\n`);

  // ── dados-base ─────────────────────────────────────────────────────────────
  const seed = async () => {
    await http('DELETE', `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
    const S = (path, data) => db.set('owner', path, data);
    await S('leagues/la', { name: 'Liga A', ownerId: U.admA.uid, plan: 'trial' });
    await S('leagues/lb', { name: 'Liga B', ownerId: U.admB.uid, plan: 'trial' });
    await S('leagues/la/player_registry/pl_um', { name: 'Pl Um', whatsapp: '11999990001', active: true });
    await S('leagues/la/player_registry/ana', { name: 'Ana', whatsapp: '11988880002' });
    await S('leagues/la/player_registry/caio', { name: 'Caio' });
    await S('leagues/la/financeiro_avulsos/a1', { nome: 'Zé Convidado', valor: 20, data: '2026-09-01', mes: '2026-09', paga: false, whatsapp: '11977770001' });
    await S('leagues/la/financeiro_avulsos/a2', { nome: 'Sem Fone', valor: 20, data: '2026-09-02', mes: '2026-09', paga: false });
    await S('leagues/la/championships/c1', { date: '2026-09-01', status: 'completed', matches: [], avulsos: [{ name: 'Zé Convidado', valor: 20, finId: 'a1', whatsapp: '11977770001' }] });
    await S('leagues/la/app_config/main', { hasFinais: true });
    await S('leagues/la/financeiro_config/main', { valorMensalidade: 50 });
    await S('leagues/la/contacts/seed1', { whatsapp: '11912345678' });
    await S('leagues/la/invite_tokens/tokX', { role: 'player', used: false, createdBy: U.admA.uid, createdAt: NOW });
    await sleep(1500);  // deixa os gatilhos dos campeonatos rodarem antes de existirem usuários com token
    const user = (k, extra) => S('users/' + U[k].uid, { email: U[k].email, displayName: k, role: 'pending', createdAt: NOW, ...extra });
    await user('admA', { leagues: { la: { role: 'admin', joinedAt: NOW } }, fcmTokens: ['tokA'] });
    await user('pl1', { leagues: { la: { role: 'player', playerKey: 'pl_um', joinedAt: NOW } }, fcmTokens: ['tokP1-secreto'], notifEnabled: true });
    await user('pl2', { leagues: { la: { role: 'player', joinedAt: NOW } } });
    await user('pend', { leagues: { la: { role: 'pending', joinedAt: NOW } } });
    await user('outsider', { leagues: {} });
    await user('admB', { leagues: { lb: { role: 'admin', joinedAt: NOW } } });
  };
  await seed();

  // ═════════════ REGRAS: cadastro de usuários ═════════════
  console.log('── users: cadastro e autopromoção');
  const A = U.attacker;
  check('atacante lê o próprio cadastro (ainda não existe → 404 permitido)', okR(await db.get(A.token, 'users/' + A.uid)));
  const own = (extra) => ({ email: A.email, displayName: 'x', role: 'pending', createdAt: NOW, leagues: {}, ...extra });
  let r = await db.create(A.token, 'users', A.uid, own({ role: 'admin' }));
  check('cria o próprio cadastro JÁ como admin → recusado', no(r), brief(r));
  r = await db.create(A.token, 'users', A.uid, own({ leagues: { la: { role: 'admin', joinedAt: NOW } } }));
  check('cria o próprio cadastro JÁ dentro de uma liga como admin → recusado', no(r), brief(r));
  r = await db.create(A.token, 'users', A.uid, own({ foo: 1 }));
  check('cria cadastro com campo extra → recusado', no(r), brief(r));
  r = await db.create(A.token, 'users', A.uid, own({ email: 'outra-pessoa@teste.invalid' }));
  check('cria cadastro com e-mail diferente do da conta → recusado', no(r), brief(r));
  r = await db.create(A.token, 'users', U.newbie.uid, { ...own({}), email: U.newbie.email });
  check('cria o cadastro de OUTRA pessoa → recusado', no(r), brief(r));
  r = await db.create(A.token, 'users', A.uid, own({}));
  check('cria o próprio cadastro vazio (é o que o app faz no 1º login) → permitido', okW(r), brief(r));

  check('atualiza o próprio leagues.la.role para admin → recusado', no(await db.update(A.token, 'users/' + A.uid, { 'leagues.la.role': 'admin' })), '');
  check('atualiza o próprio role → recusado', no(await db.update(A.token, 'users/' + A.uid, { role: 'admin' })), '');
  check('atualiza o próprio playerKey → recusado', no(await db.update(A.token, 'users/' + A.uid, { playerKey: 'ana' })), '');
  check('atualiza o próprio e-mail → recusado', no(await db.update(A.token, 'users/' + A.uid, { email: 'x@y.z' })), '');
  check('atualiza o próprio displayName → recusado', no(await db.update(A.token, 'users/' + A.uid, { displayName: 'Outro' })), '');
  check('cria uma liga dentro do próprio cadastro (leagues.hack) → recusado', no(await db.update(A.token, 'users/' + A.uid, { 'leagues.hack': { role: 'admin' } })), '');
  check('atualiza fcmTokens (registro de notificação) → permitido', okW(await db.update(A.token, 'users/' + A.uid, { fcmTokens: ['tok1', 'tok2'], notifEnabled: true })));
  check('atualiza linkRequestSent → permitido', okW(await db.update(A.token, 'users/' + A.uid, { linkRequestSent: true })));
  check('apaga o próprio cadastro → recusado', no(await db.del(A.token, 'users/' + A.uid)));
  check('atualiza o cadastro de OUTRA pessoa (fcmTokens) → recusado', no(await db.update(A.token, 'users/' + U.pl1.uid, { fcmTokens: ['roubado'] })));
  check('promove OUTRA pessoa a admin → recusado', no(await db.update(A.token, 'users/' + U.pl2.uid, { 'leagues.la.role': 'admin' })));

  console.log('── users: privacidade (LGPD) — ninguém lê o cadastro dos outros');
  check('jogador lê o próprio cadastro → permitido', okW(await db.get(U.pl1.token, 'users/' + U.pl1.uid)));
  check('jogador lê o cadastro de outro jogador → recusado', no(await db.get(U.pl1.token, 'users/' + U.pl2.uid)));
  check('jogador lê o cadastro do admin → recusado', no(await db.get(U.pl1.token, 'users/' + U.admA.uid)));
  check('atacante lê o cadastro de um jogador → recusado', no(await db.get(A.token, 'users/' + U.pl1.uid)));
  check('jogador lista TODOS os usuários → recusado', no(await db.list(U.pl1.token, 'users')));
  check('jogador consulta usuários por liga/papel → recusado', no(await db.query(U.pl1.token, { from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'leagues.la.role' }, op: 'EQUAL', value: { stringValue: 'admin' } } } })));
  check('atacante lista todos os usuários → recusado', no(await db.list(A.token, 'users')));
  check('ADMIN da liga lista todos os usuários direto → recusado (só pela função)', no(await db.list(U.admA.token, 'users')));
  check('ADMIN da liga lê o cadastro de um jogador direto → recusado', no(await db.get(U.admA.token, 'users/' + U.pl1.uid)));
  check('dono do sistema lê o cadastro de um jogador direto → recusado', no(await db.get(U.owner.token, 'users/' + U.pl1.uid)));
  check('tokens de notificação de outro usuário não vazam', JSON.stringify((await db.get(U.pl2.token, 'users/' + U.pl1.uid)).json).indexOf('secreto') < 0);

  // ═════════════ REGRAS: ligas ═════════════
  console.log('── leagues');
  check('atacante cria uma liga direto (ownerId = ele) → recusado', no(await db.create(A.token, 'leagues', 'hack', { name: 'Hack', ownerId: A.uid })));
  check('admin cria uma liga direto → recusado (só pela função)', no(await db.create(U.admA.token, 'leagues', 'la2', { name: 'La2', ownerId: U.admA.uid })));
  check('admin renomeia a própria liga → permitido', okW(await db.update(U.admA.token, 'leagues/la', { name: 'Liga A2' })));
  check('admin NÃO grava o fim da assinatura (plano pago) direto no banco → recusado', no(await db.update(U.admA.token, 'leagues/la', { subscriptionActiveUntil: '2099-01-01T00:00:00.000Z' })));
  check('admin NÃO grava plano, fim do teste nem tipo de assinatura direto → recusado', no(await db.update(U.admA.token, 'leagues/la', { plan: 'paid' })) && no(await db.update(U.admA.token, 'leagues/la', { trialEndsAt: '2099-01-01T00:00:00.000Z' })) && no(await db.update(U.admA.token, 'leagues/la', { subscriptionPlan: 'annual' })));
  check('admin NÃO troca o criador da liga nem marca encerramento → recusado', no(await db.update(U.admA.token, 'leagues/la', { ownerId: U.pl1.uid })) && no(await db.update(U.admA.token, 'leagues/la', { closingBy: U.admA.uid })));
  check('admin NÃO esconde um campo proibido junto com o nome → recusado', no(await db.update(U.admA.token, 'leagues/la', { name: 'Liga A3', subscriptionPlan: 'annual' })));
  check('admin NÃO cria campo novo qualquer na liga → recusado', no(await db.update(U.admA.token, 'leagues/la', { foo: 1 })));
  check('as tentativas recusadas não mudaram nada na liga', (d => d.name === 'Liga A2' && d.plan === 'trial' && d.ownerId === U.admA.uid && !('subscriptionActiveUntil' in d) && !('closingBy' in d))(docData(await db.get('owner', 'leagues/la'))));
  check('jogador renomeia a liga → recusado', no(await db.update(U.pl1.token, 'leagues/la', { name: 'X' })));
  check('quem é de fora renomeia a liga → recusado', no(await db.update(U.outsider.token, 'leagues/la', { name: 'X' })));
  check('admin de OUTRA liga renomeia a liga → recusado', no(await db.update(U.admB.token, 'leagues/la', { name: 'X' })));
  check('admin apaga a própria liga → recusado', no(await db.del(U.admA.token, 'leagues/la')));
  check('conta logada lê o documento da liga (nome) → permitido (comportamento atual)', okW(await db.get(A.token, 'leagues/la')));

  // ═════════════ REGRAS: convites ═════════════
  console.log('── invite_tokens');
  check('admin cria convite → permitido', okW(await db.create(U.admA.token, 'leagues/la/invite_tokens', 'tok1', { role: 'player', used: false, createdBy: U.admA.uid, createdAt: NOW })));
  check('admin lê convite → permitido', okW(await db.get(U.admA.token, 'leagues/la/invite_tokens/tok1')));
  check('admin lista convites → permitido', okW(await db.list(U.admA.token, 'leagues/la/invite_tokens')));
  check('admin apaga convite → permitido', okW(await db.del(U.admA.token, 'leagues/la/invite_tokens/tok1')));
  check('jogador lê convite → recusado', no(await db.get(U.pl1.token, 'leagues/la/invite_tokens/tokX')));
  check('jogador lista convites → recusado', no(await db.list(U.pl1.token, 'leagues/la/invite_tokens')));
  check('atacante lê convite → recusado', no(await db.get(A.token, 'leagues/la/invite_tokens/tokX')));
  check('atacante marca convite como usado → recusado', no(await db.update(A.token, 'leagues/la/invite_tokens/tokX', { used: true })));
  check('admin também não edita convite (só cria/apaga) → recusado', no(await db.update(U.admA.token, 'leagues/la/invite_tokens/tokX', { used: true })));
  check('atacante cria convite de admin numa liga → recusado', no(await db.create(A.token, 'leagues/la/invite_tokens', 'tok-hack', { role: 'admin', used: false })));
  check('admin de OUTRA liga cria convite → recusado', no(await db.create(U.admB.token, 'leagues/la/invite_tokens', 'tok-b', { role: 'player', used: false })));

  // ═════════════ REGRAS: contatos (WhatsApp) só do admin ═════════════
  console.log('── contacts (WhatsApp só do admin)');
  check('admin lê contato → permitido', okW(await db.get(U.admA.token, 'leagues/la/contacts/seed1')));
  check('admin lista contatos → permitido', okW(await db.list(U.admA.token, 'leagues/la/contacts')));
  check('admin grava contato → permitido', okW(await db.set(U.admA.token, 'leagues/la/contacts/novo', { whatsapp: '11900000000' })));
  check('admin apaga contato → permitido', okW(await db.del(U.admA.token, 'leagues/la/contacts/novo')));
  check('jogador lê contato → recusado', no(await db.get(U.pl1.token, 'leagues/la/contacts/seed1')));
  check('jogador lista contatos → recusado', no(await db.list(U.pl1.token, 'leagues/la/contacts')));
  check('jogador grava contato → recusado', no(await db.set(U.pl1.token, 'leagues/la/contacts/pl_um', { whatsapp: '11' })));
  check('jogador apaga contato → recusado', no(await db.del(U.pl1.token, 'leagues/la/contacts/seed1')));
  check('pendente lê contato → recusado', no(await db.get(U.pend.token, 'leagues/la/contacts/seed1')));
  check('quem é de fora lê contato → recusado', no(await db.get(U.outsider.token, 'leagues/la/contacts/seed1')));
  check('admin de OUTRA liga lê contato → recusado', no(await db.get(U.admB.token, 'leagues/la/contacts/seed1')));
  check('atacante lê contato → recusado', no(await db.get(A.token, 'leagues/la/contacts/seed1')));

  // ═════════════ REGRAS: trava do WhatsApp nas áreas abertas ═════════════
  console.log('── trava: WhatsApp não pode voltar para áreas que todo membro lê');
  check('admin cria jogador no cadastro COM whatsapp → recusado', no(await db.create(U.admA.token, 'leagues/la/player_registry', 'novo1', { name: 'Novo', whatsapp: '11911112222' })));
  check('admin cria jogador no cadastro sem whatsapp → permitido', okW(await db.create(U.admA.token, 'leagues/la/player_registry', 'novo2', { name: 'Novo 2' })));
  check('admin edita outro campo de cadastro antigo (whatsapp fica igual) → permitido', okW(await db.update(U.admA.token, 'leagues/la/player_registry/pl_um', { active: false })));
  check('admin ALTERA o whatsapp no cadastro → recusado', no(await db.update(U.admA.token, 'leagues/la/player_registry/pl_um', { whatsapp: '11000000000' })));
  check('admin substitui o cadastro inteiro com whatsapp diferente → recusado', no(await db.set(U.admA.token, 'leagues/la/player_registry/pl_um', { name: 'Pl Um', whatsapp: '11000000000' })));
  check('admin ADICIONA whatsapp num cadastro que não tinha → recusado', no(await db.update(U.admA.token, 'leagues/la/player_registry/caio', { whatsapp: '11933334444' })));
  check('admin APAGA o whatsapp do cadastro → permitido', okW(await db.update(U.admA.token, 'leagues/la/player_registry/pl_um', { whatsapp: undefined })));
  check('admin cria avulso financeiro COM whatsapp → recusado', no(await db.create(U.admA.token, 'leagues/la/financeiro_avulsos', 'a9', { nome: 'X', valor: 20, whatsapp: '11955556666' })));
  check('admin cria avulso financeiro sem whatsapp → permitido', okW(await db.create(U.admA.token, 'leagues/la/financeiro_avulsos', 'a8', { nome: 'Y', valor: 20, paga: false })));
  check('admin marca avulso antigo como pago (whatsapp fica igual) → permitido', okW(await db.update(U.admA.token, 'leagues/la/financeiro_avulsos/a1', { paga: true })));
  check('admin altera whatsapp de avulso → recusado', no(await db.update(U.admA.token, 'leagues/la/financeiro_avulsos/a1', { whatsapp: '11000000000' })));
  check('admin apaga avulso → permitido', okW(await db.del(U.admA.token, 'leagues/la/financeiro_avulsos/a8')));
  check('jogador grava no cadastro do elenco → recusado', no(await db.update(U.pl1.token, 'leagues/la/player_registry/caio', { active: false })));
  check('jogador lê o cadastro do elenco → permitido', okW(await db.get(U.pl1.token, 'leagues/la/player_registry/caio')));
  check('quem é de fora lê o cadastro do elenco → recusado', no(await db.get(U.outsider.token, 'leagues/la/player_registry/caio')));

  // ═════════════ REGRAS: o resto continua como estava ═════════════
  console.log('── regressão: demais coleções');
  await seed();
  check('jogador grava em campeonato (presença/voto, por desenho) → permitido', okW(await db.update(U.pl1.token, 'leagues/la/championships/c1', { 'attendances.pl_um': true })));
  check('jogador cria campeonato → permitido (por desenho)', okW(await db.create(U.pl1.token, 'leagues/la/championships', 'c9', { date: '2026-10-01', status: 'preset' })));
  check('quem é de fora grava em campeonato → recusado', no(await db.update(U.outsider.token, 'leagues/la/championships/c1', { x: 1 })));
  check('pendente lê campeonato → recusado', no(await db.get(U.pend.token, 'leagues/la/championships/c1')));
  check('jogador lê campeonato → permitido', okW(await db.get(U.pl1.token, 'leagues/la/championships/c1')));
  check('jogador cria o próprio pedido de vinculação → permitido', okW(await db.set(U.pl1.token, 'leagues/la/link_requests/' + U.pl1.uid, { uid: U.pl1.uid, email: 'a', status: 'pending' })));
  check('jogador cria pedido de vinculação em nome de outro → recusado', no(await db.set(U.pl1.token, 'leagues/la/link_requests/' + U.pl2.uid, { uid: U.pl2.uid, status: 'pending' })));
  check('admin lê pedidos de vinculação → permitido', okW(await db.get(U.admA.token, 'leagues/la/link_requests/' + U.pl1.uid)));
  check('outro jogador lê o pedido de vinculação → recusado', no(await db.get(U.pl2.token, 'leagues/la/link_requests/' + U.pl1.uid)));
  check('jogador grava a própria foto (playerKey dele) → permitido', okW(await db.set(U.pl1.token, 'leagues/la/player_photos/pl_um', { url: CLOUDINARY, uid: U.pl1.uid, updatedAt: NOW })));
  check('jogador grava foto de OUTRO jogador → recusado', no(await db.set(U.pl1.token, 'leagues/la/player_photos/ana', { url: CLOUDINARY, uid: U.pl1.uid, updatedAt: NOW })));
  check('foto com endereço fora do Cloudinary → recusada', no(await db.set(U.pl1.token, 'leagues/la/player_photos/pl_um', { url: 'https://evil.example/x.jpg', uid: U.pl1.uid, updatedAt: NOW })));
  check('jogador grava configuração financeira → recusado', no(await db.update(U.pl1.token, 'leagues/la/financeiro_config/main', { valorMensalidade: 1 })));
  check('admin grava configuração financeira → permitido', okW(await db.update(U.admA.token, 'leagues/la/financeiro_config/main', { valorMensalidade: 60 })));
  check('jogador lê configuração financeira (aba Financeiro aberta ao grupo) → permitido', okW(await db.get(U.pl1.token, 'leagues/la/financeiro_config/main')));
  check('quem é de fora lê configuração financeira → recusado', no(await db.get(U.outsider.token, 'leagues/la/financeiro_config/main')));
  check('jogador cria a própria notificação de badge → permitido', okW(await db.create(U.pl1.token, `users/${U.pl1.uid}/badgeNotifs`, 'n1', { leagueId: 'la', newBadges: [] })));
  check('jogador cria notificação de badge de OUTRO → recusado', no(await db.create(U.pl1.token, `users/${U.pl2.uid}/badgeNotifs`, 'n2', { leagueId: 'la', newBadges: [] })));
  check('jogador lê notificações de badge de OUTRO → recusado', no(await db.list(U.pl2.token, `users/${U.pl1.uid}/badgeNotifs`)));
  check('ninguém (nem admin) lê ou grava os contadores de limite de chamadas → recusado', no(await db.get(U.admA.token, 'rate_limits/qualquer')) && no(await db.set(U.admA.token, `rate_limits/${U.admA.uid}_manageMember`, { count: 0, windowStart: 0 })) && no(await db.list(U.admA.token, 'rate_limits')));

  // ═════════════ FUNÇÕES (ponta a ponta com tokens reais do emulador) ═════════════
  console.log('── funções: autenticação');
  await seed();
  r = await callFn('joinLeague', null, { liga: 'la', token: 'tokX' });
  check('chamar função sem login → não autenticado', r.status === 401 && r.error && r.error.status === 'UNAUTHENTICATED', r.raw);

  console.log('── funções: owner sem e-mail verificado não tem poder de dono');
  r = await callFn('listMembers', U.owner.token, { liga: 'la' });
  check('conta com o e-mail do dono, NÃO verificado, não lista membros', r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
  r = await callFn('manageMember', U.owner.token, { liga: 'la', uid: U.pend.uid, action: 'approve' });
  check('conta com o e-mail do dono, NÃO verificado, não aprova ninguém', r.status === 403, r.raw);
  check('conta com o e-mail do dono, NÃO verificado, também não grava nada na liga pelas regras → recusado', no(await db.update(U.owner.token, 'leagues/la', { name: 'Roubada' })) && no(await db.update(U.owner.token, 'leagues/la', { subscriptionPlan: 'annual' })) && no(await db.set(U.owner.token, 'leagues/la/contacts/x', { whatsapp: '1' })));
  await verifyEmail(U.owner);
  check('dono do sistema (e-mail verificado) grava qualquer campo da liga pelas regras → permitido', okW(await db.update(U.owner.token, 'leagues/la', { plan: 'paid' })) && okW(await db.update(U.owner.token, 'leagues/la', { plan: 'trial' })));

  console.log('── funções: joinLeague (convites)');
  await db.set('owner', 'leagues/la/invite_tokens/tokJ0000001', { role: 'player', used: false, createdBy: U.admA.uid, createdAt: NOW });
  await db.set('owner', 'leagues/la/invite_tokens/tokK0000001', { role: 'player', used: false, createdBy: U.admA.uid, createdAt: NOW });
  await db.set('owner', 'leagues/la/invite_tokens/tokM0000001', { role: 'player', used: false, createdBy: U.admA.uid, createdAt: NOW });
  await db.set('owner', 'leagues/la/invite_tokens/tokAdm00001', { role: 'admin', used: false, createdBy: U.admA.uid, createdAt: NOW });
  check('antes de entrar, o atacante não lê nada da liga', no(await db.get(A.token, 'leagues/la/championships/c1')));
  r = await callFn('joinLeague', A.token, { liga: 'la', token: 'tokJ0000001' });
  check('atacante entra com convite válido → papel player', r.status === 200 && r.result.role === 'player', r.raw);
  let ud = docData(await db.get('owner', 'users/' + A.uid));
  check('cadastro do atacante ganhou a liga como player e o papel geral segue pendente', ud.leagues.la.role === 'player' && ud.role === 'pending', ud);
  check('convite ficou marcado como usado por ele', (d => d.used === true && d.usedBy === A.uid)(docData(await db.get('owner', 'leagues/la/invite_tokens/tokJ0000001'))));
  check('depois de entrar, ele lê os campeonatos da liga', okW(await db.get(A.token, 'leagues/la/championships/c1')));
  check('…mas continua sem ler contatos (WhatsApp)', no(await db.get(A.token, 'leagues/la/contacts/seed1')));
  check('…e sem conseguir virar admin', no(await db.update(A.token, 'users/' + A.uid, { 'leagues.la.role': 'admin' })));
  r = await callFn('joinLeague', U.second.token, { liga: 'la', token: 'tokJ0000001' });
  check('reaproveitar convite já usado → recusado', r.status === 400 && r.error.status === 'FAILED_PRECONDITION', r.raw);
  check('quem tentou reaproveitar NÃO ganhou a liga', (await db.get(U.second.token, 'leagues/la/championships/c1')).status === 403);
  r = await callFn('joinLeague', U.newbie.token, { liga: 'la', token: 'tokK0000001' });
  check('conta sem cadastro entra com convite (a função cria o cadastro) → player', r.status === 200 && r.result.role === 'player', r.raw);
  ud = docData(await db.get('owner', 'users/' + U.newbie.uid));
  check('cadastro criado pela função: e-mail da conta, papel geral pendente, liga como player', ud.email === U.newbie.email && ud.role === 'pending' && ud.leagues.la.role === 'player', ud);
  r = await callFn('joinLeague', U.pl1.token, { liga: 'la', token: 'tokM0000001' });
  check('quem já participa recebe o papel atual sem gastar o convite', r.status === 200 && r.result.role === 'player' && docData(await db.get('owner', 'leagues/la/invite_tokens/tokM0000001')).used === false, r.raw);
  r = await callFn('joinLeague', U.outsider.token, { liga: 'la', token: 'tokAdm00001' });
  ud = docData(await db.get('owner', 'users/' + U.outsider.uid));
  check('convite de admin dá admin só naquela liga; papel geral não muda', !!r.result && r.result.role === 'admin' && !!ud && ud.leagues.la.role === 'admin' && ud.role === 'pending', [r.raw, ud]);
  await db.update('owner', 'users/' + U.outsider.uid, { 'leagues.la': undefined });  // volta ao estado de "fora" para os testes seguintes
  r = await callFn('joinLeague', U.second.token, { liga: 'lb', token: 'tokM0000001' });
  check('convite de uma liga não vale em outra', r.status === 400, r.raw);
  r = await callFn('joinLeague', U.second.token, { liga: '../x', token: 'tokM0000001' });
  check('liga com caracteres perigosos → argumento inválido', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);

  console.log('── funções: createLeague');
  r = await callFn('createLeague', U.outsider.token, { name: 'Liga do Fora', slug: 'liga-fora' });
  check('conta cria uma liga', r.status === 200 && r.result.slug === 'liga-fora', r.raw);
  const lg = docData(await db.get('owner', 'leagues/liga-fora'));
  check('liga criada: dono, plano de teste e dias grátis', lg.ownerId === U.outsider.uid && lg.plan === 'trial' && lg.name === 'Liga do Fora', lg);
  check('quem criou é admin e as regras reconhecem: cria convite na própria liga', okW(await db.create(U.outsider.token, 'leagues/liga-fora/invite_tokens', 't1', { role: 'player', used: false })));
  check('…e lê a configuração da própria liga', okR(await db.get(U.outsider.token, 'leagues/liga-fora/app_config/main')));
  check('…mas continua sem acesso à Liga A', no(await db.get(U.outsider.token, 'leagues/la/championships/c1')));
  r = await callFn('createLeague', U.second.token, { name: 'Roubo', slug: 'liga-fora' });
  check('criar liga com ID que já existe → já existe', r.status === 409 && r.error.status === 'ALREADY_EXISTS', r.raw);
  check('a liga existente não trocou de dono', docData(await db.get('owner', 'leagues/liga-fora')).ownerId === U.outsider.uid);
  r = await callFn('createLeague', U.second.token, { name: 'X', slug: 'Liga Ruim' });
  check('ID inválido → argumento inválido', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);
  check('ninguém consegue sobrescrever a Liga A pela função', (await callFn('createLeague', U.second.token, { name: 'X', slug: 'la' })).status === 409 && docData(await db.get('owner', 'leagues/la')).ownerId === U.admA.uid);
  let capOk = 0;
  for (let i = 1; i <= 9; i++) if ((await callFn('createLeague', U.outsider.token, { name: 'Cap ' + i, slug: 'liga-cap-' + i })).status === 200) capOk++;
  check('a mesma conta cria até 10 ligas (1 + 9)', capOk === 9, capOk);
  r = await callFn('createLeague', U.outsider.token, { name: 'Onze', slug: 'liga-onze' });
  check('a 11ª liga da mesma conta é recusada', r.status === 429 && r.error.status === 'RESOURCE_EXHAUSTED', r.raw);

  console.log('── funções: manageMember');
  await seed();
  r = await callFn('manageMember', U.pl1.token, { liga: 'la', uid: U.pl1.uid, action: 'promote' });
  check('jogador tenta se promover pela função → recusado', r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
  r = await callFn('manageMember', U.admB.token, { liga: 'la', uid: U.pend.uid, action: 'approve' });
  check('admin de OUTRA liga tenta aprovar → recusado', r.status === 403, r.raw);
  r = await callFn('manageMember', U.admA.token, { liga: 'la', uid: U.pend.uid, action: 'approve', playerKey: 'pend_jogador' });
  ud = docData(await db.get('owner', 'users/' + U.pend.uid));
  check('admin aprova pendente e vincula ao jogador', r.status === 200 && ud.leagues.la.role === 'player' && ud.leagues.la.playerKey === 'pend_jogador' && ud.playerKey === 'pend_jogador', ud);
  check('aprovado passa a ler os campeonatos', okW(await db.get(U.pend.token, 'leagues/la/championships/c1')));
  r = await callFn('manageMember', U.admA.token, { liga: 'la', uid: U.pl2.uid, action: 'promote' });
  check('admin promove jogador a admin da liga', r.status === 200 && docData(await db.get('owner', 'users/' + U.pl2.uid)).leagues.la.role === 'admin');
  check('o novo admin passa a ler os contatos', okW(await db.get(U.pl2.token, 'leagues/la/contacts/seed1')));
  r = await callFn('manageMember', U.pl2.token, { liga: 'la', uid: U.admA.uid, action: 'reject' });
  check('ninguém rejeita o criador da liga', r.status === 400 && r.error.status === 'FAILED_PRECONDITION' && docData(await db.get('owner', 'users/' + U.admA.uid)).leagues.la.role === 'admin', r.raw);
  r = await callFn('manageMember', U.pl2.token, { liga: 'la', uid: U.pl1.uid, action: 'reject' });
  check('admin rejeita jogador → papel rejected; ele perde o acesso', r.status === 200 && no(await db.get(U.pl1.token, 'leagues/la/championships/c1')));
  await db.set(U.pl1.token, 'leagues/la/link_requests/' + U.pl1.uid, { uid: U.pl1.uid, status: 'pending' }).catch(() => {});
  await db.set('owner', 'leagues/la/link_requests/' + U.pl2.uid, { uid: U.pl2.uid, status: 'pending' });
  r = await callFn('manageMember', U.admA.token, { liga: 'la', uid: U.pl2.uid, action: 'linkRequest', approve: true, playerKey: 'pl_dois' });
  ud = docData(await db.get('owner', 'users/' + U.pl2.uid));
  check('admin responde pedido de vinculação: vincula, limpa aviso e apaga o pedido', r.status === 200 && ud.leagues.la.playerKey === 'pl_dois' && ud.linkRequestSent === false && (await db.get('owner', 'leagues/la/link_requests/' + U.pl2.uid)).status === 404, ud);
  r = await callFn('manageMember', U.admA.token, { liga: 'la', uid: U.pl2.uid, action: 'link', playerKey: 'a/b' });
  check('vínculo com identificador inválido → recusado', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);

  console.log('── funções: listMembers (LGPD)');
  await seed();
  r = await callFn('listMembers', U.admA.token, { liga: 'la' });
  const members = (r.result && r.result.members) || [];
  check('admin da liga recebe a lista de membros', r.status === 200 && members.length === 4 && members.some(m => m.uid === U.pl1.uid && m.role === 'player' && m.playerKey === 'pl_um'), r.raw);
  check('a lista traz só os campos do painel', members.every(m => JSON.stringify(Object.keys(m).sort()) === JSON.stringify(['displayName', 'email', 'joinedAt', 'playerKey', 'role', 'uid'])), members[0]);
  check('a lista NÃO traz tokens de notificação', JSON.stringify(r.raw).indexOf('secreto') < 0 && JSON.stringify(r.raw).indexOf('fcmTokens') < 0 && JSON.stringify(r.raw).indexOf('tokA') < 0);
  check('a lista NÃO traz gente de outra liga', !members.some(m => m.uid === U.admB.uid || m.uid === U.outsider.uid));
  r = await callFn('listMembers', U.admA.token, { liga: 'la', roles: ['pending'] });
  check('filtro por pendentes', r.status === 200 && r.result.members.length === 1 && r.result.members[0].uid === U.pend.uid, r.raw);
  r = await callFn('listMembers', U.pl1.token, { liga: 'la' });
  check('jogador comum NÃO lista membros', r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
  r = await callFn('listMembers', U.admB.token, { liga: 'la' });
  check('admin de outra liga NÃO lista membros desta', r.status === 403, r.raw);
  r = await callFn('listMembers', A.token, { liga: 'la' });
  check('atacante NÃO lista membros', r.status === 403, r.raw);
  r = await callFn('listMembers', U.owner.token, { liga: 'lb' });
  check('dono do sistema (e-mail verificado) lista qualquer liga', r.status === 200 && r.result.members.length === 1 && r.result.members[0].uid === U.admB.uid, r.raw);
  r = await callFn('listMembers', U.admA.token, { liga: 'la', roles: ['admin', 'hacker'] });
  check('filtro com papel inexistente → argumento inválido', r.status === 400, r.raw);

  console.log('── funções: badges e sair da liga');
  r = await callFn('saveEarnedBadges', U.pl1.token, { liga: 'la', ids: ['hat_trick', 'sonho_do_adm'] });
  check('jogador salva as próprias badges vistas', r.status === 200 && JSON.stringify(docData(await db.get('owner', 'users/' + U.pl1.uid)).leagues.la.earnedBadges) === '["hat_trick","sonho_do_adm"]', r.raw);
  r = await callFn('saveEarnedBadges', U.admB.token, { liga: 'la', ids: ['x'] });
  check('quem não é da liga NÃO grava badges nela', r.status === 403, r.raw);
  r = await callFn('leaveLeague', U.pl2.token, { liga: 'la' });
  ud = docData(await db.get('owner', 'users/' + U.pl2.uid));
  check('jogador sai da liga: só aquele vínculo some', r.status === 200 && !(ud.leagues && ud.leagues.la) && ud.email === U.pl2.email, ud);
  check('depois de sair, perde o acesso', no(await db.get(U.pl2.token, 'leagues/la/championships/c1')));
  check('…e não volta sozinho (sem convite)', no(await db.update(U.pl2.token, 'users/' + U.pl2.uid, { 'leagues.la': { role: 'admin' } })));

  console.log('── funções: migração do WhatsApp (dados antigos → área do admin)');
  await seed();
  // estado antigo completo: números em cadastro, avulsos financeiros e campeonatos; jogador enxerga tudo antes
  await db.set('owner', 'leagues/la/championships/c2', { date: '2026-09-20', status: 'preset', avulsos: [{ name: 'Zé Convidado', valor: 20, finId: 'a1', whatsapp: '11977770009' }, { name: 'Maria Avulsa', valor: 20, finId: 'x', whatsapp: '11966660001' }] });
  const before = docData(await db.get(U.pl1.token, 'leagues/la/player_registry/ana'));
  check('ANTES: jogador comum conseguia ler o WhatsApp no cadastro do elenco', before.whatsapp === '11988880002', before);
  check('ANTES: jogador comum conseguia ler o WhatsApp nos avulsos do campeonato', JSON.stringify(docData(await db.get(U.pl1.token, 'leagues/la/championships/c2')).avulsos).indexOf('11966660001') > 0);
  r = await callFn('migrateContacts', U.pl1.token, { liga: 'la' });
  check('jogador comum NÃO roda a migração', r.status === 403, r.raw);
  r = await callFn('migrateContacts', U.admB.token, { liga: 'la' });
  check('admin de outra liga NÃO roda a migração', r.status === 403, r.raw);
  check('negativas não mexeram nos números', docData(await db.get('owner', 'leagues/la/player_registry/ana')).whatsapp === '11988880002');
  r = await callFn('migrateContacts', U.admA.token, { liga: 'la' });
  check('admin roda a migração: 4 contatos (2 jogadores + 2 avulsos)', r.status === 200 && r.result.skipped === false && r.result.moved === 4 && r.result.created === 4, r.raw);
  const ct = async id => (docData(await db.get('owner', 'leagues/la/contacts/' + id)) || {}).whatsapp;
  check('contatos gravados (só dígitos, id certo)', (await ct('pl_um')) === '11999990001' && (await ct('ana')) === '11988880002' && (await ct('avulso_ze_convidado')) === '11977770009' && (await ct('avulso_maria_avulsa')) === '11966660001', [await ct('pl_um'), await ct('ana'), await ct('avulso_ze_convidado'), await ct('avulso_maria_avulsa')]);
  check('contato que já existia (seed1) não foi mexido', (await ct('seed1')) === '11912345678');
  const after = docData(await db.get(U.pl1.token, 'leagues/la/player_registry/ana'));
  check('DEPOIS: cadastro do elenco não traz mais o WhatsApp (e mantém o nome)', !('whatsapp' in after) && after.name === 'Ana', after);
  check('DEPOIS: jogador comum não acha nenhum número no cadastro do elenco', JSON.stringify((await db.list(U.pl1.token, 'leagues/la/player_registry')).json).indexOf('1198888') < 0 && JSON.stringify((await db.list(U.pl1.token, 'leagues/la/player_registry')).json).indexOf('1199999') < 0);
  check('DEPOIS: jogador comum não acha nenhum número nos avulsos financeiros', JSON.stringify((await db.list(U.pl1.token, 'leagues/la/financeiro_avulsos')).json).indexOf('1197777') < 0);
  const champsJson = JSON.stringify((await db.list(U.pl1.token, 'leagues/la/championships')).json);
  check('DEPOIS: jogador comum não acha nenhum número nos campeonatos (e os avulsos continuam lá)', champsJson.indexOf('11966660001') < 0 && champsJson.indexOf('11977770') < 0 && champsJson.indexOf('Maria Avulsa') > 0 && champsJson.indexOf('finId') > 0);
  check('DEPOIS: jogador comum não lê os contatos', no(await db.get(U.pl1.token, 'leagues/la/contacts/ana')) && no(await db.list(U.pl1.token, 'leagues/la/contacts')));
  check('DEPOIS: o admin lê os contatos', okW(await db.get(U.admA.token, 'leagues/la/contacts/ana')) && docData(await db.get(U.admA.token, 'leagues/la/contacts/ana')).whatsapp === '11988880002');
  r = await callFn('migrateContacts', U.admA.token, { liga: 'la' });
  check('repetir a migração é seguro (já concluída)', r.status === 200 && r.result.skipped === true, r.raw);
  check('a Liga B não foi tocada', okW(await db.get('owner', 'leagues/lb')));

  console.log('── excluir a própria conta (direito de exclusão)');
  await seed();
  const forge = (token, patch) => {  // token do emulador é "alg: none": dá para simular um login antigo
    const [h, p, s] = token.split('.');
    const payload = { ...JSON.parse(Buffer.from(p, 'base64url').toString()), ...patch };
    return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s || ''}`;
  };
  const signIn = async (email) => (await http('POST', `${AUTH_URL}/accounts:signInWithPassword?key=fake`, null, { email, password: PASSWORD, returnSecureToken: true }));

  // 1) jogador com cadastro, foto, WhatsApp, pedido de vinculação, notificações e convite usado
  const D = await newUser('apagar@teste.invalid');
  await db.set('owner', 'leagues/la/invite_tokens/tokDel00001', { role: 'player', used: false, createdBy: U.admA.uid, createdAt: NOW });
  check('conta nova entra na liga por convite', (await callFn('joinLeague', D.token, { liga: 'la', token: 'tokDel00001' })).status === 200);
  check('admin vincula a conta ao jogador', (await callFn('manageMember', U.admA.token, { liga: 'la', uid: D.uid, action: 'link', playerKey: 'apagar_jog' })).status === 200);
  await db.set('owner', 'leagues/la/player_registry/apagar_jog', { name: 'Apagar Jog', active: true });
  await db.set('owner', 'leagues/la/contacts/apagar_jog', { whatsapp: '11933332222' });
  check('jogador grava a própria foto', okW(await db.set(D.token, 'leagues/la/player_photos/apagar_jog', { url: CLOUDINARY, uid: D.uid, updatedAt: NOW })));
  check('jogador grava pedido de vinculação, aparelho de notificação e badge', okW(await db.set(D.token, 'leagues/la/link_requests/' + D.uid, { uid: D.uid, email: D.email, status: 'pending' })) && okW(await db.update(D.token, 'users/' + D.uid, { fcmTokens: ['tokDel'], notifEnabled: true })) && okW(await db.create(D.token, `users/${D.uid}/badgeNotifs`, 'n1', { leagueId: 'la', newBadges: [] })));
  await db.set('owner', 'leagues/la/championships/c9', { date: '2026-09-09', status: 'completed', teamRosters: { azul: ['Apagar Jog', 'Ana'] } });
  const othersBefore = JSON.stringify(docData(await db.get('owner', 'users/' + U.pl1.uid)));

  // login antigo (token forjado com auth_time de 1 hora atrás) → recusa e não apaga nada
  r = await callFn('deleteMyAccount', forge(D.token, { auth_time: Math.floor(Date.now() / 1000) - 3600 }), { confirm: true });
  check('login antigo → pede para entrar de novo (razão "recent-login")', r.status === 400 && r.error.status === 'FAILED_PRECONDITION' && r.error.details && r.error.details.reason === 'recent-login', r.raw);
  check('login antigo → nada foi apagado', (await db.get('owner', 'users/' + D.uid)).status === 200 && (await signIn(D.email)).status === 200 && (await db.get('owner', 'leagues/la/contacts/apagar_jog')).status === 200);
  r = await callFn('deleteMyAccount', D.token, { confirm: false });
  check('sem confirmação → recusado', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);
  r = await callFn('deleteMyAccount', null, { confirm: true });
  check('sem login → não autenticado', r.status === 401, r.raw);

  r = await callFn('deleteMyAccount', D.token, { confirm: true, uid: U.pl1.uid });
  check('jogador exclui a própria conta', r.status === 200 && r.result.ok === true, r.raw);
  check('o LOGIN deixou de existir (não dá mais para entrar)', (await signIn(D.email)).status === 400 && /EMAIL_NOT_FOUND/.test(JSON.stringify((await signIn(D.email)).json)), (await signIn(D.email)).json);
  check('cadastro do usuário apagado', (await db.get('owner', 'users/' + D.uid)).status === 404);
  check('notificações pendentes (subcoleção) apagadas', ((await db.list('owner', `users/${D.uid}/badgeNotifs`)).json.documents || []).length === 0);
  check('pedido de vinculação apagado', (await db.get('owner', 'leagues/la/link_requests/' + D.uid)).status === 404);
  check('WhatsApp e foto do jogador apagados', (await db.get('owner', 'leagues/la/contacts/apagar_jog')).status === 404 && (await db.get('owner', 'leagues/la/player_photos/apagar_jog')).status === 404);
  check('convite que ela usou perdeu o identificador da conta', (d => d.used === true && !('usedBy' in d))(docData(await db.get('owner', 'leagues/la/invite_tokens/tokDel00001'))));
  check('registro esportivo fica (elenco e campeonatos)', (await db.get('owner', 'leagues/la/player_registry/apagar_jog')).status === 200 && JSON.stringify(docData(await db.get('owner', 'leagues/la/championships/c9'))).includes('Apagar Jog'));
  check('o "uid" enviado no pedido foi ignorado: outra pessoa intacta', JSON.stringify(docData(await db.get('owner', 'users/' + U.pl1.uid))) === othersBefore);
  r = await callFn('listMembers', U.admA.token, { liga: 'la' });
  check('a liga continua funcionando e o admin não vê mais a conta apagada', r.status === 200 && !r.result.members.some(m => m.uid === D.uid) && r.result.members.some(m => m.uid === U.pl1.uid), r.raw);
  check('a mesma conta não é recriada por engano: entrar de novo é impossível', (await signIn(D.email)).status === 400);

  // 2) único admin de uma liga: bloqueia; com outro admin, libera e a liga passa adiante
  const S1 = await newUser('admsolo1@teste.invalid');
  const S2 = await newUser('admsolo2@teste.invalid');
  r = await callFn('createLeague', S1.token, { name: 'Liga Solitária', slug: 'liga-solo' });
  check('conta cria a própria liga (vira admin e dona)', r.status === 200);
  r = await callFn('deleteMyAccount', S1.token, { confirm: true });
  check('único admin → bloqueado, com o nome da liga', r.status === 400 && r.error.details && r.error.details.reason === 'last-admin' && /Liga Solitária/.test(r.error.message), r.raw);
  check('bloqueado → conta e liga intactas', (await signIn(S1.email)).status === 200 && (await db.get('owner', 'users/' + S1.uid)).status === 200 && docData(await db.get('owner', 'leagues/liga-solo')).ownerId === S1.uid);
  await db.set(S1.token, 'leagues/liga-solo/invite_tokens/tokAdmSolo01', { role: 'admin', used: false, createdBy: S1.uid, createdAt: NOW });
  check('o admin convida outra conta como admin', (await callFn('joinLeague', S2.token, { liga: 'liga-solo', token: 'tokAdmSolo01' })).result.role === 'admin');
  S1.token = (await signIn(S1.email)).json.idToken;
  r = await callFn('deleteMyAccount', S1.token, { confirm: true });
  check('com outro admin na liga, a exclusão é liberada', r.status === 200, r.raw);
  check('a liga continua, agora com a outra conta como dona', docData(await db.get('owner', 'leagues/liga-solo')).ownerId === S2.uid, docData(await db.get('owner', 'leagues/liga-solo')));
  check('o admin que ficou continua administrando a liga', okW(await db.update(S2.token, 'leagues/liga-solo', { name: 'Liga Solitária 2' })));
  check('o convite criado pela conta apagada perdeu o identificador', !('createdBy' in docData(await db.get('owner', 'leagues/liga-solo/invite_tokens/tokAdmSolo01'))));

  console.log('── anonimizar meu nome no histórico (direito de anonimização)');
  await seed();
  await db.set('owner', 'leagues/la/player_titles/pl_um', { name: 'Pl Um', titles: 1, last_date: '2026-09-01' });
  await db.set('owner', 'leagues/la/championships/c1', { date: '2026-09-01', status: 'completed',
    champion_players: [{ name: 'Pl Um', weight: 1 }], teamRosters: { azul: ['Pl Um', 'Ana'] },
    matches: [{ goals: [{ player: 'Pl Um' }], finalGoals: [{ player: 'Pl Um' }] }],
    votes: { pl_um: { pos: 'Ana', neg: 'Caio' }, ana: { pos: 'Pl Um' } } });
  await db.set('owner', 'leagues/la/financeiro_mensalidades/2026-09', { pagamentos: { 'Pl Um': true, Ana: false } });
  await db.set('owner', 'leagues/la/contacts/pl_um', { whatsapp: '11999990001' });
  await db.set('owner', 'leagues/la/player_photos/pl_um', { url: CLOUDINARY, uid: U.pl1.uid, updatedAt: NOW });

  r = await callFn('anonymizeMyName', U.pl2.token, { liga: 'la' });
  check('quem não tem jogador vinculado não consegue anonimizar', r.status === 400 && r.error.status === 'FAILED_PRECONDITION', r.raw);
  r = await callFn('anonymizeMyName', U.pend.token, { liga: 'la' });
  check('pendente não consegue anonimizar', r.status === 403, r.raw);

  r = await callFn('anonymizeMyName', U.pl1.token, { liga: 'la' });
  check('jogador anonimiza o próprio nome', r.status === 200 && r.result.newKey.startsWith('jogador_anonimo_') && /^Jogador Anônimo #[0-9A-F]{4}$/.test(r.result.newName), r.raw);
  const anonKey = r.result.newKey, anonName = r.result.newName;
  check('cadastro antigo sumiu; o novo guarda o nome anterior', (await db.get('owner', 'leagues/la/player_registry/pl_um')).status === 404 && docData(await db.get('owner', 'leagues/la/player_registry/' + anonKey)).formerName === 'Pl Um');
  check('títulos migrados', (await db.get('owner', 'leagues/la/player_titles/pl_um')).status === 404 && docData(await db.get('owner', 'leagues/la/player_titles/' + anonKey)).name === anonName);
  check('foto apagada (não é levada adiante)', (await db.get('owner', 'leagues/la/player_photos/pl_um')).status === 404 && (await db.get('owner', 'leagues/la/player_photos/' + anonKey)).status === 404);
  check('contato migrado (admin continua alcançando)', (await db.get('owner', 'leagues/la/contacts/pl_um')).status === 404 && docData(await db.get('owner', 'leagues/la/contacts/' + anonKey)).whatsapp === '11999990001');
  const champAfter = docData(await db.get('owner', 'leagues/la/championships/c1'));
  check('campeão, elenco e gols migrados', champAfter.champion_players[0].name === anonName && champAfter.teamRosters.azul.includes(anonName) && champAfter.teamRosters.azul.includes('Ana') && champAfter.matches[0].goals[0].player === anonName);
  check('voto que ele deu migrado (chave do votante) e voto recebido migrado (nome)', champAfter.votes[anonKey] && champAfter.votes[anonKey].pos === 'Ana' && !champAfter.votes.pl_um && champAfter.votes.ana.pos === anonName, champAfter.votes);
  check('mensalidade migrada, resto intacto', !('Pl Um' in docData(await db.get('owner', 'leagues/la/financeiro_mensalidades/2026-09')).pagamentos) && docData(await db.get('owner', 'leagues/la/financeiro_mensalidades/2026-09')).pagamentos[anonName] === true);
  const anaUser = docData(await db.get('owner', 'users/' + U.pl1.uid));
  check('a conta passa a apontar para o novo jogador', anaUser.leagues.la.playerKey === anonKey, anaUser);
  check('o jogador continua lendo os próprios dados normalmente (não perdeu acesso à liga)', okW(await db.get(U.pl1.token, 'leagues/la/championships/c1')));

  r = await callFn('anonymizeMyName', U.pl1.token, { liga: 'la' });
  check('repetir depois de concluído não quebra e mantém a mesma identidade', r.status === 200 && r.result.newKey === anonKey, r.raw);
  check('repetir não deixa sobra nem duplica no campeonato', JSON.stringify(docData(await db.get('owner', 'leagues/la/championships/c1'))) === JSON.stringify(champAfter));
  check('outra conta (admin) não foi afetada', docData(await db.get('owner', 'users/' + U.admA.uid)).leagues.la.role === 'admin');

  console.log('── encerrar liga (função deleteLeague)');
  await seed();
  // A liga "la" com o que uma liga de verdade guarda, inclusive uma subcoleção dentro de um
  // campeonato. Ao apagar a foto roda o gatilho onPlayerPhotoDeleted (sem as chaves do Cloudinary
  // ele só pula o arquivo e segue).
  await db.set('owner', 'leagues/la/championships/c1/extra/x1', { n: 1 });
  await db.set('owner', 'leagues/la/player_titles/pl_um', { name: 'Pl Um', titles: 1 });
  await db.set('owner', 'leagues/la/player_photos/pl_um', { url: CLOUDINARY, uid: U.pl1.uid, updatedAt: NOW });
  await db.set('owner', 'leagues/la/financeiro_mensalidades/2026-09', { pagamentos: { 'Pl Um': true } });
  await db.set('owner', 'leagues/la/billing_payments/9001', { paymentId: '9001', amount: 238.8, renewsAtAfter: '2027-10-05T00:00:00.000Z' });
  await db.set('owner', 'leagues/la/link_requests/' + U.pl2.uid, { uid: U.pl2.uid, status: 'pending' });
  await db.set('owner', 'leagues/lb/player_registry/b1', { name: 'B Um' });
  mpSet([
    { id: 'sub-la', external_reference: 'la', status: 'authorized' },
    { id: 'sub-lb', external_reference: 'lb', status: 'authorized' },
  ]);
  const countDocs = async p => ((await db.list('owner', p)).json.documents || []).length;
  const LA_COLS = ['championships', 'championships/c1/extra', 'player_registry', 'player_titles', 'player_photos', 'contacts', 'financeiro_config',
    'financeiro_mensalidades', 'financeiro_avulsos', 'app_config', 'link_requests', 'invite_tokens', 'billing_payments'];
  const laTotal = async () => { let n = 0; for (const c of LA_COLS) n += await countDocs('leagues/la/' + c); return n; };
  const laBefore = await laTotal();
  check('(a liga de teste tem dados em todas as áreas, inclusive o registro de pagamentos)', laBefore >= 15, laBefore);

  r = await callFn('deleteLeague', null, { liga: 'la', confirm: true });
  check('sem login → não autenticado', r.status === 401, r.raw);
  r = await callFn('deleteLeague', U.pl1.token, { liga: 'la', confirm: true });
  check('jogador não encerra a liga', r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
  r = await callFn('deleteLeague', U.pend.token, { liga: 'la', confirm: true });
  check('pendente não encerra a liga', r.status === 403, r.raw);
  r = await callFn('deleteLeague', U.outsider.token, { liga: 'la', confirm: true });
  check('quem é de fora não encerra a liga', r.status === 403, r.raw);
  r = await callFn('deleteLeague', U.admB.token, { liga: 'la', confirm: true });
  check('admin de OUTRA liga não encerra esta', r.status === 403, r.raw);
  r = await callFn('deleteLeague', U.admA.token, { liga: 'la' });
  check('sem confirmação → recusado', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);
  r = await callFn('deleteLeague', U.admA.token, { liga: '../x', confirm: true });
  check('liga com caracteres perigosos → argumento inválido', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);
  r = await callFn('manageMember', U.admA.token, { liga: 'la', uid: U.pl2.uid, action: 'promote' });
  r = await callFn('deleteLeague', U.pl2.token, { liga: 'la', confirm: true });
  check('admin que NÃO criou a liga não encerra enquanto o criador ainda é admin', r.status === 403 && /quem criou/.test(r.error.message), r.raw);
  check('nenhuma negativa apagou algo ou cancelou assinatura', (await laTotal()) === laBefore && mpGet().updates.length === 0);

  r = await callFn('deleteLeague', U.admA.token, { liga: 'la', confirm: true });
  check('o criador encerra a liga', r.status === 200 && r.result.ok === true, r.raw);
  check('o documento da liga some', (await db.get('owner', 'leagues/la')).status === 404);
  check('tudo o que havia dentro some, inclusive a subcoleção de um campeonato', (await laTotal()) === 0, await laTotal());
  const mpAfter = mpGet();
  check('a assinatura da liga foi cancelada no Mercado Pago, e só ela', mpAfter.updates.length === 1 && mpAfter.updates[0].id === 'sub-la' && mpAfter.updates[0].body.status === 'cancelled', mpAfter);
  for (const k of ['admA', 'pl1', 'pl2', 'pend']) {
    const ud2 = docData(await db.get('owner', 'users/' + U[k].uid));
    check(`${k}: perdeu o vínculo com a liga apagada`, !!ud2 && !(ud2.leagues || {}).la, ud2);
  }
  const pl1Doc = docData(await db.get('owner', 'users/' + U.pl1.uid));
  check('o cadastro das pessoas continua (e-mail e aparelhos de notificação)', pl1Doc.email === U.pl1.email && pl1Doc.fcmTokens[0] === 'tokP1-secreto', pl1Doc);
  check('a Liga B continua inteira (dados e admin)', (await db.get('owner', 'leagues/lb/player_registry/b1')).status === 200 && docData(await db.get('owner', 'users/' + U.admB.uid)).leagues.lb.role === 'admin');
  check('ex-membro não lê mais nada da liga', no(await db.get(U.pl1.token, 'leagues/la/championships/c1')) && no(await db.get(U.admA.token, 'leagues/la/contacts/seed1')));
  r = await callFn('deleteLeague', U.admA.token, { liga: 'la', confirm: true });
  check('repetir com a liga já apagada → não encontrada', r.status === 404 && r.error.status === 'NOT_FOUND', r.raw);

  // dono do sistema encerra a liga de outra pessoa (suporte)
  r = await callFn('createLeague', U.outsider.token, { name: 'Liga do Suporte', slug: 'liga-suporte' });
  mpSet([]);
  r = await callFn('deleteLeague', U.owner.token, { liga: 'liga-suporte', confirm: true });
  check('dono do sistema (e-mail verificado) encerra a liga de outra pessoa', r.status === 200 && (await db.get('owner', 'leagues/liga-suporte')).status === 404, r.raw);

  console.log('── único admin: sair, encerrar a liga e depois excluir a conta');
  const S3 = await newUser('admsolo3@teste.invalid');
  check('conta cria a própria liga', (await callFn('createLeague', S3.token, { name: 'Liga Sozinha', slug: 'liga-sozinha' })).status === 200);
  mpSet([{ id: 'sub-sozinha', external_reference: 'liga-sozinha', status: 'authorized' }]);
  r = await callFn('leaveLeague', S3.token, { liga: 'liga-sozinha' });
  check('único admin NÃO sai da liga (ela ficaria sem ninguém para administrar)', r.status === 400 && r.error.status === 'FAILED_PRECONDITION' && r.error.details && r.error.details.reason === 'last-admin' && /encerre a liga/.test(r.error.message), r.raw);
  ud = docData(await db.get('owner', 'users/' + S3.uid));
  check('…e continua admin e criador', ud.leagues['liga-sozinha'].role === 'admin' && docData(await db.get('owner', 'leagues/liga-sozinha')).ownerId === S3.uid, ud);
  r = await callFn('deleteMyAccount', S3.token, { confirm: true });
  check('também não exclui a conta enquanto a liga depende dele', r.status === 400 && r.error.details && r.error.details.reason === 'last-admin' && /encerre a liga/.test(r.error.message), r.raw);
  r = await callFn('deleteLeague', S3.token, { liga: 'liga-sozinha', confirm: true });
  check('mas pode encerrar a liga', r.status === 200 && (await db.get('owner', 'leagues/liga-sozinha')).status === 404, r.raw);
  check('a assinatura dela foi cancelada', mpGet().updates.length === 1 && mpGet().updates[0].id === 'sub-sozinha');
  ud = docData(await db.get('owner', 'users/' + S3.uid));
  check('a conta ficou sem ligas (e continua existindo)', !!ud && Object.keys(ud.leagues || {}).length === 0, ud);
  S3.token = (await signIn(S3.email)).json.idToken;
  r = await callFn('deleteMyAccount', S3.token, { confirm: true });
  check('agora a conta pode ser excluída', r.status === 200 && r.result.ok === true, r.raw);

  // ═════════════ ESTENDER PLANO ═════════════
  // Cada pagamento anual aprovado SOMA 12 meses ao vencimento (transação de verdade no emulador, com
  // avisos repetidos e simultâneos); a assinatura mensal é cancelada sozinha ao estender, ou a pedido,
  // pelo app. O Mercado Pago é o simulado (test/mp-stub.js).
  console.log('── estender plano: pagamento anual soma 12 meses; mensal é cancelada; cancelar pelo app');
  await seed();
  const DAYMS = 86400000;
  const plus12 = iso => { const d = new Date(iso); const y = d.getUTCFullYear() + 1, m = d.getUTCMonth(); return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString(); };
  const agoIso = ms => new Date(Date.now() - ms).toISOString();
  // Aprovações de poucos minutos atrás: sempre depois do corte da soma de períodos (ANNUAL_STACKING_FROM).
  const pay = (id, extra) => ({ id, external_reference: 'la', status: 'approved', operation_type: 'regular_payment', transaction_amount: 238.8, date_approved: agoIso(2 * 60000), ...extra });
  const webhook = (id, headers = {}) => fetch(`${FN_URL}/mercadoPagoWebhook?type=payment&data.id=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' }).then(async res => ({ status: res.status, text: await res.text() }));
  const league = async () => docData(await db.get('owner', 'leagues/la'));
  const records = async () => ((await db.list('owner', 'leagues/la/billing_payments')).json.documents || []).length;
  const setLeague = extra => db.set('owner', 'leagues/la', { name: 'Liga A', ownerId: U.admA.uid, plan: 'trial', ...extra });
  const planUntil = (plan, renewsAt, extra) => ({ subscriptionPlan: plan, subscriptionRenewsAt: renewsAt, subscriptionActiveUntil: new Date(Date.parse(renewsAt) + DAYMS).toISOString(), ...extra });

  mpState({});
  r = await callFn('createMonthlySubscription', U.admA.token, { liga: 'la' });
  check('liga sem plano: cria a assinatura mensal (link de pagamento, com a liga e o e-mail do admin)', r.status === 200 && /mp\.test\/preapproval/.test(r.result.initPoint) && mpGet().created.length === 1 && mpGet().created[0].external_reference === 'la' && mpGet().created[0].payer_email === U.admA.email, r.raw);
  r = await callFn('createAnnualPayment', U.admA.token, { liga: 'la' });
  check('liga sem plano: cria a cobrança anual com o título normal e o valor do plano', r.status === 200 && mpGet().preferences[0].items[0].title === 'Pelada na Mão — Assinatura anual' && mpGet().preferences[0].items[0].unit_price === 238.8, r.raw);

  const approved1 = agoIso(5 * 60000);
  mpState({ payments: [pay(7001, { date_approved: approved1 })] });
  let w = await webhook(7001);
  let L = await league();
  check('pagamento anual aprovado: a liga fica anual por 12 meses a partir da aprovação (+1 dia de tolerância)', w.status === 200 && L.subscriptionPlan === 'annual' && L.subscriptionRenewsAt === plus12(approved1) && L.subscriptionActiveUntil === new Date(Date.parse(plus12(approved1)) + DAYMS).toISOString(), { w, L });
  let rec = docData(await db.get('owner', 'leagues/la/billing_payments/7001'));
  check('…e o pagamento fica registrado (valor e datas de antes e depois)', !!rec && rec.paymentId === '7001' && rec.amount === 238.8 && rec.renewsAtBefore === null && rec.renewsAtAfter === plus12(approved1), rec);
  w = await webhook(7001);
  check('o mesmo aviso de novo não soma outra vez', w.status === 200 && (await league()).subscriptionRenewsAt === plus12(approved1) && (await records()) === 1);

  check('ninguém lê o registro de pagamentos direto (admin, jogador, quem é de fora, listagem) → recusado', no(await db.get(U.admA.token, 'leagues/la/billing_payments/7001')) && no(await db.get(U.pl1.token, 'leagues/la/billing_payments/7001')) && no(await db.get(U.outsider.token, 'leagues/la/billing_payments/7001')) && no(await db.list(U.admA.token, 'leagues/la/billing_payments')));
  check('ninguém grava, altera ou apaga o registro direto → recusado', no(await db.set(U.admA.token, 'leagues/la/billing_payments/7999', { paymentId: '7999' })) && no(await db.update(U.admA.token, 'leagues/la/billing_payments/7001', { amount: 1 })) && no(await db.del(U.admA.token, 'leagues/la/billing_payments/7001')) && no(await db.set(U.owner.token, 'leagues/la/billing_payments/7999', { paymentId: '7999' })));
  check('admin NÃO marca a assinatura como cancelada direto no banco → recusado', no(await db.update(U.admA.token, 'leagues/la', { subscriptionCancelledAt: NOW })));
  check('o registro continua intacto depois das tentativas', (await records()) === 1 && docData(await db.get('owner', 'leagues/la/billing_payments/7001')).amount === 238.8);

  // Com plano em vigor: nada de segunda mensal; o anual vira "Estender plano".
  mpState({ payments: [pay(7001, { date_approved: approved1 })] });
  r = await callFn('createMonthlySubscription', U.admA.token, { liga: 'la' });
  check('com plano em vigor: nova assinatura mensal é barrada (cobrança em dobro) e nada é criado no Mercado Pago', r.status === 400 && r.error.status === 'FAILED_PRECONDITION' && /Estender plano/.test(r.error.message) && mpGet().created.length === 0, r.raw);
  r = await callFn('createAnnualPayment', U.admA.token, { liga: 'la' });
  check('com plano em vigor: "Estender plano" cria a cobrança anual com título de extensão', r.status === 200 && mpGet().preferences[0].items[0].title === 'Pelada na Mão — Estender plano (+12 meses)' && mpGet().preferences[0].items[0].unit_price === 238.8, r.raw);

  // Estender: o pagamento novo soma 12 meses ao vencimento atual (consulta do app, que também devolve o plano).
  const approved2 = agoIso(3 * 60000);
  mpState({ payments: [pay(7001, { date_approved: approved1 }), pay(7002, { date_approved: approved2 })] });
  r = await callFn('checkSubscriptionStatus', U.admA.token, { liga: 'la' });
  check('estender: o pagamento novo soma 12 meses ao vencimento atual (24 meses no total)', r.status === 200 && r.result.status === 'active' && r.result.plan === 'annual' && r.result.renewsAt === plus12(plus12(approved1)) && (await league()).subscriptionRenewsAt === plus12(plus12(approved1)), { r: r.raw, L: await league() });
  check('estender: o pagamento antigo não foi somado de novo, só o novo (2 registros)', (await records()) === 2);
  r = await callFn('checkSubscriptionStatus', U.admA.token, { liga: 'la' });
  check('estender: consultar de novo não soma outra vez', r.status === 200 && r.result.renewsAt === plus12(plus12(approved1)) && (await records()) === 2, r.raw);
  r = await callFn('checkSubscriptionStatus', U.pl1.token, { liga: 'la' });
  check('jogador comum não consulta a assinatura', r.status === 403, r.raw);

  // Avisos simultâneos (o Mercado Pago repete notificações): a transação garante uma soma só.
  const base = (await league()).subscriptionRenewsAt;
  mpState({ payments: [pay(7003)] });
  const same = await Promise.all([webhook(7003), webhook(7003), webhook(7003)]);
  check('3 avisos simultâneos do mesmo pagamento: todos respondem 200 e somam uma vez só', same.every(x => x.status === 200) && (await league()).subscriptionRenewsAt === plus12(base) && (await records()) === 3, { same, L: await league() });
  const base2 = (await league()).subscriptionRenewsAt;
  mpState({ payments: [pay(7004), pay(7005)] });
  const two = await Promise.all([webhook(7004), webhook(7005)]);
  check('2 pagamentos diferentes ao mesmo tempo: somam os dois (24 meses), sem perder nenhum', two.every(x => x.status === 200) && (await league()).subscriptionRenewsAt === plus12(plus12(base2)) && (await records()) === 5, { two, L: await league() });

  // Quem pagava o mensal e estende: soma depois da próxima cobrança e a assinatura mensal é cancelada.
  const R = new Date(Date.now() + 10 * DAYMS).toISOString();
  await setLeague(planUntil('monthly', R));
  mpState({ preapprovals: [{ id: 'sub-m1', external_reference: 'la', status: 'authorized', next_payment_date: R }], payments: [pay(7010)] });
  w = await webhook(7010);
  L = await league();
  check('mensal que estende: vira anual com 12 meses somados à próxima cobrança', w.status === 200 && L.subscriptionPlan === 'annual' && L.subscriptionRenewsAt === plus12(R), { w, L });
  check('…e a assinatura mensal foi cancelada no Mercado Pago (não cobra em dobro)', JSON.stringify(mpGet().updates) === JSON.stringify([{ id: 'sub-m1', body: { status: 'cancelled' } }]) && mpGet().preapprovals[0].status === 'cancelled', mpGet());

  // Cancelar a assinatura mensal pelo app.
  const R2 = new Date(Date.now() + 15 * DAYMS).toISOString();
  await setLeague(planUntil('monthly', R2));
  mpState({ preapprovals: [{ id: 'sub-m2', external_reference: 'la', status: 'authorized', next_payment_date: R2 }, { id: 'sub-outra', external_reference: 'lb', status: 'authorized', next_payment_date: R2 }] });
  r = await callFn('cancelSubscription', null, { liga: 'la' });
  check('cancelar: sem login → não autenticado', r.status === 401, r.raw);
  r = await callFn('cancelSubscription', U.pl1.token, { liga: 'la' });
  check('cancelar: jogador não cancela', r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
  r = await callFn('cancelSubscription', U.admB.token, { liga: 'la' });
  check('cancelar: admin de OUTRA liga não cancela', r.status === 403, r.raw);
  r = await callFn('cancelSubscription', U.admA.token, { liga: '../x' });
  check('cancelar: liga com caracteres perigosos → argumento inválido', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);
  check('cancelar: nenhuma negativa cancelou algo nem marcou a liga', mpGet().updates.length === 0 && !('subscriptionCancelledAt' in (await league())));
  r = await callFn('cancelSubscription', U.admA.token, { liga: 'la' });
  check('cancelar: o admin cancela a assinatura mensal pelo app', r.status === 200 && r.result.ok === true && r.result.canceled === 1, r.raw);
  check('cancelar: só a assinatura da liga dele é cancelada no Mercado Pago (a de outra liga não)', JSON.stringify(mpGet().updates.map(u => u.id)) === JSON.stringify(['sub-m2']) && mpGet().preapprovals.find(p => p.id === 'sub-outra').status === 'authorized', mpGet());
  L = await league();
  check('cancelar: a liga é marcada como cancelada e segue com o plano até o fim do período pago', typeof L.subscriptionCancelledAt === 'string' && L.subscriptionPlan === 'monthly' && L.subscriptionRenewsAt === R2 && Date.parse(L.subscriptionActiveUntil) > Date.now(), L);
  const markedAt = L.subscriptionCancelledAt;
  r = await callFn('cancelSubscription', U.admA.token, { liga: 'la' });
  check('cancelar de novo: ok, nada mais a cancelar e a data da marca não muda', r.status === 200 && r.result.canceled === 0 && (await league()).subscriptionCancelledAt === markedAt && mpGet().updates.length === 1, r.raw);

  // Depois de cancelar, ainda dá para estender (a partir do vencimento) — e a marca de cancelada some.
  mpState({ payments: [pay(7011)] });
  w = await webhook(7011);
  L = await league();
  check('estender depois de cancelar: soma 12 meses ao vencimento e tira a marca de cancelada', w.status === 200 && L.subscriptionPlan === 'annual' && L.subscriptionRenewsAt === plus12(R2) && !('subscriptionCancelledAt' in L), L);

  // O que o webhook não aceita.
  const keep = (await league()).subscriptionRenewsAt;
  mpState({ payments: [pay(7012)] });
  w = await webhook(7012, { 'x-signature': 'ts=1,v1=errada', 'x-request-id': 'r1' });
  check('webhook com assinatura incorreta → 401 e não soma nada', w.status === 401 && (await league()).subscriptionRenewsAt === keep && !(await db.get('owner', 'leagues/la/billing_payments/7012')).json.fields);
  mpState({ payments: [pay(7013, { transaction_amount: 29.9 })] });
  w = await webhook(7013);
  check('webhook: cobrança mensal (R$ 29,90) não vira plano anual', w.status === 200 && (await league()).subscriptionRenewsAt === keep);
  mpState({ payments: [pay(7014, { status: 'rejected' })] });
  w = await webhook(7014);
  check('webhook: pagamento recusado não soma nada', w.status === 200 && (await league()).subscriptionRenewsAt === keep);
  mpState({ payments: [] });
  w = await webhook(9999);
  check('webhook: pagamento que o Mercado Pago não encontra → 500 (ele tenta de novo depois)', w.status === 500 && (await league()).subscriptionRenewsAt === keep);

  // ═════════════ MÉTRICAS DO FUNIL (painel só do dono + contadores anônimos) ═════════════
  console.log('── métricas do funil: regras do banco e funções');
  await seed();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // coleções novas, fechadas ao navegador: ninguém (nem o dono) lê ou grava direto
  await db.set('owner', `metrics_events/${day}`, { planBannerSeen: 1 });
  await db.set('owner', `metrics_daily/${day}`, { accounts: 1 });
  await db.set('owner', 'leagues/la/billing_meta/checkout', { starts: 1 });
  for (const tok of [U.admA.token, U.pl1.token, U.outsider.token, U.owner.token]) {
    check('ninguém lê os contadores de uso, o retrato diário nem a marca do checkout direto pelas regras → recusado',
      no(await db.get(tok, `metrics_events/${day}`)) && no(await db.get(tok, `metrics_daily/${day}`)) && no(await db.get(tok, 'leagues/la/billing_meta/checkout')));
  }
  check('ninguém grava nos contadores, no retrato diário nem na marca do checkout direto → recusado',
    no(await db.set(U.admA.token, `metrics_events/${day}`, { planBannerSeen: 999 })) && no(await db.set(U.owner.token, `metrics_daily/${day}`, { mrr: 1000000 })) && no(await db.set(U.admA.token, 'leagues/la/billing_meta/checkout', { starts: 0 })));
  check('os dados continuam intactos depois das tentativas', docData(await db.get('owner', `metrics_events/${day}`)).planBannerSeen === 1);
  await db.del('owner', `metrics_events/${day}`);
  await db.del('owner', `metrics_daily/${day}`);

  // trackEvent: contador anônimo
  r = await callFn('trackEvent', null, { name: 'planBannerSeen' });
  check('trackEvent sem login → não autenticado', r.status === 401, r.raw);
  r = await callFn('trackEvent', U.pl1.token, { name: 'planBannerSeen' });
  check('trackEvent com login → ok e soma 1 no contador do dia', r.status === 200 && r.result && r.result.ok === true && docData(await db.get('owner', `metrics_events/${day}`)).planBannerSeen === 1, r.raw);
  await callFn('trackEvent', U.pl2.token, { name: 'planBannerSeen' });
  const evDoc = docData(await db.get('owner', `metrics_events/${day}`));
  check('duas pessoas somam no mesmo contador, e o documento guarda só números (nada de quem foi)', evDoc.planBannerSeen === 2 && Object.values(evDoc).every(v => typeof v === 'number') && !JSON.stringify(evDoc).includes(U.pl1.uid), evDoc);
  r = await callFn('trackEvent', U.pl1.token, { name: 'checkoutMonthly' });
  check('o app não consegue inflar os eventos que só o servidor conta (checkout) → argumento inválido', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);
  r = await callFn('trackEvent', U.pl1.token, { name: 'qualquerCoisa' });
  check('evento desconhecido → argumento inválido', r.status === 400 && r.error.status === 'INVALID_ARGUMENT', r.raw);

  // getFunnelMetrics: só o dono (e-mail verificado)
  r = await callFn('getFunnelMetrics', null, {});
  check('painel do dono sem login → não autenticado', r.status === 401, r.raw);
  for (const [quem, tok] of [['jogador', U.pl1.token], ['admin de liga', U.admA.token], ['quem é de fora', U.outsider.token]]) {
    r = await callFn('getFunnelMetrics', tok, {});
    check(`painel do dono: ${quem} → permissão negada`, r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
  }
  r = await callFn('getFunnelMetrics', U.owner.token, {});
  const mm = r.result;
  check('painel do dono: o dono (e-mail verificado) recebe o funil, os eventos e o histórico', r.status === 200 && mm && mm.funnel && mm.events && Array.isArray(mm.history), r.raw);
  check('…com as ligas do banco de teste (contagem agregada de campeonatos incluída) e as contas', mm.funnel.leagues.total >= 2 && mm.funnel.accounts.total >= 5 && mm.funnel.leagues.withGame >= 1, mm.funnel);
  check('…e o contador de hoje (2 vezes a faixa do plano vista)', mm.events.last7d.planBannerSeen === 2 && mm.events.last30d.planBannerSeen === 2, mm.events);
  check('…sem nenhum dado pessoal (e-mails, nomes de pessoas, ids de conta)', !/@teste\.invalid|castanho|Pl Um|Adm A/.test(JSON.stringify(mm)) && !JSON.stringify(mm).includes(U.pl1.uid), JSON.stringify(mm).slice(0, 200));

  // o checkout cria a marca na liga e o contador
  await db.update('owner', 'leagues/la', { trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString() });
  mpState({});
  r = await callFn('createMonthlySubscription', U.admA.token, { liga: 'la' });
  const checkoutMark = docData(await db.get('owner', 'leagues/la/billing_meta/checkout'));
  const evDoc2 = docData(await db.get('owner', `metrics_events/${day}`));
  check('criar o checkout mensal: devolve o link, soma no contador do dia e marca a liga (subcoleção fechada)', r.status === 200 && !!(r.result && r.result.initPoint) && evDoc2.checkoutMonthly === 1 && checkoutMark.starts === 2, { r: r.raw, evDoc2, checkoutMark });
  check('…e o documento da liga que os membros leem não ganhou nenhum campo novo', !('checkoutStarts' in docData(await db.get('owner', 'leagues/la'))) && !('lastCheckoutAt' in docData(await db.get('owner', 'leagues/la'))));


  // ═════════════ RECUPERAR OS CAMPEONATOS FEITOS NO PLANO GRATUITO ═════════════
  console.log('── recuperar os campeonatos feitos no plano gratuito (Firestore e funções de verdade)');
  await seed();
  {
    const past = d => new Date(Date.now() - d * 86400000).toISOString(), future = d => new Date(Date.now() + d * 86400000).toISOString();
    const freeChamp = (date, extra) => ({ date, status: 'completed', champion: 'azul', freeMode: true, teams: ['azul', 'verde'], format: 2, matches: [], champion_players: [{ name: 'Ana', weight: 1 }, { name: 'Beto Silva', weight: 0.5 }], ...extra });
    const S = (p, d) => db.set('owner', p, d);
    // os campeonatos entram ANTES de os usuários terem a liga (como em seed): assim os gatilhos de aviso não tentam notificar ninguém
    await S('leagues/lr', { name: 'Liga R', ownerId: U.admA.uid, trialEndsAt: past(20) }); // teste acabou, sem plano
    await S('leagues/lr/championships/c1', freeChamp('2026-09-03'));
    await S('leagues/lr/championships/c2', freeChamp('2026-09-10', { champion: 'verde', champion_players: [{ name: ' Ana ', weight: 1 }, { name: 'Caio', weight: 1 }] }));
    await S('leagues/lr/championships/c3', { date: '2026-09-17', status: 'active', freeMode: true, teams: ['azul', 'verde'], format: 2, matches: [] });
    await S('leagues/lr/championships/n1', freeChamp('2026-08-01', { freeMode: false, champion: 'amarelo' }));
    await S('leagues/lr/player_titles/ana', { name: 'Ana', titles: 2, last_date: '2026-08-01', entries: [{ date: '2026-07-01', weight: 1, team: 'azul', champId: 'x1' }, { date: '2026-08-01', weight: 1, team: 'azul', champId: 'x2' }] });
    await S('leagues/ls', { name: 'Liga S', ownerId: U.admB.uid, trialEndsAt: past(20), subscriptionActiveUntil: future(30) });
    await S('leagues/ls/championships/o1', freeChamp('2026-09-03'));
    for (const lg of ['lp', 'lq']) {
      await S('leagues/' + lg, { name: 'Liga ' + lg, ownerId: U.admA.uid, trialEndsAt: past(20) });
      for (let i = 1; i <= 6; i++) await S(`leagues/${lg}/championships/c${i}`, freeChamp(`2026-09-0${i}`));
    }
    await sleep(2000);
    for (const lg of ['lr', 'lp', 'lq']) await db.update('owner', 'users/' + U.admA.uid, { ['leagues.' + lg]: { role: 'admin', joinedAt: NOW } });
    await db.update('owner', 'users/' + U.pl1.uid, { 'leagues.lr': { role: 'player', joinedAt: NOW } });

    const ch = async (lg, id) => docData(await db.get('owner', `leagues/${lg}/championships/${id}`));
    const ti = async (lg, k) => docData(await db.get('owner', `leagues/${lg}/player_titles/${k}`));

    let r = await callFn('recoverFreeChampionships', null, { liga: 'lr' });
    check('recuperar: sem login → não autenticado', r.status === 401, r.raw);
    for (const [quem, tok] of [['jogador comum', U.pl1.token], ['admin de outra liga', U.admB.token], ['quem é de fora', U.outsider.token]]) {
      r = await callFn('recoverFreeChampionships', tok, { liga: 'lr' });
      check(`recuperar: ${quem} → permissão negada`, r.status === 403 && r.error.status === 'PERMISSION_DENIED', r.raw);
    }
    r = await callFn('recoverFreeChampionships', U.admA.token, { liga: 'lr' });
    check('recuperar: admin, mas a liga está no plano gratuito (teste acabou, sem assinatura) → pré-condição falhou e nada muda', r.status === 400 && r.error.status === 'FAILED_PRECONDITION' && /Assine um plano/.test(r.error.message) && (await ch('lr', 'c1')).freeMode === true && !(await ti('lr', 'beto_silva')), r.raw);

    await db.update('owner', 'leagues/lr', { subscriptionPlan: 'annual', subscriptionRenewsAt: future(300), subscriptionActiveUntil: future(301) });
    r = await callFn('recoverFreeChampionships', U.admA.token, { liga: 'lr' });
    check('recuperar: com plano em vigor, o admin recupera os 3 campeonatos do plano gratuito (2 concluídos e 1 em andamento)', r.status === 200 && r.result && r.result.ok === true && r.result.recovered === 3 && r.result.remaining === 0, r.raw);
    const [c1, c2, c3, n1] = [await ch('lr', 'c1'), await ch('lr', 'c2'), await ch('lr', 'c3'), await ch('lr', 'n1')];
    check('…cada um perde o freeMode e ganha recoveredFromFree e recoveredAt; o campeonato normal não é tocado', [c1, c2, c3].every(c => c.freeMode === false && c.recoveredFromFree === true && /^\d{4}-\d\d-\d\dT/.test(c.recoveredAt)) && n1.recoveredFromFree === undefined && n1.champion === 'amarelo', { c1, n1 });
    const [ana, beto, caio] = [await ti('lr', 'ana'), await ti('lr', 'beto_silva'), await ti('lr', 'caio')];
    check('…ranking: Ana de 2 para 4 títulos (c1 e c2), Beto Silva 0,5 (meio título), Caio 1; cada entrada leva o id do campeonato; last_date é o do mais novo', ana.titles === 4 && ana.entries.length === 4 && ana.last_date === '2026-09-10' && beto.titles === 0.5 && beto.entries[0].weight === 0.5 && caio.titles === 1 && ana.entries.slice(2).map(e => e.champId).join() === 'c1,c2' && beto.name === 'Beto Silva', { ana, beto, caio });
    check('…a liga vizinha (de outro admin) continua intacta', (await ch('ls', 'o1')).freeMode === true && !(await ti('ls', 'ana')));
    r = await callFn('recoverFreeChampionships', U.admA.token, { liga: 'lr' });
    check('…chamar de novo não muda nada (recuperados: 0; Ana continua com 4)', r.status === 200 && r.result.recovered === 0 && (await ti('lr', 'ana')).titles === 4);
    check('depois de recuperado, o campeonato aceita dados de gol (o gatilho do plano gratuito deixa de apagá-los)', okW(await db.update('owner', 'leagues/lr/championships/c1', { matches: [{ id: 'm1', played: true, home: 'azul', away: 'verde', hs: 2, as: 1, goals: [{ player: 'Ana' }] }] })) && await (async () => { await sleep(1500); const m = (await ch('lr', 'c1')).matches; return m && m[0] && Array.isArray(m[0].goals) && m[0].goals.length === 1; })());

    // três pedidos ao mesmo tempo, com transações de verdade: ninguém soma em dobro
    await db.update('owner', 'leagues/lp', { subscriptionPlan: 'annual', subscriptionRenewsAt: future(300), subscriptionActiveUntil: future(301) });
    const par = await Promise.all([1, 2, 3].map(() => callFn('recoverFreeChampionships', U.admA.token, { liga: 'lp' })));
    const rec = par.reduce((s, x) => s + ((x.result && x.result.recovered) || 0), 0);
    const anaP = await ti('lp', 'ana'), betoP = await ti('lp', 'beto_silva');
    check('3 pedidos de recuperação ao mesmo tempo: cada campeonato é recuperado uma vez só e o título não dobra (Ana 6 títulos com 6 entradas; Beto Silva 3)', par.every(x => x.status === 200) && rec === 6 && anaP.titles === 6 && anaP.entries.length === 6 && betoP.titles === 3 && betoP.entries.length === 6, { statuses: par.map(x => x.status), rec, anaP, betoP });

    // ao pagar: a recuperação acontece sozinha, junto com a ativação do plano
    mpState({ payments: [{ id: 9001, external_reference: 'lq', status: 'approved', operation_type: 'regular_payment', transaction_amount: 238.8, date_approved: new Date(Date.now() - 120000).toISOString() }] });
    r = await callFn('checkSubscriptionStatus', U.admA.token, { liga: 'lq' });
    const lq = docData(await db.get('owner', 'leagues/lq'));
    const todos = [];
    for (let i = 1; i <= 6; i++) todos.push((await ch('lq', 'c' + i)).freeMode);
    const anaQ = await ti('lq', 'ana');
    check('pagamento anual aprovado numa liga com campeonatos do plano gratuito: o plano é ativado E os 6 campeonatos voltam a contar, sem ninguém tocar em nada (Ana com 6 títulos)', r.status === 200 && r.result.status === 'active' && lq.subscriptionPlan === 'annual' && todos.every(f => f === false) && anaQ && anaQ.titles === 6 && anaQ.entries.length === 6, { r: r.raw, todos, anaQ });
    r = await callFn('checkSubscriptionStatus', U.admA.token, { liga: 'lq' });
    check('…consultar de novo o mesmo pagamento não soma título em dobro', r.status === 200 && (await ti('lq', 'ana')).titles === 6);
  }

  console.log(`\n${passes} verificações ok, ${fails} falha(s)`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
