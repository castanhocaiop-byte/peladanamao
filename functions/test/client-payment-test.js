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
const modalCode = slice('function addMonthsISO', 'async function startSubscription');
const startCode = slice('async function startSubscription', '// Cancelar a assinatura mensal sem sair do app');
const cancelCode = slice('function askCancelSubscription', '// Confirmação automática do pagamento.');

// A conta de "somar meses" existe no app (previsão na tela) e no servidor (a que vale): têm de dar o mesmo.
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const sa = serverSrc.indexOf('function addMonths(iso, months)');
const addMonthsServer = new Function(serverSrc.slice(sa, serverSrc.indexOf('\n}', sa) + 2) + '\nreturn addMonths;')();
const addMonthsClient = new Function(slice('function addMonthsISO', 'function mSubscription()') + '\nreturn addMonthsISO;')();

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

  // ── Estender plano: quem já tem plano continua "ativo", só o vencimento novo prova o pagamento ──
  t = makeEnv();
  t.api.markPaymentPending('L', '2027-03-01T00:00:00.000Z');
  t.env.respond = (n, d, i) => ({ status: 'active', plan: 'annual', renewsAt: i >= 3 ? '2028-03-01T00:00:00.000Z' : '2027-03-01T00:00:00.000Z' });
  ok = await t.api.confirmPendingPayment(8, 4000, true);
  check('estender: com o plano de antes ainda "ativo", só confirma quando o vencimento muda (3ª tentativa)', ok === true && t.calls.callFn.length === 3 && t.calls.waits === 2, { ok, consultas: t.calls.callFn.length });
  check('estender: avisa "Plano estendido até" com a data nova', t.calls.toast.length === 1 && t.calls.toast[0].t === 'ok' && t.calls.toast[0].m === 'Plano estendido até ' + new Date('2028-03-01T00:00:00.000Z').toLocaleDateString('pt-BR') + '! 🎉', t.calls.toast);
  check('estender: limpa a pendência e atualiza os dados da liga', !t.api.readPaymentPending() && t.calls.remember.length === 1);

  t = makeEnv();
  t.api.markPaymentPending('L', '2027-03-01T00:00:00.000Z');
  t.env.respond = () => ({ status: 'active', plan: 'annual', renewsAt: '2027-03-01T00:00:00.000Z' }); // o pagamento novo ainda não entrou
  ok = await t.api.confirmPendingPayment(3, 4000, true);
  check('estender: vencimento igual ao de antes = pagamento ainda não entrou — não confirma, insiste e continua pendente', ok === false && t.calls.callFn.length === 3 && !!t.api.readPaymentPending(), { ok, consultas: t.calls.callFn.length });
  check('estender: …e ao voltar do checkout avisa que está em confirmação (sem "estendido")', t.calls.toast.length === 1 && /em confirma/i.test(t.calls.toast[0].m), t.calls.toast);

  t = makeEnv();
  t.api.markPaymentPending('L', null); // sem plano antes: qualquer vencimento prova que entrou
  t.env.respond = () => ({ status: 'active', plan: 'monthly', renewsAt: '2027-01-15T00:00:00.000Z' });
  ok = await t.api.confirmPendingPayment(8, 4000, true);
  check('primeira assinatura (sem plano antes): confirma na hora e diz "Assinatura confirmada"', ok === true && t.calls.callFn.length === 1 && /Assinatura confirmada/.test(t.calls.toast[0].m), t.calls.toast);

  t = makeEnv();
  t.api.markPaymentPending('L', '2027-03-01T00:00:00.000Z');
  t.api.markPaymentPending('L'); // volta do checkout (?mpReturn): não sabe mais a data de antes
  check('ao voltar do checkout, a data de antes guardada na saída é mantida', t.api.readPaymentPending()?.before === '2027-03-01T00:00:00.000Z', t.api.readPaymentPending());
  t.api.markPaymentPending('OUTRA');
  check('…mas não vale para outra liga', t.api.readPaymentPending()?.liga === 'OUTRA' && !('before' in t.api.readPaymentPending()), t.api.readPaymentPending());
  t.api.markPaymentPending('L', null);
  check('"sem plano antes" (null) é guardado e é diferente de "não sei" (ausente)', t.api.readPaymentPending()?.before === null && 'before' in t.api.readPaymentPending());

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
  function modal({ league, checking = false, cancelAsk = false, busy = false }) {
    const st = { modal: { type: 'subscription', ...(cancelAsk ? { cancelAsk: true } : {}) }, leagueId: 'L', availableLeagues: [{ id: 'L', ...league }], _payChecking: checking, _subBusy: busy };
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
  check('antes de pagar: avisa que dá para desistir em 7 dias (e como pedir), que depois não há reembolso, e linka a cláusula de planos dos Termos de Uso', /Você pode desistir em até 7 dias depois de pagar e receber o valor de volta \(escreva para contato@peladanamao\.com\.br\); depois disso, não há reembolso\./.test(h) && /href="\/termos\.html#c10"/.test(h));
  check('durante a confirmação do pagamento o aviso não aparece (a escolha já foi feita)', !/desistir em até 7 dias/.test(modal({ league: { trialEndsAt: iso(Date.now() + 10 * DAY) }, checking: true })));

  h = modal({ league: { subscriptionPlan: 'monthly', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) } });
  check('mensal ativa: mostra a data real da próxima cobrança', h.includes('Próxima cobrança em ' + fmt(renews)));
  check('mensal ativa: NÃO mostra a data com a margem técnica (1 mês é 1 mês)', fmt(until) === fmt(renews) || !h.includes(fmt(until)));

  h = modal({ league: { subscriptionPlan: 'annual', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) } });
  check('anual ativa: "Válida até" a data real', /anual/.test(h) && h.includes('Válida até ' + fmt(renews)));

  h = modal({ league: { subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(until) } });
  check('liga ativada antes do campo novo existir: não quebra, usa a data de validade', h.includes('Próxima cobrança em ' + fmt(until)));

  h = modal({ league: { trialEndsAt: iso(Date.now() - DAY) } });
  check('sem teste nem assinatura: mostra o plano gratuito', /Plano gratuito/.test(h));
  check('sem plano: oferece os dois planos e nada de "Estender plano"', /startSubscription\('monthly'\)/.test(h) && /startSubscription\('annual'\)/.test(h) && !/Estender plano/.test(h) && !/askCancelSubscription/.test(h));

  const past = Date.now() - 40 * DAY;
  h = modal({ league: { trialEndsAt: iso(Date.now() - 90 * DAY), subscriptionPlan: 'annual', subscriptionRenewsAt: iso(past), subscriptionActiveUntil: iso(past + DAY) } });
  check('plano que já venceu: volta a oferecer Mensal e Anual (não é "estender")', /Plano gratuito/.test(h) && /startSubscription\('monthly'\)/.test(h) && !/Estender plano/.test(h));

  // ── plano em vigor: nunca barra, estende ──────────────────────────────────────────────────
  // +12 meses de calendário a partir do vencimento (conta escrita de outro jeito, só para conferir).
  const plus12 = ms => { const d = new Date(ms); const y = d.getUTCFullYear() + 1, m = d.getUTCMonth(); return Date.UTC(y, m, Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), 12); };
  const monthlyLg = { subscriptionPlan: 'monthly', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) };
  const annualLg = { subscriptionPlan: 'annual', subscriptionRenewsAt: iso(renews), subscriptionActiveUntil: iso(until) };

  h = modal({ league: monthlyLg });
  check('mensal ativa: oferece "Estender plano" (valor) com a data prevista: vencimento + 12 meses', /Estender plano — R\$ 238,80/.test(h) && h.includes('o plano passa a valer até ' + fmt(plus12(renews))), h.match(/passa a valer até [^<]*/)?.[0]);
  check('mensal ativa: estender chama o pagamento anual', /startSubscription\('annual'\)/.test(h));
  check('mensal ativa: NÃO oferece outra assinatura mensal por cima (seria cobrança em dobro)', !/startSubscription\('monthly'\)/.test(h) && !/Mensal — R\$/.test(h));
  check('mensal ativa: avisa que ao estender a assinatura mensal é cancelada sozinha', /Ao estender, a assinatura mensal é cancelada sozinha: você não será cobrado de novo/.test(h));
  check('mensal ativa: dá para cancelar a assinatura mensal aqui mesmo', /askCancelSubscription\(\)/.test(h) && />Cancelar assinatura mensal</.test(h));
  check('mensal ativa: a confirmação de cancelamento só aparece depois de pedir', !/confirmCancelSubscription/.test(h));
  check('mensal ativa: continua avisando do prazo de desistência e linka os Termos', /depois disso, não há reembolso\. Ao estender o plano/.test(h) && /desistir em até 7 dias/.test(h) && /href="\/termos\.html#c10"/.test(h));
  check('mensal ativa: a previsão não usa a margem técnica de 1 dia', !h.includes('até ' + fmt(plus12(until))) || fmt(plus12(until)) === fmt(plus12(renews)));

  h = modal({ league: annualLg });
  check('anual ativa: oferece "Estender plano" com vencimento + 12 meses', /Estender plano — R\$ 238,80/.test(h) && h.includes('o plano passa a valer até ' + fmt(plus12(renews))));
  check('anual ativa: não oferece cancelar (não renova sozinho) nem fala em cancelar a mensal', !/askCancelSubscription/.test(h) && !/cancelada sozinha/.test(h) && !/Cancelar assinatura/.test(h));
  check('anual ativa: também não oferece assinar o mensal', !/startSubscription\('monthly'\)/.test(h));

  h = modal({ league: { ...monthlyLg, subscriptionCancelledAt: iso(Date.now() - DAY) } });
  check('mensal cancelada: diz que foi cancelada e que a liga segue até o vencimento', /Assinatura <strong>mensal<\/strong> cancelada/.test(h) && h.includes('continua com o plano até ' + fmt(renews)) && !/Assinatura <strong>mensal<\/strong> ativa/.test(h));
  check('mensal cancelada: continua podendo estender (a partir do vencimento)', /Estender plano — R\$ 238,80/.test(h) && h.includes('o plano passa a valer até ' + fmt(plus12(renews))));
  check('mensal cancelada: não oferece cancelar de novo nem diz que "será cancelada"', !/askCancelSubscription/.test(h) && !/cancelada sozinha/.test(h));

  h = modal({ league: { ...annualLg, subscriptionCancelledAt: iso(Date.now() - DAY) } });
  check('anual com marca de cancelada esquecida no banco: continua aparecendo como ativa (anual não se cancela)', /Assinatura <strong>anual<\/strong> ativa/.test(h) && !/cancelada/.test(h.replace(/Ao estender, a assinatura mensal é cancelada sozinha/g, '')));

  h = modal({ league: monthlyLg, cancelAsk: true });
  check('cancelar: pede confirmação na própria tela, dizendo até quando a liga segue e que não há reembolso', /Cancelar a assinatura mensal\?/.test(h) && h.includes('continua com o plano até ' + fmt(renews)) && /Não há reembolso do período já pago, exceto dentro dos 7 dias para desistir da compra/.test(h));
  check('cancelar: a confirmação tem "Voltar" e "Cancelar assinatura"', /confirmCancelSubscription\(\)/.test(h) && />Voltar</.test(h) && />Cancelar assinatura</.test(h));
  check('cancelar: com a confirmação aberta some o botão de pedir cancelamento', !/askCancelSubscription/.test(h));
  h = modal({ league: monthlyLg, cancelAsk: true, busy: true });
  check('cancelar: enquanto cancela, os botões ficam desabilitados (confirmar, voltar e estender)', /<button disabled onclick="confirmCancelSubscription\(\)"/.test(h) && /<button disabled onclick="st\.modal=\{type:'subscription'\};render\(\)"/.test(h) && /<button disabled onclick="startSubscription\('annual'\)"/.test(h), h.match(/<button[^>]*>/g));
  h = modal({ league: monthlyLg, busy: true });
  check('estender: enquanto trabalha, o botão fica desabilitado (não clica duas vezes)', /<button disabled onclick="startSubscription\('annual'\)"/.test(h));

  h = modal({ league: monthlyLg, checking: true });
  check('confirmando um pagamento com plano em vigor: mostra "Confirmando seu pagamento" e some a escolha (evita pagar duas vezes)', /Confirmando seu pagamento/.test(h) && !/startSubscription\(/.test(h) && !/askCancelSubscription/.test(h));

  // ── os dados do plano da liga que o app guarda (rememberLeague) ───────────────────────────
  const rememberCode = slice('async function rememberLeague', '/* ── WhatsApp');
  const lgData = { name: 'Liga L', trialEndsAt: '2026-10-01T00:00:00.000Z', ownerId: 'u1', subscriptionPlan: 'monthly', subscriptionRenewsAt: '2027-01-05T12:00:00.000Z', subscriptionActiveUntil: '2027-01-06T12:00:00.000Z', subscriptionCancelledAt: '2026-12-01T00:00:00.000Z' };
  const rememberEnv = { DB: { doc: () => ({ get: async () => ({ exists: true, data: () => lgData }) }) }, st: { availableLeagues: [{ id: 'X', name: 'Outra' }] } };
  await new Function('DB', 'st', rememberCode + '\nreturn rememberLeague;')(rememberEnv.DB, rememberEnv.st)('L', 'admin');
  const saved = rememberEnv.st.availableLeagues.find(l => l.id === 'L');
  check('rememberLeague: guarda o plano, as datas e a marca de cancelada da liga', saved?.subscriptionPlan === 'monthly' && saved.subscriptionRenewsAt === lgData.subscriptionRenewsAt && saved.subscriptionActiveUntil === lgData.subscriptionActiveUntil && saved.subscriptionCancelledAt === lgData.subscriptionCancelledAt && saved.trialEndsAt === lgData.trialEndsAt && saved.ownerId === 'u1', saved);
  check('rememberLeague: mantém as outras ligas da lista', rememberEnv.st.availableLeagues.some(l => l.id === 'X'));

  // ── a conta de "somar meses" é a mesma do servidor ────────────────────────────────────────
  check('somar meses: 29/02 + 12 meses = 28/02', addMonthsClient('2028-02-29T10:00:00.000Z', 12).toISOString() === '2029-02-28T10:00:00.000Z');
  check('somar meses: 31/01 + 1 mês = 28/02', addMonthsClient('2027-01-31T10:00:00.000Z', 1).toISOString() === '2027-02-28T10:00:00.000Z');
  let diverge = null;
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2032, 11, 31) && !diverge; ms += 37 * 3600000 + 1234567) {
    for (const months of [1, 12, 24]) {
      const a = addMonthsClient(new Date(ms).toISOString(), months).toISOString(), b = addMonthsServer(new Date(ms).toISOString(), months);
      if (a !== b) { diverge = { de: new Date(ms).toISOString(), months, app: a, servidor: b }; break; }
    }
  }
  check('somar meses: app e servidor dão o mesmo resultado em ~6 anos de datas (fins de mês e 29/02 incluídos)', !diverge, diverge);

  // ── iniciar o pagamento guarda o vencimento de antes ─────────────────────────────────────
  function makeStart({ league, respond }) {
    const calls = { callFn: [], render: 0, mark: null };
    const errEl = { textContent: '' };
    const env = {
      st: { leagueId: 'L', availableLeagues: [{ id: 'L', ...league }], _subBusy: false },
      callFn: async (name, data) => { calls.callFn.push({ name, data }); return respond(name, data); },
      render: () => { calls.render++; },
      markPaymentPending: (...a) => { calls.mark = a; },
      window: { location: { href: '' } },
      document: { getElementById: id => (id === 'sub-err' ? errEl : null) },
    };
    const names = Object.keys(env);
    const fn = new Function(...names, startCode + '\nreturn startSubscription;')(...names.map(n => env[n]));
    return { fn, env, calls, errEl };
  }
  let s = makeStart({ league: monthlyLg, respond: () => ({ initPoint: 'https://mp.test/pagar' }) });
  await s.fn('annual');
  check('estender: pede o pagamento anual da liga e abre o link do Mercado Pago', s.calls.callFn.length === 1 && s.calls.callFn[0].name === 'createAnnualPayment' && s.calls.callFn[0].data.liga === 'L' && s.env.window.location.href === 'https://mp.test/pagar', s.calls);
  check('estender: guarda o vencimento de antes (o que prova que o pagamento novo entrou)', s.calls.mark?.[0] === 'L' && s.calls.mark[1] === iso(renews), s.calls.mark);
  check('estender: não deixa a tela presa em "ocupado"', s.env.st._subBusy === false);
  s = makeStart({ league: { trialEndsAt: iso(Date.now() - DAY) }, respond: () => ({ initPoint: 'https://mp.test/pagar' }) });
  await s.fn('monthly');
  check('assinar o mensal sem plano: chama a função do mensal e guarda "sem plano antes" (null)', s.calls.callFn[0].name === 'createMonthlySubscription' && s.calls.mark?.[0] === 'L' && s.calls.mark[1] === null, s.calls.mark);
  s = makeStart({ league: monthlyLg, respond: () => { throw new Error('O Mercado Pago recusou a solicitação: teste.'); } });
  await s.fn('annual');
  check('erro do servidor: mostra a mensagem na tela, não abre link nem guarda pendência', s.errEl.textContent === 'O Mercado Pago recusou a solicitação: teste.' && s.env.window.location.href === '' && s.calls.mark === null && s.env.st._subBusy === false, { msg: s.errEl.textContent, href: s.env.window.location.href });
  s = makeStart({ league: monthlyLg, respond: () => ({ initPoint: 'https://mp.test/pagar' }) });
  s.env.st._subBusy = true;
  await s.fn('annual');
  check('clique repetido enquanto trabalha é ignorado', s.calls.callFn.length === 0);

  // ── cancelar a assinatura mensal pelo app ─────────────────────────────────────────────────
  function makeCancel({ league, respond }) {
    const calls = { callFn: [], remember: [], toast: [], render: 0 };
    const errEl = { textContent: '' };
    const env = {
      st: { leagueId: 'L', modal: { type: 'subscription', cancelAsk: true }, availableLeagues: [{ id: 'L', role: 'admin', name: 'Liga L', ...league }], _subBusy: false },
      callFn: async (name, data) => { calls.callFn.push({ name, data }); return respond(name, data); },
      // o servidor passou a marcar a liga como cancelada; rememberLeague traz isso para o app
      rememberLeague: async (...a) => { calls.remember.push(a); env.st.availableLeagues = [{ id: 'L', role: 'admin', name: 'Liga L', ...league, subscriptionCancelledAt: '2026-12-01T00:00:00.000Z' }]; },
      toast: (m, t) => calls.toast.push({ m, t }),
      render: () => { calls.render++; },
      document: { getElementById: id => (id === 'sub-err' ? errEl : null) },
    };
    const names = Object.keys(env);
    const api = new Function(...names, cancelCode + '\nreturn { askCancelSubscription, confirmCancelSubscription };')(...names.map(n => env[n]));
    return { api, env, calls, errEl };
  }
  let c = makeCancel({ league: monthlyLg, respond: () => ({ ok: true }) });
  c.env.st.modal = { type: 'subscription' };
  c.api.askCancelSubscription();
  check('pedir para cancelar abre a confirmação na tela da assinatura', c.env.st.modal.type === 'subscription' && c.env.st.modal.cancelAsk === true && c.calls.render === 1);
  await c.api.confirmCancelSubscription();
  check('confirmar: chama o servidor para a liga certa', c.calls.callFn.length === 1 && c.calls.callFn[0].name === 'cancelSubscription' && c.calls.callFn[0].data.liga === 'L', c.calls.callFn);
  check('confirmar: atualiza os dados da liga (traz a marca de cancelada)', c.calls.remember.length === 1 && c.calls.remember[0][0] === 'L' && c.calls.remember[0][1] === 'admin' && c.calls.remember[0][2] === 'Liga L', c.calls.remember);
  check('confirmar: fecha a confirmação e volta à tela da assinatura', c.env.st.modal.type === 'subscription' && !c.env.st.modal.cancelAsk);
  check('confirmar: avisa em tom positivo até quando a liga segue com o plano', c.calls.toast.length === 1 && c.calls.toast[0].t === 'ok' && c.calls.toast[0].m === 'Assinatura mensal cancelada. Sua liga continua com o plano até ' + fmt(renews) + '.', c.calls.toast);
  check('confirmar: não deixa a tela presa em "ocupado"', c.env.st._subBusy === false);

  c = makeCancel({ league: monthlyLg, respond: () => { throw new Error('Não foi possível cancelar a assinatura no Mercado Pago agora. Tente de novo em alguns minutos.'); } });
  await c.api.confirmCancelSubscription();
  check('erro ao cancelar: mostra a mensagem do servidor na tela', c.errEl.textContent === 'Não foi possível cancelar a assinatura no Mercado Pago agora. Tente de novo em alguns minutos.', c.errEl.textContent);
  check('erro ao cancelar: nada de aviso de sucesso, a confirmação continua aberta para tentar de novo e a tela não fica presa', c.calls.toast.length === 0 && c.env.st.modal.cancelAsk === true && c.env.st._subBusy === false && c.calls.remember.length === 0);
  c = makeCancel({ league: monthlyLg, respond: () => ({ ok: true }) });
  c.env.st._subBusy = true;
  await c.api.confirmCancelSubscription();
  check('cancelar: clique repetido enquanto trabalha é ignorado', c.calls.callFn.length === 0);

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
