const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória ───────────────────────────────────────────────
const store = new Map();                       // path -> objeto
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const DELETE = { __delete: true };
const FieldValue = { delete: () => DELETE, arrayRemove: t => ({ __arrayRemove: t }), increment: n => ({ __increment: n }) };

function applyUpdate(data, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') args = Object.entries(args[0]).flat();  // update(objeto)
  if (args.length % 2) throw new Error('update() precisa de pares campo/valor');
  const out = clone(data);
  for (let i = 0; i < args.length; i += 2) {
    const field = args[i], value = args[i + 1];
    if (!(field instanceof FieldPath) && typeof field !== 'string') throw new Error('campo inválido: ' + typeof field);
    const segs = field instanceof FieldPath ? field.segments : field.split('.');
    let cur = out;
    for (const s of segs.slice(0, -1)) {
      if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {};
      cur = cur[s];
    }
    const last = segs[segs.length - 1];
    if (value === DELETE) delete cur[last];
    else if (value && typeof value === 'object' && value.__increment !== undefined) cur[last] = (cur[last] || 0) + value.__increment;
    else cur[last] = clone(value);
  }
  return out;
}

const snapOf = (p) => {
  const has = store.has(p);
  return { id: p.split('/').pop(), exists: has, data: () => (has ? clone(store.get(p)) : undefined), ref: refOf(p) };
};
function refOf(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async d => { store.set(p, clone(d)); },
    update: async (...args) => {
      if (!store.has(p)) throw new Error('NOT_FOUND ' + p);
      store.set(p, applyUpdate(store.get(p), args));
    },
    delete: async () => { store.delete(p); },
  };
}
let failCommitsFrom = Infinity;   // nº do commit (1, 2, …) a partir do qual batch.commit() falha
let commitCount = 0;
const fakeDb = {
  doc: p => refOf(p),
  recursiveDelete: async ref => { for (const k of [...store.keys()]) if (k === ref.path || k.startsWith(ref.path + '/')) store.delete(k); },
  batch: () => {
    const ops = [];
    return {
      set: (ref, d) => { ops.push(() => ref.set(d)); },
      update: (ref, ...args) => { ops.push(() => ref.update(...args)); },
      delete: ref => { ops.push(() => ref.delete()); },
      commit: async () => {
        commitCount++;
        if (commitCount >= failCommitsFrom) throw new Error('falha simulada no commit');
        for (const op of ops) await op();
      },
    };
  },
  collection: name => {
    const inCol = p => new RegExp('^' + name + '/[^/]+$').test(p);
    const valueAt = (obj, field) => (field instanceof FieldPath ? field.segments : String(field).split('.'))
      .reduce((o, s) => (o == null ? undefined : o[s]), obj);
    const build = (filters, lim) => ({
      where: (f, op, v) => build([...filters, [f, op, v]], lim),
      limit: n => build(filters, n),
      select: () => build(filters, lim),
      get: async () => {
        let docs = [...store.entries()]
          .filter(([p, d]) => inCol(p) && filters.every(([f, op, v]) =>
            op === '==' ? valueAt(d, f) === v : op === 'in' ? Array.isArray(v) && v.includes(valueAt(d, f)) : false))
          .map(([p]) => snapOf(p));
        if (lim != null) docs = docs.slice(0, lim);
        return { size: docs.length, docs, forEach: fn => docs.forEach(fn) };
      },
    });
    return build([], null);
  },
  runTransaction: async fn => {
    const writes = [];
    let wrote = false;
    const tx = {
      get: async target => {
        if (wrote) throw new Error('leituras devem vir antes das escritas');
        return target.path !== undefined ? snapOf(target.path) : await target.get(); // doc ref OU query
      },
      set: (ref, d) => { wrote = true; writes.push(() => ref.set(d)); },
      update: (ref, ...args) => {
        wrote = true;
        writes.push(async () => {
          if (!store.has(ref.path)) throw new Error('NOT_FOUND ' + ref.path);
          store.set(ref.path, applyUpdate(store.get(ref.path), args));
        });
      },
      delete: ref => { wrote = true; writes.push(() => ref.delete()); },
    };
    const result = await fn(tx);
    for (const w of writes) await w();
    return result;
  },
};

class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const authDeleted = [];
let authDeleteError = null;   // código de erro simulado ao apagar o login
const callableOpts = [];
const logs = [];
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({}),
  auth: () => ({ deleteUser: async uid => {
    if (authDeleteError) { const e = new Error('erro simulado'); e.code = authDeleteError; throw e; }
    authDeleted.push(uid);
  } }),
};

// Mínimo para o módulo carregar: nenhum teste deste arquivo exercita o fluxo de pagamento
// (ver test/payments-test.js para isso), então os métodos nunca são chamados de verdade.
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
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => '' }) }; // sem chave do Cloudinary nestes testes
  return origLoad.call(this, request, ...rest);
};
const fns = require(path);
Module._load = origLoad;

// ── utilidades de teste ──────────────────────────────────────────────────────
let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const call = (fn, data, auth) => fn({ data, auth });
const authOf = (uid, extra = {}) => ({ uid, token: { email: uid + '@x.com', name: uid.toUpperCase(), email_verified: false, auth_time: Math.floor(Date.now() / 1000), ...extra } });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const user = uid => store.get('users/' + uid);
const reset = () => {
  store.clear();
  store.set('users/ana', { email: 'ana@x.com', role: 'pending', leagues: { L: { role: 'player', playerKey: 'ana' } } });
  store.set('users/adm', { email: 'adm@x.com', role: 'pending', leagues: { L: { role: 'admin' } } });
  store.set('users/admB', { email: 'admB@x.com', role: 'pending', leagues: { B: { role: 'admin' } } });
  store.set('users/nova', { email: 'nova@x.com', role: 'pending', leagues: {} });
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { L: { role: 'pending' } } });
  store.set('users/dono', { email: 'dono@x.com', role: 'pending', leagues: { L: { role: 'admin' } } });
  store.set('leagues/L', { name: 'Liga L', ownerId: 'dono' });
  store.set('leagues/B', { name: 'Liga B', ownerId: 'admB' });
  store.set('leagues/L/invite_tokens/tok123456', { role: 'player', used: false, createdBy: 'adm' });
  store.set('leagues/L/invite_tokens/usado0001', { role: 'player', used: true });
  store.set('leagues/L/invite_tokens/adminTok01', { role: 'admin', used: false });
  store.set('leagues/L/invite_tokens/weirdTok01', { role: 'superadmin', used: false });
  store.set('leagues/L/link_requests/nova', { uid: 'nova', status: 'pending' });
};

(async () => {
  // opções das funções
  check('todas as callables ficam em us-east1 com limite de instâncias', callableOpts.length === 14 && callableOpts.every(o => o.region === 'us-east1' && o.maxInstances > 0), callableOpts);

  // ───────── joinLeague ─────────
  reset();
  check('join: sem login', await codeOf(call(fns.joinLeague, { liga: 'L', token: 'tok123456' })) === 'unauthenticated');
  check('join: liga inválida (path traversal)', await codeOf(call(fns.joinLeague, { liga: '../x', token: 'tok123456' }, authOf('nova'))) === 'invalid-argument');
  check('join: liga vazia', await codeOf(call(fns.joinLeague, { liga: '', token: 'tok123456' }, authOf('nova'))) === 'invalid-argument');
  check('join: token com barra', await codeOf(call(fns.joinLeague, { liga: 'L', token: 'a/b/c/d/e/f' }, authOf('nova'))) === 'invalid-argument');
  check('join: token curto', await codeOf(call(fns.joinLeague, { liga: 'L', token: 'x' }, authOf('nova'))) === 'invalid-argument');
  check('join: dados nulos', await codeOf(call(fns.joinLeague, null, authOf('nova'))) === 'invalid-argument');
  check('join: liga longa demais é recusada (não é cortada)', await codeOf(call(fns.joinLeague, { liga: 'L'.repeat(61), token: 'tok123456' }, authOf('nova'))) === 'invalid-argument');
  check('join: convite longo demais é recusado (não é cortado)', await codeOf(call(fns.joinLeague, { liga: 'L', token: 't'.repeat(101) }, authOf('nova'))) === 'invalid-argument');
  check('join: liga com tipo errado', await codeOf(call(fns.joinLeague, { liga: { $ne: 1 }, token: 'tok123456' }, authOf('nova'))) === 'invalid-argument');
  check('join: convite com tipo errado', await codeOf(call(fns.joinLeague, { liga: 'L', token: ['tok123456'] }, authOf('nova'))) === 'invalid-argument');

  let r = await call(fns.joinLeague, { liga: 'L', token: 'tok123456' }, authOf('nova'));
  check('join: convite válido devolve o papel', r.role === 'player', r);
  check('join: grava a entrada na liga', user('nova').leagues.L.role === 'player' && !!user('nova').leagues.L.joinedAt, user('nova'));
  check('join: consome o convite', store.get('leagues/L/invite_tokens/tok123456').used === true && store.get('leagues/L/invite_tokens/tok123456').usedBy === 'nova', store.get('leagues/L/invite_tokens/tok123456'));
  check('join: não mexe no papel do topo', user('nova').role === 'pending', user('nova'));

  reset();
  await call(fns.joinLeague, { liga: 'L', token: 'tok123456' }, authOf('nova'));
  check('join: convite já usado por outro', await codeOf(call(fns.joinLeague, { liga: 'L', token: 'tok123456' }, authOf('admB'))) === 'failed-precondition');
  check('join: convite marcado como usado desde o início', await codeOf(call(fns.joinLeague, { liga: 'L', token: 'usado0001' }, authOf('admB'))) === 'failed-precondition');
  check('join: usuário rejeitado no convite usado não ganhou liga', !user('admB').leagues.L, user('admB'));
  check('join: convite inexistente', await codeOf(call(fns.joinLeague, { liga: 'L', token: 'naoexiste1' }, authOf('admB'))) === 'failed-precondition');
  check('join: convite de outra liga não vale', await codeOf(call(fns.joinLeague, { liga: 'B', token: 'tok123456' }, authOf('nova'))) === 'failed-precondition');

  reset();
  r = await call(fns.joinLeague, { liga: 'L', token: 'tok123456' }, authOf('ana'));
  check('join: quem já participa recebe o papel atual', r.role === 'player', r);
  check('join: convite NÃO é gasto por quem já participa', store.get('leagues/L/invite_tokens/tok123456').used === false, store.get('leagues/L/invite_tokens/tok123456'));

  reset();
  r = await call(fns.joinLeague, { liga: 'L', token: 'tok123456' }, authOf('brandnew', { name: 'Zé' }));
  check('join: usuário sem documento é criado', !!user('brandnew') && user('brandnew').role === 'pending' && user('brandnew').leagues.L.role === 'player' && user('brandnew').displayName === 'Zé' && user('brandnew').email === 'brandnew@x.com', user('brandnew'));

  reset();
  r = await call(fns.joinLeague, { liga: 'L', token: 'adminTok01' }, authOf('brandnew2'));
  check('join: convite de admin dá admin só na liga, nunca no topo', r.role === 'admin' && user('brandnew2').leagues.L.role === 'admin' && user('brandnew2').role === 'pending', user('brandnew2'));
  reset();
  r = await call(fns.joinLeague, { liga: 'L', token: 'weirdTok01' }, authOf('nova'));
  check('join: papel desconhecido no convite vira player', r.role === 'player' && user('nova').leagues.L.role === 'player', user('nova'));

  // ───────── createLeague ─────────
  reset();
  check('create: sem login', await codeOf(call(fns.createLeague, { name: 'X', slug: 'novaliga' })) === 'unauthenticated');
  check('create: nome vazio', await codeOf(call(fns.createLeague, { name: '  ', slug: 'novaliga' }, authOf('nova'))) === 'invalid-argument');
  for (const bad of ['NovaLiga', 'a', 'com espaco', 'a/b', '../x', 'x'.repeat(51), 'acentuação', 'under_score', '']) {
    check(`create: slug inválido "${bad.slice(0, 12)}"`, await codeOf(call(fns.createLeague, { name: 'X', slug: bad }, authOf('nova'))) === 'invalid-argument');
  }
  check('create: nada foi gravado nos casos inválidos', !store.has('leagues/novaliga') && Object.keys(user('nova').leagues).length === 0);

  r = await call(fns.createLeague, { name: '  Minha Liga  ', slug: 'minha-liga' }, authOf('nova'));
  const lg = store.get('leagues/minha-liga');
  check('create: devolve o slug', r.slug === 'minha-liga', r);
  check('create: documento da liga', lg && lg.name === 'Minha Liga' && lg.slug === 'minha-liga' && lg.ownerId === 'nova' && lg.plan === 'trial' && JSON.stringify(lg.settings) === '{}', lg);
  const days = (new Date(lg.trialEndsAt) - Date.now()) / 86400000;
  check('create: teste grátis de 8 dias', days > 7.9 && days < 8.1, days);
  check('create: criador vira admin', user('nova').leagues['minha-liga'].role === 'admin', user('nova'));
  check('create: id repetido', await codeOf(call(fns.createLeague, { name: 'Outra', slug: 'minha-liga' }, authOf('ana'))) === 'already-exists');
  check('create: id repetido não troca o dono', store.get('leagues/minha-liga').ownerId === 'nova' && !user('ana').leagues['minha-liga']);

  reset();
  r = await call(fns.createLeague, { name: 'Primeira', slug: 'primeira' }, authOf('semdoc'));
  check('create: usuário sem documento é criado como admin da liga', user('semdoc').leagues.primeira.role === 'admin' && user('semdoc').role === 'pending', user('semdoc'));

  reset();
  for (let i = 0; i < 10; i++) store.set('leagues/cap' + i, { ownerId: 'ana' });
  check('create: limite de 10 ligas por pessoa', await codeOf(call(fns.createLeague, { name: 'Onze', slug: 'onze' }, authOf('ana'))) === 'resource-exhausted');
  check('create: liga do limite não foi criada', !store.has('leagues/onze'));
  check('create: dono do sistema (e-mail verificado) não tem limite', await codeOf(call(fns.createLeague, { name: 'Onze', slug: 'onze' }, authOf('ana', { email: 'castanho.caiop@gmail.com', email_verified: true }))) === 'ok');
  reset();
  for (let i = 0; i < 10; i++) store.set('leagues/cap' + i, { ownerId: 'ana' });
  check('create: mesmo e-mail do dono SEM verificação continua limitado', await codeOf(call(fns.createLeague, { name: 'Onze', slug: 'onze' }, authOf('ana', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'resource-exhausted');

  // ───────── leaveLeague ─────────
  reset();
  store.set('users/ana', { email: 'ana@x.com', role: 'pending', leagues: { L: { role: 'player', playerKey: 'ana', earnedBadges: ['a'] }, B: { role: 'player' } } });
  check('leave: sem login', await codeOf(call(fns.leaveLeague, { liga: 'L' })) === 'unauthenticated');
  check('leave: liga inválida', await codeOf(call(fns.leaveLeague, { liga: 'a/b' }, authOf('ana'))) === 'invalid-argument');
  await call(fns.leaveLeague, { liga: 'L' }, authOf('ana'));
  check('leave: remove só a liga pedida', !user('ana').leagues.L && user('ana').leagues.B.role === 'player', user('ana'));
  check('leave: repetir não dá erro', (await call(fns.leaveLeague, { liga: 'L' }, authOf('ana'))).ok === true);
  check('leave: sem documento não dá erro', (await call(fns.leaveLeague, { liga: 'L' }, authOf('fantasma'))).ok === true && !store.has('users/fantasma'));
  check('leave: não mexe em outro usuário', user('adm').leagues.L.role === 'admin');

  // o único admin não sai (a liga ficaria sem ninguém); com outro admin, sai e o criador passa adiante
  reset();
  let lx = await call(fns.leaveLeague, { liga: 'B' }, authOf('admB')).catch(x => x);
  check('leave: único admin → bloqueado, dizendo qual liga e o que fazer', lx.code === 'failed-precondition' && lx.details && lx.details.reason === 'last-admin' && lx.details.ligas[0] === 'Liga B' && /Liga B/.test(lx.message) && /encerre a liga/.test(lx.message), lx);
  check('leave: bloqueado não muda nada', user('admB').leagues.B.role === 'admin' && store.get('leagues/B').ownerId === 'admB');
  store.set('users/ana', { ...user('ana'), leagues: { L: { role: 'player', playerKey: 'ana' }, B: { role: 'player' } } });
  check('leave: jogador de uma liga que só tem um admin sai normalmente', (await call(fns.leaveLeague, { liga: 'B' }, authOf('ana'))).ok === true && !user('ana').leagues.B);
  reset();
  check('leave: admin que NÃO é o criador sai e o criador continua o mesmo', (await call(fns.leaveLeague, { liga: 'L' }, authOf('adm'))).ok === true && !user('adm').leagues.L && store.get('leagues/L').ownerId === 'dono', store.get('leagues/L'));
  reset();
  check('leave: admin que é o criador sai e a liga passa para o outro admin', (await call(fns.leaveLeague, { liga: 'L' }, authOf('dono'))).ok === true && !user('dono').leagues.L && store.get('leagues/L').ownerId === 'adm', store.get('leagues/L'));
  reset();
  store.set('users/adm', { ...user('adm'), leagues: { L: { role: 'admin', joinedAt: '2026-05-01' } } });
  store.set('users/dono', { ...user('dono'), leagues: { L: { role: 'admin', joinedAt: '2026-01-01' } } });
  store.set('users/terceiro', { email: 't@x.com', role: 'pending', leagues: { L: { role: 'admin', joinedAt: '2026-03-01' } } });
  await call(fns.leaveLeague, { liga: 'L' }, authOf('dono'));
  check('leave: o criador que sai passa a liga para o admin MAIS ANTIGO que fica', store.get('leagues/L').ownerId === 'terceiro', store.get('leagues/L'));
  reset();
  store.set('users/pend', { ...user('pend'), leagues: { L: { role: 'pending' } } });
  check('leave: pendente e rejeitado saem sem a regra de admin', (await call(fns.leaveLeague, { liga: 'L' }, authOf('pend'))).ok === true && !user('pend').leagues.L);
  store.set('users/resto', { email: 'resto@x.com', role: 'pending', leagues: { Gone: { role: 'admin' } } });
  check('leave: admin de uma liga que já não existe (vínculo que sobrou) consegue sair', (await call(fns.leaveLeague, { liga: 'Gone' }, authOf('resto'))).ok === true && !user('resto').leagues.Gone, user('resto'));

  // ───────── manageMember ─────────
  reset();
  const mm = (data, auth) => call(fns.manageMember, data, auth);
  check('manage: sem login', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'approve' })) === 'unauthenticated');
  check('manage: jogador comum não pode', await codeOf(mm({ liga: 'L', uid: 'ana', action: 'promote' }, authOf('ana'))) === 'permission-denied');
  check('manage: jogador não se promove', user('ana').leagues.L.role === 'player', user('ana'));
  check('manage: pendente não pode', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'approve' }, authOf('pend'))) === 'permission-denied');
  check('manage: admin de OUTRA liga não pode', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'approve' }, authOf('admB'))) === 'permission-denied');
  check('manage: usuário sem documento não pode', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'approve' }, authOf('fantasma'))) === 'permission-denied');
  check('manage: e-mail do dono SEM verificação não vale', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'approve' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'permission-denied');
  check('manage: nada mudou nas negativas', user('pend').leagues.L.role === 'pending', user('pend'));
  check('manage: liga inválida', await codeOf(mm({ liga: 'a/b', uid: 'pend', action: 'approve' }, authOf('adm'))) === 'invalid-argument');
  check('manage: uid vazio', await codeOf(mm({ liga: 'L', uid: '', action: 'approve' }, authOf('adm'))) === 'invalid-argument');
  check('manage: uid longo demais é recusado', await codeOf(mm({ liga: 'L', uid: 'u'.repeat(129), action: 'approve' }, authOf('adm'))) === 'invalid-argument');
  check('manage: uid com tipo errado', await codeOf(mm({ liga: 'L', uid: { a: 1 }, action: 'approve' }, authOf('adm'))) === 'invalid-argument');
  check('manage: uid com barra', await codeOf(mm({ liga: 'L', uid: 'users/x', action: 'approve' }, authOf('adm'))) === 'invalid-argument');
  check('manage: jogador inválido', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'approve', playerKey: 'A B/../' }, authOf('adm'))) === 'invalid-argument');
  for (const bad of ['a/b', 'a b', 'a.b', '..', '../x', 'x'.repeat(101), 'a"b', "a'b"]) {
    check(`manage: jogador inválido "${bad.slice(0, 12)}"`, await codeOf(mm({ liga: 'L', uid: 'pend', action: 'link', playerKey: bad }, authOf('adm'))) === 'invalid-argument');
  }
  check('manage: ids de jogador antigos (acento, hífen, maiúscula) são aceitos', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'link', playerKey: 'João-Silva_2' }, authOf('adm'))) === 'ok' && user('pend').leagues.L.playerKey === 'João-Silva_2', user('pend'));
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { L: { role: 'pending' } } });
  check('manage: usuário inexistente', await codeOf(mm({ liga: 'L', uid: 'ninguem', action: 'approve' }, authOf('adm'))) === 'not-found');
  check('manage: ação desconhecida', await codeOf(mm({ liga: 'L', uid: 'pend', action: 'delete' }, authOf('adm'))) === 'invalid-argument');
  check('manage: ação vazia', await codeOf(mm({ liga: 'L', uid: 'pend' }, authOf('adm'))) === 'invalid-argument');

  await mm({ liga: 'L', uid: 'pend', action: 'approve', playerKey: 'joao_silva' }, authOf('adm'));
  check('approve: papel player + vínculo (topo e liga)', user('pend').leagues.L.role === 'player' && user('pend').leagues.L.playerKey === 'joao_silva' && user('pend').playerKey === 'joao_silva', user('pend'));
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { L: { role: 'pending' } } });
  await mm({ liga: 'L', uid: 'pend', action: 'approve' }, authOf('adm'));
  check('approve: sem jogador só muda o papel', user('pend').leagues.L.role === 'player' && !('playerKey' in user('pend').leagues.L) && !('playerKey' in user('pend')), user('pend'));

  await mm({ liga: 'L', uid: 'ana', action: 'reject' }, authOf('adm'));
  check('reject: papel rejected', user('ana').leagues.L.role === 'rejected' && user('ana').leagues.L.playerKey === 'ana', user('ana'));
  check('reject: criador da liga é protegido', await codeOf(mm({ liga: 'L', uid: 'dono', action: 'reject' }, authOf('adm'))) === 'failed-precondition');
  check('reject: criador continua admin', user('dono').leagues.L.role === 'admin');

  await mm({ liga: 'L', uid: 'nova', action: 'promote' }, authOf('adm'));
  check('promote: vira admin só nessa liga', user('nova').leagues.L.role === 'admin' && user('nova').role === 'pending', user('nova'));

  store.set('users/ana', { email: 'ana@x.com', role: 'pending', leagues: { L: { role: 'player', playerKey: 'ana' }, B: { role: 'player', playerKey: 'bbb' } } });
  await mm({ liga: 'L', uid: 'ana', action: 'link', playerKey: 'ana_maria' }, authOf('adm'));
  check('link: define o jogador (topo e liga)', user('ana').playerKey === 'ana_maria' && user('ana').leagues.L.playerKey === 'ana_maria', user('ana'));
  check('link: não mexe nas outras ligas', user('ana').leagues.B.playerKey === 'bbb' && user('ana').leagues.B.role === 'player', user('ana'));
  await mm({ liga: 'L', uid: 'ana', action: 'link', playerKey: '' }, authOf('adm'));
  check('link: vazio remove o vínculo', !('playerKey' in user('ana')) && !('playerKey' in user('ana').leagues.L) && user('ana').leagues.L.role === 'player', user('ana'));

  store.set('users/nova', { email: 'nova@x.com', role: 'pending', leagues: {}, linkRequestSent: true });
  await mm({ liga: 'L', uid: 'nova', action: 'linkRequest', approve: true, playerKey: 'nova_jogador' }, authOf('adm'));
  check('linkRequest aprovado: vincula e limpa o aviso', user('nova').playerKey === 'nova_jogador' && user('nova').leagues.L.playerKey === 'nova_jogador' && user('nova').linkRequestSent === false, user('nova'));
  check('linkRequest aprovado: apaga o pedido', !store.has('leagues/L/link_requests/nova'));
  check('linkRequest aprovado sem whatsapp: não cria contato', !store.has('leagues/L/contacts/nova_jogador'));

  store.set('users/nova', { email: 'nova@x.com', role: 'pending', leagues: {}, linkRequestSent: true });
  store.set('leagues/L/link_requests/nova', { uid: 'nova', whatsapp: '11999998888' });
  await mm({ liga: 'L', uid: 'nova', action: 'linkRequest', approve: true, playerKey: 'nova_jogador' }, authOf('adm'));
  check('linkRequest aprovado com whatsapp: copia para contacts', store.get('leagues/L/contacts/nova_jogador')?.whatsapp === '11999998888', store.get('leagues/L/contacts/nova_jogador'));
  check('linkRequest aprovado com whatsapp: ainda vincula e apaga o pedido', user('nova').playerKey === 'nova_jogador' && !store.has('leagues/L/link_requests/nova'));

  store.set('users/nova2', { email: 'nova2@x.com', role: 'pending', leagues: {}, linkRequestSent: true });
  store.set('leagues/L/link_requests/nova2', { uid: 'nova2', whatsapp: '11977776666' });
  await mm({ liga: 'L', uid: 'nova2', action: 'linkRequest', approve: false }, authOf('adm'));
  check('linkRequest descartado com whatsapp: não copia para contacts', !store.has('leagues/L/contacts/nova2') && !store.has('leagues/L/contacts/undefined'));

  store.set('users/nova', { email: 'nova@x.com', role: 'pending', leagues: {}, linkRequestSent: true });
  store.set('leagues/L/link_requests/nova', { uid: 'nova' });
  await mm({ liga: 'L', uid: 'nova', action: 'linkRequest', approve: false }, authOf('adm'));
  check('linkRequest descartado: só limpa o aviso', user('nova').linkRequestSent === false && !('playerKey' in user('nova')), user('nova'));
  check('linkRequest descartado: apaga o pedido', !store.has('leagues/L/link_requests/nova'));
  store.set('users/nova', { email: 'nova@x.com', role: 'pending', leagues: {}, linkRequestSent: true });
  await mm({ liga: 'L', uid: 'nova', action: 'linkRequest', approve: true }, authOf('adm'));
  check('linkRequest "aprovar" sem jogador vira descarte', user('nova').linkRequestSent === false && !('playerKey' in user('nova')), user('nova'));

  // dono do sistema (e-mail verificado) sem ser membro
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { B: { role: 'pending' } } });
  await mm({ liga: 'B', uid: 'pend', action: 'approve' }, authOf('castanho', { email: 'castanho.caiop@gmail.com', email_verified: true }));
  check('manage: dono do sistema verificado pode em qualquer liga', user('pend').leagues.B.role === 'player', user('pend'));

  // isolamento entre ligas
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { L: { role: 'pending' }, B: { role: 'player' } } });
  await mm({ liga: 'L', uid: 'pend', action: 'promote' }, authOf('adm'));
  check('manage: promover em L não altera B', user('pend').leagues.L.role === 'admin' && user('pend').leagues.B.role === 'player', user('pend'));

  // ───────── saveEarnedBadges ─────────
  reset();
  const sb = (data, auth) => call(fns.saveEarnedBadges, data, auth);
  check('badges: sem login', await codeOf(sb({ liga: 'L', ids: ['a'] })) === 'unauthenticated');
  check('badges: quem não participa', await codeOf(sb({ liga: 'L', ids: ['a'] }, authOf('admB'))) === 'permission-denied');
  check('badges: pendente não pode', await codeOf(sb({ liga: 'L', ids: ['a'] }, authOf('pend'))) === 'permission-denied');
  check('badges: ids fora do formato', await codeOf(sb({ liga: 'L', ids: 'a' }, authOf('ana'))) === 'invalid-argument');
  check('badges: id não texto', await codeOf(sb({ liga: 'L', ids: [1] }, authOf('ana'))) === 'invalid-argument');
  check('badges: id gigante', await codeOf(sb({ liga: 'L', ids: ['x'.repeat(81)] }, authOf('ana'))) === 'invalid-argument');
  check('badges: lista gigante', await codeOf(sb({ liga: 'L', ids: Array(301).fill('a') }, authOf('ana'))) === 'invalid-argument');
  check('badges: nada gravado nas negativas', !('earnedBadges' in user('ana').leagues.L));
  await sb({ liga: 'L', ids: ['hat_trick', 'sonho_do_adm'] }, authOf('ana'));
  check('badges: jogador salva as próprias', JSON.stringify(user('ana').leagues.L.earnedBadges) === '["hat_trick","sonho_do_adm"]' && user('ana').leagues.L.role === 'player' && user('ana').leagues.L.playerKey === 'ana', user('ana'));
  await sb({ liga: 'L', ids: [] }, authOf('adm'));
  check('badges: lista vazia é aceita (admin)', JSON.stringify(user('adm').leagues.L.earnedBadges) === '[]' && user('adm').leagues.L.role === 'admin', user('adm'));
  check('badges: não altera outro usuário', !('earnedBadges' in user('dono').leagues.L));

  // ───────── listMembers ─────────
  reset();
  store.set('users/ana', { email: 'ana@x.com', displayName: 'Ana Souza', role: 'pending', playerKey: 'top_ana', fcmTokens: ['tokA1', 'tokA2'], notifEnabled: true, linkRequestSent: false,
    leagues: { L: { role: 'player', playerKey: 'ana', joinedAt: '2026-01-01', earnedBadges: ['x'] }, B: { role: 'admin', playerKey: 'ana_b' } } });
  store.set('users/adm', { email: 'adm@x.com', displayName: 'Beto Admin', role: 'pending', fcmTokens: ['tokB'], leagues: { L: { role: 'admin', joinedAt: '2026-01-02' } } });
  store.set('users/pend', { email: 'pend@x.com', displayName: 'Caio Pendente', role: 'pending', leagues: { L: { role: 'pending', joinedAt: '2026-02-01' } } });
  store.set('users/rej', { email: 'rej@x.com', displayName: 'Dani Rejeitada', role: 'pending', leagues: { L: { role: 'rejected' } } });
  store.set('users/legacy', { email: 'leg@x.com', displayName: 'Edu Antigo', role: 'player', playerKey: 'edu_top', leagues: { L: { role: 'player' } } });
  store.set('users/soB', { email: 'sob@x.com', displayName: 'Fábio da B', role: 'pending', leagues: { B: { role: 'player' } } });
  store.set('users/semliga', { email: 'sem@x.com', displayName: 'Gabi', role: 'pending', leagues: {} });
  const lm = (data, auth) => call(fns.listMembers, data, auth);
  check('list: sem login', await codeOf(lm({ liga: 'L' })) === 'unauthenticated');
  check('list: jogador comum não pode', await codeOf(lm({ liga: 'L' }, authOf('ana'))) === 'permission-denied');
  check('list: pendente não pode', await codeOf(lm({ liga: 'L' }, authOf('pend'))) === 'permission-denied');
  check('list: sem cadastro não pode', await codeOf(lm({ liga: 'L' }, authOf('fantasma'))) === 'permission-denied');
  check('list: admin de OUTRA liga não pode', await codeOf(lm({ liga: 'L' }, authOf('soB'))) === 'permission-denied');
  check('list: admin da liga B (via cadastro) não lista L', await codeOf(lm({ liga: 'L' }, authOf('ana', { email: 'ana@x.com' }))) === 'permission-denied');
  check('list: e-mail do dono SEM verificação não vale', await codeOf(lm({ liga: 'L' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'permission-denied');
  check('list: liga inválida', await codeOf(lm({ liga: 'a/b' }, authOf('adm'))) === 'invalid-argument');
  check('list: filtro inválido (papel desconhecido)', await codeOf(lm({ liga: 'L', roles: ['admin', 'hacker'] }, authOf('adm'))) === 'invalid-argument');
  check('list: filtro vazio', await codeOf(lm({ liga: 'L', roles: [] }, authOf('adm'))) === 'invalid-argument');
  check('list: filtro que não é lista', await codeOf(lm({ liga: 'L', roles: 'pending' }, authOf('adm'))) === 'invalid-argument');
  check('list: filtro nulo é recusado', await codeOf(lm({ liga: 'L', roles: null }, authOf('adm'))) === 'invalid-argument');

  let res = await lm({ liga: 'L' }, authOf('adm'));
  const uidsL = res.members.map(m => m.uid).sort();
  check('list: só quem tem vínculo com a liga', JSON.stringify(uidsL) === JSON.stringify(['adm', 'ana', 'dono', 'legacy', 'pend', 'rej']), uidsL);
  check('list: ordenado por nome (sem nome usa o e-mail)', JSON.stringify(res.members.map(m => m.uid)) === JSON.stringify(['ana', 'adm', 'pend', 'rej', 'dono', 'legacy']), res.members.map(m => m.displayName || m.email));
  const ana = res.members.find(m => m.uid === 'ana');
  check('list: campos entregues', JSON.stringify(Object.keys(ana).sort()) === JSON.stringify(['displayName', 'email', 'joinedAt', 'playerKey', 'role', 'uid']), Object.keys(ana));
  check('list: papel e vínculo são os da liga pedida', ana.role === 'player' && ana.playerKey === 'ana' && ana.joinedAt === '2026-01-01', ana);
  const serialized = JSON.stringify(res);
  check('list: NÃO vaza tokens de notificação', !serialized.includes('tokA1') && !serialized.includes('tokB') && !serialized.includes('fcmTokens'), serialized);
  check('list: NÃO vaza dados de outra liga', !serialized.includes('ana_b') && !serialized.includes('"B"') && !serialized.includes('sob@x.com') && !serialized.includes('earnedBadges'), serialized);
  check('list: vínculo antigo (topo) vale quando a liga não tem', res.members.find(m => m.uid === 'legacy').playerKey === 'edu_top', res.members.find(m => m.uid === 'legacy'));
  check('list: sem vínculo devolve vazio', res.members.find(m => m.uid === 'pend').playerKey === '', res.members.find(m => m.uid === 'pend'));
  check('list: usuário sem liga não aparece', !serialized.includes('sem@x.com'));

  res = await lm({ liga: 'L', roles: ['pending'] }, authOf('adm'));
  check('list: filtro por pendentes', res.members.length === 1 && res.members[0].uid === 'pend', res.members);
  res = await lm({ liga: 'L', roles: ['admin', 'player', 'admin'] }, authOf('adm'));
  check('list: filtro com papéis repetidos', JSON.stringify(res.members.map(m => m.uid).sort()) === JSON.stringify(['adm', 'ana', 'dono', 'legacy']), res.members.map(m => m.uid));
  res = await lm({ liga: 'B' }, authOf('castanho', { email: 'castanho.caiop@gmail.com', email_verified: true }));
  check('list: dono do sistema verificado lista qualquer liga (B)', JSON.stringify(res.members.map(m => m.uid).sort()) === JSON.stringify(['admB', 'ana', 'soB']) && res.members.find(m => m.uid === 'ana').playerKey === 'ana_b' && res.members.find(m => m.uid === 'ana').role === 'admin', res.members);
  check('list: a mesma pessoa vem com o papel de cada liga', (await lm({ liga: 'L' }, authOf('adm'))).members.find(m => m.uid === 'ana').role === 'player');

  // ───────── migrateContacts ─────────
  const seedLegacy = () => {
    reset();
    store.set('leagues/L/player_registry/ana', { name: 'Ana', stars: 3, whatsapp: '(11) 99999-0001' });
    store.set('leagues/L/player_registry/bia', { name: 'Bia', whatsapp: '11 98888-0002', active: true });
    store.set('leagues/L/player_registry/caio', { name: 'Caio' });
    store.set('leagues/L/player_registry/duda', { name: 'Duda', whatsapp: '' });
    store.set('leagues/L/financeiro_avulsos/a1', { nome: 'Zé Convidado', valor: 20, data: '2026-09-01', mes: '2026-09', paga: true, whatsapp: '11977770001' });
    store.set('leagues/L/financeiro_avulsos/a2', { nome: 'Zé Convidado', valor: 20, data: '2026-09-20', mes: '2026-09', paga: false, whatsapp: '11977770009' });
    store.set('leagues/L/financeiro_avulsos/a3', { nome: 'Sem Numero', valor: 20, data: '2026-09-20', mes: '2026-09', paga: false });
    store.set('leagues/L/championships/c1', { date: '2026-09-01', status: 'completed', matches: [{ g: 1 }], avulsos: [{ name: 'Zé Convidado', valor: 20, finId: 'a1', whatsapp: '11977770001' }] });
    store.set('leagues/L/championships/c2', { date: '2026-09-20', status: 'preset', avulsos: [{ name: 'Zé Convidado', valor: 20, finId: 'a2', whatsapp: '11977770009' }, { name: 'Maria Avulsa', valor: 20, finId: 'x', whatsapp: '11966660001' }, { name: 'Sem Fone', valor: 20, finId: 'y' }] });
    store.set('leagues/L/championships/c3', { date: '2026-09-10', status: 'completed', matches: [] });
    store.set('leagues/L/championships/c4', { date: '2026-09-11', status: 'completed', avulsos: [] });
    store.set('leagues/B/player_registry/zed', { name: 'Zed', whatsapp: '11955550001' });
    store.set('leagues/B/championships/cb', { date: '2026-09-01', avulsos: [{ name: 'Outro', whatsapp: '11944440001' }] });
  };
  const mc = (data, auth) => call(fns.migrateContacts, data, auth);
  seedLegacy();
  check('contacts: sem login', await codeOf(mc({ liga: 'L' })) === 'unauthenticated');
  check('contacts: jogador comum não pode', await codeOf(mc({ liga: 'L' }, authOf('ana'))) === 'permission-denied');
  check('contacts: admin de OUTRA liga não pode', await codeOf(mc({ liga: 'L' }, authOf('admB'))) === 'permission-denied');
  check('contacts: e-mail do dono SEM verificação não vale', await codeOf(mc({ liga: 'L' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'permission-denied');
  check('contacts: liga inválida', await codeOf(mc({ liga: 'a/b' }, authOf('adm'))) === 'invalid-argument');
  check('contacts: liga inexistente', await codeOf(mc({ liga: 'naoexiste' }, authOf('castanho', { email: 'castanho.caiop@gmail.com', email_verified: true }))) === 'not-found');
  check('contacts: negativas não mexeram nos dados', store.get('leagues/L/player_registry/ana').whatsapp === '(11) 99999-0001' && !store.has('leagues/L/contacts/ana'));

  let mr = await mc({ liga: 'L' }, authOf('adm'));
  const ct = id => (store.get('leagues/L/contacts/' + id) || {}).whatsapp;
  check('contacts: resultado', mr.skipped === false && mr.moved === 4 && mr.created === 4 && mr.residual === 0, mr);
  const logTxt = JSON.stringify(logs);
  check('contacts: registra a conclusão nos logs só com contagens', logs.length === 1 && logs[0].level === 'info' && logs[0].d.contatos === 4 && logs[0].d.cadastros === 3 && logs[0].d.cobrancas === 2 && logs[0].d.campeonatos === 2 && logs[0].d.residual === 0, logs);
  check('contacts: o log NÃO contém número de telefone nem nome de pessoa', !/\d{8,}/.test(logTxt) && !/Ana|Bia|Zé|Maria|Duda|Caio/.test(logTxt), logTxt);
  check('contacts: jogadores viram contato com o id do cadastro (só dígitos)', ct('ana') === '11999990001' && ct('bia') === '11988880002', [ct('ana'), ct('bia')]);
  check('contacts: sem número / número vazio não geram contato', !store.has('leagues/L/contacts/caio') && !store.has('leagues/L/contacts/duda'));
  check('contacts: avulso repetido fica com o número mais recente', ct('avulso_ze_convidado') === '11977770009', ct('avulso_ze_convidado'));
  check('contacts: avulso só do campeonato também migra', ct('avulso_maria_avulsa') === '11966660001', ct('avulso_maria_avulsa'));
  check('contacts: avulso sem número não gera contato', !store.has('leagues/L/contacts/avulso_sem_fone') && !store.has('leagues/L/contacts/avulso_sem_numero'));
  check('contacts: só os 4 contatos esperados existem', [...store.keys()].filter(k => k.startsWith('leagues/L/contacts/')).length === 4, [...store.keys()].filter(k => k.startsWith('leagues/L/contacts/')));
  check('contacts: cadastro do elenco perde o número e mantém o resto', !('whatsapp' in store.get('leagues/L/player_registry/ana')) && store.get('leagues/L/player_registry/ana').name === 'Ana' && store.get('leagues/L/player_registry/ana').stars === 3 && store.get('leagues/L/player_registry/bia').active === true && !('whatsapp' in store.get('leagues/L/player_registry/duda')), store.get('leagues/L/player_registry/ana'));
  check('contacts: financeiro de avulsos perde o número e mantém o resto', ['a1', 'a2'].every(i => !('whatsapp' in store.get('leagues/L/financeiro_avulsos/' + i))) && store.get('leagues/L/financeiro_avulsos/a1').valor === 20 && store.get('leagues/L/financeiro_avulsos/a1').paga === true && store.get('leagues/L/financeiro_avulsos/a2').nome === 'Zé Convidado', store.get('leagues/L/financeiro_avulsos/a1'));
  const c2 = store.get('leagues/L/championships/c2');
  check('contacts: campeonatos perdem o número dos avulsos e mantêm o resto', c2.avulsos.length === 3 && c2.avulsos.every(a => !('whatsapp' in a)) && c2.avulsos[0].name === 'Zé Convidado' && c2.avulsos[0].finId === 'a2' && c2.avulsos[1].valor === 20 && c2.status === 'preset', c2);
  check('contacts: campeonato antigo também é limpo', !('whatsapp' in store.get('leagues/L/championships/c1').avulsos[0]) && store.get('leagues/L/championships/c1').matches.length === 1);
  check('contacts: campeonatos sem avulsos ficam intactos', JSON.stringify(store.get('leagues/L/championships/c3')) === JSON.stringify({ date: '2026-09-10', status: 'completed', matches: [] }) && JSON.stringify(store.get('leagues/L/championships/c4').avulsos) === '[]');
  check('contacts: marca a liga como migrada', !!store.get('leagues/L').contactsMigratedAt && store.get('leagues/L').name === 'Liga L', store.get('leagues/L'));
  check('contacts: NÃO mexe em outra liga', store.get('leagues/B/player_registry/zed').whatsapp === '11955550001' && store.get('leagues/B/championships/cb').avulsos[0].whatsapp === '11944440001' && !store.has('leagues/B/contacts/zed'));
  const mr2 = await mc({ liga: 'L' }, authOf('adm'));
  check('contacts: repetir é seguro e rápido (já migrada)', mr2.skipped === true && mr2.moved === 0 && ct('ana') === '11999990001', mr2);

  // contato que o admin já ajustou vale mais que o número antigo
  seedLegacy();
  store.set('leagues/L/contacts/ana', { whatsapp: '11000000000' });
  mr = await mc({ liga: 'L' }, authOf('adm'));
  check('contacts: contato existente NÃO é sobrescrito', ct('ana') === '11000000000' && !('whatsapp' in store.get('leagues/L/player_registry/ana')) && mr.created === 3, [ct('ana'), mr]);

  // falha ao gravar contatos: nenhum número pode ser apagado da origem
  seedLegacy();
  commitCount = 0; failCommitsFrom = 1;
  check('contacts: falha ao gravar contatos → erro', await codeOf(mc({ liga: 'L' }, authOf('adm'))) !== 'ok');
  failCommitsFrom = Infinity;
  check('contacts: falha ao gravar → números continuam na origem', store.get('leagues/L/player_registry/ana').whatsapp === '(11) 99999-0001' && store.get('leagues/L/financeiro_avulsos/a2').whatsapp === '11977770009' && store.get('leagues/L/championships/c2').avulsos[1].whatsapp === '11966660001', 'dados perdidos!');
  check('contacts: falha ao gravar → liga NÃO é marcada como migrada', !store.get('leagues/L').contactsMigratedAt);
  mr = await mc({ liga: 'L' }, authOf('adm'));
  check('contacts: nova tentativa depois da falha conclui', mr.moved === 4 && ct('ana') === '11999990001' && !('whatsapp' in store.get('leagues/L/player_registry/ana')), mr);

  // falha ao apagar da origem (depois dos contatos): nada se perde e a repetição termina o serviço
  seedLegacy();
  commitCount = 0; failCommitsFrom = 2;   // 1º commit = contatos (ok); 2º = limpeza dos cadastros (falha)
  check('contacts: falha na limpeza → erro', await codeOf(mc({ liga: 'L' }, authOf('adm'))) !== 'ok');
  failCommitsFrom = Infinity;
  check('contacts: falha na limpeza → contatos já estão salvos e a liga não foi marcada', ct('ana') === '11999990001' && ct('avulso_ze_convidado') === '11977770009' && !store.get('leagues/L').contactsMigratedAt);
  mr = await mc({ liga: 'L' }, authOf('adm'));
  check('contacts: repetição depois da falha na limpeza termina o serviço', !('whatsapp' in store.get('leagues/L/player_registry/ana')) && store.get('leagues/L/championships/c2').avulsos.every(a => !('whatsapp' in a)) && !!store.get('leagues/L').contactsMigratedAt && ct('ana') === '11999990001', mr);

  // WhatsApp em lugar desconhecido: a função avisa, não apaga o que não conhece e NÃO marca a liga como concluída
  seedLegacy();
  store.set('leagues/L/championships/c5', { date: '2026-09-15', extra: { whatsapp: '11933334444' }, avulsos: [{ name: 'Estranho', valor: 20, contato: { whatsapp: '11922223333' } }] });
  store.set('leagues/L/financeiro_mensalidades/2026-09', { pagamentos: {}, whatsapp: '11944445555' });
  logs.length = 0;
  mr = await mc({ liga: 'L' }, authOf('adm'));
  check('contacts: resto desconhecido → avisa quantos são', mr.skipped === false && mr.residual === 3 && mr.moved === 4, mr);
  check('contacts: resto desconhecido → os conhecidos foram movidos e limpos normalmente', ct('ana') === '11999990001' && !('whatsapp' in store.get('leagues/L/player_registry/ana')) && store.get('leagues/L/championships/c2').avulsos.every(a => !('whatsapp' in a)));
  check('contacts: resto desconhecido → NADA do que não conhece foi apagado', store.get('leagues/L/championships/c5').extra.whatsapp === '11933334444' && store.get('leagues/L/championships/c5').avulsos[0].contato.whatsapp === '11922223333' && store.get('leagues/L/financeiro_mensalidades/2026-09').whatsapp === '11944445555');
  check('contacts: resto desconhecido → liga NÃO é marcada como concluída', !store.get('leagues/L').contactsMigratedAt);
  check('contacts: resto desconhecido → log de aviso só com caminhos (sem números)', logs.length === 1 && logs[0].level === 'warn' && logs[0].d.onde.length === 3 && logs[0].d.onde.includes('championships/c5.extra.whatsapp') && logs[0].d.onde.includes('championships/c5.avulsos[0].contato.whatsapp') && logs[0].d.onde.includes('financeiro_mensalidades/2026-09.whatsapp') && !/\d{8,}/.test(JSON.stringify(logs)), logs);
  mr = await mc({ liga: 'L' }, authOf('adm'));
  check('contacts: resto desconhecido → a próxima chamada confere de novo (não pula)', mr.skipped === false && mr.residual === 3, mr);

  // dono do sistema (verificado) migra qualquer liga
  seedLegacy();
  mr = await mc({ liga: 'B' }, authOf('castanho', { email: 'castanho.caiop@gmail.com', email_verified: true }));
  check('contacts: dono verificado migra a liga B', mr.moved === 2 && store.get('leagues/B/contacts/zed').whatsapp === '11955550001' && store.get('leagues/B/contacts/avulso_outro').whatsapp === '11944440001' && !('whatsapp' in store.get('leagues/B/player_registry/zed')), mr);
  check('contacts: e a liga L continua intacta', store.get('leagues/L/player_registry/ana').whatsapp === '(11) 99999-0001');

  // ───────── deleteMyAccount (direito de exclusão) ─────────
  const dm = (data, auth) => call(fns.deleteMyAccount, data, auth);
  const nowS = () => Math.floor(Date.now() / 1000);
  const seedDel = () => {
    reset();
    store.set('users/ana', { email: 'ana@x.com', displayName: 'Ana', role: 'pending', fcmTokens: ['tokA'], notifEnabled: true, playerKey: 'ana', linkRequestSent: true,
      leagues: { L: { role: 'player', playerKey: 'ana', joinedAt: '2026-01-01', earnedBadges: ['x'] }, B: { role: 'player', playerKey: 'ana_b', joinedAt: '2026-02-01' } } });
    store.set('users/ana/badgeNotifs/n1', { leagueId: 'L', newBadges: [] });
    store.set('users/ana/badgeNotifs/n2', { leagueId: 'B', newBadges: [] });
    store.set('users/bia', { email: 'bia@x.com', displayName: 'Bia', role: 'pending', fcmTokens: ['tokB'], leagues: { L: { role: 'player', playerKey: 'bia' } } });
    store.set('leagues/L/link_requests/ana', { uid: 'ana', email: 'ana@x.com', displayName: 'Ana' });
    store.set('leagues/L/contacts/ana', { whatsapp: '11988880002' });
    store.set('leagues/L/contacts/bia', { whatsapp: '11999990001' });
    store.set('leagues/B/contacts/ana_b', { whatsapp: '11955550001' });
    store.set('leagues/L/player_photos/ana', { url: 'https://res.cloudinary.com/fwtyio7l/a.jpg', uid: 'ana', updatedAt: 'x' });
    store.set('leagues/L/player_photos/bia', { url: 'https://res.cloudinary.com/fwtyio7l/b.jpg', uid: 'bia', updatedAt: 'x' });
    store.set('leagues/B/player_photos/ana_b', { url: 'https://res.cloudinary.com/fwtyio7l/c.jpg', uid: 'admB', updatedAt: 'x' }); // enviada pelo admin em nome dela
    store.set('leagues/L/player_registry/ana', { name: 'Ana', stars: 3, active: true });
    store.set('leagues/L/championships/c1', { date: '2026-09-01', teamRosters: { azul: ['Ana', 'Bia'] }, votes: { ana: { pos: 'Bia' } } });
    store.set('leagues/L/invite_tokens/tk1', { role: 'player', used: true, usedBy: 'ana', usedAt: 'x', createdBy: 'adm' });
    store.set('leagues/L/invite_tokens/tk2', { role: 'player', used: false, createdBy: 'ana' });
    store.set('leagues/L/invite_tokens/tk3', { role: 'player', used: true, usedBy: 'bia', createdBy: 'adm' });
    authDeleted.length = 0; authDeleteError = null; logs.length = 0;
  };
  seedDel();
  const snapshotOthers = () => JSON.stringify([...store.entries()].filter(([k]) => !k.startsWith('users/ana') && !k.includes('/ana') && !k.includes('ana_b') && !k.includes('/invite_tokens/tk1') && !k.includes('/invite_tokens/tk2')).sort());
  check('excluir: sem login', await codeOf(dm({ confirm: true })) === 'unauthenticated');
  check('excluir: sem confirmação → recusado', await codeOf(dm({}, authOf('ana'))) === 'invalid-argument' && await codeOf(dm({ confirm: 'sim' }, authOf('ana'))) === 'invalid-argument');
  let ex = await dm({ confirm: true }, authOf('ana', { auth_time: nowS() - 3600 })).catch(x => x);
  check('excluir: login de 1 hora atrás → pede para entrar de novo', ex.code === 'failed-precondition' && ex.details && ex.details.reason === 'recent-login', ex);
  ex = await dm({ confirm: true }, authOf('ana', { auth_time: undefined })).catch(x => x);
  check('excluir: token sem auth_time também exige login novo', ex.code === 'failed-precondition' && ex.details && ex.details.reason === 'recent-login', ex);
  check('excluir: nada foi apagado nas negativas', store.has('users/ana') && store.has('leagues/L/contacts/ana') && authDeleted.length === 0);

  const before = snapshotOthers();
  r = await dm({ confirm: true, uid: 'bia' }, authOf('ana', { auth_time: nowS() - 240 }));
  check('excluir: jogador com login de 4 min exclui a própria conta', r.ok === true, r);
  check('excluir: cadastro e notificações pendentes apagados', !store.has('users/ana') && ![...store.keys()].some(k => k.startsWith('users/ana/')));
  check('excluir: login apagado (só o da própria conta)', JSON.stringify(authDeleted) === '["ana"]', authDeleted);
  check('excluir: pedido de vinculação apagado', !store.has('leagues/L/link_requests/ana'));
  check('excluir: WhatsApp do jogador vinculado apagado (nas duas ligas)', !store.has('leagues/L/contacts/ana') && !store.has('leagues/B/contacts/ana_b'));
  check('excluir: foto do jogador apagada (inclusive a enviada pelo admin)', !store.has('leagues/L/player_photos/ana') && !store.has('leagues/B/player_photos/ana_b'));
  check('excluir: convite usado por ela perde o identificador, o resto fica', !('usedBy' in store.get('leagues/L/invite_tokens/tk1')) && store.get('leagues/L/invite_tokens/tk1').used === true && store.get('leagues/L/invite_tokens/tk1').createdBy === 'adm', store.get('leagues/L/invite_tokens/tk1'));
  check('excluir: convite criado por ela perde o identificador', !('createdBy' in store.get('leagues/L/invite_tokens/tk2')) && store.get('leagues/L/invite_tokens/tk2').used === false, store.get('leagues/L/invite_tokens/tk2'));
  check('excluir: convite de outra pessoa intacto', store.get('leagues/L/invite_tokens/tk3').usedBy === 'bia');
  check('excluir: NADA de outras pessoas foi mexido (nem o "uid" enviado no pedido)', snapshotOthers() === before && store.has('users/bia') && store.get('leagues/L/contacts/bia').whatsapp === '11999990001' && store.has('leagues/L/player_photos/bia'));
  check('excluir: o registro esportivo da liga fica (elenco e campeonatos)', store.get('leagues/L/player_registry/ana').name === 'Ana' && JSON.stringify(store.get('leagues/L/championships/c1').teamRosters) === '{"azul":["Ana","Bia"]}' && store.get('leagues/L/championships/c1').votes.ana.pos === 'Bia');
  check('excluir: as ligas continuam existindo', store.has('leagues/L') && store.has('leagues/B'));
  check('excluir: o log não guarda dado pessoal', logs.length === 1 && JSON.stringify(logs[0].d) === '{"ligas":2,"loginApagadoNoServidor":true}' && !/ana|@/.test(JSON.stringify(logs)), logs);
  check('excluir: resposta avisa que o login já foi apagado no servidor', r.authDeleted === true, r);

  // outra conta vinculada ao mesmo jogador: foto e contato ficam
  seedDel();
  store.set('users/bia', { email: 'bia@x.com', role: 'pending', leagues: { L: { role: 'player', playerKey: 'ana' } } });
  await dm({ confirm: true }, authOf('ana'));
  check('excluir: se outra conta usa o mesmo jogador, foto e WhatsApp ficam', store.has('leagues/L/contacts/ana') && store.has('leagues/L/player_photos/ana') && !store.has('leagues/B/contacts/ana_b'));

  // único admin: bloqueia; com outro admin, libera e passa a liga adiante
  seedDel();
  store.set('leagues/Solo', { name: 'Liga Solitária', ownerId: 'ana' });
  store.set('leagues/Solo/invite_tokens/s1', { role: 'player', used: false, createdBy: 'ana' });
  store.set('users/ana', { ...store.get('users/ana'), leagues: { ...store.get('users/ana').leagues, Solo: { role: 'admin', joinedAt: '2026-01-05' } } });
  ex = await dm({ confirm: true }, authOf('ana')).catch(x => x);
  check('excluir: único admin de uma liga → bloqueado, dizendo qual', ex.code === 'failed-precondition' && ex.details && ex.details.reason === 'last-admin' && /Liga Solitária/.test(ex.message) && /encerre a liga/.test(ex.message) && ex.details.ligas[0] === 'Liga Solitária', ex);
  check('excluir: bloqueado não apaga nada', store.has('users/ana') && store.has('leagues/L/contacts/ana') && authDeleted.length === 0 && store.get('leagues/Solo').ownerId === 'ana');
  store.set('users/bia', { email: 'bia@x.com', role: 'pending', leagues: { L: { role: 'player', playerKey: 'bia' }, Solo: { role: 'admin', joinedAt: '2026-03-01' } } });
  store.set('users/nova', { email: 'nova@x.com', role: 'pending', leagues: { Solo: { role: 'admin', joinedAt: '2026-02-01' } } });
  r = await dm({ confirm: true }, authOf('ana'));
  check('excluir: com outros admins na liga, a exclusão é liberada', r.ok === true && !store.has('users/ana') && authDeleted.includes('ana'), r);
  check('excluir: dono da liga passa para o admin mais antigo', store.get('leagues/Solo').ownerId === 'nova', store.get('leagues/Solo'));
  check('excluir: convite criado por ela na liga também perde o identificador', !('createdBy' in store.get('leagues/Solo/invite_tokens/s1')));
  check('excluir: quem não era dono não muda o dono (liga L continua com o mesmo)', store.get('leagues/L').ownerId === 'dono' && store.get('leagues/B').ownerId === 'admB');

  // sem cadastro, e falhas ao apagar o login
  seedDel();
  r = await dm({ confirm: true }, authOf('fantasma'));
  check('excluir: conta sem cadastro também apaga o login', r.ok === true && authDeleted.includes('fantasma'));
  seedDel(); authDeleteError = 'auth/insufficient-permission';
  r = await dm({ confirm: true }, authOf('ana'));
  check('excluir: servidor sem permissão para apagar o login → ok, mas avisa que o app precisa concluir', r.ok === true && r.authDeleted === false, r);
  check('excluir: nesse caso os dados pessoais já foram apagados mesmo assim', !store.has('users/ana') && !store.has('leagues/L/contacts/ana') && !store.has('leagues/L/player_photos/ana') && authDeleted.length === 0);
  check('excluir: o erro fica nos logs, só com o código (sem dado pessoal)', logs.some(l => l.level === 'error' && l.d.code === 'auth/insufficient-permission') && !/ana|@/.test(JSON.stringify(logs.filter(l => l.level === 'error'))), logs);
  authDeleteError = null;
  r = await dm({ confirm: true }, authOf('ana'));
  check('excluir: repetir depois (sem cadastro) apaga o login e conclui', r.ok === true && r.authDeleted === true && authDeleted.includes('ana'), r);
  seedDel(); authDeleteError = 'auth/user-not-found';
  r = await dm({ confirm: true }, authOf('ana'));
  check('excluir: login que já não existe conta como apagado', r.ok === true && r.authDeleted === true, r);
  authDeleteError = null;

  // ───────── anonymizeMyName (direito de anonimização) ─────────
  const am = (data, auth) => call(fns.anonymizeMyName, data, auth);
  const seedAnon = () => {
    reset();
    store.set('leagues/L/player_registry/ana', { name: 'Ana', stars: 3, active: true, added: '2026-01-01' });
    store.set('leagues/L/player_titles/ana', { name: 'Ana', titles: 2, last_date: '2026-05-01' });
    store.set('leagues/L/player_photos/ana', { url: 'https://res.cloudinary.com/fwtyio7l/x.jpg', uid: 'ana', updatedAt: 'x' });
    store.set('leagues/L/contacts/ana', { whatsapp: '11988880002' });
    store.set('leagues/L/championships/c1', {
      date: '2026-01-01', champion_players: [{ name: 'Ana', weight: 1 }],
      teamRosters: { azul: ['Ana', 'Bia'] },
      matches: [{ goals: [{ player: 'Ana' }], finalGoals: [{ player: 'Ana' }] }],
      votes: { ana: { pos: 'Bia', neg: 'Caio' }, bia: { pos: 'Ana' } },
    });
    store.set('leagues/L/financeiro_mensalidades/2026-01', { pagamentos: { Ana: true, Bia: false } });
    store.set('users/ana', { email: 'ana@x.com', role: 'pending', playerKey: 'ana', leagues: { L: { role: 'player', playerKey: 'ana' } } });
    store.set('users/bia', { email: 'bia@x.com', role: 'pending', playerKey: 'bia', leagues: { L: { role: 'player', playerKey: 'bia' } } });
  };
  seedAnon();
  check('anon: sem login', await codeOf(am({ liga: 'L' })) === 'unauthenticated');
  check('anon: pendente não pode', await codeOf(am({ liga: 'L' }, authOf('pend'))) === 'permission-denied');
  check('anon: liga inválida', await codeOf(am({ liga: 'a/b' }, authOf('ana'))) === 'invalid-argument');
  store.set('users/semvinculo', { email: 's@x.com', role: 'pending', leagues: { L: { role: 'player' } } });
  check('anon: sem jogador vinculado', await codeOf(am({ liga: 'L' }, authOf('semvinculo'))) === 'failed-precondition');
  store.set('users/fantasma2', { email: 'f@x.com', role: 'pending', playerKey: 'nao_existe', leagues: { L: { role: 'player', playerKey: 'nao_existe' } } });
  check('anon: jogador vinculado não existe no elenco', await codeOf(am({ liga: 'L' }, authOf('fantasma2'))) === 'not-found');
  check('anon: nada mudou nas negativas', store.has('leagues/L/player_registry/ana') && store.get('leagues/L/player_registry/ana').name === 'Ana');

  let ar = await am({ liga: 'L' }, authOf('ana'));
  check('anon: sucesso, devolve chave e nome anônimos', ar.ok === true && ar.newKey.startsWith('jogador_anonimo_') && /^Jogador Anônimo #[0-9A-F]{4}$/.test(ar.newName), ar);
  const newKey = ar.newKey, newName = ar.newName;
  check('anon: cadastro antigo sumiu; o novo guarda o nome anterior', !store.has('leagues/L/player_registry/ana') && store.get('leagues/L/player_registry/' + newKey).formerName === 'Ana' && store.get('leagues/L/player_registry/' + newKey).name === newName, store.get('leagues/L/player_registry/' + newKey));
  check('anon: mantém estrelas, ativo e data de entrada', store.get('leagues/L/player_registry/' + newKey).stars === 3 && store.get('leagues/L/player_registry/' + newKey).active === true && store.get('leagues/L/player_registry/' + newKey).added === '2026-01-01');
  check('anon: títulos migrados com o novo nome', !store.has('leagues/L/player_titles/ana') && store.get('leagues/L/player_titles/' + newKey).titles === 2 && store.get('leagues/L/player_titles/' + newKey).name === newName);
  check('anon: foto apagada, não é levada adiante', !store.has('leagues/L/player_photos/ana') && !store.has('leagues/L/player_photos/' + newKey));
  check('anon: contato migrado (admin continua alcançando)', !store.has('leagues/L/contacts/ana') && store.get('leagues/L/contacts/' + newKey).whatsapp === '11988880002');
  check('anon: mensalidade migrada, resto intacto', !('Ana' in store.get('leagues/L/financeiro_mensalidades/2026-01').pagamentos) && store.get('leagues/L/financeiro_mensalidades/2026-01').pagamentos[newName] === true && store.get('leagues/L/financeiro_mensalidades/2026-01').pagamentos.Bia === false);
  const c1 = store.get('leagues/L/championships/c1');
  check('anon: campeão, elenco e gols migrados no campeonato', c1.champion_players[0].name === newName && c1.teamRosters.azul.includes(newName) && c1.teamRosters.azul.includes('Bia') && c1.matches[0].goals[0].player === newName && c1.matches[0].finalGoals[0].player === newName, c1);
  check('anon: voto que ela deu migrado (chave do votante)', !!c1.votes[newKey] && c1.votes[newKey].pos === 'Bia' && c1.votes[newKey].neg === 'Caio' && !c1.votes.ana, c1.votes);
  check('anon: voto que ela recebeu migrado (nome do premiado)', c1.votes.bia.pos === newName, c1.votes.bia);
  check('anon: a conta passa a apontar para o novo jogador (liga e topo)', store.get('users/ana').leagues.L.playerKey === newKey && store.get('users/ana').playerKey === newKey, store.get('users/ana'));
  check('anon: outra conta não foi tocada', store.get('users/bia').playerKey === 'bia' && store.get('users/bia').leagues.L.playerKey === 'bia');

  const ar2 = await am({ liga: 'L' }, authOf('ana'));
  check('anon: repetir depois de concluído não quebra e mantém a mesma identidade', ar2.ok === true && ar2.newKey === newKey, ar2);
  check('anon: repetir não duplica nem deixa sobra no campeonato', JSON.stringify(store.get('leagues/L/championships/c1')) === JSON.stringify(c1));
  check('anon: repetir não recria o cadastro antigo nem duplica o cadastro novo', !store.has('leagues/L/player_registry/ana') && [...store.keys()].filter(k => k.startsWith('leagues/L/player_registry/jogador_anonimo_')).length === 1);

  // admin também pode anonimizar o próprio nome
  seedAnon();
  store.delete('users/ana');
  store.set('users/adm2', { email: 'adm2@x.com', role: 'pending', playerKey: 'ana', leagues: { L: { role: 'admin', playerKey: 'ana' } } });
  const arAdm = await am({ liga: 'L' }, authOf('adm2'));
  check('anon: admin também pode anonimizar o próprio nome', arAdm.ok === true && arAdm.newKey.startsWith('jogador_anonimo_'), arAdm);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
