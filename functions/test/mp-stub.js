// Mercado Pago simulado para os testes nos emuladores (test/emulator-test.js).
//
// É carregado nos processos do emulador por NODE_OPTIONS=--require (ver run-emulators.js) e
// intercepta o fetch do SDK do Mercado Pago, que sempre fala com https://api.mercadopago.com.
// Qualquer outro endereço passa direto. Sem a variável MP_STUB_FILE não faz nada.
//
// O estado fica num arquivo JSON (MP_STUB_FILE), porque a função roda num processo e o teste em
// outro: { preapprovals: [{ id, external_reference, status }], updates: [{ id, body }] }.
//  - GET  /preapproval/search  → devolve TODAS as assinaturas, sem filtrar pela referência (o
//                                servidor tem de conferir sozinho antes de cancelar qualquer uma);
//  - PUT  /preapproval/{id}    → muda o status e registra a chamada em "updates".
'use strict';
const fs = require('fs');

const FILE = process.env.MP_STUB_FILE;
const realFetch = globalThis.fetch;

if (FILE && realFetch) {
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { preapprovals: [], updates: [] }; } };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : (input.url || String(input)));
    if (url.hostname !== 'api.mercadopago.com') return realFetch(input, init);

    const method = String(init.method || 'GET').toUpperCase();
    const state = load();

    if (method === 'GET' && url.pathname === '/preapproval/search') {
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 30);
      return reply(200, { results: state.preapprovals.slice(offset, offset + limit), paging: { total: state.preapprovals.length, offset, limit } });
    }

    const one = url.pathname.match(/^\/preapproval\/([^/]+)$/);
    if (method === 'PUT' && one) {
      const found = state.preapprovals.find(p => p.id === decodeURIComponent(one[1]));
      if (!found) return reply(404, { message: 'assinatura não encontrada (simulado)' });
      const body = JSON.parse(init.body || '{}');
      if (body.status) found.status = body.status;
      state.updates = [...(state.updates || []), { id: found.id, body }];
      fs.writeFileSync(FILE, JSON.stringify(state));
      return reply(200, found);
    }

    return reply(404, { message: `Mercado Pago simulado: rota não prevista (${method} ${url.pathname})` });
  };
}
