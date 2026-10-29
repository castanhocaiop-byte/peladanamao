// Liga "sem final" = PONTOS CORRIDOS (index.html + manual.html). Quando a liga marca "Sem final", o campeonato novo não tem final, semifinais nem disputa de 3º lugar:
// o campeão é o time que somou MAIS PONTOS durante todo o campeonato (desempate: saldo de gols, depois gols marcados; empatado em tudo, o admin escolhe), e as
// conquistas ligadas à final ficam ocultas nessa liga. Este teste extrai o código real do index.html e o executa num ambiente simulado, sem navegador: a tabela
// (titleRace), o "já pode coroar?" (noFinalComplete), a janela do campeão ou do empate (titleModalFor, mChampTie, pickChampionTie), a criação do campeonato com a
// regra do dia (createChampionship), o registro de placar (submitScore), o encerramento (endRegular, confirmEnd, openChampModal), as telas (standingsTable,
// renderChamp), os cenários do título (analyzeClassification), a visibilidade das conquistas e o resumo do grupo. Também confere o que continua IGUAL na liga com final.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8').replace(/\r\n/g, '\n');
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
  one(/^const FMT = .*;$/m),
  slice('const T = {', 'function enabledColors()'),
  one(/^const fdt = .*;$/m),
  one(/^const activeChamp = .*;$/m),
  one(/^function ldoc\(path\) \{.*\}$/m),
  one(/^function isAdmin\(\) \{.*\}$/m),
  one(/^const esc = .*;$/m),
  one(/^function defPlayers\(\) \{\n[\s\S]*?\n\}$/m),
  slice('function genRoundRobinRounds(', 'function standings('),                // genRoundRobinRounds + genMatches
  slice('function standings(', '/* ── db / auth (Firebase)'),                   // standings, next3, champion
  slice('function showHalfTitles()', 'function startListeners()'),               // showHalfTitles + finalsEnabled, titleRace, noFinalComplete, titleModalFor, fmtLabel
  slice('async function createChampionship(', 'async function createPresetChamp('),
  slice('async function submitScore(', 'async function addThirdPlaceRetro('),    // submitScore + endRegular
  slice('function confirmEnd()', 'function upP('),                               // confirmEnd + openChampModal
  slice('// Sem final: empate total no topo da tabela', 'async function setPenaltyWinner('), // mChampTie + pickChampionTie
  slice('function standingsTable(', '/* ── views ───'),                          // standingsTable + renderChamp
  slice('function analyzeClassification(', 'function setStatsFilter('),
  slice('function getPlayerRarestBadge(', 'function computeVices('),
  slice('function gerarResumoChamp(', 'function copyChampSummary('),
  slice('const BADGE_CATALOG = [', '/* ── championship logic (pure)'),
  one(/^const RIVAL_ONLY_IDS = .*;$/m),
  one(/^const rivalVisible = .*;$/m),                                           // a comparação com o rival também só conta as conquistas visíveis na liga
  one(/^const rivalBadgeIds = .*;$/m),
].join('\n');
const EXPORTS = 'FMT, T, genMatches, standings, next3, champion, showHalfTitles, finalsEnabled, titleRace, noFinalComplete, titleModalFor, fmtLabel, defPlayers, createChampionship, submitScore, endRegular, confirmEnd, openChampModal, mChampTie, pickChampionTie, standingsTable, renderChamp, analyzeClassification, getPlayerRarestBadge, gerarResumoChamp, BADGE_CATALOG, rivalBadgeIds';

// ── o aplicativo falso ───────────────────────────────────────────────────────────────────────────
function makeEnv({ hasFinais = true, champs = [], admin = true, badgeCache = null, newBadges = {} } = {}) {
  const log = { updates: [], sets: [], toasts: [], renders: 0, confirms: [] };
  const state = { confirmAnswer: true, idN: 0, voting: true };
  const st = { leagueId: 'L', appCfg: { hasFinais, halfTitleEnabled: true, gameDay: 2 }, champs, modal: null, players: [], ranks: [], photos: {}, userRole: admin ? 'admin' : 'player', createRosters: {}, playerTeamMap: {}, createPresetTeams: [], view: 'x' };
  const byId = p => st.champs.find(c => c.id === p.split('/').pop());
  const DB = { doc: p => ({
    // como o Firestore de verdade: o campeonato em memória (st.champs) só reflete a gravação um instante DEPOIS do update; o código não pode depender dele estar pronto
    update: async obj => { log.updates.push({ path: p, obj }); const c = byId(p); if (c) setImmediate(() => Object.assign(c, obj)); },
    set: async obj => { log.sets.push({ path: p, obj }); st.champs.push({ id: p.split('/').pop(), ...obj }); },
  }) };
  const env = {
    st, DB, uid: () => 'u' + (++state.idN), today: () => '2026-10-15',
    toast: m => log.toasts.push(m), render: () => { log.renders++; },
    document: { getElementById: () => null },
    confirm: msg => { log.confirms.push(msg); return state.confirmAnswer; },
    abandonActive: async () => {}, isLeagueFree: () => false,
    chip: t => `<chip>${t}</chip>`, vWeatherForecast: () => '', champGoalTally: () => ({}), champArtilheiros: () => [],
    renderVotingCard: () => '', votingRoster: () => [], playerAvatar: () => '',
    matchCard: (m, editable) => `<match id="${m.id}" phase="${m.phase}" played="${m.played ? 1 : 0}"${editable ? ' editable' : ''}/>`,
    getBadgeCache: () => badgeCache, computeNewBadgesInChamp: () => newBadges,
    waLeagueTitle: () => 'Liga X', WA_APP_FOOTER: '[rodapé]', getChampAwards: () => null, champPlayerGames: () => 1,
    votingUsed: () => state.voting, monthBadgesOn: () => true, rivalBadgesShown: () => false, h2hOn: () => true, rivalAward: () => false, magicalDayPeriod: () => ({ word: 'Noite', fem: true }), enabledColors: () => [['azul', {}]],
  };
  const names = Object.keys(env);
  const api = new Function(...names, CODE + '\nreturn { ' + EXPORTS + ' };')(...names.map(n => env[n]));
  return { api, st, log, state };
}
const tick = () => new Promise(r => setImmediate(r));

const TEAMS3 = ['azul', 'preto', 'amarelo'];
const TEAMS4 = ['azul', 'preto', 'amarelo', 'vermelho'];
const TEAMS5 = ['azul', 'preto', 'amarelo', 'vermelho', 'verde'];
const wins = team => m => (m.home === team ? [1, 0] : m.away === team ? [0, 1] : [0, 0]); // `team` ganha todos por 1x0; os outros jogos empatam 0x0
const mt = (home, away, hs, as_, round, played = true) => ({ phase: 'regular', home, away, hs, as: as_, round, played });
const pair = (m, a, b) => (m.home === a && m.away === b) || (m.home === b && m.away === a);
const winner = (m, w) => (m.home === w ? [1, 0] : [0, 1]);
// campeonato pronto: `played` jogos disputados (os primeiros), o resto por jogar
function champOf(api, { teams, noFinal = false, played = Infinity, score = wins('azul'), extra = {} }) {
  const ms = api.genMatches(teams, teams.length).map((m, i) => (i < played ? { ...m, played: true, hs: score(m, i)[0], as: score(m, i)[1], goals: [] } : { ...m }));
  return { id: 'c1', date: '2026-10-14', teams, format: teams.length, status: 'active', matches: ms, champion: null, champion_players: null, regularEnded: false, ...(noFinal ? { noFinal: true } : {}), ...extra };
}
function envWith(opts, champOpts) {
  const E = makeEnv(opts);
  const champ = champOf(E.api, champOpts);
  E.st.champs.push(champ);
  return { ...E, champ };
}
const count = (s, re) => (s.match(re) || []).length;
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

(async () => {
  const A = makeEnv({}).api;

  // ══ 1. A REGRA DO DIA E OS RÓTULOS ══════════════════════════════════════════════════════════════
  {
    const E = makeEnv({ hasFinais: true });
    check('finalsEnabled: liga com final (hasFinais true) = true', E.api.finalsEnabled() === true);
    E.st.appCfg.hasFinais = false;
    check('finalsEnabled: liga sem final (hasFinais false) = false', E.api.finalsEnabled() === false);
    E.st.appCfg = {};
    check('finalsEnabled: configuração sem o campo (liga antiga) = com final, como sempre foi', E.api.finalsEnabled() === true);
    E.st.appCfg = undefined;
    check('finalsEnabled: sem configuração carregada ainda = com final (nunca esconde nada por engano)', E.api.finalsEnabled() === true);
  }
  check('fmtLabel com final: os três rótulos de sempre', A.fmtLabel({ format: 3 }) === 'Vira (3 times)' && A.fmtLabel({ format: 4 }) === 'Todos contra todos' && A.fmtLabel({ format: 5 }) === 'Fase de grupos + Semis');
  check('fmtLabel sem final: vira e todos contra todos ganham "· pontos corridos"; 5 times deixa de ser "Fase de grupos + Semis"',
    A.fmtLabel({ format: 3, noFinal: true }) === 'Vira (3 times) · pontos corridos' && A.fmtLabel({ format: 4, noFinal: true }) === 'Todos contra todos · pontos corridos' && A.fmtLabel({ format: 5, noFinal: true }) === 'Todos contra todos · pontos corridos',
    [3, 4, 5].map(f => A.fmtLabel({ format: f, noFinal: true })));

  // ══ 2. A TABELA: QUEM LIDERA (titleRace) ════════════════════════════════════════════════════════
  {
    const r = (ms, teams = TEAMS3) => A.titleRace(teams, ms);
    let x = r([mt('azul', 'preto', 1, 0), mt('azul', 'amarelo', 1, 0), mt('preto', 'amarelo', 9, 0)]);
    check('lidera quem tem MAIS PONTOS, mesmo com saldo de gols pior (azul 6 pts, +2; preto 3 pts, +8)', x.leader === 'azul' && x.tied.length === 1 && x.table[0].team === 'azul', x);
    x = r([mt('azul', 'amarelo', 3, 0), mt('preto', 'amarelo', 1, 0)]);
    check('mesmos pontos: o SALDO de gols decide (azul +3, preto +1)', x.leader === 'azul' && x.tied.length === 1, x);
    x = r([mt('azul', 'amarelo', 2, 0), mt('preto', 'amarelo', 2, 1)]);
    check('mesmos pontos e mesmos gols marcados, mas saldo diferente (azul +2, preto +1): o SALDO decide', x.leader === 'azul' && x.tied.length === 1, x);
    x = r([mt('azul', 'amarelo', 2, 1), mt('preto', 'amarelo', 1, 0)]);
    check('mesmos pontos e mesmo saldo: os GOLS MARCADOS decidem (azul 2, preto 1)', x.leader === 'azul' && x.tied.length === 1, x);
    x = r([mt('azul', 'preto', 1, 0), mt('azul', 'amarelo', 1, 0), mt('vermelho', 'preto', 2, 0), mt('vermelho', 'amarelo', 0, 0)], TEAMS4);
    check('mesmo saldo e mesmos gols marcados, mas menos pontos (vermelho 4 pts contra os 6 do azul): quem tem mais pontos lidera, sem empate', x.leader === 'azul' && x.tied.length === 1 && x.table[1].team === 'vermelho', x);
    x = r([mt('azul', 'amarelo', 1, 0), mt('preto', 'amarelo', 1, 0)]);
    check('empate em tudo no topo: sem líder, `tied` traz os empatados na ordem da tabela', x.leader === null && x.tied.length === 2 && x.tied[0] === 'azul' && x.tied[1] === 'preto', x);
    x = r([mt('azul', 'preto', 0, 0), mt('azul', 'amarelo', 0, 0), mt('preto', 'amarelo', 0, 0)]);
    check('os três empatados em tudo: os três em `tied`', x.leader === null && x.tied.join() === 'azul,preto,amarelo', x);
    x = r([]);
    check('sem nenhum jogo disputado: sem líder e sem empate (não há o que coroar)', x.leader === null && x.tied.length === 0, x);
    x = r([mt('azul', 'preto', null, null, 1, false)]);
    check('jogo não disputado não conta', x.leader === null && x.tied.length === 0, x);
    x = r([mt('azul', 'preto', 1, 0), { phase: 'final', played: true, home: 'preto', away: 'azul', hs: 5, as: 0 }, { phase: 'semifinal', played: true, home: 'preto', away: 'amarelo', hs: 5, as: 0 }, { phase: 'third', played: true, home: 'preto', away: 'amarelo', hs: 5, as: 0 }]);
    check('só a fase regular entra na tabela (final, semifinal e 3º lugar são ignorados)', x.leader === 'azul', x);
    x = r([mt('azul', 'preto', 1, 0), mt('azul', 'amarelo', 1, 0), mt('preto', 'amarelo', 1, 0), mt('azul', 'preto', 0, 1), mt('preto', 'amarelo', 1, 0)]);
    check('no vira os times jogam quantidades diferentes: vale o TOTAL de pontos, não a média (preto 9 pts em 4 jogos x azul 6 pts em 3)', x.leader === 'preto' && x.table[0].j === 4, x);
    x = r([mt('azul', 'preto', 2, 0), mt('azul', 'amarelo', 0, 0)]);
    check('um time com menos jogos e menos pontos nunca passa o líder (azul 4 pts em 2 jogos)', x.leader === 'azul', x);
  }

  // ══ 3. JÁ PODE COROAR? (noFinalComplete) E A JANELA (titleModalFor) ═════════════════════════════
  {
    const ms = (n, total) => Array.from({ length: total }, (_, i) => mt('azul', 'preto', i % 2, 0, 1, i < n));
    check('liga COM final: nunca é "sem final", mesmo com tudo jogado ou encerrado', A.noFinalComplete({ format: 4, regularEnded: true, matches: ms(12, 12) }) === false && A.noFinalComplete({ format: 4, matches: ms(12, 12) }) === false);
    check('sem final, encerrado pelo admin (regularEnded): completo, em qualquer formato', A.noFinalComplete({ noFinal: true, format: 3, regularEnded: true, matches: ms(3, 4) }) === true && A.noFinalComplete({ noFinal: true, format: 4, regularEnded: true, matches: ms(6, 12) }) === true);
    check('4 e 5 times: completo só quando TODOS os jogos foram disputados (11 de 12 não; 12 de 12 sim; 9 de 10 não; 10 de 10 sim)',
      A.noFinalComplete({ noFinal: true, format: 4, matches: ms(11, 12) }) === false && A.noFinalComplete({ noFinal: true, format: 4, matches: ms(12, 12) }) === true
      && A.noFinalComplete({ noFinal: true, format: 5, matches: ms(9, 10) }) === false && A.noFinalComplete({ noFinal: true, format: 5, matches: ms(10, 10) }) === true);
    check('vira (3 times) NUNCA completa sozinho: só o admin encerra (mesmo com todos os jogos disputados)', A.noFinalComplete({ noFinal: true, format: 3, regularEnded: false, matches: ms(5, 5) }) === false);
    check('campeonato sem nenhum jogo na lista não é "completo" (não há o que coroar)', A.noFinalComplete({ noFinal: true, format: 4, matches: [] }) === false);
    check('só os jogos da fase regular contam (um jogo de outra fase pendente não impede)', A.noFinalComplete({ noFinal: true, format: 4, matches: [...ms(12, 12), { phase: 'third', played: false }] }) === true);
    const incompleto = { noFinal: true, format: 4, matches: ms(11, 12) };
    check('o 2º parâmetro (as partidas já com o último placar) vale mais que as do campeonato salvo', A.noFinalComplete(incompleto, ms(12, 12)) === true && A.noFinalComplete(incompleto) === false);

    const camp = (matches, teams = TEAMS3) => ({ teams, matches });
    let m = A.titleModalFor(camp([mt('azul', 'amarelo', 2, 0), mt('preto', 'amarelo', 1, 0)]));
    check('com líder: abre a janela do CAMPEÃO (type champion) com ele e 5 linhas de jogador vazias (peso 1)', m && m.type === 'champion' && m.champion === 'azul' && m.players.length === 5 && m.players.every(p => p.name === '' && p.weight === 1), m);
    m = A.titleModalFor(camp([mt('azul', 'amarelo', 1, 0), mt('preto', 'amarelo', 1, 0)]));
    check('empate total no topo: abre a janela do EMPATE (champTie) com os empatados, sem escolher por ninguém', m && m.type === 'champTie' && m.teams.join() === 'azul,preto' && !('champion' in m), m);
    check('sem jogo nenhum: nenhuma janela', A.titleModalFor(camp([])) === null);
    m = A.titleModalFor(camp([mt('azul', 'amarelo', 1, 0)]), [mt('preto', 'amarelo', 4, 0), mt('preto', 'azul', 1, 0)]);
    check('o 2º parâmetro (partidas) também vale aqui: usa a tabela dessas partidas', m && m.champion === 'preto', m);
  }

  // ══ 4. CRIAR O CAMPEONATO GRAVA A REGRA DO DIA (createChampionship) ═════════════════════════════
  for (const [teams, fmt, nJogos] of [[TEAMS3, 3, 1], [TEAMS4, 4, 12], [TEAMS5, 5, 10]]) {
    const sem = makeEnv({ hasFinais: false });
    await sem.api.createChampionship(teams, '2026-10-15');
    const d = sem.log.sets[0] && sem.log.sets[0].obj;
    check(`${fmt} times, liga SEM final: o campeonato nasce com noFinal:true, ${nJogos} jogo(s) só da fase regular, ativo e sem campeão`, !!d && d.noFinal === true && d.format === fmt && d.matches.length === nJogos && d.matches.every(x => x.phase === 'regular') && d.status === 'active' && d.regularEnded === false && d.champion === null, d);
    const com = makeEnv({ hasFinais: true });
    await com.api.createChampionship(teams, '2026-10-15');
    const d2 = com.log.sets[0] && com.log.sets[0].obj;
    check(`${fmt} times, liga COM final: o documento não ganha o campo noFinal (nada muda para quem tem final)`, !!d2 && !('noFinal' in d2) && d2.matches.length === nJogos, d2);
    check(`${fmt} times: criar não mexe no resto (data, times, formato) e termina na tela inicial sem erro`, !!d && d.date === '2026-10-15' && d.teams.join() === teams.join() && sem.st.view === 'home' && sem.log.toasts.length === 0, { view: sem.st.view, toasts: sem.log.toasts });
  }

  // ══ 5. REGISTRAR PLACAR (submitScore) ═══════════════════════════════════════════════════════════
  async function jogaTudo(E, score, { upTo = Infinity } = {}) {
    let n = 0;
    for (;;) {
      const champ = E.st.champs.find(c => c.status === 'active');
      const m = champ.matches.find(x => !x.played && x.phase === 'regular');
      if (!m || n >= upTo) return n;
      const [hs, as_] = score(m, n);
      await E.api.submitScore(m.id, hs, as_, [], null, []);
      await tick();
      n++;
    }
  }
  const ativo = E => E.st.champs.find(c => c.status === 'active');
  {
    // 4 times, sem final
    const E = makeEnv({ hasFinais: false });
    await E.api.createChampionship(TEAMS4);
    const n = await jogaTudo(E, wins('azul'), { upTo: 11 });
    const c = ativo(E);
    check('4 times sem final: do 1º ao 11º jogo nada se abre e nada é criado (12 jogos na lista, nenhuma janela)', n === 11 && E.st.modal === null && c.matches.length === 12 && !c.matches.some(m => m.phase !== 'regular'), { n, modal: E.st.modal, len: c.matches.length });
    await jogaTudo(E, wins('azul'));
    const ult = E.log.updates[E.log.updates.length - 1].obj;
    check('4 times sem final: o 12º (último) jogo abre a janela do CAMPEÃO com o líder (azul) e 5 linhas de jogador, sem criar final', E.st.modal && E.st.modal.type === 'champion' && E.st.modal.champion === 'azul' && E.st.modal.players.length === 5 && !c.matches.some(m => m.phase === 'final') && c.matches.length === 12, { modal: E.st.modal, len: c.matches.length });
    check('o registro de placar só grava as partidas (nada de campeão nem status): o campeão só é gravado ao salvar os jogadores', Object.keys(ult).join() === 'matches' && c.champion === null && c.status === 'active' && E.log.toasts.length === 0, { keys: Object.keys(ult), champion: c.champion, toasts: E.log.toasts });

    // a mesma sequência com final: igual a antes
    const F = makeEnv({ hasFinais: true });
    await F.api.createChampionship(TEAMS4);
    await jogaTudo(F, wins('azul'));
    const cf = ativo(F);
    const fin = cf.matches.filter(m => m.phase === 'final');
    check('4 times COM final (como sempre): o último jogo cria a FINAL entre os dois primeiros (azul x preto) e não abre janela de campeão', fin.length === 1 && fin[0].home === 'azul' && fin[0].away === 'preto' && fin[0].played === false && F.st.modal === null && cf.matches.length === 13, { fin, modal: F.st.modal });

    // 5 times
    const E5 = makeEnv({ hasFinais: false });
    await E5.api.createChampionship(TEAMS5);
    await jogaTudo(E5, wins('azul'));
    const c5 = ativo(E5);
    check('5 times sem final: depois dos 10 jogos NÃO há semifinais nem final e abre a janela do campeão (azul)', c5.matches.length === 10 && !c5.matches.some(m => m.phase !== 'regular') && E5.st.modal && E5.st.modal.type === 'champion' && E5.st.modal.champion === 'azul', { len: c5.matches.length, modal: E5.st.modal });
    const F5 = makeEnv({ hasFinais: true });
    await F5.api.createChampionship(TEAMS5);
    await jogaTudo(F5, wins('azul'));
    const f5 = ativo(F5);
    const sf = f5.matches.filter(m => m.phase === 'semifinal');
    check('5 times COM final (como sempre): o último jogo cria as 2 semifinais (1º x 4º e 2º x 3º) e não abre janela de campeão', sf.length === 2 && sf[0].home === 'azul' && F5.st.modal === null && f5.matches.length === 12, { sf, modal: F5.st.modal });
  }
  {
    // empates no topo
    const todos = makeEnv({ hasFinais: false });
    await todos.api.createChampionship(TEAMS4);
    await jogaTudo(todos, () => [0, 0]);
    check('4 times sem final, 12 empates 0x0: os 4 empatados em tudo -> janela do EMPATE com os 4 times, na ordem da tabela', todos.st.modal && todos.st.modal.type === 'champTie' && todos.st.modal.teams.join() === TEAMS4.join(), todos.st.modal);

    const dois = (extra) => (m) => {
      if (extra) { const r = extra(m); if (r) return r; }
      if (pair(m, 'azul', 'preto') || pair(m, 'amarelo', 'vermelho')) return [0, 0];
      return m.home === 'azul' || m.away === 'azul' ? winner(m, 'azul') : winner(m, 'preto');
    };
    const E2 = makeEnv({ hasFinais: false });
    await E2.api.createChampionship(TEAMS4);
    await jogaTudo(E2, dois());
    check('azul e preto empatados em pontos, saldo e gols marcados (14 pts, +4, 4 gols): janela do empate só com os dois', E2.st.modal && E2.st.modal.type === 'champTie' && E2.st.modal.teams.join() === 'azul,preto', E2.st.modal);

    let primeiro = true;
    const E3 = makeEnv({ hasFinais: false });
    await E3.api.createChampionship(TEAMS4);
    await jogaTudo(E3, dois(m => { if (primeiro && pair(m, 'azul', 'amarelo')) { primeiro = false; return winner(m, 'azul').map(g => g * 2); } return null; }));
    check('mesmos pontos, mas azul ganhou um jogo por 2x0: o SALDO desempata e o campeão é o azul (sem janela de empate)', E3.st.modal && E3.st.modal.type === 'champion' && E3.st.modal.champion === 'azul', E3.st.modal);

    let a = true, b = true;
    const E4 = makeEnv({ hasFinais: false });
    await E4.api.createChampionship(TEAMS4);
    await jogaTudo(E4, m => {
      if (a && pair(m, 'azul', 'amarelo')) { a = false; return m.home === 'azul' ? [2, 1] : [1, 2]; }
      if (b && pair(m, 'preto', 'amarelo')) { b = false; return m.home === 'preto' ? [1, 0] : [0, 1]; }
      return [0, 0];
    });
    check('mesmos pontos e mesmo saldo (+1), mas azul fez 2 gols e preto 1: os GOLS MARCADOS desempatam e o campeão é o azul', E4.st.modal && E4.st.modal.type === 'champion' && E4.st.modal.champion === 'azul', E4.st.modal);
  }
  {
    // regras: a regra é a do dia em que o campeonato foi criado
    const E = makeEnv({ hasFinais: false });
    await E.api.createChampionship(TEAMS4);
    E.st.appCfg.hasFinais = true; // o admin muda a liga para "com final" no meio do campeonato
    await jogaTudo(E, wins('azul'));
    check('a liga virou "com final" no meio de um campeonato criado SEM final: ele continua pontos corridos (sem final criada, janela do campeão)', !ativo(E).matches.some(m => m.phase === 'final') && E.st.modal && E.st.modal.type === 'champion', E.st.modal);
    const G = makeEnv({ hasFinais: true });
    await G.api.createChampionship(TEAMS4);
    G.st.appCfg.hasFinais = false; // e o contrário
    await jogaTudo(G, wins('azul'));
    check('a liga virou "sem final" no meio de um campeonato criado COM final: ele continua com final (a final é criada e não abre janela)', ativo(G).matches.some(m => m.phase === 'final') && G.st.modal === null);
  }
  {
    // corrigir placar depois do último jogo
    const E = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true });
    const ultimo = E.champ.matches[11];
    await E.api.submitScore(ultimo.id, 1, 0, [], null, []);
    check('registrar OUTRA VEZ o placar do último jogo (já disputado) não reabre a janela do campeão', E.st.modal === null && E.log.toasts.length === 0, E.st.modal);
    await E.api.submitScore(ultimo.id, 3, 0, [], 'c1', []);
    await tick();
    check('corrigir placar pelo histórico (campeonato informado) só grava as partidas e avisa "Gols atualizados!": não abre janela de campeão', E.st.modal === null && E.log.toasts.includes('Gols atualizados!') && E.champ.matches[11].hs === 3, { modal: E.st.modal, toasts: E.log.toasts });
  }
  {
    // vira
    const sem = makeEnv({ hasFinais: false });
    await sem.api.createChampionship(TEAMS3);
    const resultados = [[2, 0], [1, 0], [3, 1], [0, 1], [2, 0]];
    let i = 0;
    await jogaTudo(sem, () => resultados[i++], { upTo: 5 });
    const cv = ativo(sem);
    check('vira sem final: cada jogo cria o próximo (6 na lista após 5 disputados), nunca abre janela e nunca cria final', cv.matches.length === 6 && cv.matches.filter(m => m.played).length === 5 && sem.st.modal === null && !cv.matches.some(m => m.phase !== 'regular'), { len: cv.matches.length, modal: sem.st.modal });
    const com = makeEnv({ hasFinais: true });
    await com.api.createChampionship(TEAMS3);
    i = 0;
    await jogaTudo(com, () => resultados[i++], { upTo: 5 });
    check('vira com final (como sempre): também cria o próximo jogo a cada placar e não abre janela', ativo(com).matches.length === 6 && com.st.modal === null);
  }

  // ══ 6. ENCERRAR (endRegular, confirmEnd, openChampModal) ════════════════════════════════════════
  async function viraComJogos(hasFinais, n = 3) {
    const E = makeEnv({ hasFinais });
    await E.api.createChampionship(TEAMS3);
    const r = [[2, 0], [1, 0], [3, 1], [0, 1]];
    let i = 0;
    await jogaTudo(E, () => r[i++], { upTo: n });
    return E;
  }
  {
    const E = await viraComJogos(false);
    const r0 = E.log.renders;
    await E.api.endRegular();
    await tick();
    const c = ativo(E), ult = E.log.updates[E.log.updates.length - 1].obj;
    check('vira sem final, encerrar: a tela é redesenhada uma vez, depois de a janela do campeão ser aberta', E.log.renders === r0 + 1 && !!E.st.modal, { renders: E.log.renders - r0 });
    check('vira sem final, encerrar: tira o jogo que faltava (3 jogos, todos disputados), marca regularEnded e NÃO cria final', ult.regularEnded === true && ult.matches.length === 3 && ult.matches.every(m => m.played) && !ult.matches.some(m => m.phase === 'final') && c.regularEnded === true, ult);
    check('vira sem final, encerrar: abre a janela do campeão com o líder da tabela (azul, 9 pts) e 5 linhas de jogador', E.st.modal && E.st.modal.type === 'champion' && E.st.modal.champion === 'azul' && E.st.modal.players.length === 5, E.st.modal);
    check('vira sem final, encerrar: só grava matches e regularEnded (o campeão só é gravado ao salvar os jogadores)', Object.keys(ult).sort().join() === 'matches,regularEnded' && c.champion === null && E.log.toasts.length === 0, { keys: Object.keys(ult), toasts: E.log.toasts });

    const F = await viraComJogos(true);
    await F.api.endRegular();
    await tick();
    const cf = ativo(F), fin = cf.matches.filter(m => m.phase === 'final');
    check('vira COM final (como sempre): encerrar cria a FINAL entre os dois primeiros (azul x amarelo) e marca regularEnded; nenhuma janela', fin.length === 1 && fin[0].home === 'azul' && fin[0].away === 'amarelo' && cf.regularEnded === true && cf.matches.length === 4 && F.st.modal === null, { fin, len: cf.matches.length });

    const Z = makeEnv({ hasFinais: false });
    await Z.api.createChampionship(TEAMS3);
    await Z.api.endRegular();
    check('sem final e sem nenhum jogo disputado: encerrar não faz nada, avisa e não abre janela', Z.log.updates.length === 0 && Z.st.modal === null && Z.log.toasts.includes('Registre ao menos um jogo antes de encerrar.') && ativo(Z).regularEnded === false, { updates: Z.log.updates.length, toasts: Z.log.toasts });

    const T3 = makeEnv({ hasFinais: false });
    T3.st.champs.push({ id: 'c1', date: '2026-10-14', teams: TEAMS3, format: 3, status: 'active', noFinal: true, regularEnded: false, champion: null, matches: [
      { ...mt('azul', 'preto', 0, 0), id: 'a', rest: 'amarelo', seq: 1 }, { ...mt('azul', 'amarelo', 0, 0), id: 'b', rest: 'preto', seq: 2 }, { ...mt('preto', 'amarelo', 0, 0), id: 'c', rest: 'azul', seq: 3 },
      { ...mt('azul', 'preto', null, null, undefined, false), id: 'd', rest: 'amarelo', seq: 4 }] });
    await T3.api.endRegular();
    check('vira sem final com os 3 times empatados em tudo (3 empates 0x0): encerrar abre a janela do EMPATE com os 3', T3.st.modal && T3.st.modal.type === 'champTie' && T3.st.modal.teams.join() === 'azul,preto,amarelo', T3.st.modal);
  }
  {
    // encerrar antes da hora (4 times)
    const E = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true, played: 6 });
    await E.api.endRegular();
    const ult = E.log.updates[E.log.updates.length - 1].obj;
    check('4 times sem final, encerrar com 6 de 12 jogos: os 6 que faltavam saem, regularEnded, sem final, janela do campeão com o líder (azul)', ult.matches.length === 6 && ult.matches.every(m => m.played) && ult.regularEnded === true && E.st.modal && E.st.modal.type === 'champion' && E.st.modal.champion === 'azul', { n: ult.matches.length, modal: E.st.modal });
    const F = envWith({ hasFinais: true }, { teams: TEAMS4, played: 6 });
    await F.api.endRegular();
    const u2 = F.log.updates[F.log.updates.length - 1].obj;
    check('4 times COM final (como sempre): encerrar com 6 de 12 cria a final (azul x preto) e não abre janela', u2.matches.filter(m => m.phase === 'final').length === 1 && u2.matches.length === 7 && F.st.modal === null, u2.matches.length);
  }
  {
    // confirmEnd
    const E = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true, played: 6 });
    E.state.confirmAnswer = false;
    E.api.confirmEnd(); await tick();
    check('sem final, "Encerrar Campeonato": o app PERGUNTA antes ("Encerrar o campeonato agora?") e, se o admin disser não, nada é gravado', E.log.confirms.length === 1 && /Encerrar o campeonato agora\?/.test(E.log.confirms[0]) && /mais pontos/.test(E.log.confirms[0]) && E.log.updates.length === 0 && E.st.modal === null, { confirms: E.log.confirms, updates: E.log.updates.length });
    E.state.confirmAnswer = true;
    E.api.confirmEnd(); await tick(); await tick();
    check('sem final, "Encerrar Campeonato" com sim: encerra e abre a janela do campeão', E.log.updates.length === 1 && E.log.updates[0].obj.regularEnded === true && E.st.modal && E.st.modal.type === 'champion', { updates: E.log.updates.length, modal: E.st.modal });
    const F = await viraComJogos(true);
    F.api.confirmEnd(); await tick(); await tick();
    check('COM final (como sempre): encerrar a fase regular NÃO pergunta nada e cria a final direto', F.log.confirms.length === 0 && ativo(F).matches.some(m => m.phase === 'final'));
  }
  {
    // reabrir a janela
    const comp = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true });
    comp.api.openChampModal();
    check('sem final, todos os jogos disputados e janela fechada: "Registrar Jogadores Campeões" reabre a janela do campeão (azul)', comp.st.modal && comp.st.modal.type === 'champion' && comp.st.modal.champion === 'azul' && comp.st.modal.players.length === 5 && comp.log.renders === 1, comp.st.modal);
    const inc = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true, played: 11 });
    inc.api.openChampModal();
    check('sem final com jogo ainda por fazer: não abre nada (não dá para coroar antes da hora)', inc.st.modal === null && inc.log.renders === 0);
    const emp = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true, score: () => [0, 0] });
    emp.api.openChampModal();
    check('sem final com empate total no topo: reabre a janela do EMPATE', emp.st.modal && emp.st.modal.type === 'champTie' && emp.st.modal.teams.length === 4, emp.st.modal);
    const enc = envWith({ hasFinais: false }, { teams: TEAMS4, noFinal: true, played: 6, extra: { regularEnded: true } });
    enc.champ.matches = enc.champ.matches.slice(0, 6);
    enc.api.openChampModal();
    check('sem final encerrado antes da hora (regularEnded): reabre a janela do campeão', enc.st.modal && enc.st.modal.type === 'champion' && enc.st.modal.champion === 'azul', enc.st.modal);

    const fin = (hs, as_, extra) => envWith({ hasFinais: true }, { teams: TEAMS4, extra: { matches: [{ id: 'final', phase: 'final', home: 'azul', away: 'preto', played: true, hs, as: as_, ...extra }] } });
    let F = fin(2, 1); F.api.openChampModal();
    check('COM final (como sempre): final decidida abre a janela do campeão (azul)', F.st.modal && F.st.modal.type === 'champion' && F.st.modal.champion === 'azul', F.st.modal);
    F = fin(1, 1); F.api.openChampModal();
    check('COM final: final empatada sem vencedor dos pênaltis abre a janela dos pênaltis', F.st.modal && F.st.modal.type === 'penaltyWinner' && F.st.modal.home === 'azul' && F.st.modal.away === 'preto', F.st.modal);
    F = fin(1, 1, { penaltyWinner: 'preto' }); F.api.openChampModal();
    check('COM final: final empatada com vencedor dos pênaltis abre a janela do campeão (preto)', F.st.modal && F.st.modal.type === 'champion' && F.st.modal.champion === 'preto', F.st.modal);
    F = fin(null, null, { played: false }); F.api.openChampModal();
    check('COM final: final ainda não jogada não abre nada', F.st.modal === null);
  }

  // ══ 7. A JANELA DO EMPATE ═══════════════════════════════════════════════════════════════════════
  {
    const E = makeEnv({ hasFinais: false });
    E.st.modal = { type: 'champTie', teams: ['azul', 'preto'] };
    const h = E.api.mChampTie();
    check('janela do empate: título, explicação com a quantidade de times e um botão por time empatado chamando pickChampionTie', /Empate no topo da tabela/.test(h) && /2 times com os mesmos pontos, saldo e gols marcados/.test(h) && /pickChampionTie\('azul'\)/.test(h) && /pickChampionTie\('preto'\)/.test(h) && />Azul</.test(h) && />Preto</.test(h), h.slice(0, 400));
    check('janela do empate: não mostra time que não está empatado e tem a saída "Decidir depois" (closeModal)', !/amarelo|vermelho|Amarelo|Vermelho/.test(h) && /Decidir depois/.test(h) && /onclick="closeModal\(\)"/.test(h) && /class="overlay"/.test(h) && /class="sheet"/.test(h));
    E.st.modal = { type: 'champTie', teams: ['azul', 'preto', 'amarelo'] };
    check('janela do empate com 3 times: "3 times com os mesmos pontos…" e 3 botões', /3 times com os mesmos pontos/.test(E.api.mChampTie()) && count(E.api.mChampTie(), /pickChampionTie\(/g) === 3);
    E.st.modal = null; const vazio1 = E.api.mChampTie();
    E.st.modal = { type: 'champion', champion: 'azul', players: [] }; const vazio2 = E.api.mChampTie();
    check('as outras janelas (nenhuma, campeão) não mostram a janela do empate', vazio1 === '' && vazio2 === '');

    E.st.modal = { type: 'champTie', teams: ['azul', 'preto'] };
    E.api.pickChampionTie('preto');
    check('escolher o campeão do empate abre a janela do campeão com o time escolhido e 5 linhas de jogador, e redesenha', E.st.modal.type === 'champion' && E.st.modal.champion === 'preto' && E.st.modal.players.length === 5 && E.log.renders === 1, E.st.modal);
    E.st.modal = { type: 'champTie', teams: ['azul', 'preto'] }; E.log.renders = 0;
    E.api.pickChampionTie('amarelo');
    check('escolher um time que NÃO está empatado é ignorado (a janela continua, nada redesenha)', E.st.modal.type === 'champTie' && E.st.modal.teams.length === 2 && E.log.renders === 0, E.st.modal);
    E.st.modal = { type: 'saving' };
    E.api.pickChampionTie('azul');
    check('fora da janela do empate, pickChampionTie não faz nada', E.st.modal.type === 'saving' && E.log.renders === 0);
    E.st.modal = { type: 'penaltyWinner', teams: ['azul', 'preto'], home: 'azul', away: 'preto' };
    E.api.pickChampionTie('azul');
    check('mesmo que outra janela tenha uma lista de times, só a janela do empate aceita a escolha (pelo tipo da janela)', E.st.modal.type === 'penaltyWinner' && E.log.renders === 0, E.st.modal);
    check('a janela do empate está na lista de janelas desenhadas pelo aplicativo (entre a dos pênaltis e a dos pênaltis perdidos)', /mPenaltyWinner\(\)\+mChampTie\(\)\+mPenaltyMisses\(\)/.test(html));
  }

  // ══ 8. A TABELA NA TELA (standingsTable) ════════════════════════════════════════════════════════
  {
    const ms4 = champOf(A, { teams: TEAMS4, played: 6 }).matches, ms5 = champOf(A, { teams: TEAMS5, played: 6 }).matches, ms3 = [mt('azul', 'preto', 1, 0), mt('azul', 'amarelo', 1, 0)];
    let h = A.standingsTable(TEAMS4, ms4, 4, true);
    check('tabela sem final (4 times): só o 1º lugar fica em destaque (1 linha f-zone) e a nota diz "Líder = campeão"', count(h, /class="f-zone"/g) === 1 && count(h, /sf-zone/g) === 0 && /Líder = campeão/.test(h) && !/Top 2/.test(h) && !/Final/.test(h), h.slice(0, 300));
    h = A.standingsTable(TEAMS4, ms4, 4, false);
    check('tabela COM final (4 times, como sempre): 2 linhas em destaque e "Top 2 → Final"', count(h, /class="f-zone"/g) === 2 && /Top 2 → Final/.test(h) && !/Líder = campeão/.test(h));
    h = A.standingsTable(TEAMS4, ms4, 4);
    check('o 4º parâmetro é opcional: sem ele a tabela é a de sempre (com final)', count(h, /class="f-zone"/g) === 2 && /Top 2 → Final/.test(h));
    h = A.standingsTable(TEAMS5, ms5, 5, true);
    check('tabela sem final (5 times): 1 linha em destaque, nenhuma de semifinal, nota "Líder = campeão" (não "Top 4 → Semis")', count(h, /class="f-zone"/g) === 1 && count(h, /sf-zone/g) === 0 && /Líder = campeão/.test(h) && !/Semis/.test(h));
    h = A.standingsTable(TEAMS5, ms5, 5, false);
    check('tabela COM final (5 times, como sempre): 4 linhas de semifinal e "Top 4 → Semis"', count(h, /class="sf-zone"/g) === 4 && count(h, /class="f-zone"/g) === 0 && /Top 4 → Semis/.test(h));
    h = A.standingsTable(TEAMS3, ms3, 3, true);
    check('tabela sem final (vira): 1 linha em destaque e "Líder = campeão"', count(h, /class="f-zone"/g) === 1 && /Líder = campeão/.test(h));
    h = A.standingsTable(TEAMS3, ms3, 3, false);
    check('tabela COM final (vira, como sempre): 2 linhas em destaque e "Top 2 → Final"', count(h, /class="f-zone"/g) === 2 && /Top 2 → Final/.test(h));
  }

  // ══ 9. CENÁRIOS DO TÍTULO (analyzeClassification) ═══════════════════════════════════════════════
  {
    const B = noFinal => ({ format: 4, noFinal, teams: TEAMS4, matches: [
      mt('azul', 'preto', 3, 0, 1), mt('amarelo', 'vermelho', 1, 0, 1), mt('azul', 'amarelo', 2, 0, 2), mt('preto', 'vermelho', 1, 0, 2),
      mt('azul', 'vermelho', null, null, 3, false), mt('preto', 'amarelo', null, null, 3, false)] });
    const by = (an, team) => an.teams.find(t => t.team === team);
    let an = A.analyzeClassification(B(true));
    check('título em aberto (azul 6 pts, última rodada): 1 classificado só, 1 rodada restante', an && an.qualify === 1 && an.roundsLeft === 1 && an.teams.length === 4, an && { q: an.qualify, r: an.roundsLeft });
    check('azul perder pode empatar em pontos com outro time e o saldo ainda não existe: NÃO é "Campeão garantido", mas empate basta (nunca perdendo é campeão em todos os cenários)', by(an, 'azul').status === 'no_loss' && by(an, 'azul').detail === 'Empate basta' && by(an, 'azul').icon === '🟡', by(an, 'azul'));
    check('vermelho (0 pts) não alcança o líder nem empatando: "Sem chance de título"', by(an, 'vermelho').status === 'eliminated' && by(an, 'vermelho').detail === 'Sem chance de título' && by(an, 'vermelho').icon === '❌', by(an, 'vermelho'));
    check('preto e amarelo só chegam a EMPATAR em pontos com o azul (nunca ficam sozinhos na frente): ainda não estão eliminados, mas "Só com combinação favorável"', by(an, 'preto').status === 'very_hard' && by(an, 'amarelo').status === 'very_hard' && by(an, 'preto').detail === 'Só com combinação favorável', [by(an, 'preto'), by(an, 'amarelo')]);

    const D = noFinal => ({ format: 4, noFinal, teams: TEAMS4, matches: [
      mt('azul', 'preto', 5, 0, 1), mt('azul', 'amarelo', 5, 0, 2), mt('azul', 'vermelho', 5, 0, 3), mt('preto', 'azul', 0, 5, 4), mt('amarelo', 'azul', 0, 5, 5),
      mt('preto', 'amarelo', 1, 0, 1), mt('amarelo', 'vermelho', 1, 0, 2), mt('vermelho', 'preto', 1, 0, 3),
      mt('azul', 'vermelho', null, null, 6, false), mt('preto', 'amarelo', null, null, 6, false)] });
    an = A.analyzeClassification(D(true));
    check('azul com 15 pts e os outros com no máximo 6: "Campeão garantido" (✅)', by(an, 'azul').status === 'classified' && by(an, 'azul').detail === 'Campeão garantido' && by(an, 'azul').icon === '✅', by(an, 'azul'));
    check('e os outros três: "Sem chance de título"', ['preto', 'amarelo', 'vermelho'].every(t => by(an, t).status === 'eliminated' && by(an, t).detail === 'Sem chance de título'), an.teams.map(t => t.detail));

    an = A.analyzeClassification(D(false));
    check('liga COM final (como sempre), mesma tabela: 2 classificados e os textos antigos ("Classificado garantido"), nunca os do título', an.qualify === 2 && by(an, 'azul').detail === 'Classificado garantido' && !an.teams.some(t => /Campeão garantido|Sem chance de título/.test(t.detail)), an.teams.map(t => t.detail));
    an = A.analyzeClassification(B(false));
    check('liga COM final, tabela em aberto: azul "Classificado garantido" (sempre entre os 2 primeiros) e vermelho "Eliminado matematicamente" (como sempre)', by(an, 'azul').detail === 'Classificado garantido' && by(an, 'vermelho').detail === 'Eliminado matematicamente', an.teams.map(t => [t.team, t.detail]));

    const c5 = noFinal => champOf(A, { teams: TEAMS5, noFinal, played: 8, score: wins('azul') });
    check('5 times: 1 classificado sem final, 4 com final (como sempre); 4 times com final: 2', A.analyzeClassification(c5(true)).qualify === 1 && A.analyzeClassification(c5(false)).qualify === 4 && A.analyzeClassification(B(false)).qualify === 2);
    check('só aparece nas duas últimas rodadas: mais de 2 rodadas por jogar, ou nenhuma, não mostra cenários', A.analyzeClassification(champOf(A, { teams: TEAMS4, noFinal: true, played: 3 })) === null && A.analyzeClassification(champOf(A, { teams: TEAMS4, noFinal: true })) === null);
    check('vira (3 times) não tem cenários, com ou sem final', A.analyzeClassification({ format: 3, noFinal: true, teams: TEAMS3, matches: [] }) === null && A.analyzeClassification({ format: 3, teams: TEAMS3, matches: [] }) === null);
  }

  // ══ 10. A TELA DO CAMPEONATO (renderChamp) ══════════════════════════════════════════════════════
  {
    const R = (opts, champOpts, editable = true) => { const E = envWith(opts, champOpts); return E.api.renderChamp(E.champ, editable); };
    const SEM = { hasFinais: false }, COM = { hasFinais: true };
    const REGISTRAR = '🏆 Registrar Jogadores Campeões', ENCERRAR = '⏹ Encerrar Campeonato', TERCEIRO = '🥉 Encerrar + Disputa de 3º Lugar';

    // 4 times, tudo jogado, ainda sem campeão registrado
    let h = R(SEM, { teams: TEAMS4, noFinal: true });
    check('4 times sem final, todos os jogos disputados: rótulo "Todos contra todos · pontos corridos", "Líder = campeão" e o botão de registrar os campeões', /champ-fmt">Todos contra todos · pontos corridos</.test(h) && /Líder = campeão/.test(h) && h.includes(REGISTRAR) && /openChampModal\(\)/.test(h), h.slice(0, 200));
    check('...e nada de final: nem seção "Final", nem "Top 2", nem botão de 3º lugar, nem encerrar, nem a lista "Partidas Disputadas" do vira', !/sec-lbl">Final</.test(h) && !/Top 2/.test(h) && !h.includes(TERCEIRO) && !h.includes(ENCERRAR) && !/Adicionar disputa de 3º/.test(h) && !/Semifinais/.test(h) && !/Partidas Disputadas/.test(h));
    check('...e nenhum card de partida de final/semifinal/3º lugar', !/phase="(final|semifinal|third)"/.test(h) && count(h, /<match /g) === 12);
    h = R(SEM, { teams: TEAMS4, noFinal: true }, false);
    check('só o admin (editable) vê o botão de registrar os campeões', !h.includes(REGISTRAR));
    h = R(SEM, { teams: TEAMS4, noFinal: true, extra: { status: 'completed', champion: 'azul', champion_players: [{ name: 'Ana', weight: 1 }] } });
    check('campeonato sem final já concluído (campeão salvo): banner do campeão, sem botão de registrar, sem "Adicionar disputa de 3º lugar" e sem a lista de partidas do vira (4 times mostram os turnos)', /champion-banner/.test(h) && !h.includes(REGISTRAR) && !/Adicionar disputa de 3º/.test(h) && !/Partidas Disputadas/.test(h) && /Turno 1/.test(h));
    h = R(COM, { teams: TEAMS4, extra: { status: 'completed', champion: 'azul', champion_players: [{ name: 'Ana', weight: 1 }] } });
    check('COM final (como sempre): campeonato concluído de 4 times ainda oferece ao admin "Adicionar disputa de 3º lugar"', /Adicionar disputa de 3º lugar/.test(h));

    // 4 times em andamento
    h = R(SEM, { teams: TEAMS4, noFinal: true, played: 8 });
    check('4 times sem final em andamento (8 de 12): botão "⏹ Encerrar Campeonato" (confirmEnd), uma vez só; sem botão de 3º lugar e sem registrar os campeões', count(h, /⏹ Encerrar Campeonato/g) === 1 && /confirmEnd\(\)/.test(h) && !h.includes(TERCEIRO) && !h.includes(REGISTRAR), count(h, /⏹ Encerrar Campeonato/g));
    h = R(SEM, { teams: TEAMS4, noFinal: true, played: 8 }, false);
    check('em andamento, sem ser admin (editable falso): nenhum botão de encerrar', !h.includes(ENCERRAR));
    h = R(SEM, { teams: TEAMS4, noFinal: true, played: 1 });
    check('com menos de 2 jogos disputados ainda não oferece encerrar', !h.includes(ENCERRAR));
    check('a partir de 2 jogos disputados (4 e 5 times) oferece encerrar', R(SEM, { teams: TEAMS4, noFinal: true, played: 2 }).includes(ENCERRAR) && R(SEM, { teams: TEAMS5, noFinal: true, played: 2 }).includes(ENCERRAR));
    h = R(COM, { teams: TEAMS4, played: 8 });
    check('4 times COM final (como sempre): oferece "🥉 Encerrar + Disputa de 3º Lugar" e NÃO "Encerrar Campeonato"; rótulo "Todos contra todos" e "Top 2 → Final"', h.includes(TERCEIRO) && !h.includes(ENCERRAR) && /champ-fmt">Todos contra todos</.test(h) && /Top 2 → Final/.test(h));

    // 5 times
    h = R(SEM, { teams: TEAMS5, noFinal: true, played: 6 });
    check('5 times sem final: seção "Pontos Corridos" (não "Fase de Grupos"), rótulo "Todos contra todos · pontos corridos", encerrar disponível, sem semifinais', /sec-lbl">Pontos Corridos</.test(h) && !/Fase de Grupos/.test(h) && /champ-fmt">Todos contra todos · pontos corridos</.test(h) && h.includes(ENCERRAR) && !/Semifinais/.test(h) && !/Semis/.test(h), h.slice(0, 200));
    h = R(COM, { teams: TEAMS5, played: 6 });
    check('5 times COM final (como sempre): "Fase de Grupos", "Fase de grupos + Semis", "Top 4 → Semis" e nenhum botão de encerrar', /sec-lbl">Fase de Grupos</.test(h) && /champ-fmt">Fase de grupos \+ Semis</.test(h) && /Top 4 → Semis/.test(h) && !h.includes(ENCERRAR));
    h = R(SEM, { teams: TEAMS5, noFinal: true });
    check('5 times sem final, tudo disputado: botão de registrar os campeões e nenhum de encerrar', h.includes(REGISTRAR) && !h.includes(ENCERRAR));

    // cenários
    h = R(SEM, { teams: TEAMS4, noFinal: true, played: 10, score: wins('azul') });
    check('nas últimas rodadas, sem final: o card de cenários se chama "Cenários — Título"', /Cenários — Título/.test(h) && !/Cenários — Final/.test(h) && !/Cenários — Semifinais/.test(h), (h.match(/Cenários — \S+/) || [])[0]);
    h = R(COM, { teams: TEAMS4, played: 10, score: wins('azul') });
    check('COM final (4 times): "Cenários — Final"; (5 times): "Cenários — Semifinais"', /Cenários — Final/.test(h) && /Cenários — Semifinais/.test(R(COM, { teams: TEAMS5, played: 8 })));

    // vira
    async function viraTela(hasFinais, n, fim = false) {
      const E = await viraComJogos(hasFinais, n);
      if (fim) { await E.api.endRegular(); await tick(); }
      return E.api.renderChamp(ativo(E), true);
    }
    h = await viraTela(false, 3);
    check('vira sem final com 3 jogos: rótulo "Vira (3 times) · pontos corridos", botão "⏹ Encerrar Campeonato" uma só vez (não o de "Fase Regular"), "Líder = campeão" e a lista "Partidas Disputadas" uma só vez', /champ-fmt">Vira \(3 times\) · pontos corridos</.test(h) && count(h, /⏹ Encerrar Campeonato/g) === 1 && !/Encerrar Fase Regular/.test(h) && /Líder = campeão/.test(h) && count(h, /Partidas Disputadas/g) === 1, h.slice(0, 200));
    h = await viraTela(true, 3);
    check('vira COM final (como sempre): "⏹ Encerrar Fase Regular", sem "Encerrar Campeonato", "Top 2 → Final"', /Encerrar Fase Regular/.test(h) && !h.includes(ENCERRAR) && /Top 2 → Final/.test(h) && /champ-fmt">Vira \(3 times\)</.test(h));
    h = await viraTela(false, 2);
    check('vira com menos de 3 jogos: ainda sem botão de encerrar (como sempre)', !h.includes(ENCERRAR) && !/Encerrar Fase Regular/.test(h));
    h = await viraTela(false, 3, true);
    check('vira sem final já ENCERRADO e ainda sem campeão salvo: lista as partidas disputadas e oferece registrar os campeões; não oferece encerrar de novo', /sec-lbl">Partidas Disputadas</.test(h) && count(h, /<match /g) === 3 && h.includes(REGISTRAR) && !h.includes(ENCERRAR) && !/sec-lbl">Próxima/.test(h), h.slice(0, 200));
    h = await viraTela(true, 3, true);
    check('vira COM final já encerrado (como sempre): mostra a seção "Final" e NÃO lista as partidas da fase regular nem oferece registrar antes de jogar a final', /sec-lbl">Final</.test(h) && !/Partidas Disputadas/.test(h) && !h.includes(REGISTRAR));
    {
      const E = await viraComJogos(false, 3);
      await E.api.endRegular();
      await tick();
      const c = ativo(E); c.status = 'completed'; c.champion = 'azul'; c.champion_players = [{ name: 'Ana', weight: 1 }];
      h = E.api.renderChamp(c, false);
      check('vira sem final CONCLUÍDO (no histórico): banner do campeão e as partidas disputadas continuam na tela', /champion-banner/.test(h) && /sec-lbl">Partidas Disputadas</.test(h) && count(h, /<match /g) === 3 && !h.includes(REGISTRAR));
    }
  }

  // ══ 11. AS CONQUISTAS DA FINAL ══════════════════════════════════════════════════════════════════
  const FINAL_IDS = ['pipoca', 'finalista', 'decisivo', 'sempre_decisivo', 'decide_todas', 'noite_magica', 'eu_mbappe', 'melhor_mbappe', 'tafarel', 'baggio', 'salvo_companheiros'];
  {
    const E = makeEnv({ hasFinais: true });
    const cat = E.api.BADGE_CATALOG;
    const ocultas = () => new Set(cat.filter(b => b.visible && !b.visible()).map(b => b.id));
    const com = ocultas();
    E.st.appCfg.hasFinais = false;
    const sem = ocultas();
    const metade = cat.filter(b => b.visible && /showHalfTitles/.test(String(b.visible))).map(b => b.id);
    const novas = [...sem].filter(id => !com.has(id)).sort();
    const DO_MES = ['mes_rei_art_final', 'mes_rei_finais']; // as duas conquistas do mês (item 42) ligadas às finais
    check('liga sem final: as conquistas que somem são EXATAMENTE as 11 da final + as de ½ título (4) + as 2 do mês ligadas às finais, e mais nenhuma', JSON.stringify(novas) === JSON.stringify([...FINAL_IDS, ...metade, ...DO_MES].sort()) && metade.length === 4, { novas, metade });
    check('as 11 conquistas da final existem no catálogo e cada uma tem regra de visibilidade (nenhuma esquecida)', FINAL_IDS.every(id => cat.some(b => b.id === id && typeof b.visible === 'function')), FINAL_IDS.filter(id => !cat.some(b => b.id === id && b.visible)));
    E.st.appCfg.hasFinais = true;
    check('liga com final (como sempre): as 11 estão visíveis (a de votação, com a votação ligada)', FINAL_IDS.every(id => cat.find(b => b.id === id).visible()), FINAL_IDS.filter(id => !cat.find(b => b.id === id).visible()));
    E.st.appCfg.hasFinais = false;
    check('liga sem final: cada uma das 11 fica oculta, uma por uma', FINAL_IDS.every(id => cat.find(b => b.id === id).visible() === false), FINAL_IDS.filter(id => cat.find(b => b.id === id).visible()));
    E.st.appCfg.hasFinais = true; E.state.voting = false;
    check('a Noite Mágica continua exigindo a votação ligada (só a final não basta)', cat.find(b => b.id === 'noite_magica').visible() === false && cat.find(b => b.id === 'baggio').visible() === true);
    E.state.voting = true; E.st.appCfg.hasFinais = false;
    const rest = cat.filter(b => (!b.visible || b.visible()) && /\bfinal\b|finais|vice-campe|pênalti|penalti/i.test(b.desc));
    check('nenhuma conquista que ainda aparece na liga sem final fala de final, vice-campeão ou pênalti (vale para as que forem criadas no futuro)', rest.length === 0, rest.map(b => b.id));
    check('as conquistas de título e de gols seguem visíveis na liga sem final (campeão, bicampeão, artilheiro, hat-trick, invicto…)', ['campeao', 'bicampeao', 'artilheiro', 'hat_trick', 'invicto', 'alergico_gol', 'estreante'].every(id => { const b = cat.find(x => x.id === id); return b && (!b.visible || b.visible()); }));
  }
  {
    // badge mais rara do elenco e resumo para o grupo
    const cache = { playerBadges: { Ana: ['baggio', 'estreante'], Bia: ['baggio'], Cid: [] }, badgeHolders: { baggio: ['Ana', 'Bia'], estreante: ['Ana', 'Bia', 'Cid'] } };
    const E = makeEnv({ hasFinais: true, badgeCache: cache });
    check('liga com final: a conquista mais rara de Ana é a Baggio (2 donos) e a de Bia também', E.api.getPlayerRarestBadge('Ana').id === 'baggio' && E.api.getPlayerRarestBadge('Bia').id === 'baggio');
    E.st.appCfg.hasFinais = false;
    check('liga sem final: a mais rara de Ana pula a Baggio (oculta) e vira a Estreante; quem só tem conquista oculta (Bia) fica sem nenhuma; sem conquistas (Cid) também', E.api.getPlayerRarestBadge('Ana').id === 'estreante' && E.api.getPlayerRarestBadge('Bia') === null && E.api.getPlayerRarestBadge('Cid') === null, [E.api.getPlayerRarestBadge('Ana'), E.api.getPlayerRarestBadge('Bia')]);

    const champ = { id: 'cX', date: '2026-10-14', status: 'completed', champion: 'azul', champion_players: [{ name: 'Ana', weight: 1 }], teamRosters: { azul: ['Ana', 'Bia'] }, matches: [] };
    const opts = hasFinais => ({ hasFinais, champs: [champ], badgeCache: { badgeHolders: { baggio: ['Ana'], estreante: ['Ana', 'Bia'] } }, newBadges: { Ana: ['baggio', 'estreante'] } });
    const com = makeEnv(opts(true)).api.gerarResumoChamp('cX');
    const sem = makeEnv(opts(false)).api.gerarResumoChamp('cX');
    check('resumo para o grupo, liga com final: lista as duas conquistas novas (Baggio e Estreante)', /\*Baggio\*/.test(com) && /\*Estreante\*/.test(com) && /Badges conquistadas/.test(com), com);
    check('resumo para o grupo, liga sem final: lista só a Estreante (a Baggio é da final e fica de fora)', !/Baggio/.test(sem) && /\*Estreante\*/.test(sem) && /Campeão: Azul/.test(sem), sem);
    const so = makeEnv({ ...opts(false), newBadges: { Ana: ['baggio'] } }).api.gerarResumoChamp('cX');
    check('resumo para o grupo, liga sem final, só conquista da final: o bloco de conquistas some por inteiro', !/Badges conquistadas/.test(so) && !/Baggio/.test(so), so);
  }

  // ══ 11a. A COMPARAÇÃO COM O RIVAL TAMBÉM ESCONDE AS CONQUISTAS DA FINAL ═════════════════════════
  {
    const cache = { playerBadges: { Ana: ['baggio', 'estreante', 'campeao'], Bia: ['finalista', 'estreante'] }, badgeHolders: {} };
    const E = makeEnv({ hasFinais: true, badgeCache: cache });
    check('rival, liga com final (como sempre): a comparação conta todas as conquistas dos dois, inclusive as da final', E.api.rivalBadgeIds('Ana').join() === 'baggio,estreante,campeao' && E.api.rivalBadgeIds('Bia').join() === 'finalista,estreante', [E.api.rivalBadgeIds('Ana'), E.api.rivalBadgeIds('Bia')]);
    E.st.appCfg.hasFinais = false;
    check('rival, liga sem final: a comparação NÃO conta as conquistas da final (Baggio e Artilheiro da Final), para os dois lados', E.api.rivalBadgeIds('Ana').join() === 'estreante,campeao' && E.api.rivalBadgeIds('Bia').join() === 'estreante', [E.api.rivalBadgeIds('Ana'), E.api.rivalBadgeIds('Bia')]);
  }

  // ══ 11b. CARDS E GRÁFICOS DA FINAL (Ranking, Stats e aba EU) ════════════════════════════════════
  // Trechos REAIS das três telas, executados com dados de mentira: na liga sem final somem os cards, as linhas e os gráficos que só fazem sentido com final.
  {
    const iifeAround = anchor => {
      const k = html.indexOf(anchor);
      if (k < 0) throw new Error('âncora não encontrada: ' + anchor);
      const a = html.lastIndexOf('(()=>{', k), end = '\n  })()';
      return html.slice(a, html.indexOf(end, k) + end.length);
    };
    const ev = (expr, env) => new Function(...Object.keys(env), 'return (' + expr + ');')(...Object.values(env));
    const escS = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const posC = ['#F0A500', '#C0C0C0', '#CD7F32'];
    const fin = hasFinais => makeEnv({ hasFinais }).api.finalsEnabled;
    const balanced = h => count(h, /<div[\s>]/g) === count(h, /<\/div>/g);

    // Ranking: vices
    const vicesCode = iifeAround('computeVices(_rankActiveSet)');
    const vices = (hasFinais, list) => ev(vicesCode, { finalsEnabled: fin(hasFinais), computeVices: () => list, _rankActiveSet: null, posC, playerAvatar: () => '', esc: escS });
    const vCom = vices(true, [['Ana', 3], ['Bia', 1]]);
    check('Ranking, liga com final (como sempre): o card "🥈 Ranking de Vices" lista os vice-campeões', /🥈 Ranking de Vices/.test(vCom) && /Ana/.test(vCom) && /Bia/.test(vCom) && balanced(vCom), vCom.slice(0, 200));
    check('Ranking, liga sem final: o card "Ranking de Vices" não aparece (não existe vice-campeão)', vices(false, [['Ana', 3]]) === '');
    check('Ranking, liga com final e ninguém foi vice: nada aparece (como sempre)', vices(true, []) === '');

    // Ranking: artilheiros e gols
    const goalsCode = iifeAround('computeFinalsGoalTally(fd)');
    const goals = hasFinais => ev(goalsCode, { finalsEnabled: fin(hasFinais), filteredDoneChamps: () => [{}], computeGoalsRanking: () => ({ tally: { Ana: 5, Bia: 3 }, artTitles: { Ana: 2 } }), computeFinalsGoalTally: () => ({ tally: { Ana: 2 }, finalsScored: { Ana: 1 } }), computeFinalsArtilheiroRanking: () => ({ Ana: 1 }), posC, playerAvatar: () => '', esc: escS });
    const gCom = goals(true), gSem = goals(false);
    check('Ranking, liga com final (como sempre): quatro cards (Artilheiro, Artilheiro da Final, Gols (total), Gols Finais), duas fileiras de 2 colunas',
      ['🥇 Artilheiro<', '🏆 Artilheiro da Final', '⚽ Gols (total)', '⚽ Gols Finais'].every(t => gCom.includes(t)) && count(gCom, /grid-template-columns:1fr 1fr;/g) === 2 && count(gCom, /class="card"/g) === 4 && balanced(gCom), gCom.slice(0, 300));
    check('Ranking, liga sem final: só Artilheiro e Gols (total), cada um ocupando a fileira inteira (1 coluna), sem nenhum card de final e com as tags fechadas',
      gSem.includes('🥇 Artilheiro<') && gSem.includes('⚽ Gols (total)') && !/Final|Finais/.test(gSem) && count(gSem, /grid-template-columns:1fr;/g) === 2 && count(gSem, /grid-template-columns:1fr 1fr;/g) === 0 && count(gSem, /class="card"/g) === 2 && balanced(gSem), gSem.slice(0, 300));
    check('Ranking, liga sem final: os dados dos cards que ficam continuam lá (Ana 5 gols e 2 artilharias, Bia 3 gols)', /Ana/.test(gSem) && />5</.test(gSem) && />2</.test(gSem) && /Bia/.test(gSem) && />3</.test(gSem));

    // Stats: pênaltis perdidos em final e gráficos
    const penCode = iifeAround('const pm=computePenaltyMisses();');
    const pen = hasFinais => ev(penCode, { finalsEnabled: fin(hasFinais), computePenaltyMisses: () => [{ name: 'Ana', total: 2, lost: 1, won: 1 }], posC, esc: escS });
    check('Stats, liga com final (como sempre): o card "😬 Pênaltis Perdidos em Final" lista quem errou', /😬 Pênaltis Perdidos em Final/.test(pen(true)) && /Ana/.test(pen(true)) && balanced(pen(true)));
    check('Stats, liga sem final: o card de pênaltis perdidos em final não aparece', pen(false) === '');
    const chartsStart = html.indexOf("[\n    {id:'art-chart'");
    const chartsCode = html.slice(chartsStart, html.indexOf(".join('')", chartsStart) + ".join('')".length);
    const charts = hasFinais => ev(chartsCode, { finalsEnabled: fin(hasFinais) });
    const ids = h => (h.match(/<canvas id="([^"]+)"/g) || []).map(x => x.slice(12, -1));
    check('Stats, liga com final (como sempre): os 4 gráficos, na ordem (Artilharia, Artilharia Final, Gols, Gols Finais)', ids(charts(true)).join() === 'art-chart,art-final-chart,goals-chart,goals-final-chart' && /Evolução Artilharia Final/.test(charts(true)) && /Evolução Gols Finais/.test(charts(true)), ids(charts(true)));
    check('Stats, liga sem final: só os gráficos de Artilharia e de Gols (os dois da final somem, com tudo: cartão, legenda e balão)', ids(charts(false)).join() === 'art-chart,goals-chart' && !/Final|Finais|final/.test(charts(false)) && count(charts(false), /class="card"/g) === 2 && balanced(charts(false)), charts(false).slice(0, 200));

    // aba EU: cards e recordes
    const gridStart = html.indexOf('<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">\n      ${titlesCard}');
    const gridCode = html.slice(gridStart, html.indexOf('\n    </div>', gridStart) + '\n    </div>'.length);
    const grid = hasFinais => new Function('finalsEnabled', 'titlesCard', 'goalsCard', 'fGoalsCard', 'artCard', 'artFinCard', 'stat', 'champsPlayed', 'champsTotalCount', 'winRate', 'return `' + gridCode + '`;')(fin(hasFinais), '[Títulos]', '[Gols]', '[Gols em Finais]', '[Artilharia]', '[Art. de Finais]', (v, l) => '[' + l + ']', 4, 9, 0);
    const compact = h => h.replace(/\s+/g, ' ').trim();
    check('aba EU, liga com final (como sempre): 6 cards (Títulos, Gols, Gols em Finais, Artilharia, Art. de Finais, Campeonatos)', /\[Títulos\] \[Gols\] \[Gols em Finais\] \[Artilharia\] \[Art\. de Finais\] \[Campeonatos\]/.test(compact(grid(true))), compact(grid(true)));
    check('aba EU, liga sem final: 4 cards (Títulos, Gols, Artilharia, Campeonatos), sem os dois da final: o grid fica 2x2', /\[Títulos\] \[Gols\] \[Artilharia\] \[Campeonatos\]/.test(compact(grid(false))) && !/Finais/.test(grid(false)), compact(grid(false)));
    const rowLine = html.split('\n').find(l => /^\s*\(hasBaggio\+hasSalvoCompanheiros\)>0.*rowS\('Pênaltis perdidos em final'/.test(l));
    const rec = (hasFinais, b, s) => ev(rowLine.trim().replace(/,$/, ''), { finalsEnabled: fin(hasFinais), hasBaggio: b, hasSalvoCompanheiros: s, rowS: (lbl, val, sub, color) => `[${lbl}|${val}|${sub}|${color}]` });
    check('aba EU, liga com final (como sempre): a linha "Pênaltis perdidos em final" mostra o total e os detalhes quando há registro', rec(true, 1, 1) === '[Pênaltis perdidos em final|2|1× perdeu o título · 1× salvo pelos companheiros|#FF5C5C]' && rec(true, 2, 0) === '[Pênaltis perdidos em final|2|2× o título foi embora junto|#FF5C5C]' && rec(true, 0, 3) === '[Pênaltis perdidos em final|3|3× salvo pelos companheiros|#FF5C5C]', [rec(true, 1, 1), rec(true, 2, 0), rec(true, 0, 3)]);
    check('aba EU: sem registro de pênalti perdido a linha não aparece (com ou sem final) e na liga sem final ela some mesmo com registro', rec(true, 0, 0) === '' && rec(false, 0, 0) === '' && rec(false, 1, 1) === '' && rec(false, 0, 3) === '');
  }

  // ══ 12. TEXTOS E LIGAÇÕES NO APLICATIVO ═════════════════════════════════════════════════════════
  check('createChampionship grava noFinal só quando a liga não tem final', /\.\.\.\(finalsEnabled\(\) \? \{\} : \{ noFinal: true \}\)/.test(html));
  check('submitScore: as finais e semifinais automáticas só valem para campeonato COM final (2 guardas)', /if \(fmt===4 && !champ\.noFinal\) \{/.test(html) && /if \(fmt===5 && !champ\.noFinal\) \{/.test(html));
  {
    const wiz = html.match(/optBtn\('⚽ Não, só jogos normais','([^']*)'/);
    check('assistente da liga: a opção "Não" explica pontos corridos (campeão é quem somar mais pontos), não "mesmo peso"', wiz && /Pontos corridos: o campeão é quem somar mais pontos/.test(wiz[1]) && !/mesmo peso/.test(html), wiz && wiz[1]);
    check('painel do admin: logo abaixo de "Sem final" a explicação (pontos corridos, sem final/semifinais/3º, conquistas da final ocultas, vale para os campeonatos novos), só quando a liga está sem final', /Sem final = pontos corridos: o campeão é o time que somar mais pontos/.test(html) && /conquistas ligadas à final ficam ocultas\. Vale para os campeonatos criados daqui para a frente/.test(html) && /\$\{cfg\.hasFinais\?'':`<div style="font-size:11px;color:var\(--text3\);line-height:1\.45;margin-top:8px">Sem final = pontos corridos/.test(html));
    const desc = html.match(/const desc=finalsEnabled\(\)\?\{([\s\S]*?)\}:\{([\s\S]*?)\};/);
    const [, comF, semF] = desc || [];
    check('criar campeonato: com final os 3 textos de sempre (final/semifinais); sem final os 3 falam de pontos corridos e do campeão, sem final nem semifinais', !!desc && /Ao final, os 2 primeiros fazem a final/.test(comF) && /\+ Final/.test(comF) && /Semifinais \+ Final/.test(comF)
      && /Pontos corridos<\/strong> em 2 turnos \(12 jogos\)/.test(semF) && /Pontos corridos<\/strong> em 1 turno \(10 jogos\)/.test(semF) && (semF.match(/o campeão é o time com mais pontos/g) || []).length === 3 && !/Semifinais|\+ Final|os 2 primeiros/.test(semF), { comF, semF });
  }

  // ══ 13. O MANUAL ════════════════════════════════════════════════════════════════════════════════
  {
    const a = manual.indexOf('<h3 id="liga-sem-final">');
    const b = manual.indexOf('</section>', a);
    const sec = a >= 0 ? plain(manual.slice(a, b)) : '';
    check('manual: a subseção "Liga sem final (pontos corridos)" existe, uma vez só, no fim da seção 03', a > 0 && manual.split('id="liga-sem-final"').length === 2 && manual.lastIndexOf('<section', a) === manual.indexOf('<section class="section" id="titulos">'));
    check('manual: diz que sem final é pontos corridos, sem final, semifinal nem 3º lugar, e que o campeão é o time com mais pontos no campeonato todo (vitória 3, empate 1)', /pontos corridos/.test(sec) && /não existe final, semifinal nem disputa de 3º lugar/.test(sec) && /campeão é o time que somou mais pontos durante todo o campeonato/.test(sec) && /vitória vale 3 pontos, empate 1/.test(sec), sec.slice(0, 500));
    check('manual: explica o vira (o admin toca em Encerrar Campeonato depois de 3 jogos e o app pergunta), os 4 e 5 times (último jogo), encerrar antes da hora e o desempate (pontos, saldo, gols marcados, e o admin escolhe)', /3 \(vira\).*toca em ⏹ Encerrar Campeonato \(o botão aparece depois de 3 jogos disputados e o app pergunta se tem certeza\)/.test(sec) && /último jogo/.test(sec) && /Encerrar antes da hora\. Com 4 ou 5 times, depois de ao menos 2 jogos disputados/.test(sec) && /saldo de gols, depois gols marcados/.test(sec) && /Empate no topo da tabela/.test(sec) && /Decidir depois/.test(sec) && /admin escolhe o campeão/.test(sec) && /Cenários — Título/.test(sec) && /Empate em pontos no topo não conta como título garantido/.test(sec), sec);
    check('manual: lista as 11 conquistas da final que ficam ocultas (pelos nomes do catálogo) e avisa que a regra vale para os campeonatos novos', FINAL_IDS.filter(id => id !== 'noite_magica').every(id => { const label = new Function('return ' + html.match(new RegExp("^ {2}\\{ id:'" + id + "',.*?label:('[^']*')", 'm'))[1])(); return sec.includes(label); }) && /Dia\/Tarde\/Noite Mágica/.test(sec) && /campeonatos novos/.test(sec) && /dia em que ele foi criado/.test(sec) && /Se a liga voltar a ter final, elas voltam/.test(sec), sec);
    const nomes = ['Painel Admin', 'Formato dos campeonatos', 'Com final', 'Sem final', 'Seus campeonatos têm final?', '⏹ Encerrar Campeonato', 'Empate no topo da tabela', 'Decidir depois', '🏆 Registrar Jogadores Campeões', 'Cenários — Título'];
    check('manual: todo nome de tela e de botão citado existe mesmo no aplicativo (não descreve o que não existe)', nomes.every(n => (n === 'Painel Admin' || n === 'Com final' || n === 'Sem final' ? true : html.includes(n.replace('Cenários — Título', 'Cenários — '))) && (n !== 'Cenários — Título' || /analysis\.qualify === 1 \? 'Título'/.test(html))) && /Formato dos campeonatos/.test(html) && /🏆 Com final/.test(html) && /⚽ Sem final/.test(html), nomes.filter(n => !html.includes(n)));
    check('manual, seção 11: avisa que na liga sem final não existe disputa de 3º lugar; seção 13: aviso das conquistas da final e a etiqueta "Só em liga com final" nos 3 grupos (Vice-Campeão, Artilharia de final, Pênaltis na final)',
      /Na liga <strong>sem final<\/strong> \(pontos corridos, ver a seção 03\) não existe disputa de 3º lugar/.test(manual) && /<div class="callout-label">Liga sem final<\/div>/.test(manual)
      && /<h3>Vice-Campeão <span class="tag">Só em liga com final<\/span><\/h3>/.test(manual) && /<h3>Artilharia de final <span class="tag">Linha de campo<\/span> <span class="tag">Só em liga com final<\/span><\/h3>/.test(manual) && /<h3>Pênaltis na final <span class="tag">Todos os jogadores<\/span> <span class="tag">Só em liga com final<\/span><\/h3>/.test(manual));
    const escondidos = ['Gols em Finais', 'Art. de Finais', 'Pênaltis perdidos em final', '🥈 Ranking de Vices', '🏆 Artilheiro da Final', '⚽ Gols Finais', '😬 Pênaltis Perdidos em Final', 'Evolução Artilharia Final', 'Evolução Gols Finais'];
    check('manual, seção 03: lista os cards e gráficos da final que ficam ocultos (aba EU, Ranking e Stats) e que voltam se a liga voltar a ter final', /Cards e gráficos da final também ficam ocultos\. Na aba EU ?:/.test(sec) && escondidos.every(n => sec.includes(n)) && /grid fica 2×2/.test(sec) && /passam a ocupar a linha inteira/.test(sec) && /Se a liga voltar a ter final, tudo reaparece/.test(sec), escondidos.filter(n => !sec.includes(n)));
    check('manual: cada card, linha e gráfico citado como oculto existe mesmo no aplicativo (com esse nome)', escondidos.every(n => html.includes(n)), escondidos.filter(n => !html.includes(n)));
    check('manual, seções 06, 09 e 13: avisam que na liga sem final os indicadores, os cards e as linhas da final não aparecem',
      /Em liga <strong>sem final<\/strong> \(ver a seção 03\) os indicadores <strong>Gols em Finais<\/strong> e <strong>Artilharia de Finais<\/strong> não aparecem\./.test(manual)
      && /Em liga <strong>sem final<\/strong> \(ver a seção 03\) os cards <strong>Gols em Finais<\/strong> e <strong>Art\. de Finais<\/strong> não aparecem e o grid fica 2×2\./.test(manual)
      && /aparece quando o valor é maior que zero \(e a liga tem final\)\./.test(manual) && /Só aparece quando há pelo menos um registro e a liga tem final\./.test(manual));
  }

  console.log(fails ? `\n${fails} verificação(ões) FALHARAM` : '\nTodas as verificações passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERRO NO TESTE: ' + (e && e.stack || e)); process.exit(1); });
