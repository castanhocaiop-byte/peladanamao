// Monitoramento de travamentos no servidor: a função HTTP que recebe os relatos (reportClientError), o painel do dono
// (getClientErrors) e o resumo diário por e-mail (notifyClientErrors). Usa o index.js de verdade com um Firestore falso
// em memória (que soma contadores aninhados como o de verdade e recusa "undefined").
const Module = require('module');
const path = require('path');
const indexPath = path.join(__dirname, '..', 'index.js');
const funnel = require(path.join(__dirname, '..', 'funnel-metrics.js'));
const ce = require(path.join(__dirname, '..', 'client-errors.js'));

// ── Firestore falso ─────────────────────────────────────────────────────────────────────────────────────────────
const store = new Map();
const clone = o => JSON.parse(JSON.stringify(o));
const DOC_ID = { __docId: true };
class FieldPath { constructor(...segments) { this.segments = segments; } static documentId() { return DOC_ID; } }
const FieldValue = { increment: n => ({ __inc: n }), delete: () => ({ __delete: true }), arrayRemove: t => ({ __arrayRemove: t }) };
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && v.__inc === undefined && !v.__delete;
function mergeInto(target, patch, where = '') {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) throw new Error('Firestore recusa "undefined" em ' + where + k);
    if (v && v.__inc !== undefined) target[k] = (typeof target[k] === 'number' ? target[k] : 0) + v.__inc;
    else if (v && v.__delete) delete target[k];
    else if (isPlain(v)) { if (!isPlain(target[k])) target[k] = {}; mergeInto(target[k], v, where + k + '.'); }
    else target[k] = clone(v);
  }
}
let failGetAll = false, failSetPrefix = null;
const writes = [];
const snapOf = p => { const has = store.has(p); return { id: p.split('/').pop(), exists: has, data: () => (has ? clone(store.get(p)) : undefined), ref: refOf(p) }; };
function refOf(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async (d, opts) => {
      if (failSetPrefix && p.startsWith(failSetPrefix)) throw new Error('banco fora do ar (simulado)');
      const cur = opts?.merge && store.has(p) ? clone(store.get(p)) : {};
      mergeInto(cur, d);
      store.set(p, cur);
      writes.push(p);
    },
    update: async d => { if (!store.has(p)) throw new Error('NOT_FOUND ' + p); const cur = clone(store.get(p)); mergeInto(cur, d); store.set(p, cur); },
    delete: async () => { store.delete(p); },
  };
}
const valueAt = (obj, field) => String(field).split('.').reduce((o, s) => (o == null ? undefined : o[s]), obj);
const queryLog = [];
function collectionOf(name) {
  const build = (filters, order, lim) => {
    const run = () => {
      let docs = [...store.entries()].filter(([p]) => new RegExp('^' + name + '/[^/]+$').test(p)).map(([p, v]) => ({ p, v }))
        .filter(({ p, v }) => filters.every(([f, op, val]) => {
          const x = f === DOC_ID ? p.split('/').pop() : valueAt(v, f);
          if (x === undefined) return false;
          if (op === '>=') return x >= val;
          if (op === '<') return x < val;
          if (op === '==') return x === val;
          throw new Error('operador não suportado: ' + op);
        }));
      if (order) docs.sort((a, b) => { const x = valueAt(a.v, order[0]), y = valueAt(b.v, order[0]); return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
      else docs.sort((a, b) => a.p.localeCompare(b.p));
      if (lim) docs = docs.slice(0, lim);
      return docs.map(({ p }) => snapOf(p));
    };
    return {
      where: (f, op, v) => build([...filters, [f, op, v]], order, lim),
      orderBy: (f, dir = 'asc') => build(filters, [f, dir], lim),
      limit: n => build(filters, order, n),
      get: async () => { queryLog.push({ name, filters: filters.map(([f, op, v]) => [f === DOC_ID ? '__name__' : f, op, v]), order, lim }); const d = run(); return { docs: d, size: d.length, empty: !d.length }; },
    };
  };
  return build([], null, null);
}
const fakeDb = {
  doc: refOf,
  collection: collectionOf,
  getAll: async (...refs) => { if (failGetAll) throw new Error('banco fora do ar (simulado)'); return Promise.all(refs.map(r => r.get())); },
};
const admin = { initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }), messaging: () => ({}), storage: () => ({ bucket: () => ({ name: 'b' }) }), auth: () => ({}) };

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const logs = [];
let resendOff = false;
const origLoad = Module._load;
const withOpts = (opts, h) => { h.__opts = opts; return h; };
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: withOpts, onRequest: withOpts, HttpsError };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: withOpts };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
  if (request === 'firebase-functions/params') return { defineSecret: n => ({ name: n, value: () => (n === 'RESEND_API_KEY' && resendOff ? 'PENDENTE_CONFIGURAR' : 'fake-' + n) }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
  if (request === 'mercadopago') return { MercadoPagoConfig: class {}, PreApproval: class {}, Preference: class {}, Payment: class {}, WebhookSignatureValidator: class { static validate() {} } };
  return origLoad.call(this, request, ...rest);
};
const fetchCalls = [];
let fetchOk = true;
global.fetch = async (url, init) => { fetchCalls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null }); return { ok: fetchOk, status: fetchOk ? 200 : 500 }; };
let fns = require(indexPath);

let fails = 0, oks = 0;
const check = (label, cond, extra) => {
  if (cond) oks++; else fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const DAY = 86400000;
const PROD = 'https://peladanamao.com.br';
const WWW = 'https://www.peladanamao.com.br';
const today = () => funnel.dayKeySP(Date.now());
const BASE = { k: 'error', m: "TypeError: Cannot read properties of undefined (reading 'x')", s: "TypeError: Cannot read properties of undefined (reading 'x')\n    at renderChamp (https://peladanamao.com.br/:1234:56)\n    at render (https://peladanamao.com.br/:99:5)", v: '20261006.2150', w: 'ranking', b: 'Chrome 118', o: 'Android 13', a: false, i: false };
let ipN = 0;
const newIp = () => '198.51.100.' + (++ipN);
function mkRes() {
  const r = { statusCode: 200, headers: {}, ended: false };
  r.status = n => { r.statusCode = n; return r; };
  r.set = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.end = () => { r.ended = true; return r; };
  r.send = b => { r.body = b; r.ended = true; return r; };
  return r;
}
const mkReq = ({ method = 'POST', origin = PROD, body, ip, headers = {}, raw } = {}) => ({
  method,
  headers: { ...(origin ? { origin } : {}), 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': ip || newIp(), 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/118', ...headers },
  body: raw !== undefined ? raw : JSON.stringify(body),
});
const post = async (body, o = {}) => { const res = mkRes(); await fns.reportClientError(mkReq({ body, ...o }), res); return res; };
const groupDocs = () => [...store.entries()].filter(([p]) => /^client_errors\/[^/]+$/.test(p));
const metaDoc = () => store.get(`client_errors_meta/${today()}`);
const reset = () => { store.clear(); logs.length = 0; fetchCalls.length = 0; writes.length = 0; queryLog.length = 0; failGetAll = false; failSetPrefix = null; resendOff = false; fetchOk = true; };

(async () => {
  // ═══ a função existe e custa pouco ═══════════════════════════════════════════════════════════════════════════
  check('as 3 funções novas existem (HTTP, painel do dono e resumo diário)', typeof fns.reportClientError === 'function' && typeof fns.getClientErrors === 'function' && typeof fns.notifyClientErrors === 'function');
  const o = fns.reportClientError.__opts;
  check('função HTTP: região certa e teto de custo (poucas instâncias, pouca memória, tempo curto)', o.region === 'us-east1' && o.maxInstances <= 5 && o.memory === '256MiB' && o.timeoutSeconds <= 30, o);
  const so = fns.notifyClientErrors.__opts;
  check('resumo diário: roda às 9h20 de São Paulo, com a chave do e-mail', so.schedule === '20 9 * * *' && so.timeZone === 'America/Sao_Paulo' && so.region === 'us-east1' && so.secrets.length === 1 && so.secrets[0].name === 'RESEND_API_KEY', so);

  // ═══ a função HTTP: quem pode falar com ela ══════════════════════════════════════════════════════════════════
  reset();
  let r = await post(BASE);
  check('relato do próprio site → 204 (vazio), com a permissão CORS só para o endereço de quem mandou', r.statusCode === 204 && r.ended && r.body === undefined && r.headers['access-control-allow-origin'] === PROD && r.headers.vary === 'Origin', r);
  r = await post(BASE, { origin: WWW });
  check('…o endereço com "www" também vale', r.statusCode === 204 && r.headers['access-control-allow-origin'] === WWW);
  reset();
  for (const [rotulo, origin] of [['outro site', 'https://exemplo.com'], ['sem Origin (não é navegador)', null], ['parecido (peladanamao.com.br.exemplo.com)', 'https://peladanamao.com.br.exemplo.com'], ['http em vez de https', 'http://peladanamao.com.br'], ['o site de teste, na produção', 'https://seriebaceoma-staging.web.app'], ['null', 'null']]) {
    const rr = await post(BASE, { origin });
    check(`origem não permitida (${rotulo}) → 403, sem permissão CORS e nada gravado`, rr.statusCode === 403 && !rr.headers['access-control-allow-origin'] && groupDocs().length === 0 && store.size === 0, rr);
  }
  r = mkRes(); await fns.reportClientError(mkReq({ method: 'OPTIONS', origin: PROD }), r);
  check('pré-voo do navegador (OPTIONS) do próprio site → 204 com métodos, cabeçalhos e validade', r.statusCode === 204 && r.headers['access-control-allow-origin'] === PROD && /POST/.test(r.headers['access-control-allow-methods']) && /Content-Type/.test(r.headers['access-control-allow-headers']) && r.headers['access-control-max-age'] === '86400', r);
  r = mkRes(); await fns.reportClientError(mkReq({ method: 'OPTIONS', origin: 'https://exemplo.com' }), r);
  check('…de outro site → 403, sem permissão', r.statusCode === 403 && !r.headers['access-control-allow-origin']);
  for (const m of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    r = mkRes(); await fns.reportClientError(mkReq({ method: m }), r);
    check(`método ${m} → 405 e diz que só aceita POST`, r.statusCode === 405 && /POST/.test(r.headers.allow), r);
  }
  r = await post(BASE, { headers: { 'content-length': '7000' } });
  check('pedido maior que 6 KB (pelo cabeçalho) → 413, sem ler nada', r.statusCode === 413 && store.size === 0, r);
  r = await post(null, { raw: 'isso não é json' });
  check('corpo ilegível → 400', r.statusCode === 400 && store.size === 0, r);
  r = await post(null, { raw: JSON.stringify({ k: 'hack', m: 'x' }) });
  check('tipo de erro desconhecido → 400', r.statusCode === 400 && store.size === 0);
  r = await post(null, { raw: '' });
  check('corpo vazio → 400', r.statusCode === 400);
  r = await post({ k: 'error', m: 'ResizeObserver loop limit exceeded' });
  check('ruído conhecido (ResizeObserver) → 204 (o navegador não precisa saber) e NADA é gravado', r.statusCode === 204 && store.size === 0, store.size);
  r = mkRes(); await fns.reportClientError({ method: 'POST', headers: { origin: PROD, 'x-forwarded-for': newIp() }, body: { ...BASE } }, r);
  check('corpo já lido como objeto (content-type JSON) também funciona', r.statusCode === 204 && groupDocs().length === 1, r);
  reset();
  r = mkRes(); await fns.reportClientError({ method: 'POST', headers: { origin: PROD, 'x-forwarded-for': newIp() }, body: Buffer.from(JSON.stringify(BASE)) }, r);
  check('…e como bytes', r.statusCode === 204 && groupDocs().length === 1, r);

  // ═══ o que fica gravado ══════════════════════════════════════════════════════════════════════════════════════
  reset();
  await post(BASE, { ip: '203.0.113.77' });
  const [[gp, g1]] = groupDocs();
  const fpWanted = ce.parseReport(BASE).report.fp;
  check('primeiro relato cria o grupo, com o código do erro como nome do documento', gp === `client_errors/${fpWanted}` && g1.count === 1 && g1.kind === 'error' && g1.message === BASE.m && g1.fn === 'renderChamp', [gp, g1]);
  check('…com primeira e última vez iguais, versão, contadores de dia, versão, navegador, sistema e tela', g1.firstSeen === g1.lastSeen && g1.firstVersion === '20261006.2150' && g1.lastVersion === '20261006.2150' && g1.days['d' + today().replace(/-/g, '')] === 1 && g1.versions.v20261006_2150 === 1 && g1.browsers['Chrome 118'] === 1 && g1.oses['Android 13'] === 1 && g1.views.ranking === 1, g1);
  check('…e o dia: total 1, grupos novos 1', JSON.stringify(metaDoc()) === '{"total":1,"newGroups":1}', metaDoc());
  check('…avisa no registro (uma vez só) que apareceu um tipo novo de erro, já com o texto limpo', logs.filter(l => l.level === 'warn' && /Novo tipo de erro/.test(l.m)).length === 1 && logs[0].d.fp === fpWanted && logs[0].d.mensagem === BASE.m && logs[0].d.tela === 'ranking', logs);
  await post({ ...BASE, s: BASE.s.replace(':1234:56', ':2000:9'), v: '20261008.1000', b: 'Safari 17', o: 'iOS 17', w: 'home', a: true });
  const g2 = store.get(gp);
  check('mesmo erro de outro navegador/versão/tela/linha: o MESMO grupo soma (contagem 2, navegadores e versões separados, instalado 1)', groupDocs().length === 1 && g2.count === 2 && g2.browsers['Chrome 118'] === 1 && g2.browsers['Safari 17'] === 1 && g2.versions.v20261006_2150 === 1 && g2.versions.v20261008_1000 === 1 && g2.oses['iOS 17'] === 1 && g2.views.home === 1 && g2.views.ranking === 1 && g2.standalone === 1 && g2.lastVersion === '20261008.1000' && g2.days['d' + today().replace(/-/g, '')] === 2, g2);
  check('…a primeira vez NÃO muda; a última sim; o dia: total 2, grupos novos continua 1', g2.firstSeen === g1.firstSeen && g2.firstVersion === '20261006.2150' && JSON.stringify(metaDoc()) === '{"total":2,"newGroups":1}', [g2.firstSeen, g1.firstSeen, metaDoc()]);
  check('…e não avisa de novo "tipo novo" (só na criação)', logs.filter(l => /Novo tipo de erro/.test(l.m)).length === 1);
  await post({ ...BASE, m: 'ReferenceError: foo is not defined', s: 'ReferenceError: foo\nat other (https://peladanamao.com.br/:5:5)' });
  check('erro diferente → outro grupo; grupos novos do dia = 2', groupDocs().length === 2 && metaDoc().newGroups === 2 && metaDoc().total === 3, metaDoc());
  await post({ k: 'listener', m: 'Missing or insufficient permissions.', x: { code: 'unavailable', col: 'championships' }, v: '20261006.2150', b: 'Chrome 118', o: 'Android 13' });
  const gl = groupDocs().map(([, d]) => d).find(d => d.kind === 'listener');
  check('relato de lista de dados que não carregou: grava o código do Firebase e a coleção', gl.codes.unavailable === 1 && gl.extra.col === 'championships' && gl.extra.fn === '' && gl.extra.step === '', gl);
  // privacidade: nada de IP, navegador completo, convite, e-mail, conta ou liga no que foi gravado
  reset();
  await post({ ...BASE, m: 'Falhou para ana.souza@gmail.com em https://peladanamao.com.br/?invite=SEGREDO123&liga=pelada-do-ze', s: 'at a (https://peladanamao.com.br/?invite=SEGREDO123:1:1)\nat leagues/pelada-do-ze/x (https://peladanamao.com.br/:2:2)' }, { ip: '203.0.113.77' });
  const dump = JSON.stringify([...store.entries()]) + JSON.stringify(logs);
  check('privacidade: nada de IP, user-agent, convite, e-mail ou nome da liga no que foi gravado e registrado', !/203\.0\.113|Mozilla|SEGREDO123|ana\.souza|gmail|pelada-do-ze|invite=/.test(dump), dump.slice(0, 500));
  check('privacidade: só existem as duas coleções do monitoramento (client_errors e client_errors_meta) e a de limite de chamadas não é usada pelo relato', [...store.keys()].every(k => /^client_errors(_meta)?\//.test(k)) && !writes.some(w => w.startsWith('rate_limits')), [...store.keys()]);

  // ═══ limites ═════════════════════════════════════════════════════════════════════════════════════════════════
  // o dia dos contadores é o de São Paulo (23h30 de SP já é o dia seguinte no UTC)
  reset();
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 9, 7, 2, 30); // 06/10/2026 23:30 em São Paulo = 07/10 02:30 UTC
  try { await post(BASE); } finally { Date.now = realNow; }
  check('o dia dos contadores é o de São Paulo: 23h30 de SP (já 07/10 no UTC) cai em 06/10, no grupo e no total do dia', store.has('client_errors_meta/2026-10-06') && !store.has('client_errors_meta/2026-10-07') && groupDocs().length === 1 && Object.keys(groupDocs()[0][1].days).join() === 'd20261006', [...store.keys()]);
  reset();
  const ipX = newIp();
  const seq = [];
  for (let i = 0; i < 12; i++) seq.push((await post(BASE, { ip: ipX })).statusCode);
  check('limite por endereço: 10 por minuto, o 11º e o 12º levam 429 e não gravam', seq.slice(0, 10).every(s => s === 204) && seq[10] === 429 && seq[11] === 429 && store.get(`client_errors/${ce.parseReport(BASE).report.fp}`).count === 10, seq);
  check('…outro endereço continua passando', (await post(BASE, { ip: newIp() })).statusCode === 204);
  const cnt = store.get(`client_errors/${ce.parseReport(BASE).report.fp}`).count;
  const viaXff = (await post(BASE, { ip: ipX + ' , 10.0.0.1' })).statusCode;
  check('…e o endereço contado é o primeiro do x-forwarded-for', viaXff === 429 && store.get(`client_errors/${ce.parseReport(BASE).report.fp}`).count === cnt, viaXff);
  // teto do dia
  reset();
  const fpA = ce.parseReport(BASE).report.fp;
  store.set(`client_errors/${fpA}`, { kind: 'error', message: BASE.m, count: 5, days: {}, firstSeen: '2026-01-01T00:00:00.000Z', lastSeen: '2026-01-01T00:00:00.000Z' });
  store.set(`client_errors_meta/${today()}`, { total: 3000, newGroups: 10 });
  r = await post(BASE);
  check('teto de 3000 relatos no dia: relato de grupo que JÁ existe é descartado (grupo igual, "descartados" +1, total igual)', r.statusCode === 204 && store.get(`client_errors/${fpA}`).count === 5 && metaDoc().dropped === 1 && metaDoc().total === 3000, [store.get(`client_errors/${fpA}`).count, metaDoc()]);
  r = await post({ ...BASE, m: 'Erro totalmente novo hoje', s: '' });
  check('…mas um grupo NOVO ainda entra (um defeito que se repete não esconde outro)', groupDocs().length === 2 && metaDoc().newGroups === 11 && metaDoc().total === 3001, metaDoc());
  store.set(`client_errors_meta/${today()}`, { total: 2999, newGroups: 10 });
  await post(BASE);
  check('…2999 ainda passa (o teto é "3000 ou mais")', store.get(`client_errors/${fpA}`).count === 6 && metaDoc().total === 3000, metaDoc());
  store.set(`client_errors_meta/${today()}`, { total: 100, newGroups: 150 });
  await post({ ...BASE, m: 'Outro erro novo, mas o limite de grupos novos acabou', s: '' });
  check('teto de 150 grupos novos no dia: grupo NOVO é descartado (nada criado, "descartados" +1)', groupDocs().length === 2 && metaDoc().dropped === 1 && metaDoc().newGroups === 150, [groupDocs().length, metaDoc()]);
  await post(BASE);
  check('…e relato de grupo que já existe continua entrando', store.get(`client_errors/${fpA}`).count === 7 && metaDoc().total === 101, metaDoc());
  store.set(`client_errors_meta/${today()}`, { total: 100, newGroups: 149 });
  await post({ ...BASE, m: 'O grupo de número 150 ainda entra', s: '' });
  check('…149 grupos novos ainda deixa criar o 150º', groupDocs().length === 3 && metaDoc().newGroups === 150, metaDoc());

  // ═══ falha do banco nunca vira erro para o navegador ═════════════════════════════════════════════════════════
  reset();
  failGetAll = true;
  r = await post(BASE);
  check('banco fora do ar na leitura: responde 204 do mesmo jeito e registra o aviso', r.statusCode === 204 && logs.some(l => l.level === 'warn' && /Não foi possível registrar um relato/.test(l.m) && /fora do ar/.test(l.d.erro)), logs);
  failGetAll = false; failSetPrefix = 'client_errors';
  r = await post(BASE);
  check('banco fora do ar na gravação: 204 também, e sem relato "criado" falso no registro', r.statusCode === 204 && !logs.some(l => /Novo tipo de erro/.test(l.m)) && groupDocs().length === 0, logs);

  // ═══ painel do dono ══════════════════════════════════════════════════════════════════════════════════════════
  reset();
  const owner = { uid: 'dono', token: { email: 'castanho.caiop@gmail.com', email_verified: true } };
  const call = (fn, data, auth) => fn({ data, auth });
  const tryCall = async (fn, data, auth) => { try { return { res: await call(fn, data, auth) }; } catch (e) { return { err: e }; } };
  let t = await tryCall(fns.getClientErrors, {}, null);
  check('painel: sem login → unauthenticated', t.err?.code === 'unauthenticated', t.err?.code);
  t = await tryCall(fns.getClientErrors, {}, { uid: 'u1', token: { email: 'u1@x.com', email_verified: true } });
  check('painel: pessoa comum → permission-denied', t.err?.code === 'permission-denied', t.err?.code);
  t = await tryCall(fns.getClientErrors, {}, { uid: 'f', token: { email: 'castanho.caiop@gmail.com', email_verified: false } });
  check('painel: o e-mail do dono SEM verificação não vale', t.err?.code === 'permission-denied', t.err?.code);
  const now = Date.now();
  const dayF = i => ce.dayField(funnel.dayKeySP(now - i * DAY));
  store.set('client_errors/aaa', { kind: 'error', message: 'TypeError: x', stack: 'at f ((página):1:1)', fn: 'f', loc: '(página):1', count: 5, firstSeen: new Date(now - 5 * DAY).toISOString(), lastSeen: new Date(now - 3600000).toISOString(), days: { [dayF(0)]: 3, [dayF(5)]: 2 }, versions: { v20261006_2150: 5 }, browsers: { 'Chrome 118': 5 }, oses: { 'Android 13': 5 }, views: { ranking: 5 } });
  store.set('client_errors/bbb', { kind: 'boot', message: 'Carregamento não terminou', count: 2, firstSeen: new Date(now - 7200000).toISOString(), lastSeen: new Date(now - 7200000).toISOString(), days: { [dayF(0)]: 2 }, extra: { fn: '', col: '', step: 'auth' } });
  store.set('client_errors/velho', { kind: 'error', message: 'velho', count: 9, firstSeen: new Date(now - 40 * DAY).toISOString(), lastSeen: new Date(now - 20 * DAY).toISOString(), days: { [dayF(20)]: 9 } });
  store.set(`client_errors_meta/${today()}`, { total: 5, newGroups: 1, dropped: 1 });
  t = await tryCall(fns.getClientErrors, {}, owner);
  const R = t.res;
  check('painel: dono recebe os grupos dos últimos 14 dias (o de 20 dias atrás fica de fora), do que mais apareceu para o que menos', R?.ok === true && R.groups.map(g => g.fp).join() === 'aaa,bbb', R);
  check('…com totais, 14 dias de contagem diária (o de hoje com o que foi descartado) e a hora do cálculo', R.totals.reports7d === 5 + 2 && R.totals.crashes7d === 7 && R.totals.newGroups48h === 1 && R.days.length === 14 && R.days[13].total === 5 && R.days[13].dropped === 1 && Math.abs(Date.parse(R.generatedAt) - now) < 60000, R.totals);
  check('…lendo só o que precisa: grupos com relato nos últimos 14 dias, do mais recente, no máximo 300', queryLog.some(q => q.name === 'client_errors' && q.filters.some(([f, op]) => f === 'lastSeen' && op === '>=') && q.order?.[0] === 'lastSeen' && q.order?.[1] === 'desc' && q.lim === 300), queryLog);
  check('…e não devolve campos internos nem nada além do resumo (sem ids de documento do Firestore além do código do grupo)', R.groups.every(g => !('days' in g) && typeof g.spark === 'object' && !/ref|path/.test(JSON.stringify(Object.keys(g)))), Object.keys(R.groups[0]));
  const lots = [];
  for (let i = 0; i < 22; i++) lots.push(await tryCall(fns.getClientErrors, {}, owner));
  check('painel: no máximo 20 consultas por minuto (a 21ª é cortada)', lots.slice(0, 19).every(x => x.res) && lots.slice(19).every(x => x.err?.code === 'resource-exhausted'), lots.map(x => x.err?.code || 'ok'));

  // ═══ resumo diário por e-mail ════════════════════════════════════════════════════════════════════════════════
  reset();
  await fns.notifyClientErrors();
  check('resumo diário sem nenhum relato: não manda e-mail e registra que concluiu', fetchCalls.length === 0 && logs.some(l => l.level === 'info' && /notifyClientErrors concluída/.test(l.m) && l.d.avisados === 0 && l.d.emailEnviado === false), logs);
  const nowD = Date.now();
  const df = i => ce.dayField(funnel.dayKeySP(nowD - i * DAY));
  store.set('client_errors/novo', { kind: 'callable', message: 'internal <b>falha</b>', fn: '', loc: '', count: 3, firstSeen: new Date(nowD - 3600000).toISOString(), lastSeen: new Date(nowD - 600000).toISOString(), days: { [df(0)]: 3 }, views: { ranking: 3 }, browsers: { 'Chrome 118': 3 }, versions: { v20261006_2150: 3 }, codes: { internal: 3 }, extra: { fn: 'trackEvent', col: '', step: '' } });
  store.set('client_errors/cronico', { kind: 'error', message: 'erro de sempre', count: 400, firstSeen: new Date(nowD - 30 * DAY).toISOString(), lastSeen: new Date(nowD - 60000).toISOString(), days: { [df(0)]: 8, [df(1)]: 8, [df(2)]: 8, [df(3)]: 8, [df(4)]: 8, [df(5)]: 8, [df(6)]: 8, [df(7)]: 8 } });
  store.set('client_errors/rede', { kind: 'network', message: 'Failed to fetch', count: 99, firstSeen: new Date(nowD - 3600000).toISOString(), lastSeen: new Date(nowD - 60000).toISOString(), days: { [df(0)]: 99 } });
  store.set('client_errors/parado', { kind: 'error', message: 'sem relato recente', count: 2, firstSeen: new Date(nowD - 4 * DAY).toISOString(), lastSeen: new Date(nowD - 4 * DAY).toISOString(), days: { [df(4)]: 2 } });
  await fns.notifyClientErrors();
  check('resumo diário: manda UM e-mail, só para o dono, só com o erro novo (crônico, rede e parado ficam de fora)', fetchCalls.length === 1 && JSON.stringify(fetchCalls[0].body.to) === '["castanho.caiop@gmail.com"]' && /1 erro\(s\) novo\(s\) no app/.test(fetchCalls[0].body.subject) && /internal/.test(fetchCalls[0].body.text) && !/erro de sempre|Failed to fetch|sem relato recente/.test(fetchCalls[0].body.text), fetchCalls[0]?.body);
  check('…o e-mail sai pela API do Resend, com a chave, remetente do app e HTML escapado', /api\.resend\.com\/emails/.test(fetchCalls[0].url) && /Bearer fake-RESEND_API_KEY/.test(fetchCalls[0].init.headers.Authorization) && /avisos@notificacoes\.peladanamao\.com\.br/.test(fetchCalls[0].body.from) && /&lt;b&gt;falha&lt;\/b&gt;/.test(fetchCalls[0].body.html) && !/<b>falha/.test(fetchCalls[0].body.html), fetchCalls[0].body.html.slice(0, 300));
  check('…e registra quantos grupos olhou, quantos avisou e que o e-mail saiu', logs.some(l => /notifyClientErrors concluída/.test(l.m) && l.d.grupos === 3 && l.d.avisados === 1 && l.d.emailEnviado === true), logs);
  fetchCalls.length = 0; resendOff = true;
  await fns.notifyClientErrors();
  check('e-mail desligado neste ambiente (chave PENDENTE_CONFIGURAR): não envia, não estoura, e diz que não enviou', fetchCalls.length === 0 && logs.some(l => /notifyClientErrors concluída/.test(l.m) && l.d.avisados === 1 && l.d.emailEnviado === false), logs.slice(-3));
  resendOff = false; fetchOk = false; fetchCalls.length = 0;
  let threw = false; try { await fns.notifyClientErrors(); } catch (_) { threw = true; }
  check('o Resend recusando o envio (500) também não estoura a função', !threw && fetchCalls.length === 1);

  // ═══ faxina ═════════════════════════════════════════════════════════════════════════════════════════════════
  reset();
  const k = (n) => funnel.dayKeySP(Date.now() - n * DAY);
  store.set('client_errors/velho1', { kind: 'error', message: 'a', count: 1, lastSeen: new Date(Date.now() - 46 * DAY).toISOString(), days: {} });
  store.set('client_errors/velho2', { kind: 'error', message: 'b', count: 1, lastSeen: new Date(Date.now() - 400 * DAY).toISOString(), days: {} });
  store.set('client_errors/limite', { kind: 'error', message: 'c', count: 1, lastSeen: new Date(Date.now() - 44 * DAY).toISOString(), days: {} });
  store.set('client_errors/recente', { kind: 'error', message: 'd', count: 1, lastSeen: new Date().toISOString(), days: {} });
  for (const n of [0, 30, 59, 61, 90, 200]) store.set(`client_errors_meta/${k(n)}`, { total: n });
  await fns.notifyClientErrors();
  check('faxina: apaga grupos sem relato novo há mais de 45 dias (e só esses)', !store.has('client_errors/velho1') && !store.has('client_errors/velho2') && store.has('client_errors/limite') && store.has('client_errors/recente'), [...store.keys()]);
  check('…e os contadores diários de mais de 60 dias (e só esses)', !store.has(`client_errors_meta/${k(61)}`) && !store.has(`client_errors_meta/${k(90)}`) && !store.has(`client_errors_meta/${k(200)}`) && store.has(`client_errors_meta/${k(0)}`) && store.has(`client_errors_meta/${k(30)}`) && store.has(`client_errors_meta/${k(59)}`), [...store.keys()]);
  check('…e conta o que apagou no registro', logs.some(l => /notifyClientErrors concluída/.test(l.m) && l.d.gruposApagados === 2 && l.d.diasApagados === 3), logs.slice(-2));

  // ═══ ambiente de teste ═══════════════════════════════════════════════════════════════════════════════════════
  const prevProject = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = 'seriebaceoma-staging';
  delete require.cache[indexPath];
  fns = require(indexPath);
  reset();
  r = await post(BASE, { origin: 'https://seriebaceoma-staging.web.app' });
  const r2 = await post(BASE, { origin: PROD });
  const r3 = await post(BASE, { origin: 'https://seriebaceoma-staging.firebaseapp.com' });
  check('no ambiente de TESTE só vale o endereço do site de teste (o da produção leva 403), e vice-versa na produção', r.statusCode === 204 && r.headers['access-control-allow-origin'] === 'https://seriebaceoma-staging.web.app' && r2.statusCode === 403 && r3.statusCode === 204, [r.statusCode, r2.statusCode, r3.statusCode]);
  if (prevProject === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = prevProject;
  Module._load = origLoad;

  console.log(`\n${fails === 0 ? `Todos os testes passaram (${oks})` : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
