// Testa a faixa do plano do app (index.html) isolada: extrai as funções reais do arquivo e as executa
// num ambiente simulado, sem navegador. A faixa avisa o admin quantos dias faltam do teste grátis,
// que o plano gratuito pausa gols/ranking/conquistas e quando o plano pago está acabando.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const code = slice('const PLAN_BANNER_SNOOZE_MS', 'async function signOutUser');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const DAY = 86400000;
const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const iso = ms => new Date(ms).toISOString();

function makeEnv({ role = 'admin', league = {}, leagueId = 'L', authUser = { uid: 'u' }, storageThrows = false } = {}) {
  const calls = { render: 0, events: [] };
  const store = {};
  const env = {
    st: { authUser, leagueId, availableLeagues: [{ id: 'L', ...league }], modal: null },
    isAdmin: () => role === 'admin',
    localStorage: storageThrows
      ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    render: () => { calls.render++; },
    trackEvent: (n, once = true) => { calls.events.push([n, once]); }, // contador de uso (anônimo)
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { planBannerInfo, planBanner, dismissPlanBanner, openSubscription };')(...names.map(n => env[n]));
  return { api, env, calls, store };
}
const info = (league, now = NOW) => makeEnv({ league }).api.planBannerInfo(league, now);

// ── o que a faixa diz em cada situação ──────────────────────────────────────────────────────
check('sem liga: nada', makeEnv().api.planBannerInfo(null, NOW) === null);
check('liga antiga, sem data de teste e sem plano: nada (nunca cai no plano gratuito)', info({}) === null);

for (const [dias, esperaFaixa] of [[8, false], [6, false], [5.5, false], [5, true]]) {
  const r = info({ trialEndsAt: iso(NOW + dias * DAY) });
  check(`teste acabando em ${dias} dias: ${esperaFaixa ? 'mostra a faixa' : 'ainda não mostra'}`, esperaFaixa ? r?.kind === 'trial' : r === null, r);
}
let r = info({ trialEndsAt: iso(NOW + 5 * DAY) });
check('teste, 5 dias: tom informativo, texto com os dias e o que fica pausado, botão "Ver planos"', r.tone === 'info' && /faltam 5 dias/.test(r.text) && /registro de gols, o ranking e as conquistas novas ficam pausados/.test(r.text) && r.cta === 'Ver planos', r);
r = info({ trialEndsAt: iso(NOW + 3 * DAY) });
check('teste, 3 dias: ainda informativo', r.tone === 'info' && /faltam 3 dias/.test(r.text), r);
r = info({ trialEndsAt: iso(NOW + 2 * DAY) });
check('teste, 2 dias: vira alerta (laranja)', r.tone === 'warn' && /faltam 2 dias/.test(r.text), r);
r = info({ trialEndsAt: iso(NOW + 1 * DAY) });
check('teste, 1 dia: "último dia"', r.tone === 'warn' && /último dia/.test(r.text) && !/faltam/.test(r.text), r);
r = info({ trialEndsAt: iso(NOW + 0.2 * DAY) });
check('teste, poucas horas: ainda "último dia"', r?.kind === 'trial' && /último dia/.test(r.text), r);
r = info({ trialEndsAt: iso(NOW - 1000) });
check('teste que acabou: plano gratuito, em alerta, botão "Assinar", diz o que está pausado', r.kind === 'free' && r.tone === 'warn' && r.cta === 'Assinar' && /Plano gratuito/.test(r.text) && /gols, ranking e conquistas novas estão pausados/.test(r.text), r);
r = info({ trialEndsAt: iso(NOW - 200 * DAY) });
check('teste que acabou há muito tempo: continua avisando o plano gratuito', r?.kind === 'free', r);

const paid = (plan, renewsInDays, extra = {}) => ({ trialEndsAt: iso(NOW - 90 * DAY), subscriptionPlan: plan, subscriptionRenewsAt: iso(NOW + renewsInDays * DAY), subscriptionActiveUntil: iso(NOW + (renewsInDays + 1) * DAY), ...extra });
check('plano mensal em dia: nada', info(paid('monthly', 20)) === null);
check('plano mensal em dia (mesmo faltando poucos dias): nada, ele renova sozinho', info(paid('monthly', 3)) === null);
check('plano anual com mais de 30 dias: nada', info(paid('annual', 31)) === null && info(paid('annual', 200)) === null);
r = info(paid('annual', 30));
check('plano anual vencendo em 30 dias: lembrete informativo com "Estender plano"', r?.kind === 'renew' && r.tone === 'info' && /vence em 30 dias/.test(r.text) && r.cta === 'Estender plano', r);
r = info(paid('annual', 8));
check('plano anual, 8 dias: ainda informativo', r.tone === 'info', r);
r = info(paid('annual', 7));
check('plano anual, 7 dias: alerta', r.tone === 'warn' && /vence em 7 dias/.test(r.text), r);
r = info(paid('annual', 1));
check('plano anual, 1 dia: singular', /vence em 1 dia\./.test(r.text), r);
check('plano anual no dia do vencimento (dentro da tolerância de 1 dia): nada', info(paid('annual', 0)) === null && info(paid('annual', -0.5, { subscriptionActiveUntil: iso(NOW + 0.5 * DAY) })) === null);
r = info(paid('monthly', 5, { subscriptionCancelledAt: iso(NOW - DAY) }));
check('mensal cancelada, acabando em 5 dias: avisa e oferece estender', r?.kind === 'ending' && r.tone === 'warn' && /foi cancelada e o plano acaba em 5 dias/.test(r.text) && r.cta === 'Estender plano', r);
check('mensal cancelada com mais de 7 dias pela frente: nada ainda', info(paid('monthly', 8, { subscriptionCancelledAt: iso(NOW - DAY) })) === null);
r = info(paid('monthly', 1, { subscriptionCancelledAt: iso(NOW - DAY) }));
check('mensal cancelada, 1 dia: singular', /acaba em 1 dia\./.test(r.text), r);
check('anual com marca de cancelada esquecida: segue a regra do anual (não vira "mensal cancelada")', info(paid('annual', 5, { subscriptionCancelledAt: iso(NOW - DAY) }))?.kind === 'renew');
r = info({ trialEndsAt: iso(NOW - 40 * DAY), subscriptionPlan: 'annual', subscriptionRenewsAt: iso(NOW - 5 * DAY), subscriptionActiveUntil: iso(NOW - 4 * DAY) });
check('plano anual que venceu e teste antigo: plano gratuito', r?.kind === 'free', r);
r = info({ trialEndsAt: iso(NOW + 3 * DAY), subscriptionPlan: 'annual', subscriptionRenewsAt: iso(NOW - 5 * DAY), subscriptionActiveUntil: iso(NOW - 4 * DAY) });
check('plano vencido mas teste ainda em andamento: mostra o teste', r?.kind === 'trial', r);
check('sem renovação registrada, só a validade (liga ativada antes do campo existir): usa a validade', info({ trialEndsAt: iso(NOW - 90 * DAY), subscriptionPlan: 'annual', subscriptionActiveUntil: iso(NOW + 6 * DAY) })?.kind === 'renew');

// ── a faixa na tela ─────────────────────────────────────────────────────────────────────────
const realNow = Date.now;
Date.now = () => NOW; // o app olha o relógio ao decidir se a faixa está "escondida por 24 h"
const trial2 = { trialEndsAt: iso(NOW + 2 * DAY) };
let t = makeEnv({ league: trial2 });
let h = t.api.planBanner();
check('admin vê a faixa, com o texto e os dois botões (abrir planos e fechar)', /faltam 2 dias/.test(h) && /openSubscription\(\)"/.test(h) && />Ver planos</.test(h) && /dismissPlanBanner\('trial'\)/.test(h), h);
const hInfo = makeEnv({ league: { trialEndsAt: iso(NOW + 4 * DAY) } }).api.planBanner();
check('faixa de alerta usa fundo, borda e botão laranja; a informativa, verde', /background:#F0A50018;border:1px solid #F0A50050/.test(h) && /background:#F0A500;color:#000/.test(h) && !/#00C97A/.test(h) && /background:#00C97A15;border:1px solid #00C97A40/.test(hInfo) && /background:#00C97A;color:#000/.test(hInfo) && !/#F0A500/.test(hInfo), { h: h.slice(0, 200), hInfo: hInfo.slice(0, 200) });
check('jogador comum (não admin) não vê a faixa', makeEnv({ role: 'player', league: trial2 }).api.planBanner() === '');
check('sem liga escolhida: nada', makeEnv({ league: trial2, leagueId: null }).api.planBanner() === '');
check('sem login: nada', makeEnv({ league: trial2, authUser: null }).api.planBanner() === '');
check('liga com plano em dia: nada', makeEnv({ league: paid('monthly', 20) }).api.planBanner() === '');
check('liga de outra pessoa na lista (id diferente): nada', (() => { const e = makeEnv({ league: trial2 }); e.env.st.leagueId = 'OUTRA'; return e.api.planBanner() === ''; })());

t.api.dismissPlanBanner('trial');
check('fechar no × guarda 24 horas à frente e redesenha a tela', Number(t.store['aceoma_planbar_L_trial']) === NOW + DAY && t.calls.render === 1, t.store);
check('…e a faixa some', t.api.planBanner() === '');
Date.now = () => NOW + DAY - 1;
check('…ainda escondida faltando 1 ms para as 24 horas', t.api.planBanner() === '');
Date.now = () => NOW + DAY + 1;
check('…e volta depois das 24 horas', t.api.planBanner() !== '');
Date.now = () => NOW;
t = makeEnv({ league: { trialEndsAt: iso(NOW + 2 * DAY) } });
t.api.dismissPlanBanner('free');
check('fechar um tipo de faixa não esconde os outros tipos', t.api.planBanner() !== '');
const t2 = makeEnv({ league: trial2 }); t2.env.st.leagueId = 'L';
t2.api.dismissPlanBanner('trial');
check('o "fechei" vale só para aquela liga', (() => { const o = makeEnv({ league: trial2 }); o.env.st.availableLeagues = [{ id: 'M', ...trial2 }]; o.env.st.leagueId = 'M'; return o.api.planBanner() !== ''; })());

t = makeEnv({ league: trial2, storageThrows: true });
check('navegador sem armazenamento (modo privado): a faixa aparece e fechar não quebra', t.api.planBanner() !== '' && (() => { try { t.api.dismissPlanBanner('trial'); return true; } catch (e) { return false; } })());

t = makeEnv({ league: trial2 });
t.api.openSubscription();
check('o botão da faixa abre a tela de assinatura', t.env.st.modal?.type === 'subscription' && t.calls.render === 1, t.env.st.modal);
Date.now = realNow;

// ── a faixa está ligada na tela, e os avisos no plano gratuito existem ───────────────────────────
// ── contadores de uso (anônimos) ──────────────────────────────────────────────────────────
{
  const e = makeEnv({ league: { trialEndsAt: iso(Date.now() + 2 * DAY) } });
  const b = e.api.planBanner();
  check('a faixa do plano vem marcada para contar quem a viu (data-ev="planBannerSeen")', /data-ev="planBannerSeen"/.test(b), b);
  check('o botão da faixa conta o toque (planBannerClick, sempre) antes de abrir a tela de assinatura', /onclick="trackEvent\('planBannerClick',false\);openSubscription\(\)"/.test(b), b);
  e.api.openSubscription();
  check('abrir a tela de assinatura conta uma abertura (subscriptionOpened, uma vez por sessão)', JSON.stringify(e.calls.events) === JSON.stringify([['subscriptionOpened', true]]), e.calls.events);
}
check('a faixa entra no topo de toda aba (antes do aviso de notificações)', /main\.innerHTML=termsNotice\(\)\+planBanner\(\)\+notifBanner\(\)\+/.test(html));
check('o ícone 💳 do topo usa o mesmo abridor da tela de assinatura', html.includes('<button onclick="openSubscription()"\n        style="background:none;border:none;color:var(--text3);font-size:18px') || /<button onclick="openSubscription\(\)"\s+style="background:none;border:none;color:var\(--text3\);font-size:18px/.test(html));
check('criar campeonato no plano gratuito avisa que ele só conta para títulos, ranking e conquistas quando a liga assinar (aí é recuperado)', /Plano gratuito: campeonatos criados agora ficam guardados, mas só contam para títulos, ranking e conquistas quando a liga assinar: aí eles são recuperados\./.test(html) && !/nem depois, se a liga assinar/.test(html) && /isLeagueFree\(\) \? `<div class="warn-box">/.test(html));
check('o aviso ao criar tem o atalho "Ver planos" só para o admin; jogador vê "Peça ao admin"', /isAdmin\(\) \? `<a href="#" onclick="openSubscription\(\);return false"[^`]*Ver planos<\/a>` : 'Peça ao admin da liga para assinar\.'/.test(html));
check('na tela de placar do plano gratuito diz como liberar (💳 para o admin, "peça ao admin" para os outros)', /Para liberar, toque em 💳 no topo da tela\./.test(html) && /Para liberar, peça ao admin da liga para assinar\./.test(html));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
