// Ambientes (produção x teste/staging): cada um aponta só para si mesmo. Confere que as Cloud
// Functions escolhem os endereços certos pelo projeto em que rodam, que a produção continua sendo
// o padrão (emuladores e testes incluídos), que o ambiente de teste não faz backup nem manda
// e-mail de verdade, e que as três tabelas de ambientes (servidor, app e service worker) batem.
const Module = require('module');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const indexPath = path.join(root, 'functions', 'index.js');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// ── ambiente falso: Firestore em memória, Mercado Pago, Resend e backup simulados ───────────────
const store = new Map();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const FieldValue = { delete: () => ({ __delete: true }), increment: n => ({ __inc: n }), arrayRemove: t => ({ __arrayRemove: t }) };
const valueAt = (obj, field) => (field instanceof FieldPath ? field.segments : String(field).split('.')).reduce((o, s) => (o == null ? undefined : o[s]), obj);
const snapOf = p => ({ id: p.split('/').pop(), exists: store.has(p), data: () => clone(store.get(p)), ref: refOf(p) });
function refOf(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async d => { store.set(p, clone(d)); },
    update: async (...args) => {
      const patch = args.length === 1 ? args[0] : Object.fromEntries(args.reduce((a, v, i) => (i % 2 ? (a[a.length - 1].push(v), a) : (a.push([v]), a)), []));
      const cur = clone(store.get(p)) || {};
      for (const [k, v] of Object.entries(patch)) { if (v && v.__delete) delete cur[k]; else if (v && v.__inc !== undefined) cur[k] = (cur[k] || 0) + v.__inc; else cur[k] = clone(v); }
      store.set(p, cur);
    },
  };
}
const fakeDb = {
  doc: p => refOf(p),
  collection: name => {
    const inCol = p => new RegExp('^' + name + '/[^/]+$').test(p);
    const build = filters => ({
      where: (f, op, v) => build([...filters, [f, op, v]]),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([p, d]) => inCol(p) && filters.every(([f, op, v]) => (op === '==' ? valueAt(d, f) === v : op === 'in' ? Array.isArray(v) && v.includes(valueAt(d, f)) : false)))
          .map(([p]) => snapOf(p));
        return { size: docs.length, docs, forEach: fn => docs.forEach(fn) };
      },
    });
    return build([]);
  },
};

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const calls = { preApprovalCreate: [], preferenceCreate: [], exportDocuments: [] };
const emails = [];
let fetchCalls = 0;
let resendKey = 'fake-resend-key';
const logs = [];
let mpCreateError = null; // texto com que o Mercado Pago falso recusa a criação (null = aceita)

global.fetch = async (url, opts) => {
  fetchCalls++;
  emails.push(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => ({ id: 'email-fake' }) };
};

// Carrega uma cópia nova do servidor como se rodasse no projeto `projectId` (undefined = sem projeto).
function loadServer(projectId) {
  const prevEnv = process.env.GCLOUD_PROJECT;
  if (projectId === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = projectId;
  delete process.env.GCP_PROJECT; delete process.env.PROJECT_ID;
  delete require.cache[require.resolve(indexPath)];
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
    if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, onRequest: (opts, h) => h, HttpsError };
    if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (opts, h) => h };
    if (request === 'firebase-admin') return { initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }), messaging: () => ({}), storage: () => ({ bucket: () => ({ name: 'bucket-padrao' }) }) };
    if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
    if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
    if (request === 'firebase-functions/params') return { defineSecret: name => ({ value: () => (name === 'RESEND_API_KEY' ? resendKey : 'fake-' + name) }) };
    if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class { databasePath(p, d) { return `projects/${p}/databases/${d}`; } async exportDocuments(args) { calls.exportDocuments.push(args); return [{ name: 'op-1' }]; } } } };
    if (request === 'mercadopago') return {
      MercadoPagoConfig: class { constructor(o) { this.opts = o; } },
      PreApproval: class { async create({ body }) { if (mpCreateError) { const e = new Error(mpCreateError); e.status = 400; throw e; } calls.preApprovalCreate.push(body); return { init_point: 'https://mp.test/pre' }; } async get() { return {}; } async search() { return { results: [] }; } },
      Preference: class { async create({ body }) { calls.preferenceCreate.push(body); return { init_point: 'https://mp.test/pref' }; } },
      Payment: class { async get() { return {}; } async search() { return { results: [] }; } },
      WebhookSignatureValidator: class { static validate() {} },
    };
    return origLoad.call(this, request, ...rest);
  };
  let fns;
  try { fns = require(indexPath); } finally {
    Module._load = origLoad;
    if (prevEnv === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = prevEnv;
  }
  return fns;
}

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const reset = () => {
  store.clear(); emails.length = 0; logs.length = 0; fetchCalls = 0; resendKey = 'fake-resend-key';
  calls.preApprovalCreate.length = 0; calls.preferenceCreate.length = 0; calls.exportDocuments.length = 0;
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' }, M: { role: 'admin' } } });
  store.set('leagues/M', { name: 'Liga M' }); // sem plano: pode assinar
  // liga com plano anual faltando 20 dias: recebe o lembrete de 30 dias
  store.set('leagues/L', { name: 'Liga L', trialEndsAt: iso(Date.now() - 90 * DAY), subscriptionPlan: 'annual', subscriptionRenewsAt: iso(Date.now() + 20 * DAY), subscriptionActiveUntil: iso(Date.now() + 21 * DAY) });
};

const PRODUCTION = { appUrl: 'https://peladanamao.com.br/', webhook: 'https://us-east1-seriebaceoma.cloudfunctions.net/mercadoPagoWebhook', prefix: '', backups: true, hint: false };
const STAGING = { appUrl: 'https://seriebaceoma-staging.web.app/', webhook: 'https://us-east1-seriebaceoma-staging.cloudfunctions.net/mercadoPagoWebhook', prefix: '[TESTE] ', backups: false, hint: true };

(async () => {
  const projects = [
    ['seriebaceoma-staging', STAGING],
    ['seriebaceoma', PRODUCTION],
    ['demo-aceoma', PRODUCTION],   // emuladores
    [undefined, PRODUCTION],       // sem projeto (testes, scripts)
    ['projeto-desconhecido', PRODUCTION],
  ];

  for (const [projectId, want] of projects) {
    const label = projectId === undefined ? '(sem projeto)' : projectId;
    const fns = loadServer(projectId);
    const auth = { uid: 'adm' };

    // Mercado Pago: a notificação volta para a função do próprio ambiente e o cliente volta para o próprio site.
    reset();
    await fns.createMonthlySubscription({ data: { liga: 'M' }, auth });
    const pre = calls.preApprovalCreate[0];
    check(`${label}: assinatura mensal avisa o webhook do próprio ambiente`, pre?.notification_url === want.webhook, pre?.notification_url);
    check(`${label}: …e volta para o próprio site depois do checkout`, pre?.back_url === `${want.appUrl}?mpReturn=M`, pre?.back_url);
    reset();
    await fns.createAnnualPayment({ data: { liga: 'M' }, auth });
    const pref = calls.preferenceCreate[0];
    check(`${label}: cobrança anual avisa o webhook do próprio ambiente`, pref?.notification_url === want.webhook, pref?.notification_url);
    check(`${label}: …e as três voltas do checkout (ok, pendente, falha) vão para o próprio site`, ['success', 'pending', 'failure'].every(k => pref?.back_urls?.[k] === `${want.appUrl}?mpReturn=M`), pref?.back_urls);

    // Recusa do Mercado Pago: a mensagem chega em português; só o ambiente de teste acrescenta a dica do comprador de teste.
    reset();
    mpCreateError = 'Payer is associated with a different site';
    let refusal; try { await fns.createMonthlySubscription({ data: { liga: 'M' }, auth }); } catch (e) { refusal = e; }
    mpCreateError = null;
    check(`${label}: recusa do Mercado Pago chega em português (e não em inglês)`, refusal?.code === 'failed-precondition' && /outro país/.test(refusal.message) && !/different site/i.test(refusal.message), refusal?.message);
    check(`${label}: …${want.hint ? 'com' : 'sem'} a dica do comprador de teste`, /test_user_NÚMEROS@testuser\.com/.test(refusal?.message || '') === want.hint, refusal?.message);
    check(`${label}: …e o texto original do Mercado Pago fica no log, no campo "erro"`, logs.some(l => l.level === 'warn' && l.d?.erro === 'Payer is associated with a different site' && l.d?.status === 400), logs);
    // E-mails: assunto marcado no teste, link do próprio site; sem chave do Resend nada é enviado nem anotado.
    reset();
    await fns.notifyBillingEmails();
    const mail = emails[0];
    check(`${label}: e-mail de cobrança sai com o assunto ${want.prefix ? 'marcado com "[TESTE]"' : 'sem marca'}`, !!mail && (want.prefix ? mail.subject.startsWith(want.prefix) : /^A assinatura anual/.test(mail.subject)), mail?.subject);
    check(`${label}: …com o botão apontando para o próprio site`, !!mail && mail.html.includes(`href="${want.appUrl}"`) && mail.text.includes(want.appUrl), mail?.html?.slice(-300));
    reset();
    resendKey = 'PENDENTE_CONFIGURAR';
    await fns.notifyBillingEmails();
    check(`${label}: chave do Resend ainda não configurada — nenhum e-mail sai e nada é anotado como avisado`, fetchCalls === 0 && !store.get('leagues/L').billingNotices, { fetchCalls, notices: store.get('leagues/L').billingNotices });

    // Aviso de liga abandonada: mesma marca no assunto e mesma regra de chave não configurada.
    const abandoned = () => {
      store.set('leagues/A', { name: 'Liga A', lastActivityAt: iso(Date.now() - 400 * DAY) });
      store.set('users/admA', { email: 'adma@x.com', leagues: { A: { role: 'admin' } } });
    };
    reset(); abandoned();
    await fns.checkAbandonedLeagues();
    const ab = emails.find(e => /inativa/.test(e.subject));
    check(`${label}: aviso de liga abandonada sai ${want.prefix ? 'marcado com "[TESTE]"' : 'sem marca'}`, !!ab && (want.prefix ? ab.subject.startsWith(want.prefix) : ab.subject.startsWith('Sua liga')), ab?.subject);
    reset(); abandoned(); resendKey = 'PENDENTE_CONFIGURAR';
    await fns.checkAbandonedLeagues();
    check(`${label}: aviso de liga abandonada sem chave do Resend — nenhum e-mail sai`, fetchCalls === 0, fetchCalls);

    // Backup agendado: só na produção.
    reset();
    await fns.scheduledFirestoreBackup();
    if (want.backups) {
      check(`${label}: faz o backup do banco do próprio projeto`, calls.exportDocuments.length === 1 && calls.exportDocuments[0].outputUriPrefix.startsWith('gs://bucket-padrao/firestore-backups/') && (projectId === undefined || calls.exportDocuments[0].name === `projects/${projectId}/databases/(default)`), calls.exportDocuments);
    } else {
      check(`${label}: NÃO faz backup (só tem dados fictícios) e registra que está desligado`, calls.exportDocuments.length === 0 && logs.some(l => /Backup agendado desligado/.test(l.m)), { exports: calls.exportDocuments, logs });
    }
  }

  // ── nenhum endereço de ambiente fixo fora das tabelas ───────────────────────────────────────
  const src = fs.readFileSync(indexPath, 'utf8');
  const tablesStart = src.indexOf('const PRODUCTION_ENV = {');
  const tablesEnd = src.indexOf('const ENV = ENVIRONMENTS[PROJECT_ID]');
  check('servidor: a tabela de ambientes foi encontrada', tablesStart > 0 && tablesEnd > tablesStart);
  const outside = src.slice(0, tablesStart) + src.slice(tablesEnd);
  for (const literal of ['https://peladanamao.com.br/', 'cloudfunctions.net/mercadoPagoWebhook', 'seriebaceoma-staging']) {
    check(`servidor: "${literal}" só aparece dentro da tabela de ambientes (nenhum endereço fixo espalhado)`, !outside.includes(literal), literal);
  }

  // ── um endereço só: o antigo (aceoma.vercel.app) não aparece mais; as notificações abrem o site onde a pessoa está logada ──
  const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const swSrc = fs.readFileSync(path.join(root, 'firebase-messaging-sw.js'), 'utf8');
  for (const [nome, texto] of [['servidor (functions/index.js)', src], ['app (index.html)', htmlSrc], ['service worker (firebase-messaging-sw.js)', swSrc]]) {
    check(`${nome}: o endereço antigo aceoma.vercel.app não aparece mais (só o vercel.json o cita, para redirecionar)`, !/aceoma\.vercel\.app/i.test(texto));
  }
  const prodPush = new Function(htmlSrc.slice(htmlSrc.indexOf('const APP_ENVS = {'), htmlSrc.indexOf('const STAGING_HOSTS')) + '\nreturn APP_ENVS;')().production.pushUrl;
  check('notificações da produção abrem o mesmo endereço do site (peladanamao.com.br), onde o login e a permissão de notificação estão', prodPush === 'https://peladanamao.com.br/' && PRODUCTION.appUrl === 'https://peladanamao.com.br/', { prodPush });
  // ── as três tabelas (servidor, app e service worker) batem ──────────────────────────────────
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'firebase-messaging-sw.js'), 'utf8');
  const a = html.indexOf('const APP_ENVS = {'), b = html.indexOf('const STAGING_HOSTS');
  const APP_ENVS = new Function(html.slice(a, b) + '\nreturn APP_ENVS;')();
  const hostsOf = text => new Function('return ' + text.match(/const STAGING_HOSTS = (\[[^\]]*\]);/)[1])();
  const htmlHosts = hostsOf(html), swHosts = hostsOf(sw);
  check('app e service worker reconhecem o mesmo conjunto de endereços do site de teste', JSON.stringify(htmlHosts) === JSON.stringify(swHosts) && htmlHosts.length >= 1, { htmlHosts, swHosts });

  const swCall = sw.slice(sw.indexOf('firebase.initializeApp('));
  const swConfigs = [...swCall.matchAll(/\{([^{}]*apiKey[^{}]*)\}/g)].map(m => Object.fromEntries([...m[1].matchAll(/(\w+):\s*"([^"]*)"/g)].map(x => [x[1], x[2]])));
  check('service worker tem as duas configurações (teste primeiro, produção depois)', swConfigs.length === 2 && swConfigs[0].projectId === 'seriebaceoma-staging' && swConfigs[1].projectId === 'seriebaceoma', swConfigs.map(c => c.projectId));
  check('config do Firebase de TESTE igual no app e no service worker', JSON.stringify(swConfigs[0]) === JSON.stringify(APP_ENVS.staging.firebaseConfig), { sw: swConfigs[0], app: APP_ENVS.staging.firebaseConfig });
  check('config do Firebase de PRODUÇÃO igual no app e no service worker', JSON.stringify(swConfigs[1]) === JSON.stringify(APP_ENVS.production.firebaseConfig), { sw: swConfigs[1], app: APP_ENVS.production.firebaseConfig });
  check('o endereço do site de teste está nas listas de endereços (projeto + .web.app)', htmlHosts.includes(`${APP_ENVS.staging.firebaseConfig.projectId}.web.app`), htmlHosts);
  check('o teste não herda o App Check, as notificações push nem a chave da produção', APP_ENVS.staging.appCheckKey === null && APP_ENVS.staging.vapidKey === null && APP_ENVS.staging.firebaseConfig.apiKey !== APP_ENVS.production.firebaseConfig.apiKey);

  const swPush = { staging: sw.match(/IS_STAGING \? '([^']+)'/)?.[1], production: sw.match(/IS_STAGING \? '[^']+' : '([^']+)'/)?.[1] };
  check('endereço das notificações igual no app e no service worker', swPush.staging === APP_ENVS.staging.pushUrl && swPush.production === APP_ENVS.production.pushUrl, { swPush, app: [APP_ENVS.staging.pushUrl, APP_ENVS.production.pushUrl] });

  const tables = src.slice(tablesStart, tablesEnd);
  const serverStaging = tables.match(/"seriebaceoma-staging": \{[\s\S]*?\n  \},/)[0];
  check('servidor: o projeto de TESTE é o mesmo do app', serverStaging.includes(`"${APP_ENVS.staging.firebaseConfig.projectId}"`) && serverStaging.includes(`pushUrl: "${APP_ENVS.staging.pushUrl}"`) && serverStaging.includes(`appUrl: "${APP_ENVS.staging.pushUrl}"`), serverStaging);
  check('servidor: o endereço das notificações da PRODUÇÃO é o mesmo do app', tables.includes(`pushUrl: "${APP_ENVS.production.pushUrl}"`), APP_ENVS.production.pushUrl);
  check('servidor: o webhook de cada ambiente fica no projeto certo', tables.includes(`us-east1-${APP_ENVS.production.firebaseConfig.projectId}.cloudfunctions.net/mercadoPagoWebhook`) && tables.includes(`us-east1-${APP_ENVS.staging.firebaseConfig.projectId}.cloudfunctions.net/mercadoPagoWebhook`));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(e => { console.error('ERRO NO TESTE', e); process.exitCode = 1; });
