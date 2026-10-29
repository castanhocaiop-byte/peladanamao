// Rival (item 36), o frente a frente, as telas novas e as badges: as contas do frente a frente (retrospecto contra o rival, carrasco e freguês, as 4 badges), a aba Frente a frente,
// a aba Duelo do mês (o que mostra em cada situação), os avisos (Rivalidade declarada e Alvo da Galera), o alerta ao trocar ou tirar o rival, o aviso na escolha, o cartão do duelo,
// o catálogo das 17 badges novas (regras e quando aparecem) e as ligações no app. O código é o REAL do index.html (fatiado e executado com um aplicativo falso e um relógio falso
// no horário de Brasília). As contas do duelo do mês e o envio do progresso ao servidor estão no client-rival-duel-test.js.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const rivalCode = slice('/* ── Rival ─', 'function closeModal()');
const eligCode = slice('function badgeEligibleCount(b) {', 'function goallessStreak(');
const keyCode = slice('const playerKey = name =>', '\n\n');
const escCode = slice('const esc = s =>', 'function toast(');
const tierCode = slice('const MJ_TIERS = {', 'let _mjBlobs');
const h2hOnCode = slice('function h2hOn() {', '\n');
const voteCode = slice('const VOTE_DAYS = 3;', 'function votingUsed(cat) {'); // a votação de destaques de verdade (o fechamento do mês espera por ela)

// ── o relógio: o aparelho está no horário de Brasília (UTC−3) ──
const RealDate = Date;
const clock = { now: 0 };
const OFFSET = -3 * 3600000;
const shifted = d => new RealDate(d.getTime() + OFFSET);
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock.now); }
  static now() { return clock.now; }
  getFullYear() { return shifted(this).getUTCFullYear(); }
  getMonth() { return shifted(this).getUTCMonth(); }
  getDate() { return shifted(this).getUTCDate(); }
}

// ── jogadores e campeonatos de mentira ──
const PLAYERS = [{ name: 'Ana' }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Gil', goleiro: true }];
const mt = (home, away, hs, as, goals = [], phase = 'regular') => ({ phase, home, away, hs, as, played: true, goals: goals.map(p => ({ player: p })) });
// um campeonato de times pequenos e uma fila de resultados do azul contra o verde: W = azul ganha, D = empate, L = azul perde
const sr = (id, date, azul, verde, results, o = {}) => ({
  id, date, status: o.status || 'completed', freeMode: !!o.free, champion_players: [],
  teamRosters: o.noRosters ? undefined : { azul, verde, ...(o.extra || {}) },
  matches: results.split('').map((r, i) => ({ ...mt('azul', 'verde', r === 'W' ? 2 : r === 'D' ? 1 : 0, r === 'L' ? 2 : r === 'D' ? 1 : 0, (o.goals || [])[i] || []), played: o.played !== false })),
});
// os dois no mesmo time (jogos, títulos e % de vitórias iguais): quem decide o duelo são os gols, o artilheiro, a presença e os destaques
const same = (id, date, o = {}) => ({ id, date, status: 'completed', freeMode: false, teamRosters: o.rosters || { azul: ['Ana', 'Bruno'], verde: ['Carla', 'Gil'] },
  champion_players: (o.champ || ['Ana', 'Bruno']).map(n => ({ name: n, weight: 1 })), _awards: o.awards || null, matches: [mt('azul', 'verde', 2, 1, o.goals || []), mt('verde', 'azul', 0, 1)] });
// o Bruno leva tudo no mês: o time dele ganha os 4 jogos e é campeão das 2, e ele faz os gols
const brunoLeva = (p, d1, d2) => [
  { id: p + '1', date: d1, status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Carla'], verde: ['Bruno', 'Gil'] }, champion_players: [{ name: 'Bruno', weight: 1 }, { name: 'Gil', weight: 1 }], matches: [mt('verde', 'azul', 2, 0, ['Bruno', 'Bruno']), mt('azul', 'verde', 0, 1, ['Bruno'])] },
  { id: p + '2', date: d2, status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Carla'], verde: ['Bruno', 'Gil'] }, champion_players: [{ name: 'Bruno', weight: 1 }, { name: 'Gil', weight: 1 }], matches: [mt('verde', 'azul', 3, 0, ['Bruno', 'Bruno', 'Gil']), mt('azul', 'verde', 0, 1, ['Bruno'])] },
];
const ISO = d => `${d}T12:00:00.000Z`;

// ── as linhas do catálogo, executadas de verdade (as 18 badges novas) ──
const NEW_IDS = ['carrasco', 'fregues', 'tira_teima', 'classico', 'alvo_galera', 'inimigo_publico', 'rival_declarada', 'duelo_aluno', 'duelo_fora_liga', 'duelo_mao', 'duelo_trator', 'duelo_dono', 'duelo_sombra', 'rival_passou', 'rival_ultrapassada', 'rival_3m', 'rival_6m', 'rival_12m'];
const entryLine = id => (html.match(new RegExp(`^ {2}\\{ id:'${id}'.*\\},$`, 'm')) || [])[0];

function makeEnv({ champs = [], players = PLAYERS, me = 'ana', rival = 'bruno', since = ISO('2026-09-15'), duels = {}, lead = '', mutual = false, pub = {}, now = '2026-11-10T15:00:00.000Z', sim = null,
  noRivalDoc = false, appCfg = {}, confirmAnswers = [], db = {}, fn = null, voting = false, peer = false, groupStars = {}, ready = true, stats = {}, badges = null } = {}) {
  clock.now = RealDate.parse(now);
  const calls = { fn: [], confirms: [], toasts: [], renders: 0, shared: [] };
  let apiRef = null;
  const real = NEW_IDS.map(id => new Function('rivalBadgesShown', 'h2hOn', 'rivalAward', 'return (' + entryLine(id).trim().replace(/,$/, '') + ')')(() => apiRef.rivalBadgesShown(), () => apiRef.h2hOn(), (s, i) => apiRef.rivalAward(s, i)));
  const BASE = ['b1', 'b2', 'b3', 'b4'].map(id => ({ id, emoji: '⭐', label: id, desc: id }));
  const st = { authUser: { uid: 'u1' }, leagueId: 'liga1', userDoc: { playerKey: me }, players, champs, ranks: [], availableLeagues: [{ id: 'liga1', name: 'Liga X' }], photos: {}, modal: null, mjPreviewKey: sim, appCfg,
    rivalDoc: noRivalDoc ? null : { ownKey: me, rivalKey: rival, since, mutual, lead, duels }, rivalReady: ready, rivalPubReady: ready, rivalPublic: pub, playersReady: ready, ranksReady: ready, cfgReady: ready, ready };
  const answers = [...confirmAnswers];
  const env = {
    st, DB: db, callFn: async (n, d) => { calls.fn.push([n, JSON.parse(JSON.stringify(d))]); if (fn) return fn(n, d); return n === 'setRival' ? { ok: true, rivalKey: d.rivalKey, since: '2026-11-10T15:00:00.000Z', mutual: false } : { ok: true }; },
    toast: m => { calls.toasts.push(m); }, render: () => { calls.renders++; }, localStorage: { getItem: () => null, setItem() {} },
    confirm: msg => { calls.confirms.push(msg); return answers.length ? answers.shift() : true; }, Date: FakeDate,
    BADGE_CATALOG: [...BASE, ...real], getBadgeCache: () => ({ playerBadges: badges || { Ana: ['b1', 'b2'], Bruno: ['b1'], Carla: [], Gil: [] }, badgeHolders: {}, playerStats: Object.fromEntries(players.map(p => [p.name, { champsPlayed: 0, totalGoals: 0, myArt: 0, ...(stats[p.name] || {}) }])) }),
    votingUsed: () => voting, peerStarsOn: () => peer, starsInfo: p => (groupStars[p.name] != null ? { value: groupStars[p.name], source: 'avg' } : { value: 0, source: 'admin' }), starsText: n => String(n).replace('.', ','),
    getChampAwards: c => c._awards || null, openMjShare: (kind, data) => { calls.shared.push([kind, data]); return 'aberto'; }, mjRivalNumData: s => ({ ...s, _numdata: true }),
    pixCopyText: async () => true, document: { querySelectorAll: () => [] },
  };
  const names = Object.keys(env);
  const body = escCode + '\n' + keyCode + '\n' + eligCode + '\n' + tierCode + '\n' + voteCode + '\n' + h2hOnCode + '\n' + rivalCode + `
return { h2hOn, h2hGoals, h2hRecord, h2hAgainstAll, h2hFlags, h2hExtremes, rivalH2H, rivalH2HView, rivalDuelView, rivalNotices, rivalLossText, rivalConfirmLoss, rivalResLabel, rivalPickNote,
  rivalChangeLoss, rivalTab, mRival, rivalPick, rivalRemove, rivalChange, openRival, openMjRivalDuel, rivalSync, rivalStrip, rivalBadgesShown, rivalPublicStats, rivalAward, RIVAL_ONLY_IDS,
  rivalBadgeIds, rivalGet, rivalSet, rivalPlayer, rivalCandidates, rivalVisible, rivalAwardsOf, rivalDuelFor, monthLabel, monthShift, localDate };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  apiRef = api;
  return { api, env, calls, st };
}
const tick = () => new Promise(r => setTimeout(r, 15));
const plain = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();

(async () => {
  // ══ 1. O RETROSPECTO CONTRA UM JOGADOR (só jogos em times OPOSTOS) ═══════════════════════════════════
  const H = makeEnv().api;
  const c1 = sr('h1', '2026-10-07', ['Ana'], ['Bruno'], 'WWDL');                    // Ana (azul): 2 vitórias, 1 empate, 1 derrota
  const c2 = sr('h2', '2026-10-14', ['Bruno'], ['Ana'], 'WWW');                     // Ana (verde): o azul do Bruno vence 3 → 3 derrotas dela
  const c3 = sr('h3', '2026-10-21', ['Ana', 'Bruno'], ['Carla'], 'WWWW');           // no MESMO time: não conta
  const c4 = sr('h4', '2026-10-28', ['Ana'], ['Bruno'], 'WWW', { played: false });  // jogos não disputados: não contam
  const c5 = { id: 'h5', date: '2026-11-04', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'], branco: ['Carla'] }, matches: [mt('azul', 'branco', 5, 0), mt('verde', 'branco', 3, 0), mt('verde', 'azul', 1, 0)] }; // só o último jogo é entre os dois: Ana perde
  const c6 = sr('h6', '2026-11-05', ['Ana'], ['Bruno'], 'WWW', { noRosters: true }); // sem elenco registrado: não conta
  const rec = H.h2hRecord([c1, c2, c3, c4, c5, c6], 'Ana', 'Bruno');
  check('retrospecto da Ana contra o Bruno: só jogos disputados entre times opostos (2 vitórias, 1 empate, 5 derrotas em 8 jogos); mesmo time, jogo não disputado, jogo de outros times e campeonato sem elenco ficam de fora', rec.w === 2 && rec.d === 1 && rec.l === 5 && rec.games === 8 && rec.ga === 0 && rec.gb === 0, rec);
  const inv = H.h2hRecord([c1, c2, c3, c4, c5, c6], 'Bruno', 'Ana');
  check('visto do outro lado é o espelho (5 vitórias, 1 empate, 2 derrotas); jogador que não está no elenco de nenhum campeonato, ou o mesmo jogador dos dois lados, dá zero', inv.w === 5 && inv.d === 1 && inv.l === 2 && inv.games === 8 && H.h2hRecord([c1], 'Ana', 'Fulano').games === 0 && H.h2hRecord([c1], 'Fulano', 'Bruno').games === 0 && H.h2hRecord([c1], 'Ana', 'Ana').games === 0 && H.h2hRecord([], 'Ana', 'Bruno').games === 0, [inv]);
  const gc = { id: 'g', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'] }, matches: [
    mt('azul', 'verde', 2, 1, ['Ana', 'Ana', 'Bruno']),
    { phase: 'final', home: 'verde', away: 'azul', hs: 0, as: 1, played: true, goals: [{ player: 'Bruno' }], finalGoals: [{ player: 'Ana' }] },
    { phase: 'final', home: 'azul', away: 'verde', hs: 1, as: 1, played: true, goals: [{ player: 'Bruno' }], finalGoals: [] }] };
  const gr = H.h2hRecord([gc], 'Ana', 'Bruno');
  check('gols nesses jogos: cada um conta os seus; na final valem os gols da final quando existem (a lista da fase regular é ignorada) e, sem eles, os gols do jogo (Ana 3 × 2 Bruno; 2 vitórias e 1 empate)', gr.ga === 3 && gr.gb === 2 && gr.w === 2 && gr.d === 1 && gr.l === 0 && H.h2hGoals(gc.matches[1], 'Ana') === 1 && H.h2hGoals(gc.matches[1], 'Bruno') === 0 && H.h2hGoals(gc.matches[2], 'Bruno') === 1, gr);

  const three = { id: 't', status: 'completed', teamRosters: { azul: ['Ana', 'Gil'], verde: ['Bruno'], branco: ['Carla'] }, matches: [mt('azul', 'verde', 2, 0), mt('azul', 'branco', 1, 1), mt('verde', 'branco', 3, 0)] };
  const all = H.h2hAgainstAll([three], 'Ana');
  check('contra cada um: só quem esteve no time oposto num jogo do time da Ana (o Bruno: 1 vitória; a Carla: 1 empate); o colega de time (Gil) e o jogo entre os outros dois não entram', JSON.stringify(all) === JSON.stringify({ Bruno: { w: 1, d: 0, l: 0 }, Carla: { w: 0, d: 1, l: 0 } }) && JSON.stringify(H.h2hAgainstAll([three], 'Fulano')) === '{}', all);

  // ── as 4 badges do frente a frente: os limites exatos ──
  const flags = results => H.h2hFlags([sr('x', '2026-10-07', ['Ana'], ['Bruno'], results)], 'Ana');
  const F = (r, ...want) => { const f = flags(r), got = [f.h2hCarrasco, f.h2hFregues, f.h2hTiraTeima, f.h2hClassico].map(Boolean); return JSON.stringify(got) === JSON.stringify(want); };
  check('Carrasco: 5 vitórias e 3 a mais do que derrotas contra o mesmo jogador (5-0 vale; 4-0 não; 5-2 vale; 5-3 não; 7-4 vale; 6-4 não)', F('WWWWW', true, false, false, false) && F('WWWW', false, false, false, false) && F('WWWWWLL', true, false, false, false) && F('WWWWWLLL', false, false, false, false) && F('WWWWWWWLLLL', true, false, false, false) && F('WWWWWWLLLL', false, false, false, false));
  check('Freguês: o contrário (5 derrotas e 3 a mais do que vitórias): 0-5 vale; 0-4 não; 2-5 vale; 3-5 não', F('LLLLL', false, true, false, false) && F('LLLL', false, false, false, false) && F('LLLLLWW', false, true, false, false) && F('LLLLLWWW', false, false, false, false));
  check('Tira-teima: as mesmas vitórias e derrotas depois de 6 jogos ou mais (3-3 vale; 2-2-2 com empates vale; 2-2 com 4 jogos não; 3-2-1 não é igual)', F('WWWLLL', false, false, true, false) && F('WWLLDD', false, false, true, false) && F('WWLL', false, false, false, false) && F('WWWLLD', false, false, false, false));
  check('Clássico: 20 jogos ou mais contra o mesmo jogador (20 vale e 19 não); 10-10 é também Tira-teima; 20 vitórias também é Carrasco', F('WL'.repeat(10), false, false, true, true) && F('WL'.repeat(9) + 'D', false, false, true, false) && F('W'.repeat(20), true, false, false, true));
  check('Tira-teima pede 6 jogos: com 5 (2 vitórias, 2 derrotas e 1 empate) ainda não', F('WWLLD', false, false, false, false));
  const dois = [sr('y1', '2026-10-07', ['Ana'], ['Bruno'], 'WWW'), sr('y2', '2026-10-14', ['Ana'], ['Carla'], 'WWW'), sr('y3', '2026-10-21', ['Ana'], ['Gil'], 'WW')];
  const fd = H.h2hFlags(dois, 'Ana');
  check('as contagens são contra o MESMO jogador: 3 + 3 + 2 vitórias contra três pessoas diferentes não somam 5; já 5 vitórias num campeonato contra um time de duas pessoas valem contra as duas', !fd.h2hCarrasco && H.h2hFlags([sr('y4', '2026-10-07', ['Ana'], ['Bruno', 'Carla'], 'WWWWW')], 'Ana').h2hCarrasco === true, fd);

  // ── o carrasco e o freguês ──
  const ex = { id: 'x1', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'], branco: ['Carla'], preto: ['Gil'] },
    matches: [...'WLLLL'.split('').map(r => mt('azul', 'verde', r === 'W' ? 1 : 0, r === 'L' ? 1 : 0)), ...Array.from({ length: 5 }, () => mt('azul', 'branco', 1, 0)), ...Array.from({ length: 2 }, () => mt('azul', 'preto', 1, 0))] };
  const xe = H.h2hExtremes([ex], 'Ana');
  check('carrasco = quem mais ganhou dela (Bruno: 1 vitória × 4 derrotas); freguês = de quem mais ganhou (Carla: 5 × 0); o Gil, com 2 jogos só, não conta (mínimo de 3)', xe.carrasco?.name === 'Bruno' && xe.carrasco.w === 1 && xe.carrasco.l === 4 && xe.carrasco.games === 5 && xe.fregues?.name === 'Carla' && xe.fregues.w === 5 && xe.fregues.l === 0, xe);
  const mk = (first, second) => ({ id: 'x2', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Carla'], branco: ['Bruno'] }, matches: [...Array.from({ length: 3 }, () => mt('azul', first, 0, 1)), ...Array.from({ length: 3 }, () => mt('azul', second, 0, 1))] });
  check('empate no pior saldo (3 derrotas para cada um): vence a ordem alfabética (Bruno antes de Carla), qualquer que seja a ordem em que os jogos aconteceram', H.h2hExtremes([mk('verde', 'branco')], 'Ana').carrasco?.name === 'Bruno' && H.h2hExtremes([mk('branco', 'verde')], 'Ana').carrasco?.name === 'Bruno', null);
  const igual = { id: 'x3', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'] }, matches: [mt('azul', 'verde', 1, 0), mt('azul', 'verde', 0, 1), mt('azul', 'verde', 1, 1)] };
  check('saldo zero contra todos: não há carrasco nem freguês; sem 3 jogos contra ninguém também não', H.h2hExtremes([igual], 'Ana').carrasco === null && H.h2hExtremes([igual], 'Ana').fregues === null && H.h2hExtremes([sr('z', '2026-10-07', ['Ana'], ['Bruno'], 'LL')], 'Ana').carrasco === null && H.h2hExtremes([], 'Ana').fregues === null);
  const dup = { id: 'x4', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'], branco: ['Carla'], preto: ['Gil'], roxo: ['Hugo'] },
    matches: [...'WLL'.split('').map(r => mt('azul', 'verde', r === 'W' ? 1 : 0, r === 'L' ? 1 : 0)),                // contra o Bruno: 1 × 2 (saldo −1)
      ...Array.from({ length: 3 }, () => mt('azul', 'branco', 0, 1)),                                              // contra a Carla: 0 × 3 (saldo −3)
      ...'WWL'.split('').map(r => mt('azul', 'preto', r === 'W' ? 1 : 0, r === 'L' ? 1 : 0)),                     // contra o Gil: 2 × 1 (saldo +1)
      ...Array.from({ length: 4 }, () => mt('azul', 'roxo', 1, 0))] };                                             // contra o Hugo: 4 × 0 (saldo +4)
  const xd = H.h2hExtremes([dup], 'Ana');
  check('com vários adversários: o carrasco é o de PIOR saldo (a Carla, −3, e não o Bruno, −1, que vem antes na ordem alfabética) e o freguês o de MELHOR saldo (o Hugo, +4, e não o Gil, +1)', xd.carrasco?.name === 'Carla' && xd.carrasco.diff === -3 && xd.fregues?.name === 'Hugo' && xd.fregues.diff === 4, xd);

  // ══ 2. O FRENTE A FRENTE COM O RIVAL ═══════════════════════════════════════════════════════════════
  const act = sr('act', '2026-11-02', ['Ana'], ['Bruno'], 'WWWWW', { status: 'active' });
  const frl = sr('free', '2026-11-03', ['Ana'], ['Bruno'], 'WWWWW', { free: true });
  const E1 = makeEnv({ champs: [c1, c2, c3, c4, c5, c6, act, frl] });
  const h = E1.api.rivalH2H();
  check('frente a frente com o rival: só campeonato concluído e fora do plano gratuito (o em andamento e o do plano gratuito ficam de fora); eu atrás (2 × 5, 1 empate)', h.me === 'Ana' && h.rival === 'Bruno' && h.w === 2 && h.d === 1 && h.l === 5 && h.games === 8 && h.status === 'behind', h);
  check('…mais o MEU carrasco e o MEU freguês na liga toda: o Bruno (2 vitórias × 5 derrotas contra ele) e a Carla, que perdeu 5 jogos da Ana em times opostos (4 no campeonato do mesmo time do Bruno e 1 no de três times) é a freguesa', h.carrasco?.name === 'Bruno' && h.carrasco.w === 2 && h.carrasco.l === 5 && h.carrasco.games === 8 && h.fregues?.name === 'Carla' && h.fregues.w === 5 && h.fregues.l === 0 && h.fregues.games === 5, [h.carrasco, h.fregues]);
  const st3 = (champs, rival = 'bruno') => makeEnv({ champs, rival }).api.rivalH2H().status;
  check('situação: na frente, atrás, empatado e "nunca se enfrentaram" (none)', st3([sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WWL')]) === 'ahead' && st3([sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WLL')]) === 'behind' && st3([sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WLD')]) === 'tie' && st3([]) === 'none' && st3([sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WWL')], 'carla') === 'none');
  check('sem rival ou na simulação do admin ("Ver como"): não há frente a frente (null) e a aba não desenha nada', makeEnv({ champs: [c1], noRivalDoc: true }).api.rivalH2H() === null && makeEnv({ champs: [c1], sim: 'carla' }).api.rivalH2H() === null && makeEnv({ champs: [c1], sim: 'carla' }).api.rivalH2HView() === '' && makeEnv({ champs: [c1], sim: 'ana' }).api.rivalH2H() !== null);

  // ── a aba Frente a frente ──
  const v1 = plain(E1.api.rivalH2HView());
  check('aba Frente a frente atrás: "Bruno leva vantagem: 3 jogos a mais", as vitórias de cada lado, "1 empate · 8 jogos em times opostos", o carrasco e o freguês com as contas deles, e a regra embaixo', /Você 2 vitórias/.test(v1) && /Bruno 5 vitórias/.test(v1) && /Bruno leva vantagem: 3 jogos a mais/.test(v1) && /1 empate · 8 jogos em times opostos/.test(v1) && /😈 Seu carrasco: Bruno \(5 derrotas × 2 vitórias em 8 jogos\)/.test(v1) && /🎣 Seu freguês: Carla \(5 vitórias × 0 derrotas em 5 jogos\)/.test(v1) && /Só contam os jogos em que vocês dois estavam em times opostos no mesmo campeonato\. Carrasco e Freguês valem entre quem já se enfrentou 3 vezes ou mais\./.test(v1), v1);
  const gView = plain(makeEnv({ champs: [gc] }).api.rivalH2HView());
  check('com gols nos jogos: "gols nesses jogos: você 3 × 2 Bruno"; na frente: "Você leva vantagem: 2 jogos a mais"; sem gols a frase some; no singular "1 jogo a mais" e "1 vitória"', /gols nesses jogos: você 3 × 2 Bruno/.test(gView) && /Você leva vantagem: 2 jogos a mais/.test(gView) && !/gols nesses jogos/.test(v1) && /Você leva vantagem: 1 jogo a mais/.test(plain(makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WWL')] }).api.rivalH2HView())) && /Bruno 1 vitória/.test(plain(makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WWL')] }).api.rivalH2HView())), gView);
  const vTie = plain(makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WLD')] }).api.rivalH2HView()), vNone = plain(makeEnv({ champs: [] }).api.rivalH2HView());
  check('empatados: "Empatados no frente a frente!"; sem nenhum jogo: "Vocês ainda não se enfrentaram." (e nenhuma linha de empates, jogos ou "Na liga toda")', /Empatados no frente a frente!/.test(vTie) && /Vocês ainda não se enfrentaram\./.test(vNone) && !/em times opostos\s*$/.test(vNone.replace(/Só contam.*$/, '').trim()) && !/Na liga toda/.test(vNone) && !/empate/.test(vNone.replace(/Empatados no frente a frente!/, '')));
  const hBehind = makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WLL')] }).api.rivalH2HView(), hAhead = makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WWL')] }).api.rivalH2HView(), hTie = makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], ['Bruno'], 'WLD')] }).api.rivalH2HView();
  const num34 = (h, color, n) => new RegExp('line-height:1\\.1;color:' + color + '">' + n + '</div>').test(h);
  check('as cores do frente a frente: quem está atrás leva o número em branco e o outro na cor dele (você verde, o rival azul); no empate cada um na sua cor', num34(hBehind, '#e6edf3', 1) && num34(hBehind, '#4db8ff', 2) && num34(hAhead, '#00d67f', 2) && num34(hAhead, '#e6edf3', 1) && num34(hTie, '#00d67f', 1) && num34(hTie, '#4db8ff', 1), [hBehind.match(/line-height:1\.1;color:#[0-9a-f]+">\d+/g), hAhead.match(/line-height:1\.1;color:#[0-9a-f]+">\d+/g)]);
  const fregE = makeEnv({ champs: [sr('f', '2026-10-07', ['Ana'], ['Bruno'], 'WWWWWL')] });
  const vF = plain(fregE.api.rivalH2HView());
  check('o freguês aparece quando o rival (ou outro) perde da pessoa em 3 jogos ou mais: "Seu freguês: Bruno (5 vitórias × 1 derrota em 6 jogos)" dentro de "Na liga toda"', /Na liga toda/.test(vF) && /🎣 Seu freguês: Bruno \(5 vitórias × 1 derrota em 6 jogos\)/.test(vF) && !/Seu carrasco/.test(vF), vF);
  const off = makeEnv({ champs: [c1, c2, c3, c4, c5, c6], appCfg: { h2hBadges: false } });
  const vOff = plain(off.api.rivalH2HView());
  check('com as badges de confronto direto DESLIGADAS pelo admin: o retrospecto com o rival continua, mas o carrasco, o freguês e "Na liga toda" somem', /Bruno leva vantagem: 3 jogos a mais/.test(vOff) && !/carrasco|freguês|Na liga toda/i.test(vOff.replace(/Carrasco e Freguês valem entre quem já se enfrentou 3 vezes ou mais\./, '')), vOff);
  const xssName = '<img src=x onerror=alert(1)> & "oi"';
  // a chave do jogador com o nome estranho vem da própria função do app
  const keyOf = new Function(keyCode + '\nreturn playerKey;')();
  const zx = makeEnv({ champs: [sr('a', '2026-10-07', ['Ana'], [xssName], 'WWWWWL')], players: [...PLAYERS, { name: xssName }], rival: keyOf(xssName) });
  const raw = zx.api.rivalH2HView();
  check('nome do rival com HTML (<img onerror>, & e aspas) é escapado na aba Frente a frente: o "<" vira "&lt;" e nenhuma tag chega à tela como tag', raw.includes('&lt;img src=x onerror=alert(1)> &amp; &quot;oi&quot;') && !raw.includes('<img') && !raw.includes('onerror=alert(1)>"'), raw.slice(0, 400));

  // ══ 3. OS AVISOS: RIVALIDADE DECLARADA E ALVO DA GALERA ═════════════════════════════════════════════
  const nt = o => makeEnv(o).api.rivalNotices('Bruno');
  check('os dois se escolheram: aviso "Rivalidade declarada!" em verde, com o nome do rival; só vale com um rival escolhido', /🤝 <b style="color:var\(--text\)">Rivalidade declarada!<\/b> Bruno também escolheu você como rival\./.test(nt({ mutual: true })) && /#00d67f/.test(nt({ mutual: true })) && nt({ mutual: false }) === '' && nt({ mutual: true, noRivalDoc: true }) === '');
  check('Alvo da Galera: aviso em dourado ("3 ou mais jogadores escolheram você como rival. Não dizemos quem."), só para mim (o cadastro público da MINHA chave), sem nunca dizer quem', /🎯 <b style="color:var\(--text\)">Alvo da Galera:<\/b> 3 ou mais jogadores escolheram você como rival\. Não dizemos quem\./.test(nt({ pub: { ana: { alvo: true } } })) && /#f0b429/.test(nt({ pub: { ana: { alvo: true } } })) && nt({ pub: { bruno: { alvo: true } } }) === '' && nt({ pub: { ana: { alvo: 'sim' } } }) === '' && nt({ pub: { ana: {} } }) === '');
  const ambos = nt({ mutual: true, pub: { ana: { alvo: true } } });
  check('os dois avisos juntos: primeiro a Rivalidade declarada, depois o Alvo da Galera; o nome do rival é escapado', ambos.indexOf('Rivalidade declarada') > 0 && ambos.indexOf('Rivalidade declarada') < ambos.indexOf('Alvo da Galera') && makeEnv({ mutual: true }).api.rivalNotices('<b>x</b>').includes('&lt;b>x&lt;/b> também escolheu') && !makeEnv({ mutual: true }).api.rivalNotices('<b>x</b>').includes('<b>x'), ambos);
  const publicoPub = { ana: { alvo: true, publico: true } };
  check('Inimigo Público: aviso em vermelho ("7 ou mais jogadores escolheram você como rival. Não dizemos quem."), só para mim (o cadastro público da MINHA chave) e só com true de verdade', /🚨 <b style="color:var\(--text\)">Inimigo Público:<\/b> 7 ou mais jogadores escolheram você como rival\. Não dizemos quem\./.test(nt({ pub: publicoPub })) && /#ff5c5c/.test(nt({ pub: publicoPub })) && nt({ pub: { bruno: { alvo: true, publico: true } } }) === '' && nt({ pub: { ana: { alvo: true, publico: 'sim' } } }).includes('Alvo da Galera') && !nt({ pub: { ana: { alvo: true, publico: 'sim' } } }).includes('Inimigo Público') && nt({ pub: { ana: { publico: 1 } } }) === '', nt({ pub: publicoPub }));
  check('quem é Inimigo Público vê só o aviso do Inimigo Público (o Alvo da Galera, que ele também tem, não se repete); com a Rivalidade declarada, ela vem primeiro; e o Alvo da Galera sozinho não mostra o do Inimigo Público', (() => { const n = nt({ mutual: true, pub: publicoPub }); return n.includes('Inimigo Público') && !n.includes('Alvo da Galera') && n.indexOf('Rivalidade declarada') > 0 && n.indexOf('Rivalidade declarada') < n.indexOf('Inimigo Público') && (n.match(/Não dizemos quem/g) || []).length === 1; })() && !nt({ pub: { ana: { alvo: true } } }).includes('Inimigo Público'));
  check('Rivalidade declarada: sem rival escolhido (documento antigo com o aviso ligado) ou com um valor que não é true de verdade, nenhum aviso', nt({ mutual: true, rival: '' }) === '' && nt({ mutual: 'sim' }) === '' && nt({ mutual: 1 }) === '');
  const rmj = makeEnv({ mutual: true, pub: { ana: { alvo: true } } });
  rmj.st.modal = { type: 'rival', picking: false };
  const mAll = ['badges', 'numbers', 'h2h', 'duel'].map(t => { rmj.st.modal.tab = t; return rmj.api.mRival(); });
  check('os avisos aparecem no alto das 4 abas da janela do rival (e não na escolha de rival)', mAll.every(m => /Rivalidade declarada!/.test(m) && /Alvo da Galera:/.test(m)) && (() => { const p = makeEnv({ mutual: true }); p.st.modal = { type: 'rival', picking: true }; return !/Rivalidade declarada/.test(p.api.mRival()); })());

  const rmp = makeEnv({ pub: publicoPub });
  rmp.st.modal = { type: 'rival', picking: false };
  check('o aviso do Inimigo Público também aparece no alto das 4 abas da janela do rival', ['badges', 'numbers', 'h2h', 'duel'].every(t => { rmp.st.modal.tab = t; return /Inimigo Público:/.test(rmp.api.mRival()); }));

  // ══ 4. AS ABAS DA JANELA ═══════════════════════════════════════════════════════════════════════════
  const T = makeEnv({ champs: [c1, c2] });
  T.st.modal = { type: 'rival', picking: false };
  const tabsHtml = T.api.mRival();
  check('a janela do rival tem 4 abas em grade 2 × 2: Conquistas (aberta), Números, Frente a frente e Duelo do mês; a aberta marcada com aria-pressed', /grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px/.test(tabsHtml) && ['badges', 'numbers', 'h2h', 'duel'].every(t => new RegExp(`onclick="rivalTab\\('${t}'\\)"`).test(tabsHtml)) && /🏅 Conquistas/.test(tabsHtml) && /📊 Números/.test(tabsHtml) && /🤜 Frente a frente/.test(tabsHtml) && /🗓️ Duelo do mês/.test(tabsHtml) && (tabsHtml.match(/aria-pressed="true"/g) || []).length === 1 && /rivalTab\('badges'\)" aria-pressed="true"/.test(tabsHtml), tabsHtml.slice(0, 300));
  for (const [tab, mark] of [['h2h', /Bruno 4 vitórias|Seu carrasco|Você \d vitória/], ['duel', /Duelo de novembro/], ['numbers', /Compartilhar números|Ainda não há números/], ['badges', /Compartilhar comparação/]]) {
    T.api.rivalTab(tab);
    const m = T.api.mRival();
    check(`aba "${tab}": abre o conteúdo certo, marca só a aba aberta e mantém os botões Trocar rival e Remover rival embaixo`, mark.test(plain(m)) && new RegExp(`rivalTab\\('${tab}'\\)" aria-pressed="true"`).test(m) && (m.match(/aria-pressed="true"/g) || []).length === 1 && /onclick="rivalChange\(\)"/.test(m) && /onclick="rivalRemove\(\)"/.test(m) && T.st.modal.tab === tab, plain(m).slice(0, 200));
  }
  const before = T.calls.renders;
  T.api.rivalTab('xyz'); T.api.rivalTab(undefined); T.api.rivalTab('__proto__');
  const pick = makeEnv(); pick.st.modal = { type: 'rival', picking: true }; pick.api.rivalTab('duel');
  const outro = makeEnv(); outro.st.modal = { type: 'outra' }; outro.api.rivalTab('duel');
  check('…de verdade: aba inválida não muda a aba nem redesenha, e na escolha de rival a aba não muda', T.calls.renders === before && T.st.modal.tab === 'badges' && pick.st.modal.tab === undefined && outro.st.modal.tab === undefined && pick.calls.renders === 0 && outro.calls.renders === 0, [T.calls.renders, before, T.st.modal.tab]);

  // ══ 5. A ABA DUELO DO MÊS ══════════════════════════════════════════════════════════════════════════
  const duelHtml = (o = {}) => { const z = makeEnv(o); return { z, html: z.api.rivalDuelView(), txt: plain(z.api.rivalDuelView()) }; };
  const d0 = duelHtml({ champs: [] });
  check('sem campeonato no mês: o título do mês, o aviso de que o duelo vale se o rival continuar até o primeiro jogo, nenhuma tabela e nenhum botão de compartilhar', /🗓️ Duelo de novembro/.test(d0.txt) && /Ainda não houve campeonato em novembro\. Se Bruno continuar sendo o seu rival até o primeiro jogo do mês, o duelo vale\./.test(d0.txt) && !/Hoje:/.test(d0.txt) && !/Compartilhar duelo/.test(d0.txt) && !/Títulos/.test(d0.txt), d0.txt);
  const nov = brunoLeva('n', '2026-11-03', '2026-11-04');
  const d1 = duelHtml({ champs: nov });
  check('duelo valendo (o rival foi escolhido em setembro, antes do 1º campeonato de novembro): "Hoje: você leva 0 números e Bruno leva 6. Se o mês fechasse agora: 🛸 Fora da Sua Liga." e a tabela do mês', /Hoje: você leva 0 números e Bruno leva 6\. Se o mês fechasse agora: 🛸 Fora da Sua Liga\./.test(d1.txt) && /Títulos/.test(d1.txt) && /Vitórias/.test(d1.txt) && /Gols/.test(d1.txt) && /Vezes artilheiro/.test(d1.txt) && /Presença/.test(d1.txt) && !/não vale com este rival/.test(d1.txt) && !/Para o duelo valer/.test(d1.txt), d1.txt);
  check('a tabela do duelo: o título do mês, o botão "📤 Compartilhar duelo" (openMjRivalDuel) e a regra embaixo (rival escolhido antes do 1º campeonato, 3 jogos, só números com vencedor, fecha no último dia do mês, trocar perde o duelo)', /onclick="openMjRivalDuel\(\)"[^>]*>📤 Compartilhar duelo<\/button>/.test(d1.html) && /Vale se o rival já estava escolhido antes do primeiro campeonato do mês e se os dois jogaram 3 jogos ou mais\. Só contam os números que tiveram um vencedor: levar mais que ele é Rival na Mão; levar todos \(4 ou mais\) é Passei o Trator\. O mês fecha no último dia do mês, e o resultado entra quando você abrir o app depois disso\. Trocar de rival depois do primeiro campeonato do mês perde o duelo daquele mês\./.test(d1.txt));
  const dTrator = duelHtml({ champs: [same('t1', '2026-11-03', { goals: ['Ana', 'Ana', 'Carla'], awards: { pos: { winners: ['Ana'] }, neg: { winners: ['Bruno'] } } }), same('t2', '2026-11-04')], voting: true });
  check('quando eu levo todos (4 números, o rival nenhum): "Se o mês fechasse agora: 🚜 Passei o Trator."', /Hoje: você leva 4 números e Bruno leva 0\. Se o mês fechasse agora: 🚜 Passei o Trator\./.test(dTrator.txt), dTrator.txt);
  const dUm = duelHtml({ champs: [same('t1', '2026-11-03', { goals: ['Ana', 'Carla', 'Carla'] }), same('t2', '2026-11-04')] });
  check('com menos de 3 números decididos só conta os números ("você leva 1 número", no singular) e não promete resultado', /Hoje: você leva 1 número e Bruno leva 0\./.test(dUm.txt) && !/Se o mês fechasse agora/.test(dUm.txt), dUm.txt.slice(0, 250));
  const dTarde = duelHtml({ champs: nov, since: ISO('2026-11-03') });
  check('rival escolhido no dia do 1º campeonato (ou depois): "O duelo de novembro não vale com este rival: …O próximo duelo é o de dezembro." — a tabela do mês continua, sem a frase "Hoje"', /O duelo de novembro não vale com este rival: ele foi escolhido depois do primeiro campeonato do mês\. O próximo duelo é o de dezembro\./.test(dTarde.txt) && !/Hoje:/.test(dTarde.txt) && /Títulos/.test(dTarde.txt) && /Compartilhar duelo/.test(dTarde.txt), dTarde.txt.slice(0, 300));
  const dezTarde = duelHtml({ champs: [...brunoLeva('d', '2026-12-03', '2026-12-04')], since: ISO('2026-12-05'), now: '2026-12-10T15:00:00.000Z' });
  check('escolhido depois do 1º campeonato de dezembro: o próximo duelo é o de "janeiro de 2027"', /O próximo duelo é o de janeiro de 2027\./.test(dezTarde.txt), dezTarde.txt.slice(0, 300));
  const poucos = [{ id: 'p1', date: '2026-11-03', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'] }, champion_players: [], matches: [mt('azul', 'verde', 1, 0), mt('azul', 'verde', 1, 0)] }];
  const dPoucos = duelHtml({ champs: poucos });
  check('menos de 3 jogos: "Para o duelo valer, cada um precisa de 3 jogos no mês: você tem 2 e Bruno tem 2." e nada de "Hoje"', /Para o duelo valer, cada um precisa de 3 jogos no mês: você tem 2 e Bruno tem 2\./.test(dPoucos.txt) && !/Hoje:/.test(dPoucos.txt), dPoucos.txt.slice(0, 300));
  const asim = duelHtml({ champs: [sr('p1', '2026-11-03', ['Ana'], ['Bruno'], 'WW'), sr('p2', '2026-11-04', ['Ana'], ['Gil'], 'W')] });
  check('o aviso de poucos jogos diz quantos cada lado tem, sem trocar os lados (você 3, Bruno 2)', /Para o duelo valer, cada um precisa de 3 jogos no mês: você tem 3 e Bruno tem 2\./.test(asim.txt), asim.txt.slice(0, 250));
  const recente = duelHtml({ champs: [], since: ISO('2026-11-05') });
  check('rival escolhido há menos de 1 mês: "Rival há menos de 1 mês" (e não "0 meses")', /⏳ Rival há menos de 1 mês: 3 meses dão/.test(recente.txt) && !/Rival há 0 meses/.test(recente.txt) && /⏳ Rival há 1 mês: 3 meses dão/.test(duelHtml({ champs: [], since: ISO('2026-10-05') }).txt), recente.txt);
  const sk0 = duelHtml({ champs: [] });
  check('progresso: sem duelo fechado, o convite ("3 duelos ganhos seguidos dão 👑 Dono do Rival; 3 perdidos, 👤 Sombra do Rival") e o tempo (Rival há 1 mês: 3 meses dão 🐕 Rival de Estimação, 6 dão ⚔️ Arquirrival e 12 dão 🏛️ Rivalidade Histórica)', /Seu progresso com Bruno/.test(sk0.txt) && /Nenhum duelo fechado ainda com Bruno\. 3 duelos ganhos seguidos dão 👑 Dono do Rival; 3 perdidos, 👤 Sombra do Rival\./.test(sk0.txt) && /⏳ Rival há 1 mês: 3 meses dão 🐕 Rival de Estimação, 6 dão ⚔️ Arquirrival e 12 dão 🏛️ Rivalidade Histórica\./.test(sk0.txt), sk0.txt);
  const DU = { '2026-10': { r: 'bruno', res: 'mao', m: 4, t: 2 }, '2026-09': { r: 'bruno', res: 'mao', m: 3, t: 1 }, '2026-08': { r: 'bruno', res: 'none', m: 0, t: 0 }, '2025-12': { r: 'sumido', res: 'empate', m: 2, t: 2 } };
  const sk2 = duelHtml({ champs: [], since: ISO('2026-08-20'), duels: DU });
  check('com 2 duelos ganhos seguidos: "2 duelos do mês ganhos seguidos com Bruno. Com 3 seguidos: 👑 Dono do Rival." e "Rival há 2 meses"', /🔁 2 duelos do mês ganhos seguidos com Bruno\. Com 3 seguidos: 👑 Dono do Rival\./.test(sk2.txt) && /Rival há 2 meses/.test(sk2.txt), sk2.txt);
  const skL = duelHtml({ champs: [], since: ISO('2026-10-02'), duels: { '2026-10': { r: 'bruno', res: 'aluno', m: 1, t: 3 } } });
  const skG = duelHtml({ champs: [], since: ISO('2026-10-02'), duels: { '2026-10': { r: 'bruno', res: 'trator', m: 4, t: 0 } } });
  const skL2 = duelHtml({ champs: [], since: ISO('2026-09-02'), duels: { '2026-10': { r: 'bruno', res: 'fora', m: 0, t: 4 }, '2026-09': { r: 'bruno', res: 'aluno', m: 1, t: 3 } } });
  check('no singular a frase concorda ("1 duelo do mês perdido com Bruno", "1 duelo do mês ganho com Bruno", sem "seguidos"); perdidos levam a Sombra do Rival e ganhos o Dono do Rival; 2 perdidos: "2 duelos do mês perdidos seguidos"', /🔁 1 duelo do mês perdido com Bruno\. Com 3 seguidos: 👤 Sombra do Rival\./.test(skL.txt) && /🔁 1 duelo do mês ganho com Bruno\. Com 3 seguidos: 👑 Dono do Rival\./.test(skG.txt) && /🔁 2 duelos do mês perdidos seguidos com Bruno\. Com 3 seguidos: 👤 Sombra do Rival\./.test(skL2.txt), [skL.txt, skG.txt, skL2.txt]);
  check('meses que já fecharam: do mais novo ao mais antigo, só os que tiveram duelo (o "none" não aparece), com o nome do mês (o ano só fora do ano atual), o rival da época (ou "rival" se ele saiu do elenco), o resultado e o placar', /outubro · contra Bruno ✊ Rival na Mão \(4 × 2\)/.test(sk2.txt) && /setembro · contra Bruno ✊ Rival na Mão \(3 × 1\)/.test(sk2.txt) && /dezembro de 2025 · contra rival 🤝 Empate \(2 × 2\)/.test(sk2.txt) && !/agosto/.test(sk2.txt) && sk2.txt.indexOf('outubro ·') < sk2.txt.indexOf('setembro ·') && sk2.txt.indexOf('setembro ·') < sk2.txt.indexOf('dezembro de 2025'), sk2.txt);
  check('sem nenhum mês fechado: "Nenhum mês fechado ainda: o primeiro duelo fecha no último dia do mês."; só os 6 mais novos aparecem', /Nenhum mês fechado ainda: o primeiro duelo fecha no último dia do mês\./.test(sk0.txt) && (() => { const many = {}; for (let i = 1; i <= 8; i++) many['2026-0' + i] = { r: 'bruno', res: 'mao', m: 3, t: 1 }; return (plain(makeEnv({ champs: [], since: ISO('2026-01-02'), duels: many }).api.rivalDuelView()).match(/contra Bruno/g) || []).length === 6; })());
  const xssD = makeEnv({ champs: [], players: [...PLAYERS, { name: xssName }], rival: keyOf(xssName), duels: { '2026-10': { r: keyOf(xssName), res: 'mao', m: 4, t: 2 } }, since: ISO('2026-08-20') }).api.rivalDuelView();
  check('nome do rival com HTML é escapado em todo o Duelo do mês (aviso, progresso e histórico)', xssD.includes('&lt;img src=x onerror=alert(1)> &amp; &quot;oi&quot;') && !xssD.includes('<img'), xssD.slice(0, 200));
  const sim = makeEnv({ champs: nov, sim: 'carla' });
  check('na simulação do admin ou sem rival a aba não desenha nada (string vazia)', sim.api.rivalDuelView() === '' && makeEnv({ champs: nov, noRivalDoc: true }).api.rivalDuelView() === '');
  check('o nome do resultado vem do catálogo: Passei o Trator, Rival na Mão, Aluno do Rival, Fora da Sua Liga; empate "🤝 Empate"; sem duelo "sem duelo válido"', (() => { const a = makeEnv().api; return a.rivalResLabel('trator') === '🚜 Passei o Trator' && a.rivalResLabel('mao') === '✊ Rival na Mão' && a.rivalResLabel('aluno') === '📚 Aluno do Rival' && a.rivalResLabel('fora') === '🛸 Fora da Sua Liga' && a.rivalResLabel('empate') === '🤝 Empate' && a.rivalResLabel('none') === 'sem duelo válido' && a.rivalResLabel('xis') === 'sem duelo válido'; })());

  // ══ 6. O AVISO NA ESCOLHA E O ALERTA AO TROCAR OU TIRAR O RIVAL ═══════════════════════════════════
  const note = o => makeEnv(o).api.rivalPickNote();
  check('escolha de rival: se o 1º campeonato do mês já foi jogado, o aviso diz que o duelo de novembro não vale para um rival escolhido agora e que o dele começa em dezembro; sem campeonato no mês, sem aviso', /⚠️ O primeiro campeonato de novembro já foi jogado: o duelo de novembro não vale para um rival escolhido agora\. O duelo dele começa em dezembro\./.test(plain(note({ champs: [sr('a', '2026-11-03', ['Ana'], ['Bruno'], 'W')] }))) && note({ champs: [] }) === '' && note({ champs: [sr('a', '2026-10-30', ['Ana'], ['Bruno'], 'W')] }) === '', plain(note({ champs: [sr('a', '2026-11-03', ['Ana'], ['Bruno'], 'W')] })));
  check('em dezembro o duelo "começa em janeiro de 2027"; campeonato em andamento já conta (começou); o do plano gratuito não', /O duelo dele começa em janeiro de 2027\./.test(plain(note({ champs: [sr('a', '2026-12-03', ['Ana'], ['Bruno'], 'W')], now: '2026-12-10T15:00:00.000Z' }))) && note({ champs: [sr('a', '2026-11-03', ['Ana'], ['Bruno'], 'W', { status: 'active' })] }) !== '' && note({ champs: [sr('a', '2026-11-03', ['Ana'], ['Bruno'], 'W', { free: true })] }) === '');
  const pk = makeEnv({ champs: [sr('a', '2026-11-03', ['Ana'], ['Bruno'], 'W')], noRivalDoc: true });
  pk.st.modal = { type: 'rival', picking: true };
  check('a janela de escolha mostra esse aviso (e só quando o 1º campeonato do mês já foi jogado)', /O primeiro campeonato de novembro já foi jogado/.test(plain(pk.api.mRival())) && (() => { const z = makeEnv({ noRivalDoc: true, champs: [] }); z.st.modal = { type: 'rival', picking: true }; return !/O primeiro campeonato/.test(plain(z.api.mRival())); })());
  const LOSS_ALL = { champs: [sr('a', '2026-11-03', ['Ana'], ['Bruno'], 'W')], since: ISO('2026-08-20'), duels: { '2026-10': { r: 'bruno', res: 'mao', m: 3, t: 1 }, '2026-09': { r: 'bruno', res: 'mao', m: 3, t: 1 } } };
  const lossTxt = `Se você trocar o rival agora, vai perder o progresso com Bruno:\n\n• o duelo de novembro (o primeiro campeonato do mês já foi jogado)\n• a sequência de 2 duelos do mês ganhos (Dono do Rival e Sombra do Rival)\n• o tempo de rivalidade (2 meses, para Rival de Estimação, Arquirrival e Rivalidade Histórica)\n\nAs conquistas que você já ganhou continuam suas.\n\nTrocar o rival mesmo assim?`;
  const L1 = makeEnv({ ...LOSS_ALL, confirmAnswers: [false] });
  L1.st.modal = { type: 'rival', picking: true, tab: 'duel' };
  L1.api.rivalPick('carla');
  check('trocar de rival com progresso a perder: pergunta antes, listando o duelo do mês, a sequência e o tempo, e avisando que as conquistas já ganhas continuam; "Cancelar" não muda nada (o rival continua, nada vai ao servidor, a janela fica como estava)', L1.calls.confirms.length === 1 && L1.calls.confirms[0] === lossTxt && L1.api.rivalGet() === 'bruno' && L1.calls.fn.length === 0 && L1.st.modal.picking === true && L1.calls.renders === 0, [L1.calls.confirms, L1.api.rivalGet()]);
  const L2 = makeEnv({ ...LOSS_ALL, confirmAnswers: [true] });
  L2.st.modal = { type: 'rival', picking: true, tab: 'duel' };
  L2.api.rivalPick('carla');
  await tick();
  check('confirmando: o rival vira a Carla, o servidor é avisado (setRival) e a janela volta para a comparação na mesma aba', L2.api.rivalGet() === 'carla' && L2.calls.fn.length === 1 && L2.calls.fn[0][0] === 'setRival' && L2.calls.fn[0][1].rivalKey === 'carla' && L2.st.modal.picking === false && L2.st.modal.tab === 'duel', [L2.calls.fn, L2.st.modal]);
  const L3 = makeEnv({ ...LOSS_ALL });
  L3.st.modal = { type: 'rival', picking: true };
  L3.api.rivalPick('bruno');
  await tick();
  check('escolher o MESMO rival de novo: não pergunta nada e não chama o servidor (só volta para a comparação)', L3.calls.confirms.length === 0 && L3.calls.fn.length === 0 && L3.api.rivalGet() === 'bruno' && L3.st.modal.picking === false);
  const L4 = makeEnv({ champs: [], since: ISO('2026-11-10'), duels: {} });
  L4.st.modal = { type: 'rival', picking: true };
  L4.api.rivalPick('carla');
  await tick();
  check('sem nada a perder (rival escolhido hoje, nenhum duelo): troca direto, sem perguntar', L4.calls.confirms.length === 0 && L4.api.rivalGet() === 'carla' && L4.calls.fn.length === 1);
  const L5 = makeEnv({ champs: [], noRivalDoc: true });
  L5.st.modal = { type: 'rival', picking: true };
  L5.api.rivalPick('carla');
  await tick();
  check('escolher o 1º rival (ainda não havia nenhum): não pergunta nada', L5.calls.confirms.length === 0 && L5.api.rivalGet() === 'carla' && L5.calls.fn.length === 1);
  const R1 = makeEnv({ ...LOSS_ALL, confirmAnswers: [false] });
  R1.st.modal = { type: 'rival', picking: false };
  R1.api.rivalRemove();
  check('tirar o rival com progresso a perder: pergunta com "Se você tirar o rival agora…" e "Tirar o rival mesmo assim?"; Cancelar não tira', R1.calls.confirms.length === 1 && R1.calls.confirms[0] === lossTxt.replace('Se você trocar o rival agora', 'Se você tirar o rival agora').replace('Trocar o rival mesmo assim?', 'Tirar o rival mesmo assim?') && R1.api.rivalGet() === 'bruno' && R1.calls.fn.length === 0 && R1.st.modal.picking === false, R1.calls.confirms);
  const R2 = makeEnv({ ...LOSS_ALL, confirmAnswers: [true] });
  R2.st.modal = { type: 'rival', picking: false };
  R2.api.rivalRemove();
  await tick();
  check('confirmando: o rival é tirado (servidor avisado com rivalKey vazio) e a janela vai para a escolha', R2.api.rivalGet() === '' && R2.calls.fn.length === 1 && R2.calls.fn[0][1].rivalKey === '' && R2.st.modal.picking === true, [R2.calls.fn, R2.st.modal]);
  const R3 = makeEnv({ champs: [], since: ISO('2026-11-10') });
  R3.st.modal = { type: 'rival', picking: false };
  R3.api.rivalRemove();
  await tick();
  check('tirar sem nada a perder: tira direto, sem perguntar', R3.calls.confirms.length === 0 && R3.api.rivalGet() === '' && R3.calls.fn.length === 1);
  const nomeSumido = makeEnv({ ...LOSS_ALL, rival: 'sumido', confirmAnswers: [false] });
  nomeSumido.st.modal = { type: 'rival', picking: false };
  nomeSumido.api.rivalRemove();
  check('se o rival já não está no elenco (renomeado, anonimizado ou removido), a pergunta chama de "o rival" e o texto não quebra', nomeSumido.calls.confirms.length === 1 && /vai perder o progresso com o rival:/.test(nomeSumido.calls.confirms[0]) && nomeSumido.api.rivalGet() === 'sumido', nomeSumido.calls.confirms);
  const txs = makeEnv().api;
  check('o texto do alerta sozinho: verbo "trocar" ou "tirar", o nome, cada perda numa linha com "•" e o fecho', txs.rivalLossText(['a', 'b'], 'trocar', 'Bruno') === 'Se você trocar o rival agora, vai perder o progresso com Bruno:\n\n• a\n• b\n\nAs conquistas que você já ganhou continuam suas.\n\nTrocar o rival mesmo assim?' && /^Se você tirar o rival agora/.test(txs.rivalLossText(['a'], 'tirar', 'X')) && /Tirar o rival mesmo assim\?$/.test(txs.rivalLossText(['a'], 'tirar', 'X')));

  // rivalSet na tela: o documento de outro jogador não é herdado; sem servidor e sem jogador vinculado nada vai para fora
  const doOutro = makeEnv({ noRivalDoc: true });
  doOutro.st.rivalDoc = { ownKey: 'zeca', rivalKey: 'gil', since: ISO('2026-01-01'), mutual: true, lead: 'mine', duels: { '2026-05': { r: 'gil', res: 'mao', m: 3, t: 1 } } };
  doOutro.api.rivalSet('bruno');
  check('rivalSet: a conta que foi ligada a outro jogador recomeça do zero na tela (o histórico e a virada do outro jogador não são herdados)', doOutro.st.rivalDoc.ownKey === 'ana' && JSON.stringify(doOutro.st.rivalDoc.duels) === '{}' && doOutro.st.rivalDoc.lead === '' && doOutro.st.rivalDoc.mutual === false, doOutro.st.rivalDoc);
  const demo = makeEnv({ db: null, noRivalDoc: true });
  const okDemo = await demo.api.rivalSet('carla');
  await tick();
  check('rivalSet sem servidor (a demonstração): vale na tela, devolve true e não chama o servidor', okDemo === true && demo.api.rivalGet() === 'carla' && demo.calls.fn.length === 0, [okDemo, demo.calls.fn]);
  const semMim = makeEnv({ noRivalDoc: true });
  semMim.st.userDoc.playerKey = undefined;
  const okSem = await semMim.api.rivalSet('bruno');
  check('rivalSet sem jogador vinculado à conta: devolve false, não grava nada na tela e não chama o servidor', okSem === false && semMim.st.rivalDoc === null && semMim.calls.fn.length === 0, [okSem, semMim.st.rivalDoc]);
  check('a faixa da aba EU mostra o 🤝 quando os dois se escolheram (e só então: nem com outro valor)', /Bruno 🤝/.test(makeEnv({ mutual: true }).api.rivalStrip(false)) && !/🤝/.test(makeEnv({ mutual: false }).api.rivalStrip(false)) && !/🤝/.test(makeEnv({ mutual: 'sim' }).api.rivalStrip(false)));

  // ══ 7. O CARTÃO DO DUELO ═══════════════════════════════════════════════════════════════════════════
  const S1 = makeEnv({ champs: nov });
  S1.st.photos = { ana: 'https://res.cloudinary.com/x/ana.jpg' };
  S1.st.modal = { type: 'rival', picking: false, tab: 'duel' };
  const sres = S1.api.openMjRivalDuel();
  check('Compartilhar duelo: fecha a janela do rival, redesenha e abre o cartão "rivalduel" com o nome, a liga, a foto, o rival, as linhas do mês e o título "DUELO DE NOVEMBRO"', sres === 'aberto' && S1.st.modal === null && S1.calls.renders === 1 && S1.calls.shared.length === 1 && S1.calls.shared[0][0] === 'rivalduel' && S1.calls.shared[0][1].name === 'Ana' && S1.calls.shared[0][1].rivalName === 'Bruno' && S1.calls.shared[0][1].league === 'Liga X' && S1.calls.shared[0][1].photo === 'https://res.cloudinary.com/x/ana.jpg' && S1.calls.shared[0][1].title === 'DUELO DE NOVEMBRO' && S1.calls.shared[0][1].rows.length > 0 && S1.calls.shared[0][1]._numdata === true, S1.calls.shared);
  check('março sai com cedilha ("DUELO DE MARÇO"); sem rival, na simulação do admin ou sem nenhuma linha no mês, não abre nada', (() => { const z = makeEnv({ champs: brunoLeva('m', '2026-03-03', '2026-03-04'), now: '2026-03-10T15:00:00.000Z' }); z.api.openMjRivalDuel(); return z.calls.shared[0][1].title === 'DUELO DE MARÇO'; })() && (() => { const a = makeEnv({ champs: nov, noRivalDoc: true }), b = makeEnv({ champs: nov, sim: 'carla' }), c = makeEnv({ champs: [] }); const r = [a, b, c].map(z => { const x = z.api.openMjRivalDuel(); return [x, z.calls.shared.length, z.calls.renders]; }); return r.every(([x, n, rd]) => x === undefined && n === 0 && rd === 0); })());

  // ══ 8. AVISAR O SERVIDOR QUANDO O ELENCO MUDA ══════════════════════════════════════════════════════
  const sy = makeEnv({ db: {}, fn: async () => { throw new Error('sem rede'); } });
  sy.api.rivalSync(); sy.api.rivalSync({ from: 'ana_a', to: 'ana_b' });
  await tick();
  check('syncRivals: sem troca de nome manda só a liga; com troca manda também de/para; uma falha do servidor não estoura (a chamada é feita sem esperar)', sy.calls.fn.length === 2 && JSON.stringify(sy.calls.fn[0]) === JSON.stringify(['syncRivals', { liga: 'liga1' }]) && JSON.stringify(sy.calls.fn[1]) === JSON.stringify(['syncRivals', { liga: 'liga1', rename: { from: 'ana_a', to: 'ana_b' } }]), sy.calls.fn);
  const sy2 = makeEnv({ db: null });
  sy2.api.rivalSync({ from: 'a', to: 'b' });
  check('sem servidor (a demonstração) não faz nada', sy2.calls.fn.length === 0);

  // ══ 9. AS BADGES NOVAS: REGRAS E QUANDO APARECEM ══════════════════════════════════════════════════
  const cat = id => makeEnv().env.BADGE_CATALOG.find(b => b.id === id);
  check('as 18 badges novas estão no catálogo, cada uma com ícone, nome e regra, sem repetir id (Passei o Trator no lugar de "Passou o Rodo")', NEW_IDS.every(id => !!cat(id) && cat(id).emoji && cat(id).label && cat(id).desc) && cat('duelo_trator').label === 'Passei o Trator' && !/rodo/i.test(html.slice(html.indexOf("id:'carrasco'"), html.indexOf("id:'rival_12m'") + 400)) && new Set(NEW_IDS).size === 18 && (html.match(/^ {2}\{ id:'(carrasco|fregues|tira_teima|classico|alvo_galera|inimigo_publico|rival_declarada|duelo_aluno|duelo_fora_liga|duelo_mao|duelo_trator|duelo_dono|duelo_sombra|rival_passou|rival_ultrapassada|rival_3m|rival_6m|rival_12m)'/gm) || []).length === 18);
  const labels = { carrasco: 'Carrasco', fregues: 'Freguês', tira_teima: 'Tira-teima', classico: 'Clássico', alvo_galera: 'Alvo da Galera', inimigo_publico: 'Inimigo Público', rival_declarada: 'Rivalidade Declarada', duelo_aluno: 'Aluno do Rival', duelo_fora_liga: 'Fora da Sua Liga', duelo_mao: 'Rival na Mão', duelo_trator: 'Passei o Trator', duelo_dono: 'Dono do Rival', duelo_sombra: 'Sombra do Rival', rival_passou: 'Passou o Rival', rival_ultrapassada: 'Levou a Ultrapassada', rival_3m: 'Rival de Estimação', rival_6m: 'Arquirrival', rival_12m: 'Rivalidade Histórica' };
  check('os nomes de cada uma (como no manual)', NEW_IDS.every(id => cat(id).label === labels[id]), NEW_IDS.filter(id => cat(id).label !== labels[id]));
  const ck = (id, stats) => cat(id).check(stats);
  check('cada badge do frente a frente lê a sua marca (h2hCarrasco, h2hFregues, h2hTiraTeima, h2hClassico) e só ela', ck('carrasco', { h2hCarrasco: true }) && !ck('carrasco', { h2hFregues: true }) && ck('fregues', { h2hFregues: true }) && !ck('fregues', { h2hCarrasco: true }) && ck('tira_teima', { h2hTiraTeima: true }) && !ck('tira_teima', {}) && ck('classico', { h2hClassico: true }) && !ck('classico', { h2hTiraTeima: true }));
  check('Alvo da Galera, Inimigo Público e Rivalidade Declarada leem as marcas do cadastro público (uma não vale pela outra); as 11 do rival leem a contagem do próprio id (1 ou mais), e uma não vale pela outra', ck('alvo_galera', { rivalAlvo: true }) && !ck('alvo_galera', { rivalDeclarada: true }) && !ck('alvo_galera', { rivalPublico: true }) && ck('inimigo_publico', { rivalPublico: true }) && !ck('inimigo_publico', { rivalAlvo: true }) && !ck('inimigo_publico', { rivalDeclarada: true }) && !ck('inimigo_publico', {}) && !ck('rival_declarada', { rivalPublico: true }) && ck('rival_declarada', { rivalDeclarada: true }) && !ck('rival_declarada', { rivalAlvo: true }) && ['duelo_aluno', 'duelo_fora_liga', 'duelo_mao', 'duelo_trator', 'duelo_dono', 'duelo_sombra', 'rival_passou', 'rival_ultrapassada', 'rival_3m', 'rival_6m', 'rival_12m'].every(id => ck(id, { rivalAwards: { [id]: 1 } }) && ck(id, { rivalAwards: { [id]: 4 } }) && !ck(id, { rivalAwards: { [id]: 0 } }) && !ck(id, { rivalAwards: {} }) && !ck(id, {}) && !ck(id, { rivalAwards: { duelo_nenhuma: 3 } })));
  const rA = makeEnv().api;
  check('rivalAward: conta 1 ou mais; texto, nulo e zero não contam', rA.rivalAward({ rivalAwards: { x: 1 } }, 'x') && rA.rivalAward({ rivalAwards: { x: '2' } }, 'x') && !rA.rivalAward({ rivalAwards: { x: 0 } }, 'x') && !rA.rivalAward({ rivalAwards: { x: null } }, 'x') && !rA.rivalAward({ rivalAwards: { x: 'abc' } }, 'x') && !rA.rivalAward({}, 'x'));
  const pubE = makeEnv({ pub: { ana: { awards: { duelo_mao: 2 }, alvo: true, publico: true, declarada: false }, bruno: { alvo: 'sim', publico: 'sim', declarada: 1 }, carla: { alvo: true, declarada: false } } }).api;
  check('o cadastro público no formato das contas: as contagens, e as três marcas só valem com true de verdade; quem não tem cadastro não tem nada', JSON.stringify(pubE.rivalPublicStats('Ana')) === JSON.stringify({ rivalAwards: { duelo_mao: 2 }, rivalAlvo: true, rivalPublico: true, rivalDeclarada: false }) && JSON.stringify(pubE.rivalPublicStats('Bruno')) === JSON.stringify({ rivalAwards: {}, rivalAlvo: false, rivalPublico: false, rivalDeclarada: false }) && JSON.stringify(pubE.rivalPublicStats('Fulano')) === JSON.stringify({ rivalAwards: {}, rivalAlvo: false, rivalPublico: false, rivalDeclarada: false }) && JSON.stringify(pubE.rivalPublicStats('Carla')) === JSON.stringify({ rivalAwards: {}, rivalAlvo: true, rivalPublico: false, rivalDeclarada: false }));
  check('PRIVACIDADE: o cadastro público só devolve contagens e as três marcas (nada de quem escolheu quem)', Object.keys(pubE.rivalPublicStats('Ana')).sort().join() === 'rivalAlvo,rivalAwards,rivalDeclarada,rivalPublico');
  // ── quando as badges do rival aparecem: quem usa o rival, ou quem já ganhou alguma, ou quem tem a marca ──
  const shown = o => makeEnv(o).api.rivalBadgesShown();
  check('as badges do rival (e suas versões trancadas) só aparecem para quem usa o rival ou já ganhou alguma coisa dele: com rival escolhido; sem rival mas com Alvo da Galera, Rivalidade Declarada ou uma contagem de 1 ou mais; sem nada, não', shown({}) === true && shown({ noRivalDoc: true }) === false && shown({ noRivalDoc: true, pub: { ana: { alvo: true } } }) === true && shown({ noRivalDoc: true, pub: { ana: { declarada: true } } }) === true && shown({ noRivalDoc: true, pub: { ana: { awards: { duelo_mao: 1 } } } }) === true && shown({ noRivalDoc: true, pub: { ana: { awards: { duelo_mao: 0 } } } }) === false && shown({ noRivalDoc: true, pub: { ana: { alvo: false, declarada: false, awards: {} } } }) === false && shown({ noRivalDoc: true, pub: { bruno: { alvo: true } } }) === false);
  check('na simulação do admin ("Ver como"), vale o cadastro do jogador visto (e não o do admin); sem a chave do jogador também não aparece', shown({ noRivalDoc: true, sim: 'carla', pub: { carla: { alvo: true } } }) === true && shown({ noRivalDoc: true, sim: 'carla', pub: { ana: { alvo: true } } }) === false && (() => { const z = makeEnv({ noRivalDoc: true, pub: { ana: { alvo: true } } }); z.st.userDoc.playerKey = undefined; return z.api.rivalBadgesShown() === false; })());
  const vis = (o, id) => makeEnv(o).api.rivalVisible(id);
  check('o catálogo respeita isso: as 14 do rival ficam escondidas de quem não usa o rival; as 4 do frente a frente valem para todos, a menos que o admin as desligue', ['duelo_mao', 'alvo_galera', 'inimigo_publico', 'rival_3m'].every(id => vis({}, id) === true && vis({ noRivalDoc: true }, id) === false) && ['carrasco', 'fregues', 'tira_teima', 'classico'].every(id => vis({ noRivalDoc: true }, id) === true && vis({ noRivalDoc: true, appCfg: { h2hBadges: false } }, id) === false && vis({ noRivalDoc: true, appCfg: { h2hBadges: true } }, id) === true && vis({ noRivalDoc: true, appCfg: {} }, id) === true));
  check('h2hOn: ligado por padrão (sem configuração) e só desliga com false de verdade', makeEnv({ appCfg: {} }).api.h2hOn() === true && makeEnv({ appCfg: { h2hBadges: true } }).api.h2hOn() === true && makeEnv({ appCfg: { h2hBadges: false } }).api.h2hOn() === false && makeEnv({ appCfg: { h2hBadges: 0 } }).api.h2hOn() === true && makeEnv({ appCfg: { h2hBadges: null } }).api.h2hOn() === true);
  // ── a comparação de conquistas não conta as badges que só falam do rival (seria circular) ──
  const circ = makeEnv({ badges: { Ana: ['b1', 'b2', 'duelo_trator', 'rival_3m', 'carrasco'], Bruno: ['b1', 'alvo_galera', 'inimigo_publico', 'rival_declarada', 'classico'], Carla: [], Gil: [] }, pub: { ana: { awards: { duelo_trator: 1, rival_3m: 1 } } } });
  check('as 14 badges só do rival ficam FORA da comparação de conquistas (ganhar uma mudaria o próprio placar); as 4 do frente a frente contam como as demais', JSON.stringify(circ.api.RIVAL_ONLY_IDS) === JSON.stringify(['alvo_galera', 'inimigo_publico', 'rival_declarada', 'duelo_aluno', 'duelo_fora_liga', 'duelo_mao', 'duelo_trator', 'duelo_dono', 'duelo_sombra', 'rival_passou', 'rival_ultrapassada', 'rival_3m', 'rival_6m', 'rival_12m']) && JSON.stringify(circ.api.rivalBadgeIds('Ana')) === JSON.stringify(['b1', 'b2', 'carrasco']) && JSON.stringify(circ.api.rivalBadgeIds('Bruno')) === JSON.stringify(['b1', 'classico']), [circ.api.rivalBadgeIds('Ana'), circ.api.rivalBadgeIds('Bruno')]);

  // ══ 10. COMO ESTÁ LIGADO NO APP ═══════════════════════════════════════════════════════════════════
  const noCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('a escolha do rival vem do documento da própria conta (rivals/{uid}): a leitura é ignorada enquanto uma escolha está sendo salva, guarda o documento e libera a tela, e a falha também libera', /const uRv = st\.authUser\?\.uid \? col\('rivals'\)\.doc\(st\.authUser\.uid\)\.onSnapshot\(snap => \{\n\s*if \(st\._rivalBusy\) return;\n\s*st\.rivalDoc = snap\.exists \? snap\.data\(\) : null;\n\s*st\.rivalReady = true;\n\s*rivalMigrateLocal\(\);\n\s*render\(\);\n\s*\}, err => \{ listenerFailed\('rivals', err\); st\.rivalReady = true; render\(\); \}\) : null;/.test(html));
  check('o cadastro público do rival (rival_public) é lido para todos: guarda por chave, sobe a versão do cache das conquistas, marca como pronto e a falha também libera', /const uRp = col\('rival_public'\)\.onSnapshot\(snap => \{\n\s*const next = \{\};\n\s*snap\.docs\.forEach\(d => \{ if \(d\.exists\) next\[d\.id\] = d\.data\(\); \}\);\n\s*st\.rivalPublic = next;\n\s*st\._rivalPubVer = \(st\._rivalPubVer \|\| 0\) \+ 1;\n\s*st\.rivalPubReady = true;\n\s*render\(\);\n\s*\}, err => \{ listenerFailed\('rival_public', err\); st\.rivalPubReady = true; render\(\); \}\);/.test(html));
  check('os dois leitores entram na lista que se desliga ao trocar de liga', /_unsubListeners = \[u1,u2,u3,u4,u5,u6,u7,u8,uPh,uRv,uRp\]\.filter\(Boolean\);/.test(html));
  check('trocar de liga ou sair zera a escolha, o cadastro público e os "prontos" (nos dois pontos que zeram o estado da liga)', (html.match(/st\.rivalDoc ?= ?null; ?st\.rivalReady ?= ?false; ?st\.rivalPublic ?= ?\{\}; ?st\.rivalPubReady ?= ?false;/g) || []).length === 2);
  check('o cache das conquistas de todos refaz a conta quando o cadastro público muda (a versão entra na chave)', /const key=champs\.length\+'\|'\+champs\.map\(c=>c\.id\|\|''\)\.join\(','\)\+'\|'\+finKey\+'\|'\+votingCacheKey\(\)\+'\|'\+\(st\._rivalPubVer\|\|0\);/.test(html));
  check('as estatísticas das conquistas levam o frente a frente e o cadastro público do rival nos DOIS lugares que as montam (a aba EU e o cálculo de todos)', (html.match(/\.\.\.h2hFlags\(doneAll, ?myName\), \.\.\.rivalPublicStats\(myName\), (\.\.\.monthAwardStats\(myName\), )?myName/g) || []).length === 1 && (html.match(/\.\.\.h2hFlags\(doneAll,name\),\.\.\.rivalPublicStats\(name\),(\.\.\.monthAwardStats\(name\),)?myName:name/g) || []).length === 1);
  check('o aviso de "conquista nova" só roda depois que o cadastro público chegou (senão uma badge do rival seria avisada como nova a cada abertura)', /if \(!st\.mjPreviewKey && st\.authUser\?\.uid && st\.ready && st\.ranksReady && st\.playersReady && st\.cfgReady && st\.rivalPubReady\) \{\n\s*const bKey = /.test(html));
  check('quando o admin remove (deleteRegisteredPlayer) ou renomeia um jogador, o servidor é avisado: a remoção sem troca de chave e a renomeação com de/para', /rivalSync\(\); \/\/ as escolhas de rival dele e as que apontam para ele saem/.test(html) && /if \(newKey !== oldKey\) \{ starSync\(\{from: oldKey, to: newKey\}\); rivalSync\(\{from: oldKey, to: newKey\}\); \}/.test(html));
  check('o interruptor do admin: dois botões (Ligadas / Desligadas) que gravam h2hBadges na configuração da liga, ligadas por padrão, e a configuração é lida com padrão true', /saveAppCfg\(\{h2hBadges:true\}\)[^>]*>Ligadas</.test(html) && /saveAppCfg\(\{h2hBadges:false\}\)[^>]*>Desligadas</.test(html) && /tog\(cfg\.h2hBadges !== false\)/.test(html) && /tog\(cfg\.h2hBadges === false\)/.test(html) && /h2hBadges: +data\.h2hBadges +\?\? true,/.test(html) && /function h2hOn\(\) \{ return st\.appCfg\?\.h2hBadges !== false; \}/.test(html));
  check('o catálogo: as 4 do frente a frente usam h2hOn(); as 13 do rival usam rivalBadgesShown(); nenhuma usa outra regra de aparecer', NEW_IDS.slice(0, 4).every(id => /visible: \(\) => h2hOn\(\)/.test(entryLine(id))) && NEW_IDS.slice(4).every(id => /visible: \(\) => rivalBadgesShown\(\)/.test(entryLine(id))));
  const emBlock = noCmt(rivalCode);
  check('o bloco do rival não grava nada direto no banco (só chama as funções do servidor) e não mexe em contador, e-mail nem WhatsApp', !/\bldoc\(|\bcol\(|\.doc\(|\bDB\.|firestore|\.set\(|\.update\(/i.test(emBlock) && !/whatsapp|e-?mail|contacts|waOf/i.test(emBlock), null);
  check('PRIVACIDADE: a janela e o cartão do duelo só usam o nome do rival que a pessoa escolheu e as iniciais; nada de conta, e-mail ou outro jogador', !/authUser|\.uid|email|whatsapp/i.test(emBlock.replace(/const rivalStoreKey = .*\n/, '')), null);
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
