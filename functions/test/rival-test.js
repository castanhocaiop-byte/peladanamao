// Rival (item 36): as contas puras de functions/rival.js (validar os duelos do mês, sequências, viradas, tempo com o mesmo rival, Alvo da Galera,
// Rivalidade Declarada, trocar de chave) e as funções setRival, saveRivalProgress e syncRivals, mais os ganchos de sair da liga, ser recusado ou ligado a
// outro jogador (manageMember), apagar a conta e anonimizar o nome. Firestore falso em memória (o mesmo do star-votes-test.js). As regras do Firestore
// ficam no emulator-test.js.
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
const pushes = [];          // cada envio de aviso (push) que a função fez
let pushFails = false;      // true = o serviço de avisos está fora do ar
let authDeleteError = null;   // código de erro simulado ao apagar o login
const callableOpts = [];
const logs = [];
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({ sendEachForMulticast: async msg => {
    if (pushFails) throw new Error('serviço de avisos fora do ar');
    pushes.push(JSON.parse(JSON.stringify(msg)));
    return { successCount: msg.tokens.length, failureCount: 0, responses: msg.tokens.map(() => ({ success: true })) };
  } }),
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

const rival = require('../rival');
const msgOf = async p => { try { await p; return ''; } catch (e) { return e.message; } };
const snapshot = () => JSON.stringify([...store.entries()].filter(([k]) => !k.startsWith('rate_limits/')).sort((a, b) => (a[0] < b[0] ? -1 : 1)));

const REG = 'leagues/L/player_registry/';
const RV = uid => store.get('leagues/L/rivals/' + uid);
const PUB = key => store.get('leagues/L/rival_public/' + key);
const setR = (uid, rivalKey, liga = 'L') => call(fns.setRival, { liga, rivalKey }, authOf(uid));
const prog = (uid, data, liga = 'L') => call(fns.saveRivalProgress, { liga, ...data }, authOf(uid));
const syncR = (uid, data) => call(fns.syncRivals, data, authOf(uid));

// o mês de hoje no horário de Brasília (o mesmo que o servidor usa) e meses para trás
const brt = () => new Date(Date.now() - 3 * 3600 * 1000);
const monthAgo = n => { const d = brt(); const t = d.getUTCFullYear() * 12 + d.getUTCMonth() - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const NOW_MONTH = monthAgo(0);
const sinceOf = n => `${monthAgo(n)}-15T12:00:00.000Z`; // o rival foi escolhido no dia 15 de n meses atrás

const resetRival = () => {
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
  for (const k of ['ana', 'bia', 'caio', 'dani', 'eli', 'adm']) store.set(REG + k, { name: k.toUpperCase(), added: '2026-01-01', active: true });
  store.set(REG + 'ines', { name: 'Ines', added: '2026-01-01', active: false });
};
// põe uma escolha de rival direto no banco, com o rival escolhido há `monthsAgo` meses
const seedRival = (uid, ownKey, rivalKey, monthsAgo = 8, extra = {}) => store.set('leagues/L/rivals/' + uid, { ownKey, rivalKey, since: sinceOf(monthsAgo), mutual: false, lead: '', duels: {}, ...extra });

(async () => {
  // ═════════ parte pura: functions/rival.js ═════════
  check('AWARD_IDS: as 11 badges que viram contagem, sem repetir', rival.AWARD_IDS.length === 11 && new Set(rival.AWARD_IDS).size === 11);
  check('RESULT_AWARD: cada resultado dá a sua badge', JSON.stringify(rival.RESULT_AWARD) === '{"trator":"duelo_trator","mao":"duelo_mao","aluno":"duelo_aluno","fora":"duelo_fora_liga"}');
  check('constantes: 12 meses por chamada, 24 de histórico, sequência de 3, alvo com 3', rival.MAX_DUELS_PER_CALL === 12 && rival.KEEP_MONTHS === 24 && rival.STREAK_LENGTH === 3 && rival.ALVO_MIN === 3);
  check('monthOf: pega ano e mês de uma data', rival.monthOf('2026-10-20T10:00:00.000Z') === '2026-10' && rival.monthOf('2026-10') === '2026-10' && rival.monthOf(undefined) === '' && rival.monthOf(null) === '');

  const fits = (res, m, t) => rival.resultFits(res, m, t);
  check('resultFits: trator = o rival não levou nenhum e 4 ou mais números decididos', fits('trator', 4, 0) && fits('trator', 9, 0) && !fits('trator', 3, 0) && !fits('trator', 4, 1) && !fits('trator', 0, 0));
  check('resultFits: mão = levei mais que ele (3 ou mais decididos), mas não é "todos"', fits('mao', 3, 1) && fits('mao', 3, 2) && fits('mao', 2, 1) && fits('mao', 3, 0) && !fits('mao', 4, 0) && !fits('mao', 2, 2) && !fits('mao', 1, 2) && !fits('mao', 1, 0) && !fits('mao', 2, 0));
  check('resultFits: aluno = ele levou mais que eu (3 ou mais decididos), mas não é "todos"', fits('aluno', 1, 3) && fits('aluno', 1, 2) && fits('aluno', 0, 3) && !fits('aluno', 0, 4) && !fits('aluno', 2, 2) && !fits('aluno', 2, 1) && !fits('aluno', 0, 2));
  check('resultFits: fora da sua liga = eu não levei nenhum e ele levou 4 ou mais', fits('fora', 0, 4) && fits('fora', 0, 8) && !fits('fora', 0, 3) && !fits('fora', 1, 4) && !fits('fora', 0, 0));
  check('resultFits: empate = o mesmo tanto, com pelo menos 4 decididos (com menos de 3 o duelo nem vale)', fits('empate', 2, 2) && fits('empate', 3, 3) && !fits('empate', 1, 1) && !fits('empate', 0, 0) && !fits('empate', 3, 2));
  check('resultFits: sem duelo (none) só com zero e zero; resultado desconhecido nunca', fits('none', 0, 0) && !fits('none', 1, 0) && !fits('none', 0, 2) && !fits('vitoria', 3, 1) && !fits(undefined, 0, 0) && !fits(null, 3, 1));

  const ctx = { sinceMonth: '2026-03', currentMonth: '2026-10', known: { '2026-05': { r: 'bia', res: 'mao', m: 3, t: 1 } } };
  const pd = (list, c = ctx) => rival.parseDuels(list, c);
  check('parseDuels: sem lista (nulo ou ausente) não é erro: nada a fazer', [undefined, null].every(v => { const r = pd(v); return r.ok && r.accepted.length === 0 && r.skipped === 0; }));
  check('parseDuels: formato errado (não é lista, item estranho, mês inválido)', ['x', 5, {}, true].every(v => pd(v).reason === 'shape') && [[null], [5], [{}], [{ month: '2026-13', res: 'none' }], [{ month: '26-05', res: 'none' }], [{ month: '2026-5', res: 'none' }], [{ month: 202605, res: 'none' }]].every(v => pd(v).reason === 'shape'));
  const many = n => Array.from({ length: n }, (_, i) => ({ month: `2026-${String((i % 9) + 1).padStart(2, '0')}`, res: 'none' }));
  check('parseDuels: até 12 meses por chamada; 13 é recusado', pd(many(12)).ok === true && pd(many(13)).reason === 'too-many');
  check('parseDuels: resultado que não bate com os números recusa a chamada inteira', [{ month: '2026-06', res: 'trator', m: 3, t: 0 }, { month: '2026-06', res: 'mao', m: 1, t: 3 }, { month: '2026-06', res: 'xx', m: 1, t: 1 }, { month: '2026-06', res: 'aluno', m: 'a', t: 2 }, { month: '2026-06', res: 'mao', m: 3.5, t: 1 }, { month: '2026-06', res: 'mao', m: -1, t: 1 }, { month: '2026-06', res: 'mao', m: 21, t: 1 }, { month: '2026-06', res: 'mao' }].every(d => pd([{ month: '2026-04', res: 'mao', m: 3, t: 1 }, d]).reason === 'result'));
  let r = pd([{ month: '2026-06', res: 'none', m: 9, t: 9 }]);
  check('parseDuels: mês sem duelo (none) guarda zero e zero, mesmo que mandem números', r.ok && JSON.stringify(r.accepted) === '[{"month":"2026-06","res":"none","m":0,"t":0}]', r);
  r = pd([{ month: '2026-08', res: 'trator', m: 5, t: 0 }, { month: '2026-06', res: 'aluno', m: 1, t: 3 }, { month: '2026-07', res: 'empate', m: 2, t: 2 }]);
  check('parseDuels: devolve em ordem de mês (do mais antigo ao mais novo)', r.ok && r.accepted.map(d => d.month).join() === '2026-06,2026-07,2026-08' && r.skipped === 0, r);
  r = pd([{ month: '2026-02', res: 'none' }, { month: '2026-10', res: 'none' }, { month: '2026-11', res: 'none' }, { month: '2026-05', res: 'mao', m: 3, t: 1 }, { month: '2026-03', res: 'none' }, { month: '2026-09', res: 'none' }]);
  check('parseDuels: ignora (e conta) mês antes do rival atual, o mês de hoje, mês futuro e mês já guardado', r.ok && r.accepted.map(d => d.month).join() === '2026-03,2026-09' && r.skipped === 4, r);
  r = pd([{ month: '2026-06', res: 'none' }, { month: '2026-06', res: 'mao', m: 3, t: 1 }]);
  check('parseDuels: o mesmo mês duas vezes na chamada vale uma vez (o 1º)', r.ok && r.accepted.length === 1 && r.accepted[0].res === 'none' && r.skipped === 1, r);
  check('parseDuels: sem histórico (known ausente) funciona', rival.parseDuels([{ month: '2026-06', res: 'none' }], { sinceMonth: '2026-01', currentMonth: '2026-10' }).accepted.length === 1);
  check('parseDuels: "__proto__" no histórico não engana (só conta como mês guardado quem está lá de verdade)', rival.parseDuels([{ month: '2026-06', res: 'none' }], { sinceMonth: '2026-01', currentMonth: '2026-10', known: JSON.parse('{"__proto__":{"x":1}}') }).accepted.length === 1);

  // sequências
  const H = (...entries) => Object.fromEntries(entries.map(([month, res, r = 'bia']) => [month, { r, res, m: 0, t: 0 }]));
  check('runLength: conta os duelos seguidos do mesmo lado contra o mesmo rival', rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'trator'], ['2026-05', 'mao']), '2026-05', '2026-01') === 3);
  check('runLength: o outro lado quebra a sequência', rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'aluno'], ['2026-05', 'mao']), '2026-05', '2026-01') === 1);
  check('runLength: empate quebra', rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'empate'], ['2026-05', 'mao']), '2026-05', '2026-01') === 1 && rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'empate']), '2026-04', '2026-01') === 0);
  check('runLength: mês sem duelo válido (none) não conta nem quebra', rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'none'], ['2026-05', 'trator']), '2026-05', '2026-01') === 2);
  check('runLength: outro rival no meio quebra', rival.runLength(H(['2026-03', 'mao', 'caio'], ['2026-04', 'mao'], ['2026-05', 'mao']), '2026-05', '2026-01') === 2);
  check('runLength: só vale a partir do mês em que o rival atual foi escolhido', rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'mao'], ['2026-05', 'mao']), '2026-05', '2026-04') === 2);
  check('runLength: derrotas também formam sequência; mês sem entrada ou sem lado dá zero', rival.runLength(H(['2026-03', 'aluno'], ['2026-04', 'fora']), '2026-04', '2026-01') === 2 && rival.runLength(H(['2026-03', 'mao']), '2026-09', '2026-01') === 0 && rival.runLength(H(['2026-03', 'none']), '2026-03', '2026-01') === 0);
  check('runLength: só olha até o mês pedido (meses depois não entram)', rival.runLength(H(['2026-03', 'mao'], ['2026-04', 'mao'], ['2026-05', 'mao']), '2026-04', '2026-01') === 2);

  const D = (month, res, m = 0, t = 0) => ({ month, res, m, t });
  let ad = rival.applyDuels({}, [D('2026-03', 'mao', 4, 2), D('2026-04', 'trator', 5, 0), D('2026-05', 'mao', 3, 1)], { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: cada resultado dá a sua badge e 3 vitórias seguidas dão Dono do Rival', JSON.stringify(ad.gains) === '{"duelo_mao":2,"duelo_trator":1,"duelo_dono":1}', ad.gains);
  check('applyDuels: o histórico guarda o rival, o resultado e os números de cada mês', JSON.stringify(ad.history['2026-04']) === '{"r":"bia","res":"trator","m":5,"t":0}' && Object.keys(ad.history).length === 3);
  ad = rival.applyDuels({}, [D('2026-03', 'aluno', 1, 3), D('2026-04', 'fora', 0, 5), D('2026-05', 'aluno', 2, 3)], { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: 3 derrotas seguidas dão Sombra do Rival', JSON.stringify(ad.gains) === '{"duelo_aluno":2,"duelo_fora_liga":1,"duelo_sombra":1}', ad.gains);
  ad = rival.applyDuels({}, [D('2026-01', 'mao', 3, 1), D('2026-02', 'mao', 3, 1), D('2026-03', 'empate', 2, 2), D('2026-04', 'mao', 3, 1)], { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: empate no meio quebra a sequência: nada de Dono do Rival', ad.gains.duelo_dono === undefined && ad.gains.duelo_mao === 3 && !('duelo_sombra' in ad.gains), ad.gains);
  ad = rival.applyDuels({}, [D('2026-01', 'mao', 3, 1), D('2026-02', 'none'), D('2026-03', 'mao', 3, 1), D('2026-04', 'mao', 3, 1)], { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: mês sem duelo (none) no meio não quebra: 3 vitórias seguidas, Dono do Rival', ad.gains.duelo_dono === 1 && ad.gains.duelo_mao === 3, ad.gains);
  const h6 = Array.from({ length: 6 }, (_, i) => D(`2026-0${i + 1}`, 'mao', 3, 1));
  ad = rival.applyDuels({}, h6, { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: 6 vitórias seguidas dão Dono do Rival duas vezes (a cada 3)', ad.gains.duelo_dono === 2 && ad.gains.duelo_mao === 6, ad.gains);
  const stepA = rival.applyDuels({}, h6.slice(0, 2), { rivalKey: 'bia', sinceMonth: '2026-01' });
  ad = rival.applyDuels(stepA.history, h6.slice(2, 3), { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: a sequência continua de uma chamada para a outra (2 antes + 1 agora = Dono do Rival)', ad.gains.duelo_dono === 1 && ad.gains.duelo_mao === 1, ad.gains);
  const longHist = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, { r: 'bia', res: 'none', m: 0, t: 0 }]));
  ad = rival.applyDuels(longHist, [D('2026-08', 'none')], { rivalKey: 'bia', sinceMonth: '2024-01' });
  const monthsKept = Object.keys(ad.history);
  check('applyDuels: guarda só os 24 meses mais novos', monthsKept.length === 24 && monthsKept[monthsKept.length - 1] === '2026-08' && monthsKept[0] === '2024-08', [monthsKept.length, monthsKept[0], monthsKept[monthsKept.length - 1]]);
  check('applyDuels: não mexe no histórico que recebeu', JSON.stringify(stepA.history) === JSON.stringify(rival.applyDuels({}, h6.slice(0, 2), { rivalKey: 'bia', sinceMonth: '2026-01' }).history));
  ad = rival.applyDuels({}, [D('2026-03', 'empate', 2, 2), D('2026-04', 'none')], { rivalKey: 'bia', sinceMonth: '2026-01' });
  check('applyDuels: empate e mês sem duelo não dão badge nenhuma', Object.keys(ad.gains).length === 0 && ad.history['2026-03'].res === 'empate');

  // virada no número de conquistas
  const lead = (a, b) => rival.applyLead(a, b);
  check('applyLead: a 1ª vez só guarda (não dá badge)', JSON.stringify(lead('', 'mine')) === '{"lead":"mine","gain":null}' && JSON.stringify(lead('', 'theirs')) === '{"lead":"theirs","gain":null}' && JSON.stringify(lead(undefined, 'mine')) === '{"lead":"mine","gain":null}');
  check('applyLead: o rival estava na frente e eu passei = Passou o Rival', JSON.stringify(lead('theirs', 'mine')) === '{"lead":"mine","gain":"rival_passou"}');
  check('applyLead: eu estava na frente e o rival passou = Levou a Ultrapassada', JSON.stringify(lead('mine', 'theirs')) === '{"lead":"theirs","gain":"rival_ultrapassada"}');
  check('applyLead: quem está na frente continua na frente: nada', JSON.stringify(lead('mine', 'mine')) === '{"lead":"mine","gain":null}' && JSON.stringify(lead('theirs', 'theirs')) === '{"lead":"theirs","gain":null}');
  check('applyLead: empate não muda quem estava na frente', JSON.stringify(lead('mine', 'tie')) === '{"lead":"mine","gain":null}' && JSON.stringify(lead('theirs', 'tie')) === '{"lead":"theirs","gain":null}' && JSON.stringify(lead('', 'tie')) === '{"lead":"","gain":null}');
  check('applyLead: valor estranho é ignorado e guarda o que tinha', ['x', 5, null, undefined, {}, 'MINE'].every(v => JSON.stringify(lead('mine', v)) === '{"lead":"mine","gain":null}') && JSON.stringify(lead('lixo', 'mine')) === '{"lead":"mine","gain":null}');

  // tempo com o mesmo rival
  check('monthsBetween: meses inteiros no calendário (de 20/07 a 20/10 são 3; um dia antes, 2)', rival.monthsBetween('2026-07-20T12:00:00.000Z', '2026-10-20T12:00:00.000Z') === 3 && rival.monthsBetween('2026-07-20T12:00:00.000Z', '2026-10-19T12:00:00.000Z') === 2 && rival.monthsBetween('2026-07-20T12:00:00.000Z', '2026-07-31T12:00:00.000Z') === 0);
  check('monthsBetween: atravessa o ano; datas inválidas ou invertidas dão zero', rival.monthsBetween('2025-11-10T00:00:00.000Z', '2026-02-10T00:00:00.000Z') === 3 && rival.monthsBetween('2025-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z') === 12 && rival.monthsBetween('lixo', '2026-01-01') === 0 && rival.monthsBetween('2026-01-01', 'lixo') === 0 && rival.monthsBetween('2026-10-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z') === 0);
  check('tenureAwards: 3, 6 e 12 meses dão as 3 badges de tempo', rival.tenureAwards('2026-01-10T00:00:00.000Z', '2026-04-09T00:00:00.000Z').length === 0 && rival.tenureAwards('2026-01-10T00:00:00.000Z', '2026-04-10T00:00:00.000Z').join() === 'rival_3m' && rival.tenureAwards('2026-01-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z').join() === 'rival_3m,rival_6m' && rival.tenureAwards('2026-01-10T00:00:00.000Z', '2027-01-10T00:00:00.000Z').join() === 'rival_3m,rival_6m,rival_12m');
  check('tenureAwards: sem data do rival, nada', rival.tenureAwards('', '2026-10-10T00:00:00.000Z').length === 0 && rival.tenureAwards(undefined, '2026-10-10T00:00:00.000Z').length === 0);

  check('mergeAwards: soma os ganhos às contagens que já existem', JSON.stringify(rival.mergeAwards({ duelo_mao: 1, duelo_dono: 2 }, { duelo_mao: 2, duelo_trator: 1 })) === '{"duelo_mao":3,"duelo_dono":2,"duelo_trator":1}');
  check('mergeAwards: as badges de tempo valem uma vez (nunca somam nem diminuem)', JSON.stringify(rival.mergeAwards({ rival_3m: 1 }, {}, ['rival_3m', 'rival_6m'])) === '{"rival_3m":1,"rival_6m":1}' && JSON.stringify(rival.mergeAwards({ rival_3m: 4 }, {}, ['rival_3m'])) === '{"rival_3m":4}');
  check('mergeAwards: id desconhecido é ignorado; sem nada antes funciona; não mexe no que recebeu', JSON.stringify(rival.mergeAwards(undefined, { lixo: 3, duelo_mao: 1 }, ['lixo'])) === '{"duelo_mao":1}' && (() => { const a = { duelo_mao: 1 }; rival.mergeAwards(a, { duelo_mao: 5 }); return a.duelo_mao === 1; })());

  // Alvo da Galera e Rivalidade Declarada
  const act = (...k) => new Set(k);
  const rv = (uid, ownKey, rivalKey) => ({ uid, ownKey, rivalKey });
  let fl = rival.computeFlags([rv('1', 'ana', 'dani'), rv('2', 'bia', 'dani')], act('ana', 'bia', 'caio', 'dani'));
  check('computeFlags: 2 jogadores escolheram o mesmo: ainda não é Alvo da Galera', fl.alvo.size === 0 && fl.declarada.size === 0 && fl.mutualUids.size === 0);
  fl = rival.computeFlags([rv('1', 'ana', 'dani'), rv('2', 'bia', 'dani'), rv('3', 'caio', 'dani')], act('ana', 'bia', 'caio', 'dani'));
  check('computeFlags: 3 jogadores escolheram o mesmo: Alvo da Galera', [...fl.alvo].join() === 'dani' && fl.declarada.size === 0, [...fl.alvo]);
  fl = rival.computeFlags([rv('1', 'ana', 'dani'), rv('2', 'bia', 'dani'), rv('3', 'ana', 'dani')], act('ana', 'bia', 'dani'));
  check('computeFlags: duas contas ligadas ao MESMO jogador contam como um só (ana + ana + bia = 2)', fl.alvo.size === 0);
  fl = rival.computeFlags([rv('1', 'ana', 'dani'), rv('2', 'bia', 'dani'), rv('3', 'caio', 'dani')], act('ana', 'bia', 'dani'));
  check('computeFlags: quem escolheu e saiu do elenco (ou ficou inativo) não conta', fl.alvo.size === 0);
  fl = rival.computeFlags([rv('1', 'ana', 'dani'), rv('2', 'bia', 'dani'), rv('3', 'caio', 'dani')], act('ana', 'bia', 'caio'));
  check('computeFlags: o escolhido que saiu do elenco (ou ficou inativo) não é alvo de ninguém', fl.alvo.size === 0);
  fl = rival.computeFlags([rv('1', 'ana', 'bia'), rv('2', 'bia', 'ana')], act('ana', 'bia'));
  check('computeFlags: os dois se escolheram = Rivalidade Declarada, nos dois', [...fl.declarada].sort().join() === 'ana,bia' && [...fl.mutualUids].sort().join() === '1,2' && fl.alvo.size === 0, [...fl.declarada]);
  fl = rival.computeFlags([rv('1', 'ana', 'bia'), rv('2', 'bia', 'caio'), rv('3', 'caio', 'ana')], act('ana', 'bia', 'caio'));
  check('computeFlags: roda (ana→bia→caio→ana) não é declarada: só vale par que se escolheu um ao outro', fl.declarada.size === 0 && fl.mutualUids.size === 0);
  fl = rival.computeFlags([rv('1', 'ana', 'bia'), rv('2', 'bia', 'ana'), rv('9', 'ana', 'bia')], act('ana', 'bia'));
  check('computeFlags: a conta repetida da ana também tem a escolha correspondida', [...fl.mutualUids].sort().join() === '1,2,9');
  fl = rival.computeFlags([rv('1', 'ana', 'ana'), rv('2', '', 'bia'), rv('3', 'bia', ''), rv('4', 'bia', undefined), null, undefined], act('ana', 'bia'));
  check('computeFlags: escolha em si mesmo, vazia ou sem dono é ignorada, e lixo na lista não quebra', fl.alvo.size === 0 && fl.declarada.size === 0);
  check('computeFlags: lista vazia', (() => { const e = rival.computeFlags([], act()); return e.alvo.size === 0 && e.declarada.size === 0 && e.mutualUids.size === 0; })());

  const mapOf = obj => new Map(Object.entries(obj));
  const rn = rival.renameKeys(mapOf({ u1: { ownKey: 'ana', rivalKey: 'bia', since: 's', mutual: true, lead: 'mine', duels: { '2026-03': { r: 'bia', res: 'mao', m: 3, t: 1 } } }, u2: { ownKey: 'caio', rivalKey: 'ana', duels: {} }, u3: { ownKey: 'dani', rivalKey: 'bia', duels: { '2026-03': { r: 'ana', res: 'mao', m: 3, t: 1 } } }, u4: { ownKey: 'eli', rivalKey: 'bia', duels: {} } }), 'ana', 'ana2');
  check('renameKeys: troca o dono, o rival e o rival dentro do histórico, e devolve só quem mudou', Object.keys(rn).sort().join() === 'u1,u2,u3' && rn.u1.ownKey === 'ana2' && rn.u1.rivalKey === 'bia' && rn.u1.since === 's' && rn.u1.mutual === true && rn.u1.lead === 'mine' && rn.u2.rivalKey === 'ana2' && rn.u2.ownKey === 'caio' && rn.u3.duels['2026-03'].r === 'ana2' && rn.u3.duels['2026-03'].m === 3, rn);
  check('renameKeys: não mexe no documento original e aceita documento sem histórico', (() => { const orig = { ownKey: 'ana', rivalKey: 'bia' }; const m = mapOf({ u: orig }); const o = rival.renameKeys(m, 'ana', 'x'); return orig.ownKey === 'ana' && o.u.ownKey === 'x' && JSON.stringify(o.u.duels) === '{}'; })());

  check('publicDoc: sem documento e sem marca, nada a gravar', rival.publicDoc(undefined, { alvo: false, declarada: false }) === null && rival.publicDoc(null, {}) === null);
  check('publicDoc: marca nova cria o documento com as contagens vazias', JSON.stringify(rival.publicDoc(undefined, { alvo: true, declarada: false })) === '{"awards":{},"alvo":true,"declarada":false}');
  check('publicDoc: marcas iguais às que já estão: nada a gravar', rival.publicDoc({ awards: { duelo_mao: 1 }, alvo: true, declarada: false }, { alvo: true, declarada: false }) === null && rival.publicDoc({ awards: {} }, { alvo: false, declarada: false }) === null);
  check('publicDoc: marca que mudou mantém as contagens (e a marca que sumiu fica falsa em vez de apagar o documento)', JSON.stringify(rival.publicDoc({ awards: { duelo_mao: 2 }, alvo: true, declarada: true }, { alvo: false, declarada: true })) === '{"awards":{"duelo_mao":2},"alvo":false,"declarada":true}');

  // ═════════ função setRival ═════════
  resetRival();
  check('setRival: sem login', await codeOf(call(fns.setRival, { liga: 'L', rivalKey: 'bia' })) === 'unauthenticated');
  check('setRival: liga inválida', await codeOf(setR('u_ana', 'bia', 'a/b')) === 'invalid-argument');
  check('setRival: quem não participa da liga (outra liga, pendente) não pode', await codeOf(setR('u_fora', 'bia')) === 'permission-denied' && await codeOf(setR('u_pend', 'bia')) === 'permission-denied' && await codeOf(setR('ninguem', 'bia')) === 'permission-denied');
  check('setRival: conta sem jogador vinculado', await codeOf(setR('u_semlink', 'bia')) === 'failed-precondition' && /vinculada a um jogador/.test(await msgOf(setR('u_semlink', 'bia'))));
  check('setRival: chave de rival inválida', await codeOf(setR('u_ana', 'a/b')) === 'invalid-argument' && await codeOf(setR('u_ana', 'a b')) === 'invalid-argument' && await codeOf(setR('u_ana', 'x'.repeat(101))) === 'invalid-argument' && await codeOf(setR('u_ana', 5)) === 'invalid-argument' && await codeOf(setR('u_ana', { a: 1 })) === 'invalid-argument' && await codeOf(setR('u_ana', ['bia'])) === 'invalid-argument');
  check('setRival: ninguém é o próprio rival', await codeOf(setR('u_ana', 'ana')) === 'invalid-argument' && /próprio rival/.test(await msgOf(setR('u_ana', 'ana'))));
  check('setRival: rival que não está no elenco ou está inativo é recusado', await codeOf(setR('u_ana', 'fantasma')) === 'failed-precondition' && await codeOf(setR('u_ana', 'ines')) === 'failed-precondition' && /ativo no elenco/.test(await msgOf(setR('u_ana', 'ines'))));
  store.delete(REG + 'ana');
  check('setRival: jogador da própria conta fora do elenco não escolhe rival', await codeOf(setR('u_ana', 'bia')) === 'failed-precondition' && /no elenco/.test(await msgOf(setR('u_ana', 'bia'))));
  store.set(REG + 'ana', { name: 'ANA', added: '2026-01-01', active: true });
  check('setRival: nada foi gravado pelas recusas', ![...store.keys()].some(k => k.includes('/rivals/') || k.includes('/rival_public/')));

  for (const k of [...store.keys()]) if (k.startsWith('rate_limits/')) store.delete(k); // as recusas acima já gastaram chamadas do limite por minuto
  const t0 = Date.now();
  let res = await setR('u_ana', 'bia');
  check('setRival: escolher o rival grava o documento da conta e devolve o resumo', res.ok === true && res.rivalKey === 'bia' && res.mutual === false && /^\d{4}-\d\d-\d\dT/.test(res.since) && Math.abs(Date.parse(res.since) - t0) < 5000 && RV('u_ana').ownKey === 'ana' && RV('u_ana').rivalKey === 'bia' && RV('u_ana').since === res.since && RV('u_ana').mutual === false && RV('u_ana').lead === '' && JSON.stringify(RV('u_ana').duels) === '{}', [res, RV('u_ana')]);
  check('setRival: o documento é do uid da conta (não da chave do jogador) e outros não ganham nada', !!RV('u_ana') && !RV('u_bia') && !PUB('ana') && !PUB('bia'));
  const since1 = res.since;
  await new Promise(r => setTimeout(r, 5));
  res = await setR('u_ana', 'bia');
  check('setRival: escolher o MESMO rival de novo não muda nada (o tempo com ele continua contando)', res.since === since1 && RV('u_ana').since === since1 && res.rivalKey === 'bia');
  seedRival('u_ana', 'ana', 'bia', 3, { lead: 'mine', duels: { [monthAgo(2)]: { r: 'bia', res: 'mao', m: 3, t: 1 } } });
  res = await setR('u_ana', 'caio');
  check('setRival: trocar de rival recomeça o tempo (since novo), zera a virada e guarda os meses de duelo que já fecharam', res.rivalKey === 'caio' && res.since !== sinceOf(3) && RV('u_ana').rivalKey === 'caio' && RV('u_ana').lead === '' && RV('u_ana').duels[monthAgo(2)].r === 'bia', RV('u_ana'));
  res = await setR('u_ana', '');
  check('setRival: tirar o rival mantém o documento (com o histórico), sem rival e sem data', res.rivalKey === '' && res.since === '' && RV('u_ana').rivalKey === '' && RV('u_ana').since === '' && RV('u_ana').duels[monthAgo(2)].res === 'mao', RV('u_ana'));
  const s1 = snapshot();
  res = await setR('u_ana', '');
  check('setRival: tirar o rival que já não existe não muda o banco', res.rivalKey === '' && snapshot() === s1);
  res = await setR('u_eli', null);
  check('setRival: quem nunca teve rival e manda vazio (ou nulo) não cria documento', res.rivalKey === '' && !RV('u_eli'));
  res = await setR('u_eli', undefined);
  check('setRival: …nem com a chave ausente', res.rivalKey === '' && !RV('u_eli'));
  seedRival('u_bia', 'outro', 'caio', 3, { duels: { [monthAgo(2)]: { r: 'caio', res: 'mao', m: 3, t: 1 } } });
  res = await setR('u_bia', 'dani');
  check('setRival: conta que foi ligada a outro jogador recomeça do zero (sem o histórico do outro)', res.rivalKey === 'dani' && RV('u_bia').ownKey === 'bia' && JSON.stringify(RV('u_bia').duels) === '{}', RV('u_bia'));
  check('setRival: vínculo antigo no topo do cadastro também vale', await (async () => { store.set('users/u_top', { email: 't@x.com', role: 'pending', playerKey: 'eli', leagues: { L: { role: 'player' } } }); const r2 = await setR('u_top', 'bia'); return r2.rivalKey === 'bia' && RV('u_top').ownKey === 'eli'; })());
  check('setRival: admin também escolhe rival', (await setR('u_adm', 'bia')).rivalKey === 'bia' && RV('u_adm').ownKey === 'adm');

  // limite de chamadas
  resetRival();
  let limited = 'ok';
  for (let i = 0; i < 21 && limited === 'ok'; i++) limited = await codeOf(setR('u_eli', i % 2 ? 'bia' : 'caio'));
  check('setRival: passa de 20 chamadas por minuto → resource-exhausted (e quem não abusou continua podendo)', limited === 'resource-exhausted' && await codeOf(setR('u_bia', 'caio')) === 'ok');

  // Rivalidade Declarada
  resetRival();
  await setR('u_ana', 'bia');
  check('declarada: um só lado escolheu: ainda não é declarada', RV('u_ana').mutual === false && !PUB('ana') && !PUB('bia'));
  res = await setR('u_bia', 'ana');
  check('declarada: os dois se escolheram → as duas escolhas ficam "mutual" e a resposta de quem fechou o par já diz isso', res.mutual === true && RV('u_ana').mutual === true && RV('u_bia').mutual === true, [RV('u_ana'), RV('u_bia')]);
  check('declarada: o cadastro público dos dois ganha a marca (sem dizer com quem)', PUB('ana').declarada === true && PUB('bia').declarada === true && PUB('ana').alvo === false && JSON.stringify(PUB('ana').awards) === '{}' && !('rivalKey' in PUB('ana')) && !('with' in PUB('ana')), [PUB('ana'), PUB('bia')]);
  await setR('u_bia', 'caio');
  check('declarada: quem desfaz o par tira a marca dos dois, e o documento fica (com as contagens)', RV('u_ana').mutual === false && RV('u_bia').mutual === false && PUB('ana').declarada === false && PUB('bia').declarada === false, [RV('u_ana'), PUB('ana')]);
  await setR('u_bia', 'ana');
  await setR('u_ana', '');
  check('declarada: tirar o rival também desfaz o par', RV('u_bia').mutual === false && PUB('bia').declarada === false && PUB('ana').declarada === false);
  await setR('u_ana', 'bia'); await setR('u_bia', 'ana');
  await setR('u_ana2', 'bia');
  check('declarada: a segunda conta da ana (mesmo jogador) também recebe o "mutual", sem mexer na declarada da dupla', RV('u_ana2').mutual === true && PUB('ana').declarada === true);

  // Alvo da Galera
  resetRival();
  await setR('u_ana', 'dani'); await setR('u_bia', 'dani');
  check('alvo: 2 escolhas ainda não fazem alvo', !PUB('dani'));
  await setR('u_caio', 'dani');
  check('alvo: a 3ª escolha torna o jogador Alvo da Galera (cadastro público), sem dizer quem escolheu', PUB('dani').alvo === true && PUB('dani').declarada === false && !JSON.stringify(PUB('dani')).includes('ana') && !JSON.stringify(PUB('dani')).includes('caio'), PUB('dani'));
  check('alvo: quem escolheu não fica com marca nenhuma', !PUB('ana') && !PUB('bia') && !PUB('caio'));
  await setR('u_bia', 'eli');
  check('alvo: se um dos 3 troca de rival, a marca sai do jogador (o documento fica)', PUB('dani').alvo === false && !PUB('eli'), [PUB('dani'), PUB('eli')]);
  await setR('u_bia', 'dani');
  check('alvo: volta quando o 3º escolhe de novo', PUB('dani').alvo === true);
  await setR('u_ana2', 'dani');
  check('alvo: a segunda conta da ana (mesmo jogador) não conta como mais uma pessoa', PUB('dani').alvo === true && [...store.keys()].filter(k => k.startsWith('leagues/L/rivals/')).length === 4);
  await setR('u_eli', 'dani');
  await setR('u_dani', 'ana');
  check('alvo: o alvo pode escolher o próprio rival sem perder a marca; e se a escolha dele é correspondida (ana↔dani) os dois ficam com a Rivalidade Declarada, sem a ana virar alvo', PUB('dani').alvo === true && PUB('dani').declarada === true && PUB('ana').alvo === false && PUB('ana').declarada === true, [PUB('dani'), PUB('ana')]);

  // quem saiu do elenco não conta
  resetRival();
  await setR('u_ana', 'dani'); await setR('u_bia', 'dani'); await setR('u_caio', 'dani');
  store.set(REG + 'caio', { name: 'CAIO', added: '2026-01-01', active: false });
  let sy = await syncR('u_adm', { liga: 'L' });
  check('syncRivals: sem rename só refaz as marcas: quem ficou inativo deixa de contar e a marca sai', sy.ok === true && sy.changed === true && PUB('dani').alvo === false, PUB('dani'));
  store.set(REG + 'caio', { name: 'CAIO', added: '2026-01-01', active: true });
  await syncR('u_adm', { liga: 'L' });
  check('syncRivals: …e volta quando ele volta ao elenco', PUB('dani').alvo === true);
  store.delete(REG + 'dani');
  await syncR('u_adm', { liga: 'L' });
  check('syncRivals: se o jogador escolhido saiu do elenco, a marca dele sai', PUB('dani').alvo === false);

  // ═════════ função saveRivalProgress ═════════
  resetRival();
  check('progresso: sem login', await codeOf(call(fns.saveRivalProgress, { liga: 'L' })) === 'unauthenticated');
  check('progresso: quem não participa da liga não pode', await codeOf(prog('u_fora', {})) === 'permission-denied' && await codeOf(prog('u_pend', {})) === 'permission-denied');
  check('progresso: conta sem jogador vinculado', await codeOf(prog('u_semlink', {})) === 'failed-precondition');
  check('progresso: sem rival escolhido → "Escolha um rival primeiro."', await codeOf(prog('u_ana', {})) === 'failed-precondition' && /Escolha um rival/.test(await msgOf(prog('u_ana', {}))));
  seedRival('u_ana', 'ana', '', 8);
  check('progresso: rival tirado também pede para escolher', await codeOf(prog('u_ana', {})) === 'failed-precondition');
  seedRival('u_ana', 'outra', 'bia', 8);
  check('progresso: documento de outro jogador (conta ligada a outro depois) não vale', await codeOf(prog('u_ana', {})) === 'failed-precondition');
  seedRival('u_ana', 'ana', 'bia', 8);
  check('progresso: liga inválida', await codeOf(prog('u_ana', {}, 'a/b')) === 'invalid-argument');
  const s2 = snapshot();
  let pr = await prog('u_ana', {});
  check('progresso: chamada vazia não grava nada', pr.ok === true && pr.accepted.length === 0 && pr.skipped === 0 && JSON.stringify(pr.gains) === '{}' && snapshot() === s2, pr);
  check('progresso: duelos em formato errado', await codeOf(prog('u_ana', { duels: 'x' })) === 'invalid-argument' && await codeOf(prog('u_ana', { duels: [{ month: 'x', res: 'none' }] })) === 'invalid-argument' && await codeOf(prog('u_ana', { duels: [{ month: monthAgo(3), res: 'trator', m: 1, t: 1 }] })) === 'invalid-argument' && /não bate/.test(await msgOf(prog('u_ana', { duels: [{ month: monthAgo(3), res: 'trator', m: 1, t: 1 }] }))));
  check('progresso: 13 duelos de uma vez', await codeOf(prog('u_ana', { duels: Array.from({ length: 13 }, (_, i) => ({ month: monthAgo(i + 1), res: 'none' })) })) === 'invalid-argument');
  check('progresso: nada foi gravado pelas recusas', snapshot() === s2);

  pr = await prog('u_ana', { duels: [{ month: monthAgo(5), res: 'mao', m: 4, t: 2 }, { month: monthAgo(4), res: 'trator', m: 5, t: 0 }, { month: monthAgo(3), res: 'mao', m: 3, t: 1 }] });
  check('progresso: três vitórias seguidas dão as badges de cada resultado e Dono do Rival', pr.ok && pr.accepted.length === 3 && pr.skipped === 0 && JSON.stringify(pr.gains) === '{"duelo_mao":2,"duelo_trator":1,"duelo_dono":1}' && PUB('ana').awards.duelo_mao === 2 && PUB('ana').awards.duelo_trator === 1 && PUB('ana').awards.duelo_dono === 1, [pr, PUB('ana')]);
  check('progresso: o histórico privado guarda rival, resultado e números de cada mês', JSON.stringify(RV('u_ana').duels[monthAgo(4)]) === '{"r":"bia","res":"trator","m":5,"t":0}' && Object.keys(RV('u_ana').duels).length === 3, RV('u_ana').duels);
  check('progresso: o cadastro público tem as contagens e as marcas em falso, sem mês, rival nem números', PUB('ana').alvo === false && PUB('ana').declarada === false && !JSON.stringify(PUB('ana')).includes('bia') && !JSON.stringify(PUB('ana')).includes(monthAgo(4)), PUB('ana'));
  const s3 = snapshot();
  pr = await prog('u_ana', { duels: [{ month: monthAgo(5), res: 'aluno', m: 1, t: 3 }, { month: monthAgo(3), res: 'fora', m: 0, t: 5 }] });
  check('progresso: mês que já foi guardado é ignorado (não dá badge de novo) e nada muda', pr.accepted.length === 0 && pr.skipped === 2 && JSON.stringify(pr.gains) === '{}' && snapshot() === s3, pr);
  pr = await prog('u_ana', { duels: [{ month: NOW_MONTH, res: 'mao', m: 3, t: 1 }, { month: monthAgo(-1), res: 'mao', m: 3, t: 1 }, { month: monthAgo(9), res: 'mao', m: 3, t: 1 }] });
  check('progresso: o mês de hoje, mês futuro e mês de antes do rival atual são ignorados', pr.accepted.length === 0 && pr.skipped === 3 && snapshot() === s3, pr);
  pr = await prog('u_ana', { duels: [{ month: monthAgo(2), res: 'mao', m: 3, t: 1 }, { month: monthAgo(1), res: 'mao', m: 3, t: 1 }, { month: monthAgo(6), res: 'none' }] });
  check('progresso: a sequência continua (4 e 5 seguidos não dão nada; o mês antigo sem duelo entra no histórico)', pr.accepted.length === 3 && JSON.stringify(pr.gains) === '{"duelo_mao":2}' && PUB('ana').awards.duelo_dono === 1 && RV('u_ana').duels[monthAgo(6)].res === 'none', [pr, PUB('ana')]);
  seedRival('u_bia', 'bia', 'caio', 8);
  pr = await prog('u_bia', { duels: [{ month: monthAgo(4), res: 'aluno', m: 1, t: 3 }, { month: monthAgo(3), res: 'fora', m: 0, t: 6 }, { month: monthAgo(2), res: 'aluno', m: 2, t: 4 }] });
  check('progresso: três derrotas seguidas dão Sombra do Rival', JSON.stringify(pr.gains) === '{"duelo_aluno":2,"duelo_fora_liga":1,"duelo_sombra":1}' && PUB('bia').awards.duelo_sombra === 1, pr.gains);
  seedRival('u_caio', 'caio', 'dani', 8);
  pr = await prog('u_caio', { duels: [{ month: monthAgo(3), res: 'empate', m: 2, t: 2 }, { month: monthAgo(2), res: 'none' }] });
  check('progresso: empate e mês sem duelo entram no histórico mas não dão badge (e não criam o cadastro público)', pr.accepted.length === 2 && JSON.stringify(pr.gains) === '{}' && !PUB('caio') && RV('u_caio').duels[monthAgo(3)].res === 'empate', pr);

  // virada
  seedRival('u_dani', 'dani', 'eli', 8);
  pr = await prog('u_dani', { lead: 'theirs' });
  check('virada: a 1ª vez só guarda quem está na frente (sem badge, sem cadastro público)', pr.accepted.length === 0 && RV('u_dani').lead === 'theirs' && !PUB('dani') && JSON.stringify(pr.gains) === '{}', [pr, RV('u_dani')]);
  pr = await prog('u_dani', { lead: 'tie' });
  check('virada: empate não muda quem estava na frente', RV('u_dani').lead === 'theirs' && JSON.stringify(pr.gains) === '{}');
  pr = await prog('u_dani', { lead: 'mine' });
  check('virada: o rival estava na frente e eu passei → Passou o Rival', RV('u_dani').lead === 'mine' && pr.gains.rival_passou === 1 && PUB('dani').awards.rival_passou === 1, [pr, PUB('dani')]);
  pr = await prog('u_dani', { lead: 'mine' });
  check('virada: continuar na frente não dá nada', JSON.stringify(pr.gains) === '{}' && PUB('dani').awards.rival_passou === 1);
  pr = await prog('u_dani', { lead: 'theirs' });
  check('virada: o rival passou → Levou a Ultrapassada', RV('u_dani').lead === 'theirs' && pr.gains.rival_ultrapassada === 1 && PUB('dani').awards.rival_ultrapassada === 1, [pr, PUB('dani')]);
  pr = await prog('u_dani', { lead: 'lixo' });
  check('virada: valor estranho é ignorado', RV('u_dani').lead === 'theirs' && JSON.stringify(pr.gains) === '{}');
  pr = await prog('u_dani', { lead: 'mine', duels: [{ month: monthAgo(2), res: 'mao', m: 3, t: 1 }] });
  check('virada e duelo na mesma chamada somam as duas coisas', pr.gains.rival_passou === 1 && pr.gains.duelo_mao === 1 && PUB('dani').awards.rival_passou === 2 && PUB('dani').awards.duelo_mao === 1, pr.gains);

  // tempo com o mesmo rival
  seedRival('u_eli', 'eli', 'ana', 7);
  pr = await prog('u_eli', { tenure: true });
  check('tempo: 7 meses com o mesmo rival dão Rival de Estimação (3) e Arquirrival (6), não a de 12', PUB('eli').awards.rival_3m === 1 && PUB('eli').awards.rival_6m === 1 && !('rival_12m' in PUB('eli').awards), PUB('eli'));
  const s4 = snapshot();
  pr = await prog('u_eli', { tenure: true });
  check('tempo: repetir não soma nem grava de novo', snapshot() === s4 && PUB('eli').awards.rival_3m === 1);
  seedRival('u_eli', 'eli', 'ana', 13);
  await prog('u_eli', { tenure: true });
  check('tempo: 13 meses dão também a Rivalidade Histórica (12)', PUB('eli').awards.rival_12m === 1 && PUB('eli').awards.rival_6m === 1);
  seedRival('u_adm', 'adm', 'ana', 7);
  await prog('u_adm', {});
  check('tempo: só confere quando o app pede (tenure: true); sem isso nada muda', !PUB('adm'));
  await prog('u_adm', { tenure: 'sim' });
  check('tempo: só o valor verdadeiro (booleano) vale', !PUB('adm'));
  seedRival('u_adm', 'adm', 'ana', 1);
  await prog('u_adm', { tenure: true });
  check('tempo: com 1 mês de rival ainda não há badge', !PUB('adm'));

  // as marcas do servidor não se perdem quando o app grava as contagens
  resetRival();
  await setR('u_ana', 'dani'); await setR('u_bia', 'dani'); await setR('u_caio', 'dani'); await setR('u_dani', 'ana'); await setR('u_ana', 'dani');
  store.set('leagues/L/rivals/u_dani', { ...RV('u_dani'), since: sinceOf(8) });
  await prog('u_dani', { duels: [{ month: monthAgo(2), res: 'mao', m: 3, t: 1 }] });
  check('progresso: gravar as contagens mantém Alvo da Galera (marca do servidor)', PUB('dani').alvo === true && PUB('dani').awards.duelo_mao === 1, PUB('dani'));
  await setR('u_bia', 'eli');
  check('setRival: …e as contagens que o app gravou não se perdem quando o servidor mexe nas marcas', PUB('dani').alvo === false && PUB('dani').awards.duelo_mao === 1, PUB('dani'));

  // ═════════ ganchos ═════════
  const seedHooks = async () => {
    resetRival();
    await setR('u_ana', 'bia'); await setR('u_bia', 'ana'); await setR('u_caio', 'bia'); await setR('u_dani', 'bia');
    store.set('leagues/L/rival_public/bia', { ...PUB('bia'), awards: { duelo_mao: 2 } });
  };
  await seedHooks();
  check('ganchos: ponto de partida — bia é alvo (3 escolhas: ana, caio, dani) e ana×bia é declarada', PUB('bia').alvo === true && PUB('bia').declarada === true && RV('u_ana').mutual === true);
  await call(fns.leaveLeague, { liga: 'L' }, authOf('u_caio'));
  check('sair da liga: a escolha de rival da pessoa some e as marcas são refeitas (bia deixa de ser alvo; a declarada continua)', !RV('u_caio') && PUB('bia').alvo === false && PUB('bia').declarada === true && RV('u_ana').mutual === true, [PUB('bia'), RV('u_caio')]);
  await seedHooks();
  await call(fns.leaveLeague, { liga: 'L' }, authOf('u_ana'));
  check('sair da liga: quem fazia par declarado leva a escolha e o outro deixa de ser "mutual"', !RV('u_ana') && RV('u_bia').mutual === false && PUB('bia').declarada === false && PUB('bia').awards.duelo_mao === 2, [RV('u_bia'), PUB('bia')]);
  await seedHooks();
  await call(fns.leaveLeague, { liga: 'L' }, authOf('u_eli'));
  check('sair da liga: quem nunca escolheu rival não mexe em nada', !!RV('u_ana') && !!RV('u_bia') && PUB('bia').alvo === true);
  await seedHooks();
  store.set('users/u_bia', { ...store.get('users/u_bia'), leagues: { L: { role: 'player', playerKey: 'bia' }, B: { role: 'player', playerKey: 'zed' } } });
  await call(fns.leaveLeague, { liga: 'B' }, authOf('u_bia'));
  check('sair de OUTRA liga não leva a escolha desta', !!RV('u_bia') && PUB('bia').declarada === true);

  await seedHooks();
  const mm = (data, uid = 'u_adm') => call(fns.manageMember, data, authOf(uid));
  await mm({ liga: 'L', uid: 'u_caio', action: 'reject' });
  check('recusar a conta: a escolha de rival dela some e as marcas são refeitas', !RV('u_caio') && PUB('bia').alvo === false);
  await seedHooks();
  await mm({ liga: 'L', uid: 'u_caio', action: 'link', playerKey: 'caio' });
  check('ligar a conta ao MESMO jogador: a escolha continua valendo', !!RV('u_caio') && PUB('bia').alvo === true);
  await mm({ liga: 'L', uid: 'u_caio', action: 'link', playerKey: 'eli' });
  check('ligar a conta a OUTRO jogador: a escolha feita como o jogador antigo some', !RV('u_caio') && PUB('bia').alvo === false);
  await seedHooks();
  await mm({ liga: 'L', uid: 'u_caio', action: 'link', playerKey: '' });
  check('desvincular a conta do jogador: a escolha some', !RV('u_caio'));
  await seedHooks();
  await mm({ liga: 'L', uid: 'u_caio', action: 'linkRequest', approve: true, playerKey: 'eli' });
  check('aprovar pedido de vínculo com outro jogador: a escolha antiga some', !RV('u_caio'));
  await seedHooks();
  await mm({ liga: 'L', uid: 'u_caio', action: 'linkRequest', approve: false, playerKey: 'eli' });
  await mm({ liga: 'L', uid: 'u_caio', action: 'promote' });
  check('recusar o pedido de vínculo e promover a admin não mexem na escolha', !!RV('u_caio') && PUB('bia').alvo === true);

  await seedHooks();
  let del = await call(fns.deleteMyAccount, { confirm: true }, authOf('u_caio'));
  check('apagar a conta: a escolha de rival (dado pessoal) some e as marcas são refeitas', del.ok === true && !RV('u_caio') && PUB('bia').alvo === false && !!RV('u_ana'));
  await seedHooks();
  del = await call(fns.deleteMyAccount, { confirm: true }, authOf('u_bia'));
  check('apagar a conta: as badges do rival que o jogador já ganhou continuam no cadastro público (registro da liga)', del.ok === true && !RV('u_bia') && PUB('bia').awards.duelo_mao === 2 && RV('u_ana').mutual === false, [PUB('bia'), RV('u_ana')]);
  await seedHooks();
  del = await call(fns.deleteMyAccount, { confirm: true }, authOf('u_eli'));
  check('apagar a conta de quem nunca escolheu rival não mexe nas escolhas dos outros', del.ok === true && !!RV('u_ana') && PUB('bia').alvo === true);

  // renomear (admin) — syncRivals com rename
  check('syncRivals: sem login, jogador comum e admin de outra liga não podem; dono verificado pode', await codeOf(call(fns.syncRivals, { liga: 'L' })) === 'unauthenticated' && await codeOf(syncR('u_ana', { liga: 'L' })) === 'permission-denied' && await codeOf(syncR('u_admB', { liga: 'L' })) === 'permission-denied' && await codeOf(call(fns.syncRivals, { liga: 'L' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: false }))) === 'permission-denied' && await codeOf(call(fns.syncRivals, { liga: 'L' }, authOf('estranho', { email: 'castanho.caiop@gmail.com', email_verified: true }))) === 'ok');
  check('syncRivals: liga inválida', await codeOf(syncR('u_adm', { liga: 'a/b' })) === 'invalid-argument');
  for (const bad of [{ from: 'ana', to: 'ana' }, { from: 'ana' }, { to: 'ana' }, { from: 'a/b', to: 'x' }, { from: 'ana', to: 'x y' }, 'texto', 5, { from: { a: 1 }, to: 'z' }, { from: 'x'.repeat(101), to: 'z' }]) {
    check(`syncRivals: troca de chave inválida ${JSON.stringify(bad).slice(0, 30)}`, await codeOf(syncR('u_adm', { liga: 'L', rename: bad })) === 'invalid-argument');
  }
  resetRival();
  sy = await syncR('u_adm', { liga: 'L' });
  check('syncRivals: liga sem nenhuma escolha de rival não faz nada', sy.ok === true && sy.changed === false);
  await seedHooks();
  seedRival('u_dani', 'dani', 'bia', 8, { duels: { [monthAgo(3)]: { r: 'bia', res: 'mao', m: 3, t: 1 } } });
  // o admin renomeou bia → bianca: cadastro novo, cadastro antigo apagado, conta ligada ao jogador novo
  store.set(REG + 'bianca', { name: 'Bianca', added: '2026-01-01', active: true });
  store.delete(REG + 'bia');
  store.set('users/u_bia', { ...store.get('users/u_bia'), playerKey: 'bianca', leagues: { L: { role: 'player', playerKey: 'bianca' } } });
  const before = JSON.stringify([PUB('ana'), PUB('caio')]);
  sy = await syncR('u_adm', { liga: 'L', rename: { from: 'bia', to: 'bianca' } });
  check('renomear: as escolhas que apontavam para bia apontam para bianca, a conta dela passa a ser bianca e o histórico acompanha', sy.changed === true && RV('u_ana').rivalKey === 'bianca' && RV('u_caio').rivalKey === 'bianca' && RV('u_dani').rivalKey === 'bianca' && RV('u_bia').ownKey === 'bianca' && RV('u_bia').rivalKey === 'ana' && RV('u_dani').duels[monthAgo(3)].r === 'bianca', [RV('u_ana'), RV('u_bia'), RV('u_dani')]);
  check('renomear: as badges do rival passam para a chave nova (a antiga some)', !PUB('bia') && PUB('bianca').awards.duelo_mao === 2, [PUB('bia'), PUB('bianca')]);
  check('renomear: as marcas continuam certas na chave nova (alvo e declarada)', PUB('bianca').alvo === true && PUB('bianca').declarada === true && RV('u_ana').mutual === true && RV('u_bia').mutual === true, [PUB('bianca'), RV('u_ana')]);
  check('renomear: ninguém fica com a chave antiga', ![...store].some(([k, d]) => (k.includes('/rivals/') && (d.ownKey === 'bia' || d.rivalKey === 'bia' || Object.values(d.duels || {}).some(e => e.r === 'bia'))) || k.endsWith('/rival_public/bia')));
  check('renomear: mexer em bia não toca nos outros cadastros públicos', JSON.stringify([PUB('ana'), PUB('caio')]) === before);
  const s5 = snapshot();
  await syncR('u_adm', { liga: 'L', rename: { from: 'bia', to: 'bianca' } });
  check('renomear: repetir não muda o banco', snapshot() === s5);

  // anonimizar o nome
  await seedHooks();
  seedRival('u_dani', 'dani', 'bia', 8, { duels: { [monthAgo(3)]: { r: 'bia', res: 'mao', m: 3, t: 1 } } });
  const am = await call(fns.anonymizeMyName, { liga: 'L' }, authOf('u_bia'));
  const nk = am.newKey;
  check('anonimizar: a conta passa a ser do jogador novo e as escolhas que apontavam para ele seguem para a chave nova', RV('u_bia').ownKey === nk && RV('u_bia').rivalKey === 'ana' && RV('u_ana').rivalKey === nk && RV('u_caio').rivalKey === nk && RV('u_dani').duels[monthAgo(3)].r === nk, [RV('u_bia'), RV('u_ana')]);
  check('anonimizar: as badges do rival e as marcas passam para a chave nova e a antiga some', !PUB('bia') && PUB(nk).awards.duelo_mao === 2 && PUB(nk).alvo === true && PUB(nk).declarada === true, [PUB('bia'), PUB(nk)]);
  const am2 = await call(fns.anonymizeMyName, { liga: 'L' }, authOf('u_bia'));
  check('anonimizar: repetir não quebra nem muda', am2.ok === true && RV('u_bia').ownKey === nk && PUB(nk).awards.duelo_mao === 2);
  resetRival();
  const am3 = await call(fns.anonymizeMyName, { liga: 'L' }, authOf('u_bia'));
  check('anonimizar numa liga SEM escolhas de rival: funciona e não cria documento nenhum do rival', am3.ok === true && ![...store.keys()].some(k => k.includes('/rivals/') || k.includes('/rival_public/')));

  // outra liga não é tocada
  resetRival();
  store.set('leagues/B/rivals/u_fora', { ownKey: 'zed', rivalKey: 'x', since: sinceOf(2), mutual: false, lead: '', duels: {} });
  const outra = JSON.stringify(store.get('leagues/B/rivals/u_fora'));
  await setR('u_ana', 'bia'); await setR('u_bia', 'ana');
  await syncR('u_adm', { liga: 'L', rename: { from: 'bia', to: 'bianca' } });
  check('o rival de uma liga não mexe nos documentos de outra', JSON.stringify(store.get('leagues/B/rivals/u_fora')) === outra && ![...store.keys()].some(k => k.startsWith('leagues/B/rival_public')));
})().then(() => {
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
}).catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
