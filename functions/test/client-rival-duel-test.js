// Duelo do mês do rival (item 36), no app: os números de um mês, a trava (rival escolhido ANTES do 1º campeonato do mês), o resultado (maioria, todos, empate), o mês que fecha, a sequência,
// o que se perde ao trocar de rival, o tempo com o rival e o envio do progresso ao servidor. O código é o REAL do index.html (fatiado e executado com um aplicativo falso e um relógio falso);
// o resultado mandado ao servidor é conferido contra a conta do servidor (functions/rival.js). A tela e as badges ficam no client-rival-ui-test.js.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const rivalServer = require('../rival');
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

// ── um relógio falso: tudo que o código pergunta de "agora" (new Date(), Date.now()) vem daqui ──
const RealDate = Date;
const clock = { now: RealDate.parse('2026-11-10T15:00:00.000Z') };
const OFFSET = -3 * 3600000; // o aparelho está no horário de Brasília (UTC−3): de madrugada o dia dele ainda é o anterior ao de UTC
const shifted = d => new RealDate(d.getTime() + OFFSET);
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock.now); }
  static now() { return clock.now; }
  getFullYear() { return shifted(this).getUTCFullYear(); }
  getMonth() { return shifted(this).getUTCMonth(); }
  getDate() { return shifted(this).getUTCDate(); }
}

// ── os jogadores e os campeonatos de mentira ──
const PLAYERS = [{ name: 'Ana' }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Gil', goleiro: true }];
const mt = (home, away, hs, as, goals = [], phase = 'regular') => ({ phase, home, away, hs, as, played: true, goals: goals.map(p => ({ player: p })) });
// azul (Ana, Carla) x verde (Bruno, Gil); `champ` = quem foi campeão (nomes), `awards` = destaques da votação já fechada
function camp(id, date, o = {}) {
  return { id, date, status: o.status || 'completed', freeMode: !!o.free, teamRosters: o.rosters || { azul: ['Ana', 'Carla'], verde: ['Bruno', 'Gil'] }, matches: o.matches || [],
    champion_players: (o.champ || []).map(n => ({ name: n, weight: o.weight || 1 })), _awards: o.awards || null };
}
// Bruno leva tudo em outubro: o time dele ganha todos os 8 jogos, é campeão das 4, faz 12 gols (3 + 3 + 4 + 2) e é o artilheiro das 4
const OCT_BRUNO = [
  camp('o1', '2026-10-07', { champ: ['Bruno', 'Gil'], matches: [mt('verde', 'azul', 2, 0, ['Bruno', 'Bruno']), mt('azul', 'verde', 0, 1, ['Bruno'])] }),
  camp('o2', '2026-10-14', { champ: ['Bruno', 'Gil'], matches: [mt('verde', 'azul', 3, 1, ['Bruno', 'Bruno', 'Gil', 'Ana']), mt('azul', 'verde', 0, 2, ['Bruno', 'Gil'])] }),
  camp('o3', '2026-10-21', { champ: ['Bruno', 'Gil'], matches: [mt('verde', 'azul', 1, 0, ['Bruno']), mt('azul', 'verde', 0, 4, ['Bruno', 'Bruno', 'Bruno', 'Gil'])] }),
  camp('o4', '2026-10-28', { champ: ['Bruno', 'Gil'], matches: [mt('verde', 'azul', 2, 0, ['Bruno', 'Gil']), mt('azul', 'verde', 0, 1, ['Bruno'])] }),
];
// a mesma coisa de cabeça para baixo: Ana leva tudo (o time dela ganha os 8 jogos)
const OCT_ANA = [
  camp('a1', '2026-10-07', { champ: ['Ana', 'Carla'], matches: [mt('azul', 'verde', 2, 0, ['Ana', 'Ana']), mt('verde', 'azul', 0, 1, ['Ana'])] }),
  camp('a2', '2026-10-14', { champ: ['Ana', 'Carla'], matches: [mt('azul', 'verde', 3, 1, ['Ana', 'Ana', 'Carla', 'Bruno']), mt('verde', 'azul', 0, 2, ['Ana', 'Carla'])] }),
  camp('a3', '2026-10-21', { champ: ['Ana', 'Carla'], matches: [mt('azul', 'verde', 1, 0, ['Ana']), mt('verde', 'azul', 0, 4, ['Ana', 'Ana', 'Ana', 'Carla'])] }),
  camp('a4', '2026-10-28', { champ: ['Ana', 'Carla'], matches: [mt('azul', 'verde', 2, 0, ['Ana', 'Carla']), mt('verde', 'azul', 0, 1, ['Ana'])] }),
];

const SINCE = '2026-09-15T12:00:00.000Z'; // o rival foi escolhido em 15/09 (meio-dia em UTC: é dia 15 em qualquer fuso)
const ISO = d => `${d}T12:00:00.000Z`;

function makeEnv({ champs = [], players = PLAYERS, me = 'ana', rival = 'bruno', since = SINCE, duels = {}, lead = '', pub = {}, db = {}, fn = null, now, sim = null, noRivalDoc = false,
  ready = true, voting = false, peer = false, groupStars = {}, stats = {}, badges = null, awardsOf = null } = {}) {
  if (now) clock.now = RealDate.parse(now); else clock.now = RealDate.parse('2026-11-10T15:00:00.000Z');
  const calls = { fn: [], toasts: [], renders: 0, confirms: [], shared: [] };
  const BASE = ['b1', 'b2', 'b3', 'b4'].map(id => ({ id, emoji: '⭐', label: id, desc: id }));
  const playerBadges = badges || { Ana: ['b1', 'b2'], Bruno: ['b1'], Carla: [], Gil: [] };
  const st = { authUser: { uid: 'u1' }, leagueId: 'liga1', userDoc: { playerKey: me }, players, champs, ranks: [], availableLeagues: [{ id: 'liga1', name: 'Liga X' }], photos: {}, modal: null, mjPreviewKey: sim,
    rivalDoc: noRivalDoc ? null : { ownKey: me, rivalKey: rival, since, mutual: false, lead, duels }, rivalReady: ready, rivalPubReady: ready, rivalPublic: pub, playersReady: ready, ranksReady: ready, cfgReady: ready, ready, appCfg: {} };
  const playerStats = Object.fromEntries(players.map(p => [p.name, { champsPlayed: 0, totalGoals: 0, myArt: 0, ...(stats[p.name] || {}) }]));
  const env = {
    st, DB: db, callFn: async (n, d) => { calls.fn.push([n, JSON.parse(JSON.stringify(d))]); if (fn) return fn(n, d); return { ok: true }; },
    toast: (m, t) => { calls.toasts.push([m, t]); }, render: () => { calls.renders++; }, localStorage: { getItem: () => null, setItem() {} },
    confirm: msg => { calls.confirms.push(msg); return env._confirm !== false; }, Date: FakeDate,
    BADGE_CATALOG: BASE, getBadgeCache: () => ({ playerBadges, badgeHolders: {}, playerStats }),
    votingUsed: () => voting, peerStarsOn: () => peer, starsInfo: p => (groupStars[p.name] != null ? { value: groupStars[p.name], source: 'avg' } : { value: 0, source: 'admin' }), starsText: n => String(n).replace('.', ','),
    getChampAwards: c => (awardsOf ? awardsOf(c) : c._awards || null), h2hOn: () => true,
    openMjShare: (kind, data) => { calls.shared.push([kind, data]); }, mjRivalNumData: s => ({ ...s, _numdata: true }),
    pixCopyText: async () => true, document: { querySelectorAll: () => [] },
  };
  const names = Object.keys(env);
  const body = escCode + '\n' + keyCode + '\n' + eligCode + '\n' + tierCode + '\n' + rivalCode + `
return { rivalGet, rivalSince, rivalSet, rivalPair, rivalCandidates, rivalCompare, rivalNumbers, rivalRows, rivalStatsOf, rivalStarOf, RIVAL_NUMBER_ROWS, RIVAL_MIN_GAMES, RIVAL_CLOSE_DAY,
  pad2, localDate, monthShift, monthLabel, rivalMonthStats, rivalFirstChampDate, rivalLockedIn, rivalDuelClassify, rivalDuelFor, rivalMonthClosed, rivalMonthsDue, rivalTenureMonths, rivalStreak,
  rivalChangeLoss, rivalAwardsOf, rivalProgressSync, matchRecord, openMjRivalDuel, rivalSync };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, st };
}
const tick = () => new Promise(r => setTimeout(r, 15));

(async () => {
  // ══ 1. O RESULTADO A PARTIR DA CONTA (rivalDuelClassify) ═══════════════════════════════════════════
  const A = makeEnv().api;
  const cls = (m, t) => A.rivalDuelClassify(m, t);
  check('menos de 3 números com vencedor: não vale (none), mesmo com todos para um lado', [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2]].every(([m, t]) => cls(m, t) === 'none'));
  check('levar mais números que o rival (3 ou mais decididos) é "mao"', cls(3, 0) === 'mao' && cls(2, 1) === 'mao' && cls(3, 1) === 'mao' && cls(3, 2) === 'mao' && cls(5, 4) === 'mao' && cls(4, 1) === 'mao');
  check('levar TODOS (o rival 0) com 4 ou mais decididos é "trator"; com 3 ainda é só "mao"', cls(4, 0) === 'trator' && cls(9, 0) === 'trator' && cls(3, 0) === 'mao');
  check('o contrário: o rival levou mais é "aluno"; levou todos (4 ou mais) é "fora"', cls(1, 2) === 'aluno' && cls(1, 3) === 'aluno' && cls(0, 3) === 'aluno' && cls(0, 4) === 'fora' && cls(0, 9) === 'fora' && cls(1, 4) === 'aluno');
  check('metade para cada lado com 4 ou mais decididos é empate; com 2 decididos nem vale', cls(2, 2) === 'empate' && cls(3, 3) === 'empate' && cls(5, 5) === 'empate' && cls(1, 1) === 'none');
  let parity = true, bad = null;
  for (let m = 0; m <= 10; m++) for (let t = 0; t <= 10; t++) { const r = cls(m, t); if (!rivalServer.resultFits(r, r === 'none' ? 0 : m, r === 'none' ? 0 : t)) { parity = false; bad = [m, t, r]; } }
  check('PARIDADE com o servidor: todo resultado que o app calcula (0 a 10 números para cada lado) é aceito pela conta do servidor (resultFits)', parity, bad);

  // ══ 2. DATAS E MESES ═══════════════════════════════════════════════════════════════════════════════
  check('localDate é o dia do aparelho: 01:00 em UTC de 10/11 ainda é dia 9 no aparelho (UTC−3)', (() => { const z = makeEnv({ now: '2026-11-10T01:00:00.000Z' }); return z.api.localDate() === '2026-11-09'; })());
  check('pad2, monthShift e localDate: meses que viram o ano, para frente e para trás', A.pad2(3) === '03' && A.pad2(12) === '12' && A.monthShift('2026-11', 1) === '2026-12' && A.monthShift('2026-12', 1) === '2027-01' && A.monthShift('2026-01', -1) === '2025-12' && A.monthShift('2026-03', -14) === '2025-01' && A.monthShift('2026-06', 0) === '2026-06' && makeEnv().api.localDate() === '2026-11-10');
  check('monthLabel: o nome do mês e, fora do ano de hoje, o ano', A.monthLabel('2026-10') === 'outubro' && A.monthLabel('2026-03') === 'março' && A.monthLabel('2025-12') === 'dezembro de 2025' && A.monthLabel('2027-01') === 'janeiro de 2027');
  check('RIVAL_MIN_GAMES é 3 e o mês fecha no dia 5', A.RIVAL_MIN_GAMES === 3 && A.RIVAL_CLOSE_DAY === 5);

  // ══ 3. O PRIMEIRO CAMPEONATO DO MÊS E A TRAVA ═════════════════════════════════════════════════════
  const first = champs => makeEnv({ champs }).api.rivalFirstChampDate('2026-10');
  check('o 1º campeonato do mês: a menor data entre os concluídos e os em andamento daquele mês', first([camp('x', '2026-10-21'), camp('y', '2026-10-07'), camp('z', '2026-10-14')]) === '2026-10-07' && first([camp('x', '2026-10-21'), camp('y', '2026-10-05', { status: 'active' })]) === '2026-10-05');
  check('…ignora o de outro mês, o do plano gratuito, o agendado (preset) e o sem data; sem nenhum devolve vazio', first([camp('x', '2026-09-30'), camp('y', '2026-11-02'), camp('z', '2026-10-03', { free: true }), camp('w', '2026-10-04', { status: 'preset' })]) === '' && first([]) === '' && first([{ id: 'q', status: 'completed' }]) === '');
  const lock = (since, champs, month = '2026-10') => makeEnv({ champs, since }).api.rivalLockedIn(month);
  const oct = [camp('x', '2026-10-07')];
  check('trava: o rival escolhido ANTES do 1º campeonato do mês vale (em setembro, ou no dia anterior)', lock(ISO('2026-09-15'), oct) === true && lock(ISO('2026-10-06'), oct) === true && lock(ISO('2026-08-01'), oct) === true);
  check('trava: escolhido no MESMO dia do 1º campeonato ou depois não vale para aquele mês', lock(ISO('2026-10-07'), oct) === false && lock(ISO('2026-10-08'), oct) === false && lock(ISO('2026-10-30'), oct) === false);
  check('trava: sem campeonato no mês (ainda) ou sem rival escolhido, não vale', lock(ISO('2026-09-15'), []) === false && lock('', oct) === false && makeEnv({ champs: oct, noRivalDoc: true }).api.rivalLockedIn('2026-10') === false);
  check('trava: o dia da escolha é o do aparelho (UTC−3): 01:00 em UTC de 7/10 ainda é dia 6 no aparelho (vale); 03:00 em UTC já é dia 7 (não vale)', lock('2026-10-07T01:00:00.000Z', oct) === true && lock('2026-10-07T02:59:59.000Z', oct) === true && lock('2026-10-07T03:00:00.000Z', oct) === false);

  // ══ 4. OS NÚMEROS DE UM MÊS ═══════════════════════════════════════════════════════════════════════
  const E = makeEnv({ champs: [...OCT_BRUNO, camp('set1', '2026-09-30', { champ: ['Ana'], matches: [mt('azul', 'verde', 5, 0, ['Ana'])] })] });
  const sb = E.api.rivalMonthStats('Bruno', '2026-10'), sa = E.api.rivalMonthStats('Ana', '2026-10');
  check('números de outubro do Bruno: 4 títulos, 4 campeonatos, 8 jogos e 8 vitórias, nenhuma derrota nem empate, presença 100% (o campeonato de setembro não entra)', sb.titles === 4 && sb.champs === 4 && sb.matches === 8 && sb.w === 8 && sb.l === 0 && sb.d === 0 && sb.pres === 100, sb);
  check('gols e vezes artilheiro do mês: contam os jogos DO MÊS (Bruno 12 gols e artilheiro em 4; Ana 1 gol e nenhuma vez)', sb.goals === 12 && sb.art === 4 && sa.goals === 1 && sa.art === 0, [sb.goals, sb.art, sa.goals, sa.art]);
  check('Ana em outubro: nenhum título, 8 derrotas, 0% de vitórias (o campeonato de setembro não entra)', sa.titles === 0 && sa.w === 0 && sa.l === 8 && sa.matches === 8 && sa.champs === 4 && sa.pres === 100, sa);
  const sset = E.api.rivalMonthStats('Ana', '2026-09');
  check('o mês de setembro tem o campeonato dele: Ana 1 título, 1 jogo, 1 vitória, 1 gol e artilheira', sset.titles === 1 && sset.matches === 1 && sset.w === 1 && sset.goals === 1 && sset.art === 1 && sset.champs === 1, sset);
  check('mês sem campeonato nenhum: tudo zero e presença nula (não 0%)', (() => { const z = E.api.rivalMonthStats('Ana', '2026-08'); return z.titles === 0 && z.matches === 0 && z.goals === 0 && z.champs === 0 && z.pres === null && z.groupStar === null; })());
  check('só campeonato concluído e fora do plano gratuito conta no mês (um em andamento e um do plano gratuito ficam de fora)', (() => { const z = makeEnv({ champs: [camp('c1', '2026-10-07', { matches: [mt('azul', 'verde', 1, 0)] }), camp('c2', '2026-10-14', { status: 'active', matches: [mt('azul', 'verde', 1, 0)] }), camp('c3', '2026-10-21', { free: true, matches: [mt('azul', 'verde', 1, 0)] })] }); return z.api.rivalMonthStats('Ana', '2026-10').matches === 1; })());
  check('título pela metade (peso 0,5) soma meio título', makeEnv({ champs: [camp('c1', '2026-10-07', { champ: ['Ana'], weight: 0.5 }), camp('c2', '2026-10-14', { champ: ['Ana'] })] }).api.rivalMonthStats('Ana', '2026-10').titles === 1.5);
  check('título sem peso registrado (campeonato antigo) vale 1', makeEnv({ champs: [{ ...camp('c1', '2026-10-07'), champion_players: [{ name: 'Ana' }] }] }).api.rivalMonthStats('Ana', '2026-10').titles === 1);
  check('jogo não disputado não dá gol nem artilheiro, mesmo com gols na lista; o jogo disputado do mesmo campeonato conta', (() => { const c = camp('c1', '2026-10-07', { matches: [{ ...mt('azul', 'verde', 0, 0, ['Ana', 'Ana']), played: false }, mt('azul', 'verde', 1, 0, ['Carla'])] }); const z = makeEnv({ champs: [c] }); return z.api.rivalMonthStats('Ana', '2026-10').goals === 0 && z.api.rivalMonthStats('Ana', '2026-10').art === 0 && z.api.rivalMonthStats('Carla', '2026-10').art === 1; })());
  check('artilheiro empatado: os dois levam a vez; sem gol nenhum no campeonato ninguém é artilheiro', (() => { const z = makeEnv({ champs: [camp('c1', '2026-10-07', { matches: [mt('azul', 'verde', 1, 1, ['Ana', 'Bruno'])] }), camp('c2', '2026-10-14', { matches: [mt('azul', 'verde', 0, 0)] })] }); return z.api.rivalMonthStats('Ana', '2026-10').art === 1 && z.api.rivalMonthStats('Bruno', '2026-10').art === 1 && z.api.rivalMonthStats('Carla', '2026-10').art === 0; })());
  check('gol da final conta pelos gols da final quando eles existem (como nas conquistas)', (() => { const c = camp('c1', '2026-10-07', { matches: [{ phase: 'final', home: 'azul', away: 'verde', hs: 1, as: 0, played: true, goals: [{ player: 'Carla' }], finalGoals: [{ player: 'Ana' }] }] }); return makeEnv({ champs: [c] }).api.rivalMonthStats('Ana', '2026-10').goals === 1 && makeEnv({ champs: [c] }).api.rivalMonthStats('Carla', '2026-10').goals === 0; })());
  check('presença do mês: jogou 2 dos 4 campeonatos = 50%', (() => { const cs = [camp('c1', '2026-10-07'), camp('c2', '2026-10-14'), camp('c3', '2026-10-21', { rosters: { azul: ['Carla'], verde: ['Bruno'] } }), camp('c4', '2026-10-28', { rosters: { azul: ['Carla'], verde: ['Bruno'] } })]; const z = makeEnv({ champs: cs }); return z.api.rivalMonthStats('Ana', '2026-10').pres === 50 && z.api.rivalMonthStats('Ana', '2026-10').champs === 2; })());
  check('destaques da votação do mês: Bola Cheia e Bola Murcha eleitas no mês (votação fechada), uma vez por campeonato', (() => { const cs = [camp('c1', '2026-10-07', { awards: { pos: { winners: ['Ana'] }, neg: { winners: ['Bruno'] } } }), camp('c2', '2026-10-14', { awards: { pos: { winners: ['Ana', 'Carla'] }, neg: null } }), camp('c3', '2026-10-21')]; const z = makeEnv({ champs: cs }); const a = z.api.rivalMonthStats('Ana', '2026-10'), b = z.api.rivalMonthStats('Bruno', '2026-10'); return a.pos === 2 && a.neg === 0 && b.neg === 1 && b.pos === 0; })());
  check('nota do grupo é a de agora (só com as notas ligadas e a média já valendo): null nos outros casos', makeEnv({ champs: [], peer: true, groupStars: { Ana: 3.7 } }).api.rivalMonthStats('Ana', '2026-10').groupStar === 3.7 && makeEnv({ champs: [], peer: true, groupStars: { Ana: 3.7 } }).api.rivalMonthStats('Bruno', '2026-10').groupStar === null && makeEnv({ champs: [], peer: false, groupStars: { Ana: 3.7 } }).api.rivalMonthStats('Ana', '2026-10').groupStar === null);

  // ══ 5. O DUELO DE UM MÊS ═══════════════════════════════════════════════════════════════════════════
  const D1 = makeEnv({ champs: OCT_BRUNO }).api.rivalDuelFor('2026-10');
  check('Bruno leva todos os números: 6 disputam (títulos, vitórias, derrotas, % de vitórias, gols, vezes artilheiro) e a presença empata → 0 × 6, "fora"', D1.valid === true && D1.locked === true && D1.enough === true && D1.m === 0 && D1.t === 6 && D1.res === 'fora' && D1.games.mine === 8 && D1.games.theirs === 8, [D1.m, D1.t, D1.res, D1.rows.map(r => [r.id, r.lead])]);
  check('a tabela do mês: títulos 0 × 4, vitórias 0 × 8, derrotas 8 × 0 (quem tem menos leva), 0% × 100%, gols 1 × 12, artilheiro 0 × 4, presença 100% × 100% sem vencedor', JSON.stringify(D1.rows.map(r => [r.id, r.mine, r.theirs, r.lead])) === JSON.stringify([['titles', '0', '4', 'theirs'], ['champs', '4', '4', ''], ['matches', '8', '8', ''], ['wins', '0', '8', 'theirs'], ['draws', '0', '0', ''], ['losses', '8', '0', 'theirs'], ['winpct', '0%', '100%', 'theirs'], ['goals', '1', '12', 'theirs'], ['art', '0', '4', 'theirs'], ['pres', '100%', '100%', '']]), D1.rows.map(r => [r.id, r.mine, r.theirs, r.lead]));
  const D2 = makeEnv({ champs: OCT_ANA }).api.rivalDuelFor('2026-10');
  check('a mesma coisa de cabeça para baixo (Ana leva tudo): 6 × 0 → "trator"', D2.valid && D2.m === 6 && D2.t === 0 && D2.res === 'trator', [D2.m, D2.t, D2.res]);
  // Os dois no MESMO time em todos os campeonatos: títulos, jogos, vitórias e derrotas ficam iguais, e quem decide são os gols, o artilheiro, a presença e os destaques da votação.
  const same = (id, date, o = {}) => camp(id, date, { rosters: o.rosters || { azul: ['Ana', 'Bruno'], verde: ['Carla', 'Gil'] }, champ: o.champ || ['Ana', 'Bruno'], matches: [mt('azul', 'verde', 2, 1, o.goals || []), mt('verde', 'azul', 0, 1)], awards: o.awards || null });
  const duelOf = (champs, o = {}) => makeEnv({ champs, ...o }).api.rivalDuelFor('2026-10');
  const empateD = duelOf([same('e1', '2026-10-07', { goals: ['Bruno', 'Bruno', 'Carla'], awards: { pos: { winners: ['Ana'] }, neg: { winners: ['Bruno'] } } }), same('e2', '2026-10-14')], { voting: true });
  check('empate de verdade: o Bruno leva gols e artilheiro (2), eu levo a Bola Cheia e a Bola Murcha dele (2) → 2 × 2, com 4 decididos é "empate" (e ninguém ganha badge)', empateD.valid && empateD.m === 2 && empateD.t === 2 && empateD.res === 'empate' && JSON.stringify(empateD.rows.filter(r => r.lead).map(r => [r.id, r.lead])) === JSON.stringify([['goals', 'theirs'], ['art', 'theirs'], ['pos', 'mine'], ['neg', 'mine']]), [empateD.m, empateD.t, empateD.res, empateD.rows.map(r => [r.id, r.lead])]);
  const alunoD = duelOf([same('e1', '2026-10-07', { goals: ['Bruno', 'Bruno', 'Carla'], awards: { pos: { winners: ['Ana'] } } }), same('e2', '2026-10-14')], { voting: true });
  check('o Bruno leva 2 números e eu 1 (3 decididos): o rival levou a maioria → "aluno" (e não "fora", que pede o rival com todos e 4 ou mais decididos)', alunoD.m === 1 && alunoD.t === 2 && alunoD.res === 'aluno', [alunoD.m, alunoD.t, alunoD.res]);
  const maoD = duelOf([same('e1', '2026-10-07', { goals: ['Ana', 'Ana', 'Carla'], awards: { neg: { winners: ['Bruno'] } } }), same('e2', '2026-10-14')], { voting: true });
  check('eu levo gols, artilheiro e a Bola Murcha dele (3) e o Bruno nenhum: com só 3 decididos é "mao" (o trator pede 4 ou mais)', maoD.m === 3 && maoD.t === 0 && maoD.res === 'mao', [maoD.m, maoD.t, maoD.res]);
  const presD = duelOf([same('e1', '2026-10-07', { goals: ['Ana', 'Ana', 'Carla'], awards: { neg: { winners: ['Bruno'] } } }), same('e2', '2026-10-14', { rosters: { azul: ['Ana'], verde: ['Carla', 'Gil'] }, champ: ['Ana'] }), same('e3', '2026-10-21')], { voting: true });
  check('o Bruno faltou ao campeonato do meio (presença 67% contra 100%): títulos 3 × 2, vitórias 6 × 4, gols, artilheiro, presença e a Bola Murcha dele ficam comigo (6 números, nenhum para ele) → "trator"', JSON.stringify(presD.rows.filter(r => r.lead).map(r => [r.id, r.lead])) === JSON.stringify([['titles', 'mine'], ['wins', 'mine'], ['goals', 'mine'], ['art', 'mine'], ['pres', 'mine'], ['neg', 'mine']]) && presD.rows.find(r => r.id === 'pres').theirs === '67%' && presD.rows.find(r => r.id === 'titles').theirs === '2' && presD.m === 6 && presD.t === 0 && presD.res === 'trator', [presD.m, presD.t, presD.res, presD.rows.map(r => [r.id, r.mine, r.theirs, r.lead])]);
  const foraD = duelOf([same('e1', '2026-10-07', { goals: ['Bruno', 'Bruno', 'Carla'], awards: { pos: { winners: ['Bruno'] }, neg: { winners: ['Ana'] } } }), same('e2', '2026-10-14')], { voting: true });
  check('o Bruno leva gols, artilheiro, Bola Cheia e a minha Bola Murcha (4) e eu nenhum → "fora" (o rival levou todos, com 4 decididos)', foraD.m === 0 && foraD.t === 4 && foraD.res === 'fora', [foraD.m, foraD.t, foraD.res]);
  const tratorD = duelOf([same('e1', '2026-10-07', { goals: ['Ana', 'Ana', 'Carla'], awards: { pos: { winners: ['Ana'] }, neg: { winners: ['Bruno'] } } }), same('e2', '2026-10-14')], { voting: true });
  check('eu levo gols, artilheiro, Bola Cheia e a Bola Murcha dele (4) e o rival nenhum → "trator"', tratorD.m === 4 && tratorD.t === 0 && tratorD.res === 'trator', [tratorD.m, tratorD.t, tratorD.res]);
  const lateEnv = makeEnv({ champs: OCT_BRUNO, since: ISO('2026-10-08') });
  const D4 = lateEnv.api.rivalDuelFor('2026-10');
  check('rival escolhido DEPOIS do 1º campeonato do mês: o duelo não vale (resultado none), mas a tabela do mês continua disponível', D4.valid === false && D4.locked === false && D4.enough === true && D4.res === 'none' && D4.rows.length > 0 && D4.t === 6);
  const poucos = [camp('p1', '2026-10-07', { matches: [mt('azul', 'verde', 1, 0), mt('verde', 'azul', 1, 0)] }), camp('p2', '2026-10-14', { matches: [] })];
  const D5 = makeEnv({ champs: poucos }).api.rivalDuelFor('2026-10');
  check('os dois com menos de 3 jogos no mês: o duelo não vale (enough falso, none), e mostra quantos jogos cada um tem', D5.valid === false && D5.enough === false && D5.res === 'none' && D5.games.mine === 2 && D5.games.theirs === 2);
  check('basta UM dos dois ter menos de 3 jogos: Ana joga 4 e o Bruno só 2 → não vale', (() => { const cs = [camp('q1', '2026-10-07', { matches: [mt('azul', 'verde', 1, 0), mt('azul', 'verde', 1, 0)] }), camp('q2', '2026-10-14', { rosters: { azul: ['Ana', 'Carla'], verde: ['Gil'] }, matches: [mt('azul', 'verde', 1, 0), mt('azul', 'verde', 1, 0)] })]; const d = makeEnv({ champs: cs }).api.rivalDuelFor('2026-10'); return d.enough === false && d.games.mine === 4 && d.games.theirs === 2; })());
  const tres = [camp('t1', '2026-10-07', { matches: [mt('azul', 'verde', 1, 0), mt('azul', 'verde', 1, 0)] }), camp('t2', '2026-10-14', { matches: [mt('azul', 'verde', 1, 0)] })];
  const dTres = makeEnv({ champs: tres }).api.rivalDuelFor('2026-10');
  check('exatamente 3 jogos de cada um já bastam para o duelo valer (com 2, não)', dTres.enough === true && dTres.valid === true && dTres.games.mine === 3 && dTres.games.theirs === 3, dTres);
  check('sem rival, sem jogador vinculado ou na simulação do admin: não há duelo (null)', makeEnv({ champs: OCT_BRUNO, noRivalDoc: true }).api.rivalDuelFor('2026-10') === null && makeEnv({ champs: OCT_BRUNO, sim: 'carla' }).api.rivalDuelFor('2026-10') === null);
  check('mês sem campeonato: o duelo não vale, sem linhas', (() => { const d = makeEnv({ champs: OCT_BRUNO }).api.rivalDuelFor('2026-08'); return d.valid === false && d.rows.length === 0 && d.res === 'none' && d.m === 0 && d.t === 0; })());
  check('goleiro: os gols e as vezes artilheiro dele aparecem como zero e não derrubam a conta', (() => { const d = makeEnv({ champs: OCT_BRUNO, rival: 'gil' }).api.rivalDuelFor('2026-10'); return d.valid && d.rows.some(r => r.id === 'wins') && typeof d.res === 'string'; })());
  check('votação ligada: Bola Cheia e Bola Murcha entram na tabela do mês (Bola Murcha só disputa quando os dois jogaram; menos é melhor)', (() => { const cs = OCT_BRUNO.map((c, i) => ({ ...c, _awards: i === 0 ? { pos: { winners: ['Bruno'] }, neg: { winners: ['Ana'] } } : null })); const d = makeEnv({ champs: cs, voting: true }).api.rivalDuelFor('2026-10'); const pos = d.rows.find(r => r.id === 'pos'), neg = d.rows.find(r => r.id === 'neg'); return pos.theirs === '1' && pos.lead === 'theirs' && neg.mine === '1' && neg.theirs === '0' && neg.lead === 'theirs' && d.t === 8; })());
  check('votação desligada: nenhuma das duas linhas aparece; nota do grupo só aparece com as notas ligadas e a média valendo para os dois', (() => { const off = makeEnv({ champs: OCT_BRUNO }).api.rivalDuelFor('2026-10'); const on = makeEnv({ champs: OCT_BRUNO, peer: true, groupStars: { Ana: 3.2, Bruno: 4.1 } }).api.rivalDuelFor('2026-10'); const half = makeEnv({ champs: OCT_BRUNO, peer: true, groupStars: { Ana: 3.2 } }).api.rivalDuelFor('2026-10'); return !off.rows.some(r => ['pos', 'neg', 'stars'].includes(r.id)) && on.rows.find(r => r.id === 'stars').theirs === '4,1' && on.rows.find(r => r.id === 'stars').lead === 'theirs' && !half.rows.some(r => r.id === 'stars'); })());

  // ══ 6. O MÊS FECHA E OS MESES QUE FALTAM ═══════════════════════════════════════════════════════════
  const closed = (m, o = {}) => makeEnv(o).api.rivalMonthClosed(m);
  check('o mês fecha no dia 5 do mês seguinte: dia 4 ainda não, dia 5 sim', closed('2026-10', { now: '2026-11-04T15:00:00.000Z' }) === false && closed('2026-10', { now: '2026-11-05T15:00:00.000Z' }) === true && closed('2026-10', { now: '2026-12-20T15:00:00.000Z' }) === true);
  check('o mês de hoje e os futuros não fecham', closed('2026-11', { now: '2026-11-30T15:00:00.000Z' }) === false && closed('2026-12', { now: '2026-11-10T15:00:00.000Z' }) === false);
  check('campeonato ainda em andamento no mês segura o fechamento (um agendado não segura)', closed('2026-10', { champs: [camp('x', '2026-10-28', { status: 'active' })] }) === false && closed('2026-10', { champs: [camp('x', '2026-10-28', { status: 'preset' })] }) === true && closed('2026-10', { champs: [camp('x', '2026-10-28', { status: 'active', free: true })] }) === true);
  check('o dia 5 começa à meia-noite do APARELHO: 02:59 em UTC de 5/11 ainda é dia 4 (não fechou); 03:00 já é dia 5 (fechou)', closed('2026-10', { now: '2026-11-05T02:59:00.000Z' }) === false && closed('2026-10', { now: '2026-11-05T03:00:00.000Z' }) === true);
  check('virada do ano: dezembro fecha em 5 de janeiro', closed('2026-12', { now: '2027-01-04T15:00:00.000Z' }) === false && closed('2026-12', { now: '2027-01-05T15:00:00.000Z' }) === true);
  check('campeonato em andamento de OUTRO mês não segura o fechamento de outubro (só o do próprio mês segura)', closed('2026-10', { champs: [camp('x', '2026-11-08', { status: 'active' })] }) === true && closed('2026-10', { champs: [camp('x', '2026-10-28', { status: 'active' })] }) === false);
  const due = o => makeEnv(o).api.rivalMonthsDue();
  check('os meses a conferir: do mês em que o rival foi escolhido até o mês passado, só os fechados e ainda sem resultado guardado, do mais antigo ao mais novo', JSON.stringify(due({ since: ISO('2026-07-20'), now: '2026-11-10T15:00:00.000Z', duels: { '2026-08': { r: 'bruno', res: 'none', m: 0, t: 0 } } })) === '["2026-07","2026-09","2026-10"]');
  check('só os 6 meses mais novos (quem volta depois de muito tempo não manda a vida inteira)', JSON.stringify(due({ since: ISO('2025-01-10'), now: '2026-11-10T15:00:00.000Z' })) === '["2026-05","2026-06","2026-07","2026-08","2026-09","2026-10"]');
  check('rival escolhido neste mês: nenhum mês a conferir; sem rival: nada; dia 4 do mês: o mês passado ainda não fechou', due({ since: ISO('2026-11-03') }).length === 0 && due({ noRivalDoc: true }).length === 0 && JSON.stringify(due({ since: ISO('2026-09-15'), now: '2026-11-04T15:00:00.000Z' })) === '["2026-09"]');

  // ══ 7. SEQUÊNCIA, TEMPO COM O RIVAL E O QUE SE PERDE AO TROCAR ═════════════════════════════════════
  const dl = (month, res, r = 'bruno') => [month, { r, res, m: 3, t: 1 }];
  const duelsOf = (...e) => Object.fromEntries(e);
  const streak = (duels, since = ISO('2026-01-10')) => makeEnv({ duels, since }).api.rivalStreak();
  check('sequência: 3 duelos ganhos seguidos contra o mesmo rival', JSON.stringify(streak(duelsOf(dl('2026-06', 'mao'), dl('2026-07', 'trator'), dl('2026-08', 'mao')))) === '{"side":"win","n":3}');
  check('sequência de derrotas', JSON.stringify(streak(duelsOf(dl('2026-07', 'aluno'), dl('2026-08', 'fora')))) === '{"side":"lose","n":2}');
  check('empate quebra; o outro lado quebra; mês sem duelo válido não conta nem quebra', JSON.stringify(streak(duelsOf(dl('2026-06', 'mao'), dl('2026-07', 'empate'), dl('2026-08', 'mao')))) === '{"side":"win","n":1}' && JSON.stringify(streak(duelsOf(dl('2026-06', 'aluno'), dl('2026-07', 'mao')))) === '{"side":"win","n":1}' && JSON.stringify(streak(duelsOf(dl('2026-06', 'mao'), dl('2026-07', 'none'), dl('2026-08', 'mao')))) === '{"side":"win","n":2}');
  check('sequência: outro rival no meio quebra, e só vale a partir do mês em que o rival atual foi escolhido', JSON.stringify(streak(duelsOf(dl('2026-06', 'mao', 'carla'), dl('2026-07', 'mao'), dl('2026-08', 'mao')))) === '{"side":"win","n":2}' && JSON.stringify(streak(duelsOf(dl('2026-06', 'mao'), dl('2026-07', 'mao'), dl('2026-08', 'mao')), ISO('2026-07-05'))) === '{"side":"win","n":2}');
  check('sequência: sem histórico é zero', JSON.stringify(streak({})) === '{"side":"","n":0}');
  check('empate no mês mais novo: não há sequência (o empate nem soma nem deixa passar para os meses de antes)', JSON.stringify(streak(duelsOf(dl('2026-09', 'mao'), dl('2026-10', 'empate')))) === '{"side":"","n":0}');
  const ten = since => makeEnv({ since }).api.rivalTenureMonths();
  check('tempo com o rival: meses inteiros (de 10/08 a 10/11 são 3; dia 9 de novembro, 2)', ten(ISO('2026-08-10')) === 3 && ten(ISO('2026-08-11')) === 2 && ten(ISO('2026-11-01')) === 0 && ten(ISO('2025-11-10')) === 12 && ten('') === 0);
  check('relógio do aparelho atrasado em relação ao servidor (a data da escolha no futuro): o tempo é zero, nunca negativo', ten(ISO('2026-11-12')) === 0 && ten(ISO('2026-12-20')) === 0);
  const loss = o => makeEnv(o).api.rivalChangeLoss();
  check('sem rival: nada a perder', loss({ noRivalDoc: true }).length === 0);
  check('rival novo (escolhido hoje) e nada fechado: nada a perder, nem pergunta', loss({ since: ISO('2026-11-10') }).length === 0);
  check('1º campeonato do mês já jogado e o rival já estava escolhido antes: perde o duelo do mês (com o nome do mês)', (() => { const l = loss({ champs: [camp('n1', '2026-11-03')], since: ISO('2026-10-20') }); return l.length === 1 && /^o duelo de novembro \(o primeiro campeonato do mês já foi jogado\)$/.test(l[0]); })());
  check('o rival foi escolhido DEPOIS do 1º campeonato do mês: o duelo do mês já não valia, não há o que perder por ele', loss({ champs: [camp('n1', '2026-11-03')], since: ISO('2026-11-05') }).length === 0);
  check('sequência em andamento (2 duelos ganhos) entra na lista; no singular e no plural, ganhos e perdidos', (() => { const a = loss({ duels: duelsOf(dl('2026-09', 'mao'), dl('2026-10', 'mao')), since: ISO('2026-08-20') }); const b = loss({ duels: duelsOf(dl('2026-10', 'aluno')), since: ISO('2026-10-02') }); return a.some(x => x === 'a sequência de 2 duelos do mês ganhos (Dono do Rival e Sombra do Rival)') && b.some(x => x === 'a sequência de 1 duelo do mês perdido (Dono do Rival e Sombra do Rival)'); })());
  check('tempo de rivalidade entra na lista (a partir de 1 mês), no singular e no plural', (() => { const a = loss({ since: ISO('2026-10-05') }); const b = loss({ since: ISO('2026-05-05') }); return a.some(x => x === 'o tempo de rivalidade (1 mês, para Rival de Estimação, Arquirrival e Rivalidade Histórica)') && b.some(x => x === 'o tempo de rivalidade (6 meses, para Rival de Estimação, Arquirrival e Rivalidade Histórica)'); })());
  check('as três coisas juntas, nesta ordem: o duelo do mês, a sequência e o tempo', (() => { const l = loss({ champs: [camp('n1', '2026-11-03')], duels: duelsOf(dl('2026-10', 'mao')), since: ISO('2026-08-20') }); return l.length === 3 && /^o duelo de novembro/.test(l[0]) && /^a sequência/.test(l[1]) && /^o tempo de rivalidade \(2 meses/.test(l[2]); })());

  // ══ 8. O ENVIO DO PROGRESSO AO SERVIDOR ═══════════════════════════════════════════════════════════
  const sync = async o => { const z = makeEnv(o); await z.api.rivalProgressSync(); await tick(); return z; };
  let z = await sync({ champs: OCT_BRUNO, since: ISO('2026-09-15') });
  const sent = z.calls.fn.filter(([n]) => n === 'saveRivalProgress');
  check('manda ao servidor os meses fechados (setembro sem campeonato = none com zeros; outubro com os números e o resultado "fora")', sent.length === 1 && JSON.stringify(sent[0][1].duels) === JSON.stringify([{ month: '2026-09', res: 'none', m: 0, t: 0 }, { month: '2026-10', res: 'fora', m: 0, t: 6 }]) && sent[0][1].liga === 'liga1', sent);
  check('o que o app manda é aceito pela conta do servidor (parseDuels): formato, mês fechado, a partir do mês do rival e resultado que bate com os números', (() => { const r = rivalServer.parseDuels(sent[0][1].duels, { sinceMonth: '2026-09', currentMonth: '2026-11', known: {} }); return r.ok === true && r.accepted.length === 2 && r.skipped === 0; })());
  check('…e a virada: o placar de conquistas (Ana 2 × 1 Bruno) manda "mine" na 1ª vez; sem tempo de rival suficiente não manda o aviso de tempo', sent[0][1].lead === 'mine' && !('tenure' in sent[0][1]), sent[0][1]);
  z = await sync({ champs: OCT_BRUNO, since: ISO('2026-09-15'), duels: { '2026-09': { r: 'bruno', res: 'none', m: 0, t: 0 }, '2026-10': { r: 'bruno', res: 'fora', m: 0, t: 6 } }, lead: 'mine' });
  check('tudo já guardado e a virada igual à guardada: não chama o servidor', z.calls.fn.length === 0);
  z = await sync({ champs: OCT_BRUNO, since: ISO('2026-09-15'), duels: { '2026-09': { r: 'bruno', res: 'none', m: 0, t: 0 }, '2026-10': { r: 'bruno', res: 'fora', m: 0, t: 6 } }, lead: 'theirs' });
  check('a virada mudou (guardado "theirs", agora "mine"): manda só a virada', z.calls.fn.length === 1 && z.calls.fn[0][1].lead === 'mine' && z.calls.fn[0][1].duels.length === 0, z.calls.fn);
  z = await sync({ champs: [], since: ISO('2026-09-15'), duels: { '2026-09': { r: 'bruno', res: 'none', m: 0, t: 0 }, '2026-10': { r: 'bruno', res: 'none', m: 0, t: 0 } }, lead: 'mine', badges: { Ana: ['b1'], Bruno: ['b1', 'b2'], Carla: [], Gil: [] } });
  check('quem passou de "mine" para "theirs" manda "theirs"; empate no placar (diff 0) não manda nada', z.calls.fn.length === 1 && z.calls.fn[0][1].lead === 'theirs');
  z = await sync({ champs: [], since: ISO('2026-09-15'), duels: { '2026-09': { r: 'bruno', res: 'none', m: 0, t: 0 }, '2026-10': { r: 'bruno', res: 'none', m: 0, t: 0 } }, lead: 'mine', badges: { Ana: ['b1'], Bruno: ['b1'], Carla: [], Gil: [] } });
  check('empate no placar não manda nada', z.calls.fn.length === 0);
  z = await sync({ champs: [], since: ISO('2026-05-10'), duels: {}, lead: 'mine', badges: { Ana: ['b1'], Bruno: ['b1'], Carla: [], Gil: [] } });
  check('6 meses com o mesmo rival e nenhuma badge de tempo ainda: manda tenure true (com os meses fechados, que valem none)', z.calls.fn.length === 1 && z.calls.fn[0][1].tenure === true && z.calls.fn[0][1].duels.length === 6 && z.calls.fn[0][1].duels.every(d => d.res === 'none'), z.calls.fn);
  z = await sync({ champs: [], since: ISO('2026-05-10'), duels: Object.fromEntries(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map(k => [k, { r: 'bruno', res: 'none', m: 0, t: 0 }])), lead: 'mine', badges: { Ana: ['b1'], Bruno: ['b1'], Carla: [], Gil: [] }, pub: { ana: { awards: { rival_3m: 1, rival_6m: 1 } } } });
  check('as badges de tempo já ganhas (3 e 6 meses) não pedem de novo; com 12 meses ainda faltaria só a de 12 (aqui são 6)', z.calls.fn.length === 0);
  z = await sync({ champs: [], since: ISO('2025-11-05'), duels: {}, lead: 'mine', badges: { Ana: ['b1'], Bruno: ['b1'], Carla: [], Gil: [] }, pub: { ana: { awards: { rival_3m: 1, rival_6m: 1 } } } });
  check('com 12 meses e só as de 3 e 6 ganhas: pede a de 12', z.calls.fn.some(([n, d]) => d.tenure === true));
  // o aviso do tempo (tenure) nos limites: 2 meses ainda não; 3 meses sim; com a de 3 já ganha, 6 meses ainda pedem a de 6; com as duas ganhas, nada
  const allClosed = from => { const d = {}; for (let m = from; m <= '2026-10'; m = A.monthShift(m, 1)) d[m] = { r: 'bruno', res: 'none', m: 0, t: 0 }; return d; };
  const tn = async (since, awards) => (await sync({ champs: [], since: ISO(since), duels: allClosed(since.slice(0, 7)), lead: 'mine', badges: { Ana: ['b1'], Bruno: ['b1'], Carla: [], Gil: [] }, pub: awards ? { ana: { awards } } : {} })).calls.fn;
  const t2 = await tn('2026-09-10'), t3 = await tn('2026-08-10'), t6a = await tn('2026-05-10', { rival_3m: 1 }), t6b = await tn('2026-05-10', { rival_3m: 1, rival_6m: 1 });
  check('o aviso do tempo: 2 meses ainda não (nenhuma chamada); 3 meses pedem a de Rival de Estimação; com 6 meses e só a de 3 ganha pedem a de 6; com as duas ganhas, nada', t2.length === 0 && t3.length === 1 && t3[0][1].tenure === true && t3[0][1].duels.length === 0 && t6a.length === 1 && t6a[0][1].tenure === true && t6b.length === 0, [t2.length, t3.length, t6a.length, t6b.length]);
  const simE = await sync({ champs: OCT_BRUNO, sim: 'carla' });
  check('na simulação do admin ("Ver como"), sem rival, sem servidor ou sem o app carregado: não manda nada', simE.calls.fn.length === 0 && (await sync({ champs: OCT_BRUNO, noRivalDoc: true })).calls.fn.length === 0 && (await sync({ champs: OCT_BRUNO, db: null })).calls.fn.length === 0 && (await sync({ champs: OCT_BRUNO, ready: false })).calls.fn.length === 0);
  const once2 = makeEnv({ champs: OCT_BRUNO, since: ISO('2026-09-15') });
  await once2.api.rivalProgressSync(); await once2.api.rivalProgressSync(); await tick(); await once2.api.rivalProgressSync();
  check('chamar várias vezes (a cada desenho da tela) manda os meses UMA vez só, mesmo antes de o documento da conta voltar do servidor', once2.calls.fn.filter(([n, d]) => d.duels.length > 0).length === 1, once2.calls.fn.map(x => x[1].duels.length));
  let failN = 0;
  const bad2 = makeEnv({ champs: OCT_BRUNO, since: ISO('2026-09-15'), fn: async () => { failN++; throw new Error('sem rede'); } });
  await bad2.api.rivalProgressSync(); await tick(); await bad2.api.rivalProgressSync(); await tick();
  check('se o servidor falhar, tenta de novo só depois de 10 minutos (e sem estourar)', failN === 1 && bad2.calls.fn.length === 1);
  clock.now += 11 * 60000;
  await bad2.api.rivalProgressSync(); await tick();
  check('…passados os 10 minutos tenta de novo, com os mesmos meses (não foram dados como enviados)', failN === 2 && JSON.stringify(bad2.calls.fn[1][1].duels) === JSON.stringify(bad2.calls.fn[0][1].duels));
  const wait9 = makeEnv({ champs: OCT_BRUNO, since: ISO('2026-09-15'), fn: async () => { throw new Error('sem rede'); } });
  await wait9.api.rivalProgressSync(); await tick();
  clock.now += 9 * 60000;
  await wait9.api.rivalProgressSync(); await tick();
  check('depois de uma falha, 9 minutos depois ainda espera (a espera é de 10)', wait9.calls.fn.length === 1, wait9.calls.fn.length);
  const conc = makeEnv({ champs: OCT_BRUNO, since: ISO('2026-09-15'), fn: async () => { await tick(); return { ok: true }; } });
  await Promise.all([conc.api.rivalProgressSync(), conc.api.rivalProgressSync(), conc.api.rivalProgressSync()]);
  check('três chamadas ao mesmo tempo mandam UMA vez só (as outras esperam a primeira terminar)', conc.calls.fn.length === 1, conc.calls.fn.length);
  for (const flag of ['ready', 'playersReady', 'ranksReady', 'cfgReady', 'rivalReady', 'rivalPubReady']) {
    const z2 = makeEnv({ champs: OCT_BRUNO, since: ISO('2026-09-15') });
    z2.st[flag] = false;
    await z2.api.rivalProgressSync(); await tick();
    check(`o progresso não é mandado enquanto "${flag}" não chegou (nenhuma chamada ao servidor)`, z2.calls.fn.length === 0, [flag, z2.calls.fn.length]);
  }

  // ══ 9. COMO ESTÁ LIGADO NO APP ════════════════════════════════════════════════════════════════════
  const semComentarios = rivalCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('o envio só leva o que o servidor precisa: o liga, os meses {month,res,m,t}, a virada e o aviso de tempo — nenhum nome de jogador, rival ou e-mail', /callFn\('saveRivalProgress', \{ liga: st\.leagueId, duels, \.\.\.\(leadSend \? \{ lead \} : \{\}\), \.\.\.\(tenure \? \{ tenure: true \} : \{\}\) \}\)/.test(semComentarios) && /\{ month: m, res: d\.res, m: none \? 0 : d\.m, t: none \? 0 : d\.t \}/.test(semComentarios));
  const sv = html.slice(html.indexOf('function vMeuJogador()'), html.indexOf('function titlesBeforeDate('));
  check('a tela EU manda o progresso ao servidor só no próprio perfil (nunca na simulação do admin), uma vez por desenho, sem deixar um erro solto', /if \(!st\.mjPreviewKey && st\.authUser\?\.uid\) rivalProgressSync\(\)/.test(sv) && (sv.match(/rivalProgressSync\(\)/g) || []).length === 1);
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
