// Testa os avisos de cobrança por e-mail (notifyBillingEmails): quando avisa, quem recebe, o que
// diz, que não repete e que um defeito de envio não perde o aviso.
const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── Firestore falso em memória (mesma base de abandoned-leagues-test.js) ────
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
    else cur[last] = clone(value);
  }
  return out;
}

let updateShouldThrowFor = null; // caminho cujo update() falha (simula erro de gravação)
const snapOf = p => {
  const has = store.has(p);
  return { id: p.split('/').pop(), exists: has, data: () => (has ? clone(store.get(p)) : undefined), ref: refOf(p) };
};
function refOf(p) {
  return {
    path: p,
    get: async () => snapOf(p),
    set: async d => { store.set(p, clone(d)); },
    update: async (...args) => {
      if (updateShouldThrowFor === p) throw new Error('falha de gravação simulada');
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
    const build = filters => ({
      where: (f, op, v) => build([...filters, [f, op, v]]),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([p, d]) => inCol(p) && filters.every(([f, op, v]) =>
            op === '==' ? valueAt(d, f) === v : op === 'in' ? Array.isArray(v) && v.includes(valueAt(d, f)) : op === '>=' ? valueAt(d, f) !== undefined && valueAt(d, f) >= v : op === '<=' ? valueAt(d, f) !== undefined && valueAt(d, f) <= v : false))
          .map(([p]) => snapOf(p));
        return { size: docs.length, docs, forEach: fn => docs.forEach(fn) };
      },
    });
    return build([]);
  },
};

class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const logs = [];
const scheduleOpts = [];
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue, FieldPath }),
  messaging: () => ({}),
};

// ── Resend simulado: captura cada e-mail e deixa o teste escolher se falha ──────
const sent = [];
let fetchMode = 'ok'; // 'ok' | 'fail' | 'failFirst' | 'throw'
let fetchCount = 0;
global.fetch = async (url, opts) => {
  fetchCount++;
  const body = JSON.parse(opts.body);
  if (fetchMode === 'throw') throw new Error('sem rede');
  if (fetchMode === 'fail' || (fetchMode === 'failFirst' && fetchCount === 1)) return { ok: false, status: 500 };
  sent.push({ url, body, headers: opts.headers });
  return { ok: true, status: 200, json: async () => ({ id: 'email-fake' }) };
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, onRequest: (opts, h) => h, HttpsError };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (opts, h) => { scheduleOpts.push(opts); return h; } };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-admin/firestore') return { FieldValue, FieldPath };
  if (request === 'firebase-functions') return { logger: { info: (m, d) => logs.push({ level: 'info', m, d }), warn: (m, d) => logs.push({ level: 'warn', m, d }), error: (m, d) => logs.push({ level: 'error', m, d }) } };
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'fake-resend-key' }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
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
const DAY = 86400000;
const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const realNow = Date.now;
const iso = ms => new Date(ms).toISOString();
const clock = ms => { Date.now = () => ms; };
const run = async () => {
  sent.length = 0;
  try { await fns.notifyBillingEmails(); } catch (e) { check('a função agendada termina sem lançar erro', false, e.message); }
  return sent.map(s => ({ to: s.body.to[0], subject: s.body.subject, html: s.body.html, text: s.body.text, body: s.body })); };
const league = id => store.get('leagues/' + id);

// Liga anual: faltam `daysLeft` dias para a data que a tela mostra ("Válida até"); o acesso vai 1 dia além.
const annual = (daysLeft, extra = {}) => ({
  name: 'Liga Anual', trialEndsAt: iso(NOW - 90 * DAY), plan: 'trial', subscriptionPlan: 'annual',
  subscriptionRenewsAt: iso(NOW + daysLeft * DAY), subscriptionActiveUntil: iso(NOW + (daysLeft + 1) * DAY), ...extra,
});
const monthly = (daysLeft, extra = {}) => ({ ...annual(daysLeft), name: 'Liga Mensal', subscriptionPlan: 'monthly', ...extra });
// Liga em teste grátis, sem plano: o teste acaba em `daysLeft` dias (negativo = acabou há tantos dias).
const trial = (daysLeft, extra = {}) => ({ name: 'Liga Teste', plan: 'trial', trialEndsAt: iso(NOW + daysLeft * DAY), ...extra });

const reset = () => {
  store.clear(); sent.length = 0; logs.length = 0; fetchMode = 'ok'; fetchCount = 0; updateShouldThrowFor = null;
  clock(NOW);
  store.set('users/a1', { email: 'a1@x.com', role: 'pending', leagues: { L: { role: 'admin' } } });
  store.set('users/a2', { email: 'a2@x.com', role: 'pending', leagues: { L: { role: 'admin' } } });
  store.set('users/p1', { email: 'p1@x.com', role: 'pending', leagues: { L: { role: 'player' } } });
  store.set('users/pend', { email: 'pend@x.com', role: 'pending', leagues: { L: { role: 'pending' } } });
  store.set('users/outro', { email: 'outro@x.com', role: 'pending', leagues: { B: { role: 'admin' } } });
};

(async () => {
  // ───────── a função agendada ─────────
  check('roda todo dia às 9h de São Paulo, na mesma região das outras funções, com a chave do Resend',
    scheduleOpts.some(o => o.schedule === '0 9 * * *' && o.timeZone === 'America/Sao_Paulo' && o.region === 'us-east1' && Array.isArray(o.secrets) && o.secrets.length === 1), scheduleOpts);

  // ───────── plano anual: lembretes ─────────
  reset();
  store.set('leagues/L', annual(20));
  let mails = await run();
  check('anual faltando 20 dias: manda o lembrete de 30 dias, um e-mail para cada admin', mails.length === 2 && mails.map(m => m.to).sort().join() === 'a1@x.com,a2@x.com', mails.map(m => m.to));
  check('…e só para admins da liga (jogador, pendente e admin de outra liga não recebem)', !mails.some(m => ['p1@x.com', 'pend@x.com', 'outro@x.com'].includes(m.to)));
  const m0 = mails[0];
  check('assunto traz o nome da liga e a data de vencimento', m0.subject === `A assinatura anual da liga "Liga Anual" vence em ${new Date(NOW + 20 * DAY).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, m0.subject);
  check('texto: diz quantos dias faltam, que não renova sozinha e como assinar de novo', /faltam 20 dias/.test(m0.text) && /não renova sozinha/.test(m0.text) && /💳 Assinatura/.test(m0.text), m0.text);
  check('texto: diz que a liga volta ao gratuito e que o histórico continua', /volta ao plano gratuito/.test(m0.text) && /histórico[^.]*continua guardado/.test(m0.text), m0.text);
  check('texto: manda usar "Estender plano" e diz que o pagamento soma 12 meses ao vencimento atual (ninguém perde dia pago)', /Estender plano/.test(m0.text) && /soma 12 meses à data de vencimento atual/.test(m0.text) && /nenhum dia já pago/.test(m0.text), m0.text);
  check('HTML: "Estender plano" sai em negrito', /<strong>Estender plano<\/strong>/.test(m0.html), m0.html);
  check('HTML e texto simples saem juntos, com o link do app', /<a href="https:\/\/peladanamao\.com\.br\/"/.test(m0.html) && m0.text.includes('https://peladanamao.com.br/'));
  check('remetente do Pelada na Mão, resposta para o contato e chave do Resend no cabeçalho', m0.body.from === 'Pelada na Mão <avisos@notificacoes.peladanamao.com.br>' && m0.body.reply_to === 'contato@peladanamao.com.br' && sent[0].headers.Authorization === 'Bearer fake-resend-key' && sent[0].url === 'https://api.resend.com/emails');
  check('anota o aviso na liga, amarrado ao ciclo', league('L').billingNotices?.annual30 === league('L').subscriptionActiveUntil, league('L'));
  check('os avisos não alteram o plano da liga', league('L').subscriptionPlan === 'annual' && league('L').subscriptionActiveUntil === annual(20).subscriptionActiveUntil);

  check('repetir logo depois não manda de novo', (await run()).length === 0);
  clock(NOW + 5 * DAY); // faltam 15
  check('faltando 15 dias (ainda dentro dos 30): não manda de novo', (await run()).length === 0);
  clock(NOW + 13 * DAY); // faltam 7
  mails = await run();
  check('faltando 7 dias: manda o lembrete final', mails.length === 2 && /faltam 7 dias/.test(mails[0].text), mails.map(m => m.text));
  check('…e anota o de 7 dias sem apagar o de 30', league('L').billingNotices?.annual7 === league('L').subscriptionActiveUntil && league('L').billingNotices?.annual30 === league('L').subscriptionActiveUntil);
  clock(NOW + 15 * DAY); // faltam 5
  check('depois do lembrete de 7 dias não manda mais nada até acabar', (await run()).length === 0);
  clock(NOW + 19 * DAY); // falta 1
  check('faltando 1 dia: nada novo (já avisou)', (await run()).length === 0);

  reset();
  store.set('leagues/L', annual(5));
  mails = await run();
  check('liga vista pela 1ª vez já faltando 5 dias: manda só o de 7 dias', mails.length === 2 && /faltam 5 dias/.test(mails[0].text) && league('L').billingNotices?.annual7 && !league('L').billingNotices?.annual30, league('L'));
  clock(NOW + 1 * DAY);
  check('…e o de 30 dias nunca vem depois', (await run()).length === 0);

  // Estender o plano muda o ciclo: os lembretes recomeçam para o vencimento novo.
  reset();
  store.set('leagues/L', annual(20));
  await run(); // lembrete de 30 dias do ciclo antigo
  const L1 = league('L');
  store.set('leagues/L', { ...L1, subscriptionRenewsAt: iso(Date.parse(L1.subscriptionRenewsAt) + 365 * DAY), subscriptionActiveUntil: iso(Date.parse(L1.subscriptionActiveUntil) + 365 * DAY) }); // pagou "Estender plano"
  clock(NOW + 360 * DAY); // faltam 25 dias para o vencimento novo
  mails = await run();
  check('plano estendido: o vencimento novo recebe os próprios lembretes (o aviso antigo era de outro ciclo)', mails.length === 2 && /faltam 25 dias/.test(mails[0].text) && league('L').billingNotices?.annual30 === league('L').subscriptionActiveUntil, mails.map(m => m.text));

  reset();
  store.set('leagues/L', annual(1));
  mails = await run();
  check('faltando 1 dia: usa o singular ("falta 1 dia")', mails.length === 2 && /falta 1 dia\)/.test(mails[0].text), mails.map(m => m.text));

  reset();
  store.set('leagues/L', annual(40));
  check('anual faltando 40 dias: nada', (await run()).length === 0 && !league('L').billingNotices);

  reset();
  store.set('leagues/L', { ...annual(0), subscriptionRenewsAt: iso(NOW - 2 * 3600000), subscriptionActiveUntil: iso(NOW + 22 * 3600000) });
  check('vence hoje, ainda dentro da tolerância de 1 dia: nada (o aviso de "venceu" vem depois)', (await run()).length === 0);

  // ───────── plano acabou: anual vencido ─────────
  reset();
  store.set('leagues/L', annual(-2, { subscriptionActiveUntil: iso(NOW - 1 * DAY) })); // venceu há 2 dias, o acesso acabou ontem
  mails = await run();
  check('anual vencido: avisa que venceu e que a liga voltou ao plano gratuito', mails.length === 2 && /Liga Anual/.test(mails[0].subject) && /venceu/.test(mails[0].subject) && /voltou ao plano gratuito/.test(mails[0].text) && /histórico[^.]*continua guardado/.test(mails[0].text), mails.map(m => m.subject));
  check('…e explica como voltar ao plano completo', /💳 Assinatura/.test(mails[0].text));
  check('anota o aviso de fim e não repete', league('L').billingNotices?.ended === league('L').subscriptionActiveUntil && (await run()).length === 0);

  reset();
  store.set('leagues/L', annual(-9, { subscriptionActiveUntil: iso(NOW - 8 * DAY) }));
  check('venceu há 8 dias (velho demais): não avisa — evita avisar de coisa antiga na 1ª execução', (await run()).length === 0 && !league('L').billingNotices);

  reset();
  store.set('leagues/L', annual(-2, { subscriptionActiveUntil: iso(NOW - 1 * DAY), trialEndsAt: iso(NOW + 3 * DAY) }));
  mails = await run();
  check('ainda no teste grátis: a liga segue completa, então não diz que voltou ao gratuito (só lembra de que o teste acaba)', mails.length === 2 && mails.every(m => /^O teste grátis da liga/.test(m.subject)) && !mails.some(m => /voltou ao plano gratuito/.test(m.text)), mails.map(m => m.subject));

  reset();
  store.set('leagues/L', annual(-2, { subscriptionActiveUntil: iso(NOW - 1 * DAY), trialEndsAt: undefined }));
  check('liga antiga sem data de teste: também avisa', (await run()).length === 2);

  // ───────── plano mensal: só avisa quando falha ─────────
  reset();
  store.set('leagues/L', monthly(10));
  check('mensal em dia: nada (renova sozinho)', (await run()).length === 0);

  reset();
  store.set('leagues/L', monthly(0, { subscriptionRenewsAt: iso(NOW - 3 * 3600000), subscriptionActiveUntil: iso(NOW + 21 * 3600000) }));
  check('mensal com a cobrança atrasada, dentro da tolerância: ainda nada', (await run()).length === 0);

  reset();
  store.set('leagues/L', monthly(-1, { subscriptionRenewsAt: iso(NOW - 2 * DAY), subscriptionActiveUntil: iso(NOW - 1 * DAY) }));
  mails = await run();
  check('mensal que não renovou: avisa a falha, com a data da cobrança prevista', mails.length === 2 && /Não conseguimos renovar a assinatura da liga "Liga Mensal"/.test(mails[0].subject) && mails[0].text.includes(new Date(NOW - 2 * DAY).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })), mails.map(m => m.subject));
  check('…explica as causas (cobrança recusada ou cancelamento) e que o Mercado Pago pode tentar de novo', /cobrança é recusada/.test(mails[0].text) && /cancelada no Mercado Pago/.test(mails[0].text) && /tentar cobrar de novo/.test(mails[0].text) && /volta ao plano pago sozinha/.test(mails[0].text), mails[0].text);
  check('…e como resolver agora', /forma de pagamento/.test(mails[0].text) && /💳 Assinatura/.test(mails[0].text));
  check('não repete o aviso de falha', (await run()).length === 0);

  // novo ciclo: reativou e falhou de novo mais tarde → avisa de novo
  const L = league('L');
  store.set('leagues/L', { ...L, subscriptionRenewsAt: iso(NOW + 25 * DAY), subscriptionActiveUntil: iso(NOW + 26 * DAY) }); // pagou de novo
  clock(NOW + 40 * DAY); // dias depois, o acesso acabou outra vez (acabou há 14 dias — velho)
  check('o ciclo novo não herda o aviso antigo: ciclo velho demais continua sem aviso', (await run()).length === 0);
  clock(NOW + 26 * DAY + 3600000); // 1h depois do novo fim
  mails = await run();
  check('…mas logo depois do fim do ciclo novo avisa de novo (o aviso antigo era de outro ciclo)', mails.length === 2 && league('L').billingNotices?.ended === league('L').subscriptionActiveUntil, league('L'));

  // Cancelou a assinatura mensal de propósito (pelo app): o plano acabou como combinado, não é falha.
  reset();
  store.set('leagues/L', monthly(-1, { subscriptionRenewsAt: iso(NOW - 2 * DAY), subscriptionActiveUntil: iso(NOW - 1 * DAY), subscriptionCancelledAt: iso(NOW - 20 * DAY) }));
  check('mensal cancelada de propósito: ao acabar não manda "não conseguimos renovar"', (await run()).length === 0 && !league('L').billingNotices, league('L'));

  // ───────── teste grátis: lembrete e aviso de que acabou ─────────
  const dia = ms => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  reset();
  store.set('leagues/L', trial(2));
  mails = await run();
  check('teste acabando em 2 dias: lembrete para cada admin da liga (e só para eles)', mails.length === 2 && mails.map(m => m.to).sort().join() === 'a1@x.com,a2@x.com', mails.map(m => m.to));
  check('assunto traz o nome da liga e a data em que o teste acaba', mails[0].subject === `O teste grátis da liga "Liga Teste" acaba em ${dia(NOW + 2 * DAY)}`, mails[0].subject);
  check('texto: quantos dias faltam', /faltam 2 dias/.test(mails[0].text), mails[0].text);
  check('texto: preço dos dois planos e a economia do anual', /R\$ 29,90 por mês/.test(mails[0].text) && /R\$ 238,80 por ano/.test(mails[0].text) && /equivale a R\$ 19,90 por mês/.test(mails[0].text) && /economia de R\$ 120,00 por ano/.test(mails[0].text), mails[0].text);
  check('texto: como assinar e que o mensal se cancela pelo próprio app, sem fidelidade', /💳 Assinatura/.test(mails[0].text) && /sem fidelidade/.test(mails[0].text) && /cancelar pelo próprio aplicativo/.test(mails[0].text));
  check('texto: o que continua e o que fica pausado no plano gratuito', /criar campeonatos, convocar, sortear os times e registrar o placar/.test(mails[0].text) && /Ficam pausados o registro de quem fez os gols, o ranking e as conquistas novas/.test(mails[0].text), mails[0].text);
  check('texto: avisa que o que se faz no plano gratuito só passa a contar quando a liga assinar (aí é recuperado) e que os gols não voltam', /só passam a contar para títulos, ranking e conquistas quando a liga assinar: aí eles são recuperados/.test(mails[0].text) && /os gols deles não foram registrados e não voltam/.test(mails[0].text) && !/nem depois, se a liga assinar/.test(mails[0].text), mails[0].text);
  check('HTML: negrito nos preços e botão para abrir o app', /<strong>R\$ 29,90 por mês<\/strong>/.test(mails[0].html) && /<a href="https:\/\/peladanamao\.com\.br\/"/.test(mails[0].html));
  check('anota o aviso amarrado à data do teste e não repete', league('L').billingNotices?.trialSoon === league('L').trialEndsAt && (await run()).length === 0);
  clock(NOW + 1.5 * DAY);
  check('mais tarde, ainda antes do fim (falta menos de 1 dia): não manda de novo', (await run()).length === 0);

  reset();
  store.set('leagues/L', trial(1));
  mails = await run();
  check('faltando 1 dia: usa o singular ("falta 1 dia")', mails.length === 2 && /falta 1 dia\)/.test(mails[0].text), mails.map(m => m.text));

  reset();
  store.set('leagues/L', trial(3));
  check('teste acabando em exatamente 3 dias: já avisa', (await run()).length === 2);

  reset();
  store.set('leagues/L', trial(4));
  check('teste acabando em 4 dias: ainda é cedo, nada', (await run()).length === 0 && !league('L').billingNotices);

  reset();
  store.set('leagues/L', trial(-2));
  mails = await run();
  check('teste que acabou há 2 dias, sem plano: avisa que a liga está no plano gratuito', mails.length === 2 && mails[0].subject === 'O teste grátis da liga "Liga Teste" acabou' && /acabou em/.test(mails[0].text) && /agora está no plano gratuito/.test(mails[0].text), mails.map(m => m.subject));
  check('…explica o que continua, o que pausa e os preços', /No plano gratuito a liga continua funcionando/.test(mails[0].text) && /Ficam pausados/.test(mails[0].text) && /R\$ 29,90 por mês/.test(mails[0].text) && /R\$ 238,80 por ano/.test(mails[0].text), mails[0].text);
  check('…anota e não repete', league('L').billingNotices?.trialEnded === league('L').trialEndsAt && (await run()).length === 0);

  reset();
  store.set('leagues/L', trial(-8));
  check('teste que acabou há 8 dias (velho demais): não avisa', (await run()).length === 0 && !league('L').billingNotices);

  reset();
  store.set('leagues/L', trial(-30));
  check('liga antiga, teste acabou há 30 dias: nada (não avisa de coisa velha)', (await run()).length === 0);

  reset();
  store.set('leagues/L', trial(2, { trialEndsAt: undefined }));
  check('liga antiga sem data de teste: nunca recebe aviso de teste', (await run()).length === 0);

  reset();
  store.set('leagues/L', trial(2, { subscriptionPlan: 'monthly', subscriptionRenewsAt: iso(NOW + 25 * DAY), subscriptionActiveUntil: iso(NOW + 26 * DAY) }));
  check('já assinou durante o teste (plano em vigor): não manda aviso de teste', (await run()).length === 0);

  reset();
  store.set('leagues/L', trial(-2, { subscriptionPlan: 'annual', subscriptionRenewsAt: iso(NOW + 300 * DAY), subscriptionActiveUntil: iso(NOW + 301 * DAY) }));
  check('teste acabou, mas a liga tem plano pago em vigor: nada', (await run()).length === 0);

  reset();
  store.set('leagues/L', trial(2, { name: '<b>Liga & "Teste"</b>' }));
  mails = await run();
  check('nome da liga com HTML é escapado também nos avisos do teste', mails.length === 2 && !/<b>Liga/.test(mails[0].html) && /&lt;b&gt;Liga &amp; &quot;Teste&quot;&lt;\/b&gt;/.test(mails[0].html), mails[0].html.slice(0, 400));

  reset();
  store.set('leagues/L', trial(2));
  fetchMode = 'fail';
  mails = await run();
  check('Resend recusa tudo: o aviso do teste não é anotado (tenta de novo amanhã)', mails.length === 0 && !league('L').billingNotices, league('L'));
  fetchMode = 'ok';
  mails = await run();
  check('…e no dia seguinte, com o Resend de volta, o aviso sai', mails.length === 2 && league('L').billingNotices?.trialSoon === league('L').trialEndsAt);

  reset();
  store.set('leagues/L', trial(2));
  store.set('leagues/L2', trial(-3, { name: 'Outra Liga' }));
  store.set('users/a3', { email: 'a3@x.com', role: 'pending', leagues: { L2: { role: 'admin' } } });
  mails = await run();
  check('duas ligas em situações diferentes: cada uma avisa só os próprios admins', mails.length === 3 && mails.filter(m => m.subject.includes('Liga Teste')).length === 2 && mails.filter(m => m.subject.includes('Outra Liga')).map(m => m.to).join() === 'a3@x.com', mails.map(m => m.to + ' ' + m.subject));
  check('o log de conclusão traz as contagens das ligas em teste, sem e-mails', logs.some(l => l.m === 'notifyBillingEmails concluída' && l.d.ligasEmTeste === 2 && l.d.avisosEnviados === 2) && !JSON.stringify(logs).includes('@x.com'), logs.filter(l => /concluída/.test(l.m)));

  // ───────── quem recebe ─────────
  reset();
  store.set('leagues/L', annual(20));
  store.set('users/a2', { email: 'a1@x.com', role: 'pending', leagues: { L: { role: 'admin' } } }); // mesmo e-mail em duas contas
  store.set('users/semEmail', { role: 'pending', leagues: { L: { role: 'admin' } } });
  mails = await run();
  check('e-mail repetido entre contas recebe uma vez; conta sem e-mail é ignorada', mails.length === 1 && mails[0].to === 'a1@x.com', mails.map(m => m.to));

  reset();
  store.set('leagues/L', annual(20));
  for (const u of ['a1', 'a2']) store.delete('users/' + u);
  mails = await run();
  check('liga sem admin com e-mail: não envia, não anota e não quebra', mails.length === 0 && !league('L').billingNotices && logs.some(l => l.level === 'warn' && /sem nenhum admin/.test(l.m)), logs);

  reset();
  store.set('leagues/L', annual(20));
  store.set('leagues/Mensal', monthly(-1, { subscriptionRenewsAt: iso(NOW - 2 * DAY), subscriptionActiveUntil: iso(NOW - 1 * DAY) }));
  store.set('users/m1', { email: 'm1@x.com', role: 'pending', leagues: { Mensal: { role: 'admin' } } });
  mails = await run();
  check('cada liga avisa só os próprios admins (duas ligas, dois grupos de destinatários)', mails.filter(m => /Anual/.test(m.subject)).length === 2 && mails.filter(m => /Mensal/.test(m.subject)).map(m => m.to).join() === 'm1@x.com', mails.map(m => [m.to, m.subject]));

  // ───────── o que não deve ser avisado ─────────
  reset();
  store.set('leagues/L', { name: 'Sem plano', trialEndsAt: iso(NOW - 30 * DAY) });
  store.set('leagues/X', { ...annual(20), subscriptionPlan: 'quinzenal' });
  store.set('leagues/Y', { ...annual(20), subscriptionActiveUntil: 'não é data' });
  store.set('leagues/Z', { name: 'Sem validade', subscriptionPlan: 'annual' });
  check('ligas sem plano pago, com plano desconhecido ou com datas inválidas são ignoradas sem erro', (await run()).length === 0 && !logs.some(l => l.level === 'error'));

  // ───────── falhas de envio ─────────
  reset();
  store.set('leagues/L', annual(20));
  fetchMode = 'fail';
  mails = await run();
  check('Resend recusa tudo: não anota o aviso (tenta de novo amanhã)', mails.length === 0 && !league('L').billingNotices && logs.some(l => l.level === 'warn' && /Resend não confirmou/.test(l.m)), logs);
  fetchMode = 'ok';
  clock(NOW + 1 * DAY);
  check('…e no dia seguinte, com o Resend de volta, o aviso sai', (await run()).length === 2 && !!league('L').billingNotices);

  reset();
  store.set('leagues/L', annual(20));
  fetchMode = 'throw';
  check('sem rede: não quebra a função, não anota', (await run()).length === 0 && !league('L').billingNotices && logs.some(l => l.level === 'warn' && /Falha ao chamar a API do Resend/.test(l.m)));

  reset();
  store.set('leagues/L', annual(20));
  fetchMode = 'failFirst';
  mails = await run();
  check('falhou para um admin e saiu para o outro: anota (não fica reenviando todo dia)', mails.length === 1 && !!league('L').billingNotices, mails.length);

  reset();
  store.set('leagues/A', annual(20));
  store.set('leagues/B', annual(20, { name: 'Liga B' }));
  store.set('users/aa', { email: 'aa@x.com', role: 'pending', leagues: { A: { role: 'admin' } } });
  store.set('users/b1', { email: 'b1@x.com', role: 'pending', leagues: { B: { role: 'admin' } } });
  updateShouldThrowFor = 'leagues/A';
  mails = await run();
  check('erro ao gravar numa liga não impede as outras', mails.some(m => m.to === 'b1@x.com') && league('B').billingNotices && logs.some(l => l.level === 'error' && l.d.liga === 'A'), logs);

  // ───────── conteúdo seguro e correto ─────────
  reset();
  store.set('leagues/L', annual(20, { name: '<img src=x onerror=alert(1)> & "Cia" **negrito**' }));
  mails = await run();
  check('nome da liga com HTML é escapado no e-mail (nenhuma marcação nova)', !/<img/i.test(mails[0].html) && /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Cia&quot;/.test(mails[0].html), mails[0].html.slice(0, 400));
  check('…e asteriscos do nome não viram negrito', /\*\*negrito\*\*/.test(mails[0].html) && !/<strong>negrito<\/strong>/.test(mails[0].html));
  check('…no texto simples o nome aparece como foi escrito', mails[0].text.includes('<img src=x onerror=alert(1)> & "Cia" **negrito**'));

  reset();
  store.set('leagues/L', annual(20, { subscriptionRenewsAt: '2027-03-01T02:00:00.000Z', subscriptionActiveUntil: '2027-03-02T02:00:00.000Z' }));
  clock(Date.parse('2027-02-10T12:00:00.000Z')); // faltam ~18 dias
  mails = await run();
  check('a data mostrada é a de São Paulo (01/03 02:00 UTC = 28/02 à noite)', mails.length === 2 && /28\/02\/2027/.test(mails[0].subject) && /28\/02\/2027/.test(mails[0].text), mails[0] && mails[0].subject);

  reset();
  store.set('leagues/L', annual(20));
  await run();
  const done = logs.find(l => l.level === 'info' && l.m === 'notifyBillingEmails concluída');
  check('o log de conclusão só traz contagens, nunca e-mails', done && done.d.ligasComPlano === 1 && done.d.avisosEnviados === 1 && !/@/.test(JSON.stringify(logs)), logs);

  Date.now = realNow;
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { Date.now = realNow; console.error('ERRO NO TESTE', e); process.exit(1); });
