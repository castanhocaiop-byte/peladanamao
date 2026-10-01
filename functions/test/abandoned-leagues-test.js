const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória (mesma base de members-test.js) ──────────────
const store = new Map();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const DELETE = { __delete: true };
const FieldValue = { delete: () => DELETE, arrayRemove: t => ({ __arrayRemove: t }), increment: n => ({ __increment: n }) };

function applyUpdate(data, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') args = Object.entries(args[0]).flat();
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

const fakeDb = {
  doc: p => refOf(p),
  collection: name => {
    const inCol = p => new RegExp('^' + name + '/[^/]+$').test(p);
    const valueAt = (obj, field) => (field instanceof FieldPath ? field.segments : String(field).split('.'))
      .reduce((o, s) => (o == null ? undefined : o[s]), obj);
    const build = (filters, lim) => ({
      where: (f, op, v) => build([...filters, [f, op, v]], lim),
      limit: n => build(filters, n),
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
const callableOpts = [];
const logs = [];
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({}),
};

// ── captura chamadas de rede (Resend) ────────────────────────────────────────
const fetchCalls = [];
let fetchShouldFail = false;
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
  if (fetchShouldFail) return { ok: false, status: 500, text: async () => 'erro simulado' };
  return { ok: true, status: 200, json: async () => ({ id: 'email-fake' }) };
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => { callableOpts.push(opts); return h; }, onRequest: (opts, h) => h, HttpsError };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (opts, h) => h };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'fake-resend-key' }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
  // Mínimo para o módulo carregar: este arquivo não exercita o fluxo de pagamento.
  if (request === 'mercadopago') return {
    MercadoPagoConfig: class { constructor() {} },
    PreApproval: class { async create() { return {}; } async get() { return {}; } },
    Preference: class { async create() { return {}; } },
    Payment: class { async get() { return {}; } },
    WebhookSignatureValidator: class { static validate() {} },
  };
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
const authOf = uid => ({ uid });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
const reset = () => { store.clear(); fetchCalls.length = 0; fetchShouldFail = false; };

(async () => {
  // ───────── touchLeagueActivity ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/ana', { email: 'ana@x.com', leagues: { L: { role: 'player' } } });
  store.set('users/fora', { email: 'fora@x.com', leagues: {} });

  check('touch: sem login', await codeOf(call(fns.touchLeagueActivity, { liga: 'L' })) === 'unauthenticated');
  check('touch: quem não participa não pode', await codeOf(call(fns.touchLeagueActivity, { liga: 'L' }, authOf('fora'))) === 'permission-denied');
  check('touch: liga inválida', await codeOf(call(fns.touchLeagueActivity, { liga: '../x' }, authOf('ana'))) === 'invalid-argument');

  const before = Date.now();
  await call(fns.touchLeagueActivity, { liga: 'L' }, authOf('ana'));
  const lastActivityAt = store.get('leagues/L').lastActivityAt;
  check('touch: grava lastActivityAt recente', !!lastActivityAt && new Date(lastActivityAt).getTime() >= before);

  // ───────── checkAbandonedLeagues: aviso ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L', lastActivityAt: daysAgo(340) }); // > 335 dias
  store.set('users/adm1', { email: 'adm1@x.com', leagues: { L: { role: 'admin' } } });
  store.set('users/adm2', { email: 'adm2@x.com', leagues: { L: { role: 'admin' } } });
  store.set('users/jog', { email: 'jog@x.com', leagues: { L: { role: 'player' } } });

  await fns.checkAbandonedLeagues();
  check('aviso: grava abandonmentWarnedAt', !!store.get('leagues/L').abandonmentWarnedAt);
  check('aviso: manda 1 e-mail (não 1 por admin)', fetchCalls.length === 1);
  check('aviso: destinatários são só os admins (não o jogador comum)',
    Array.isArray(fetchCalls[0]?.body?.to) &&
    fetchCalls[0].body.to.includes('adm1@x.com') && fetchCalls[0].body.to.includes('adm2@x.com') &&
    !fetchCalls[0].body.to.includes('jog@x.com'));
  check('aviso: remetente é o domínio verificado', !!fetchCalls[0]?.body?.from?.includes('notificacoes.peladanamao.com.br'));
  check('aviso: usa a chave do Resend no header', fetchCalls[0]?.headers?.Authorization === 'Bearer fake-resend-key');

  // Rodar de novo não deve mandar um segundo e-mail (já avisada e ainda dentro do prazo)
  await fns.checkAbandonedLeagues();
  check('aviso: não repete o e-mail antes do prazo de 30 dias', fetchCalls.length === 1);

  // ───────── checkAbandonedLeagues: liga reaberta depois do aviso ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L', lastActivityAt: daysAgo(1), abandonmentWarnedAt: daysAgo(10) }); // reaberta DEPOIS do aviso
  await fns.checkAbandonedLeagues();
  check('reaberta: remove abandonmentWarnedAt (permite novo ciclo)', store.get('leagues/L').abandonmentWarnedAt === undefined);
  check('reaberta: não anonimiza nada', !store.get('leagues/L').abandonmentAnonymizedAt);

  // ───────── checkAbandonedLeagues: anonimização após o prazo de carência ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L', lastActivityAt: daysAgo(340), abandonmentWarnedAt: daysAgo(35) }); // avisada há 35 dias, ninguém voltou
  store.set('users/adm1', { email: 'adm1@x.com', leagues: { L: { role: 'admin', playerKey: 'fulano' } } });
  store.set('leagues/L/player_registry/fulano', { name: 'Fulano', added: '2024-01-01', active: true });
  store.set('leagues/L/player_registry/ciclano', { name: 'Ciclano', added: '2024-01-01', active: true });
  store.set('leagues/L/player_titles/fulano', { name: 'Fulano', titles: 2 });
  store.set('leagues/L/championships/c1', {
    status: 'completed',
    champion_players: [{ name: 'Fulano' }],
    teamRosters: { vermelho: ['Fulano', 'Ciclano'] },
    matches: [{ id: 'm1', goals: [{ player: 'Fulano', team: 'vermelho' }] }],
  });

  await fns.checkAbandonedLeagues();
  check('anonimiza: grava abandonmentAnonymizedAt', !!store.get('leagues/L').abandonmentAnonymizedAt);
  check('anonimiza: não manda e-mail nessa passada (já tinha sido avisada)', fetchCalls.length === 0);
  check('anonimiza: cadastro antigo do Fulano sumiu', store.get('leagues/L/player_registry/fulano') === undefined);
  check('anonimiza: cadastro antigo do Ciclano sumiu', store.get('leagues/L/player_registry/ciclano') === undefined);

  const registryLeft = [...store.entries()].filter(([p]) => p.startsWith('leagues/L/player_registry/'));
  check('anonimiza: os 2 jogadores viraram 2 registros anônimos', registryLeft.length === 2 && registryLeft.every(([p]) => p.includes('jogador_anonimo_')));

  const novoFulanoKey = registryLeft.find(([, d]) => d.formerName === 'Fulano')?.[0]?.split('/').pop();
  check('anonimiza: a conta vinculada passa a apontar para o novo jogador', store.get('users/adm1').leagues.L.playerKey === novoFulanoKey);
  check('anonimiza: título migrado para o novo nome', !!store.get(`leagues/L/player_titles/${novoFulanoKey}`)?.name?.startsWith('Jogador Anônimo'));

  const champAfter = store.get('leagues/L/championships/c1');
  check('anonimiza: campeão do campeonato trocado', champAfter.champion_players[0].name.startsWith('Jogador Anônimo'));
  check('anonimiza: elenco do campeonato trocado (os 2 nomes)', champAfter.teamRosters.vermelho.every(n => n.startsWith('Jogador Anônimo')));
  check('anonimiza: gol do campeonato trocado', champAfter.matches[0].goals[0].player.startsWith('Jogador Anônimo'));

  // ───────── checkAbandonedLeagues: ciclo não se repete depois de anonimizada ─────────
  const beforeSecondRun = JSON.stringify([...store.entries()].filter(([p]) => p.startsWith('leagues/L/')));
  await fns.checkAbandonedLeagues();
  const afterSecondRun = JSON.stringify([...store.entries()].filter(([p]) => p.startsWith('leagues/L/')));
  check('anonimiza: rodar de novo não mexe mais na liga já processada', beforeSecondRun === afterSecondRun);

  // ───────── checkAbandonedLeagues: ainda dentro do prazo de carência ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L', lastActivityAt: daysAgo(340), abandonmentWarnedAt: daysAgo(10) }); // só 10 dias desde o aviso
  store.set('leagues/L/player_registry/fulano', { name: 'Fulano', added: '2024-01-01', active: true });
  await fns.checkAbandonedLeagues();
  check('dentro do prazo: não anonimiza ainda', !store.get('leagues/L').abandonmentAnonymizedAt);
  check('dentro do prazo: cadastro do jogador continua intacto', !!store.get('leagues/L/player_registry/fulano'));

  // ───────── checkAbandonedLeagues: liga sem lastActivityAt (legada) ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L' }); // sem o campo: nunca foi aberta desde que o touch existe
  await fns.checkAbandonedLeagues();
  check('legada: liga sem lastActivityAt não é avaliada', !store.get('leagues/L').abandonmentWarnedAt);

  // ───────── checkAbandonedLeagues: falha no Resend não quebra a varredura ─────────
  reset();
  fetchShouldFail = true;
  store.set('leagues/L', { name: 'Liga L', lastActivityAt: daysAgo(340) });
  store.set('users/adm1', { email: 'adm1@x.com', leagues: { L: { role: 'admin' } } });
  let threw = false;
  try { await fns.checkAbandonedLeagues(); } catch (e) { threw = true; }
  check('resend falhando: a varredura não lança erro', !threw);
  check('resend falhando: mesmo assim marca como avisada (não tenta de novo todo dia)', !!store.get('leagues/L').abandonmentWarnedAt);

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})();
