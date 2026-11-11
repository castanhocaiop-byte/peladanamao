// Corrigir um resultado DEPOIS que o mata-mata já foi montado (index.html + manual.html + ci.yml).
// Caso real (Série B Aceoma, campeonato de 5 times de 10/11/2026): o último jogo da fase de grupos foi lançado com o placar trocado (3x2 em vez de 2x3), o app montou as
// semifinais pela tabela errada, o admin CORRIGIU o resultado e a tabela se refez sozinha, mas as semifinais (e a final, montada a partir delas) ficaram com os confrontos antigos.
// Este teste extrai o código real do index.html e o executa num ambiente simulado, sem navegador: reseedKnockout (quais confrontos se refazem e quais já foram jogados),
// knockoutNotice (o aviso ao admin), submitScore (o registro de placar: criar, corrigir, avisar) e tudo o que NÃO pode mudar (jogo já disputado, "vira", "sem final",
// primeiro registro de um placar, só gols).
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
  one(/^const FMT = .*;$/m),
  slice('const T = {', 'function enabledColors()'),
  one(/^const fdt = .*;$/m),
  one(/^const activeChamp = .*;$/m),
  one(/^function ldoc\(path\) \{.*\}$/m),
  one(/^function isAdmin\(\) \{.*\}$/m),
  one(/^const esc = .*;$/m),
  one(/^function defPlayers\(\) \{\n[\s\S]*?\n\}$/m),
  slice('function genRoundRobinRounds(', 'function standings('),                // genRoundRobinRounds + genMatches
  slice('function standings(', '/* ── db / auth (Firebase)'),                   // standings, next3, champion, reseedKnockout, knockoutNotice
  slice('function showHalfTitles()', 'function startListeners()'),               // finalsEnabled, titleRace, noFinalComplete, titleModalFor...
  slice('async function submitScore(', 'async function addThirdPlaceRetro('),    // submitScore + endRegular
].join('\n');
const EXPORTS = 'T, genMatches, standings, reseedKnockout, knockoutNotice, submitScore';

// ── o aplicativo falso ───────────────────────────────────────────────────────────────────────────
function makeEnv({ champs = [] } = {}) {
  const log = { updates: [], toasts: [], renders: 0 };
  const state = { idN: 0 };
  const st = { leagueId: 'L', appCfg: { hasFinais: true, halfTitleEnabled: true }, champs, modal: null, players: [], userRole: 'admin' };
  const byId = p => st.champs.find(c => c.id === p.split('/').pop());
  const DB = { doc: p => ({
    // como o Firestore de verdade: o campeonato em memória (st.champs) só reflete a gravação um instante DEPOIS do update
    update: async obj => { log.updates.push({ path: p, obj }); const c = byId(p); if (c) setImmediate(() => Object.assign(c, obj)); },
  }) };
  const env = {
    st, DB, uid: () => 'u' + (++state.idN), today: () => '2026-11-10',
    toast: (m, type, ms) => log.toasts.push({ m, type, ms }), render: () => { log.renders++; },
    document: { getElementById: () => null },
    confirm: () => true,
  };
  const names = Object.keys(env);
  const api = new Function(...names, CODE + '\nreturn { ' + EXPORTS + ' };')(...names.map(n => env[n]));
  return { api, st, log };
}
const tick = () => new Promise(r => setImmediate(r));
const A = makeEnv().api;

// ── os dados do campeonato de verdade (5 times, na ordem do campeonato) ─────────────────────────────
const TEAMS5 = ['amarelo', 'vermelho', 'laranja', 'verde', 'roxo'];
const R = (id, home, away, hs, as_, round) => ({ id, home, away, hs, as: as_, phase: 'regular', round, played: true, goals: [] });
// os 10 jogos da fase de grupos; o m_9 é o que foi lançado errado (3x2) e corrigido (2x3)
const grupos = (m9 = [2, 3]) => [
  R('m_1', 'vermelho', 'roxo', 1, 3, 2), R('m_2', 'laranja', 'verde', 2, 1, 2), R('m_3', 'laranja', 'amarelo', 4, 1, 3), R('m_4', 'verde', 'roxo', 2, 0, 3),
  R('m_5', 'verde', 'vermelho', 0, 1, 4), R('m_6', 'roxo', 'amarelo', 1, 0, 4), R('m_7', 'roxo', 'laranja', 1, 3, 1), R('m_8', 'amarelo', 'vermelho', 2, 1, 1),
  R('m_9', 'amarelo', 'verde', m9[0], m9[1], 5), R('m_10', 'vermelho', 'laranja', 2, 0, 5),
];
const SF = (id, home, away, hs = null, as_ = null) => ({ id, home, away, hs, as: as_, phase: 'semifinal', played: hs != null, ...(hs != null ? { goals: [] } : {}) });
const FIN = (home, away, hs = null, as_ = null) => ({ id: 'final', home, away, hs, as: as_, phase: 'final', played: hs != null, ...(hs != null ? { goals: [] } : {}) });
const camp = (matches, extra = {}) => ({ id: 'c1', date: '2026-11-10', teams: TEAMS5, format: 5, status: 'active', matches, champion: null, champion_players: null, regularEnded: false, ...extra });
const par = m => `${m.home}x${m.away}`;
const semis = ms => ms.filter(m => m.phase === 'semifinal').map(par).join(',');
const item =(r, label) => [...r.changed, ...r.stale].find(i => i.label === label);

(async () => {
  // ══ 1. O CASO REAL: A TABELA ANTES E DEPOIS DA CORREÇÃO ═══════════════════════════════════════════
  {
    const antes = A.standings(TEAMS5, grupos([3, 2])).map(r => r.team).join();
    const depois = A.standings(TEAMS5, grupos([2, 3])).map(r => r.team).join();
    check('o placar lançado errado (3x2) dava a tabela laranja, vermelho, roxo, amarelo, verde: as semifinais nasceram laranja x amarelo e vermelho x roxo', antes === 'laranja,vermelho,roxo,amarelo,verde', antes);
    check('o placar corrigido (2x3) dá a tabela laranja, verde, vermelho, roxo, amarelo: as semifinais certas são laranja x roxo e verde x vermelho', depois === 'laranja,verde,vermelho,roxo,amarelo', depois);
  }

  // ══ 2. reseedKnockout, 5 TIMES: SEMIFINAIS ═══════════════════════════════════════════════════════
  {
    const ms = [...grupos(), SF('sf1', 'laranja', 'amarelo'), SF('sf2', 'vermelho', 'roxo')];
    const snap = JSON.stringify(ms);
    const r = A.reseedKnockout(camp(ms), ms);
    check('semifinais velhas e AINDA NÃO JOGADAS: as duas são refeitas pela tabela (1º x 4º e 2º x 3º)', semis(r.matches) === 'laranjaxroxo,verdexvermelho' && r.changed.length === 2 && r.stale.length === 0, { s: semis(r.matches), c: r.changed, st: r.stale });
    check('o aviso traz o rótulo e os times que a tabela pede: Semi 1 = laranja x roxo, Semi 2 = verde x vermelho', item(r, 'Semi 1').home === 'laranja' && item(r, 'Semi 1').away === 'roxo' && item(r, 'Semi 2').home === 'verde' && item(r, 'Semi 2').away === 'vermelho' && item(r, 'Semi 1').id === 'sf1' && item(r, 'Semi 2').id === 'sf2', r.changed);
    check('a lista recebida não é alterada (a função devolve uma cópia nova)', JSON.stringify(ms) === snap && r.matches !== ms);
    check('o resto da semifinal fica como estava (id, fase, placar vazio, não jogada)', r.matches.filter(m => m.phase === 'semifinal').every(m => m.hs === null && m.as === null && m.played === false) && r.matches.filter(m => m.phase === 'semifinal').map(m => m.id).join() === 'sf1,sf2');
    check('os 10 jogos da fase de grupos são os mesmos objetos (nada é recriado)', r.matches.slice(0, 10).every((m, i) => m === ms[i]) && r.matches.length === 12);
  }
  {
    // já certas: nada a fazer, e a MESMA lista volta
    const ms = [...grupos(), SF('sf1', 'laranja', 'roxo'), SF('sf2', 'verde', 'vermelho')];
    const r = A.reseedKnockout(camp(ms), ms);
    check('semifinais que já batem com a tabela: nada muda e a mesma lista volta (sem gravar à toa)', r.matches === ms && r.changed.length === 0 && r.stale.length === 0, r);
  }
  {
    // O CASO DE HOJE: as duas semifinais já foram jogadas com os confrontos velhos e a final já nasceu deles
    const ms = [...grupos(), SF('sf1', 'laranja', 'amarelo', 3, 0), SF('sf2', 'vermelho', 'roxo', 0, 3), FIN('laranja', 'roxo')];
    const r = A.reseedKnockout(camp(ms), ms);
    check('semifinais JÁ JOGADAS com os times velhos: nada é refeito (jogo que aconteceu não se reescreve) e a mesma lista volta', r.matches === ms && r.changed.length === 0, r.changed);
    check('...e as duas vêm como "já jogadas, mas a tabela pede outro confronto": Semi 1 laranja x roxo e Semi 2 verde x vermelho', r.stale.length === 2 && item(r, 'Semi 1').home === 'laranja' && item(r, 'Semi 1').away === 'roxo' && item(r, 'Semi 2').home === 'verde' && item(r, 'Semi 2').away === 'vermelho', r.stale);
  }
  {
    // só uma jogada: as duas ficam como estão (refazer só a outra poderia pôr o mesmo time nas duas)
    const ms = [...grupos(), SF('sf1', 'laranja', 'amarelo', 3, 0), SF('sf2', 'vermelho', 'roxo')];
    const r = A.reseedKnockout(camp(ms), ms);
    check('só a semifinal 1 foi jogada: a 2 NÃO é refeita sozinha (nada muda) e as duas vêm como avisos', r.matches === ms && r.changed.length === 0 && r.stale.length === 2 && r.stale.map(i => i.label).join() === 'Semi 1,Semi 2', r);
    const ms2 = [...grupos(), SF('sf1', 'laranja', 'amarelo'), SF('sf2', 'vermelho', 'roxo', 0, 3)];
    const r2 = A.reseedKnockout(camp(ms2), ms2);
    check('só a semifinal 2 foi jogada: a 1 NÃO é refeita sozinha', r2.matches === ms2 && r2.changed.length === 0 && r2.stale.length === 2, r2);
    // uma jogada e a outra já certa: só vem o aviso da que está errada
    const ms3 = [...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'vermelho', 'roxo')];
    const r3 = A.reseedKnockout(camp(ms3), ms3);
    check('uma jogada e certa, a outra errada: só a errada vem como aviso, nada é refeito', r3.changed.length === 0 && r3.stale.length === 1 && r3.stale[0].id === 'sf2' && r3.stale[0].label === 'Semi 2', r3);
  }
  {
    // idempotente
    const ms = [...grupos(), SF('sf1', 'laranja', 'amarelo'), SF('sf2', 'vermelho', 'roxo')];
    const r = A.reseedKnockout(camp(ms), ms);
    const r2 = A.reseedKnockout(camp(r.matches), r.matches);
    check('refazer duas vezes dá o mesmo: na segunda não há mais o que mudar', r2.changed.length === 0 && r2.stale.length === 0 && r2.matches === r.matches, r2);
  }
  {
    // sem semifinais ainda (a fase de grupos não acabou, ou o campeonato nem chegou lá)
    const parcial = grupos().slice(0, 7);
    const r = A.reseedKnockout(camp(parcial), parcial);
    check('sem semifinais criadas ainda: não cria nada (quem cria é o registro do último jogo)', r.matches === parcial && r.changed.length === 0 && r.stale.length === 0);
    const s1 = [...grupos(), SF('sf1', 'laranja', 'amarelo')];
    const r1 = A.reseedKnockout(camp(s1), s1);
    check('só UMA semifinal na lista (dado estranho): não mexe em nada', r1.matches === s1 && r1.changed.length === 0 && r1.stale.length === 0);
  }

  // ══ 3. reseedKnockout, 5 TIMES: A FINAL (os vencedores das semifinais) ═══════════════════════════════
  {
    const base = [...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho', 2, 1)];
    const r = A.reseedKnockout(camp([...base, FIN('laranja', 'roxo')]), [...base, FIN('laranja', 'roxo')]);
    check('semifinais certas e jogadas, final velha e NÃO jogada: a final é refeita com os vencedores (laranja x verde)', r.changed.length === 1 && r.changed[0].label === 'Final' && r.changed[0].home === 'laranja' && r.changed[0].away === 'verde' && r.matches.find(m => m.id === 'final').away === 'verde' && r.stale.length === 0, r);
    check('a final refeita continua sem placar e não jogada', r.matches.find(m => m.id === 'final').hs === null && r.matches.find(m => m.id === 'final').played === false);
    const certa = [...base, FIN('laranja', 'verde')];
    const rc = A.reseedKnockout(camp(certa), certa);
    check('final que já bate com os vencedores: nada muda', rc.matches === certa && rc.changed.length === 0 && rc.stale.length === 0);
    // quem vence é o lado que fez mais gols: se o visitante ganha, é ele que segue; a final é vencedor da semi 1 x vencedor da semi 2
    const base2 = [...grupos(), SF('sf1', 'laranja', 'roxo', 0, 1), SF('sf2', 'verde', 'vermelho', 0, 1)];
    const r2 = A.reseedKnockout(camp([...base2, FIN('laranja', 'verde')]), [...base2, FIN('laranja', 'verde')]);
    check('os dois visitantes ganharam: a final é roxo (vencedor da semi 1) x vermelho (vencedor da semi 2), nessa ordem', r2.changed.length === 1 && r2.changed[0].home === 'roxo' && r2.changed[0].away === 'vermelho', r2.changed);
    // empate numa semifinal (dado antigo; o app não deixa registrar): segue o visitante, a mesma conta de quando o registro das semifinais cria a final
    const emp = [...grupos(), SF('sf1', 'laranja', 'roxo', 1, 1), SF('sf2', 'verde', 'vermelho', 2, 0), FIN('laranja', 'verde')];
    const re = A.reseedKnockout(camp(emp), emp);
    check('semifinal empatada (dado antigo): segue o visitante, a mesma conta de quando a final é criada pelo registro das semifinais (roxo x verde)', re.changed.length === 1 && re.changed[0].home === 'roxo' && re.changed[0].away === 'verde', re.changed);
    // final já jogada: nunca é reescrita
    const jogada = [...base, FIN('laranja', 'roxo', 2, 1)];
    const rj = A.reseedKnockout(camp(jogada), jogada);
    check('final JÁ JOGADA com times que não batem com os vencedores: não é reescrita, vem como aviso (Final laranja x verde)', rj.matches === jogada && rj.changed.length === 0 && rj.stale.length === 1 && rj.stale[0].label === 'Final' && rj.stale[0].home === 'laranja' && rj.stale[0].away === 'verde', rj);
    // com as semifinais ainda abertas a final não se mexe (não há vencedores)
    const aberta = [...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho'), FIN('laranja', 'roxo')];
    const ra = A.reseedKnockout(camp(aberta), aberta);
    check('uma semifinal ainda aberta: a final não é tocada (só valem vencedores de semifinais jogadas)', ra.matches === aberta && ra.changed.length === 0 && ra.stale.length === 0, ra);
    // as duas jogadas e nenhuma final na lista (dado estranho): quem cria a final é o registro da 2ª semifinal; aqui não quebra nem inventa final
    const semFinal = [...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho', 2, 1)];
    const rsf = A.reseedKnockout(camp(semFinal), semFinal);
    check('as duas semifinais jogadas e nenhuma final na lista (dado estranho): não quebra e não cria final', rsf.matches === semFinal && rsf.changed.length === 0 && rsf.stale.length === 0, rsf);
  }
  {
    // semifinais velhas, JOGADAS, e final nascida delas: as semifinais são avisos e a final (que bate com os vencedores velhos) não muda
    const ms = [...grupos(), SF('sf1', 'laranja', 'amarelo', 3, 0), SF('sf2', 'vermelho', 'roxo', 0, 3), FIN('laranja', 'roxo')];
    const r = A.reseedKnockout(camp(ms), ms);
    check('a final que bate com os vencedores das semifinais jogadas não é tocada, mesmo com as semifinais velhas', r.stale.every(i => i.label !== 'Final') && r.changed.length === 0);
  }

  // ══ 4. reseedKnockout, 4 TIMES: FINAL E 3º LUGAR (da tabela) ════════════════════════════════════════
  {
    const T4 = ['azul', 'preto', 'amarelo', 'vermelho'];
    const forca = { azul: 4, preto: 3, amarelo: 2, vermelho: 1 };
    const jogos = A.genMatches(T4, 4).map(m => { const d = forca[m.home] - forca[m.away]; return { ...m, played: true, hs: d > 0 ? 1 : 0, as: d > 0 ? 0 : 1, goals: [] }; });
    const tab = ms => A.standings(T4, ms).map(r => r.team);
    check('preparo: o time mais forte ganha sempre, a tabela é azul, preto, amarelo, vermelho', tab(jogos).join() === 'azul,preto,amarelo,vermelho', tab(jogos));
    const F4 = (extra = {}) => ({ id: 'c4', date: '2026-11-10', teams: T4, format: 4, status: 'active', matches: [], champion: null, ...extra });
    // uma virada de verdade: amarelo ganha de todos
    const virada = jogos.map(m => (m.home === 'amarelo' || m.away === 'amarelo' ? { ...m, hs: m.home === 'amarelo' ? 9 : 0, as: m.home === 'amarelo' ? 0 : 9 } : m));
    const tv = tab(virada);
    check('preparo: depois de o amarelo ganhar de todos a tabela muda (amarelo em 1º)', tv[0] === 'amarelo' && tv.join() !== 'azul,preto,amarelo,vermelho', tv);
    const comTerceiro = [...virada, FIN('azul', 'preto'), { id: 'third', home: 'amarelo', away: 'vermelho', hs: null, as: null, phase: 'third', played: false }];
    const r = A.reseedKnockout(F4({ matches: comTerceiro }), comTerceiro);
    check('4 times, final e 3º lugar velhos e NÃO jogados: a final vira 1º x 2º e o 3º lugar vira 3º x 4º da tabela nova', r.changed.length === 2 && item(r, 'Final').home === tv[0] && item(r, 'Final').away === tv[1] && item(r, '3º lugar').home === tv[2] && item(r, '3º lugar').away === tv[3] && par(r.matches.find(m => m.id === 'final')) === `${tv[0]}x${tv[1]}` && par(r.matches.find(m => m.id === 'third')) === `${tv[2]}x${tv[3]}`, r);
    const soFinal = [...virada, FIN('azul', 'preto')];
    const rf = A.reseedKnockout(F4({ matches: soFinal }), soFinal);
    check('4 times só com a final (sem 3º lugar): só a final é refeita', rf.changed.length === 1 && rf.changed[0].label === 'Final' && rf.stale.length === 0, rf);
    const finJogada = [...virada, FIN('azul', 'preto', 1, 0), { id: 'third', home: 'amarelo', away: 'vermelho', hs: null, as: null, phase: 'third', played: false }];
    const rj = A.reseedKnockout(F4({ matches: finJogada }), finJogada);
    check('4 times, final JÁ JOGADA: não é reescrita (vem como aviso) e o 3º lugar não jogado é refeito', rj.stale.length === 1 && rj.stale[0].label === 'Final' && rj.changed.length === 1 && rj.changed[0].label === '3º lugar' && par(rj.matches.find(m => m.id === 'final')) === 'azulxpreto', rj);
    const semMudar = [...jogos, FIN('azul', 'preto'), { id: 'third', home: 'amarelo', away: 'vermelho', hs: null, as: null, phase: 'third', played: false }];
    const rs = A.reseedKnockout(F4({ matches: semMudar }), semMudar);
    check('4 times com a tabela igual à de quando a final nasceu: nada muda', rs.matches === semMudar && rs.changed.length === 0 && rs.stale.length === 0);
    const semFinal = [...virada];
    const rn = A.reseedKnockout(F4({ matches: semFinal }), semFinal);
    check('4 times sem final criada ainda: nada é criado', rn.matches === semFinal && rn.changed.length === 0);
  }

  // ══ 5. O QUE NUNCA SE REFAZ: "vira", "sem final", 3º lugar do 5 times ═══════════════════════════════
  {
    const velhas = [...grupos(), SF('sf1', 'laranja', 'amarelo'), SF('sf2', 'vermelho', 'roxo')];
    const sem = A.reseedKnockout(camp(velhas, { noFinal: true }), velhas);
    check('liga "sem final" (pontos corridos): nada é refeito, mesmo com semifinais velhas na lista', sem.matches === velhas && sem.changed.length === 0 && sem.stale.length === 0);
    const vira = A.reseedKnockout(camp(velhas, { format: 3 }), velhas);
    check('"vira" (3 times): nada é refeito', vira.matches === velhas && vira.changed.length === 0 && vira.stale.length === 0);
    const comTerceiro = [...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho', 2, 1), FIN('laranja', 'verde', 2, 1), { id: 'third', home: 'amarelo', away: 'roxo', hs: null, as: null, phase: 'third', played: false }];
    const r3 = A.reseedKnockout(camp(comTerceiro), comTerceiro);
    check('5 times: o 3º lugar (criado depois do título, à parte) não é tocado', r3.matches === comTerceiro && r3.changed.length === 0 && r3.stale.length === 0, r3);
  }

  // ══ 6. PROPRIEDADE: 300 campeonatos sorteados, com correções sorteadas ══════════════════════════════
  {
    let seed = 20261110;
    const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let ruins = 0, refeitas = 0, finaisRefeitas = 0, avisos = 0;
    for (let k = 0; k < 300; k++) {
      let reg = grupos().map(m => ({ ...m, hs: rnd(5), as: rnd(5) }));
      const tabOrig = A.standings(TEAMS5, reg).map(r => r.team);
      let ms = [...reg, SF('sf1', tabOrig[0], tabOrig[3]), SF('sf2', tabOrig[1], tabOrig[2])];
      // 1 a 3 correções de placar na fase de grupos
      for (let e = rnd(3) + 1; e > 0; e--) { const i = rnd(10); ms[i] = { ...ms[i], hs: rnd(5), as: rnd(5) }; }
      const nova = A.standings(TEAMS5, ms).map(r => r.team);
      const r = A.reseedKnockout(camp(ms), ms);
      const esperado = `${nova[0]}x${nova[3]},${nova[1]}x${nova[2]}`;
      if (semis(r.matches) !== esperado || r.stale.length) ruins++;
      if (r.changed.length) refeitas++;
      // jogar as duas semifinais (com o confronto certo) e a final nascer; depois corrigir o vencedor da semi 1
      const sf = r.matches.filter(m => m.phase === 'semifinal').map(m => ({ ...m, hs: rnd(4) + 1, as: 0, played: true, goals: [] }));
      const sfs = sf.map(m => (rnd(2) ? { ...m, hs: 0, as: rnd(4) + 1 } : m));
      const venc = m => (m.hs > m.as ? m.home : m.away);
      const base = [...r.matches.filter(m => m.phase !== 'semifinal'), ...sfs];
      const comFinal = [...base, FIN(venc(sfs[0]), venc(sfs[1]))];
      const flip = sfs.map((m, i) => (i === 0 ? (m.hs > m.as ? { ...m, hs: 0, as: m.hs } : { ...m, hs: m.as, as: 0 }) : m));   // o vencedor da semifinal 1 passa a ser o outro lado (sem empate)
      const depois = [...base.filter(m => m.phase !== 'semifinal'), ...flip, comFinal[comFinal.length - 1]];
      const rf = A.reseedKnockout(camp(depois), depois);
      const f = rf.matches.find(m => m.id === 'final');
      if (par(f) !== `${venc(flip[0])}x${venc(flip[1])}`) ruins++;
      if (rf.changed.some(i => i.label === 'Final')) finaisRefeitas++;
      if (rf.stale.length) avisos++;
    }
    check('300 campeonatos sorteados: depois de corrigir placares, as semifinais não jogadas sempre ficam 1º x 4º e 2º x 3º da tabela de agora (e nunca sobra aviso)', ruins === 0, { ruins });
    check('...e a final sempre fica com os vencedores de agora (o sorteio exercitou refazer semifinais e finais, e nenhum "já jogada")', refeitas > 30 && finaisRefeitas > 30 && avisos === 0, { refeitas, finaisRefeitas, avisos });
  }

  // ══ 7. O AVISO AO ADMIN (knockoutNotice) ═════════════════════════════════════════════════════════
  {
    const a = { id: 'sf1', label: 'Semi 1', home: 'laranja', away: 'roxo' };
    const b = { id: 'sf2', label: 'Semi 2', home: 'verde', away: 'vermelho' };
    const feito = A.knockoutNotice({ changed: [a, b], stale: [] });
    check('só refeitos: "Confrontos refeitos pela nova tabela — Semi 1: Laranja × Roxo · Semi 2: Verde × Vermelho."', feito === 'Confrontos refeitos pela nova tabela — Semi 1: Laranja × Roxo · Semi 2: Verde × Vermelho.', feito);
    const velho = A.knockoutNotice({ changed: [], stale: [a, b] });
    check('só já jogados: avisa que não foi alterado e diz como seria pela nova tabela', velho === 'A tabela mudou, mas jogo já disputado não é alterado e ficou como estava. Pela nova tabela seria — Semi 1: Laranja × Roxo · Semi 2: Verde × Vermelho.', velho);
    const dois = A.knockoutNotice({ changed: [{ id: 'final', label: 'Final', home: 'laranja', away: 'verde' }], stale: [a] });
    check('os dois juntos viram UM texto só (os avisos ficam um em cima do outro na tela)', dois.startsWith('Confrontos refeitos pela nova tabela — Final: Laranja × Verde. A tabela mudou, mas jogo já disputado') && dois.endsWith('Semi 1: Laranja × Roxo.'), dois);
    const livre = A.knockoutNotice({ changed: [{ id: 'final', label: 'Final', home: 'xpto', away: 'verde' }], stale: [] });
    check('time que não está na lista de cores aparece pelo nome gravado', livre === 'Confrontos refeitos pela nova tabela — Final: xpto × Verde.', livre);
    check('sem nada a avisar o texto é vazio', A.knockoutNotice({ changed: [], stale: [] }) === '');
  }

  // ══ 8. submitScore (o registro de placar de verdade): O CAMINHO COMPLETO DO CASO REAL ═══════════════
  const reg = async (E, id, hs, as_, goals = []) => { await E.api.submitScore(id, hs, as_, goals, null, []); await tick(); };
  const ativo = E => E.st.champs.find(c => c.status === 'active');
  const ult = E => E.log.updates[E.log.updates.length - 1].obj;
  const semiNoUltimo = E => semis(ult(E).matches);
  const aberto = () => grupos().map(m => (m.id === 'm_9' ? { id: 'm_9', home: 'amarelo', away: 'verde', hs: null, as: null, phase: 'regular', round: 5, played: false } : m)); // o m_9 ainda por jogar
  {
    // A: o admin corrige ANTES de jogar as semifinais
    const E = makeEnv({ champs: [camp(aberto())] });
    await reg(E, 'm_9', 3, 2);
    check('o último jogo da fase de grupos (lançado errado, 3x2) cria as semifinais como sempre: laranja x amarelo e vermelho x roxo', semiNoUltimo(E) === 'laranjaxamarelo,vermelhoxroxo' && ult(E).matches.length === 12 && E.log.toasts.length === 0, { s: semiNoUltimo(E), t: E.log.toasts });
    check('o primeiro registro grava só as partidas (nada de campeão nem status)', Object.keys(ult(E)).join() === 'matches');
    await reg(E, 'm_9', 2, 3);
    const u = ult(E).matches;
    check('A CORREÇÃO (2x3): as semifinais são refeitas pela tabela nova, laranja x roxo e verde x vermelho', semis(u) === 'laranjaxroxo,verdexvermelho', semis(u));
    check('...ainda sem resultado, e o jogo corrigido fica gravado com 2x3', u.filter(m => m.phase === 'semifinal').every(m => !m.played && m.hs === null) && u.find(m => m.id === 'm_9').hs === 2 && u.find(m => m.id === 'm_9').as === 3 && u.length === 12, u.filter(m => m.phase !== 'regular'));
    check('...e o admin é avisado UMA vez, em verde, por 9 segundos, com os confrontos novos', E.log.toasts.length === 1 && E.log.toasts[0].type === 'ok' && E.log.toasts[0].ms === 9000 && E.log.toasts[0].m === 'Confrontos refeitos pela nova tabela — Semi 1: Laranja × Roxo · Semi 2: Verde × Vermelho.', E.log.toasts);
    check('...e grava só o campo das partidas, fecha a janela e redesenha', Object.keys(ult(E)).join() === 'matches' && E.st.modal === null && E.log.renders === 2);
    // jogar as semifinais novas: a final nasce dos vencedores CERTOS (laranja e verde)
    await reg(E, 'sf1', 3, 0);
    check('registrar a semifinal 1 (primeira vez) não cria final e não avisa nada', !ult(E).matches.some(m => m.phase === 'final') && E.log.toasts.length === 1);
    await reg(E, 'sf2', 3, 0);
    const f = ult(E).matches.find(m => m.phase === 'final');
    check('registrar a semifinal 2 cria a final com os vencedores das semifinais refeitas: laranja x verde', f && par(f) === 'laranjaxverde' && f.played === false && E.log.toasts.length === 1, f);
  }
  {
    // B: O CASO REAL DE HOJE: as semifinais foram registradas com os confrontos velhos, depois veio a correção
    const E = makeEnv({ champs: [camp(aberto())] });
    await reg(E, 'm_9', 3, 2);
    await reg(E, 'sf1', 3, 0);
    await reg(E, 'sf2', 0, 3);
    check('preparo: as semifinais velhas foram jogadas e a final nasceu laranja x roxo', par(ult(E).matches.find(m => m.id === 'final')) === 'laranjaxroxo');
    await reg(E, 'm_9', 2, 3);
    const u = ult(E).matches;
    check('corrigir o m_9 DEPOIS de jogar as semifinais: elas continuam como estavam (jogo disputado não é reescrito) e a final também', semis(u) === 'laranjaxamarelo,vermelhoxroxo' && par(u.find(m => m.id === 'final')) === 'laranjaxroxo' && u.find(m => m.id === 'sf1').hs === 3 && u.find(m => m.id === 'sf2').as === 3, u.filter(m => m.phase !== 'regular'));
    const t = E.log.toasts[E.log.toasts.length - 1];
    check('...e o admin é avisado em VERMELHO por 9 segundos: a tabela mudou, nada foi alterado e como seria (Semi 1 laranja x roxo, Semi 2 verde x vermelho)', t.type === 'err' && t.ms === 9000 && t.m === 'A tabela mudou, mas jogo já disputado não é alterado e ficou como estava. Pela nova tabela seria — Semi 1: Laranja × Roxo · Semi 2: Verde × Vermelho.', t);
    check('...e a correção em si foi gravada (o m_9 ficou 2x3)', u.find(m => m.id === 'm_9').hs === 2 && u.find(m => m.id === 'm_9').as === 3);
  }
  {
    // C: salvar de novo sem mudar nada, com as semifinais certas: não avisa nem mexe
    const E = makeEnv({ champs: [camp(aberto())] });
    await reg(E, 'm_9', 2, 3);   // 1º registro, já certo: semifinais certas
    const antes = E.log.toasts.length;
    await reg(E, 'm_9', 2, 3);
    check('salvar o mesmo placar de novo, com as semifinais certas: nenhum aviso e as semifinais iguais', E.log.toasts.length === antes && semiNoUltimo(E) === 'laranjaxroxo,verdexvermelho');
    await reg(E, 'm_9', 2, 3, [{ player: 'Beto', team: 'away' }]);
    check('mudar só os gols (mesmo placar): os gols são gravados e nenhum confronto é refeito nem avisado', E.log.toasts.length === antes && ult(E).matches.find(m => m.id === 'm_9').goals.length === 1 && semiNoUltimo(E) === 'laranjaxroxo,verdexvermelho');
  }
  {
    // D: campeonato que ficou velho ANTES deste conserto (semifinais erradas, não jogadas): salvar qualquer jogo da fase de grupos de novo acerta
    const velho = camp([...grupos(), SF('sf1', 'laranja', 'amarelo'), SF('sf2', 'vermelho', 'roxo')]);
    const E = makeEnv({ champs: [velho] });
    await reg(E, 'm_2', 2, 1);
    check('semifinais que já estavam velhas (não jogadas): salvar de novo QUALQUER jogo da fase de grupos as acerta e avisa', semiNoUltimo(E) === 'laranjaxroxo,verdexvermelho' && E.log.toasts.length === 1 && E.log.toasts[0].type === 'ok', { s: semiNoUltimo(E), t: E.log.toasts });
  }
  {
    // E: corrigir o placar de uma semifinal troca a final, se ela não foi jogada
    const E = makeEnv({ champs: [camp([...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho', 2, 1), FIN('laranja', 'verde')])] });
    await reg(E, 'sf2', 1, 2);
    const u = ult(E).matches;
    check('corrigir a semifinal 2 (o vencedor muda para o vermelho): a final ainda não jogada vira laranja x vermelho', par(u.find(m => m.id === 'final')) === 'laranjaxvermelho' && u.find(m => m.id === 'sf2').hs === 1 && u.find(m => m.id === 'sf2').as === 2, u.filter(m => m.phase !== 'regular'));
    check('...com o aviso "Final: Laranja × Vermelho" em verde', E.log.toasts.length === 1 && E.log.toasts[0].type === 'ok' && E.log.toasts[0].m === 'Confrontos refeitos pela nova tabela — Final: Laranja × Vermelho.', E.log.toasts);
    const F = makeEnv({ champs: [camp([...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho', 2, 1), FIN('laranja', 'verde', 2, 1)])] });
    await reg(F, 'sf2', 1, 2);
    const uf = ult(F).matches;
    check('corrigir a semifinal 2 com a final JÁ JOGADA: a final não é reescrita e o admin é avisado em vermelho', par(uf.find(m => m.id === 'final')) === 'laranjaxverde' && F.log.toasts.length === 1 && F.log.toasts[0].type === 'err', { f: uf.find(m => m.id === 'final'), t: F.log.toasts });
    const G = makeEnv({ champs: [camp([...grupos(), SF('sf1', 'laranja', 'roxo', 3, 0), SF('sf2', 'verde', 'vermelho', 2, 1), FIN('laranja', 'verde', 2, 1)])] });
    await reg(G, 'final', 3, 1);
    const ug = ult(G).matches;
    check('corrigir o placar da própria final: só o placar muda (nunca refaz confrontos) e nenhum aviso', ug.find(m => m.id === 'final').hs === 3 && par(ug.find(m => m.id === 'final')) === 'laranjaxverde' && G.log.toasts.length === 0 && semis(ug) === 'laranjaxroxo,verdexvermelho');
  }
  {
    // F: 4 times, final criada, correção de um jogo da fase regular
    const T4 = ['azul', 'preto', 'amarelo', 'vermelho'];
    const forca = { azul: 4, preto: 3, amarelo: 2, vermelho: 1 };
    const jogos = A.genMatches(T4, 4).map(m => { const d = forca[m.home] - forca[m.away]; return { ...m, played: true, hs: d > 0 ? 1 : 0, as: d > 0 ? 0 : 1, goals: [] }; });
    const c4 = { id: 'c1', date: '2026-11-10', teams: T4, format: 4, status: 'active', matches: [...jogos, FIN('azul', 'preto')], champion: null };
    const E = makeEnv({ champs: [c4] });
    const alvo = jogos.find(m => (m.home === 'amarelo' && m.away === 'preto') || (m.home === 'preto' && m.away === 'amarelo'));   // o amarelo passa a ganhar este jogo por 9x0 e ultrapassa o preto
    await reg(E, alvo.id, alvo.home === 'amarelo' ? 9 : 0, alvo.home === 'amarelo' ? 0 : 9);
    const tab = A.standings(T4, ult(E).matches).map(r => r.team);
    const f = ult(E).matches.find(m => m.id === 'final');
    check('4 times: corrigir um jogo da fase regular com a final já criada e não jogada refaz a final pela tabela nova (azul x amarelo)', tab.slice(0, 2).join() === 'azul,amarelo' && par(f) === 'azulxamarelo' && E.log.toasts.length === 1 && E.log.toasts[0].type === 'ok' && E.log.toasts[0].m === 'Confrontos refeitos pela nova tabela — Final: Azul × Amarelo.', { f, tab, t: E.log.toasts });
  }
  {
    // H: o PRIMEIRO registro de uma semifinal nunca refaz nada nem avisa (é o registro normal; o admin vê os times na tela)
    const velho = camp([...grupos(), SF('sf1', 'laranja', 'amarelo'), SF('sf2', 'vermelho', 'roxo')]);
    const E = makeEnv({ champs: [velho] });
    await reg(E, 'sf1', 3, 0);
    check('primeiro registro de uma semifinal (mesmo com times velhos): grava o placar, não refaz nada e não avisa', semiNoUltimo(E) === 'laranjaxamarelo,vermelhoxroxo' && E.log.toasts.length === 0 && ult(E).matches.find(m => m.id === 'sf1').hs === 3, { s: semiNoUltimo(E), t: E.log.toasts });
  }
  {
    // G: sem final e "vira" não refazem nada
    const E = makeEnv({ champs: [camp([...grupos()], { noFinal: true })] });
    await reg(E, 'm_9', 3, 2);
    check('liga sem final: corrigir um placar só grava o placar (nenhuma semifinal, nenhum aviso)', !ult(E).matches.some(m => m.phase !== 'regular') && E.log.toasts.length === 0);
    const V = makeEnv({ champs: [{ id: 'c1', date: '2026-11-10', teams: ['azul', 'preto', 'amarelo'], format: 3, status: 'active', matches: [{ id: 'm_a', home: 'azul', away: 'preto', rest: 'amarelo', hs: 1, as: 0, phase: 'regular', seq: 1, played: true, goals: [] }], champion: null, regularEnded: false }] });
    await reg(V, 'm_a', 2, 0);
    check('"vira": corrigir um placar não refaz nem avisa nada', V.log.toasts.length === 0 && ult(V).matches.length === 1);
  }

  // ══ 9. A TELA, O MANUAL E O CI ═══════════════════════════════════════════════════════════════════
  {
    check('o aviso fica 9 segundos na tela (o toast aceita a duração como 3º argumento e continua em 3,2 s para os outros avisos)', /function toast\(msg, type='err', ms=3200\) \{[\s\S]*?setTimeout\(\(\) => el\.remove\(\), ms\);/.test(html));
    const sec = manual.slice(manual.indexOf('id="corrigir-placar-mata-mata"'), manual.indexOf('<h3>Finais empatadas (pênaltis)</h3>'));
    check('manual (seção 06): o subtítulo "Corrigir um placar depois que as semifinais ou a final já foram montadas" existe, com âncora', sec.length > 200 && sec.includes('Corrigir um placar depois que as semifinais ou a final já foram montadas'));
    check('manual: explica de onde vêm os confrontos (5 times: 1º x 4º, 2º x 3º e vencedores; 4 times: 1º x 2º e 3º x 4º)', sec.includes('1º × 4º') && sec.includes('2º × 3º') && sec.includes('1º × 2º') && sec.includes('3º × 4º') && sec.includes('vencedores'));
    check('manual: diz que o app refaz sozinho o que ainda não foi jogado e mostra o aviso', sec.includes('refaz sozinho os confrontos que ainda não foram jogados') && sec.includes('Confrontos refeitos pela nova tabela'));
    check('manual: diz que jogo já jogado não muda, que as semifinais só se refazem juntas e se nenhuma foi jogada, e manda corrigir antes de jogar as semifinais', sec.includes('O app nunca reescreve um jogo que já tem resultado') && sec.includes('só são refeitas juntas, e só se nenhuma delas foi jogada') && sec.includes('corrija o placar errado antes de jogar as semifinais'));
    check('manual: o e-mail de suporte certo (suporte@, não contato@)', sec.includes('suporte@peladanamao.com.br') && !sec.includes('contato@'));
    check('CI: o teste está nos passos do job test', /node test\/client-knockout-reseed-test\.js/.test(ci));
  }

  console.log(fails ? `\n${fails} verificação(ões) FALHARAM` : '\nTodas as verificações passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERRO no teste:', e && e.stack || e); process.exit(1); });
