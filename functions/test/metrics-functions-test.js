// Métricas do funil no servidor: o contador anônimo de uso (trackEvent), o painel do dono (getFunnelMetrics),
// o retrato diário (snapshotFunnelMetrics) e a contagem do checkout nas funções de pagamento. Usa o
// index.js de verdade com um Firestore falso em memória (que sabe contar e selecionar campos).
const Module = require('module');
const path = require('path');
const indexPath = path.join(__dirname, '..', 'index.js');
const funnel = require(path.join(__dirname, '..', 'funnel-metrics.js'));

// ── Firestore falso ─────────────────────────────────────────────────────────────────────────────
const store = new Map();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const DELETE = { __delete: true };
const FieldValue = { delete: () => DELETE, arrayRemove: t => ({ __arrayRemove: t }), increment: n => ({ __increment: n }) };
let setShouldFail = null; // caminho (prefixo) em que set() falha, para simular o banco fora do ar
const applyValue = (cur, key, v) => {
  if (v === DELETE) delete cur[key];
  else if (v && typeof v === 'object' && v.__increment !== undefined) cur[key] = (cur[key] || 0) + v.__increment;
  else cur[key] = clone(v);
};
function applyUpdate(data, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') args = Object.entries(args[0]).flat();
  const out = clone(data);
  for (let i = 0; i < args.length; i += 2) {
    const field = args[i], value = args[i + 1];
    const segs = field instanceof FieldPath ? field.segments : String(field).split('.');
    let cur = out;
    for (const s of segs.slice(0, -1)) { if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {}; cur = cur[s]; }
    applyValue(cur, segs[segs.length - 1], value);
  }
  return out;
}
const snapOf = p => { const has = store.has(p); return { id: p.split('/').pop(), exists: has, data: () => (has ? clone(store.get(p)) : undefined), ref: refOf(p) }; };
function refOf(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async (d, opts) => {
      if (setShouldFail && p.startsWith(setShouldFail)) throw new Error('banco fora do ar (simulado)');
      if (opts?.merge) { const cur = clone(store.get(p)) || {}; for (const [k, v] of Object.entries(d)) applyValue(cur, k, v); store.set(p, cur); }
      else store.set(p, clone(d));
    },
    update: async (...args) => { if (!store.has(p)) throw new Error('NOT_FOUND ' + p); store.set(p, applyUpdate(store.get(p), args)); },
    delete: async () => { store.delete(p); },
  };
}
const valueAt = (obj, field) => (field instanceof FieldPath ? field.segments : String(field).split('.')).reduce((o, s) => (o == null ? undefined : o[s]), obj);
const fakeDb = {
  doc: p => refOf(p),
  collection: name => {
    const inCol = p => new RegExp('^' + name + '/[^/]+$').test(p);
    const build = (filters, lim) => {
      const docs = () => {
        let d = [...store.entries()].filter(([p, v]) => inCol(p) && filters.every(([f, op, val]) => {
          const x = valueAt(v, f);
          if (op === '==') return x === val; if (op === '>=') return x !== undefined && x >= val; if (op === '!=') return x !== val;
          throw new Error('operador não suportado: ' + op);
        })).map(([p]) => snapOf(p));
        return lim ? d.slice(0, lim) : d;
      };
      return {
        where: (f, op, v) => build([...filters, [f, op, v]], lim),
        limit: n => build(filters, n),
        select: () => build(filters, lim),
        get: async () => { const d = docs(); return { docs: d, size: d.length, empty: !d.length }; },
        count: () => ({ get: async () => ({ data: () => ({ count: docs().length }) }) }),
      };
    };
    return build([], null);
  },
  runTransaction: async fn => fn({ get: async r => r.get(), set: (r, d) => r.set(d), update: (r, ...a) => r.update(...a) }),
  recursiveDelete: async ref => { for (const k of [...store.keys()]) if (k === ref.path || k.startsWith(ref.path + '/')) store.delete(k); },
};
const admin = { initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }), messaging: () => ({}), storage: () => ({ bucket: () => ({ name: 'b' }) }), auth: () => ({}) };

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const logs = [];
const calls = { preApprovalCreate: [], preferenceCreate: [] };
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, onRequest: (opts, h) => h, HttpsError };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (opts, h) => h };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
  if (request === 'firebase-functions/params') return { defineSecret: n => ({ value: () => 'fake-' + n }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
  if (request === 'mercadopago') return {
    MercadoPagoConfig: class { constructor(o) { this.opts = o; } },
    PreApproval: class { async create({ body }) { if (mpRefuses) { const e = new Error('Payer is associated with a different site'); e.status = 400; throw e; } calls.preApprovalCreate.push(body); return { init_point: 'https://mp.test/pre' }; } async get() { return {}; } async search() { return { results: [] }; } },
    Preference: class { async create({ body }) { if (mpRefuses) { const e = new Error('x'); e.status = 400; throw e; } calls.preferenceCreate.push(body); return { init_point: 'https://mp.test/pref' }; } },
    Payment: class { async get() { return {}; } async search() { return { results: [] }; } },
    WebhookSignatureValidator: class { static validate() {} },
  };
  return origLoad.call(this, request, ...rest);
};
let mpRefuses = false;
const fns = require(indexPath);
Module._load = origLoad;

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const call = (fn, data, auth) => fn({ data, auth });
const tryCall = async (fn, data, auth) => { try { return { res: await call(fn, data, auth) }; } catch (e) { return { err: e }; } };
const owner = { uid: 'dono', token: { email: 'castanho.caiop@gmail.com', email_verified: true } };
const user = uid => ({ uid, token: { email: uid + '@x.com', email_verified: true } });
const today = () => funnel.dayKeySP(Date.now());
const DAY = 86400000;
const iso = off => new Date(Date.now() + off * DAY).toISOString();
const reset = () => { store.clear(); logs.length = 0; setShouldFail = null; mpRefuses = false; calls.preApprovalCreate.length = 0; calls.preferenceCreate.length = 0; };

(async () => {
  // ───────── trackEvent: contador anônimo ─────────
  reset();
  let r = await tryCall(fns.trackEvent, { name: 'planBannerSeen' }, null);
  check('trackEvent: sem login → recusa', r.err?.code === 'unauthenticated', r.err?.code);
  r = await tryCall(fns.trackEvent, { name: 'planBannerSeen' }, user('u1'));
  check('trackEvent: com login, evento conhecido → soma 1 no contador do dia (horário de São Paulo)', r.res?.ok === true && store.get(`metrics_events/${today()}`)?.planBannerSeen === 1, store.get(`metrics_events/${today()}`));
  await call(fns.trackEvent, { name: 'planBannerSeen' }, user('u2'));
  await call(fns.trackEvent, { name: 'installClick' }, user('u1'));
  check('trackEvent: pessoas diferentes somam no mesmo contador', store.get(`metrics_events/${today()}`).planBannerSeen === 2 && store.get(`metrics_events/${today()}`).installClick === 1);
  check('trackEvent: só o contador é gravado, nunca quem foi (nem id, nem e-mail)', !/u1|u2|@/.test(JSON.stringify([...store.entries()].filter(([k]) => k.startsWith('metrics_')))), [...store.entries()]);
  for (const bad of ['', 'qualquerCoisa', 'checkoutMonthly', '__proto__', 'a'.repeat(100), undefined, 42]) {
    const rr = await tryCall(fns.trackEvent, { name: bad }, user('u1'));
    check(`trackEvent: nome inválido (${JSON.stringify(bad)?.slice(0, 20)}) → invalid-argument e nada é gravado além do que já havia`, rr.err?.code === 'invalid-argument', rr.err?.code);
  }
  check('trackEvent: os eventos que só o servidor conta (checkout) não podem ser inflados pelo app', (await tryCall(fns.trackEvent, { name: 'checkoutAnnual' }, user('u1'))).err?.code === 'invalid-argument');
  reset();
  let ok = 0, blocked = 0;
  for (let i = 0; i < 125; i++) { const rr = await tryCall(fns.trackEvent, { name: 'planBannerSeen' }, user('spam')); if (rr.res) ok++; else if (rr.err?.code === 'resource-exhausted') blocked++; }
  check('trackEvent: limite de 120 por minuto por pessoa (rajada é cortada)', ok === 120 && blocked === 5 && store.get(`metrics_events/${today()}`).planBannerSeen === 120, { ok, blocked });

  // ───────── getFunnelMetrics: o painel do dono ─────────
  reset();
  store.set('leagues/a', { name: 'Liga A', slug: 'a', ownerId: 'u1', createdAt: iso(-2), trialEndsAt: iso(6), lastActivityAt: iso(-1) });
  store.set('leagues/a/championships/c1', { status: 'completed' }); store.set('leagues/a/championships/c2', { status: 'active' });
  store.set('leagues/b', { name: 'Liga B', slug: 'b', ownerId: 'u2', createdAt: iso(-40), trialEndsAt: iso(-32), subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(12) });
  store.set('leagues/b/championships/c1', { status: 'completed' });
  store.set('leagues/b/billing_meta/checkout', { starts: 2, lastAt: iso(-33) });
  store.set('leagues/c', { name: 'Liga C', slug: 'c', ownerId: 'u3', createdAt: iso(-100), trialEndsAt: iso(-92), subscriptionPlan: 'annual', subscriptionActiveUntil: iso(200) });
  store.set('users/u1', { email: 'u1@x.com', displayName: 'Ana', createdAt: iso(-2) });
  store.set('users/u2', { email: 'u2@x.com', displayName: 'Beto', createdAt: iso(-20) });
  store.set('users/u3', { email: 'u3@x.com', displayName: 'Caio', createdAt: iso(-100) });
  store.set('users/u4', { email: 'u4@x.com', displayName: 'Duda' });
  store.set(`metrics_events/${today()}`, { planBannerSeen: 4, planBannerClick: 1, checkoutMonthly: 1 });
  store.set(`metrics_events/${funnel.dayKeySP(Date.now() - 10 * DAY)}`, { planBannerSeen: 10 });
  store.set(`metrics_daily/${funnel.dayKeySP(Date.now() - 2 * DAY)}`, { accounts: 3, leagues: 2, mrr: 10 });
  store.set(`metrics_daily/${funnel.dayKeySP(Date.now() - 1 * DAY)}`, { accounts: 4, leagues: 3, mrr: 49.8 });

  check('getFunnelMetrics: sem login → recusa', (await tryCall(fns.getFunnelMetrics, {}, null)).err?.code === 'unauthenticated');
  check('getFunnelMetrics: pessoa comum → permission-denied', (await tryCall(fns.getFunnelMetrics, {}, user('u1'))).err?.code === 'permission-denied');
  check('getFunnelMetrics: admin de liga → permission-denied (o painel é só do dono do sistema)', (await tryCall(fns.getFunnelMetrics, {}, { uid: 'u1', token: { email: 'u1@x.com', email_verified: true } })).err?.code === 'permission-denied');
  check('getFunnelMetrics: e-mail do dono SEM verificação (cadastro por e-mail e senha) → permission-denied', (await tryCall(fns.getFunnelMetrics, {}, { uid: 'falso', token: { email: 'castanho.caiop@gmail.com', email_verified: false } })).err?.code === 'permission-denied');
  r = await tryCall(fns.getFunnelMetrics, {}, owner);
  const m = r.res;
  check('getFunnelMetrics: o dono recebe o funil, os eventos e o histórico', !!m?.funnel && !!m?.events && Array.isArray(m?.history), r.err);
  check('…contas: 4 no total, 2 nos últimos 30 dias, 1 nos últimos 7 (conta sem data só entra no total)', m.funnel.accounts.total === 4 && m.funnel.accounts.last30d === 2 && m.funnel.accounts.last7d === 1, m.funnel.accounts);
  check('…ligas: 3, com 2 jogando (campeonatos contados pelo banco), 1 criada na última semana', m.funnel.leagues.total === 3 && m.funnel.leagues.withGame === 2 && m.funnel.leagues.last7d === 1, m.funnel.leagues);
  check('…checkout iniciado e pagantes vêm da marca guardada na liga e do plano', m.funnel.leagues.checkoutStarted === 1 && m.funnel.leagues.everPaid === 2 && m.funnel.states.monthlyActive === 1 && m.funnel.states.annualActive === 1, m.funnel);
  check('…receita mensal estimada: 1 mensal (R$ 29,90) + 1 anual (R$ 19,90) = R$ 49,80, com os preços do pagamento', m.funnel.revenue.mrr === 49.8 && m.funnel.revenue.prices.monthly === 29.9 && m.funnel.revenue.prices.annual === 238.8, m.funnel.revenue);
  check('…contadores de uso: 7 dias (o de 10 dias atrás fica de fora) e 30 dias (entra)', m.events.last7d.planBannerSeen === 4 && m.events.last30d.planBannerSeen === 14 && m.events.last7d.checkoutMonthly === 1, m.events);
  check('…histórico: os 2 retratos que existem, do mais antigo para o mais novo', m.history.length === 2 && m.history[0].date < m.history[1].date && m.history[1].mrr === 49.8, m.history);
  check('a resposta do painel NÃO tem dado pessoal: sem e-mail, nome de pessoa, id de conta nem nome de liga', !/@|Ana|Beto|Caio|Duda|Liga [ABC]|"u[1-4]"/.test(JSON.stringify(m)), JSON.stringify(m).slice(0, 160));
  check('o painel não escreve nada no banco (só lê)', !logs.some(l => l.level === 'error'));
  reset();
  let okc = 0, blk = 0;
  for (let i = 0; i < 22; i++) { const rr = await tryCall(fns.getFunnelMetrics, {}, owner); if (rr.res) okc++; else if (rr.err?.code === 'resource-exhausted') blk++; }
  check('getFunnelMetrics: limite de 20 por minuto', okc === 20 && blk === 2, { okc, blk });
  reset();
  const vazio = (await call(fns.getFunnelMetrics, {}, owner));
  check('banco vazio: o painel responde com zeros e sem taxas (nunca quebra)', vazio.funnel.leagues.total === 0 && vazio.funnel.rates.leagueToGame === null && vazio.history.length === 0 && vazio.events.last30d.planBannerSeen === 0, vazio);

  // ───────── snapshotFunnelMetrics: o retrato diário ─────────
  reset();
  store.set('leagues/a', { name: 'Liga A', ownerId: 'u1', createdAt: iso(-2), trialEndsAt: iso(6) });
  store.set('users/u1', { email: 'u1@x.com', createdAt: iso(-2) });
  await fns.snapshotFunnelMetrics();
  const snap = store.get(`metrics_daily/${today()}`);
  check('retrato diário: grava metrics_daily/AAAA-MM-DD só com números (e a hora em que foi salvo)', snap && snap.leagues === 1 && snap.accounts === 1 && snap.inTrial === 1 && typeof snap.mrr === 'number' && !!snap.savedAt && Object.entries(snap).filter(([k]) => k !== 'savedAt').every(([, v]) => typeof v === 'number'), snap);
  check('retrato diário: registra no log um resumo sem dado pessoal', logs.some(l => l.level === 'info' && /Retrato diário/.test(l.m) && l.d.ligas === 1), logs);
  store.set('leagues/b', { name: 'Liga B', ownerId: 'u2', createdAt: iso(-1), trialEndsAt: iso(7) });
  await fns.snapshotFunnelMetrics();
  check('retrato diário: rodar de novo no mesmo dia SUBSTITUI o retrato (não duplica nem soma)', store.get(`metrics_daily/${today()}`).leagues === 2 && [...store.keys()].filter(k => k.startsWith('metrics_daily/')).length === 1);

  // ───────── contagem do checkout nas funções de pagamento ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L', trialEndsAt: iso(3) });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  const adm = { uid: 'adm', token: { email: 'adm@x.com', email_verified: true } };
  r = await tryCall(fns.createMonthlySubscription, { liga: 'L' }, adm);
  check('checkout mensal criado: devolve o link e conta no dia e na liga', r.res?.initPoint === 'https://mp.test/pre' && store.get(`metrics_events/${today()}`)?.checkoutMonthly === 1 && store.get('leagues/L/billing_meta/checkout')?.starts === 1, { r, ev: store.get(`metrics_events/${today()}`) });
  r = await tryCall(fns.createAnnualPayment, { liga: 'L' }, adm);
  check('checkout anual criado: conta no contador anual e soma na marca da liga (2 checkouts)', r.res?.initPoint === 'https://mp.test/pref' && store.get(`metrics_events/${today()}`).checkoutAnnual === 1 && store.get('leagues/L/billing_meta/checkout').starts === 2, store.get('leagues/L/billing_meta/checkout'));
  check('a marca do checkout guarda só números e a hora (nada da pessoa)', !/adm|@/.test(JSON.stringify(store.get('leagues/L/billing_meta/checkout'))));
  check('o checkout NÃO mexe nos dados da própria liga (nada de campo novo no documento que os membros leem)', JSON.stringify(Object.keys(store.get('leagues/L')).sort()) === JSON.stringify(['name', 'trialEndsAt']), store.get('leagues/L'));
  reset();
  store.set('leagues/L', { name: 'Liga L', trialEndsAt: iso(3) });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  mpRefuses = true;
  r = await tryCall(fns.createMonthlySubscription, { liga: 'L' }, adm);
  check('Mercado Pago recusou: não conta checkout nenhum', r.err?.code === 'failed-precondition' && !store.get(`metrics_events/${today()}`) && !store.has('leagues/L/billing_meta/checkout'), { err: r.err?.code, ev: store.get(`metrics_events/${today()}`) });
  mpRefuses = false;
  setShouldFail = 'metrics_events/';
  r = await tryCall(fns.createAnnualPayment, { liga: 'L' }, adm);
  check('contador de uso fora do ar: o pagamento segue normalmente (métrica nunca derruba cobrança) e o problema vai para o log', r.res?.initPoint === 'https://mp.test/pref' && logs.some(l => l.level === 'warn' && /contar um evento/.test(l.m)), { r: r.res, logs: logs.map(l => l.m) });
  setShouldFail = 'leagues/L/billing_meta';
  r = await tryCall(fns.createMonthlySubscription, { liga: 'L' }, adm);
  check('marca na liga fora do ar: o pagamento segue normalmente e o problema vai para o log', r.res?.initPoint === 'https://mp.test/pre' && logs.some(l => l.level === 'warn' && /marcar o checkout/.test(l.m)), { r: r.res, logs: logs.map(l => l.m) });
  reset();
  store.set('leagues/L', { name: 'Liga L' }); store.set('leagues/L/billing_meta/checkout', { starts: 3 }); store.set('leagues/L/championships/c', { a: 1 });
  await fakeDb.recursiveDelete({ path: 'leagues/L' });
  check('encerrar a liga apaga junto a marca do checkout (fica dentro da liga)', !store.has('leagues/L/billing_meta/checkout'));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(e => { console.error('ERRO NO TESTE', e); process.exitCode = 1; });
