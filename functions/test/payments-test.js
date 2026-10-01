const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória (mesma base dos outros harnesses) ────────────
const store = new Map();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const FieldValue = { delete: () => ({ __delete: true }) };

function applyUpdate(data, patch) {
  const out = clone(data) || {};
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.__delete) delete out[k];
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
    set: async d => { store.set(p, clone(d)); },
    update: async patch => {
      if (!store.has(p)) throw new Error('NOT_FOUND ' + p);
      store.set(p, applyUpdate(store.get(p), patch));
    },
  };
}
const fakeDb = { doc: p => refOf(p) };

// ── mock do SDK mercadopago: captura os parâmetros enviados e deixa o teste
// controlar o que cada chamada devolve ──────────────────────────────────────
const calls = { preApprovalCreate: [], preferenceCreate: [] };
let preApprovalGetResult = null;
let paymentGetResult = null;
let getShouldThrow = false;
let createShouldThrowMessage = null; // simula o SDK do Mercado Pago recusando a criação

class MercadoPagoConfig { constructor(opts) { this.opts = opts; } }
class PreApproval {
  async create({ body }) {
    if (createShouldThrowMessage) { const e = new Error(createShouldThrowMessage); e.status = 400; throw e; }
    calls.preApprovalCreate.push(body); return { init_point: 'https://mp.test/preapproval/xyz' };
  }
  async get({ id }) { if (getShouldThrow) throw new Error('falha de rede simulada'); return { id, ...preApprovalGetResult }; }
}
class Preference {
  async create({ body }) {
    if (createShouldThrowMessage) { const e = new Error(createShouldThrowMessage); e.status = 400; throw e; }
    calls.preferenceCreate.push(body); return { init_point: 'https://mp.test/preference/xyz' };
  }
}
class Payment {
  async get({ id }) { if (getShouldThrow) throw new Error('falha de rede simulada'); return { id, ...paymentGetResult }; }
}
let signatureShouldFail = false;
let webhookSecretValue = 'a-real-webhook-secret';
class WebhookSignatureValidator {
  static validate() { if (signatureShouldFail) throw new Error('assinatura inválida simulada'); }
}

const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({}),
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, onRequest: (opts, h) => h, HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (opts, h) => h };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info() {}, warn() {}, error() {} } };
  if (request === 'firebase-functions/params') return { defineSecret: name => ({ value: () => (name === 'MERCADOPAGO_WEBHOOK_SECRET' ? webhookSecretValue : 'fake-' + name) }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
  if (request === 'mercadopago') return { MercadoPagoConfig, PreApproval, Preference, Payment, WebhookSignatureValidator };
  return origLoad.call(this, request, ...rest);
};
const fns = require(path);
Module._load = origLoad;

// ── utilidades ────────────────────────────────────────────────────────────
let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const call = (fn, data, auth) => fn({ data, auth });
const authOf = uid => ({ uid });
const codeOf = async p => { try { await p; return 'ok'; } catch (e) { return e.code || ('ERRO:' + e.message); } };
const fakeRes = () => {
  const r = { statusCode: null, body: null };
  r.status = code => { r.statusCode = code; return { send: msg => { r.body = msg; } }; };
  return r;
};
const reset = () => {
  store.clear();
  calls.preApprovalCreate.length = 0;
  calls.preferenceCreate.length = 0;
  preApprovalGetResult = null;
  paymentGetResult = null;
  getShouldThrow = false;
  createShouldThrowMessage = null;
  signatureShouldFail = false;
  webhookSecretValue = 'a-real-webhook-secret';
};

(async () => {
  // ───────── createMonthlySubscription ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  store.set('users/jog', { email: 'jog@x.com', leagues: { L: { role: 'player' } } });
  store.set('users/semEmail', { leagues: { L: { role: 'admin' } } });

  check('mensal: sem login', await codeOf(call(fns.createMonthlySubscription, { liga: 'L' })) === 'unauthenticated');
  check('mensal: jogador comum não pode', await codeOf(call(fns.createMonthlySubscription, { liga: 'L' }, authOf('jog'))) === 'permission-denied');
  check('mensal: admin sem e-mail não pode', await codeOf(call(fns.createMonthlySubscription, { liga: 'L' }, authOf('semEmail'))) === 'failed-precondition');
  check('mensal: nada foi criado nas negativas', calls.preApprovalCreate.length === 0);

  const resMonthly = await call(fns.createMonthlySubscription, { liga: 'L' }, authOf('adm'));
  check('mensal: devolve o link de pagamento', resMonthly.initPoint === 'https://mp.test/preapproval/xyz');
  // Regressão: payer_email é obrigatório (a API recusa sem ele, mesmo o SDK marcando como
  // opcional — confirmado em teste real: MPBadRequestError "payer_email is required").
  check('mensal: manda o e-mail do admin', calls.preApprovalCreate[0].payer_email === 'adm@x.com');
  check('mensal: external_reference é a liga', calls.preApprovalCreate[0].external_reference === 'L');
  check('mensal: valor e frequência corretos', calls.preApprovalCreate[0].auto_recurring.transaction_amount === 29.9 && calls.preApprovalCreate[0].auto_recurring.frequency_type === 'months');
  // Regressão: a URL configurada no painel do Mercado Pago não cobre pagamentos via
  // Preference (confirmado em teste real — a notificação nunca chega sem isto).
  check('mensal: informa a URL do webhook explicitamente', calls.preApprovalCreate[0].notification_url === 'https://us-east1-seriebaceoma.cloudfunctions.net/mercadoPagoWebhook');

  // ───────── createAnnualPayment ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  store.set('users/jog', { email: 'jog@x.com', leagues: { L: { role: 'player' } } });

  check('anual: sem login', await codeOf(call(fns.createAnnualPayment, { liga: 'L' })) === 'unauthenticated');
  check('anual: jogador comum não pode', await codeOf(call(fns.createAnnualPayment, { liga: 'L' }, authOf('jog'))) === 'permission-denied');

  const resAnnual = await call(fns.createAnnualPayment, { liga: 'L' }, authOf('adm'));
  check('anual: devolve o link de pagamento', resAnnual.initPoint === 'https://mp.test/preference/xyz');
  check('anual: valor correto no item', calls.preferenceCreate[0].items[0].unit_price === 238.8);
  check('anual: external_reference é a liga', calls.preferenceCreate[0].external_reference === 'L');
  check('anual: informa a URL do webhook explicitamente', calls.preferenceCreate[0].notification_url === 'https://us-east1-seriebaceoma.cloudfunctions.net/mercadoPagoWebhook');
  check('anual: manda o e-mail do admin', calls.preferenceCreate[0].payer.email === 'adm@x.com');

  // ───────── Regressão: erro do Mercado Pago chega com mensagem clara ─────────
  // Confirmado em produção: sem este tratamento, o SDK lança uma exceção que o Firebase
  // converte num "internal" genérico sem nenhum detalhe — o app parecia travado, sem
  // nenhuma mensagem visível ao usuário.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  createShouldThrowMessage = 'Both payer and collector must be real or test users';

  const monthlyErr = await (async () => { try { await call(fns.createMonthlySubscription, { liga: 'L' }, authOf('adm')); return null; } catch (e) { return e; } })();
  check('mensal: erro do Mercado Pago vira failed-precondition (não internal)', monthlyErr?.code === 'failed-precondition');
  check('mensal: mensagem do erro inclui a causa real do Mercado Pago', monthlyErr?.message?.includes('Both payer and collector must be real or test users'));

  const annualErr = await (async () => { try { await call(fns.createAnnualPayment, { liga: 'L' }, authOf('adm')); return null; } catch (e) { return e; } })();
  check('anual: erro do Mercado Pago também vira failed-precondition', annualErr?.code === 'failed-precondition');

  // ───────── mercadoPagoWebhook ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  const baseReq = { headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req1' }, query: { 'data.id': '123', type: 'preapproval' }, body: {} };

  webhookSecretValue = 'PENDENTE_CONFIGURAR';
  let res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: secret ainda não configurado recusa (503), nunca aceita sem validar', res.statusCode === 503);
  check('webhook: secret não configurado não mexe na liga', !store.get('leagues/L').subscriptionActiveUntil);
  webhookSecretValue = 'a-real-webhook-secret';

  signatureShouldFail = true;
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: assinatura inválida é recusada (401)', res.statusCode === 401);
  check('webhook: assinatura inválida não mexe na liga', !store.get('leagues/L').subscriptionActiveUntil);
  signatureShouldFail = false;

  preApprovalGetResult = { status: 'authorized', external_reference: 'L', next_payment_date: '2027-01-15T00:00:00.000Z' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: preapproval autorizado responde 200', res.statusCode === 200);
  check('webhook: preapproval autorizado ativa a liga como mensal', store.get('leagues/L').subscriptionPlan === 'monthly');
  const activeUntil = new Date(store.get('leagues/L').subscriptionActiveUntil);
  check('webhook: ativo até ~5 dias depois do próximo pagamento', Math.abs(activeUntil.getTime() - new Date('2027-01-20T00:00:00.000Z').getTime()) < 1000);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  preApprovalGetResult = { status: 'cancelled', external_reference: 'L' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: preapproval cancelado não ativa nada', !store.get('leagues/L').subscriptionActiveUntil);
  check('webhook: mesmo assim responde 200 (evita reenvio em loop)', res.statusCode === 200);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentGetResult = { status: 'approved', external_reference: 'L' };
  const paymentReq = { ...baseReq, query: { 'data.id': '456', type: 'payment' } };
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: payment aprovado ativa a liga como anual', store.get('leagues/L').subscriptionPlan === 'annual');
  const annualUntil = new Date(store.get('leagues/L').subscriptionActiveUntil);
  check('webhook: ativo por ~365 dias', Math.abs(annualUntil.getTime() - (Date.now() + 365 * 86400000)) < 5000);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentGetResult = { status: 'rejected', external_reference: 'L' };
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: payment rejeitado não ativa nada', !store.get('leagues/L').subscriptionActiveUntil);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  getShouldThrow = true;
  paymentGetResult = { status: 'approved', external_reference: 'L' };
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: falha ao consultar a API responde 500 (Mercado Pago tenta de novo depois)', res.statusCode === 500);
  check('webhook: falha ao consultar não ativa nada', !store.get('leagues/L').subscriptionActiveUntil);

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})();
