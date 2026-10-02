// Testa o código de pagamento do app (index.html) isolado: extrai as funções reais do arquivo
// e as executa num ambiente simulado, sem navegador.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const payCode = slice('const PAY_PENDING_KEY', 'let _payCheckAt');
const modalCode = slice('function mSubscription()', 'async function startSubscription');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const DAY = 86400000;

// ── confirmação automática do pagamento ─────────────────────────────────────────────────
function makeEnv({ storageThrows = false, leagues = { L: { role: 'admin' } } } = {}) {
  const calls = { callFn: [], toast: [], remember: [], render: 0, waits: 0 };
  const store = {};
  const env = {
    st: { userDoc: { leagues }, availableLeagues: [{ id: 'L', role: 'admin', name: 'Liga L' }], leagueId: 'L' },
    localStorage: storageThrows
      ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); }, removeItem() { throw new Error('indisponível'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    render: () => { calls.render++; },
    toast: (m, t) => calls.toast.push({ m, t }),
    rememberLeague: async (...a) => { calls.remember.push(a); },
    callFn: async (name, data) => { calls.callFn.push({ name, data }); return env.respond(name, data, calls.callFn.length); },
    setTimeout: fn => { calls.waits++; fn(); },
    respond: () => ({ status: 'pending' }),
  };
  const names = ['st', 'localStorage', 'render', 'toast', 'rememberLeague', 'callFn', 'setTimeout'];
  const api = new Function(...names, payCode + '\nreturn { markPaymentPending, readPaymentPending, clearPaymentPending, confirmPendingPayment };')(...names.map(n => env[n]));
  return { api, env, calls, store };
}

(async () => {
  let t = makeEnv();
  check('sem pagamento pendente: nada a fazer, não consulta o servidor', await t.api.confirmPendingPayment(3) === false && t.calls.callFn.length === 0);

  // Pendência de uma liga da qual a pessoa não faz parte (outra conta no mesmo navegador)
  t = makeEnv({ leagues: { OUTRA: { role: 'admin' } } });
  t.api.markPaymentPending('L');
  check('pendência de liga que não é da pessoa: descartada sem consultar', await t.api.confirmPendingPayment(3) === false && t.calls.callFn.length === 0 && !t.api.readPaymentPending());

  // Caminho normal: confirma na primeira tentativa
  t = makeEnv();
  t.api.markPaymentPending('L');
  t.env.respond = () => ({ status: 'active', plan: 'monthly' });
  let ok = await t.api.confirmPendingPayment(8, 4000, true);
  check('confirma sozinho (sem nenhum clique) e devolve true', ok === true);
  check('consulta o servidor para a liga certa', t.calls.callFn.length === 1 && t.calls.callFn[0].name === 'checkSubscriptionStatus' && t.calls.callFn[0].data.liga === 'L');
  check('limpa a pendência depois de confirmar', !t.api.readPaymentPending());
  check('atualiza os dados da liga no app', t.calls.remember.length === 1 && t.calls.remember[0][0] === 'L' && t.calls.remember[0][1] === 'admin');
  check('avisa o sucesso em tom positivo ("ok"), não como erro', t.calls.toast.length === 1 && t.calls.toast[0].t === 'ok' && /confirmada/i.test(t.calls.toast[0].m));
  check('não fica esperando à toa quando já confirmou', t.calls.waits === 0);
  check('redesenha ao começar e ao terminar (modal mostra "confirmando" e depois o resultado)', t.calls.render === 2 && !t.env.st._payChecking);

  // A assinatura demora a constar no Mercado Pago: insiste até aparecer
  t = makeEnv();
  t.api.markPaymentPending('L');
  t.env.respond = (n, d, i) => (i >= 3 ? { status: 'active' } : { status: 'pending' });
  ok = await t.api.confirmPendingPayment(8, 4000, true);
  check('insiste até aparecer (3ª tentativa)', ok === true && t.calls.callFn.length === 3 && t.calls.waits === 2);

  // Nunca confirma: não desiste para sempre, fica pendente para a próxima vez
  t = makeEnv();
  t.api.markPaymentPending('L');
  ok = await t.api.confirmPendingPayment(4, 4000, true);
  check('esgotadas as tentativas devolve false', ok === false && t.calls.callFn.length === 4);
  check('ao voltar do checkout avisa que está em confirmação (sem alarme)', t.calls.toast.length === 1 && t.calls.toast[0].t === 'ok' && /confirma/i.test(t.calls.toast[0].m));
  check('continua pendente para tentar de novo depois', !!t.api.readPaymentPending());
  check('não deixa a tela presa em "confirmando"', t.env.st._payChecking === false);
  t.calls.toast.length = 0;
  await t.api.confirmPendingPayment(1, 4000, false);
  check('tentativa silenciosa (ao voltar à aba) não mostra aviso nenhum', t.calls.toast.length === 0);

  // Erros
  t = makeEnv();
  t.api.markPaymentPending('L');
  t.env.respond = () => { const e = new Error('sem permissão'); e.code = 'permission-denied'; throw e; };
  ok = await t.api.confirmPendingPayment(8);
  check('sem permissão (não é mais admin): desiste e limpa, sem insistir', ok === false && t.calls.callFn.length === 1 && !t.api.readPaymentPending());
  check('mesmo assim não deixa a tela presa', t.env.st._payChecking === false);

  t = makeEnv();
  t.api.markPaymentPending('L');
  t.env.respond = (n, d, i) => { if (i < 3) throw new Error('rede caiu'); return { status: 'active' }; };
  ok = await t.api.confirmPendingPayment(8);
  check('falha de rede passageira: tenta de novo e confirma', ok === true && t.calls.callFn.length === 3);

  // Duas chamadas ao mesmo tempo (ex.: abrir o app e voltar à aba juntos) não duplicam a consulta
  t = makeEnv();
  t.api.markPaymentPending('L');
  const releases = [];
  t.env.respond = () => new Promise(r => { releases.push(() => r({ status: 'active' })); });
  const first = t.api.confirmPendingPayment(8);
  let secondResult = 'ainda esperando';
  const secondP = t.api.confirmPendingPayment(8).then(v => { secondResult = v; });
  await new Promise(r => setImmediate(r)); // deixa a segunda chamada andar o quanto puder
  check('segunda chamada enquanto a primeira confirma é ignorada (não duplica a consulta)', secondResult === false && t.calls.callFn.length === 1, { secondResult, consultas: t.calls.callFn.length });
  releases.forEach(r => r());
  check('a primeira conclui normalmente', await first === true);
  await secondP;

  // Pendência antiga (mais de 48 h) é descartada
  t = makeEnv();
  t.store.aceoma_pay_pending = JSON.stringify({ liga: 'L', at: Date.now() - 49 * 3600000 });
  check('pendência de mais de 48 h é descartada', !t.api.readPaymentPending() && !('aceoma_pay_pending' in t.store));
  t.store.aceoma_pay_pending = JSON.stringify({ liga: 'L', at: Date.now() - 47 * 3600000 });
  check('pendência de 47 h ainda vale', !!t.api.readPaymentPending());
  t.store.aceoma_pay_pending = '{quebrado';
  check('conteúdo corrompido não derruba o app', t.api.readPaymentPending() === null);

  // Navegador sem localStorage (modo privado/bloqueado): nada quebra
  t = makeEnv({ storageThrows: true });
  let threw = false;
  try { t.api.markPaymentPending('L'); t.api.clearPaymentPending(); await t.api.confirmPendingPayment(2); } catch (e) { threw = true; }
  check('sem localStorage: não lança erro', !threw && t.api.readPaymentPending() === null);

  // ── o que a tela de assinatura mostra em cada estado ────────────────────────────────────
  function modal({ league, checking = false }) {
    const st = { modal: { type: 'subscription' }, leagueId: 'L', availableLeagues: [{ id: 'L', ...league }], _payChecking: checking };
    return new Function('st', modalCode + '\nreturn mSubscription();')(st);
  }
  const iso = ms => new Date(ms).toISOString();
  const noon = ms => { const d = new Date(ms); d.setUTCHours(12, 0, 0, 0); return d.getTime(); };
  const fmt = ms => new Date(ms).toLocaleDateString('pt-BR');
  const renews = noon(Date.now() + 30 * DAY);
  const until = renews + DAY; // margem técnica: nunca deve aparecer na tela

  let h = modal({ league: { trialEndsAt: iso(Date.now() + 10 * DAY) }, checking: true });
  check('confirmando: mostra "Confirmando seu pagamento" e que não precisa fazer nada', /Confirmando seu pagamento/.test(h) && /não precisa fazer nada/i.test(h));
  check('confirmando: some a escolha de plano (evita pagar duas vezes)', !/startSubscription\(/.test(h) && !/Mensal —/.test(h));
  check('nenhum botão para "verificar" — a confirmação é automática', !/Verificar|Já pagou|checkSubscriptionNow/.test(h));

  h = modal({ league: { trialEndsAt: iso(Date.now() + 10 * DAY) } });
  check('em teste: mostra o período de teste e os dois planos', /Período de teste/.test(h) && /startSubscription\('monthly'\)/.test(h) && /startSubscription\('annual'\)/.test(h));
  check('em teste: também sem botão manual de verificação', !/Verificar|Já pagou|checkSubscriptionNow/.test(h));

  h = modal({ league: { subscriptionPlan: 'monthly', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) } });
  check('mensal ativa: mostra a data real da próxima cobrança', h.includes('Próxima cobrança em ' + fmt(renews)));
  check('mensal ativa: NÃO mostra a data com a margem técnica (1 mês é 1 mês)', fmt(until) === fmt(renews) || !h.includes(fmt(until)));

  h = modal({ league: { subscriptionPlan: 'annual', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) } });
  check('anual ativa: "Válida até" a data real', /anual/.test(h) && h.includes('Válida até ' + fmt(renews)));

  h = modal({ league: { subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(until) } });
  check('liga ativada antes do campo novo existir: não quebra, usa a data de validade', h.includes('Próxima cobrança em ' + fmt(until)));

  h = modal({ league: { subscriptionPlan: 'monthly', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) }, checking: true });
  check('renovação em andamento com assinatura já ativa: continua mostrando a assinatura', /Assinatura <strong>mensal<\/strong> ativa/.test(h) && !/Confirmando/.test(h));

  h = modal({ league: { trialEndsAt: iso(Date.now() - DAY) } });
  check('sem teste nem assinatura: mostra o plano gratuito', /Plano gratuito/.test(h));

  completed = true;
  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})();

// Um teste que fica esperando uma promessa que nunca resolve faz o Node sair em silêncio:
// sem isto, esse tipo de falha passaria despercebido.
let completed = false;
process.on('exit', () => {
  if (!completed) { console.log('FAIL o teste não chegou ao fim (alguma etapa ficou esperando para sempre)'); process.exitCode = 1; }
});
