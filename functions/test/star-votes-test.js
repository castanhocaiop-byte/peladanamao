// Estrelas pela média do grupo (item 35): as contas puras de functions/star-votes.js (validar as notas, contar os votos, o que publicar
// no cadastro de cada jogador, trocar de chave) e as funções ratePlayers e syncStarVotes, mais os ganchos de sair da liga, ser
// recusado ou ligado a outro jogador (manageMember), apagar a conta e anonimizar o nome. Firestore falso em memória (o mesmo do
// members-test.js). As regras do Firestore ficam no emulator-test.js.
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

const sv = require('../star-votes');

// retrato do banco SEM o contador de chamadas (rate_limits), que muda a cada chamada, aceita ou recusada
const snapshot = () => JSON.stringify([...store.entries()].filter(([k]) => !k.startsWith('rate_limits/')).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const REG = 'leagues/L/player_registry/';
const VOTE = uid => store.get('leagues/L/star_votes/' + uid);
const regOf = key => store.get(REG + key);
const rate = (uid, ratings, liga = 'L') => call(fns.ratePlayers, { liga, ratings }, authOf(uid));
const sync = (uid, data) => call(fns.syncStarVotes, data, authOf(uid));
const msgOf = async p => { try { await p; return ''; } catch (e) { return e.message; } };

const resetStars = () => {
  store.clear();
  const member = (uid, key, role = 'player') => store.set('users/' + uid, { email: uid + '@x.com', role: 'pending', playerKey: key, leagues: { L: { role, playerKey: key } } });
  member('u_ana', 'ana'); member('u_bia', 'bia'); member('u_caio', 'caio'); member('u_dani', 'dani'); member('u_eli', 'eli');
  member('u_adm', 'adm', 'admin'); member('u_ana2', 'ana');
  store.set('users/u_pend', { email: 'p@x.com', role: 'pending', leagues: { L: { role: 'pending', playerKey: 'ana' } } });
  store.set('users/u_fora', { email: 'f@x.com', role: 'pending', leagues: { B: { role: 'player', playerKey: 'zed' } } });
  store.set('users/u_semlink', { email: 's@x.com', role: 'pending', leagues: { L: { role: 'player' } } });
  store.set('users/u_admB', { email: 'ab@x.com', role: 'pending', leagues: { B: { role: 'admin' } } });
  store.set('leagues/L', { name: 'Liga L', ownerId: 'u_adm' });
  store.set('leagues/B', { name: 'Liga B', ownerId: 'u_admB' });
  store.set('leagues/L/app_config/main', { peerStars: true });
  for (const k of ['ana', 'bia', 'caio', 'dani', 'eli', 'adm']) store.set(REG + k, { name: k.toUpperCase(), added: '2026-01-01', active: true, stars: 3 });
  store.set(REG + 'ines', { name: 'Ines', added: '2026-01-01', active: false });
  store.set(REG + 'churras', { name: 'Churras', added: '2026-01-01', active: true, somenteChurrasco: true });
};

(async () => {
  // ═════════ parte pura: functions/star-votes.js ═════════
  const keys = new Set(['ana', 'bia', 'caio', 'dani']);

  check('neededVotes: metade de quem joga, nunca menos que 3', [0, 1, 4, 5, 6, 7, 10, 11, 20, 30].map(n => sv.neededVotes(n)).join() === '3,3,3,3,3,4,5,6,10,15', [0, 1, 4, 5, 6, 7, 10, 11, 20, 30].map(n => sv.neededVotes(n)));
  check('neededVotes: valor estranho vira o piso', sv.neededVotes(NaN) === 3 && sv.neededVotes(undefined) === 3 && sv.neededVotes(null) === 3 && sv.neededVotes('abc') === 3 && sv.neededVotes(-8) === 3);
  check('MIN_VOTES é 3 e o limite por chamada é 200', sv.MIN_VOTES === 3 && sv.MAX_KEYS === 200);
  check('isStar: só inteiros de 1 a 5', [1, 2, 3, 4, 5].every(sv.isStar) && [0, 6, 3.5, -1, '3', null, undefined, NaN, true, [3], {}].every(v => !sv.isStar(v)));

  const pr = (input, voterKey = 'ana') => sv.parseRatings(input, { voterKey, registryKeys: keys });
  check('parse: formato errado (nulo, lista, texto, número)', [null, undefined, [], [1], 'x', 5, true].every(v => pr(v).ok === false && pr(v).reason === 'shape'));
  check('parse: vazio é recusado', pr({}).reason === 'empty');
  const big = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['k' + i, 3]));
  check('parse: 200 jogadores passa e 201 é recusado', pr(big(200)).ok === true && pr(big(201)).reason === 'too-many');
  check('parse: chave inválida recusa a chamada inteira', ['a/b', 'a b', 'a.b', '..', 'x'.repeat(101), '', 'a"b', "a'b", 'a\nb'].every(k => pr({ bia: 3, [k]: 4 }).reason === 'key'));
  check('parse: chaves antigas (acento, hífen, maiúscula) são aceitas', pr({ 'João-Silva_2': null }).ok === true && pr({ 'João-Silva_2': null }).remove[0] === 'João-Silva_2');
  check('parse: nota fora de 1 a 5 recusa a chamada inteira, mesmo com notas boas junto', [0, 6, 3.5, -2, '3', true, [3], { a: 1 }, NaN, Infinity].every(v => pr({ bia: 4, caio: v }).reason === 'value'));
  let p = pr({ bia: 4, caio: null, dani: 1 });
  check('parse: dar e tirar nota', p.ok && JSON.stringify(p.set) === '{"bia":4,"dani":1}' && p.remove.join() === 'caio' && p.ignored.length === 0, p);
  p = pr({ ana: 5, bia: 2 });
  check('parse: nota em si mesmo é ignorada (e listada)', p.ok && JSON.stringify(p.set) === '{"bia":2}' && p.ignored.join() === 'ana', p);
  p = pr({ ana: null });
  check('parse: tirar a nota de si mesmo também é ignorado, não vira remoção', p.ok && p.remove.length === 0 && p.ignored.join() === 'ana', p);
  p = pr({ fantasma: 4, bia: 3 });
  check('parse: nota para quem não está no elenco é ignorada', p.ok && JSON.stringify(p.set) === '{"bia":3}' && p.ignored.join() === 'fantasma', p);
  p = pr({ fantasma: null });
  check('parse: tirar nota velha de quem saiu do elenco é permitido', p.ok && p.remove.join() === 'fantasma' && Object.keys(p.set).length === 0, p);
  p = pr(JSON.parse('{"__proto__": 4, "bia": 2}'));
  check('parse: chave "__proto__" vinda de JSON não contamina nada (vira ignorada)', p.ok && p.ignored.join() === '__proto__' && ({}).polluted === undefined && Object.getPrototypeOf(p.set) === Object.prototype && JSON.stringify(p.set) === '{"bia":2}', p);

  const ap = (current, input, voterKey = 'ana') => sv.applyRatings(current, pr(input, voterKey), { voterKey, registryKeys: keys });
  check('apply: junta o que tinha com o que mandou, e tirar apaga', JSON.stringify(ap({ bia: 3, caio: 4 }, { bia: 5, caio: null, dani: 2 })) === '{"bia":5,"dani":2}');
  check('apply: sem nada antes (nulo, lista, texto) começa vazio', [undefined, null, 'x', 7].every(c => JSON.stringify(ap(c, { bia: 2 })) === '{"bia":2}'));
  check('apply: limpa nota de quem saiu do elenco, a própria nota e valores estranhos que tenham ficado', JSON.stringify(ap({ fantasma: 3, ana: 5, bia: 9, caio: '4', dani: 2 }, { bia: 1 })) === '{"dani":2,"bia":1}', ap({ fantasma: 3, ana: 5, bia: 9, caio: '4', dani: 2 }, { bia: 1 }));
  check('apply: lista no lugar do documento não vira notas', JSON.stringify(ap([5, 4], { bia: 2 })) === '{"bia":2}');

  const doc = (uid, voterKey, ratings, updatedAt = '2026-01-01T00:00:00.000Z') => ({ uid, voterKey, ratings, updatedAt });
  let t = sv.tally([doc('1', 'ana', { bia: 4, caio: 5 }), doc('2', 'caio', { bia: 2, ana: 1 }), doc('3', 'dani', { bia: 5 })], keys);
  check('tally: soma e conta os votos de cada jogador', t.get('bia').sum === 11 && t.get('bia').count === 3 && t.get('caio').sum === 5 && t.get('caio').count === 1 && t.get('ana').count === 1 && !t.has('dani'), [...t]);
  t = sv.tally([doc('1', 'ana', { ana: 5, bia: 4 })], keys);
  check('tally: voto em si mesmo não conta', !t.has('ana') && t.get('bia').count === 1);
  t = sv.tally([doc('1', 'fantasma', { bia: 4 }), doc('2', 'ana', { fantasma: 4, bia: 3 })], keys);
  check('tally: voto de quem saiu do elenco e voto em quem saiu não contam', t.get('bia').count === 1 && t.get('bia').sum === 3 && !t.has('fantasma'));
  t = sv.tally([doc('1', 'ana', { bia: 9, caio: '4', dani: 0, eli: 2.5 })], new Set([...keys, 'eli']));
  check('tally: nota fora de 1 a 5 no documento não conta', t.size === 0);
  t = sv.tally([doc('a', 'ana', { bia: 5 }, '2026-01-02'), doc('b', 'ana', { bia: 1 }, '2026-01-03')], keys);
  check('tally: duas contas no mesmo jogador valem UM voto: fica a mais recente', t.get('bia').count === 1 && t.get('bia').sum === 1);
  t = sv.tally([doc('a', 'ana', { bia: 5 }, '2026-01-03'), doc('b', 'ana', { bia: 1 }, '2026-01-03')], keys);
  check('tally: empate de data fica com o maior uid (resultado sempre o mesmo)', t.get('bia').sum === 1);
  t = sv.tally([doc('b', 'ana', { bia: 1 }, '2026-01-03'), doc('a', 'ana', { bia: 5 }, '2026-01-03')], keys);
  check('tally: …e não depende da ordem dos documentos', t.get('bia').sum === 1);
  check('tally: documentos estranhos são ignorados', sv.tally([null, undefined, 5, {}, { voterKey: 3 }, doc('x', 'ana', null), doc('y', 'ana', [5]), doc('z', 'ana', 'texto')], keys).size === 0);

  const rg = obj => new Map(Object.entries(obj));
  let pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: {} }), [doc('1', 'ana', { bia: 4, caio: 5 }), doc('2', 'caio', { bia: 5 })]);
  check('publish: 2 votos publicam só a quantidade (nunca a média)', JSON.stringify(pp.get('bia')) === '{"starsVotes":2}', pp.get('bia'));
  check('publish: 1 voto também só a quantidade, e quem não recebeu voto não ganha nada', JSON.stringify(pp.get('caio')) === '{"starsVotes":1}' && !pp.has('ana') && !pp.has('dani'), [...pp]);
  pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: {} }), [doc('1', 'ana', { caio: 5 }), doc('2', 'bia', { caio: 4 }), doc('3', 'dani', { caio: 4 })]);
  check('publish: a partir de 3 votos sai a média com 2 casas (13 ÷ 3 = 4,33)', pp.get('caio').starsVotes === 3 && pp.get('caio').starsAvg === 4.33, pp.get('caio'));
  pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: {}, eli: {} }), [doc('1', 'ana', { dani: 4 }), doc('2', 'bia', { dani: 5 }), doc('3', 'caio', { dani: 4 }), doc('4', 'eli', { dani: 4 })]);
  check('publish: 17 ÷ 4 = 4,25', pp.get('dani').starsAvg === 4.25);
  pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: {}, eli: {} }), [doc('1', 'ana', { dani: 4 }), doc('2', 'bia', { dani: 5 }), doc('3', 'caio', { dani: 4 }), doc('4', 'eli', { dani: 5 })]);
  check('publish: 18 ÷ 4 = 4,5', pp.get('dani').starsAvg === 4.5);
  pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: { starsVotes: 3, starsAvg: 4.33 } }), [doc('1', 'ana', { dani: 5 }), doc('2', 'bia', { dani: 4 }), doc('3', 'caio', { dani: 4 })]);
  check('publish: nada a mudar → nenhuma alteração (não grava à toa)', pp.size === 0, [...pp]);
  pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: { starsVotes: 3, starsAvg: 4.33 } }), [doc('1', 'ana', { dani: 5 }), doc('2', 'bia', { dani: 4 })]);
  check('publish: caiu para 2 votos → a média é apagada (null) e a contagem atualizada', JSON.stringify(pp.get('dani')) === '{"starsVotes":2,"starsAvg":null}', pp.get('dani'));
  pp = sv.publishPatches(rg({ ana: {}, bia: { starsVotes: 2 }, caio: {}, dani: {} }), []);
  check('publish: sem nenhum voto → campos apagados', pp.get('bia').starsVotes === null && !('starsAvg' in pp.get('bia')) && pp.size === 1, [...pp]);
  pp = sv.publishPatches(rg({ ana: {}, bia: {}, caio: {}, dani: {} }), [doc('1', 'fantasma', { bia: 5 })]);
  check('publish: voto de quem não está no elenco não publica nada', pp.size === 0);

  const vmap = o => new Map(Object.entries(o));
  let rn = sv.renameKey(vmap({ u1: doc('u1', 'ana', { bia: 4, caio: 2 }), u2: doc('u2', 'caio', { ana: 5, bia: 3 }), u3: doc('u3', 'dani', { caio: 1 }) }), 'ana', 'ana_nova');
  check('renameKey: troca a chave de quem votou e a chave de quem recebeu, só nos documentos que mudam', Object.keys(rn).sort().join() === 'u1,u2' && rn.u1.voterKey === 'ana_nova' && JSON.stringify(rn.u1.ratings) === '{"bia":4,"caio":2}' && rn.u2.voterKey === 'caio' && JSON.stringify(rn.u2.ratings) === '{"bia":3,"ana_nova":5}', rn);
  rn = sv.renameKey(vmap({ u1: doc('u1', 'bia', { ana: 4, caio: 2 }) }), 'ana', 'caio');
  check('renameKey: não sobrescreve uma nota que a pessoa já tinha na chave nova', JSON.stringify(rn.u1.ratings) === '{"caio":2}', rn);
  rn = sv.renameKey(vmap({ u1: doc('u1', 'ana', { ana: 5, bia: 4 }) }), 'ana', 'ana_nova');
  check('renameKey: nunca deixa a pessoa com nota em si mesma', rn.u1.voterKey === 'ana_nova' && !('ana' in rn.u1.ratings) && !('ana_nova' in rn.u1.ratings), rn);
  check('renameKey: documentos sem relação ou estranhos não mudam', Object.keys(sv.renameKey(vmap({ u1: doc('u1', 'dani', { caio: 1 }), u2: null, u3: 'x' }), 'ana', 'z')).length === 0);
  check('renameKey: preserva os outros campos do documento', (() => { const r = sv.renameKey(vmap({ u1: { ...doc('u1', 'ana', { bia: 4 }), extra: 7 } }), 'ana', 'z'); return r.u1.extra === 7 && r.u1.updatedAt === '2026-01-01T00:00:00.000Z'; })());

  // ═════════ funções: ratePlayers ═════════
  resetStars();
  check('rate: sem login', await codeOf(call(fns.ratePlayers, { liga: 'L', ratings: { bia: 3 } })) === 'unauthenticated');
  check('rate: liga inválida', await codeOf(rate('u_ana', { bia: 3 }, '../x')) === 'invalid-argument');
  check('rate: quem não é da liga não pode', await codeOf(rate('u_fora', { bia: 3 })) === 'permission-denied');
  check('rate: pendente não pode', await codeOf(rate('u_pend', { bia: 3 })) === 'permission-denied');
  check('rate: usuário sem documento não pode', await codeOf(rate('fantasma', { bia: 3 })) === 'permission-denied');
  check('rate: sem jogador ligado à conta → pré-condição falhou, dizendo que a conta não está vinculada', await codeOf(rate('u_semlink', { bia: 3 })) === 'failed-precondition' && /vinculada/.test(await msgOf(rate('u_semlink', { bia: 3 }))));
  check('rate: nada foi gravado nas negativas', !store.has('leagues/L/star_votes/u_fora') && !store.has('leagues/L/star_votes/u_pend') && !store.has('leagues/L/star_votes/u_semlink'));
  store.set('leagues/L/app_config/main', { peerStars: false });
  check('rate: opção desligada na liga → pré-condição falhou, dizendo que está desligada', await codeOf(rate('u_ana', { bia: 3 })) === 'failed-precondition' && /desligada/.test(await msgOf(rate('u_ana', { bia: 3 }))));
  store.set('leagues/L/app_config/main', {});
  check('rate: opção que nunca foi ligada', await codeOf(rate('u_ana', { bia: 3 })) === 'failed-precondition');
  store.set('leagues/L/app_config/main', { peerStars: 'true' });
  check('rate: só o valor verdadeiro (booleano) liga a opção', await codeOf(rate('u_ana', { bia: 3 })) === 'failed-precondition');
  store.delete('leagues/L/app_config/main');
  check('rate: liga sem configuração', await codeOf(rate('u_ana', { bia: 3 })) === 'failed-precondition');
  store.set('leagues/L/app_config/main', { peerStars: true });

  const before = snapshot();
  for (const [label, ratings, msg] of [
    ['nulo', null, /inválidas/], ['lista', [3], /inválidas/], ['vazio', {}, /Nenhuma nota/], ['nota 6', { bia: 6 }, /1 a 5/], ['nota 0', { bia: 0 }, /1 a 5/],
    ['nota quebrada', { bia: 2.5 }, /1 a 5/], ['nota texto', { bia: '3' }, /1 a 5/], ['nota booleana', { bia: true }, /1 a 5/], ['nota objeto', { bia: { a: 1 } }, /1 a 5/],
    ['chave com barra', { 'a/b': 3 }, /Jogador inválido/], ['chave de caminho', { 'users/x': 3 }, /Jogador inválido/], ['notas demais', Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['k' + i, 3])), /demais/],
    ['boa + ruim juntas', { bia: 4, caio: 9 }, /1 a 5/],
  ]) {
    let err = null; try { await rate('u_ana', ratings); } catch (e) { err = e; }
    check(`rate: ${label} → invalid-argument com mensagem clara`, err && err.code === 'invalid-argument' && msg.test(err.message), err && [err.code, err.message]);
  }
  check('rate: nenhuma recusa mudou o banco (fora o contador de chamadas)', snapshot() === before);
  check('rate: …o documento de notas nem foi criado', !store.has('leagues/L/star_votes/u_ana'));

  resetStars();
  let r1 = await rate('u_ana', { bia: 4, caio: 5 });
  check('rate: devolve o resumo', r1.ok === true && r1.total === 2 && r1.saved === 2 && r1.removed === 0 && r1.ignored.length === 0, r1);
  const v1 = VOTE('u_ana');
  check('rate: o documento fica no uid da conta, com a chave do jogador, as notas e a hora', v1 && v1.voterKey === 'ana' && JSON.stringify(v1.ratings) === '{"bia":4,"caio":5}' && /^\d{4}-\d\d-\d\dT/.test(v1.updatedAt) && !store.has('leagues/L/star_votes/ana'), v1);
  check('rate: 1 voto → o cadastro ganha só a contagem, SEM média', regOf('bia').starsVotes === 1 && !('starsAvg' in regOf('bia')) && regOf('caio').starsVotes === 1 && !('starsAvg' in regOf('caio')), [regOf('bia'), regOf('caio')]);
  check('rate: o resto do cadastro não muda (nome, estrela do admin, ativo)', regOf('bia').name === 'BIA' && regOf('bia').stars === 3 && regOf('bia').active === true && regOf('bia').added === '2026-01-01', regOf('bia'));
  check('rate: quem não recebeu voto não ganha campo nenhum', !('starsVotes' in regOf('dani')) && !('starsAvg' in regOf('dani')) && !('starsVotes' in regOf('ana')));

  await rate('u_bia', { caio: 3, dani: 2 });
  check('rate: 2 votos em caio → ainda sem média', regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')), regOf('caio'));
  await rate('u_dani', { caio: 4, ana: 1 });
  check('rate: 3 votos em caio (5, 3, 4) → média 4', regOf('caio').starsVotes === 3 && regOf('caio').starsAvg === 4, regOf('caio'));
  check('rate: a nota que ana recebeu (1 voto) e a de bia (1 voto) só têm contagem', regOf('ana').starsVotes === 1 && !('starsAvg' in regOf('ana')) && regOf('bia').starsVotes === 1, [regOf('ana'), regOf('bia')]);
  await rate('u_ana', { caio: 1 });
  check('rate: trocar a nota recalcula (1, 3, 4 → 2,67) e mantém as outras notas dela', regOf('caio').starsAvg === 2.67 && VOTE('u_ana').ratings.bia === 4 && VOTE('u_ana').ratings.caio === 1, [regOf('caio'), VOTE('u_ana')]);
  let r2 = await rate('u_ana', { caio: null });
  check('rate: tirar a nota recalcula; com 2 votos a média SOME do cadastro (o campo é apagado)', r2.removed === 1 && r2.total === 1 && regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')) && VOTE('u_ana').ratings.caio === undefined, [r2, regOf('caio')]);
  await rate('u_ana', { bia: null });
  check('rate: tirar a última nota apaga o documento da pessoa', !store.has('leagues/L/star_votes/u_ana'), VOTE('u_ana'));
  check('rate: …e a contagem de quem ela tinha avaliado baixa (bia sem votos; dani só com o voto de bia; ana com o de dani)', !('starsVotes' in regOf('bia')) && regOf('dani').starsVotes === 1 && regOf('ana').starsVotes === 1, [regOf('bia'), regOf('dani'), regOf('ana')]);

  resetStars();
  let rs = await rate('u_ana', { ana: 5 });
  check('rate: só nota em si mesmo → ignorada, nada é criado', rs.ok === true && rs.total === 0 && rs.saved === 0 && rs.ignored.join() === 'ana' && !store.has('leagues/L/star_votes/u_ana') && !('starsVotes' in regOf('ana')), rs);
  rs = await rate('u_ana', { ana: 5, bia: 2, fantasma: 4 });
  check('rate: ignora a si mesma e a quem não está no elenco, grava o resto', rs.saved === 1 && rs.ignored.sort().join() === 'ana,fantasma' && JSON.stringify(VOTE('u_ana').ratings) === '{"bia":2}', rs);
  check('rate: jogador inativo e "só churrasco" podem receber nota no servidor (a tela é que não os lista)', (await rate('u_ana', { ines: 4, churras: 5 })).saved === 2 && VOTE('u_ana').ratings.ines === 4 && regOf('ines').starsVotes === 1, VOTE('u_ana'));

  // limpeza de nota velha: o jogador saiu do elenco
  store.delete(REG + 'ines');
  await rate('u_ana', { caio: 3 });
  check('rate: a nota para quem saiu do elenco some do documento na próxima gravação', !('ines' in VOTE('u_ana').ratings) && VOTE('u_ana').ratings.caio === 3, VOTE('u_ana'));
  store.set('leagues/L/star_votes/u_ana', { voterKey: 'ana', ratings: { fantasma: 3, bia: 4 }, updatedAt: '2026-01-01T00:00:00.000Z' });
  check('rate: tirar a nota de quem já saiu do elenco é aceito', (await rate('u_ana', { fantasma: null })).removed === 1 && JSON.stringify(VOTE('u_ana').ratings) === '{"bia":4}', VOTE('u_ana'));

  // quem vota
  resetStars();
  check('rate: admin também vota', (await rate('u_adm', { bia: 5 })).saved === 1 && VOTE('u_adm').voterKey === 'adm');
  store.delete(REG + 'ana');
  check('rate: jogador que foi removido do elenco não vota (e a mensagem diz que ele não está no elenco)', await codeOf(rate('u_ana', { bia: 3 })) === 'failed-precondition' && /no elenco/.test(await msgOf(rate('u_ana', { bia: 3 }))) && !store.has('leagues/L/star_votes/u_ana'));
  store.set(REG + 'ana', { name: 'ANA', active: false });
  check('rate: jogador inativo ainda vota (continua no elenco)', await codeOf(rate('u_ana', { bia: 3 })) === 'ok');
  resetStars();
  store.set('users/u_top', { email: 't@x.com', role: 'pending', playerKey: 'ana', leagues: { L: { role: 'player' } } });
  await rate('u_top', { bia: 2 });
  check('rate: vínculo antigo no topo do cadastro também vale', VOTE('u_top') && VOTE('u_top').voterKey === 'ana');

  // duas contas no mesmo jogador = um voto
  resetStars();
  await rate('u_ana', { caio: 5 });
  await new Promise(r => setTimeout(r, 5));
  await rate('u_ana2', { caio: 1 });
  await rate('u_bia', { caio: 4 });
  check('rate: duas contas ligadas ao mesmo jogador valem UM voto só (a mais recente)', regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')), regOf('caio'));
  await rate('u_dani', { caio: 4 });
  check('rate: …e a média usa a nota da conta mais recente ((1+4+4)÷3 = 3)', regOf('caio').starsVotes === 3 && regOf('caio').starsAvg === 3, regOf('caio'));

  // outra liga não é tocada
  resetStars();
  store.set('leagues/B/player_registry/zed', { name: 'Zed' });
  const outra = JSON.stringify(store.get('leagues/B/player_registry/zed'));
  await rate('u_ana', { bia: 4 });
  check('rate: não mexe no cadastro de outra liga', JSON.stringify(store.get('leagues/B/player_registry/zed')) === outra && ![...store.keys()].some(k => k.startsWith('leagues/B/star_votes')));
  check('rate: voto numa liga em que a conta não está é negado', await codeOf(rate('u_ana', { zed: 4 }, 'B')) === 'permission-denied');

  // limite de chamadas
  resetStars();
  let limited = 'ok';
  for (let i = 0; i < 31 && limited === 'ok'; i++) limited = await codeOf(rate('u_eli', { bia: 1 + (i % 5) }));
  check('rate: passa de 30 chamadas por minuto → resource-exhausted', limited === 'resource-exhausted');
  check('rate: …e quem não abusou continua podendo', await codeOf(rate('u_bia', { caio: 3 })) === 'ok');

  // ═════════ funções: syncStarVotes ═════════
  resetStars();
  check('sync: sem login', await codeOf(call(fns.syncStarVotes, { liga: 'L' })) === 'unauthenticated');
  check('sync: jogador comum não pode', await codeOf(sync('u_ana', { liga: 'L' })) === 'permission-denied');
  check('sync: admin de OUTRA liga não pode', await codeOf(sync('u_admB', { liga: 'L' })) === 'permission-denied');
  check('sync: e-mail do dono sem verificação não vale', await codeOf(call(fns.syncStarVotes, { liga: 'L' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'permission-denied');
  check('sync: dono do sistema (e-mail verificado) pode', await codeOf(call(fns.syncStarVotes, { liga: 'L' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: true }))) === 'ok');
  check('sync: liga inválida', await codeOf(sync('u_adm', { liga: 'a/b' })) === 'invalid-argument');
  let sr = await sync('u_adm', { liga: 'L' });
  check('sync: sem nenhuma nota guardada não faz nada', sr.ok === true && sr.changed === false);
  for (const bad of [{ from: 'ana', to: 'ana' }, { from: 'ana' }, { to: 'ana' }, { from: 'a/b', to: 'x' }, { from: 'ana', to: 'x y' }, 'texto', 5, { from: { a: 1 }, to: 'z' }, { from: 'x'.repeat(101), to: 'z' }]) {
    check(`sync: troca de chave inválida ${JSON.stringify(bad).slice(0, 30)}`, await codeOf(sync('u_adm', { liga: 'L', rename: bad })) === 'invalid-argument');
  }

  // jogador removido do elenco: as notas dele deixam de valer
  await rate('u_ana', { caio: 5, dani: 4 });
  await rate('u_bia', { caio: 4, dani: 3 });
  await rate('u_dani', { caio: 3 });
  await rate('u_eli', { dani: 5 });
  check('sync: antes — caio com 3 votos (média 4) e dani com 3 votos', regOf('caio').starsAvg === 4 && regOf('dani').starsVotes === 3 && regOf('dani').starsAvg === 4, [regOf('caio'), regOf('dani')]);
  store.delete(REG + 'bia');
  sr = await sync('u_adm', { liga: 'L' });
  check('sync: depois de remover "bia" do elenco, as notas DELA saem da conta (caio 2 votos, sem média)', sr.changed === true && regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')) && regOf('dani').starsVotes === 2 && !('starsAvg' in regOf('dani')), [regOf('caio'), regOf('dani')]);
  const s0 = snapshot(); await sync('u_adm', { liga: 'L' });
  check('sync: repetir não muda o banco', snapshot() === s0);

  // renomear: as notas acompanham
  resetStars();
  await rate('u_ana', { bia: 5, caio: 4 });
  await rate('u_bia', { caio: 3, ana: 2 });
  await rate('u_dani', { bia: 4, caio: 2 });
  await rate('u_eli', { bia: 3 });
  check('sync/renomear: antes — bia tem 3 votos (5, 4, 3 → média 4)', regOf('bia').starsVotes === 3 && regOf('bia').starsAvg === 4, regOf('bia'));
  // o admin renomeou bia → bianca no app: cadastro novo, cadastro antigo apagado, conta ligada ao jogador novo
  store.set(REG + 'bianca', { name: 'Bianca', added: '2026-01-01', active: true, stars: 3, starsPinned: true });
  store.delete(REG + 'bia');
  store.set('users/u_bia', { ...store.get('users/u_bia'), playerKey: 'bianca', leagues: { L: { role: 'player', playerKey: 'bianca' } } });
  await sync('u_adm', { liga: 'L', rename: { from: 'bia', to: 'bianca' } });
  check('sync/renomear: as notas que bia RECEBEU passam para bianca (cadastro novo com a média)', regOf('bianca').starsVotes === 3 && regOf('bianca').starsAvg === 4 && VOTE('u_ana').ratings.bianca === 5 && !('bia' in VOTE('u_ana').ratings) && VOTE('u_dani').ratings.bianca === 4, [regOf('bianca'), VOTE('u_ana')]);
  check('sync/renomear: as notas que bia DEU passam a ser de bianca e ainda contam', VOTE('u_bia').voterKey === 'bianca' && regOf('caio').starsVotes === 3 && regOf('ana').starsVotes === 1, [VOTE('u_bia'), regOf('caio')]);
  check('sync/renomear: o resto do cadastro novo (estrela fixada) não é tocado', regOf('bianca').starsPinned === true && regOf('bianca').stars === 3 && regOf('bianca').name === 'Bianca');
  check('sync/renomear: ninguém ficou com nota em si mesmo', Object.values(Object.fromEntries([...store].filter(([k]) => k.includes('/star_votes/')))).every(d => !(d.voterKey in d.ratings)));

  // ═════════ ganchos: sair da liga, ser recusado, trocar de jogador, apagar a conta ═════════
  const seed3 = async () => {
    resetStars();
    await rate('u_ana', { caio: 5, bia: 4 });
    await rate('u_bia', { caio: 3 });
    await rate('u_dani', { caio: 4, ana: 2 });
  };
  await seed3();
  check('ganchos: ponto de partida — caio com 3 votos (média 4)', regOf('caio').starsAvg === 4 && regOf('caio').starsVotes === 3);
  await call(fns.leaveLeague, { liga: 'L' }, authOf('u_bia'));
  check('sair da liga: as notas que a pessoa deu somem e a média é refeita sem elas', !store.has('leagues/L/star_votes/u_bia') && regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')) && VOTE('u_ana') && VOTE('u_dani'), regOf('caio'));
  await seed3();
  await call(fns.leaveLeague, { liga: 'L' }, authOf('u_eli'));
  check('sair da liga: quem não deu nota não mexe em nada', regOf('caio').starsVotes === 3 && regOf('caio').starsAvg === 4 && VOTE('u_bia'));
  await seed3();
  store.set('users/u_bia', { ...store.get('users/u_bia'), leagues: { L: { role: 'player', playerKey: 'bia' }, B: { role: 'player', playerKey: 'zed' } } });
  await call(fns.leaveLeague, { liga: 'B' }, authOf('u_bia'));
  check('sair de OUTRA liga não leva as notas desta', VOTE('u_bia') && regOf('caio').starsVotes === 3);

  await seed3();
  const mm = (data, uid = 'u_adm') => call(fns.manageMember, data, authOf(uid));
  await mm({ liga: 'L', uid: 'u_bia', action: 'reject' });
  check('recusar a conta: as notas que ela deu somem e a média é refeita', !store.has('leagues/L/star_votes/u_bia') && regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')), regOf('caio'));
  await seed3();
  await mm({ liga: 'L', uid: 'u_bia', action: 'link', playerKey: 'bia' });
  check('ligar a conta ao MESMO jogador: as notas continuam valendo', VOTE('u_bia') && regOf('caio').starsVotes === 3);
  await mm({ liga: 'L', uid: 'u_bia', action: 'link', playerKey: 'eli' });
  check('ligar a conta a OUTRO jogador: as notas que ela deu como o jogador antigo somem', !store.has('leagues/L/star_votes/u_bia') && regOf('caio').starsVotes === 2, regOf('caio'));
  await seed3();
  await mm({ liga: 'L', uid: 'u_bia', action: 'link', playerKey: '' });
  check('desvincular a conta do jogador: as notas somem', !store.has('leagues/L/star_votes/u_bia') && regOf('caio').starsVotes === 2);
  await seed3();
  await mm({ liga: 'L', uid: 'u_bia', action: 'linkRequest', approve: true, playerKey: 'eli' });
  check('aprovar pedido de vínculo com outro jogador: as notas antigas somem', !store.has('leagues/L/star_votes/u_bia') && regOf('caio').starsVotes === 2);
  await seed3();
  await mm({ liga: 'L', uid: 'u_bia', action: 'linkRequest', approve: false, playerKey: 'eli' });
  check('recusar o pedido de vínculo (mesmo com um jogador indicado) não mexe nas notas', VOTE('u_bia') && regOf('caio').starsVotes === 3);
  await mm({ liga: 'L', uid: 'u_bia', action: 'promote' });
  check('promover a admin não mexe nas notas', VOTE('u_bia') && regOf('caio').starsVotes === 3);
  await mm({ liga: 'L', uid: 'u_eli', action: 'reject' });
  check('recusar quem nunca deu nota não mexe em nada', regOf('caio').starsVotes === 3 && regOf('caio').starsAvg === 4);

  await seed3();
  let del = await call(fns.deleteMyAccount, { confirm: true }, authOf('u_bia'));
  check('apagar a conta: as notas que a pessoa deu somem e a média é refeita', del.ok === true && !store.has('leagues/L/star_votes/u_bia') && regOf('caio').starsVotes === 2 && !('starsAvg' in regOf('caio')), regOf('caio'));
  check('apagar a conta: o jogador e as notas que ele RECEBEU continuam no elenco (registro esportivo da liga)', !!regOf('bia') && regOf('bia').starsVotes === 1 && VOTE('u_ana').ratings.bia === 4, regOf('bia'));
  await seed3();
  del = await call(fns.deleteMyAccount, { confirm: true }, authOf('u_eli'));
  check('apagar a conta de quem nunca deu nota funciona e não mexe nas notas dos outros', del.ok === true && regOf('caio').starsVotes === 3 && regOf('caio').starsAvg === 4);

  // anonimizar o nome
  await seed3();
  store.set(REG + 'ana', { ...regOf('ana'), starsPinned: true, goleiro: true, somenteChurrasco: true });
  const am = await call(fns.anonymizeMyName, { liga: 'L' }, authOf('u_ana'));
  const nk = am.newKey;
  check('anonimizar: o jogador novo herda a média que o grupo deu e a estrela fixada', !store.has(REG + 'ana') && regOf(nk).starsVotes === 1 && regOf(nk).starsPinned === true, regOf(nk));
  check('anonimizar: o goleiro continua goleiro e quem só vai ao churrasco continua fora do sorteio (antes esses dois campos se perdiam)', regOf(nk).goleiro === true && regOf(nk).somenteChurrasco === true, regOf(nk));
  check('anonimizar: as notas que ele DEU passam para a chave nova (continuam valendo)', VOTE('u_ana').voterKey === nk && VOTE('u_ana').ratings.caio === 5 && regOf('caio').starsVotes === 3 && regOf('caio').starsAvg === 4, [VOTE('u_ana'), regOf('caio')]);
  check('anonimizar: as notas que ele RECEBEU passam para a chave nova (dani deu 2)', VOTE('u_dani').ratings[nk] === 2 && !('ana' in VOTE('u_dani').ratings), VOTE('u_dani'));
  check('anonimizar: nenhum documento de notas guarda a chave antiga', ![...store].some(([k, d]) => k.includes('/star_votes/') && (d.voterKey === 'ana' || 'ana' in d.ratings)));
  const am2 = await call(fns.anonymizeMyName, { liga: 'L' }, authOf('u_ana'));
  check('anonimizar: repetir não quebra nem muda as notas', am2.ok === true && VOTE('u_ana').voterKey === nk && regOf('caio').starsVotes === 3);

  resetStars();
  const am3 = await call(fns.anonymizeMyName, { liga: 'L' }, authOf('u_bia'));
  check('anonimizar numa liga SEM notas guardadas: funciona e não cria documento de notas', am3.ok === true && ![...store.keys()].some(k => k.includes('/star_votes/')));
  check('anonimizar: quem NÃO era goleiro nem "só churrasco" não ganha esses campos', !('goleiro' in regOf(am3.newKey)) && !('somenteChurrasco' in regOf(am3.newKey)) && regOf(am3.newKey).stars === 3, regOf(am3.newKey));
})().then(() => {
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
}).catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
