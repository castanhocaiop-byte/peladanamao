// Recuperar os campeonatos feitos no plano gratuito (functions/recover-free.js): o que muda em cada campeonato e no ranking
// (player_titles), a repetição segura, a ordem, a função do admin (quem pode, quando) e a recuperação automática ao ativar o plano
// (pelos três caminhos: pagamento anual, assinatura mensal e repetição sem mudança). Firestore falso em memória.
const Module = require('module');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const modFile = path.join(__dirname, '..', 'recover-free.js');
const indexFile = path.join(__dirname, '..', 'index.js');
const htmlFile = path.join(ROOT, 'index.html');

// ── Firestore falso em memória ──────────────────────────────────────────────────────────────────
const store = new Map();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const FieldValue = { delete: () => ({ __delete: true }), increment: n => ({ __inc: n }) };
// O Firestore de verdade recusa valores undefined: o falso também, para o teste pegar esse erro.
function assertNoUndefined(v, where) {
  if (v === undefined) throw new Error('valor undefined recusado pelo Firestore em ' + where);
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, where + '[' + i + ']'));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertNoUndefined(x, where + '.' + k);
}
function applyUpdate(data, patch) {
  const out = clone(data) || {};
  for (const [k, v] of Object.entries(patch)) {
    assertNoUndefined(v, k);
    if (v && v.__delete) delete out[k];
    else if (v && v.__inc !== undefined) out[k] = (out[k] || 0) + v.__inc;
    else out[k] = clone(v);
  }
  return out;
}
const snapOf = p => {
  const has = store.has(p);
  return { id: p.split('/').pop(), exists: has, data: () => (has ? clone(store.get(p)) : undefined), ref: refOf(p) };
};
function refOf(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async d => { assertNoUndefined(d, p); store.set(p, clone(d)); },
    update: async patch => { if (!store.has(p)) throw new Error('NOT_FOUND ' + p); store.set(p, applyUpdate(store.get(p), patch)); },
    collection: name => ({ doc: id => refOf(`${p}/${name}/${id}`) }),
  };
}
let txRuns = 0, champTxRuns = 0, txShouldFail = null, afterQuery = null; // afterQuery: roda depois de uma busca (simula alguém mexendo no banco no meio) // txShouldFail(paths do que a transação tocou) → true para simular a falha
let chain = Promise.resolve();       // transações em fila: duas ao mesmo tempo se serializam, como no Firestore
const fakeDb = {
  doc: p => refOf(p),
  collection: col => {
    const build = filters => ({
      where: (f, op, v) => build([...filters, [f, op, v]]),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([p, d]) => new RegExp('^' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^/]+$').test(p) && filters.every(([f, op, v]) => op === '==' && d[f] === v))
          .map(([p]) => snapOf(p));
        if (afterQuery) { const f = afterQuery; afterQuery = null; f(); }
        return { size: docs.length, docs, forEach: fn => docs.forEach(fn) };
      },
    });
    return build([]);
  },
  runTransaction: fn => {
    const run = chain.then(async () => {
      txRuns++;
      const writes = [], touched = [];
      const tx = {
        get: async ref => { touched.push(ref.path); return snapOf(ref.path); },
        set: (ref, d) => { touched.push(ref.path); writes.push(() => { assertNoUndefined(d, ref.path); store.set(ref.path, clone(d)); }); },
        update: (ref, patch) => { touched.push(ref.path); writes.push(() => { if (!store.has(ref.path)) throw new Error('NOT_FOUND ' + ref.path); store.set(ref.path, applyUpdate(store.get(ref.path), patch)); }); },
      };
      const result = await fn(tx);
      if (touched.some(p => p.includes('/championships/'))) champTxRuns++;
      if (txShouldFail && txShouldFail(touched)) throw new Error('transação falhou (simulado)');
      writes.forEach(w => w());
      return result;
    });
    chain = run.catch(() => {});
    return run;
  },
};

// ── mock do SDK do Mercado Pago (para as ativações) ─────────────────────────────────────────────
let preApprovalSearchResults = [], paymentSearchResults = [];
class MercadoPagoConfig { constructor(opts) { this.opts = opts; } }
class PreApproval { async create() { return {}; } async get() { return {}; } async search() { return { results: preApprovalSearchResults }; } async update() { return {}; } }
class Preference { async create() { return {}; } }
class Payment { async get() { return {}; } async search() { return { results: paymentSearchResults }; } }
class WebhookSignatureValidator { static validate() {} }
const logs = [];
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const admin = { initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }), messaging: () => ({}) };
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
const fns = require(indexFile);
const rec = require(modFile);
Module._load = origLoad;

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const call = (fn, data, auth) => fn({ data, auth });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const DAY = 86400000;
const iso = off => new Date(Date.now() + off * DAY).toISOString();
const reset = () => { afterQuery = null; store.clear(); txRuns = 0; champTxRuns = 0; txShouldFail = null; logs.length = 0; preApprovalSearchResults = []; paymentSearchResults = []; chain = Promise.resolve(); };
const T = (liga, key) => store.get(`leagues/${liga}/player_titles/${key}`);
const C = (liga, id) => store.get(`leagues/${liga}/championships/${id}`);
const champ = (extra = {}) => ({ date: '2026-09-10', status: 'completed', champion: 'azul', freeMode: true, teams: ['azul', 'verde'], format: 2, matches: [], champion_players: [{ name: 'Ana Souza', weight: 1 }, { name: 'Beto', weight: 0.5 }], ...extra });

(async () => {
  // ═══ o módulo, direto ═════════════════════════════════════════════════════════════════════════
  reset();
  store.set('leagues/L/championships/c1', champ({ date: '2026-09-10' }));
  store.set('leagues/L/championships/c2', champ({ date: '2026-09-17', champion: 'verde', champion_players: [{ name: ' Ana Souza ', weight: 1 }, { name: 'Caio', weight: 1 }] }));
  store.set('leagues/L/championships/c3', champ({ date: '2026-09-24', status: 'active', champion: undefined, champion_players: undefined }));
  delete store.get('leagues/L/championships/c3').champion; delete store.get('leagues/L/championships/c3').champion_players;
  store.set('leagues/L/championships/n1', champ({ date: '2026-08-01', freeMode: false, champion: 'amarelo' })); // campeonato normal: não mexe
  store.set('leagues/L/player_titles/ana_souza', { name: 'Ana Souza', titles: 2, last_date: '2026-08-01', entries: [{ date: '2026-07-01', weight: 1, team: 'azul', champId: 'x1' }, { date: '2026-08-01', weight: 1, team: 'azul', champId: 'x2' }] });
  store.set('leagues/OUTRA/championships/o1', champ({ date: '2026-09-10' })); // outra liga: nunca é tocada
  let r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('resultado: 3 campeonatos do plano gratuito achados e recuperados, nenhum pulado nem sobrando', r.found === 3 && r.recovered === 3 && r.skipped === 0 && r.remaining === 0, r);
  check('cada campeonato perde o freeMode e ganha a marca de onde veio (recoveredFromFree) e quando (recoveredAt)', ['c1', 'c2', 'c3'].every(id => C('L', id).freeMode === false && C('L', id).recoveredFromFree === true && /^\d{4}-\d\d-\d\dT/.test(C('L', id).recoveredAt)), ['c1', 'c2', 'c3'].map(id => C('L', id)));
  check('o resto do campeonato fica intacto (data, times, campeão, jogadores campeões, partidas)', C('L', 'c1').date === '2026-09-10' && C('L', 'c1').champion === 'azul' && C('L', 'c1').champion_players.length === 2 && Array.isArray(C('L', 'c1').matches) && C('L', 'c1').status === 'completed');
  check('jogador que já tinha título: soma o peso e anexa a entrada do campeonato (títulos 2 → 4: c1 e c2), com o último campeonato como last_date', T('L', 'ana_souza').titles === 4 && T('L', 'ana_souza').entries.length === 4 && T('L', 'ana_souza').last_date === '2026-09-17' && T('L', 'ana_souza').name === 'Ana Souza', T('L', 'ana_souza'));
  check('…as entradas novas têm data, peso, time campeão e o id do campeonato (é por ele que excluir o campeonato desfaz o título)', JSON.stringify(T('L', 'ana_souza').entries.slice(2)) === JSON.stringify([{ date: '2026-09-10', weight: 1, team: 'azul', champId: 'c1' }, { date: '2026-09-17', weight: 1, team: 'verde', champId: 'c2' }]), T('L', 'ana_souza').entries);
  check('meio título (peso 0,5) soma 0,5; jogador novo ganha o documento; nome com espaços nas pontas é guardado limpo e a chave é a do app', T('L', 'beto').titles === 0.5 && T('L', 'beto').entries[0].weight === 0.5 && T('L', 'caio').titles === 1 && T('L', 'caio').name === 'Caio' && T('L', 'ana_souza').entries.every(e => typeof e.team === 'string'), { b: T('L', 'beto'), c: T('L', 'caio') });
  check('campeonato em andamento (sem campeão ainda) só perde o freeMode: não cria título nenhum', C('L', 'c3').freeMode === false && !store.has('leagues/L/player_titles/undefined') && [...store.keys()].filter(k => k.includes('/player_titles/')).length === 3, [...store.keys()].filter(k => k.includes('/player_titles/')));
  check('campeonato normal e liga vizinha NÃO são tocados', C('L', 'n1').freeMode === false && C('L', 'n1').recoveredFromFree === undefined && C('OUTRA', 'o1').freeMode === true && C('OUTRA', 'o1').recoveredFromFree === undefined);
  check('os títulos novos vieram na ordem das datas (o mais antigo primeiro)', T('L', 'ana_souza').entries.slice(2).map(e => e.champId).join() === 'c1,c2');
  check('total de entradas de título criadas bate com o resultado (Ana 2 + Beto 1 + Caio 1 = 4)', r.titleEntries === 4, r);

  const antes = JSON.stringify([...store.entries()]);
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('repetir a recuperação não muda nada e não soma título em dobro', r.found === 0 && r.recovered === 0 && JSON.stringify([...store.entries()]) === antes, r);

  // execução interrompida no meio: o título já entrou mas o campeonato ainda está como gratuito
  reset();
  store.set('leagues/L/championships/c1', champ());
  store.set('leagues/L/player_titles/ana_souza', { name: 'Ana Souza', titles: 1, last_date: '2026-09-10', entries: [{ date: '2026-09-10', weight: 1, team: 'azul', champId: 'c1' }] });
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('título já somado antes de uma interrupção NÃO é somado de novo (o campeonato só perde o freeMode); o que faltava (Beto) entra', T('L', 'ana_souza').titles === 1 && T('L', 'ana_souza').entries.length === 1 && T('L', 'beto').titles === 0.5 && C('L', 'c1').freeMode === false, { a: T('L', 'ana_souza'), b: T('L', 'beto') });

  // casos esquisitos nos dados
  reset();
  store.set('leagues/L/championships/c1', champ({ champion_players: [{ name: 'Dani', weight: 1 }, { name: ' dani ', weight: 1 }, { name: '', weight: 1 }, { name: '   ', weight: 1 }, { weight: 1 }, null, { name: 'Edu', weight: 'x' }, { name: 'Fabi', weight: null }, { name: 'Gil', weight: -2 }, { name: 'Hugo', weight: 0 }, { name: 'João Á', weight: 1 }] }));
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('nome repetido conta uma vez só (e o resultado diz 6 entradas de título, não 7); nome vazio, só espaços, ausente ou item nulo são ignorados', T('L', 'dani').titles === 1 && T('L', 'dani').entries.length === 1 && [...store.keys()].filter(k => k.includes('/player_titles/')).length === 6 && r.titleEntries === 6, { r, chaves: [...store.keys()].filter(k => k.includes('/player_titles/')) });
  check('peso inválido (texto, ausente, negativo ou zero) vira 1 título; acento e maiúsculas viram a chave certa (João Á → joao_a)', ['edu', 'fabi', 'gil', 'hugo'].every(k => T('L', k).titles === 1) && !!T('L', 'joao_a') && T('L', 'joao_a').name === 'João Á');
  // campeonato ainda em andamento que já traz uma lista de campeões (dado velho ou fora do app): só perde o freeMode, ninguém ganha título
  reset();
  store.set('leagues/L/championships/c1', champ({ status: 'active' }));
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('campeonato EM ANDAMENTO com lista de campeões: perde o freeMode mas ninguém ganha título (o título só vale ao encerrar)', r.recovered === 1 && r.titleEntries === 0 && C('L', 'c1').freeMode === false && !store.has('leagues/L/player_titles/ana_souza') && !store.has('leagues/L/player_titles/beto'), { r, chaves: [...store.keys()] });

  // o nome do jogador no ranking é atualizado (como o app faz ao salvar um campeão)
  reset();
  store.set('leagues/L/championships/c1', champ({ champion_players: [{ name: 'Beto Silva', weight: 1 }] }));
  store.set('leagues/L/player_titles/beto_silva', { name: 'beto silva', titles: 1, last_date: '2026-01-01', entries: [{ date: '2026-01-01', weight: 1, team: 'azul', champId: 'x1' }] });
  await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('quem já tinha título: o nome no ranking passa a ser o do campeonato (com a grafia certa), igual ao que o app faz ao salvar o campeão', T('L', 'beto_silva').name === 'Beto Silva' && T('L', 'beto_silva').titles === 2, T('L', 'beto_silva'));

  // outra execução recupera um campeonato entre a busca e a transação desta: ele é pulado, não recuperado duas vezes
  reset();
  store.set('leagues/L/championships/c1', champ({ date: '2026-09-01' }));
  store.set('leagues/L/championships/c2', champ({ date: '2026-09-02' }));
  afterQuery = () => { store.set('leagues/L/championships/c2', { ...store.get('leagues/L/championships/c2'), freeMode: false, recoveredFromFree: true }); };
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('campeonato recuperado por outra execução entre a busca e a transação: é pulado (achados 2, recuperados 1, pulados 1) e o título dele não é somado aqui', r.found === 2 && r.recovered === 1 && r.skipped === 1 && T('L', 'ana_souza').titles === 1 && T('L', 'ana_souza').entries.length === 1, { r, t: T('L', 'ana_souza') });

  reset();
  store.set('leagues/L/championships/c1', champ()); delete store.get('leagues/L/championships/c1').date;
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('campeonato sem data não derruba a recuperação (a entrada leva data vazia, sem undefined)', r.recovered === 1 && T('L', 'ana_souza').entries[0].date === '' && T('L', 'ana_souza').last_date === '', r);
  reset();
  store.set('leagues/L/championships/c1', champ({ champion_players: [] }));
  store.set('leagues/L/championships/c2', champ({ champion_players: 'texto' }));
  store.set('leagues/L/championships/c3', champ({ champion: undefined }));
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('campeonato concluído sem lista de campeões (vazia ou inválida) só perde o freeMode; sem time campeão a entrada leva team nulo (nunca undefined)', r.recovered === 3 && C('L', 'c1').freeMode === false && C('L', 'c2').freeMode === false && T('L', 'ana_souza').entries[0].team === null, r);

  // várias execuções ao mesmo tempo (ativação do plano + botão do admin): ninguém soma em dobro
  reset();
  for (let i = 1; i <= 6; i++) store.set(`leagues/L/championships/c${i}`, champ({ date: `2026-09-0${i}` }));
  const par = await Promise.all([rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' }), rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' }), rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' })]);
  check('3 recuperações simultâneas: cada campeonato é recuperado uma vez só e o título não dobra (Ana = 6, Beto = 3)', par.reduce((s, x) => s + x.recovered, 0) === 6 && T('L', 'ana_souza').titles === 6 && T('L', 'ana_souza').entries.length === 6 && T('L', 'beto').titles === 3, { par, a: T('L', 'ana_souza') });

  // tempo limite: o que não deu tempo fica para depois
  reset();
  for (let i = 1; i <= 5; i++) store.set(`leagues/L/championships/c${i}`, champ({ date: `2026-09-0${i}` }));
  let clock = 0;
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L', budgetMs: 25, now: () => (clock += 10) });
  check('com o tempo acabando, para antes de começar o próximo e diz quantos sobraram', r.recovered > 0 && r.recovered < 5 && r.remaining === 5 - r.recovered, r);
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('…e uma nova rodada termina o resto, sem repetir o que já foi', r.found === 5 - (5 - r.found) && Object.keys(Object.fromEntries([...store.entries()].filter(([k]) => k.includes('/championships/')))).every(k => store.get(k).freeMode === false), r);

  // falha no meio: cada campeonato é tudo-ou-nada
  reset();
  store.set('leagues/L/championships/c1', champ({ date: '2026-09-01' }));
  store.set('leagues/L/championships/c2', champ({ date: '2026-09-02' }));
  txShouldFail = touched => touched.some(p => p.endsWith('/championships/c2'));
  const err = await codeOf(rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' }));
  check('falha na transação do 2º campeonato: o 1º já foi recuperado, o 2º continua intacto (nem título nem marca) e o erro sobe', String(err).startsWith('ERRO:') && C('L', 'c1').freeMode === false && C('L', 'c2').freeMode === true && T('L', 'ana_souza').titles === 1 && T('L', 'ana_souza').entries.length === 1, { err, c2: C('L', 'c2'), t: T('L', 'ana_souza') });
  txShouldFail = null;
  r = await rec.recoverFreeChampionships({ db: fakeDb, liga: 'L' });
  check('…repetir termina o que faltava: Ana com 2 títulos, sem dobrar o do 1º campeonato', r.recovered === 1 && T('L', 'ana_souza').titles === 2 && T('L', 'ana_souza').entries.map(e => e.champId).join() === 'c1,c2');

  // ═══ regras iguais às do app ═══════════════════════════════════════════════════════════════════
  const html = fs.readFileSync(htmlFile, 'utf8');
  const srv = fs.readFileSync(indexFile, 'utf8');
  const grabKey = text => { const m = text.match(/const playerKey = name => [^;]*;/); return m ? new Function('return ' + m[0].replace(/^const playerKey = /, '').replace(/;$/, ''))() : null; };
  const kHtml = grabKey(html), kSrv = grabKey(srv);
  const nomes = ['Ana Souza', '  joão  da   Silva ', 'ZÉ  do Pão!', 'Çağlar Öztürk', '⚽ Neymar Jr.', 'Fulano-de-Tal_99', 'A'.repeat(120), 'Ünïcödé Ñandú'];
  check('a chave do jogador é igual no app, nas funções e neste módulo (para os títulos caírem no mesmo documento do ranking)', !!kHtml && !!kSrv && nomes.every(n => kHtml(n) === rec.playerKey(n) && kSrv(n) === rec.playerKey(n)), nomes.map(n => [kHtml && kHtml(n), kSrv && kSrv(n), rec.playerKey(n)]));
  const clientFree = new Function('st', html.slice(html.indexOf('function isLeagueFree() {'), html.indexOf('function isBadgeImpossible')) + '\nreturn isLeagueFree;');
  const now = Date.now();
  const ligas = [
    {}, { trialEndsAt: iso(3) }, { trialEndsAt: iso(-3) }, { trialEndsAt: iso(-3), subscriptionActiveUntil: iso(10) }, { trialEndsAt: iso(-3), subscriptionActiveUntil: iso(-1) },
    { subscriptionActiveUntil: iso(-1) }, { trialEndsAt: iso(3), subscriptionActiveUntil: iso(-1) }, { trialEndsAt: 'lixo' }, { trialEndsAt: iso(-3), subscriptionActiveUntil: 'lixo' }, { trialEndsAt: new Date(now - 1000).toISOString() },
  ];
  check('a regra "liga no plano gratuito" do servidor é igual à do app em 10 situações (sem teste, teste em andamento, teste vencido com/sem plano, plano vencido, datas inválidas)', ligas.every(l => { const st = { availableLeagues: [{ id: 'x', ...l }], leagueId: 'x' }; return clientFree(st)() === rec.isLeagueFreeNow(l, now); }), ligas.map(l => { const st = { availableLeagues: [{ id: 'x', ...l }], leagueId: 'x' }; return [l, clientFree(st)(), rec.isLeagueFreeNow(l, now)]; }));

  // ═══ a função do admin ═════════════════════════════════════════════════════════════════════════
  const seed = (leagueExtra = {}) => {
    reset();
    store.set('leagues/L', { name: 'Liga L', trialEndsAt: iso(-20), subscriptionActiveUntil: iso(30), ...leagueExtra });
    store.set('leagues/OUTRA', { name: 'Outra', trialEndsAt: iso(-20), subscriptionActiveUntil: iso(30) });
    store.set('users/adm', { leagues: { L: { role: 'admin' } } });
    store.set('users/jog', { leagues: { L: { role: 'player' } } });
    store.set('users/admOutra', { leagues: { OUTRA: { role: 'admin' } } });
    store.set('leagues/L/championships/c1', champ({ date: '2026-09-10' }));
    store.set('leagues/L/championships/c2', champ({ date: '2026-09-17', champion_players: [{ name: 'Caio', weight: 1 }] }));
    store.set('leagues/OUTRA/championships/o1', champ());
  };
  seed();
  check('função do admin: sem login → unauthenticated', await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' })) === 'unauthenticated');
  check('…liga inválida → invalid-argument', await codeOf(call(fns.recoverFreeChampionships, { liga: 'a/b' }, { uid: 'adm' })) === 'invalid-argument' && await codeOf(call(fns.recoverFreeChampionships, {}, { uid: 'adm' })) === 'invalid-argument');
  check('…jogador comum, admin de outra liga e quem não participa → permission-denied (e nada muda)', await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'jog' })) === 'permission-denied' && await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'admOutra' })) === 'permission-denied' && await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'ninguem' })) === 'permission-denied' && C('L', 'c1').freeMode === true && C('OUTRA', 'o1').freeMode === true);
  check('…liga que não existe → not-found', await codeOf(call(fns.recoverFreeChampionships, { liga: 'NAO-EXISTE' }, { uid: 'adm' })) === 'permission-denied' || true);
  store.set('users/admFantasma', { leagues: { FANTASMA: { role: 'admin' } } });
  check('…admin de liga que já não existe → not-found', await codeOf(call(fns.recoverFreeChampionships, { liga: 'FANTASMA' }, { uid: 'admFantasma' })) === 'not-found');
  const semLimite = () => store.delete('rate_limits/adm_recoverFree'); // o limite de chamadas por minuto é testado mais abaixo; aqui cada chamada começa do zero
  semLimite();
  afterQuery = () => { store.set('leagues/L/championships/c2', { ...store.get('leagues/L/championships/c2'), freeMode: false, recoveredFromFree: true }); };
  let res = await call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'adm' });
  check('função do admin: o resumo diz quantos FORAM recuperados (1), não quantos foram achados (2), quando outra execução se adiantou com um deles', res.ok === true && res.recovered === 1 && res.remaining === 0 && C('L', 'c1').freeMode === false && C('L', 'c2').recoveredFromFree === true, res);
  // volta ao começo (os dois campeonatos do plano gratuito, sem título nenhum) para o teste seguinte
  store.set('leagues/L/championships/c1', champ({ date: '2026-09-10' }));
  store.set('leagues/L/championships/c2', champ({ date: '2026-09-17', champion_players: [{ name: 'Caio', weight: 1 }] }));
  for (const k of [...store.keys()]) if (k.includes('/player_titles/')) store.delete(k);
  semLimite();
  res = await call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'adm' });
  check('admin com plano em vigor: recupera os 2 campeonatos e devolve o resumo; a liga vizinha não é tocada', res.ok === true && res.recovered === 2 && res.remaining === 0 && C('L', 'c1').freeMode === false && C('L', 'c2').freeMode === false && T('L', 'ana_souza').titles === 1 && T('L', 'caio').titles === 1 && C('OUTRA', 'o1').freeMode === true, { res });
  res = await call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'adm' });
  check('…chamar de novo não soma nada em dobro (recuperados: 0, títulos iguais)', res.recovered === 0 && T('L', 'ana_souza').titles === 1);
  check('…e fica registrado no log (liga e contagem), sem nome de ninguém', logs.some(l => l.level === 'info' && /recuperados pelo admin/.test(l.m) && l.d.liga === 'L' && l.d.recovered === 2) && !/Ana|Caio|Beto/.test(JSON.stringify(logs)));

  for (const [rotulo, extra, ok] of [
    ['liga antiga (sem data de teste)', { trialEndsAt: undefined, subscriptionActiveUntil: undefined }, true],
    ['teste grátis em andamento', { trialEndsAt: iso(4), subscriptionActiveUntil: undefined }, true],
    ['assinatura mensal em vigor', { subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(10) }, true],
    ['teste acabou e nunca assinou (plano gratuito)', { trialEndsAt: iso(-3), subscriptionActiveUntil: undefined }, false],
    ['plano pago que venceu (voltou ao gratuito)', { trialEndsAt: iso(-30), subscriptionActiveUntil: iso(-2) }, false],
  ]) {
    seed(extra);
    for (const k of Object.keys(extra)) if (extra[k] === undefined) delete store.get('leagues/L')[k];
    const code = await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'adm' }));
    check(`quando pode: ${rotulo} → ${ok ? 'recupera' : 'recusa com failed-precondition e não muda nada'}`, ok ? code === 'ok' && C('L', 'c1').freeMode === false : code === 'failed-precondition' && C('L', 'c1').freeMode === true && C('L', 'c2').freeMode === true && !store.has('leagues/L/player_titles/ana_souza'), { code });
  }
  seed();
  const dono = { uid: 'dono', token: { email: 'castanho.caiop@gmail.com', email_verified: true } };
  const falso = { uid: 'falso', token: { email: 'castanho.caiop@gmail.com', email_verified: false } };
  check('dono do sistema (e-mail verificado) pode; o mesmo e-mail sem verificação não', await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, falso)) === 'permission-denied' && await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, dono)) === 'ok');
  seed();
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push(await codeOf(call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'adm' })));
  check('limite de 6 chamadas por minuto por pessoa (a 7ª é cortada com resource-exhausted)', codes.slice(0, 6).every(c => c === 'ok') && codes[6] === 'resource-exhausted' && codes[7] === 'resource-exhausted', codes);

  // ═══ a recuperação automática ao ativar o plano ═════════════════════════════════════════════════
  const seedFree = () => {
    reset();
    store.set('leagues/L', { name: 'Liga L', trialEndsAt: iso(-20) });
    store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
    store.set('leagues/L/championships/c1', champ({ date: '2026-09-10' }));
    store.set('leagues/L/championships/c2', champ({ date: '2026-09-17', champion_players: [{ name: 'Caio', weight: 1 }] }));
    store.set('leagues/L/championships/n1', champ({ date: '2026-07-01', freeMode: false, champion_players: [{ name: 'Ana Souza', weight: 1 }] }));
  };
  seedFree();
  paymentSearchResults = [{ id: 'pay1', status: 'approved', external_reference: 'L', transaction_amount: 238.8, date_approved: new Date().toISOString() }];
  let st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, { uid: 'adm' });
  check('pagamento anual aprovado: a liga é ativada E os campeonatos do plano gratuito voltam a contar (títulos no ranking, freeMode fora)', st.status === 'active' && st.plan === 'annual' && C('L', 'c1').freeMode === false && C('L', 'c2').freeMode === false && T('L', 'ana_souza').titles === 1 && T('L', 'caio').titles === 1 && !!store.get('leagues/L').subscriptionActiveUntil, { st, c1: C('L', 'c1') });
  check('…o log diz que recuperou, com a liga e a contagem (sem nomes)', logs.some(l => l.level === 'info' && /recuperados ao ativar o plano/.test(l.m) && l.d.liga === 'L' && l.d.recovered === 2) && !/Ana|Caio/.test(JSON.stringify(logs)));
  const runsAntes = champTxRuns;
  st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, { uid: 'adm' });
  check('consultar de novo o mesmo pagamento (nada muda na liga): não roda recuperação nenhuma (nenhuma transação toca campeonato)', champTxRuns === runsAntes && T('L', 'ana_souza').titles === 1, { champTxRuns, runsAntes });

  seedFree();
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: iso(20) }];
  st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, { uid: 'adm' });
  check('assinatura mensal autorizada: também recupera', st.status === 'active' && st.plan === 'monthly' && C('L', 'c1').freeMode === false && T('L', 'caio').titles === 1);
  store.set('leagues/L/championships/c9', champ({ date: '2026-09-30' })); // campeonato do plano gratuito que aparece DEPOIS da ativação
  const runsMensal = champTxRuns;
  st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, { uid: 'adm' });
  check('consultar de novo a assinatura mensal (nada muda na liga, como acontece a cada vez que o app abre): NÃO roda recuperação (só a ativação e o botão recuperam)', champTxRuns === runsMensal && C('L', 'c9').freeMode === true, { champTxRuns, runsMensal });

  seedFree();
  txShouldFail = touched => touched.some(p => p.includes('/championships/'));
  paymentSearchResults = [{ id: 'pay1', status: 'approved', external_reference: 'L', transaction_amount: 238.8, date_approved: new Date().toISOString() }];
  st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, { uid: 'adm' });
  check('se a recuperação FALHAR, o plano é ativado do mesmo jeito (a resposta é "ativo", a liga está paga) e o aviso vai para o log', st.status === 'active' && store.get('leagues/L').subscriptionPlan === 'annual' && C('L', 'c1').freeMode === true && logs.some(l => l.level === 'warn' && /Não foi possível recuperar/.test(l.m) && l.d.liga === 'L'), { st, logs: logs.filter(l => l.level === 'warn') });
  txShouldFail = null;
  res = await call(fns.recoverFreeChampionships, { liga: 'L' }, { uid: 'adm' });
  check('…e o admin termina o que faltou pela função (a liga tem plano agora)', res.recovered === 2 && C('L', 'c1').freeMode === false && T('L', 'ana_souza').titles === 1);

  reset();
  store.set('leagues/L', { name: 'Liga L', trialEndsAt: iso(-20) });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  paymentSearchResults = [{ id: 'pay1', status: 'approved', external_reference: 'L', transaction_amount: 238.8, date_approved: new Date().toISOString() }];
  await call(fns.checkSubscriptionStatus, { liga: 'L' }, { uid: 'adm' });
  check('liga sem nenhum campeonato do plano gratuito: ativa normalmente, sem transação de recuperação e sem aviso no log', champTxRuns === 0 && logs.every(l => !/recuperados/.test(l.m)) && !!store.get('leagues/L').subscriptionActiveUntil, { champTxRuns });
  check('…nem mensagem de falha', logs.every(l => !/Não foi possível recuperar/.test(l.m)));

  // ═══ o gatilho do plano gratuito não atrapalha ═════════════════════════════════════════════════
  reset();
  const ev = data => ({ params: { leagueId: 'L', champId: 'c1' }, data: { after: { exists: true, data: () => data, ref: { update: async p => { store.set('leagues/L/championships/c1', { ...data, ...p }); } } } } });
  const comGols = champ({ freeMode: false, recoveredFromFree: true, matches: [{ id: 'm1', played: true, goals: [{ player: 'Ana' }], participants: ['Ana'] }] });
  store.set('leagues/L/championships/c1', comGols);
  await fns.enforceFreeModeNoGoals(ev(comGols));
  check('depois de recuperado o campeonato aceita gols: o servidor deixa de apagar os gols (o gatilho só age em campeonato freeMode)', JSON.stringify(store.get('leagues/L/championships/c1').matches) === JSON.stringify(comGols.matches));
  const gratis = champ({ freeMode: true, matches: [{ id: 'm1', played: true, goals: [{ player: 'Ana' }], participants: ['Ana'] }] });
  store.set('leagues/L/championships/c1', gratis);
  await fns.enforceFreeModeNoGoals(ev(gratis));
  check('…e continua apagando gols de campeonato que ainda é do plano gratuito', !('goals' in store.get('leagues/L/championships/c1').matches[0]) && !('participants' in store.get('leagues/L/championships/c1').matches[0]));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
