// Painel do dono (métricas do funil) e contadores de uso, no app (index.html): extrai as funções reais e as executa
// num ambiente simulado, sem navegador. Os contadores só mandam o NOME do evento, uma vez por sessão, e falham em
// silêncio; o painel só abre para o dono do sistema e só mostra números agregados.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const trackCode = slice('const _evSent = new Set();', '/* ── Instalar o app');
const panelCode = slice('/* ── Painel do dono: métricas do funil', '/* ── Excluir a própria conta');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// A tabela de canais de origem do app (a mesma que a contagem e o painel usam), tirada do index.html.
const REF_EVENTS = new Function(slice('const REF_EVENTS =', '\nconst refEventOf') + '\nreturn REF_EVENTS;')();
const funnel = require('../funnel-metrics.js');

// ── contadores de uso ───────────────────────────────────────────────────────────────────────────
function makeTrack({ authUser = { uid: 'u', email: 'x@y.z' }, noFN = false, sessionHas = [], sessionThrows = false, callableRejects = false, callableThrows = false, search = '', local = {}, localThrows = false } = {}) {
  const sent = [];
  const session = Object.fromEntries(sessionHas.map(k => ['aceoma_ev_' + k, '1']));
  const store = { ...local };
  const env = {
    st: { authUser },
    FN: noFN ? null : { httpsCallable: name => { if (callableThrows) throw new Error('sem rede'); return payload => { sent.push([name, payload]); return callableRejects ? Promise.reject(new Error('falhou')) : Promise.resolve({ data: { ok: true } }); }; } },
    sessionStorage: sessionThrows
      ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); } }
      : { getItem: k => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); } },
    location: { search },
    localStorage: localThrows
      ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); }, removeItem() { throw new Error('indisponível'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  };
  const names = Object.keys(env);
  const api = new Function(...names, trackCode + '\nreturn { trackEvent, trackSeen, trackRef };')(...names.map(n => env[n]));
  return { api, sent, session, store };
}

let t = makeTrack();
t.api.trackEvent('planBannerSeen');
check('manda o evento ao servidor: só o NOME, nada da pessoa (nem uid, nem e-mail)', JSON.stringify(t.sent) === JSON.stringify([['trackEvent', { name: 'planBannerSeen' }]]), t.sent);
t.api.trackEvent('planBannerSeen');
check('o mesmo evento na mesma sessão não é mandado de novo (conta pessoas, não redesenhos)', t.sent.length === 1);
t.api.trackEvent('planBannerClick', false); t.api.trackEvent('planBannerClick', false);
check('evento "de toque" (once = false) conta cada toque', t.sent.filter(s => s[1].name === 'planBannerClick').length === 2);
t = makeTrack({ sessionHas: ['installBannerSeen'] });
t.api.trackEvent('installBannerSeen');
check('já contado nesta aba (a página recarregou): não conta de novo', t.sent.length === 0);
t = makeTrack({ sessionThrows: true });
t.api.trackEvent('installBannerSeen'); t.api.trackEvent('installBannerSeen');
check('sem armazenamento da sessão (modo privado): ainda conta uma vez só', t.sent.length === 1);
check('sem login: nada é mandado', (() => { const x = makeTrack({ authUser: null }); x.api.trackEvent('planBannerSeen'); return x.sent.length === 0; })());
check('sem conexão com o servidor (FN ausente): nada quebra e nada é mandado', (() => { const x = makeTrack({ noFN: true }); x.api.trackEvent('planBannerSeen'); return x.sent.length === 0; })());
let threw = false; try { makeTrack({ callableThrows: true }).api.trackEvent('x'); } catch (e) { threw = true; }
check('o servidor falha na hora de montar a chamada: não quebra o app', !threw);
threw = false; try { makeTrack({ callableRejects: true }).api.trackEvent('x'); } catch (e) { threw = true; }
check('o servidor responde erro: não quebra o app (e não gera erro solto)', !threw);
const els = [{ dataset: { ev: 'planBannerSeen' } }, { dataset: { ev: 'installBannerSeen' } }, { dataset: {} }];
t = makeTrack();
t.api.trackSeen({ querySelectorAll: sel => (sel === '[data-ev]' ? els.filter(e => e.dataset.ev) : []) });
check('trackSeen conta cada faixa marcada que apareceu na área desenhada', JSON.stringify(t.sent.map(s => s[1].name)) === JSON.stringify(['planBannerSeen', 'installBannerSeen']), t.sent);
t.api.trackSeen(null); t.api.trackSeen({});
check('trackSeen com área vazia ou estranha não quebra', true);

// ── link de cartão compartilhado (?ref=cartao) ─────────────────────────────────────────────────
t = makeTrack({ search: '?ref=cartao' });
check('?ref=cartao na página: guarda a origem (só isso, nada da pessoa)', t.store.aceoma_ref === 'cartao' && t.sent.length === 0, t.store);
t = makeTrack({ search: '?liga=a&ref=cartao&invite=x' });
check('?ref=cartao junto de outros parâmetros (convite): também é guardado', t.store.aceoma_ref === 'cartao');
for (const search of ['', '?ref=outra', '?ref=', '?ref=CARTAO', '?x=cartao', '?ref=cartao%20']) {
  check(`só o valor conhecido vale: "${search}" não guarda nada`, makeTrack({ search }).store.aceoma_ref === undefined);
}
t = makeTrack({ search: '?ref=cartao', authUser: null });
t.api.trackSeen({ querySelectorAll: () => [] });
check('ainda sem login: não conta e guarda a origem para depois', t.sent.length === 0 && t.store.aceoma_ref === 'cartao');
t = makeTrack({ search: '?ref=cartao' });
t.api.trackSeen({ querySelectorAll: () => [] });
check('já logado: conta UMA entrada pelo cartão (cardVisit), sem nada da pessoa, e apaga a marca', JSON.stringify(t.sent) === JSON.stringify([['trackEvent', { name: 'cardVisit' }]]) && t.store.aceoma_ref === undefined, { sent: t.sent, store: t.store });
t.api.trackSeen({ querySelectorAll: () => [] }); t.api.trackRef();
check('…e não conta de novo nas próximas telas', t.sent.length === 1);
t = makeTrack({ local: { aceoma_ref: 'qualquer-coisa' } });
t.api.trackRef();
check('marca adulterada no armazenamento: ignorada, nada é contado', t.sent.length === 0);
t = makeTrack({ search: '?ref=cartao', noFN: true });
t.api.trackRef();
check('sem conexão com o servidor: não conta e não perde a marca', t.sent.length === 0 && t.store.aceoma_ref === 'cartao');
threw = false; try { const x = makeTrack({ search: '?ref=cartao', localThrows: true }); x.api.trackRef(); x.api.trackSeen({ querySelectorAll: () => [] }); } catch (e) { threw = true; }
check('armazenamento indisponível (modo privado): nada quebra', !threw);

// ── origem da entrada: todos os canais da tabela (?ref=whatsapp, instagram, resumo…) ─────────────
check('a tabela de canais do app tem o cartão (cardVisit, que já existia) e os 10 novos (whatsapp, grupos, instagram, tiktok, facebook, youtube, arena, indicacao, resumo, anuncio)', Object.keys(REF_EVENTS).length === 11 && REF_EVENTS.cartao === 'cardVisit' && ['whatsapp', 'grupos', 'instagram', 'tiktok', 'facebook', 'youtube', 'arena', 'indicacao', 'resumo', 'anuncio'].every(c => REF_EVENTS[c] === 'ref' + c[0].toUpperCase() + c.slice(1)), REF_EVENTS);
check('a tabela de canais do app é IGUAL à do servidor (um canal só do app seria recusado pelo servidor; um só do servidor nunca seria contado)', JSON.stringify(Object.entries(REF_EVENTS).sort()) === JSON.stringify(Object.entries(funnel.REF_EVENTS).sort()), { app: REF_EVENTS, servidor: funnel.REF_EVENTS });
check('todo evento da tabela está na lista de eventos que o servidor aceita do app (e nenhum é dos que só o servidor conta)', Object.values(REF_EVENTS).every(n => funnel.EVENT_NAMES_CLIENT.includes(n) && !funnel.EVENT_NAMES_SERVER.includes(n)));
for (const [ref, ev] of Object.entries(REF_EVENTS)) {
  t = makeTrack({ search: '?ref=' + ref });
  const guardou = t.store.aceoma_ref === ref && t.sent.length === 0;
  t.api.trackSeen({ querySelectorAll: () => [] });
  check(`?ref=${ref}: guarda a origem e, já logado, conta UMA entrada em ${ev} (só o nome do evento, nada da pessoa) e apaga a marca`, guardou && JSON.stringify(t.sent) === JSON.stringify([['trackEvent', { name: ev }]]) && t.store.aceoma_ref === undefined, { sent: t.sent, store: t.store });
}
for (const search of ['?ref=__proto__', '?ref=constructor', '?ref=toString', '?ref=hasOwnProperty', '?ref=refWhatsapp', '?ref=cardVisit', '?ref=Instagram', '?ref=insta', '?ref=whatsapp%20', '?ref=%20whatsapp', '?utm_source=whatsapp', '?ref[]=whatsapp']) {
  check(`origem desconhecida ou fora do formato ("${search}"): não guarda nada`, makeTrack({ search }).store.aceoma_ref === undefined);
}
for (const falso of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'refWhatsapp', 'cardVisit', 'Instagram', 'insta', '']) {
  t = makeTrack({ local: { aceoma_ref: falso } });
  t.api.trackRef();
  check(`marca adulterada no armazenamento ("${falso}"): ignorada, nada é contado`, t.sent.length === 0, t.sent);
}
t = makeTrack({ search: '?ref=instagram', local: { aceoma_ref: 'whatsapp' } });
check('a última origem vale: abrir um link do Instagram depois de um do WhatsApp troca a marca', t.store.aceoma_ref === 'instagram', t.store);
t = makeTrack({ search: '?ref=lixo', local: { aceoma_ref: 'whatsapp' } });
check('um ?ref desconhecido não apaga a origem boa já guardada', t.store.aceoma_ref === 'whatsapp', t.store);
t = makeTrack({ search: '?ref=instagram', authUser: null });
t.api.trackSeen({ querySelectorAll: () => [] });
check('ainda sem login: o canal fica guardado para depois e nada é contado', t.sent.length === 0 && t.store.aceoma_ref === 'instagram', { sent: t.sent, store: t.store });
t = makeTrack({ search: '?ref=whatsapp', noFN: true });
t.api.trackRef();
check('sem conexão com o servidor: não conta e não perde o canal', t.sent.length === 0 && t.store.aceoma_ref === 'whatsapp', { sent: t.sent, store: t.store });
t = makeTrack({ search: '?liga=a&ref=grupos&invite=x' });
check('?ref= junto de outros parâmetros (convite): também é guardado', t.store.aceoma_ref === 'grupos', t.store);
t = makeTrack({ search: '?ref=resumo' });
t.api.trackSeen({ querySelectorAll: () => [] }); t.api.trackSeen({ querySelectorAll: () => [] }); t.api.trackRef();
check('…e conta uma vez só, não importa quantas telas se desenhem depois', t.sent.length === 1 && t.sent[0][1].name === 'refResumo', t.sent);

// ── painel do dono ──────────────────────────────────────────────────────────────────────────────
function makePanel({ authUser = { email: 'castanho.caiop@gmail.com', emailVerified: true }, callFn = async () => ({}) } = {}) {
  const layerList = [];
  const doc = {
    getElementById: id => { const el = layerList.find(x => x.id === id); return el ? Object.assign(el, { remove: () => { const i = layerList.indexOf(el); if (i >= 0) layerList.splice(i, 1); } }) : null; },
    createElement: () => { const el = { id: '', className: '', innerHTML: '', remove() { const i = layerList.indexOf(el); if (i >= 0) layerList.splice(i, 1); } }; return el; },
    body: { appendChild: el => layerList.push(el) },
  };
  const calls = { callFn: [] };
  const env = { st: { authUser }, callFn: async (n, d) => { calls.callFn.push(n); return callFn(n, d); }, esc, document: doc, REF_EVENTS };
  const names = Object.keys(env);
  const api = new Function(...names, panelCode + '\nreturn { isSystemOwner, ownerMetricsHtml, openOwnerMetrics };')(...names.map(n => env[n]));
  return { api, layerList, calls };
}
const SAMPLE = {
  funnel: {
    generatedAt: '2026-10-20T15:00:00.000Z',
    accounts: { total: 40, last7d: 6, last30d: 15, ownersOfLeagues: 5 },
    leagues: { total: 7, last7d: 2, last30d: 3, withGame: 6, active14d: 5, sawOffer: 5, checkoutStarted: 3, everPaid: 3 },
    states: { inTrial: 2, trialEndingSoon: 1, free: 1, legacy: 1, monthlyActive: 1, monthlyCancelled: 0, annualActive: 1, paidUnknown: 0, expiredPaid: 1 },
    trialCohort: { ended: 4, convertedAmongEnded: 3 },
    rates: { accountToLeagueOwner: 12.5, leagueToGame: 85.7, leagueActive14d: 71.4, trialToPaid: 75 },
    revenue: { mrr: 49.8, monthlyMrr: 29.9, annualMrr: 19.9, prices: { monthly: 29.9, annual: 238.8 } },
  },
  events: { last7d: { planBannerSeen: 8, planBannerClick: 2, subscriptionOpened: 3, checkoutMonthly: 1, checkoutAnnual: 0, installBannerSeen: 20, installClick: 5, appInstalled: 2, cardOpen: 6, cardShare: 4, cardVisit: 1, pixOpen: 10, pixCopy: 7, refWhatsapp: 5, refInstagram: 2, refResumo: 1 }, last30d: { planBannerSeen: 40, planBannerClick: 10, subscriptionOpened: 12, checkoutMonthly: 2, checkoutAnnual: 1, installBannerSeen: 90, installClick: 18, appInstalled: 7, cardOpen: 25, cardShare: 20, cardVisit: 3, pixOpen: 40, pixCopy: 30, refWhatsapp: 12, refInstagram: 6, refResumo: 3 } },
  history: [{ date: '2026-10-18', accounts: 38, leagues: 6, mrr: 29.9, monthlyActive: 1 }, { date: '2026-10-19', accounts: 39, leagues: 7, mrr: 49.8, monthlyActive: 1 }, { date: '2026-10-20', accounts: 40, leagues: 7, mrr: 49.8, monthlyActive: 1 }],
};

check('dono do sistema (e-mail do dono, verificado): isSystemOwner', makePanel().api.isSystemOwner() === true);
check('e-mail do dono SEM verificação: não é o dono', makePanel({ authUser: { email: 'castanho.caiop@gmail.com', emailVerified: false } }).api.isSystemOwner() === false);
check('outra pessoa: não é o dono', makePanel({ authUser: { email: 'outra@pessoa.com', emailVerified: true } }).api.isSystemOwner() === false);
check('sem login: não é o dono', makePanel({ authUser: null }).api.isSystemOwner() === false);

const out = makePanel().api.ownerMetricsHtml(SAMPLE);
// Cada linha do painel é [rótulo, dica, valor]: lê pela estrutura (a ordem do texto corrido na tela não importa).
function rowsOf(h) {
  const R = {};
  const re = /<span style="color:var\(--text2\);min-width:0">([^<]*)(?:<span[^>]*>([^<]*)<\/span>)?<\/span>\s*<b[^>]*>([\s\S]*?)<\/b>/g;
  let m;
  while ((m = re.exec(h))) R[m[1].trim()] = { hint: (m[2] || '').trim(), value: m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() };
  return R;
}
const R = rowsOf(out);
const text = out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('o painel mostra as contas e ligas com a variação de 7 e 30 dias', R['Contas criadas']?.value === '40' && R['Contas criadas'].hint === '+6 em 7 dias · +15 em 30 dias' && R['Ligas criadas']?.value === '7' && R['Ligas criadas'].hint === '+2 em 7 dias · +3 em 30 dias', R);
check('…as taxas em português, com vírgula (12,5%, 85,7%, 71,4%, 75%)', /^12,5% das contas/.test(R['Contas que criaram uma liga']?.hint) && R['Ligas com pelo menos 1 campeonato']?.hint === '85,7% das ligas' && R['Ligas usadas nos últimos 14 dias']?.hint === '71,4% das ligas' && R['Conversão do teste']?.value === '75%', R);
check('…a conversão do teste explica a base (3 de 4 ligas com teste encerrado)', /3 de 4 ligas com teste encerrado/.test(R['Conversão do teste']?.hint), R['Conversão do teste']);
check('…o funil: contas que criaram liga, com jogo, usadas, reta final, checkout e pagaram', R['Contas que criaram uma liga']?.value === '5' && R['Ligas com pelo menos 1 campeonato']?.value === '6' && R['Ligas usadas nos últimos 14 dias']?.value === '5' && R['Ligas que chegaram à reta final do teste']?.value === '5' && R['Ligas que iniciaram o checkout']?.value === '3' && R['Ligas que já pagaram']?.value === '3', R);
check('…o teste grátis: em teste, acabando em 3 dias, gratuito e antigas', R['Em teste agora']?.value === '2' && /^1 acabam em até 3 dias/.test(R['Em teste agora'].hint) && R['Plano gratuito']?.value === '1' && R['Ligas antigas, sem teste']?.value === '1', R);
check('…a receita em reais no formato brasileiro (R$ 49,80 = R$ 29,90 + R$ 19,90)', R['Receita mensal estimada']?.value === 'R$ 49,80' && /mensais R\$ 29,90 \+ anuais R\$ 19,90/.test(R['Receita mensal estimada'].hint), R['Receita mensal estimada']);
check('…os planos: mensal, cancelado, anual e vencido', R['Plano mensal ativo']?.value === '1' && R['Plano mensal cancelado']?.value === '0' && R['Plano anual ativo']?.value === '1' && R['Plano pago vencido']?.value === '1', R);
check('…o uso do app em 7 e 30 dias (7 / 30)', R['Viram a faixa do plano']?.value === '8 / 40' && R['Tocaram na faixa do plano']?.value === '2 / 10' && R['Viram a faixa Instalar']?.value === '20 / 90' && R['Instalaram o app']?.value === '2 / 7' && R['Checkout anual criado']?.value === '0 / 1' && R['Abriram a tela 💳 Assinatura']?.value === '3 / 12', R);
check('…o cartão do jogador: aberturas, compartilhamentos (com a taxa de 80%) e entradas pelo link (7 / 30)', R['Abriram o cartão do jogador']?.value === '6 / 25' && R['Compartilharam o cartão']?.value === '4 / 20' && /^80% dos que abriram compartilharam/.test(R['Compartilharam o cartão']?.hint) && R['Entraram por um link de cartão']?.value === '1 / 3', { a: R['Abriram o cartão do jogador'], b: R['Compartilharam o cartão'], c: R['Entraram por um link de cartão'] });
check('…a origem das entradas: um grupo com os 10 canais, cada um com a chave do ?ref= na dica e o valor 7 / 30 (WhatsApp 5 / 12, Instagram 2 / 6, resumo 1 / 3, os demais 0 / 0)', /Origem das entradas \(7 dias \/ 30 dias\)/.test(text) && R['WhatsApp (mensagem direta)']?.value === '5 / 12' && R['WhatsApp (mensagem direta)'].hint === '?ref=whatsapp' && R['Instagram']?.value === '2 / 6' && R['Instagram'].hint === '?ref=instagram' && R['Resumo do campeonato no grupo']?.value === '1 / 3' && R['Resumo do campeonato no grupo'].hint === '?ref=resumo' && ['Grupos e comunidades', 'TikTok', 'Facebook', 'YouTube', 'Arenas e quadras', 'Indicação de jogador', 'Anúncios pagos'].every(l => R[l]?.value === '0 / 0'), Object.fromEntries(Object.entries(R).filter(([k]) => /WhatsApp|Instagram|Resumo|Grupos|TikTok|Facebook|YouTube|Arenas|Indicação|Anúncios/.test(k))));
check('…todo canal da tabela (menos o cartão, que fica em Uso do app) tem a sua linha no painel, com a chave certa', Object.keys(REF_EVENTS).filter(c => c !== 'cartao').every(c => Object.values(R).some(r => r.hint === '?ref=' + c)), Object.values(R).map(r => r.hint));
check('…a explicação do grupo diz que conta quem entrou no app pelo link, inclusive quem já tinha conta, e que o cartão fica em Uso do app', /inclui quem já tinha conta/.test(text) && /O link do cartão do jogador aparece acima, em Uso do app/.test(text), text.slice(text.indexOf('Origem das entradas'), text.indexOf('Origem das entradas') + 300));
check('…o PIX copia e cola: quantos abriram a tela e quantos copiaram o código (com a taxa de 75%) (7 / 30)', R['Abriram o Pagar com PIX']?.value === '10 / 40' && R['Copiaram o código PIX']?.value === '7 / 30' && /^75% dos que abriram copiaram o código/.test(R['Copiaram o código PIX']?.hint), { a: R['Abriram o Pagar com PIX'], b: R['Copiaram o código PIX'] });
check('…as taxas de toque: 25% na faixa do plano e 20% em Instalar (30 dias)', /^25% das sessões que viram a faixa tocaram nela/.test(R['Tocaram na faixa do plano']?.hint) && /^20% tocaram em Instalar/.test(R['Tocaram em Instalar']?.hint), { a: R['Tocaram na faixa do plano'], b: R['Tocaram em Instalar'] });
check('…a evolução desenhada (3 retratos → 4 gráficos de linha) com o primeiro e o último valor', (out.match(/<polyline/g) || []).length === 4 && /38 → 40/.test(text) && /R\$ 29,90 → R\$ 49,80/.test(text), { linhas: (out.match(/<polyline/g) || []).length });
check('…nenhum "undefined", "NaN" ou "null" na tela', !/undefined|NaN|null/.test(out), out.match(/.{20}(undefined|NaN|null).{20}/)?.[0]);
const semHist = makePanel().api.ownerMetricsHtml({ ...SAMPLE, history: [{ date: '2026-10-20', accounts: 40, leagues: 7, mrr: 49.8 }] });
check('com só 1 retrato: explica que a evolução começa no segundo dia, sem gráfico', /a partir do segundo dia/.test(semHist) && !/<polyline/.test(semHist));
const vazio = makePanel().api.ownerMetricsHtml({ funnel: { accounts: {}, leagues: {}, states: {}, rates: { accountToLeagueOwner: null, leagueToGame: null, leagueActive14d: null, trialToPaid: null }, trialCohort: {}, revenue: {} }, events: { last7d: {}, last30d: {} }, history: [] });
check('banco vazio: zeros, taxas "—" (nunca "0%" enganoso), R$ 0,00 e sem erro', rowsOf(vazio)['Conversão do teste']?.value === '—' && rowsOf(vazio)['Receita mensal estimada']?.value === 'R$ 0,00' && rowsOf(vazio)['Contas criadas']?.value === '0' && !/undefined|NaN|null/.test(vazio), rowsOf(vazio));
check('resposta totalmente vazia ou estranha não quebra o painel', (() => { try { makePanel().api.ownerMetricsHtml(undefined); makePanel().api.ownerMetricsHtml({}); makePanel().api.ownerMetricsHtml({ funnel: null }); return true; } catch (e) { return false; } })());
check('o painel só mostra números: nenhum campo de texto livre da resposta vai para a tela', !/<script|onerror|javascript:/i.test(makePanel().api.ownerMetricsHtml({ ...SAMPLE, funnel: { ...SAMPLE.funnel, generatedAt: '<script>alert(1)</script>' } })));

(async () => {
  // abrir o painel
  let p = makePanel({ authUser: { email: 'outra@pessoa.com', emailVerified: true } });
  await p.api.openOwnerMetrics();
  check('quem não é o dono: nada abre e o servidor nem é chamado', p.layerList.length === 0 && p.calls.callFn.length === 0);

  let release; const slow = new Promise(r => { release = r; });
  p = makePanel({ callFn: async () => { await slow; return SAMPLE; } });
  const opening = p.api.openOwnerMetrics();
  check('dono: a camada abre na hora com "Calculando…"', p.layerList.length === 1 && /Calculando/.test(p.layerList[0].innerHTML) && p.layerList[0].id === 'owner-metrics' && p.layerList[0].className === 'overlay');
  release(); await opening;
  check('…e quando a resposta chega mostra as métricas (duas chamadas ao servidor, juntas: o funil e os erros do app)', /Métricas do sistema/.test(p.layerList[0].innerHTML) && /R\$ 49,80/.test(p.layerList[0].innerHTML) && JSON.stringify(p.calls.callFn) === JSON.stringify(['getFunnelMetrics', 'getClientErrors']), p.calls);
  await p.api.openOwnerMetrics();
  check('abrir de novo não duplica a camada', p.layerList.length === 1);

  p = makePanel({ callFn: async () => { throw new Error('Só o dono do sistema vê as métricas. <b>x</b>'); } });
  await p.api.openOwnerMetrics();
  check('erro do servidor: mostra a mensagem na camada, com o texto escapado', /Só o dono do sistema vê as métricas/.test(p.layerList[0].innerHTML) && /&lt;b&gt;x&lt;\/b&gt;/.test(p.layerList[0].innerHTML) && !/<b>x<\/b>/.test(p.layerList[0].innerHTML));

  let release2; const slow2 = new Promise(r => { release2 = r; });
  p = makePanel({ callFn: async () => { await slow2; return SAMPLE; } });
  const op2 = p.api.openOwnerMetrics();
  p.layerList[0].remove(); // a pessoa fechou antes de carregar
  release2(); await op2;
  check('fechou antes de carregar: a camada não ressuscita quando a resposta chega', p.layerList.length === 0);

  // ── onde aparecem os botões do painel e os contadores ───────────────────────────────────────
  const shell = html.slice(html.indexOf('function buildShell()'), html.indexOf('/* ── ranking filter helpers'));
  check('o botão 📊 do topo só existe para o dono do sistema', /\$\{isSystemOwner\(\)\?`<button onclick="openOwnerMetrics\(\)"/.test(shell) && /title="Métricas do sistema">📊/.test(shell));
  const picker = html.slice(html.indexOf('function vSelectLeague()'), html.indexOf('function vPending()'));
  check('a escolha de liga tem o atalho "Métricas do sistema", só para o dono', /isSystemOwner\(\) \? `/.test(picker) && /openOwnerMetrics\(\)/.test(picker) && /📊 Métricas do sistema/.test(picker));
  const login = html.slice(html.indexOf('function vLogin()'), html.indexOf('function slugify('));
  check('a tela de login não tem nada do painel nem contadores', !/openOwnerMetrics|trackEvent|data-ev/.test(login));
  check('o render conta as faixas que apareceram, no topo da liga e na escolha de liga', /trackSeen\(main\)/.test(html) && /trackSeen\(app\)/.test(html));
  check('a política de privacidade do app cita os contadores anônimos', /Uso do app:<\/strong> contadores anônimos/.test(html));
  check('…e diz que entre eles está por qual tipo de link as pessoas chegaram (WhatsApp, Instagram), sem identificar quem foi', /por qual tipo de link as pessoas chegaram, como WhatsApp ou Instagram\), sem identificar quem foi/.test(html));
  const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8');
  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const sec28 = plainM(manual.slice(manual.indexOf('id="metricas-funil"'), manual.indexOf('<!-- 29. Cartão do Jogador')));
  check('manual (seção 28): a subseção "Origem das entradas" explica o ?ref=<canal>, que o valor é em minúsculas e exatamente o da tabela, e que o grupo do painel mostra 7 e 30 dias', /Origem das entradas/.test(sec28) && /\?ref= <canal>|\?ref=<canal>/.test(sec28) && /exatamente assim, em minúsculas/.test(sec28) && /em 7 e 30 dias/.test(sec28), sec28.slice(sec28.indexOf('Origem das entradas'), sec28.indexOf('Origem das entradas') + 300));
  check('…a tabela lista TODOS os canais do app (' + Object.keys(REF_EVENTS).join(', ') + ') com o link exato', Object.keys(REF_EVENTS).every(c => sec28.includes('?ref=' + c)), Object.keys(REF_EVENTS).filter(c => !sec28.includes('?ref=' + c)));
  check('…e os nomes dos contadores do painel batem com o que está escrito (WhatsApp (mensagem direta), Grupos e comunidades, Resumo do campeonato no grupo…)', ['WhatsApp (mensagem direta)', 'Grupos e comunidades', 'Instagram, TikTok, Facebook, YouTube', 'Arenas e quadras', 'Indicação de jogador', 'Anúncios pagos', 'Resumo do campeonato no grupo'].every(n => sec28.includes(n)));
  check('…explica que conta pessoas que entraram no app (inclui quem já tinha conta), vale o último link, a convocação não leva ?ref= e só o nome do canal vai ao servidor', /pessoas que entraram no app/.test(sec28) && /inclui quem já tinha conta/.test(sec28) && /vale o último link aberto/.test(sec28) && /mensagem de convocação não leva \?ref=/.test(sec28) && /Só o nome do canal vai ao servidor, nunca a pessoa/.test(sec28), sec28.slice(sec28.indexOf('pessoas que entraram'), sec28.indexOf('pessoas que entraram') + 500));
  check('manual (seção 28, técnico): diz que a tabela REF_EVENTS existe no app e no servidor e que um teste confere que são idênticas', /REF_EVENTS/.test(sec28) && /um teste confere que são idênticas/.test(sec28));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
