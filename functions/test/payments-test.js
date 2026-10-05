const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória (mesma base dos outros harnesses) ────────────
const store = new Map();
let updateCount = 0; // quantas gravações (update) o código fez — prova que repetir é idempotente
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class FieldPath { constructor(...segments) { this.segments = segments; } }
const FieldValue = { delete: () => ({ __delete: true }), increment: n => ({ __inc: n }) };

function applyUpdate(data, patch) {
  const out = clone(data) || {};
  for (const [k, v] of Object.entries(patch)) {
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
    set: async d => { store.set(p, clone(d)); },
    update: async patch => {
      if (!store.has(p)) throw new Error('NOT_FOUND ' + p);
      updateCount++;
      store.set(p, applyUpdate(store.get(p), patch));
    },
    collection: name => ({ doc: id => refOf(`${p}/${name}/${id}`) }),
  };
}
// Transação: as leituras veem o estado de antes e as gravações só valem juntas, no fim — se a
// função falhar no meio, nada foi gravado (é o que a transação de verdade garante).
let transactionShouldFail = false;
let transactionRuns = 0;
const fakeDb = {
  doc: p => refOf(p),
  runTransaction: async fn => {
    transactionRuns++;
    const writes = [];
    const tx = {
      get: async ref => snapOf(ref.path),
      set: (ref, d) => { writes.push(() => store.set(ref.path, clone(d))); },
      update: (ref, patch) => {
        writes.push(() => {
          if (!store.has(ref.path)) throw new Error('NOT_FOUND ' + ref.path);
          updateCount++;
          store.set(ref.path, applyUpdate(store.get(ref.path), patch));
        });
      },
    };
    const result = await fn(tx);
    if (transactionShouldFail) throw new Error('transação falhou (simulado)');
    writes.forEach(w => w());
    return result;
  },
};

// Relógio congelado: o código usa Date.now() e new Date(); os testes de datas precisam de um
// "agora" fixo para o resultado não mudar com o passar do tempo.
const RealDate = Date;
function freezeClock(iso) {
  const frozen = new RealDate(iso).getTime();
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(frozen); else super(...a); }
    static now() { return frozen; }
  };
}
const unfreezeClock = () => { global.Date = RealDate; };

// ── mock do SDK mercadopago: captura os parâmetros enviados e deixa o teste
// controlar o que cada chamada devolve ──────────────────────────────────────
const calls = { preApprovalCreate: [], preferenceCreate: [], preApprovalSearch: [], paymentSearch: [], preApprovalUpdate: [] };
let preApprovalGetResult = null;
let paymentGetResult = null;
let preApprovalSearchResults = []; // usado pelo fallback checkSubscriptionStatus
let paymentSearchResults = [];     // idem
let getShouldThrow = false;
let searchShouldThrow = false;
let updateShouldThrow = false;       // simula o Mercado Pago não conseguindo cancelar a assinatura
let createShouldThrowMessage = null; // simula o SDK do Mercado Pago recusando a criação
const logs = [];

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
  async update({ id, body }) {
    if (updateShouldThrow) throw new Error('falha ao cancelar (simulada)');
    calls.preApprovalUpdate.push({ id, body }); return { id, ...body };
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
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
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
// Todos os testes rodam neste "agora" (depois do corte da soma de períodos, ANNUAL_STACKING_FROM
// no servidor); o teste que precisa de outro dia chama freezeClock de novo depois do reset().
const NOW_ISO = '2026-12-20T12:00:00.000Z';
const reset = () => {
  freezeClock(NOW_ISO);
  store.clear();
  updateCount = 0;
  transactionRuns = 0;
  transactionShouldFail = false;
  calls.preApprovalCreate.length = 0;
  calls.preferenceCreate.length = 0;
  calls.preApprovalSearch.length = 0;
  calls.paymentSearch.length = 0;
  calls.preApprovalUpdate.length = 0;
  logs.length = 0;
  preApprovalGetResult = null;
  paymentGetResult = null;
  preApprovalSearchResults = [];
  paymentSearchResults = [];
  getShouldThrow = false;
  searchShouldThrow = false;
  updateShouldThrow = false;
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
  paymentSearchResults = [annualPay({ date_approved: '2025-11-16T12:00:00.000Z' })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: pagamento anual de mais de um ano atrás não ativa nada', resCheck.status === 'pending' && !store.get('leagues/L').subscriptionPlan);
  freezeClock('2028-02-01T12:00:00.000Z');
  paymentSearchResults = [annualPay({ date_approved: '2026-12-10T10:00:00.000Z' })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: o mesmo vale para um pagamento feito já na soma de períodos (o período dele acabou)', resCheck.status === 'pending' && !store.get('leagues/L').subscriptionPlan && !store.has('leagues/L/billing_payments/pay1'));
  freezeClock(NOW_ISO);
  paymentSearchResults = [annualPay({ date_approved: '2026-12-10T10:00:00.000Z' })];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: anual vale 12 meses a partir da aprovação, não de agora', resCheck.renewsAt === '2027-12-10T10:00:00.000Z');

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

  // Mensal e anual ao mesmo tempo: o anual soma 12 meses à data que o mensal já deu, e a assinatura
  // mensal é cancelada (senão cobraria em dobro).
  reset();
  store.set('leagues/L', { name: 'Liga L' });
  store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
  preApprovalSearchResults = [{ id: 'pre1', status: 'authorized', external_reference: 'L', next_payment_date: '2027-01-09T12:00:00.000Z' }];
  paymentSearchResults = [annualPay()];
  resCheck = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('check: com mensal e anual, o plano fica anual', resCheck.plan === 'annual' && store.get('leagues/L').subscriptionPlan === 'annual');
  check('check: …com 12 meses somados à data que o mensal já tinha dado', resCheck.renewsAt === '2028-01-09T12:00:00.000Z' && store.get('leagues/L').subscriptionRenewsAt === '2028-01-09T12:00:00.000Z');
  check('check: …e a assinatura mensal é cancelada no Mercado Pago', JSON.stringify(calls.preApprovalUpdate) === JSON.stringify([{ id: 'pre1', body: { status: 'cancelled' } }]), calls.preApprovalUpdate);

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
  check('webhook: subscriptionRenewsAt é 12 meses depois da aprovação (sem a margem técnica)', store.get('leagues/L').subscriptionRenewsAt === '2027-12-20T12:00:00.000Z');
  check('webhook: ativo por 12 meses + 1 dia de margem técnica', store.get('leagues/L').subscriptionActiveUntil === '2027-12-21T12:00:00.000Z');

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
  paymentGetResult = annualPay({ date_approved: '2026-12-10T12:00:00.000Z' });
  res = fakeRes();
  await fns.mercadoPagoWebhook(paymentReq, res);
  check('webhook: anual vale 12 meses a partir da aprovação, não de quando a notificação chegou', store.get('leagues/L').subscriptionRenewsAt === '2027-12-10T12:00:00.000Z');
  paymentGetResult = annualPay({ date_approved: '2025-11-16T12:00:00.000Z' });
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

  // ═════════════ "Estender plano": cada pagamento anual soma 12 meses ao vencimento ═════════════
  // Liga L, admin "adm", jogador "jog"; o relógio fica em NOW_ISO (2026-12-20 12:00 UTC).
  const setup = (league = {}) => {
    reset();
    store.set('leagues/L', { name: 'Liga L', ...league });
    store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' } } });
    store.set('users/jog', { email: 'jog@x.com', leagues: { L: { role: 'player' } } });
  };
  const leagueOf = () => store.get('leagues/L');
  const recordOf = id => store.get(`leagues/L/billing_payments/${id}`);
  const recordCount = () => [...store.keys()].filter(k => k.startsWith('leagues/L/billing_payments/')).length;
  const paid = (renewsAt, plan = 'monthly', extra = {}) => ({ subscriptionPlan: plan, subscriptionRenewsAt: renewsAt, subscriptionActiveUntil: new Date(Date.parse(renewsAt) + DAY).toISOString(), ...extra });
  const clearRate = () => { for (const k of [...store.keys()]) if (k.startsWith('rate_limits/')) store.delete(k); };
  const deliver = async payment => { // o Mercado Pago avisando do pagamento (webhook)
    paymentGetResult = payment;
    const r = fakeRes();
    await fns.mercadoPagoWebhook({ headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req1' }, query: { 'data.id': String(payment.id), type: 'payment' }, body: {} }, r);
    return r;
  };
  const sameDates = (l, renewsAt) => l.subscriptionRenewsAt === renewsAt && l.subscriptionActiveUntil === new Date(Date.parse(renewsAt) + DAY).toISOString();
  const cancelled = () => calls.preApprovalUpdate.map(u => u.id + ':' + u.body.status);

  // ───────── a segunda assinatura mensal é barrada; o resto fica livre ─────────
  for (const [label, league, blocked] of [
    ['plano mensal em vigor', paid('2027-01-05T12:00:00.000Z'), true],
    ['plano anual em vigor', paid('2027-06-05T12:00:00.000Z', 'annual'), true],
    ['mensal já cancelado, mas ainda no período pago', paid('2027-01-05T12:00:00.000Z', 'monthly', { subscriptionCancelledAt: '2026-12-01T00:00:00.000Z' }), true],
    ['vence hoje (dentro da tolerância de 1 dia)', paid('2026-12-20T00:00:00.000Z'), true],
    ['plano vencido', paid('2026-12-01T12:00:00.000Z'), false],
    ['só o teste grátis', { trialEndsAt: '2027-01-01T00:00:00.000Z' }, false],
  ]) {
    setup(league);
    let err = null;
    try { await call(fns.createMonthlySubscription, { liga: 'L' }, authOf('adm')); } catch (e) { err = e; }
    check(`mensal: ${label} → ${blocked ? 'barra a segunda assinatura' : 'deixa assinar'}`, blocked ? (err?.code === 'failed-precondition' && calls.preApprovalCreate.length === 0) : (!err && calls.preApprovalCreate.length === 1), err?.message);
    if (blocked) check('mensal: …e a mensagem manda usar "Estender plano"', /Estender plano/.test(err.message), err.message);
  }

  // ───────── o anual cobra o mesmo valor, com título de extensão quando já há plano ─────────
  setup(paid('2027-01-05T12:00:00.000Z'));
  await call(fns.createAnnualPayment, { liga: 'L' }, authOf('adm'));
  check('anual: com plano em vigor, o título diz que estende o plano (+12 meses)', calls.preferenceCreate[0].items[0].title === 'Pelada na Mão — Estender plano (+12 meses)', calls.preferenceCreate[0].items[0].title);
  check('anual: …e o valor é o mesmo do plano anual', calls.preferenceCreate[0].items[0].unit_price === 238.8);
  setup(paid('2026-12-01T12:00:00.000Z', 'annual'));
  await call(fns.createAnnualPayment, { liga: 'L' }, authOf('adm'));
  check('anual: com plano vencido, o título é o da assinatura anual', calls.preferenceCreate[0].items[0].title === 'Pelada na Mão — Assinatura anual', calls.preferenceCreate[0].items[0].title);
  setup();
  await call(fns.createAnnualPayment, { liga: 'L' }, authOf('adm'));
  check('anual: sem plano, o título é o da assinatura anual', calls.preferenceCreate[0].items[0].title === 'Pelada na Mão — Assinatura anual');

  // ───────── somar: primeiro pagamento, repetição, extensão ─────────
  setup();
  let r = await deliver(annualPay({ id: '9001', date_approved: '2026-12-10T10:00:00.000Z' }));
  check('soma: primeiro pagamento — 12 meses a partir da aprovação', r.statusCode === 200 && leagueOf().subscriptionPlan === 'annual' && sameDates(leagueOf(), '2027-12-10T10:00:00.000Z'), leagueOf());
  check('soma: o pagamento fica registrado (valor, datas de antes e de depois)', recordOf('9001')?.paymentId === '9001' && recordOf('9001').amount === 238.8 && recordOf('9001').renewsAtBefore === null && recordOf('9001').renewsAtAfter === '2027-12-10T10:00:00.000Z', recordOf('9001'));

  const writes = updateCount;
  await deliver(annualPay({ id: '9001', date_approved: '2026-12-10T10:00:00.000Z' }));
  paymentSearchResults = [annualPay({ id: '9001', date_approved: '2026-12-10T10:00:00.000Z' })];
  await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  await fns.reconcileSubscriptions();
  check('soma: o mesmo pagamento de novo (webhook, app e reconciliação) não soma outra vez', sameDates(leagueOf(), '2027-12-10T10:00:00.000Z'), leagueOf());
  check('soma: …não regrava nada e não duplica o registro', updateCount === writes && recordCount() === 1, { updateCount, writes, recordCount: recordCount() });

  setup(paid('2027-03-01T00:00:00.000Z', 'annual'));
  await deliver(annualPay({ id: '9002', date_approved: '2026-12-15T10:00:00.000Z' }));
  check('soma: plano anual em vigor — os 12 meses entram DEPOIS do vencimento atual', sameDates(leagueOf(), '2028-03-01T00:00:00.000Z'), leagueOf());
  check('soma: …e o registro guarda o vencimento de antes', recordOf('9002')?.renewsAtBefore === '2027-03-01T00:00:00.000Z' && recordOf('9002').renewsAtAfter === '2028-03-01T00:00:00.000Z', recordOf('9002'));

  setup(paid('2026-11-01T00:00:00.000Z', 'annual')); // venceu há um mês
  await deliver(annualPay({ id: '9003', date_approved: '2026-12-10T10:00:00.000Z' }));
  check('soma: plano já vencido — conta da aprovação do pagamento, não da data antiga', sameDates(leagueOf(), '2027-12-10T10:00:00.000Z'), leagueOf());
  check('soma: …e o registro mostra que não havia plano em vigor', recordOf('9003')?.renewsAtBefore === null, recordOf('9003'));

  setup();
  await deliver(annualPay({ id: '9004', date_approved: '2026-12-10T10:00:00.000Z' }));
  await deliver(annualPay({ id: '9005', date_approved: '2026-12-12T10:00:00.000Z' }));
  check('soma: dois pagamentos seguidos somam 24 meses', sameDates(leagueOf(), '2028-12-10T10:00:00.000Z') && recordCount() === 2, leagueOf());

  // Dois pagamentos que o servidor ainda não tinha visto, na consulta do app: soma os dois, na
  // ordem em que foram aprovados, seja qual for a ordem em que o Mercado Pago os lista.
  for (const reverse of [false, true]) {
    setup();
    const list = [annualPay({ id: '9006', date_approved: '2026-12-10T10:00:00.000Z' }), annualPay({ id: '9007', date_approved: '2026-12-12T10:00:00.000Z' })];
    paymentSearchResults = reverse ? list.reverse() : list;
    const c = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
    check(`soma: consulta do app com dois pagamentos novos (${reverse ? 'mais novo primeiro' : 'mais antigo primeiro'}) — soma os dois`, c.status === 'active' && c.renewsAt === '2028-12-10T10:00:00.000Z' && recordCount() === 2, { c, leagueRenews: leagueOf().subscriptionRenewsAt });
  }

  // Fim de mês: 29/02 + 12 meses é 28/02 (não 1º de março).
  setup();
  freezeClock('2028-03-05T12:00:00.000Z');
  await deliver(annualPay({ id: '9008', date_approved: '2028-02-29T10:00:00.000Z' }));
  check('soma: 29/02 + 12 meses = 28/02 do ano seguinte', leagueOf().subscriptionRenewsAt === '2029-02-28T10:00:00.000Z', leagueOf());

  // Pagamento que já nasceu vencido, ou com identificador/ligação estranha, não grava nada.
  setup();
  freezeClock('2028-02-01T12:00:00.000Z');
  await deliver(annualPay({ id: '9009', date_approved: '2026-12-10T10:00:00.000Z' }));
  check('soma: pagamento cujo período já acabou não ativa nem deixa registro', !leagueOf().subscriptionPlan && recordCount() === 0, leagueOf());
  setup();
  r = await deliver(annualPay({ id: 'a/b' }));
  check('soma: identificador com "/" é ignorado (sem caminho estranho no banco)', r.statusCode === 200 && !leagueOf().subscriptionPlan && recordCount() === 0 && ![...store.keys()].some(k => k.includes('a/b')), [...store.keys()]);
  setup();
  r = await deliver(annualPay({ id: '9010', external_reference: 'NAO-EXISTE' }));
  check('soma: liga inexistente — 200, sem criar nada', r.statusCode === 200 && !store.has('leagues/NAO-EXISTE') && !store.has('leagues/NAO-EXISTE/billing_payments/9010'));

  // Se a transação falhar nada é gravado pela metade (nem o registro sem a data, nem a data sem o
  // registro); o Mercado Pago repete o aviso e aí funciona.
  setup();
  transactionShouldFail = true;
  r = await deliver(annualPay({ id: '9011', date_approved: '2026-12-10T10:00:00.000Z' }));
  check('soma: falha na transação responde 500 (o Mercado Pago repete o aviso)', r.statusCode === 500, r.statusCode);
  check('soma: …e não grava nada pela metade', !leagueOf().subscriptionPlan && recordCount() === 0, leagueOf());
  transactionShouldFail = false;
  r = await deliver(annualPay({ id: '9011', date_approved: '2026-12-10T10:00:00.000Z' }));
  check('soma: …e quando a repetição chega, soma normalmente', r.statusCode === 200 && sameDates(leagueOf(), '2027-12-10T10:00:00.000Z'), leagueOf());

  // Pagamentos anteriores à soma de períodos (só os de teste) seguem a regra antiga e não são somados de novo.
  setup();
  freezeClock('2026-10-15T00:00:00.000Z');
  await deliver(annualPay({ id: '8001', date_approved: '2026-10-01T10:00:00.000Z' }));
  check('antigo: pagamento anterior ao corte vale 365 dias a partir da aprovação', sameDates(leagueOf(), '2027-10-01T10:00:00.000Z'), leagueOf());
  check('antigo: …e não gera registro', recordCount() === 0);
  const writesOld = updateCount;
  await deliver(annualPay({ id: '8001', date_approved: '2026-10-01T10:00:00.000Z' }));
  check('antigo: repetir não muda nada', updateCount === writesOld && sameDates(leagueOf(), '2027-10-01T10:00:00.000Z'));
  await deliver(annualPay({ id: '8002', date_approved: '2026-10-14T10:00:00.000Z' }));
  check('antigo: um pagamento novo soma 12 meses por cima da data que a regra antiga deu', sameDates(leagueOf(), '2028-10-01T10:00:00.000Z') && recordCount() === 1, leagueOf());

  // ───────── mensal → estender: soma e cancela a assinatura mensal ─────────
  const monthlyPre = (extra = {}) => ({ id: 'preM', status: 'authorized', external_reference: 'L', next_payment_date: '2026-12-30T00:00:00.000Z', ...extra });
  setup(paid('2026-12-30T00:00:00.000Z'));
  preApprovalSearchResults = [monthlyPre()];
  await deliver(annualPay({ id: '9101', date_approved: '2026-12-15T10:00:00.000Z' }));
  check('estender: quem pagava o mensal — os 12 meses entram depois da próxima cobrança', leagueOf().subscriptionPlan === 'annual' && sameDates(leagueOf(), '2027-12-30T00:00:00.000Z'), leagueOf());
  check('estender: …e a assinatura mensal é cancelada no Mercado Pago (não cobra em dobro)', JSON.stringify(cancelled()) === JSON.stringify(['preM:cancelled']), cancelled());
  check('estender: …procurando só as autorizadas da própria liga', calls.preApprovalSearch.some(o => o.external_reference === 'L' && o.status === 'authorized'), calls.preApprovalSearch);

  // O Mercado Pago acabou de cobrar mais um mês e a liga ainda não soube: o anual soma 12 meses à data
  // nova da cobrança, não à antiga (pela notificação do pagamento, que não passa pela reconciliação).
  setup(paid('2026-12-20T00:00:00.000Z')); // venceria hoje
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-01-20T00:00:00.000Z' })];
  await deliver(annualPay({ id: '9111', date_approved: '2026-12-20T11:00:00.000Z' }));
  check('estender: soma sobre a próxima cobrança que o Mercado Pago informa agora, não sobre a data antiga da liga', leagueOf().subscriptionPlan === 'annual' && sameDates(leagueOf(), '2028-01-20T00:00:00.000Z') && JSON.stringify(cancelled()) === JSON.stringify(['preM:cancelled']), { league: leagueOf(), cancelled: cancelled() });
  setup(paid('2026-12-30T00:00:00.000Z'));
  preApprovalSearchResults = [
    monthlyPre(),
    { id: 'preOutra', status: 'authorized', external_reference: 'OUTRA', next_payment_date: '2030-01-01T00:00:00.000Z' }, // de outra liga: nunca conta nem se cancela
  ];
  await deliver(annualPay({ id: '9113', date_approved: '2026-12-20T11:00:00.000Z' }));
  check('estender: assinatura de outra liga na resposta do Mercado Pago é ignorada (não vira data da liga nem é cancelada)', sameDates(leagueOf(), '2027-12-30T00:00:00.000Z') && JSON.stringify(cancelled()) === JSON.stringify(['preM:cancelled']), { league: leagueOf(), cancelled: cancelled() });
  setup(paid('2026-12-20T00:00:00.000Z'));
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-01-20T00:00:00.000Z' })];
  searchShouldThrow = true;
  r = await deliver(annualPay({ id: '9112', date_approved: '2026-12-20T11:00:00.000Z' }));
  check('estender: se não der para consultar o Mercado Pago, o aviso responde 500 (ele repete) e nada é somado antes da hora', r.statusCode === 500 && sameDates(leagueOf(), '2026-12-20T00:00:00.000Z') && recordCount() === 0, { code: r.statusCode, league: leagueOf() });
  searchShouldThrow = false;

  // Não conseguiu cancelar: o plano estendido fica (a pessoa pagou), o erro fica no log e a
  // reconciliação tenta de novo.
  setup(paid('2026-12-30T00:00:00.000Z'));
  preApprovalSearchResults = [monthlyPre()];
  updateShouldThrow = true;
  r = await deliver(annualPay({ id: '9102', date_approved: '2026-12-15T10:00:00.000Z' }));
  check('estender: cancelamento recusado — o plano estendido fica e o aviso responde 200', r.statusCode === 200 && sameDates(leagueOf(), '2027-12-30T00:00:00.000Z'), { code: r.statusCode, league: leagueOf() });
  check('estender: …o erro fica no log', logs.some(l => l.level === 'error' && /cancelar a assinatura mensal/.test(l.m)), logs);
  updateShouldThrow = false;
  paymentSearchResults = [];
  await fns.reconcileSubscriptions();
  check('estender: …e a reconciliação cancela depois', JSON.stringify(cancelled()) === JSON.stringify(['preM:cancelled']) && sameDates(leagueOf(), '2027-12-30T00:00:00.000Z'), { cancelled: cancelled(), league: leagueOf() });
  calls.preApprovalUpdate.length = 0;
  preApprovalSearchResults = []; // cancelada: o Mercado Pago já não a lista como autorizada
  await fns.reconcileSubscriptions();
  check('estender: …e de novo não faz nada se já não há assinatura autorizada', calls.preApprovalUpdate.length === 0, calls.preApprovalUpdate);

  // Só se cancela o que o plano anual já cobre.
  setup(paid('2027-03-01T00:00:00.000Z', 'annual'));
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-06-01T00:00:00.000Z' })]; // cobraria só depois de o anual acabar
  await fns.reconcileSubscriptions();
  check('estender: assinatura mensal que só cobraria depois do fim do anual não é cancelada', calls.preApprovalUpdate.length === 0, calls.preApprovalUpdate);
  setup(paid('2026-11-01T00:00:00.000Z', 'annual')); // anual já vencido
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-01-05T00:00:00.000Z' })];
  await fns.reconcileSubscriptions();
  check('estender: com o anual vencido a mensal é a assinatura da liga e não é cancelada', calls.preApprovalUpdate.length === 0 && leagueOf().subscriptionPlan === 'monthly', { updates: calls.preApprovalUpdate, league: leagueOf() });
  setup(paid('2026-11-01T00:00:00.000Z', 'annual')); // anual vencido
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2026-10-20T00:00:00.000Z' })]; // cobrança da mensal atrasada (ainda tentando)
  await fns.reconcileSubscriptions();
  check('estender: anual vencido e mensal com a cobrança atrasada — não há plano anual cobrindo nada, não cancela', calls.preApprovalUpdate.length === 0, calls.preApprovalUpdate);
  // O mesmo aviso de pagamento chegando de novo (já somado) não cancela uma mensal que só cobraria depois do fim do anual.
  setup(paid('2027-03-01T00:00:00.000Z', 'annual'));
  store.set('leagues/L/billing_payments/9401', { paymentId: '9401', renewsAtAfter: '2027-03-01T00:00:00.000Z' });
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-06-01T00:00:00.000Z' })];
  await deliver(annualPay({ id: '9401', date_approved: '2026-12-15T10:00:00.000Z' }));
  check('estender: aviso repetido de pagamento já somado, com uma mensal que dura mais que o anual — nada é cancelado e a liga fica com a de validade mais longa', calls.preApprovalUpdate.length === 0 && leagueOf().subscriptionPlan === 'monthly' && sameDates(leagueOf(), '2027-06-01T00:00:00.000Z'), { updates: calls.preApprovalUpdate, league: leagueOf() });
  setup(paid('2027-03-01T00:00:00.000Z', 'annual'));
  preApprovalSearchResults = [
    monthlyPre({ id: 'preDentro', next_payment_date: '2027-01-05T00:00:00.000Z' }),
    { id: 'preSemLiga', status: 'authorized', external_reference: 'NAO-EXISTE', next_payment_date: '2027-01-05T00:00:00.000Z' }, // liga que não existe
    { id: 'preSemRef', status: 'authorized', next_payment_date: '2027-01-05T00:00:00.000Z' },                                     // sem referência
  ];
  await fns.reconcileSubscriptions();
  check('estender: cancela só a assinatura mensal coberta de uma liga que existe', JSON.stringify(cancelled()) === JSON.stringify(['preDentro:cancelled']) && leagueOf().subscriptionPlan === 'annual', { cancelled: cancelled(), league: leagueOf() });

  // Ordem na consulta do app e na reconciliação: a assinatura mensal primeiro, depois os pagamentos
  // anuais — o anual soma 12 meses ao vencimento que a mensal já tinha dado.
  setup(paid('2026-12-27T00:00:00.000Z')); // a liga ainda guarda a data de antes da última cobrança mensal
  freezeClock('2026-12-27T12:00:00.000Z');
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-01-27T00:00:00.000Z' })]; // o Mercado Pago já cobrou o mês e avançou a data
  paymentSearchResults = [annualPay({ id: '9103', date_approved: '2026-12-27T10:00:00.000Z' })];
  await fns.reconcileSubscriptions();
  check('ordem: reconciliação — a assinatura mensal entra antes do pagamento anual', leagueOf().subscriptionPlan === 'annual' && sameDates(leagueOf(), '2028-01-27T00:00:00.000Z'), leagueOf());
  setup(paid('2026-12-27T00:00:00.000Z'));
  freezeClock('2026-12-27T12:00:00.000Z');
  preApprovalSearchResults = [monthlyPre({ next_payment_date: '2027-01-27T00:00:00.000Z' })];
  paymentSearchResults = [annualPay({ id: '9103', date_approved: '2026-12-27T10:00:00.000Z' })];
  await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('ordem: consulta do app — a assinatura mensal entra antes do pagamento anual', leagueOf().subscriptionPlan === 'annual' && sameDates(leagueOf(), '2028-01-27T00:00:00.000Z'), leagueOf());

  // ───────── a consulta do app devolve o plano da liga (o app compara a data de antes e a de depois) ─────────
  setup(paid('2027-03-01T00:00:00.000Z', 'annual'));
  let st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('consulta: pagamento novo ainda não visível — devolve o plano de antes, com a mesma data', st.status === 'active' && st.plan === 'annual' && st.renewsAt === '2027-03-01T00:00:00.000Z', st);
  paymentSearchResults = [annualPay({ id: '9201', date_approved: '2026-12-20T11:00:00.000Z' })];
  st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('consulta: pagamento novo visível — a data devolvida avança 12 meses', st.status === 'active' && st.renewsAt === '2028-03-01T00:00:00.000Z', st);
  setup();
  st = await call(fns.checkSubscriptionStatus, { liga: 'L' }, authOf('adm'));
  check('consulta: sem plano e sem pagamento — pending', st.status === 'pending');

  // ───────── cancelSubscription (cancelar a assinatura mensal pelo app) ─────────
  const cancelSub = async (uid = 'adm') => { clearRate(); return call(fns.cancelSubscription, { liga: 'L' }, authOf(uid)); };
  const open = [
    { id: 'a1', external_reference: 'L', status: 'authorized', next_payment_date: '2027-01-05T12:00:00.000Z' }, // a mesma data que a liga já tem
    { id: 'a2', external_reference: 'L', status: 'paused' },
    { id: 'a4', external_reference: 'L', status: 'cancelled' },          // já cancelada: não mexe
    { id: 'x1', external_reference: 'OUTRA', status: 'authorized' },     // OUTRA liga: nunca pode ser cancelada
  ];
  setup(paid('2027-01-05T12:00:00.000Z'));
  preApprovalSearchResults = open;
  check('cancelar: sem login', await codeOf(call(fns.cancelSubscription, { liga: 'L' })) === 'unauthenticated');
  check('cancelar: jogador comum não pode', await codeOf(cancelSub('jog')) === 'permission-denied');
  check('cancelar: liga inválida', await codeOf(call(fns.cancelSubscription, { liga: '../x' }, authOf('adm'))) === 'invalid-argument');
  check('cancelar: liga inexistente', await codeOf((async () => { clearRate(); store.set('users/adm', { email: 'adm@x.com', leagues: { L: { role: 'admin' }, FANTASMA: { role: 'admin' } } }); return call(fns.cancelSubscription, { liga: 'FANTASMA' }, authOf('adm')); })()) === 'not-found');
  check('cancelar: nada foi cancelado nas recusas', calls.preApprovalUpdate.length === 0 && !leagueOf().subscriptionCancelledAt, calls.preApprovalUpdate);
  r = await cancelSub();
  check('cancelar: responde ok com a quantidade cancelada', r.ok === true && r.canceled === 2, r);
  check('cancelar: cancela as assinaturas abertas da liga (autorizada e pausada) e só elas', JSON.stringify(cancelled()) === JSON.stringify(['a1:cancelled', 'a2:cancelled']), cancelled());
  check('cancelar: marca a liga como cancelada', leagueOf().subscriptionCancelledAt === NOW_ISO, leagueOf());
  check('cancelar: o plano segue valendo até o fim do período pago (datas e plano intactos)', leagueOf().subscriptionPlan === 'monthly' && sameDates(leagueOf(), '2027-01-05T12:00:00.000Z'), leagueOf());
  freezeClock('2026-12-22T12:00:00.000Z');
  r = await cancelSub();
  check('cancelar: repetir não muda a data em que foi cancelada', r.ok === true && leagueOf().subscriptionCancelledAt === NOW_ISO, leagueOf());

  // O Mercado Pago acabou de cobrar mais um mês e a liga ainda não soube (a reconciliação roda de 6 em 6
  // horas): cancelar não pode fazer a pessoa perder esse mês já pago.
  setup(paid('2026-12-20T00:00:00.000Z')); // a data que a liga ainda guarda (venceria hoje)
  preApprovalSearchResults = [{ id: 'a1', external_reference: 'L', status: 'authorized', next_payment_date: '2027-01-20T00:00:00.000Z' }];
  r = await cancelSub();
  check('cancelar logo depois de uma cobrança: a liga guarda o mês já pago (data nova do Mercado Pago) antes de cancelar', r.ok === true && leagueOf().subscriptionPlan === 'monthly' && sameDates(leagueOf(), '2027-01-20T00:00:00.000Z') && leagueOf().subscriptionCancelledAt === NOW_ISO && cancelled().join() === 'a1:cancelled', leagueOf());
  setup(paid('2026-12-20T00:00:00.000Z'));
  preApprovalSearchResults = [{ id: 'a1', external_reference: 'L', status: 'authorized', next_payment_date: '2027-01-20T00:00:00.000Z' }];
  updateShouldThrow = true;
  const keepErr = await (async () => { try { await cancelSub(); return null; } catch (e) { return e; } })();
  check('…e se o Mercado Pago recusar o cancelamento, o mês pago continua guardado (e a liga não é marcada como cancelada)', keepErr?.code === 'failed-precondition' && sameDates(leagueOf(), '2027-01-20T00:00:00.000Z') && !leagueOf().subscriptionCancelledAt, leagueOf());
  updateShouldThrow = false;

  // A mensal que a pessoa já cancelou direto no Mercado Pago: não há o que cancelar, mas a liga é marcada.
  setup(paid('2027-01-05T12:00:00.000Z'));
  preApprovalSearchResults = [{ id: 'a4', external_reference: 'L', status: 'cancelled' }];
  r = await cancelSub();
  check('cancelar: sem assinatura aberta no Mercado Pago — ok, e a liga é marcada como cancelada', r.ok === true && r.canceled === 0 && leagueOf().subscriptionCancelledAt === NOW_ISO, { r, league: leagueOf() });

  // Plano anual: não renova sozinho, não há "cancelada" para mostrar.
  setup(paid('2027-06-05T12:00:00.000Z', 'annual'));
  preApprovalSearchResults = [];
  r = await cancelSub();
  check('cancelar: no plano anual não marca a liga como cancelada', r.ok === true && !leagueOf().subscriptionCancelledAt, leagueOf());

  // O Mercado Pago falhou: nada é marcado, a pessoa vê a mensagem e pode tentar de novo.
  setup(paid('2027-01-05T12:00:00.000Z'));
  preApprovalSearchResults = open;
  searchShouldThrow = true;
  let cerr = await (async () => { try { await cancelSub(); return null; } catch (e) { return e; } })();
  check('cancelar: Mercado Pago fora do ar ao conferir — failed-precondition, nada marcado', cerr?.code === 'failed-precondition' && /conferir/.test(cerr.message) && !leagueOf().subscriptionCancelledAt, cerr?.message);
  searchShouldThrow = false;
  updateShouldThrow = true;
  cerr = await (async () => { try { await cancelSub(); return null; } catch (e) { return e; } })();
  check('cancelar: Mercado Pago recusa o cancelamento — failed-precondition, nada marcado', cerr?.code === 'failed-precondition' && /cancelar/.test(cerr.message) && !leagueOf().subscriptionCancelledAt, cerr?.message);
  updateShouldThrow = false;
  r = await cancelSub();
  check('cancelar: …e tentar de novo, com o Mercado Pago de volta, conclui', r.ok === true && leagueOf().subscriptionCancelledAt === NOW_ISO, leagueOf());

  // Assinatura "pending" (checkout aberto e nunca concluído) não cobra nada: se não cancelar, não trava.
  setup(paid('2027-01-05T12:00:00.000Z'));
  preApprovalSearchResults = [{ id: 'p1', external_reference: 'L', status: 'pending' }];
  updateShouldThrow = true;
  r = await cancelSub();
  check('cancelar: assinatura pendente que não cancela não trava', r.ok === true && leagueOf().subscriptionCancelledAt === NOW_ISO, r);
  updateShouldThrow = false;

  // Limite de chamadas por minuto (a 6ª é barrada).
  setup(paid('2027-01-05T12:00:00.000Z'));
  preApprovalSearchResults = [];
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push(await codeOf(call(fns.cancelSubscription, { liga: 'L' }, authOf('adm'))));
  check('cancelar: a 6ª chamada em um minuto é barrada', codes.slice(0, 5).every(c => c === 'ok') && codes[5] === 'resource-exhausted', codes);

  // ───────── assinar de novo desfaz o "cancelada" ─────────
  setup(paid('2026-12-01T12:00:00.000Z', 'monthly', { subscriptionCancelledAt: '2026-11-20T00:00:00.000Z' })); // cancelou, o plano acabou
  preApprovalGetResult = { status: 'authorized', external_reference: 'L', next_payment_date: '2027-01-15T00:00:00.000Z' };
  const subReq = { headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req1' }, query: { 'data.id': '123', type: 'preapproval' }, body: {} };
  await fns.mercadoPagoWebhook(subReq, fakeRes());
  check('assinar de novo: nova assinatura mensal autorizada tira a marca de cancelada', leagueOf().subscriptionPlan === 'monthly' && sameDates(leagueOf(), '2027-01-15T00:00:00.000Z') && leagueOf().subscriptionCancelledAt === undefined, leagueOf());
  setup(paid('2027-01-05T12:00:00.000Z', 'monthly', { subscriptionCancelledAt: '2026-12-01T00:00:00.000Z' }));
  await deliver(annualPay({ id: '9301', date_approved: '2026-12-15T10:00:00.000Z' }));
  check('estender: pagar o anual também tira a marca de cancelada', leagueOf().subscriptionPlan === 'annual' && leagueOf().subscriptionCancelledAt === undefined && sameDates(leagueOf(), '2028-01-05T12:00:00.000Z'), leagueOf());
  unfreezeClock();

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})();
