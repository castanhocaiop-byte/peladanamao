// Testes da função deleteLeague (encerrar liga): quem pode, o que é apagado, o cancelamento da
// assinatura no Mercado Pago e a retomada quando algo falha no meio.
const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória (mesma base dos outros harnesses) ─────────────
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
let recursiveDeleteError = null;  // erro simulado ao apagar a liga com tudo dentro
let recursiveDeleteCalls = [];
const fakeDb = {
  doc: p => refOf(p),
  recursiveDelete: async ref => {
    recursiveDeleteCalls.push(ref.path);
    if (recursiveDeleteError) throw new Error(recursiveDeleteError);
    for (const k of [...store.keys()]) if (k === ref.path || k.startsWith(ref.path + '/')) store.delete(k);
  },
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
};

class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const logs = [];
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({}),
  auth: () => ({ deleteUser: async () => {} }),
};

// ── mock do SDK do Mercado Pago: o teste controla o que a busca devolve e o que o cancelamento faz ──
const mp = { searchCalls: [], updateCalls: [], results: [], searchError: null, updateErrorIds: new Set() };
class MercadoPagoConfig { constructor(opts) { this.opts = opts; } }
class PreApproval {
  async create() { return {}; }
  async get() { return {}; }
  async search({ options } = {}) {
    if (mp.searchError) throw new Error(mp.searchError);
    mp.searchCalls.push(options);
    // devolve TUDO que o teste programou, sem filtrar por external_reference: o código tem de conferir sozinho
    const offset = options?.offset || 0, limit = options?.limit || 30;
    return { results: mp.results.slice(offset, offset + limit) };
  }
  async update({ id, body }) {
    if (mp.updateErrorIds.has(id)) throw new Error('o Mercado Pago recusou ' + id);
    mp.updateCalls.push({ id, body });
    return { id, ...body };
  }
}
class Preference { async create() { return {}; } }
class Payment { async get() { return {}; } async search() { return { results: [] }; } }
class WebhookSignatureValidator { static validate() {} }

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, onRequest: (opts, h) => h, HttpsError };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (opts, h) => h };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
  if (request === 'firebase-functions/params') return { defineSecret: name => ({ value: () => 'fake-' + name }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
  if (request === 'mercadopago') return { MercadoPagoConfig, PreApproval, Preference, Payment, WebhookSignatureValidator };
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
const del = (data, auth) => fns.deleteLeague({ data, auth });
const authOf = (uid, extra = {}) => ({ uid, token: { email: uid + '@x.com', name: uid.toUpperCase(), email_verified: false, auth_time: Math.floor(Date.now() / 1000), ...extra } });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const errOf = async p => { try { await p; return null; } catch (e) { return e; } };
const user = uid => store.get('users/' + uid);
// Foto do banco (sem os contadores de rate limit, que mudam a cada chamada)
const snapshot = () => JSON.stringify([...store.entries()].filter(([k]) => !k.startsWith('rate_limits/')).sort(([a], [b]) => a.localeCompare(b)));
const under = prefix => [...store.keys()].filter(k => k === prefix || k.startsWith(prefix + '/'));

const reset = () => {
  store.clear();
  commitCount = 0; failCommitsFrom = Infinity; recursiveDeleteError = null; recursiveDeleteCalls = [];
  mp.searchCalls = []; mp.updateCalls = []; mp.results = []; mp.searchError = null; mp.updateErrorIds = new Set();
  logs.length = 0;

  // Liga L: criador "dono", mais um admin, jogador, pendente e rejeitado
  store.set('leagues/L', { name: 'Liga L', slug: 'L', ownerId: 'dono', plan: 'trial', subscriptionPlan: 'monthly', subscriptionActiveUntil: '2099-01-01T00:00:00.000Z' });
  store.set('users/dono', { email: 'dono@x.com', displayName: 'Dono', role: 'pending', leagues: { L: { role: 'admin', joinedAt: '2026-01-01' } } });
  store.set('users/adm', { email: 'adm@x.com', displayName: 'Adm', role: 'pending', leagues: { L: { role: 'admin', joinedAt: '2026-02-01' } } });
  store.set('users/ana', { email: 'ana@x.com', displayName: 'Ana', role: 'pending', playerKey: 'ana', fcmTokens: ['t1'], leagues: { L: { role: 'player', playerKey: 'ana', earnedBadges: ['a'], joinedAt: '2026-03-01' } } });
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { L: { role: 'pending', joinedAt: '2026-04-01' } } });
  store.set('users/rej', { email: 'rej@x.com', role: 'pending', leagues: { L: { role: 'rejected', joinedAt: '2026-04-02' } } });
  store.set('users/ana2', { email: 'ana2@x.com', role: 'pending', leagues: { L: { role: 'player' }, B: { role: 'player', playerKey: 'ana2' } } });
  store.set('users/fora', { email: 'fora@x.com', role: 'pending', leagues: {} });
  // Tudo que a liga guarda, inclusive uma subcoleção dentro de um campeonato
  store.set('leagues/L/championships/c1', { date: '2026-01-01', status: 'completed' });
  store.set('leagues/L/championships/c1/extra/x', { n: 1 });
  store.set('leagues/L/player_registry/ana', { name: 'Ana' });
  store.set('leagues/L/player_titles/ana', { name: 'Ana', titles: 1 });
  store.set('leagues/L/player_photos/ana', { url: 'https://res.cloudinary.com/fwtyio7l/x.jpg', uid: 'ana', updatedAt: 'x' });
  store.set('leagues/L/contacts/ana', { whatsapp: '11988880002' });
  store.set('leagues/L/financeiro_config/main', { valorMensalidade: 50 });
  store.set('leagues/L/financeiro_mensalidades/2026-01', { pagamentos: { Ana: true } });
  store.set('leagues/L/financeiro_despesas/d1', { valor: 10 });
  store.set('leagues/L/financeiro_avulsos/a1', { nome: 'Zé', valor: 20 });
  store.set('leagues/L/mensalidade_lembretes/m1', { players: ['Ana'] });
  store.set('leagues/L/app_config/main', { hasFinais: true });
  store.set('leagues/L/link_requests/pend', { uid: 'pend' });
  store.set('leagues/L/invite_tokens/t1', { role: 'player', used: false });
  // Outras ligas, uma delas com o id começando igual ("L2" não pode ser tocada por apagar "L")
  store.set('leagues/L2', { name: 'Liga L2', ownerId: 'dono2' });
  store.set('leagues/L2/player_registry/zeca', { name: 'Zeca' });
  store.set('users/dono2', { email: 'dono2@x.com', role: 'pending', leagues: { L2: { role: 'admin' } } });
  store.set('leagues/B', { name: 'Liga B', ownerId: 'admB' });
  store.set('leagues/B/player_registry/bia', { name: 'Bia' });
  store.set('users/admB', { email: 'admB@x.com', role: 'pending', leagues: { B: { role: 'admin' } } });
  // Liga antiga, sem criador registrado
  store.set('leagues/Velha', { name: 'Liga Velha' });
  store.set('leagues/Velha/player_registry/v1', { name: 'V1' });
  store.set('users/velho', { email: 'velho@x.com', role: 'pending', leagues: { Velha: { role: 'admin' } } });
  // Liga cujo criador já não é admin dela (saiu antes de existir a regra que passa a liga adiante)
  store.set('leagues/Orf', { name: 'Liga Órfã', ownerId: 'saiu' });
  store.set('leagues/Orf/player_registry/o1', { name: 'O1' });
  store.set('users/saiu', { email: 'saiu@x.com', role: 'pending', leagues: {} });
  store.set('users/outroadm', { email: 'outroadm@x.com', role: 'pending', leagues: { Orf: { role: 'admin' } } });
};

(async () => {
  // ───────── pedido inválido ─────────
  reset();
  const before = snapshot();
  // zera o contador de chamadas por minuto entre as verificações (o limite é testado no fim)
  const dl = (data, auth) => { [...store.keys()].filter(k => k.startsWith('rate_limits/')).forEach(k => store.delete(k)); return del(data, auth); };
  check('sem login', await codeOf(dl({ liga: 'L', confirm: true })) === 'unauthenticated');
  check('liga inválida (path traversal)', await codeOf(dl({ liga: '../x', confirm: true }, authOf('dono'))) === 'invalid-argument');
  check('liga vazia', await codeOf(dl({ liga: '', confirm: true }, authOf('dono'))) === 'invalid-argument');
  check('liga com tipo errado', await codeOf(dl({ liga: { $ne: 1 }, confirm: true }, authOf('dono'))) === 'invalid-argument');
  check('dados nulos', await codeOf(dl(null, authOf('dono'))) === 'invalid-argument');
  check('sem confirmação', await codeOf(dl({ liga: 'L' }, authOf('dono'))) === 'invalid-argument');
  check('confirmação falsa', await codeOf(dl({ liga: 'L', confirm: false }, authOf('dono'))) === 'invalid-argument');
  check('confirmação como texto "true" não vale', await codeOf(dl({ liga: 'L', confirm: 'true' }, authOf('dono'))) === 'invalid-argument');
  check('liga que não existe', await codeOf(dl({ liga: 'naoexiste', confirm: true }, authOf('dono'))) === 'not-found');
  check('pedido inválido não apaga nada nem mexe no Mercado Pago', snapshot() === before && mp.searchCalls.length === 0 && mp.updateCalls.length === 0);

  // ───────── quem pode ─────────
  reset();
  for (const [uid, label] of [['ana', 'jogador'], ['pend', 'pendente'], ['rej', 'rejeitado'], ['fora', 'conta sem liga'], ['admB', 'admin de OUTRA liga'], ['fantasma', 'conta sem cadastro']]) {
    check(`${label} não encerra a liga`, await codeOf(del({ liga: 'L', confirm: true }, authOf(uid))) === 'permission-denied');
  }
  const owner2 = await errOf(del({ liga: 'L', confirm: true }, authOf('adm')));
  check('admin que NÃO criou a liga não encerra enquanto o criador ainda é admin', owner2 && owner2.code === 'permission-denied' && /quem criou/.test(owner2.message), owner2);
  check('e-mail do dono do sistema SEM verificação não vale', await codeOf(del({ liga: 'L', confirm: true }, authOf('fora', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'permission-denied');
  check('negativas não apagam nada nem chamam o Mercado Pago', snapshot() === before && mp.searchCalls.length === 0 && mp.updateCalls.length === 0 && recursiveDeleteCalls.length === 0);

  // permitidos
  reset();
  check('o criador encerra a liga', (await del({ liga: 'L', confirm: true }, authOf('dono'))).ok === true && !store.has('leagues/L'));
  reset();
  check('liga antiga, sem criador registrado: qualquer admin encerra', (await del({ liga: 'Velha', confirm: true }, authOf('velho'))).ok === true && !store.has('leagues/Velha'));
  reset();
  check('criador que já não é admin da liga: outro admin encerra', (await del({ liga: 'Orf', confirm: true }, authOf('outroadm'))).ok === true && !store.has('leagues/Orf'));
  reset();
  check('dono do sistema (e-mail verificado) encerra uma liga em que nem participa', (await del({ liga: 'L', confirm: true }, authOf('fora', { email: 'castanho.caiop@gmail.com', email_verified: true }))).ok === true && !store.has('leagues/L'));

  // ───────── o que é apagado ─────────
  reset();
  const b2 = JSON.stringify(under('leagues/B')), l2 = JSON.stringify(under('leagues/L2')), velha = JSON.stringify(under('leagues/Velha'));
  const keepOthers = ['dono2', 'admB', 'velho', 'fora', 'saiu', 'outroadm'].map(u => JSON.stringify(user(u)));
  const res = await del({ liga: 'L', confirm: true }, authOf('dono'));
  check('devolve ok', res.ok === true, res);
  check('a liga e TUDO que há dentro some (inclusive subcoleção de campeonato)', under('leagues/L').length === 0, under('leagues/L'));
  check('apagar "L" não toca em "L2" (mesmo começo de id), "B" nem nas outras ligas', JSON.stringify(under('leagues/L2')) === l2 && JSON.stringify(under('leagues/B')) === b2 && JSON.stringify(under('leagues/Velha')) === velha);
  for (const u of ['dono', 'adm', 'ana', 'pend', 'rej', 'ana2']) {
    check(`membro ${u}: perde o vínculo com a liga`, user(u) && !user(u).leagues.L, user(u));
  }
  check('o cadastro das pessoas continua (só o vínculo com a liga sai)', ['dono', 'adm', 'ana', 'pend', 'rej', 'ana2'].every(u => store.has('users/' + u)) && user('ana').email === 'ana@x.com' && user('ana').fcmTokens[0] === 't1' && user('ana').playerKey === 'ana');
  check('quem está em duas ligas continua na outra', user('ana2').leagues.B.role === 'player' && user('ana2').leagues.B.playerKey === 'ana2', user('ana2'));
  check('quem não é da liga não é tocado', ['dono2', 'admB', 'velho', 'fora', 'saiu', 'outroadm'].map(u => JSON.stringify(user(u))).every((s, i) => s === keepOthers[i]));
  const done = logs.find(l => l.level === 'info' && l.m === 'deleteLeague concluída');
  check('log de conclusão só com contagens (sem dado pessoal)', done && done.d.liga === 'L' && done.d.membros === 6 && done.d.assinaturasCanceladas === 0 && Object.keys(done.d).sort().join() === 'assinaturasCanceladas,liga,membros' && !/@|ana|dono/i.test(JSON.stringify(done.d)), done);
  check('repetir depois de concluído: liga não encontrada (e nada quebra)', await codeOf(del({ liga: 'L', confirm: true }, authOf('dono'))) === 'not-found');

  // muitos membros: o vínculo sai de todos, em mais de um lote
  reset();
  for (let i = 0; i < 1000; i++) store.set('users/m' + i, { email: `m${i}@x.com`, role: 'pending', leagues: { L: { role: i % 3 ? 'player' : 'pending' }, B: { role: 'player' } } });
  commitCount = 0;
  await del({ liga: 'L', confirm: true }, authOf('dono'));
  check('1000 membros extras: ninguém fica ligado à liga apagada e todos mantêm a outra', [...store.keys()].filter(k => /^users\/m\d+$/.test(k)).every(k => !store.get(k).leagues.L && store.get(k).leagues.B.role === 'player'));
  check('o trabalho é dividido em lotes (nunca passa de 400 por lote)', commitCount >= 3, commitCount);

  // ───────── Mercado Pago ─────────
  reset();
  mp.results = [
    { id: 'a1', external_reference: 'L', status: 'authorized' },
    { id: 'a2', external_reference: 'L', status: 'paused' },
    { id: 'a3', external_reference: 'L', status: 'pending' },
    { id: 'a4', external_reference: 'L', status: 'cancelled' },     // já cancelada: não mexe
    { id: 'x1', external_reference: 'L2', status: 'authorized' },    // OUTRA liga: nunca pode ser cancelada
    { id: 'x2', external_reference: 'B', status: 'authorized' },
    { id: 'x3', status: 'authorized' },                              // sem referência
  ];
  await del({ liga: 'L', confirm: true }, authOf('dono'));
  check('busca as assinaturas pela referência da liga', mp.searchCalls.length === 1 && mp.searchCalls[0].external_reference === 'L', mp.searchCalls);
  check('cancela as da liga que estão ativas, pausadas ou pendentes', JSON.stringify(mp.updateCalls.map(c => c.id).sort()) === JSON.stringify(['a1', 'a2', 'a3']) && mp.updateCalls.every(c => c.body.status === 'cancelled'), mp.updateCalls);
  check('NUNCA cancela a assinatura de outra liga, nem a já cancelada', !mp.updateCalls.some(c => ['x1', 'x2', 'x3', 'a4'].includes(c.id)));
  check('a liga foi apagada depois do cancelamento', !store.has('leagues/L'));
  check('o log diz quantas assinaturas foram canceladas', logs.some(l => l.m === 'deleteLeague concluída' && l.d.assinaturasCanceladas === 3), logs);

  reset();
  await del({ liga: 'L', confirm: true }, authOf('dono'));
  check('liga sem assinatura: consulta uma vez e não cancela nada', mp.searchCalls.length === 1 && mp.updateCalls.length === 0);

  // paginação: a assinatura da liga está na 3ª página
  reset();
  mp.results = Array.from({ length: 120 }, (_, i) => ({ id: 'o' + i, external_reference: 'B', status: 'authorized' }));
  mp.results.push({ id: 'alvo', external_reference: 'L', status: 'authorized' });
  await del({ liga: 'L', confirm: true }, authOf('dono'));
  check('percorre as páginas até achar a assinatura da liga', mp.searchCalls.length === 3 && mp.searchCalls.map(c => c.offset).join() === '0,50,100', mp.searchCalls);
  check('cancela só a da liga, mesmo no meio de 120 de outras', mp.updateCalls.length === 1 && mp.updateCalls[0].id === 'alvo', mp.updateCalls);

  // falha ao consultar o Mercado Pago: nada é apagado
  reset();
  mp.searchError = 'sem conexão';
  const b3 = snapshot();
  const e1 = await errOf(del({ liga: 'L', confirm: true }, authOf('dono')));
  check('Mercado Pago fora do ar na consulta → recusa, dizendo que nada foi apagado', e1 && e1.code === 'failed-precondition' && /Nada foi apagado/.test(e1.message), e1);
  check('…e o banco continua exatamente como estava (nem marca de encerramento)', snapshot() === b3 && recursiveDeleteCalls.length === 0);
  check('…e o dono pode tentar de novo quando o Mercado Pago voltar', (mp.searchError = null, (await del({ liga: 'L', confirm: true }, authOf('dono'))).ok === true) && !store.has('leagues/L'));

  // falha ao cancelar uma assinatura que cobra: nada é apagado
  reset();
  mp.results = [{ id: 'a1', external_reference: 'L', status: 'authorized' }, { id: 'a2', external_reference: 'L', status: 'paused' }];
  mp.updateErrorIds = new Set(['a1']);
  const b4 = snapshot();
  const e2 = await errOf(del({ liga: 'L', confirm: true }, authOf('dono')));
  check('assinatura ativa que o Mercado Pago não cancela → recusa, nada foi apagado', e2 && e2.code === 'failed-precondition' && /Nada foi apagado/.test(e2.message), e2);
  check('…banco intacto, sem marca de encerramento', snapshot() === b4 && recursiveDeleteCalls.length === 0);
  mp.updateErrorIds = new Set();
  check('…repetir com o Mercado Pago de volta conclui', (await del({ liga: 'L', confirm: true }, authOf('dono'))).ok === true && !store.has('leagues/L'));

  // assinatura "pending" que não cancela: segue (não cobra nada) e avisa no log
  reset();
  mp.results = [{ id: 'p1', external_reference: 'L', status: 'pending' }];
  mp.updateErrorIds = new Set(['p1']);
  check('assinatura pendente que não cancela não trava o encerramento', (await del({ liga: 'L', confirm: true }, authOf('dono'))).ok === true && !store.has('leagues/L'));
  check('…mas fica registrado no log', logs.some(l => l.level === 'warn' && /não cancelou/.test(l.m) && l.d.status === 'pending'), logs);

  // ───────── falhas no meio e retomada ─────────
  // 1) a exclusão da liga falha DEPOIS de os membros perderem o acesso
  reset();
  recursiveDeleteError = 'timeout simulado';
  const e3 = await errOf(del({ liga: 'L', confirm: true }, authOf('dono')));
  check('falha ao apagar → a função falha (não finge que deu certo)', !!e3);
  check('os membros já estavam sem acesso e a liga continua marcada como em encerramento', !user('dono').leagues.L && !user('ana').leagues.L && store.get('leagues/L').closingBy === 'dono' && !!store.get('leagues/L').closingAt, store.get('leagues/L'));
  check('outro ex-admin não consegue retomar o encerramento dos outros', await codeOf(del({ liga: 'L', confirm: true }, authOf('adm'))) === 'permission-denied');
  check('alguém de fora também não', await codeOf(del({ liga: 'L', confirm: true }, authOf('fora'))) === 'permission-denied');
  recursiveDeleteError = null;
  check('quem iniciou retoma, mesmo já sem vínculo com a liga, e conclui', (await del({ liga: 'L', confirm: true }, authOf('dono'))).ok === true && under('leagues/L').length === 0);

  // 2) a retirada dos vínculos falha no meio
  reset();
  for (let i = 0; i < 900; i++) store.set('users/m' + i, { email: `m${i}@x.com`, role: 'pending', leagues: { L: { role: 'player' } } });
  commitCount = 0; failCommitsFrom = 2; // o 1º lote passa, o 2º falha
  const e4 = await errOf(del({ liga: 'L', confirm: true }, authOf('dono')));
  check('falha na retirada dos vínculos → a função falha e a liga NÃO é apagada', !!e4 && store.has('leagues/L') && recursiveDeleteCalls.length === 0);
  failCommitsFrom = Infinity; commitCount = 0;
  check('repetir termina de tirar os vínculos e apaga a liga', (await del({ liga: 'L', confirm: true }, authOf('dono'))).ok === true && under('leagues/L').length === 0 && [...store.keys()].filter(k => /^users\/m\d+$/.test(k)).every(k => !store.get(k).leagues.L));

  // ───────── limite de chamadas ─────────
  reset();
  for (let i = 0; i < 5; i++) await codeOf(del({ liga: 'L', confirm: false }, authOf('ana')));
  check('a 6ª chamada em um minuto é barrada pelo limite', await codeOf(del({ liga: 'L', confirm: true }, authOf('ana'))) === 'resource-exhausted');
  check('o limite é por conta: outra conta não é afetada', await codeOf(del({ liga: 'L', confirm: false }, authOf('dono'))) === 'invalid-argument');

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
