"use strict";
// Métricas do funil do Pelada na Mão (painel só do dono). Este arquivo é PURO: recebe as ligas e as
// contagens já lidas do banco e devolve o que o painel mostra. Não lê banco, não guarda nada e não
// carrega dado pessoal: só contagens e valores em reais.
//
// Cada liga cai em UM estado, nesta ordem:
//   monthlyActive / monthlyCancelled  plano mensal em vigor (cancelado = segue até o fim do período pago)
//   annualActive                      plano anual em vigor
//   expiredPaid                       já pagou, o plano acabou
//   inTrial                           nunca pagou, teste grátis em andamento
//   free                              nunca pagou, teste acabou (plano gratuito)
//   legacy                            nunca pagou e não tem data de teste (liga antiga, nunca cai no gratuito)

const DAY = 86400000;
const TRIAL_ENDING_DAYS = 3; // "teste acabando": faltam até 3 dias (igual ao e-mail de aviso do teste)
const OFFER_DAYS = 5;        // a faixa do plano aparece nos últimos 5 dias do teste (igual ao app)
const ACTIVE_DAYS = 14;      // liga "usada recentemente"

const EVENT_NAMES_CLIENT = ["planBannerSeen", "planBannerClick", "subscriptionOpened", "installBannerSeen", "installClick", "appInstalled", "cardOpen", "cardShare", "cardVisit"];
const EVENT_NAMES_SERVER = ["checkoutMonthly", "checkoutAnnual"];
const EVENT_NAMES = [...EVENT_NAMES_CLIENT, ...EVENT_NAMES_SERVER];

const ms = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const round2 = n => Math.round(n * 100) / 100;
// Percentual com uma casa decimal; null quando não há base para comparar (evita "0%" enganoso).
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// Dia (AAAA-MM-DD) no horário de São Paulo: é o dia que o dono enxerga, e a virada à meia-noite dele.
function dayKeySP(nowMs) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}
function lastDayKeys(count, nowMs) {
  return Array.from({ length: count }, (_, i) => dayKeySP(nowMs - i * DAY)); // do mais novo para o mais antigo
}

function classifyLeague(l, now) {
  const trialEnds = ms(l.trialEndsAt);
  const activeUntil = ms(l.subscriptionActiveUntil);
  const plan = l.subscriptionPlan === "monthly" || l.subscriptionPlan === "annual" ? l.subscriptionPlan : null;
  const everPaid = !!plan || activeUntil !== null;
  const paidActive = activeUntil !== null && activeUntil > now;
  let state;
  if (paidActive) state = plan === "monthly" ? (l.subscriptionCancelledAt ? "monthlyCancelled" : "monthlyActive") : plan === "annual" ? "annualActive" : "paidUnknown";
  else if (everPaid) state = "expiredPaid";
  else if (trialEnds === null) state = "legacy";
  else state = trialEnds > now ? "inTrial" : "free";
  return { state, everPaid, trialEnds, plan };
}

/**
 * @param leagues  [{ id, ownerId, createdAt, trialEndsAt, subscriptionPlan, subscriptionActiveUntil, subscriptionCancelledAt,
 *                    lastActivityAt, checkoutStarts, championships }]  (championships = quantos campeonatos a liga tem)
 * @param accounts { total, last7d, last30d }
 * @param prices   { monthly, annual } em reais (a mesma tabela do pagamento)
 */
function computeFunnel({ leagues = [], accounts = {}, now = Date.now(), prices = { monthly: 29.9, annual: 238.8 } } = {}) {
  const states = { inTrial: 0, trialEndingSoon: 0, free: 0, legacy: 0, monthlyActive: 0, monthlyCancelled: 0, annualActive: 0, paidUnknown: 0, expiredPaid: 0 };
  const lg = { total: leagues.length, last7d: 0, last30d: 0, withGame: 0, active14d: 0, sawOffer: 0, checkoutStarted: 0, everPaid: 0 };
  const cohort = { ended: 0, convertedAmongEnded: 0 };
  const owners = new Set();

  for (const l of leagues) {
    const c = classifyLeague(l, now);
    states[c.state]++;
    if (c.state === "inTrial" && c.trialEnds - now <= TRIAL_ENDING_DAYS * DAY) states.trialEndingSoon++;
    if (c.everPaid) lg.everPaid++;

    const created = ms(l.createdAt);
    if (created !== null) {
      if (now - created <= 7 * DAY) lg.last7d++;
      if (now - created <= 30 * DAY) lg.last30d++;
    }
    if (typeof l.ownerId === "string" && l.ownerId) owners.add(l.ownerId);
    if ((Number(l.championships) || 0) > 0) lg.withGame++;
    const act = ms(l.lastActivityAt);
    if (act !== null && now - act <= ACTIVE_DAYS * DAY) lg.active14d++;
    if (c.trialEnds !== null && c.trialEnds - now <= OFFER_DAYS * DAY) lg.sawOffer++;
    if ((Number(l.checkoutStarts) || 0) > 0) lg.checkoutStarted++;
    if (c.trialEnds !== null && c.trialEnds <= now) {
      cohort.ended++;
      if (c.everPaid) cohort.convertedAmongEnded++;
    }
  }

  const acc = { total: Number(accounts.total) || 0, last7d: Number(accounts.last7d) || 0, last30d: Number(accounts.last30d) || 0, ownersOfLeagues: owners.size };
  const monthlyMrr = round2(states.monthlyActive * prices.monthly);
  const annualMrr = round2(states.annualActive * (prices.annual / 12));
  return {
    generatedAt: new Date(now).toISOString(),
    accounts: acc,
    leagues: lg,
    states,
    trialCohort: cohort,
    rates: {
      accountToLeagueOwner: pct(acc.ownersOfLeagues, acc.total),
      leagueToGame: pct(lg.withGame, lg.total),
      leagueActive14d: pct(lg.active14d, lg.total),
      trialToPaid: pct(cohort.convertedAmongEnded, cohort.ended),
    },
    revenue: { mrr: round2(monthlyMrr + annualMrr), monthlyMrr, annualMrr, prices },
  };
}

// O que vai para o histórico diário (metrics_daily/AAAA-MM-DD): só números, para o painel desenhar a evolução.
function snapshotOf(f) {
  return {
    accounts: f.accounts.total, leagues: f.leagues.total, withGame: f.leagues.withGame, active14d: f.leagues.active14d,
    everPaid: f.leagues.everPaid, checkoutStarted: f.leagues.checkoutStarted,
    inTrial: f.states.inTrial, trialEndingSoon: f.states.trialEndingSoon, free: f.states.free, legacy: f.states.legacy,
    monthlyActive: f.states.monthlyActive, monthlyCancelled: f.states.monthlyCancelled, annualActive: f.states.annualActive,
    expiredPaid: f.states.expiredPaid, mrr: f.revenue.mrr,
  };
}

// Soma os contadores de uso (metrics_events) dos últimos `days` dias. `byDay` = { 'AAAA-MM-DD': {nome: n} }.
function sumEvents(byDay, days, now = Date.now()) {
  const out = Object.fromEntries(EVENT_NAMES.map(n => [n, 0]));
  for (const key of lastDayKeys(days, now)) {
    const doc = byDay[key];
    if (!doc) continue;
    for (const n of EVENT_NAMES) out[n] += Number.isFinite(doc[n]) ? doc[n] : 0;
  }
  return out;
}

module.exports = { computeFunnel, snapshotOf, sumEvents, dayKeySP, lastDayKeys, classifyLeague, EVENT_NAMES, EVENT_NAMES_CLIENT, EVENT_NAMES_SERVER, TRIAL_ENDING_DAYS, OFFER_DAYS, ACTIVE_DAYS };
