const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória (mesma base dos outros harnesses) ────────────
const store = new Map();
let updateCount = 0; // quantas gravações (update) o código fez — prova que repetir é idempotente
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
      updateCount++;
      store.set(p, applyUpdate(store.get(p), patch));
    },
  };
}
const fakeDb = { doc: p => refOf(p) };

// ── mock do SDK mercadopago: captura os parâmetros enviados e deixa o teste
// controlar o que cada chamada devolve ──────────────────────────────────────
const calls = { preApprovalCreate: [], preferenceCreate: [], preApprovalSearch: [], paymentSearch: [] };
let preApprovalGetResult = null;
let paymentGetResult = null;
let preApprovalSearchResults = []; // usado pelo fallback checkSubscriptionStatus
let paymentSearchResults = [];     // idem
let getShouldThrow = false;
let searchShouldThrow = false;
let createShouldThrowMessage = null; // simula o SDK do Mercado Pago recusando a criação

class MercadoPagoConfig { constructor(opts) { this.opts = opts; } }
class PreApproval {
  async create({ body }) {
    if (createShouldThrowMessage) { const e = new Error(createShouldThrowMessage); e.status = 400; throw e; }
    calls.preApprovalCreate.push(body); return { init_point: 'https://mp.test/preapproval/xyz' };
  }
  async get({ id }) { if (getShouldThrow) throw new Error('falha de rede simulada'); return { id, ...preApprovalGetResult }; }
  async search({ options } = {}) {
    if (searchShouldThrow) throw new Error('falha de rede simulada');
    calls.preApprovalSearch.push(options); return { results: preApprovalSearchResults };
  }
}
class Preference {
  async create({ body }) {
    if (createShouldThrowMessage) { const e = new Error(createShouldThrowMessage); e.status = 400; throw e; }
    calls.preferenceCreate.push(body); return { init_point: 'https://mp.test/preference/xyz' };
  }
}
class Payment {
  async get({ id }) { if (getShouldThrow) throw new Error('falha de rede simulada'); return { id, ...paymentGetResult }; }
  async search({ options } = {}) {
    if (searchShouldThrow) throw new Error('falha de rede simulada');
    calls.paymentSearch.push(options); return { results: paymentSearchResults };
  }
}
let signatureShouldFail = false; // assinatura presente mas incorreta (deve recusar)
let signatureMissingHeader = false; // sem cabeçalho x-signature (observado em preapproval; deve prosseguir)
let webhookSecretValue = 'a-real-webhook-secret';
class WebhookSignatureValidator {
  static validate() {
    if (signatureMissingHeader) { const e = new Error('x-signature ausente simulado'); e.reason = 'MissingSignatureHeader'; throw e; }
    if (signatureShouldFail) throw new Error('assinatura inválida simulada');
  }
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
const DAY = 86400000;
// Pagamento do plano anual como o Mercado Pago devolve (valor do plano, aprovado agora).
const annualPay = extra => ({ id: 'pay1', status: 'approved', external_reference: 'L', transaction_amount: 238.8, date_approved: new Date().toISOString(), ...extra });
const reset = () => {
  store.clear();
  updateCount = 0;
  calls.preApprovalCreate.length = 0;
  calls.preferenceCreate.length = 0;
  calls.preApprovalSearch.length = 0;
  calls.paymentSearch.length = 0;
  preApprovalGetResult = null;
  paymentGetResult = null;
  preApprovalSearchResults = [];
  paymentSearchResults = [];
  getShouldThrow = false;
  searchShouldThrow = false;
  createShouldThrowMessage = null;
  signatureShouldFail = false;
  signatureMissingHeader = false;
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
  // Regressão: o retorno ao site precisa identificar a liga para o fallback (checkSubscriptionStatus
  // no boot) saber qual assinatura conferir, caso o webhook atrase ou nunca chegue.
  check('mensal: back_url identifica a liga para o fallback no retorno', calls.preApprovalCreate[0].back_url === 'https://peladanamao.com.br/?mpReturn=L');

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
  check('anual: back_urls identificam a liga para o fallback no retorno', calls.preferenceCreate[0].back_urls.success === 'https://peladanamao.com.br/?mpReturn=L');

  // ───────── checkSubscriptionStatus (fallback quando o webhook atrasa/falha) ─────────
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  store.set('users/jog', { email: 'jog@x.com', leagues: { L: { role: 'player' } } });

  check('check: sem login', await codeOf(call(fns.checkSubscriptionStatus, { liga: 'L' })) === 'unauthenticated');
  check('check: jogador comum não pode', await codeOf(call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('jog'))) === 'permission-denied');

  let resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: nada encontrado devolve pending', resCheck.status === 'pending');
  check('check: liga não mexida quando nada encontrado', !store.get('leagues/L').subscriptionActiveUntil);
  check('check: filtra a busca de assinaturas pela liga', calls.preApprovalSearch[0].external_reference === 'L');
  check('check: filtra a busca de pagamentos pela liga', calls.paymentSearch[0].external_reference === 'L');
  // Regressão: a busca de assinaturas recusou "sort: date_created" sozinho em produção
  // ("Invalid sorting value") — exige campo e direção combinados numa única string.
  check('check: busca de assinaturas usa sort no formato campo:direção', calls.preApprovalSearch[0].sort === 'date_created:desc');

  // Regressão: o webhook de subscription_preapproval chegou sem x-signature em produção
  // mesmo com o secret certo (ver mercadoPagoWebhook); este fallback cobre esse caso
  // consultando a API diretamente, sem depender da notificação nunca ter chegado.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: '2027-01-15T00:00:00.000Z' }];

  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: encontra assinatura autorizada e ativa como mensal', resCheck.status === 'active' && resCheck.plan === 'monthly');
  check('check: liga ativada de fato (não só a resposta)', store.get('leagues/L').subscriptionPlan === 'monthly');
  check('check: subscriptionRenewsAt é a data real, sem margem', store.get('leagues/L').subscriptionRenewsAt === '2027-01-15T00:00:00.000Z');
  const checkActiveUntil = new Date(store.get('leagues/L').subscriptionActiveUntil);
  check('check: ativo até ~1 dia depois do próximo pagamento (margem técnica)', Math.abs(checkActiveUntil.getTime() - new Date('2027-01-16T00:00:00.000Z').getTime()) < 1000);

  // Resultado de outra liga (mesmo comprador) não deve ativar a liga L
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  preApprovalSearchResults = [{ id: 'pre2', status: 'authorized', external_reference: 'OUTRA-LIGA' }];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: resultado de outra liga é ignorado (devolve pending)', resCheck.status === 'pending');
  check('check: liga L não foi ativada com dado de outra liga', !store.get('leagues/L').subscriptionActiveUntil);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  paymentSearchResults = [annualPay()];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: encontra pagamento aprovado e ativa como anual', resCheck.status === 'active' && resCheck.plan === 'annual');
  check('check: liga ativada como anual de fato', store.get('leagues/L').subscriptionPlan === 'annual');

  // Regressão grave: a cobrança mensal da assinatura (R$ 29,90) também aparece como pagamento
  // aprovado com a referência da liga — não pode virar um ano inteiro de acesso.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  paymentSearchResults = [annualPay({ transaction_amount: 29.9 })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: cobrança mensal (R$ 29,90) não conta como plano anual', resCheck.status === 'pending' && !store.get('leagues/L').subscriptionPlan);
  paymentSearchResults = [annualPay({ operation_type: 'recurring_payment' })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: pagamento recorrente não conta como plano anual (mesmo com o valor do anual)', resCheck.status === 'pending');

  // Regressão: a validade do anual conta da aprovação; consultar de novo um ano depois não pode
  // renovar de graça o mesmo pagamento.
  paymentSearchResults = [annualPay({ date_approved: new Date(Date.now() - 400 * DAY).toISOString() })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: pagamento anual de mais de um ano atrás não ativa nada', resCheck.status === 'pending' && !store.get('leagues/L').subscriptionPlan);
  paymentSearchResults = [annualPay({ date_approved: new Date(Date.now() - 10 * DAY).toISOString() })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: anual vale 365 dias a partir da aprovação, não de agora', Math.abs(new Date(resCheck.renewsAt).getTime() - (Date.now() + 355 * DAY)) < 5000);

  // Duas assinaturas mensais da mesma liga: vale a de validade mais longa, não a mais recente.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  const farMonthly = new Date(Date.now() + 33 * DAY).toISOString();
  preApprovalSearchResults = [
    { id: 'preNova', status: 'authorized', external_reference: 'L', next_payment_date: new Date(Date.now() + 28 * DAY).toISOString() },
    { id: 'preAntiga', status: 'authorized', external_reference: 'L', next_payment_date: farMonthly },
  ];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: com duas assinaturas mensais, escolhe a de validade mais longa', resCheck.renewsAt === farMonthly && store.get('leagues/L').subscriptionRenewsAt === farMonthly);

  // Mensal e anual ao mesmo tempo: vale a de validade mais longa.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: new Date(Date.now() + 20 * DAY).toISOString() }];
  paymentSearchResults = [annualPay()];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: com mensal e anual, escolhe a de validade mais longa', resCheck.plan === 'annual' && store.get('leagues/L').subscriptionPlan === 'annual');

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  searchShouldThrow = true;
  const checkErr = await (async () => { try { await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm')); return null; } catch (e) { return e; } })();
  check('check: falha na consulta vira failed-precondition (não internal)', checkErr?.code === 'failed-precondition');

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

  // Regressão: notificações de assinatura (preapproval) do Mercado Pago chegaram em
  // produção sem o cabeçalho x-signature, mesmo com o segredo certo configurado (confirmado
  // comparando "modo de teste" x "modo de produção" no painel: a assinatura é idêntica, o
  // problema é o provedor não enviar o cabeçalho). Isso não deve travar a ativação, porque o
  // status abaixo é sempre reconfirmado na API do Mercado Pago, nunca confiado do payload.
  signatureMissingHeader = true;
  preApprovalGetResult = { status: 'authorized', external_reference: 'L', next_payment_date: '2027-01-15T00:00:00.000Z' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: sem cabeçalho de assinatura ainda processa (200)', res.statusCode === 200);
  check('webhook: sem cabeçalho de assinatura ainda ativa a liga (status vem da API, não da notificação)', store.get('leagues/L').subscriptionPlan === 'monthly');
  signatureMissingHeader = false;
  store.set('leagues/L', { name: 'Liga L' });

  preApprovalGetResult = { status: 'authorized', external_reference: 'L', next_payment_date: '2027-01-15T00:00:00.000Z' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: preapproval autorizado responde 200', res.statusCode === 200);
  check('webhook: preapproval autorizado ativa a liga como mensal', store.get('leagues/L').subscriptionPlan === 'monthly');
  // Regressão: a UI mostra subscriptionRenewsAt (a data real, sem margem) — o usuário não
  // deve ver "1 mês = 1 mês + folga". subscriptionActiveUntil (controle de acesso interno)
  // soma só 1 dia de tolerância técnica a atraso de notificação, nunca exibido.
  check('webhook: subscriptionRenewsAt é a data real do próximo pagamento (sem margem)', store.get('leagues/L').subscriptionRenewsAt === '2027-01-15T00:00:00.000Z');
  const activeUntil = new Date(store.get('leagues/L').subscriptionActiveUntil);
  check('webhook: ativo até ~1 dia depois do próximo pagamento (margem técnica, não exibida)', Math.abs(activeUntil.getTime() - new Date('2027-01-16T00:00:00.000Z').getTime()) < 1000);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  preApprovalGetResult = { status: 'cancelled', external_reference: 'L' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: preapproval cancelado não ativa nada', !store.get('leagues/L').subscriptionActiveUntil);
  check('webhook: mesmo assim responde 200 (evita reenvio em loop)', res.statusCode === 200);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentGetResult = annualPay();
  const paymentReq = { ...baseReq, query: { 'data.id': '456', type: 'payment' } };
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: payment aprovado ativa a liga como anual', store.get('leagues/L').subscriptionPlan === 'annual');
  check('webhook: subscriptionRenewsAt é ~365 dias (sem a margem técnica)', Math.abs(new Date(store.get('leagues/L').subscriptionRenewsAt).getTime() - (Date.now() + 365 * DAY)) < 5000);
  const annualUntil = new Date(store.get('leagues/L').subscriptionActiveUntil);
  check('webhook: ativo por ~365 dias + 1 dia de margem técnica', Math.abs(annualUntil.getTime() - (Date.now() + 366 * DAY)) < 5000);

  // Regressão grave: a notificação "payment" de uma cobrança mensal da assinatura (R$ 29,90)
  // não pode conceder um ano de acesso.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentGetResult = annualPay({ transaction_amount: 29.9 });
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: payment de R$ 29,90 (cobrança mensal) não ativa o plano anual', !store.get('leagues/L').subscriptionPlan);
  check('webhook: payment mensal responde 200 mesmo sem ativar', res.statusCode === 200);
  paymentGetResult = annualPay({ operation_type: 'recurring_payment' });
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: payment recorrente não ativa o plano anual', !store.get('leagues/L').subscriptionPlan);

  // A validade conta da aprovação: reentregas tardias da notificação não estendem o prazo.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentGetResult = annualPay({ date_approved: new Date(Date.now() - 10 * DAY).toISOString() });
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: anual vale 365 dias a partir da aprovação, não de quando a notificação chegou', Math.abs(new Date(store.get('leagues/L').subscriptionRenewsAt).getTime() - (Date.now() + 355 * DAY)) < 5000);
  paymentGetResult = annualPay({ date_approved: new Date(Date.now() - 400 * DAY).toISOString() });
  store.set('leagues/L', { name: 'Liga L' });
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: pagamento anual de mais de um ano atrás não ativa nada', !store.get('leagues/L').subscriptionPlan);

  // Assinatura com próxima cobrança já vencida não ativa nada
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  preApprovalGetResult = { status: 'authorized', external_reference: 'L', next_payment_date: '2020-01-01T00:00:00.000Z' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: data de cobrança já vencida não ativa a liga', !store.get('leagues/L').subscriptionPlan && res.statusCode === 200);

  // Liga que não existe (external_reference de outro lugar): 200, sem erro nem criar nada
  reset();
  preApprovalGetResult = { status: 'authorized', external_reference: 'NAO-EXISTE', next_payment_date: '2027-01-15T00:00:00.000Z' };
  res = fakeRes();
  await fns.mercadoPagoWebhook({ ...baseReq }, res);
  check('webhook: liga inexistente responde 200 (não fica reenviando) e não cria nada', res.statusCode === 200 && !store.has('leagues/NAO-EXISTE'));

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentGetResult = { status: 'rejected', external_reference: 'L', transaction_amount: 238.8 };
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: payment rejeitado não ativa nada', !store.get('leagues/L').subscriptionActiveUntil);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  getShouldThrow = true;
  paymentGetResult = annualPay();
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: falha ao consultar a API responde 500 (Mercado Pago tenta de novo depois)', res.statusCode === 500);
  check('webhook: falha ao consultar não ativa nada', !store.get('leagues/L').subscriptionActiveUntil);

  // ───────── reconcileSubscriptions (rede de segurança agendada) ─────────
  // Renovação mensal: o webhook só avisa de mudanças de status; quem mantém a liga ativa a cada
  // novo ciclo é esta consulta periódica da próxima cobrança real.
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  const nextCycle = new Date(Date.now() + 30 * DAY).toISOString();
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: nextCycle }];
  await fns.reconcileSubscriptions();
  check('reconcile: ativa a liga com a próxima cobrança real da assinatura', store.get('leagues/L').subscriptionPlan === 'monthly' && store.get('leagues/L').subscriptionRenewsAt === nextCycle);
  check('reconcile: pede só assinaturas autorizadas', calls.preApprovalSearch[0].status === 'authorized');
  const writesAfterFirst = updateCount;
  await fns.reconcileSubscriptions();
  check('reconcile: repetir sem mudança não grava de novo (idempotente)', updateCount === writesAfterFirst);

  // Novo ciclo cobrado: a próxima cobrança avançou, a liga acompanha
  const cycleAfter = new Date(Date.now() + 60 * DAY).toISOString();
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: cycleAfter }];
  await fns.reconcileSubscriptions();
  check('reconcile: renovação — a data da liga avança com o novo ciclo', store.get('leagues/L').subscriptionRenewsAt === cycleAfter);

  // Assinatura cancelada deixa de vir como "authorized": a liga só segue até o fim do que pagou
  preApprovalSearchResults = [];
  await fns.reconcileSubscriptions();
  check('reconcile: assinatura que sumiu da lista não derruba a liga antes do fim do período pago', store.get('leagues/L').subscriptionRenewsAt === cycleAfter);

  reset();
  store.set('leagues/L', { name: 'Liga L' });
  preApprovalSearchResults = [
    { id: 'preX', status: 'authorized', external_reference: 'NAO-EXISTE', next_payment_date: nextCycle },
    { id: 'preY', status: 'authorized', external_reference: '../x', next_payment_date: nextCycle },
    { id: 'preZ', status: 'authorized', next_payment_date: nextCycle },
    { id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: nextCycle },
  ];
  await fns.reconcileSubscriptions();
  check('reconcile: referência inexistente, inválida ou ausente é ignorada sem derrubar o resto', store.get('leagues/L').subscriptionPlan === 'monthly' && !store.has('leagues/NAO-EXISTE'));

  // Anual cujo aviso se perdeu: ativa a partir dos pagamentos aprovados recentes
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  paymentSearchResults = [annualPay(), annualPay({ id: 'pay2', external_reference: 'OUTRA', transaction_amount: 29.9 })];
  await fns.reconcileSubscriptions();
  check('reconcile: pagamento anual aprovado recente ativa a liga', store.get('leagues/L').subscriptionPlan === 'annual');
  check('reconcile: procura só pagamentos aprovados dos últimos dias', calls.paymentSearch[0].status === 'approved' && !!calls.paymentSearch[0].begin_date);

  // Assinou duas vezes a mesma liga: vale a de validade mais longa, gravada uma única vez
  // (sem alternar entre as duas a cada execução).
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  const nearer = new Date(Date.now() + 28 * DAY).toISOString();
  const farther = new Date(Date.now() + 33 * DAY).toISOString();
  preApprovalSearchResults = [
    { id: 'preNova', status: 'authorized', external_reference: 'L', next_payment_date: farther },
    { id: 'preAntiga', status: 'authorized', external_reference: 'L', next_payment_date: nearer },
  ];
  await fns.reconcileSubscriptions();
  check('reconcile: duas assinaturas na mesma liga — fica a de validade mais longa', store.get('leagues/L').subscriptionRenewsAt === farther);
  check('reconcile: duas assinaturas na mesma liga — uma única gravação', updateCount === 1);
  preApprovalSearchResults = preApprovalSearchResults.reverse();
  await fns.reconcileSubscriptions();
  check('reconcile: a ordem em que o Mercado Pago lista não muda o resultado nem regrava', store.get('leagues/L').subscriptionRenewsAt === farther && updateCount === 1);

  // Não rebaixa o que a liga já pagou: anual vigente + assinatura mensal esquecida
  reset();
  const annualEnd = new Date(Date.now() + 200 * DAY).toISOString();
  store.set('leagues/L', { name: 'Liga L', subscriptionPlan: 'annual', subscriptionRenewsAt: annualEnd, subscriptionActiveUntil: new Date(Date.now() + 201 * DAY).toISOString() });
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: nextCycle }];
  await fns.reconcileSubscriptions();
  check('reconcile: assinatura mensal não rebaixa um anual com validade maior', store.get('leagues/L').subscriptionPlan === 'annual' && store.get('leagues/L').subscriptionRenewsAt === annualEnd);

  // Falha do Mercado Pago: o erro sobe, o agendador registra a falha e tenta de novo depois
  reset();
  searchShouldThrow = true;
  check('reconcile: falha ao consultar o Mercado Pago propaga o erro (aparece como falha no agendador)', await codeOf(fns.reconcileSubscriptions()) !== 'ok');

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})();
