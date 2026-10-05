// Mercado Pago simulado para os testes nos emuladores (test/emulator-test.js).
//
// É carregado nos processos do emulador por NODE_OPTIONS=--require (ver run-emulators.js) e
// intercepta o fetch do SDK do Mercado Pago, que sempre fala com https://api.mercadopago.com.
// Qualquer outro endereço passa direto. Sem a variável MP_STUB_FILE não faz nada.
//
// O estado fica num arquivo JSON (MP_STUB_FILE), porque a função roda num processo e o teste em
// outro:
//   preapprovals: [{ id, external_reference, status, next_payment_date? }]   assinaturas mensais "existentes"
//   payments:     [{ id, external_reference, status, transaction_amount, date_approved, ... }]
//   updates:      [{ id, body }]     cancelamentos (PUT) que a função fez
//   created:      [body]             assinaturas criadas (POST /preapproval)
//   preferences:  [body]             cobranças anuais criadas (POST /checkout/preferences)
//
// Rotas:
//  - GET  /preapproval/search    → devolve as assinaturas, filtradas por "status" quando informado (como a API
//                                  de verdade) mas NUNCA pela referência: o servidor tem de conferir
//                                  sozinho antes de cancelar qualquer uma;
//  - GET  /preapproval/{id}      → uma assinatura;
//  - PUT  /preapproval/{id}      → muda o status e registra a chamada em "updates";
//  - POST /preapproval           → cria (registra em "created") e devolve o link de pagamento;
//  - POST /checkout/preferences  → registra em "preferences" e devolve o link de pagamento;
//  - GET  /v1/payments/search    → pagamentos, filtrados por external_reference e status;
//  - GET  /v1/payments/{id}      → um pagamento.
'use strict';
const fs = require('fs');

const FILE = process.env.MP_STUB_FILE;
const realFetch = globalThis.fetch;

if (FILE && realFetch) {
  const load = () => {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* arquivo ainda não existe */ }
    return { preapprovals: [], payments: [], updates: [], created: [], preferences: [], ...s };
  };
  const save = state => fs.writeFileSync(FILE, JSON.stringify(state));
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const page = (url, all) => {
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 30);
    return { results: all.slice(offset, offset + limit), paging: { total: all.length, offset, limit } };
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : (input.url || String(input)));
    if (url.hostname !== 'api.mercadopago.com') return realFetch(input, init);

    const method = String(init.method || 'GET').toUpperCase();
    const state = load();
    const body = () => JSON.parse(init.body || '{}');
    // O SDK chama algumas rotas com uma barra no fim ("/preapproval/", "/checkout/preferences/").
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'GET' && url.pathname === '/preapproval/search') {
      const wanted = url.searchParams.get('status');
      return reply(200, page(url, state.preapprovals.filter(p => !wanted || p.status === wanted)));
    }

    const one = url.pathname.match(/^\/preapproval\/([^/]+)$/);
    if (method === 'GET' && one) {
      const found = state.preapprovals.find(p => p.id === decodeURIComponent(one[1]));
      return found ? reply(200, found) : reply(404, { message: 'assinatura não encontrada (simulado)' });
    }
    if (method === 'PUT' && one) {
      const found = state.preapprovals.find(p => p.id === decodeURIComponent(one[1]));
      if (!found) return reply(404, { message: 'assinatura não encontrada (simulado)' });
      const b = body();
      if (b.status) found.status = b.status;
      state.updates.push({ id: found.id, body: b });
      save(state);
      return reply(200, found);
    }
    if (method === 'POST' && url.pathname === '/preapproval') {
      state.created.push(body());
      save(state);
      return reply(201, { id: `pre-novo-${state.created.length}`, status: 'pending', init_point: `https://mp.test/preapproval/${state.created.length}` });
    }
    if (method === 'POST' && url.pathname === '/checkout/preferences') {
      state.preferences.push(body());
      save(state);
      return reply(201, { id: `pref-${state.preferences.length}`, init_point: `https://mp.test/pref/${state.preferences.length}` });
    }

    if (method === 'GET' && url.pathname === '/v1/payments/search') {
      const ref = url.searchParams.get('external_reference');
      const wanted = url.searchParams.get('status');
      return reply(200, page(url, state.payments.filter(p => (!ref || p.external_reference === ref) && (!wanted || p.status === wanted))));
    }
    const pay = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (method === 'GET' && pay) {
      const found = state.payments.find(p => String(p.id) === decodeURIComponent(pay[1]));
      return found ? reply(200, found) : reply(404, { message: 'pagamento não encontrado (simulado)' });
    }

    return reply(404, { message: `Mercado Pago simulado: rota não prevista (${method} ${url.pathname})` });
  };
}
