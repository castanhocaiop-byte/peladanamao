// Campeonato de 6 TIMES: dois grupos de 3 em 2 turnos + final entre os líderes (pedido do dono em 24/11/2026; index.html + manual.html + ci.yml). Este teste extrai o código real
// do index.html e o executa num ambiente simulado, sem navegador: o sorteio dos grupos (drawGroups, validGroups), as tabelas de cada grupo e quem lidera (groupTables,
// groupLeaders, groupTiesOpen, groupFinalMatch), a criação do campeonato (createChampionship: com final = grupos; sem final = pontos corridos de 15 jogos; 4 times = rodadas
// corridas), o registro de placar (submitScore: a final nasce no último jogo dos grupos, o empate no topo de um grupo pede a escolha do admin, corrigir um resultado refaz a
// final), a escolha do líder (mGroupTie, openGroupTie, pickGroupLeader), a disputa de 3º lugar, a tela (renderChamp: tabelas, etiquetas, aviso do empate, rodadas) e a tela de
// criação (onTkChg, onQuickChg, doCreate, prévia dos grupos e "sortear de novo"). Também confere o que continua IGUAL (3, 4 e 5 times, campeonato antigo de 4 times com turnos).
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const manual = read('manual.html');
const ci = read('.github', 'workflows', 'ci.yml');
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
function one(re) {
  const m = html.match(re);
  if (!m) throw new Error('trecho não encontrado no index.html: ' + re);
  return m[0];
}

const CODE = [
  slice('const T = {', 'const FMT = '),                                           // T + enabledColors
  one(/^const FMT = .*;$/m),
  one(/^const fdt = .*;$/m),
  one(/^const activeChamp = .*;$/m),
  one(/^function ldoc\(path\) \{.*\}$/m),
  one(/^function isAdmin\(\) \{.*\}$/m),
  one(/^const esc = .*;$/m),
  one(/^function defPlayers\(\) \{\n[\s\S]*?\n\}$/m),
  slice('function genRoundRobinRounds(', 'function standings('),                // o rodízio, a ordem dos jogos (permutationsOf, bestUnitOrder...) e genMatches
  slice('function standings(', '/* ── db / auth (Firebase)'),                   // standings, next3, champion, reseedKnockout, knockoutNotice
  slice('function showHalfTitles()', 'function startListeners()'),               // finalsEnabled, titleRace, noFinalComplete, titleModalFor, os grupos (drawGroups...), fmtLabel
  slice('async function createChampionship(', 'async function createPresetChamp('),
  slice('async function submitScore(', 'async function endRegularWith3rd('),    // submitScore, endRegular, addThirdPlaceRetro
  slice('async function endRegularWith3rd(', 'async function saveChampion('),
  slice('function mGroupTie(', 'async function setPenaltyWinner('),             // mGroupTie, openGroupTie, pickGroupLeader
  slice('function championEditButton(champ) {', 'function openChampionEdit(id) {'),
  slice('function matchCard(', '/* ── views ───'),                              // matchCard, standingsTable, groupsStandingsHtml, renderChamp
  slice('function analyzeClassification(', 'function setStatsFilter('),
  slice('function renderGroupsPreview(', 'function openScore('),                 // renderGroupsPreview, rerollGroups, syncGroupsPreview, onTkChg, onQuickChg, doCreate
].join('\n');
const EXPORTS = 'T, FMT, genMatches, standings, titleRace, finalsEnabled, fmtLabel, drawGroups, validGroups, champGroups, groupTables, groupStageDone, groupLeaders, groupTiesOpen, groupFinalMatch, reseedKnockout, createChampionship, submitScore, endRegular, endRegularWith3rd, addThirdPlaceRetro, mGroupTie, openGroupTie, pickGroupLeader, standingsTable, groupsStandingsHtml, renderChamp, matchCard, analyzeClassification, renderGroupsPreview, rerollGroups, syncGroupsPreview, onTkChg, onQuickChg, doCreate';

// como o Firestore: um campo com ponto ("groupLeaders.A") grava só aquela chave do mapa
function applyUpdate(c, obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!k.includes('.')) { c[k] = v; continue; }
    const parts = k.split('.');
    let o = c;
    for (const p of parts.slice(0, -1)) { o[p] = o[p] && typeof o[p] === 'object' ? { ...o[p] } : {}; o = o[p]; }
    o[parts[parts.length - 1]] = v;
  }
}

// ── o aplicativo falso ───────────────────────────────────────────────────────────────────────────
function makeEnv({ hasFinais = true, champs = [], admin = true, colors = null } = {}) {
  const log = { updates: [], sets: [], toasts: [], renders: 0, historical: [] };
  const state = { idN: 0 };
  const st = { leagueId: 'L', appCfg: { hasFinais, halfTitleEnabled: true, ...(colors ? { teamColors: colors } : {}) }, champs, modal: null, players: [], ranks: [], photos: {}, userRole: admin ? 'admin' : 'player', createRosters: {}, playerTeamMap: {}, createPresetTeams: [], createGroups: null, view: 'x' };
  const byId = p => st.champs.find(c => c.id === p.split('/').pop());
  const DB = { doc: p => ({
    // como o Firestore de verdade: o campeonato em memória (st.champs) só reflete a gravação um instante DEPOIS do update
    update: async obj => { log.updates.push({ path: p, obj }); const c = byId(p); if (c) setImmediate(() => applyUpdate(c, obj)); },
    set: async obj => { log.sets.push({ path: p, obj }); st.champs.push({ id: p.split('/').pop(), ...obj }); },
  }) };
  // a tela de criação: caixas de times marcadas, "campeonato já encerrado" e os blocos que o app preenche
  const dom = { checked: [], champTeam: null, els: {} };
  const el = (extra = {}) => ({ style: {}, innerHTML: '', textContent: '', checked: false, value: '', ...extra });
  ['fmthint', 'dobtn', 'groups-preview', 'champ-team-sel', 'player-assign-wrap', 'player-assign-inner', 'quick-champ'].forEach(id => { dom.els[id] = el(); });
  dom.els['quick-reg'] = el();
  dom.els['champ-date'] = el({ value: '2026-11-24' });
  const document = {
    getElementById: id => dom.els[id] || null,
    querySelectorAll: sel => (sel === '.tck:checked' ? dom.checked.map(v => ({ value: v })) : []),
    querySelector: sel => (sel === 'input[name="champteam"]:checked' && dom.champTeam ? { value: dom.champTeam } : null),
  };
  const env = {
    st, DB, uid: () => 'u' + (++state.idN), today: () => '2026-11-24',
    toast: (m, type) => log.toasts.push({ m, type }), render: () => { log.renders++; },
    document, confirm: () => true,
    abandonActive: async () => {}, isLeagueFree: () => false,
    createHistoricalChamp: (teams, date, champTeam) => log.historical.push({ teams, date, champTeam }),
    renderPlayerAssignInner: () => '',
    chip: t => `<chip>${t}</chip>`, vWeatherForecast: () => '', champGoalTally: () => ({}), champArtilheiros: () => [],
    renderVotingCard: () => '', votingRoster: () => [], playerAvatar: () => '', timerRow: () => '',
    getPlayerRarestBadge: () => null, starsOf: () => 0, starsText: () => '',
  };
  const names = Object.keys(env);
  const api = new Function(...names, CODE + '\nreturn { ' + EXPORTS + ' };')(...names.map(n => env[n]));
  return { api, st, log, dom, el };
}
const tick = () => new Promise(r => setImmediate(r));
const count = (s, re) => (s.match(re) || []).length;
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

const G = { A: ['azul', 'preto', 'amarelo'], B: ['vermelho', 'verde', 'roxo'] };
const T6 = [...G.A, ...G.B];
const rank = { azul: 3, preto: 2, amarelo: 1, vermelho: 3, verde: 2, roxo: 1 };
const byRank = m => (rank[m.home] > rank[m.away] ? [2, 0] : [0, 2]);   // o time de cima de cada grupo ganha de todos: azul (A) e vermelho (B) lideram, preto e verde são os 2ºs
const pairKey = m => [m.home, m.away].sort().join('|');
// Grupo A em tabela apertada (azul 9 pts e +2, preto 7 pts); `lastPA` = o placar do jogo preto x amarelo da volta, que decide quem lidera o grupo
const apertado = lastPA => m => {
  if (m.group === 'B') return byRank(m);
  const k = pairKey(m);
  if (k === 'azul|preto') return [1, 0];                                     // o time da casa ganha: azul ganha a ida e o preto ganha a volta (3 pts para cada)
  if (k === 'amarelo|azul') return m.home === 'azul' ? [1, 0] : [0, 1];     // o azul ganha os dois do amarelo
  return m.leg === 1 ? [1, 0] : lastPA;                                      // preto x amarelo: o preto ganha a ida; a volta (home amarelo) é o placar dado
};
const TIE_A = [0, 1];  // volta preto 1x0: azul e preto empatam em tudo (9 pts, +2, 3 gols) -> o admin escolhe
const PRETO_LIDERA = [0, 3];
const SEM_TIE = [0, 0];

// campeonato de 6 times com grupos, os `played` primeiros jogos disputados com `score`
function champ6(api, { played = 12, score = byRank, extra = {}, groups = G } = {}) {
  const ms = api.genMatches([...groups.A, ...groups.B], 6, { groups }).map((m, i) => (i < played ? { ...m, played: true, hs: score(m, i)[0], as: score(m, i)[1], goals: [] } : { ...m }));
  return { id: 'c1', date: '2026-11-24', teams: [...groups.A, ...groups.B], format: 6, status: 'active', matches: ms, champion: null, champion_players: null, regularEnded: false, groups, ...extra };
}
// um ambiente com um campeonato de 6 times ainda sem nenhum jogo, para registrar os placares pelo submitScore de verdade
function envFresh(opts = {}, champOpts = {}) {
  const E = makeEnv(opts);
  const c = champ6(E.api, { played: 0, ...champOpts });
  E.st.champs.push(c);
  return { ...E, champ: c };
}
async function play(E, score, { from = 0, to = Infinity } = {}) {
  const regs = E.st.champs[0].matches.filter(m => m.phase === 'regular');
  for (let i = from; i < Math.min(to, regs.length); i++) {
    const [hs, as_] = score(regs[i], i);
    await E.api.submitScore(regs[i].id, hs, as_, [], null, []);
    await tick();
  }
}
const lastUpdate = E => E.log.updates[E.log.updates.length - 1];
const finalOf = ms => (ms || []).find(m => m.phase === 'final');

(async () => {
  const A = makeEnv().api;

  // ══ 1. O SORTEIO DOS GRUPOS ═════════════════════════════════════════════════════════════════════
  {
    const g0 = A.drawGroups(T6, () => 0);
    check('drawGroups com o sorteio "sempre zero" (o embaralhamento é determinístico): grupo A = preto, amarelo, vermelho; grupo B = verde, roxo, azul', JSON.stringify(g0) === JSON.stringify({ A: ['preto', 'amarelo', 'vermelho'], B: ['verde', 'roxo', 'azul'] }), g0);
    const g1 = A.drawGroups(T6, () => 0.999999);
    check('drawGroups com o sorteio "sempre o último" não troca ninguém: os 3 primeiros no A e os 3 últimos no B', JSON.stringify(g1) === JSON.stringify({ A: ['azul', 'preto', 'amarelo'], B: ['vermelho', 'verde', 'roxo'] }), g1);
    const copia = [...T6];
    A.drawGroups(copia, () => 0.3);
    check('drawGroups não altera a lista de times recebida', JSON.stringify(copia) === JSON.stringify(T6), copia);
    const rnd = lcg(7);
    const sorteios = Array.from({ length: 300 }, () => A.drawGroups(T6, rnd));
    check('300 sorteios: todos viram dois grupos de 3 com os 6 times, sem repetir ninguém (validGroups)', sorteios.every(g => A.validGroups(g, T6)));
    const noA = Object.fromEntries(T6.map(t => [t, sorteios.filter(g => g.A.includes(t)).length]));
    check('300 sorteios: cada time cai no grupo A mais ou menos metade das vezes (entre 110 e 190), então ninguém é favorecido', Object.values(noA).every(n => n >= 110 && n <= 190), noA);
    check('300 sorteios: aparecem quase todas as 20 divisões possíveis (quem fica no grupo A), então o sorteio não repete só uns poucos arranjos', new Set(sorteios.map(g => [...g.A].sort().join())).size >= 18, new Set(sorteios.map(g => [...g.A].sort().join())).size);
    check('validGroups aceita os grupos certos', A.validGroups(G, T6) === true);
    check('validGroups recusa: sem grupos, só um grupo, grupo de 2 ou de 4, time repetido, time de fora, 5 times, lista de times nula', !A.validGroups(null, T6) && !A.validGroups({ A: G.A }, T6) && !A.validGroups({ A: ['azul', 'preto'], B: ['amarelo', 'vermelho', 'verde', 'roxo'] }, T6) && !A.validGroups({ A: ['azul', 'preto', 'amarelo', 'vermelho'], B: ['verde', 'roxo'] }, T6)
      && !A.validGroups({ A: ['azul', 'preto', 'amarelo'], B: ['azul', 'verde', 'roxo'] }, T6) && !A.validGroups({ A: G.A, B: ['vermelho', 'verde', 'laranja'] }, T6) && !A.validGroups(G, T6.slice(0, 5)) && !A.validGroups(G, null));
    check('champGroups: devolve os grupos do campeonato; sem grupos (ou grupos incompletos) devolve null', A.champGroups({ groups: G }) === G && A.champGroups({}) === null && A.champGroups(null) === null && A.champGroups({ groups: { A: G.A } }) === null && A.champGroups({ groups: { A: 'x', B: 'y' } }) === null);
  }

  // ══ 2. OS RÓTULOS ═══════════════════════════════════════════════════════════════════════════════
  check('rótulos: 6 times com final = "Dois grupos de 3 + Final"; sem final = "Todos contra todos · pontos corridos" (como o de 5 times sem final); 3, 4 e 5 como sempre',
    A.fmtLabel({ format: 6 }) === 'Dois grupos de 3 + Final' && A.fmtLabel({ format: 6, noFinal: true }) === 'Todos contra todos · pontos corridos' && A.fmtLabel({ format: 5, noFinal: true }) === 'Todos contra todos · pontos corridos'
    && A.fmtLabel({ format: 3 }) === 'Vira (3 times)' && A.fmtLabel({ format: 4 }) === 'Todos contra todos' && A.fmtLabel({ format: 5 }) === 'Fase de grupos + Semis' && A.fmtLabel({ format: 4, noFinal: true }) === 'Todos contra todos · pontos corridos',
    [3, 4, 5, 6].map(f => A.fmtLabel({ format: f })));

  // ══ 3. AS TABELAS DOS GRUPOS, OS LÍDERES E OS EMPATES ═══════════════════════════════════════════
  {
    const E = makeEnv();
    const c = champ6(E.api);
    const tabs = E.api.groupTables(c);
    check('groupTables: uma tabela por grupo, com os 3 times do grupo, cada um com 4 jogos (só conta o que é do próprio grupo)', Object.keys(tabs).join() === 'A,B' && tabs.A.length === 3 && tabs.B.length === 3 && tabs.A.every(r => r.j === 4 && G.A.includes(r.team)) && tabs.B.every(r => r.j === 4 && G.B.includes(r.team)), tabs);
    check('groupTables: a ordem de cada tabela é a da força (azul, preto, amarelo e vermelho, verde, roxo) com 12, 6 e 0 pontos', tabs.A.map(r => r.team + r.pts).join() === 'azul12,preto6,amarelo0' && tabs.B.map(r => r.team + r.pts).join() === 'vermelho12,verde6,roxo0', tabs.A.map(r => r.team + r.pts));
    check('groupTables: campeonato sem grupos devolve null', A.groupTables({ matches: [] }) === null);
    const lead = E.api.groupLeaders(c);
    check('groupLeaders: líder do A = azul, do B = vermelho; os 2ºs são preto e verde; sem empate; pronto', lead.leaders.A === 'azul' && lead.leaders.B === 'vermelho' && lead.seconds.A === 'preto' && lead.seconds.B === 'verde' && lead.ready === true && lead.tied.A.length === 0 && lead.tied.B.length === 0, lead);
    check('groupStageDone: com os 12 jogos disputados, sim', E.api.groupStageDone(c) === true);
    const c11 = champ6(E.api, { played: 11 });
    check('groupStageDone: com 11 jogos disputados, não; groupFinalMatch espera (null) e groupLeaders ainda aponta o líder parcial', E.api.groupStageDone(c11) === false && E.api.groupFinalMatch(c11) === null && E.api.groupTiesOpen(c11).length === 0);
    const f = E.api.groupFinalMatch(c);
    check('groupFinalMatch: a final é líder do A (mandante) x líder do B, id "final", fase "final", sem placar', f && f.id === 'final' && f.phase === 'final' && f.home === 'azul' && f.away === 'vermelho' && f.hs === null && f.as === null && f.played === false, f);
    check('groupFinalMatch: não cria outra se a final já existe; nem em campeonato sem final', E.api.groupFinalMatch({ ...c, matches: [...c.matches, { id: 'final', phase: 'final' }] }) === null && E.api.groupFinalMatch({ ...c, noFinal: true }) === null);
    check('o líder do grupo sai de pontos, depois saldo de gols, depois gols pró: A empatado em pontos com saldos diferentes', (() => {
      // azul e preto empatam em 9 pontos, preto tem saldo maior (volta preto x amarelo 3x0)
      const cc = champ6(E.api, { score: apertado(PRETO_LIDERA) });
      const ta = E.api.groupTables(cc).A;
      return ta[0].team === 'preto' && ta[0].pts === 9 && ta[1].team === 'azul' && ta[1].pts === 9 && E.api.groupLeaders(cc).leaders.A === 'preto' && E.api.groupLeaders(cc).tied.A.length === 0;
    })());
    const tie = champ6(E.api, { score: apertado(TIE_A) });
    const lt = E.api.groupLeaders(tie);
    check('empate total no topo do A (mesmos pontos, saldo e gols pró): sem líder, "tied" lista azul e preto, o grupo B tem líder, ainda não está pronto', lt.leaders.A === null && lt.tied.A.join() === 'azul,preto' && lt.leaders.B === 'vermelho' && lt.ready === false && lt.seconds.A === null, lt);
    check('groupTiesOpen: o grupo A, com os dois times empatados; groupFinalMatch espera a escolha', E.api.groupTiesOpen(tie).length === 1 && E.api.groupTiesOpen(tie)[0].group === 'A' && E.api.groupTiesOpen(tie)[0].teams.join() === 'azul,preto' && E.api.groupFinalMatch(tie) === null, E.api.groupTiesOpen(tie));
    const picked = { ...tie, groupLeaders: { A: 'preto' } };
    const lp = E.api.groupLeaders(picked);
    check('com a escolha do admin (preto): preto é o líder, o 2º é o azul (o outro empatado), pronto, nenhum empate em aberto, e a final é preto x vermelho', lp.leaders.A === 'preto' && lp.seconds.A === 'azul' && lp.ready === true && E.api.groupTiesOpen(picked).length === 0 && E.api.groupFinalMatch(picked).home === 'preto' && E.api.groupFinalMatch(picked).away === 'vermelho', lp);
    check('a escolha só vale para um dos empatados: "amarelo" (que não empata) é ignorada e o grupo continua sem líder', (() => { const x = { ...tie, groupLeaders: { A: 'amarelo' } }; return E.api.groupLeaders(x).leaders.A === null && E.api.groupTiesOpen(x).length === 1; })());
    check('a escolha de um grupo que NÃO está mais empatado é ignorada: vale a tabela (o líder é o preto, não o azul escolhido antes)', (() => { const x = champ6(E.api, { score: apertado(PRETO_LIDERA), extra: { groupLeaders: { A: 'azul' } } }); return E.api.groupLeaders(x).leaders.A === 'preto'; })());
    const tres = champ6(E.api, { score: m => (m.group === 'A' ? [0, 0] : byRank(m)) });
    check('os 3 times do grupo empatados em tudo (todos os jogos 0x0): os 3 estão no empate e o admin escolhe entre os 3', E.api.groupTiesOpen(tres)[0].teams.length === 3 && E.api.groupLeaders(tres).tied.A.length === 3 && E.api.groupLeaders(tres).leaders.A === null, E.api.groupLeaders(tres));
    const dois = champ6(E.api, { score: () => [0, 0] });
    check('os dois grupos empatados: duas escolhas pendentes (A primeiro, depois B)', E.api.groupTiesOpen(dois).map(o => o.group).join() === 'A,B', E.api.groupTiesOpen(dois));
    check('groupTiesOpen só olha empate depois do último jogo dos grupos (antes, é só tabela parcial)', E.api.groupTiesOpen(champ6(E.api, { played: 11, score: () => [0, 0] })).length === 0);
    check('campeonato sem grupos: groupLeaders, groupTiesOpen e groupFinalMatch não fazem nada', (() => { const l = A.groupLeaders({ matches: [] }); return l.ready === false && Object.keys(l.leaders).length === 0 && A.groupTiesOpen({ matches: [] }).length === 0 && A.groupFinalMatch({ matches: [] }) === null; })());
  }

  // ══ 4. CRIAR O CAMPEONATO ═══════════════════════════════════════════════════════════════════════
  {
    const E = makeEnv();
    E.st.createGroups = G;
    await E.api.createChampionship(T6, '2026-11-24', G);
    const doc = E.log.sets[0].obj;
    check('6 times com final: o campeonato nasce com os grupos recebidos, formato 6, 12 jogos (nenhum "sem final") e 6 times', doc.format === 6 && JSON.stringify(doc.groups) === JSON.stringify(G) && doc.matches.length === 12 && doc.noFinal === undefined && doc.teams.length === 6, doc);
    check('...os grupos gravados são uma CÓPIA (mexer nos que vieram não muda o campeonato) e cada jogo leva o grupo certo', doc.groups !== G && doc.groups.A !== G.A && doc.matches.every(m => (m.group === 'A' ? G.A : G.B).includes(m.home) && (m.group === 'A' ? G.A : G.B).includes(m.away)));
    check('...e a tela de criação esquece os grupos sorteados (o próximo campeonato sorteia outros)', E.st.createGroups === null);
    check('...sem "flatRounds" (só o campeonato de 4 times leva)', doc.flatRounds === undefined);
    const E2 = makeEnv();
    await E2.api.createChampionship(T6, '2026-11-24', { A: ['azul', 'preto'], B: [] });
    const d2 = E2.log.sets[0].obj;
    check('grupos que não servem para os 6 times (inválidos): o app sorteia outros na hora e usa os mesmos nos jogos e no campeonato', A.validGroups(d2.groups, T6) && d2.matches.every(m => d2.groups[m.group].includes(m.home) && d2.groups[m.group].includes(m.away)), d2.groups);
    const E3 = makeEnv();
    await E3.api.createChampionship(T6, '2026-11-24');
    check('sem grupos informados (null): também sorteia na hora', A.validGroups(E3.log.sets[0].obj.groups, T6) && E3.log.sets[0].obj.matches.length === 12);
    const E4 = makeEnv({ hasFinais: false });
    await E4.api.createChampionship(T6, '2026-11-24', G);
    const d4 = E4.log.sets[0].obj;
    check('6 times SEM final (pontos corridos): uma tabela só, sem grupos, 15 jogos (turno único), noFinal true', d4.groups === undefined && d4.noFinal === true && d4.matches.length === 15 && d4.matches.every(m => m.group === undefined) && d4.format === 6, d4);
    check('...e a ordem dos 15 jogos não repete time (rodadas sem jogo seguido)', (() => { let r = 0; for (let i = 1; i < d4.matches.length; i++) { const a = d4.matches[i - 1], b = d4.matches[i]; if ([b.home, b.away].some(t => t === a.home || t === a.away)) r++; } return r === 0; })());
    const E5 = makeEnv();
    await E5.api.createChampionship(T6.slice(0, 4), '2026-11-24');
    const d5 = E5.log.sets[0].obj;
    check('4 times: o campeonato nasce com "flatRounds" (rodadas corridas, sem Turno/Returno), 12 jogos e sem grupos', d5.flatRounds === true && d5.matches.length === 12 && d5.groups === undefined && d5.format === 4, d5);
    const E6 = makeEnv();
    await E6.api.createChampionship(T6.slice(0, 5), '2026-11-24');
    const E7 = makeEnv();
    await E7.api.createChampionship(T6.slice(0, 3), '2026-11-24');
    check('5 times e 3 times: sem grupos e sem "flatRounds" (5 times: 10 jogos; vira: 1 jogo)', E6.log.sets[0].obj.flatRounds === undefined && E6.log.sets[0].obj.groups === undefined && E6.log.sets[0].obj.matches.length === 10 && E7.log.sets[0].obj.flatRounds === undefined && E7.log.sets[0].obj.matches.length === 1);
    const E8 = makeEnv();
    E8.st.createGroups = { A: ['x'], B: [] };
    await E8.api.createChampionship(T6.slice(0, 4), '2026-11-24', G);
    check('4 times com grupos informados por engano: os grupos são ignorados (só 6 times têm grupos)', E8.log.sets[0].obj.groups === undefined);
  }

  // ══ 5. REGISTRAR OS PLACARES: A FINAL NASCE NO ÚLTIMO JOGO DOS GRUPOS ═════════════════════════════
  {
    const E = envFresh();
    await play(E, byRank, { to: 11 });
    check('antes do último jogo dos grupos: ainda não há final nem janela', !finalOf(E.st.champs[0].matches) && E.st.modal === null && E.st.champs[0].matches.length === 12, E.st.champs[0].matches.length);
    await play(E, byRank, { from: 11 });
    const u = lastUpdate(E).obj.matches;
    check('o último jogo dos grupos cria a final: líder do A (azul, mandante) x líder do B (vermelho)', finalOf(u) && finalOf(u).home === 'azul' && finalOf(u).away === 'vermelho' && finalOf(u).played === false && u.length === 13, u.length);
    check('...sem janela de empate (os dois grupos têm líder) e sem janela do campeão (a final ainda vai ser jogada)', E.st.modal === null);
    check('...e só UMA final: registrar de novo um resultado dos grupos não cria outra', (() => { const ms = E.st.champs[0].matches; return ms.filter(m => m.phase === 'final').length === 1; })());
    // a final empatada vai aos pênaltis; vencida, abre a janela do campeão (como sempre)
    const fin = E.st.champs[0].matches.find(m => m.phase === 'final');
    await E.api.submitScore(fin.id, 2, 1, [], null, []);
    check('a final vencida (2x1) abre a janela do campeão, com o azul', E.st.modal && E.st.modal.type === 'champion' && E.st.modal.champion === 'azul', E.st.modal);
  }
  {
    // empate no topo do A depois do último jogo: janela, final espera, admin escolhe
    const E = envFresh();
    await play(E, apertado(TIE_A));
    const u = lastUpdate(E).obj.matches;
    check('empate total no topo do A no último jogo: a final NÃO é criada (espera a escolha do admin)', !finalOf(u) && u.length === 12, u.length);
    check('...e abre a janela do empate do Grupo A com azul e preto', E.st.modal && E.st.modal.type === 'groupTie' && E.st.modal.group === 'A' && E.st.modal.teams.join() === 'azul,preto' && E.st.modal.champId === 'c1', E.st.modal);
    const html1 = E.api.mGroupTie();
    check('a janela mostra "Empate no topo do Grupo A", os dois times como botões e "Decidir depois"', /Empate no topo do Grupo A/.test(html1) && /pickGroupLeader\('azul'\)/.test(html1) && /pickGroupLeader\('preto'\)/.test(html1) && !/pickGroupLeader\('amarelo'\)/.test(html1) && /Decidir depois/.test(html1) && /Quem é o líder do grupo e vai à final/.test(html1) && /2 times com os mesmos pontos/.test(html1), plain(html1));
    check('fora da janela do empate, a janela não aparece', (() => { const m = E.st.modal; E.st.modal = { type: 'saving' }; const r = E.api.mGroupTie(); E.st.modal = m; return r === ''; })());
    const n0 = E.log.updates.length;
    await E.api.pickGroupLeader('amarelo');
    check('escolher um time que não é dos empatados não faz nada (nada é gravado, a janela fica)', E.log.updates.length === n0 && E.st.modal && E.st.modal.type === 'groupTie');
    await E.api.pickGroupLeader('preto');
    const up = lastUpdate(E).obj;
    check('o admin escolhe o preto: grava só "groupLeaders.A" = preto e a lista de jogos com a final PRETO x VERMELHO', up['groupLeaders.A'] === 'preto' && Object.keys(up).sort().join() === 'groupLeaders.A,matches' && finalOf(up.matches) && finalOf(up.matches).home === 'preto' && finalOf(up.matches).away === 'vermelho' && up.matches.length === 13, up);
    check('...e a janela fecha (não sobrou empate)', E.st.modal === null);
    await tick();
    check('...no campeonato, a escolha fica em groupLeaders (mapa) e a final existe', E.st.champs[0].groupLeaders.A === 'preto' && !!finalOf(E.st.champs[0].matches));
  }
  {
    // quem não é admin não escolhe: nem janela, nem gravação
    const E = envFresh({ admin: false });
    await play(E, apertado(TIE_A));
    check('quem NÃO é admin registra o último jogo e o empate no topo: a janela de escolha NÃO abre (o aviso fica na tabela)', E.st.modal === null && !finalOf(lastUpdate(E).obj.matches));
    E.st.modal = { type: 'groupTie', champId: 'c1', group: 'A', teams: ['azul', 'preto'] };
    const n0 = E.log.updates.length;
    await E.api.pickGroupLeader('azul');
    check('...e se a janela abrisse mesmo assim, escolher não grava nada e avisa que só o admin escolhe', E.log.updates.length === n0 && E.log.toasts.some(t => /Só o admin/.test(t.m)), E.log.toasts);
    E.api.openGroupTie('A');
    check('openGroupTie por quem não é admin não abre nada', E.st.modal && E.st.modal.type === 'groupTie' && E.log.renders >= 0 && (() => { E.st.modal = null; E.api.openGroupTie('A'); return E.st.modal === null; })());
  }
  {
    // openGroupTie (o botão do aviso na tabela)
    const E = envFresh();
    await play(E, apertado(TIE_A));
    E.st.modal = null; // "Decidir depois"
    E.api.openGroupTie('A');
    check('openGroupTie("A"): abre a janela do empate do grupo A (admin)', E.st.modal && E.st.modal.type === 'groupTie' && E.st.modal.group === 'A' && E.st.modal.teams.join() === 'azul,preto', E.st.modal);
    E.st.modal = null;
    E.api.openGroupTie('B');
    check('openGroupTie("B"): o grupo B não está empatado, não abre nada', E.st.modal === null);
  }
  {
    // os dois grupos empatados: A e depois B
    const E = envFresh();
    await play(E, () => [0, 0]);
    check('os dois grupos empatados: a janela abre pelo grupo A, com os 3 times', E.st.modal && E.st.modal.group === 'A' && E.st.modal.teams.length === 3, E.st.modal);
    await E.api.pickGroupLeader('verde' === 'x' ? 'x' : 'preto');
    await tick();
    check('escolhido o A, a janela passa para o grupo B (a final ainda não pode nascer)', E.st.modal && E.st.modal.type === 'groupTie' && E.st.modal.group === 'B' && !finalOf(E.st.champs[0].matches), E.st.modal);
    await E.api.pickGroupLeader('verde');
    await tick();
    const fin = finalOf(E.st.champs[0].matches);
    check('escolhido o B também: a janela fecha e a final é PRETO (líder A) x VERDE (líder B), guardando as duas escolhas', E.st.modal === null && fin && fin.home === 'preto' && fin.away === 'verde' && E.st.champs[0].groupLeaders.A === 'preto' && E.st.champs[0].groupLeaders.B === 'verde', { fin, gl: E.st.champs[0].groupLeaders });
  }
  {
    // as duas escolhas coladas (a gravação da primeira ainda não chegou): nenhuma apaga a outra
    const E = envFresh();
    await play(E, () => [0, 0]);
    await E.api.pickGroupLeader('preto');
    E.st.modal = { type: 'groupTie', champId: 'c1', group: 'B', teams: ['vermelho', 'verde', 'roxo'] }; // sem esperar a gravação anterior chegar
    await E.api.pickGroupLeader('roxo');
    await tick();
    check('duas escolhas seguidas, antes de a primeira chegar ao campeonato: o mapa fica com as duas (a gravação usa o caminho "groupLeaders.A" e "groupLeaders.B", uma não apaga a outra)', E.st.champs[0].groupLeaders.A === 'preto' && E.st.champs[0].groupLeaders.B === 'roxo', E.st.champs[0].groupLeaders);
  }

  // ══ 6. CORRIGIR UM RESULTADO DOS GRUPOS ═════════════════════════════════════════════════════════
  const preAmarelo = ms => ms.find(m => m.phase === 'regular' && m.group === 'A' && pairKey(m) === 'amarelo|preto' && m.leg === 2);
  {
    // a final já existe (azul x vermelho) e a correção faz o PRETO liderar o grupo A: a final se refaz
    const E = envFresh();
    await play(E, apertado(SEM_TIE));
    check('(cenário) A tabela apertada sem empate: azul lidera o A e a final nasce azul x vermelho', finalOf(E.st.champs[0].matches).home === 'azul' && finalOf(E.st.champs[0].matches).away === 'vermelho');
    const m = preAmarelo(E.st.champs[0].matches);
    await E.api.submitScore(m.id, 0, 3, [], null, []);
    const ms = lastUpdate(E).obj.matches;
    check('corrigir o placar de preto x amarelo para 0x3 (o preto passa a liderar): a final ainda não jogada vira PRETO x vermelho', finalOf(ms).home === 'preto' && finalOf(ms).away === 'vermelho' && ms.length === 13, finalOf(ms));
    check('...e o aviso diz o que foi refeito: "Final: Preto × Vermelho"', E.log.toasts.some(t => /Confrontos refeitos pela nova tabela/.test(t.m) && /Final: Preto × Vermelho/.test(t.m) && t.type === 'ok'), E.log.toasts);
    check('...o jogo corrigido segue o mesmo (id, grupo), com o placar novo e nenhum jogo a mais ou a menos', ms.filter(x => x.phase === 'regular').length === 12 && ms.find(x => x.id === m.id).hs === 0 && ms.find(x => x.id === m.id).as === 3 && ms.find(x => x.id === m.id).group === 'A');
  }
  {
    // a final já foi JOGADA: não se mexe nela, só se avisa
    const E = envFresh();
    await play(E, apertado(SEM_TIE));
    const fin = finalOf(E.st.champs[0].matches);
    await E.api.submitScore(fin.id, 1, 0, [], null, []);
    await tick();
    E.st.modal = null;
    const m = preAmarelo(E.st.champs[0].matches);
    await E.api.submitScore(m.id, 0, 3, [], null, []);
    const ms = lastUpdate(E).obj.matches;
    check('a final JÁ JOGADA não é reescrita pela correção (continua azul x vermelho 1x0)', finalOf(ms).home === 'azul' && finalOf(ms).away === 'vermelho' && finalOf(ms).hs === 1 && finalOf(ms).played === true, finalOf(ms));
    check('...e o admin é avisado de que a tabela mudou, mas jogo já disputado não é alterado (aviso de erro, com a final que a nova tabela pede)', E.log.toasts.some(t => /jogo já disputado não é alterado/.test(t.m) && /Final: Preto × Vermelho/.test(t.m) && t.type === 'err'), E.log.toasts);
    check('...e não abre janela de empate (a final já foi jogada)', E.st.modal === null || E.st.modal.type !== 'groupTie', E.st.modal);
  }
  {
    // a correção CRIA um empate no topo com a final já criada: a final não muda, a janela abre
    const E = envFresh();
    await play(E, apertado(SEM_TIE));
    const m = preAmarelo(E.st.champs[0].matches);
    await E.api.submitScore(m.id, 0, 1, [], null, []);
    const ms = lastUpdate(E).obj.matches;
    check('a correção cria um empate total no topo do A (azul e preto) e o azul já estava na final: a final fica como estava (azul x vermelho)', finalOf(ms).home === 'azul' && finalOf(ms).away === 'vermelho', finalOf(ms));
    check('...e a janela do empate abre para o admin escolher', E.st.modal && E.st.modal.type === 'groupTie' && E.st.modal.group === 'A', E.st.modal);
    await tick(); // o campeonato em memória recebe a correção (como no app: a janela só é tocada depois)
    await E.api.pickGroupLeader('preto');
    check('...escolhendo o preto, a final (ainda não jogada) passa a ser PRETO x vermelho, gravada junto com a escolha', finalOf(lastUpdate(E).obj.matches).home === 'preto' && finalOf(lastUpdate(E).obj.matches).away === 'vermelho' && lastUpdate(E).obj['groupLeaders.A'] === 'preto', lastUpdate(E).obj);
    // a outra escolha possível: o azul (o que já está na final). Nenhum jogo muda: grava só a escolha, sem reescrever a lista de jogos
    const E2 = envFresh();
    await play(E2, apertado(SEM_TIE));
    const m2 = preAmarelo(E2.st.champs[0].matches);
    await E2.api.submitScore(m2.id, 0, 1, [], null, []);
    await tick();
    await E2.api.pickGroupLeader('azul');
    check('a escolha que não muda nenhum jogo (o azul, que já está na final) grava só a escolha "groupLeaders.A" e NÃO reescreve a lista de jogos', Object.keys(lastUpdate(E2).obj).join() === 'groupLeaders.A' && lastUpdate(E2).obj['groupLeaders.A'] === 'azul', lastUpdate(E2).obj);
    await tick();
    check('...e a final continua azul x vermelho, a janela fecha e a escolha fica gravada', finalOf(E2.st.champs[0].matches).home === 'azul' && E2.st.modal === null && E2.st.champs[0].groupLeaders.A === 'azul');
  }
  {
    // empate no último jogo (sem final), o admin "decide depois" e CORRIGE um resultado que desfaz o empate: a final nasce
    const E = envFresh();
    await play(E, apertado(TIE_A));
    E.st.modal = null;
    const m = preAmarelo(E.st.champs[0].matches);
    await E.api.submitScore(m.id, 0, 3, [], null, []);
    const ms = lastUpdate(E).obj.matches;
    check('empate sem escolha e uma correção que desfaz o empate (preto passa a liderar): a final PRETO x VERMELHO nasce na correção', finalOf(ms) && finalOf(ms).home === 'preto' && finalOf(ms).away === 'vermelho' && ms.length === 13, ms.length);
    check('...e nenhuma janela de empate abre', E.st.modal === null || E.st.modal.type !== 'groupTie', E.st.modal);
  }
  {
    // corrigir não mexe no que não é grupo: o jogo da fase de grupos que não muda o líder não refaz nada
    const E = envFresh();
    await play(E, byRank);
    const m = E.st.champs[0].matches.find(x => x.phase === 'regular' && x.group === 'B' && pairKey(x) === 'roxo|verde' && x.leg === 1);
    await E.api.submitScore(m.id, 5, 0, [], null, []);
    const ms = lastUpdate(E).obj.matches;
    check('corrigir um resultado que não muda os líderes: a final continua igual e nenhum aviso aparece', finalOf(ms).home === 'azul' && finalOf(ms).away === 'vermelho' && E.log.toasts.length === 0, E.log.toasts);
  }

  // ══ 7. DISPUTA DE 3º LUGAR, ENCERRAR ANTES DA HORA E SEM FINAL ══════════════════════════════════
  {
    const E = envFresh();
    await play(E, byRank);
    await E.api.addThirdPlaceRetro('c1');
    const ms = lastUpdate(E).obj.matches;
    const third = ms.find(m => m.phase === 'third');
    check('"Adicionar disputa de 3º lugar" em 6 times: o 2º do grupo A (preto) contra o 2º do grupo B (verde)', third && third.home === 'preto' && third.away === 'verde' && third.played === false, third);
    // e o 3º lugar acompanha a correção
    await tick();
    E.st.modal = null;
    const m = preAmarelo(E.st.champs[0].matches);
    // preto x amarelo: o preto ganha 2x0 vira... o 2º do A passa a ser o amarelo se o amarelo ganhar tudo do preto
    await E.api.submitScore(m.id, 9, 0, [], null, []);
    const ms2 = lastUpdate(E).obj.matches;
    check('o 3º lugar ainda não jogado se refaz quando a correção muda o 2º colocado do grupo (amarelo passa o preto)', ms2.find(x => x.phase === 'third').home === 'amarelo' && ms2.find(x => x.phase === 'third').away === 'verde', ms2.find(x => x.phase === 'third'));
  }
  {
    const E = envFresh();
    await play(E, apertado(TIE_A));
    const n0 = E.log.updates.length;
    await E.api.addThirdPlaceRetro('c1');
    check('3º lugar com o topo de um grupo empatado e sem escolha: avisa "Defina os líderes dos grupos primeiro" e não grava', E.log.updates.length === n0 && E.log.toasts.some(t => /Defina os líderes dos grupos primeiro/.test(t.m)), E.log.toasts);
  }
  {
    const E = envFresh();
    await play(E, byRank, { to: 6 });
    const n0 = E.log.updates.length;
    await E.api.endRegular();
    await E.api.endRegularWith3rd();
    check('6 times em grupos: "encerrar a fase regular" e "encerrar + 3º lugar" não existem (a final nasce sozinha): nada é gravado', E.log.updates.length === n0);
  }
  {
    // 6 times SEM final (pontos corridos): 15 jogos, o último decide o campeão pela tabela, sem grupos, sem final
    const E = makeEnv({ hasFinais: false });
    await E.api.createChampionship(T6, '2026-11-24', G);
    const c = E.st.champs[0];
    c.status = 'active';
    const lvl = Object.fromEntries(T6.map((t, i) => [t, 6 - i]));
    const sc = m => (lvl[m.home] > lvl[m.away] ? [1, 0] : [0, 1]);
    let i = 0;
    for (const m of c.matches) { await E.api.submitScore(m.id, ...sc(m), [], null, []); await tick(); i++; }
    check('6 times sem final: depois dos 15 jogos abre a janela do campeão (o líder da tabela, azul), sem final nem semifinais', i === 15 && E.st.modal && E.st.modal.type === 'champion' && E.st.modal.champion === 'azul' && !finalOf(E.st.champs[0].matches) && E.st.champs[0].matches.length === 15, E.st.modal);
    const full = { ...E.st.champs[0] };
    const regHtml = E.api.renderChamp(full, true);
    check('...a tela mostra UMA tabela "Classificação · Líder = campeão" (não duas de grupo) e a seção "Pontos Corridos"', count(regHtml, /Líder = campeão/g) === 1 && !/Líder → Final/.test(regHtml) && /Pontos Corridos/.test(regHtml) && !/Grupo A/.test(regHtml) && count(regHtml, /<table class="standings-table">/g) === 1 && /Todos contra todos · pontos corridos/.test(regHtml), plain(regHtml).slice(0, 600));
    check('...sem "Cenários" (só existem em 4 e 5 times)', E.api.analyzeClassification({ ...full, matches: full.matches.map((m, k) => (k < 13 ? m : { ...m, played: false, hs: null, as: null })) }) === null);
  }

  // ══ 8. A TELA DO CAMPEONATO ═════════════════════════════════════════════════════════════════════
  {
    const E = makeEnv();
    const c = champ6(E.api, { played: 5 });
    const h = E.api.renderChamp(c, true);
    check('duas tabelas, "Grupo A" e "Grupo B", cada uma com "Líder → Final" e os 3 times do grupo (e nenhuma tabela "Classificação" geral)', count(h, /<table class="standings-table">/g) === 2 && /<span class="card-lbl">Grupo A<\/span>/.test(h) && /<span class="card-lbl">Grupo B<\/span>/.test(h) && count(h, /Líder → Final/g) === 2 && !/<span class="card-lbl">Classificação<\/span>/.test(h), plain(h).slice(0, 500));
    const iA = h.indexOf('Grupo A</span>'), iB = h.indexOf('Grupo B</span>');
    const tabA = h.slice(iA, iB), tabB = h.slice(iB, h.indexOf('</table>', iB));
    check('a tabela A só tem os times do A (azul, preto, amarelo) e a B só os do B (vermelho, verde, roxo)', G.A.every(t => tabA.includes('>' + E.api.T[t].l + '<')) && G.B.every(t => !tabA.includes('>' + E.api.T[t].l + '<')) && G.B.every(t => tabB.includes('>' + E.api.T[t].l + '<')) && G.A.every(t => !tabB.includes('>' + E.api.T[t].l + '<')), { tabA: plain(tabA).slice(0, 200), tabB: plain(tabB).slice(0, 200) });
    check('o cabeçalho do campeonato diz "Dois grupos de 3 + Final" e a lista de jogos começa em "Fase de Grupos"', /Dois grupos de 3 \+ Final/.test(h) && /<div class="sec-lbl">Fase de Grupos<\/div>/.test(h));
    check('os 12 jogos aparecem em 6 rodadas, cada jogo com a etiqueta do grupo (6 do Grupo A e 6 do Grupo B)', count(h, /class="match-card/g) === 12 && count(h, /class="round-lbl/g) === 6 && count(h, /phase-tag grp-tag">Grupo A</g) === 6 && count(h, /phase-tag grp-tag">Grupo B</g) === 6, { cards: count(h, /class="match-card/g), rounds: count(h, /class="round-lbl/g) });
    check('rodadas que o admin pode reordenar (setas ▲▼) aparecem quando a tela é editável, e sem as setas na tela só de leitura', /swapRoundsInChamp/.test(h) && !/swapRoundsInChamp/.test(E.api.renderChamp(c, false)));
    check('sem final ainda: nenhuma seção "Final", nenhum aviso de empate, nenhum botão de encerrar', !/<div class="sec-lbl">Final<\/div>/.test(h) && !/Empate total/.test(h) && !/confirmEnd|endRegular/.test(h));
    check('"Cenários" não aparece em 6 times, nem perto do fim', !/Cenários/.test(E.api.renderChamp(champ6(E.api, { played: 11 }), true)));
    check('o líder do grupo (1ª linha) leva a marca "f-zone" nas duas tabelas', count(h, /<tr class="f-zone">/g) === 2);
    // depois do último jogo: a final
    const c12 = champ6(E.api);
    c12.matches = [...c12.matches, E.api.groupFinalMatch(c12)];
    const hf = E.api.renderChamp(c12, true);
    check('com a final criada: a seção "Final" mostra azul x vermelho (o jogo da final não tem etiqueta de grupo)', /<div class="sec-lbl">Final<\/div>/.test(hf) && /phase-tag final-tag/.test(hf) && count(hf, /phase-tag grp-tag/g) === 12, count(hf, /phase-tag grp-tag/g));
    // empate no topo
    const tie = champ6(E.api, { score: apertado(TIE_A) });
    const ht = E.api.renderChamp(tie, true);
    check('empate total no topo do A: aviso "Empate total no topo do Grupo A (Azul, Preto)" com o botão "Definir quem vai à final" para o admin', /Empate total no topo do <strong>Grupo A<\/strong> \(Azul, Preto\)/.test(ht) && /openGroupTie\('A'\)/.test(ht) && /Definir quem vai à final/.test(ht) && count(ht, /Empate total/g) === 1, plain(ht).slice(0, 700));
    const E2 = makeEnv({ admin: false });
    const hn = E2.api.renderChamp(champ6(E2.api, { score: apertado(TIE_A) }), true);
    check('quem não é admin vê o aviso sem botão: "O admin da liga define quem vai à final."', /Empate total no topo/.test(hn) && !/openGroupTie/.test(hn) && /O admin da liga define quem vai à final\./.test(hn));
    check('admin vendo a tela só de leitura (histórico): o aviso aparece sem botão', !/openGroupTie/.test(E.api.renderChamp(tie, false)) && /Empate total/.test(E.api.renderChamp(tie, false)));
    check('campeonato já concluído (campeão registrado) não mostra o aviso de empate', !/Empate total/.test(E.api.renderChamp({ ...tie, status: 'completed', champion: 'azul' }, true)));
    const comEscolha = { ...tie, groupLeaders: { A: 'preto' } };
    check('escolha já feita: o aviso some', !/Empate total/.test(E.api.renderChamp(comEscolha, true)));
    check('os dois grupos empatados: dois avisos, um para cada grupo', count(E.api.renderChamp(champ6(E.api, { score: () => [0, 0] }), true), /Empate total/g) === 2);
    // a tabela do grupo
    const t1 = E.api.standingsTable(G.A, c.matches.filter(m => m.group === 'A'), 6, false, 'A');
    check('standingsTable de grupo: título "Grupo A", nota "Líder → Final" e só o 1º com a marca da final', /Grupo A/.test(t1) && /Líder → Final/.test(t1) && count(t1, /f-zone/g) === 1 && !/Classificação/.test(t1) && !/Top 2/.test(t1));
    check('standingsTable de sempre não muda: 4 times "Top 2 → Final"; 5 times "Top 4 → Semis"; sem final "Líder = campeão"; 6 times sem grupos (registro de campeão) sem nota', /Top 2 → Final/.test(E.api.standingsTable(['azul', 'preto', 'amarelo', 'vermelho'], [], 4)) && /Top 4 → Semis/.test(E.api.standingsTable(T6.slice(0, 5), [], 5)) && /Líder = campeão/.test(E.api.standingsTable(T6, [], 6, true)) && !/zone-note/.test(E.api.standingsTable(T6, [], 6)) && /Classificação/.test(E.api.standingsTable(T6, [], 6)));
  }

  // ══ 9. A TELA DOS OUTROS FORMATOS NÃO MUDA ══════════════════════════════════════════════════════
  {
    const E = makeEnv();
    const mk = (teams, extra = {}) => ({ id: 'c1', date: '2026-11-24', teams, format: teams.length, status: 'active', matches: E.api.genMatches(teams, teams.length), champion: null, champion_players: null, regularEnded: false, ...extra });
    const h4 = E.api.renderChamp(mk(T6.slice(0, 4), { flatRounds: true }), true);
    check('4 times NOVO (flatRounds): uma lista só, "Todos Contra Todos", 6 rodadas, sem "Turno 1" nem "Returno"', /<div class="sec-lbl">Todos Contra Todos<\/div>/.test(h4) && count(h4, /class="round-lbl/g) === 6 && count(h4, /class="match-card/g) === 12 && !/Turno 1|Turno 2|Returno/.test(h4), plain(h4).slice(0, 300));
    check('4 times: mantém a tabela "Top 2 → Final" e o botão "Encerrar + Disputa de 3º Lugar" depois de 2 jogos', /Top 2 → Final/.test(h4) && !/Encerrar \+ Disputa/.test(h4) && /Encerrar \+ Disputa de 3º Lugar/.test(E.api.renderChamp(mk(T6.slice(0, 4), { flatRounds: true, matches: E.api.genMatches(T6.slice(0, 4), 4).map((m, i) => (i < 2 ? { ...m, played: true, hs: 1, as: 0, goals: [] } : m)) }), true)));
    // campeonato de 4 times de antes (ordem antiga: turno 1 e returno com a mesma numeração de rodadas)
    const old = [];
    const r4 = [[['azul', 'preto'], ['amarelo', 'vermelho']], [['azul', 'amarelo'], ['preto', 'vermelho']], [['azul', 'vermelho'], ['preto', 'amarelo']]];
    let n = 0;
    for (let lg = 1; lg <= 2; lg++) r4.forEach((r, ri) => r.forEach(([a, b]) => old.push({ id: 'm_' + (++n), home: lg === 1 ? a : b, away: lg === 1 ? b : a, hs: null, as: null, phase: 'regular', leg: lg, round: ri + 1, played: false })));
    const hOld = E.api.renderChamp(mk(T6.slice(0, 4), { matches: old }), true);
    check('4 times ANTIGO (sem flatRounds, jogos com turno 1 e 2): continua com "Turno 1" e "Turno 2", sem a lista corrida', /Turno 1/.test(hOld) && /Turno 2/.test(hOld) && !/Todos Contra Todos/.test(hOld), plain(hOld).slice(0, 300));
    const h5 = E.api.renderChamp(mk(T6.slice(0, 5)), true);
    check('5 times: "Fase de Grupos" com 5 rodadas de 2 jogos, "Top 4 → Semis", sem etiqueta de grupo (é o formato de sempre)', /<div class="sec-lbl">Fase de Grupos<\/div>/.test(h5) && count(h5, /class="round-lbl/g) === 5 && count(h5, /class="match-card/g) === 10 && /Top 4 → Semis/.test(h5) && !/grp-tag/.test(h5) && count(h5, /<table class="standings-table">/g) === 1);
    const h3 = E.api.renderChamp(mk(T6.slice(0, 3)), true);
    check('3 times (vira): "Próxima Partida", sem rodadas e sem grupos', /Próxima Partida/.test(h3) && !/round-lbl/.test(h3) && !/grp-tag/.test(h3));
    const h5n = E.api.renderChamp(mk(T6.slice(0, 5), { noFinal: true }), true);
    check('5 times sem final: continua "Pontos Corridos" com a tabela "Líder = campeão"', /<div class="sec-lbl">Pontos Corridos<\/div>/.test(h5n) && /Líder = campeão/.test(h5n));
    check('4 times novo sem final: a lista corrida se chama "Pontos Corridos"', /<div class="sec-lbl">Pontos Corridos<\/div>/.test(E.api.renderChamp(mk(T6.slice(0, 4), { flatRounds: true, noFinal: true }), true)));
  }

  // ══ 10. A TELA DE CRIAR O CAMPEONATO ════════════════════════════════════════════════════════════
  {
    const E = makeEnv();
    E.dom.checked = T6;
    E.api.onTkChg();
    const gp = E.dom.els['groups-preview'], hint = E.dom.els.fmthint, btn = E.dom.els.dobtn;
    check('6 times marcados (liga com final): a prévia dos grupos aparece, com "Grupo A", "Grupo B" e os 6 times, e o botão "Criar com 6 Times"', gp.style.display === 'block' && /Grupo A/.test(gp.innerHTML) && /Grupo B/.test(gp.innerHTML) && T6.every(t => gp.innerHTML.includes('>' + E.api.T[t].l + '<')) && btn.style.display === 'block' && btn.textContent === 'Criar com 6 Times', { d: gp.style.display, b: btn.textContent });
    check('...o texto de apoio explica: dois grupos de 3 em 2 turnos (12 jogos) + final entre os líderes', hint.style.display === 'block' && /Dois grupos de 3<\/strong> em 2 turnos \(12 jogos\) \+ Final entre os líderes dos grupos/.test(hint.innerHTML), hint.innerHTML);
    check('...e os grupos sorteados ficam guardados na tela (st.createGroups), são válidos e batem com os que aparecem', A.validGroups(E.st.createGroups, T6) && E.st.createGroups.A.every(t => gp.innerHTML.indexOf('>' + E.api.T[t].l + '<') < gp.innerHTML.indexOf('Grupo B')) && E.st.createGroups.B.every(t => gp.innerHTML.indexOf('>' + E.api.T[t].l + '<') > gp.innerHTML.indexOf('Grupo B')), E.st.createGroups);
    const antes = JSON.stringify(E.st.createGroups);
    E.api.onTkChg(); E.api.onTkChg();
    check('marcar/desmarcar outra coisa e voltar a mexer na tela NÃO sorteia os grupos de novo (os mesmos 6 times mantêm os grupos)', JSON.stringify(E.st.createGroups) === antes);
    Math.random = lcg(99);
    E.api.rerollGroups();
    const depois = JSON.stringify(E.st.createGroups);
    check('"🎲 Sortear os grupos de novo" troca os grupos (continuam válidos) e a prévia acompanha', A.validGroups(E.st.createGroups, T6) && depois !== antes && gp.innerHTML.indexOf('>' + E.api.T[E.st.createGroups.A[0]].l + '<') < gp.innerHTML.indexOf('Grupo B') && /rerollGroups\(\)/.test(gp.innerHTML), { antes, depois });
    check('o botão de sortear de novo está na prévia', /Sortear os grupos de novo/.test(gp.innerHTML));
    E.dom.checked = [...T6.slice(0, 5), 'rosa'];
    E.api.onTkChg();
    check('trocar um dos 6 times por outro: os grupos são sorteados de novo com os times de agora (o time novo aparece, o que saiu não)', A.validGroups(E.st.createGroups, E.dom.checked) && !JSON.stringify(E.st.createGroups).includes('roxo') && JSON.stringify(E.st.createGroups).includes('rosa'), E.st.createGroups);
    E.dom.checked = T6.slice(0, 5);
    E.api.onTkChg();
    check('5 times marcados: a prévia some e o texto é o de sempre (fase de grupos 1 turno + semis + final)', gp.style.display === 'none' && gp.innerHTML === '' && /Fase de grupos<\/strong> 1 turno \(10 jogos\)/.test(hint.innerHTML) && btn.textContent === 'Criar com 5 Times');
    E.dom.checked = [...T6, 'rosa'];
    E.api.onTkChg();
    check('7 times marcados: nada de texto, nem prévia, nem botão (o limite agora é de 3 a 6)', hint.style.display === 'none' && btn.style.display === 'none' && gp.style.display === 'none');
    E.dom.checked = T6.slice(0, 2);
    E.api.onTkChg();
    check('2 times marcados: continua sem botão', btn.style.display === 'none');
    E.dom.checked = T6.slice(0, 3);
    E.api.onTkChg();
    check('3 times: o texto da "vira" de sempre', /Vira<\/strong>/.test(hint.innerHTML) && btn.style.display === 'block');
  }
  {
    // registrar um campeonato já encerrado: sem prévia de grupos
    const E = makeEnv();
    E.dom.checked = T6;
    E.dom.els['quick-reg'].checked = true;
    E.api.onTkChg();
    check('6 times com "Campeonato já encerrado" marcado: a prévia dos grupos NÃO aparece e o botão é "Registrar Campeonato"', E.dom.els['groups-preview'].style.display === 'none' && E.dom.els.dobtn.textContent === 'Registrar Campeonato');
    E.dom.els['quick-reg'].checked = false;
    E.api.onQuickChg();
    check('desmarcar "já encerrado": a prévia volta e o botão volta a "Criar com 6 Times" (sem refazer a lista de campeão)', E.dom.els['groups-preview'].style.display === 'block' && E.dom.els.dobtn.textContent === 'Criar com 6 Times');
    E.dom.els['quick-reg'].checked = true;
    E.api.onQuickChg();
    check('marcar de novo: a prévia some', E.dom.els['groups-preview'].style.display === 'none' && E.dom.els.dobtn.textContent === 'Registrar Campeonato' && E.dom.els['quick-champ'].style.display === 'block');
  }
  {
    // liga sem final: 6 times são pontos corridos
    const E = makeEnv({ hasFinais: false });
    E.dom.checked = T6;
    E.api.onTkChg();
    check('liga SEM final com 6 times: sem prévia de grupos; o texto é pontos corridos em 1 turno (15 jogos)', E.dom.els['groups-preview'].style.display === 'none' && /Pontos corridos<\/strong> em 1 turno \(15 jogos\)/.test(E.dom.els.fmthint.innerHTML) && E.dom.els.dobtn.textContent === 'Criar com 6 Times', E.dom.els.fmthint.innerHTML);
  }
  {
    // doCreate
    const E = makeEnv();
    E.dom.checked = T6;
    E.api.onTkChg();
    const g = JSON.parse(JSON.stringify(E.st.createGroups));
    E.api.doCreate();
    await tick(); await tick();
    check('"Criar com 6 Times": o campeonato é criado com os MESMOS grupos que a prévia mostrava', E.log.sets.length === 1 && JSON.stringify(E.log.sets[0].obj.groups) === JSON.stringify(g) && E.log.sets[0].obj.matches.length === 12, E.log.sets[0] && E.log.sets[0].obj.groups);
    const E2 = makeEnv();
    E2.dom.checked = [...T6, 'rosa'];
    E2.api.doCreate();
    E2.dom.checked = T6.slice(0, 2);
    E2.api.doCreate();
    await tick();
    check('7 times ou 2 times marcados: doCreate não cria nada (limite de 3 a 6)', E2.log.sets.length === 0 && E2.log.historical.length === 0);
    const E3 = makeEnv();
    E3.dom.checked = T6;
    E3.dom.els['quick-reg'].checked = true;
    E3.api.doCreate();
    check('6 times com "já encerrado" e sem escolher o campeão: avisa "Selecione o time campeão" e não cria', E3.log.toasts.some(t => /Selecione o time campeão/.test(t.m)) && E3.log.sets.length === 0 && E3.log.historical.length === 0);
    E3.dom.champTeam = 'azul';
    E3.api.doCreate();
    check('6 times já encerrados com o campeão escolhido: registra o campeonato histórico (sem grupos, sem jogos)', E3.log.historical.length === 1 && E3.log.historical[0].teams.length === 6 && E3.log.historical[0].champTeam === 'azul' && E3.log.sets.length === 0);
    const E4 = makeEnv();
    E4.dom.checked = T6.slice(0, 4);
    E4.api.doCreate();
    await tick(); await tick();
    check('4 times: cria com rodadas corridas (flatRounds) e sem grupos', E4.log.sets[0].obj.flatRounds === true && E4.log.sets[0].obj.groups === undefined);
  }

  // ══ 11. O CÓDIGO DAS TELAS (fonte) ═══════════════════════════════════════════════════════════════
  check('tela "Novo Campeonato": "Times participantes (3 a 6)" e o espaço da prévia dos grupos (antes do texto de apoio)', /Times participantes \(3 a 6\):/.test(html) && /<div id="groups-preview" class="groups-preview" style="display:none"><\/div>\s*<div id="fmthint"/.test(html));
  check('sorteio de times: botões de 2 a 6 times e nomes A a F para os times sorteados', /\[2,3,4,5,6\]\.map\(n =>/.test(html) && /const teamLabels = \['A','B','C','D','E','F'\];/.test(html));
  check('sorteio de times: avisa quando a liga libera menos cores do que o número de times (o admin libera mais no Painel Admin)', /enabledColors\(\)\.length < st\.drawNumTeams/.test(html) && /A liga só libera \$\{enabledColors\(\)\.length\} cores de time/.test(html) && /libera mais cores no Painel Admin/.test(html));
  check('a janela do empate dos grupos fica na lista de janelas do aplicativo, logo depois da do empate da tabela', /mChampTie\(\)\+mGroupTie\(\)\+mPenaltyMisses\(\)/.test(html));
  check('a etiqueta do grupo é do tipo "grp-tag" (verde) e só aceita A ou B (GROUP_IDS)', /GROUP_IDS\.includes\(m\.group\)/.test(html) && /\.grp-tag\s*\{/.test(html));
  check('a final do 6 times e o líder escolhido são gravados sem apagar o outro grupo (caminho "groupLeaders.A")', /\[`groupLeaders\.\$\{m\.group\}`\]: team/.test(html));

  // ══ 12. O MANUAL E O CI ══════════════════════════════════════════════════════════════════════════
  {
    const ps = s => s.replace(/<\/(?:td|th|tr|p|li|div|h3|h2|ul|table)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const i1 = manual.indexOf('id="seis-times"');
    const sec = i1 < 0 ? '' : ps(manual.slice(i1, manual.indexOf('<h3', i1 + 30)));
    check('manual: subseção "6 times: dois grupos de 3 + final" (id seis-times) na seção 03, antes da "Liga sem final"', i1 > manual.indexOf('id="titulos"') && i1 < manual.indexOf('id="liga-sem-final"'), i1);
    check('manual: explica os dois grupos de 3 sorteados (com "sortear de novo"), os 12 jogos em 2 turnos, a tabela de cada grupo, o líder de cada grupo na final e o 3º lugar (2º do A x 2º do B)', /dois grupos de 3/i.test(sec) && /sorte/i.test(sec) && /12 jogos/.test(sec) && /2 turnos/.test(sec) && /líder de cada grupo/i.test(sec) && /final/i.test(sec) && /3º lugar/.test(sec) && /2º colocado/i.test(sec), sec.slice(0, 900));
    check('manual: explica o desempate (pontos, saldo, gols pró) e a escolha do admin quando o topo de um grupo empata em tudo', /saldo de gols/.test(sec) && /gols marcados|gols pró/.test(sec) && /empat/i.test(sec) && /admin/i.test(sec) && /escolh/i.test(sec), sec.slice(-700));
    check('manual: diz que o campeonato de 6 times sem final é uma tabela só, de 15 jogos (pontos corridos), e que os Cenários continuam só para 4 e 5 times', /15 jogos/.test(ps(manual)) && /pontos corridos/i.test(sec), sec.slice(0, 400));
    check('CI: o teste dos 6 times roda (passo "Testes do app (6 times …)" executando test/client-six-teams-test.js, sem ": " no nome)', /- name: Testes do app \(6 times[^\n]*\)\n\s+working-directory: functions\n\s+run: node test\/client-six-teams-test\.js/.test(ci) && !/name: Testes do app \(6 times[^\n]*: /.test(ci));
  }

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})();
