// Métricas do funil (functions/funnel-metrics.js): a parte pura. Cada liga cai em um estado só, as taxas não
// enganam quando não há base, a receita mensal estimada segue a tabela de preços e nada pessoal sai daqui.
const path = require('path');
const m = require(path.join(__dirname, '..', 'funnel-metrics.js'));

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const DAY = 86400000;
const NOW = Date.parse('2026-10-20T15:00:00.000Z'); // 12h em São Paulo
const iso = off => new Date(NOW + off * DAY).toISOString();
const league = (over = {}) => ({ id: 'l' + Math.random().toString(36).slice(2, 7), ownerId: 'u1', createdAt: iso(-3), trialEndsAt: iso(5), championships: 0, ...over });
const f = (leagues, accounts = { total: 0, last7d: 0, last30d: 0 }) => m.computeFunnel({ leagues, accounts, now: NOW });
const state = l => m.classifyLeague(l, NOW).state;

// ── estado de cada liga ─────────────────────────────────────────────────────────────────────────
check('teste em andamento → inTrial', state(league({ trialEndsAt: iso(5) })) === 'inTrial');
check('teste que acabou, sem nunca pagar → free (plano gratuito)', state(league({ trialEndsAt: iso(-1) })) === 'free');
check('teste que acaba agora mesmo → free (o limite é "acabou")', state(league({ trialEndsAt: iso(0) })) === 'free');
check('liga antiga sem data de teste e sem plano → legacy (nunca cai no gratuito)', state(league({ trialEndsAt: undefined })) === 'legacy');
check('plano mensal em vigor → monthlyActive', state(league({ subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(20) })) === 'monthlyActive');
check('plano mensal cancelado, ainda no período pago → monthlyCancelled', state(league({ subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(10), subscriptionCancelledAt: iso(-1) })) === 'monthlyCancelled');
check('plano anual em vigor → annualActive', state(league({ subscriptionPlan: 'annual', subscriptionActiveUntil: iso(300) })) === 'annualActive');
check('plano anual com mensal cancelada guardada continua anual', state(league({ subscriptionPlan: 'annual', subscriptionActiveUntil: iso(300), subscriptionCancelledAt: iso(-2) })) === 'annualActive');
check('plano pago que venceu → expiredPaid (já pagou, não está pagando)', state(league({ subscriptionPlan: 'annual', subscriptionActiveUntil: iso(-2) })) === 'expiredPaid');
check('pagar vale mais que o teste: liga paga ainda dentro do teste conta como paga', state(league({ trialEndsAt: iso(4), subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(30) })) === 'monthlyActive');
check('vigência sem tipo de plano → paidUnknown (conta como paga, sem receita)', state(league({ subscriptionActiveUntil: iso(30) })) === 'paidUnknown');
check('datas inválidas não quebram: teste inválido vira legacy, vigência inválida é ignorada', state(league({ trialEndsAt: 'lixo', subscriptionActiveUntil: 'lixo' })) === 'legacy');
check('tipo de plano desconhecido é ignorado', state(league({ subscriptionPlan: 'vip', trialEndsAt: iso(2) })) === 'inTrial');

// ── contagens ───────────────────────────────────────────────────────────────────────────────────
const sample = [
  league({ id: 'a', ownerId: 'u1', createdAt: iso(-2), trialEndsAt: iso(6), championships: 2, lastActivityAt: iso(-1), checkoutStarts: 0 }),            // em teste, com jogo, ativa
  league({ id: 'b', ownerId: 'u2', createdAt: iso(-6), trialEndsAt: iso(2), championships: 0, lastActivityAt: iso(-10) }),                              // teste acabando, sem jogo
  league({ id: 'c', ownerId: 'u3', createdAt: iso(-20), trialEndsAt: iso(-12), championships: 3, lastActivityAt: iso(-30) }),                           // gratuita, com jogo
  league({ id: 'd', ownerId: 'u3', createdAt: iso(-40), trialEndsAt: iso(-32), championships: 1, subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(12), checkoutStarts: 1, lastActivityAt: iso(-2) }),
  league({ id: 'e', ownerId: 'u4', createdAt: iso(-100), trialEndsAt: iso(-92), championships: 5, subscriptionPlan: 'annual', subscriptionActiveUntil: iso(200), checkoutStarts: 2, lastActivityAt: iso(-3) }),
  league({ id: 'g', ownerId: 'u5', createdAt: iso(-150), trialEndsAt: iso(-142), championships: 4, subscriptionPlan: 'annual', subscriptionActiveUntil: iso(-5), checkoutStarts: 1 }), // venceu
  league({ id: 'h', ownerId: undefined, createdAt: undefined, trialEndsAt: undefined, championships: 9, lastActivityAt: iso(-1) }),                      // liga antiga
];
const r = f(sample, { total: 40, last7d: 6, last30d: 15 });
check('totais de ligas e contas', r.leagues.total === 7 && r.accounts.total === 40 && r.accounts.last7d === 6 && r.accounts.last30d === 15, r);
check('ligas criadas nos últimos 7 e 30 dias (liga sem data de criação fica de fora das janelas)', r.leagues.last7d === 2 && r.leagues.last30d === 3, r.leagues);
check('contas que criaram liga = donos distintos (liga sem dono não conta)', r.accounts.ownersOfLeagues === 5, r.accounts);
check('ligas com pelo menos 1 campeonato', r.leagues.withGame === 6, r.leagues);
check('ligas usadas nos últimos 14 dias', r.leagues.active14d === 5, r.leagues);
check('ligas que chegaram à reta final do teste (≤5 dias para acabar) ou passaram dela', r.leagues.sawOffer === 5, r.leagues);
check('ligas que iniciaram checkout', r.leagues.checkoutStarted === 3, r.leagues);
check('ligas que já pagaram (inclui a que venceu)', r.leagues.everPaid === 3, r.leagues);
check('estados somam o total de ligas', Object.entries(r.states).filter(([k]) => k !== 'trialEndingSoon').reduce((s, [, v]) => s + v, 0) === 7, r.states);
check('estados: 1 em teste, 1 acabando, 1 gratuita, 1 mensal, 1 anual, 1 vencida, 1 antiga', r.states.inTrial === 2 && r.states.trialEndingSoon === 1 && r.states.free === 1 && r.states.monthlyActive === 1 && r.states.annualActive === 1 && r.states.expiredPaid === 1 && r.states.legacy === 1, r.states);
check('"teste acabando" é um recorte do "em teste", não um estado a mais', r.states.trialEndingSoon <= r.states.inTrial);
check('"teste acabando": faltando exatamente 3 dias entra; 3 dias e meio, 4 e 5 dias não entram (o limite é 3, igual ao e-mail de aviso)', f([league({ trialEndsAt: iso(3) })]).states.trialEndingSoon === 1 && f([league({ trialEndsAt: iso(3.5) })]).states.trialEndingSoon === 0 && f([league({ trialEndsAt: iso(4) })]).states.trialEndingSoon === 0 && f([league({ trialEndsAt: iso(5) })]).states.trialEndingSoon === 0);
const semTipo = f([league({ subscriptionActiveUntil: iso(-3) }), league({ subscriptionActiveUntil: iso(30) })]);
check('vigência guardada sem o tipo do plano também conta como "já pagou": a vencida é expiredPaid e as duas entram em everPaid', semTipo.states.expiredPaid === 1 && semTipo.states.paidUnknown === 1 && semTipo.leagues.everPaid === 2, { states: semTipo.states, everPaid: semTipo.leagues.everPaid });
check('coorte do teste: 4 ligas com teste encerrado e 3 delas já pagaram (a gratuita não)', r.trialCohort.ended === 4 && r.trialCohort.convertedAmongEnded === 3, r.trialCohort);
check('taxas: conta→dono 12,5%, liga→jogo 85,7%, ativas 71,4%, teste→pago 75%', r.rates.accountToLeagueOwner === 12.5 && r.rates.leagueToGame === 85.7 && r.rates.leagueActive14d === 71.4 && r.rates.trialToPaid === 75, r.rates);

// ── receita ─────────────────────────────────────────────────────────────────────────────────────
check('receita mensal estimada: mensal ativa vale R$ 29,90; anual vale 1/12 de R$ 238,80 (R$ 19,90)', r.revenue.monthlyMrr === 29.9 && r.revenue.annualMrr === 19.9 && r.revenue.mrr === 49.8, r.revenue);
const many = f([...Array(3)].map(() => league({ subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(10) })).concat([...Array(2)].map(() => league({ subscriptionPlan: 'annual', subscriptionActiveUntil: iso(100) }))));
check('3 mensais + 2 anuais = R$ 129,50 por mês (89,70 + 39,80)', many.revenue.mrr === 129.5, many.revenue);
const canc = f([league({ subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(10), subscriptionCancelledAt: iso(-1) })]);
check('mensal cancelada não entra na receita (não vai renovar), mas aparece como cancelada', canc.revenue.mrr === 0 && canc.states.monthlyCancelled === 1, canc);
check('usa a tabela de preços informada', m.computeFunnel({ leagues: [league({ subscriptionPlan: 'monthly', subscriptionActiveUntil: iso(10) })], now: NOW, prices: { monthly: 10, annual: 120 } }).revenue.mrr === 10);

// ── sem dados, dados sujos ──────────────────────────────────────────────────────────────────────
const vazio = f([]);
check('sem nenhuma liga: tudo zero e as taxas são null (sem base, nunca "0%")', vazio.leagues.total === 0 && vazio.rates.leagueToGame === null && vazio.rates.trialToPaid === null && vazio.rates.accountToLeagueOwner === null && vazio.revenue.mrr === 0, vazio);
check('sem contas informadas: zeros', m.computeFunnel({ leagues: [], now: NOW }).accounts.total === 0);
const sujo = f([league({ championships: 'abc', checkoutStarts: 'x', lastActivityAt: 'ontem', createdAt: 'sempre' }), { id: 'x' }]);
check('campos com lixo não quebram nem inflam as contagens', sujo.leagues.withGame === 0 && sujo.leagues.checkoutStarted === 0 && sujo.leagues.active14d === 0 && sujo.leagues.total === 2, sujo.leagues);
check('o resultado não carrega nada pessoal: nem ids de liga, nem donos, nem e-mails', !/u1|u2|"id"|@/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 200));

// ── histórico diário e contadores de uso ────────────────────────────────────────────────────────
const snap = m.snapshotOf(r);
check('o retrato do dia tem só números (e o MRR)', Object.values(snap).every(v => typeof v === 'number') && snap.mrr === 49.8 && snap.leagues === 7 && snap.accounts === 40, snap);
check('dia no horário de São Paulo (meia-noite do dono, não a UTC)', m.dayKeySP(Date.parse('2026-10-20T02:30:00.000Z')) === '2026-10-19' && m.dayKeySP(Date.parse('2026-10-20T03:00:00.000Z')) === '2026-10-20');
const keys = m.lastDayKeys(3, NOW);
check('últimos dias, do mais novo para o mais antigo', JSON.stringify(keys) === JSON.stringify(['2026-10-20', '2026-10-19', '2026-10-18']), keys);
const byDay = { '2026-10-20': { planBannerSeen: 5, planBannerClick: 2, checkoutMonthly: 1 }, '2026-10-19': { planBannerSeen: 3, installClick: 4 }, '2026-10-05': { planBannerSeen: 100 } };
const s7 = m.sumEvents(byDay, 7, NOW), s30 = m.sumEvents(byDay, 30, NOW);
check('soma dos contadores nos últimos 7 dias (o dia 05/10 fica de fora)', s7.planBannerSeen === 8 && s7.planBannerClick === 2 && s7.installClick === 4 && s7.checkoutMonthly === 1 && s7.appInstalled === 0, s7);
check('…e nos últimos 30 dias (o dia 05/10 entra)', s30.planBannerSeen === 108, s30);
check('valores inválidos nos contadores são ignorados', m.sumEvents({ '2026-10-20': { planBannerSeen: 'x', installClick: null, appInstalled: 2 } }, 1, NOW).planBannerSeen === 0);
check('lista de eventos: 6 do app + 2 do servidor, sem repetição', m.EVENT_NAMES.length === 8 && new Set(m.EVENT_NAMES).size === 8 && m.EVENT_NAMES_CLIENT.length === 6 && m.EVENT_NAMES_SERVER.length === 2);

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
