// Conquista "Alérgico a Gol" (index.html): 3 campeonatos SEGUIDOS sem fazer nenhum gol; não vale para goleiros. Extrai o código real e o executa num ambiente
// simulado, sem navegador: a função que conta a sequência (goallessStreak), o cálculo das estatísticas de todos os jogadores (computePlayerBadgeStats), a linha
// do catálogo e as ligações no app e no manual. Regras: o jogador precisa estar no elenco; o campeonato precisa ter gols registrados (senão não dá para provar
// nada e a sequência zera); faltar a um campeonato ou fazer um gol zera; só conta a partir de 08/09/2026 e fora do plano gratuito.
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
const streakCode = slice('function goallessStreak(chron, name) {', 'function getPlayerRarestBadge(');
const statsCode = slice('function computePlayerBadgeStats(name) {', 'function getBadgeCache()');

// ── a linha do catálogo, executada de verdade (só o objeto: o `check` não depende de mais nada) ──
const entryLine = (html.match(/^ {2}\{ id:'alergico_gol'.*\},$/m) || [])[0];
const BADGE = entryLine ? new Function('return (' + entryLine.trim().replace(/,$/, '') + ')')() : null;

// ── ambiente do aplicativo falso ─────────────────────────────────────────────────────────────────
function makeStats(players, champs) {
  const env = { st: { players, champs, ranks: [], finMens: {}, finCfg: {} }, getChampAwards: () => null, computeAwardStats: () => ({}), getPaid: () => false, getPaidDate: () => null };
  const names = Object.keys(env);
  return new Function(...names, streakCode + '\n' + statsCode + '\nreturn { goallessStreak, computePlayerBadgeStats };')(...names.map(n => env[n]));
}
const { goallessStreak: streak } = makeStats([], []);

// Campeonato de mentira: `roster` são os que jogaram (todos no mesmo time, não importa aqui), `goals` { nome: quantos } nas partidas da fase regular.
const goalsOf = g => Object.entries(g).flatMap(([p, n]) => Array.from({ length: n }, () => ({ player: p })));
function champ(date, roster, goals = {}, o = {}) {
  return {
    id: 'c-' + date + (o.tag || ''), date, status: o.status || 'completed', freeMode: !!o.free,
    teamRosters: o.noRosters ? undefined : { azul: roster, verde: ['Zé'] },
    matches: o.matches || [
      { phase: 'regular', played: true, home: 'azul', away: 'verde', hs: 1, as: 0, goals: goalsOf(goals) },
      { phase: 'final', played: true, home: 'azul', away: 'verde', hs: 0, as: 0, goals: [], finalGoals: o.finalGoals || [] },
    ],
  };
}
const SEM = (date, o) => champ(date, ['Ana', 'Bia'], { Bia: 2 }, o);          // Ana joga e não faz gol (Bia faz)
const COM = (date, o) => champ(date, ['Ana', 'Bia'], { Ana: 1, Bia: 1 }, o);  // Ana joga e faz 1 gol
const FALTOU = (date, o) => champ(date, ['Bia'], { Bia: 2 }, o);               // Ana não está no elenco
const SEMGOLS = (date, o) => champ(date, ['Ana', 'Bia'], {}, o);              // ninguém marcou (gols provavelmente não lançados)
const D = i => '2026-09-' + String(8 + i * 7).padStart(2, '0');                  // 08, 15, 22, 29 de setembro…
const D2 = i => (i < 4 ? D(i) : '2026-10-' + String(i * 7 - 20).padStart(2, '0'));

(async () => {
  // ══ 1. A CONTA (goallessStreak) ═══════════════════════════════════════════════════════════════════
  check('a linha do catálogo existe, uma vez só: id alergico_gol, 🤧, "Alérgico a Gol", "3 campeonatos seguidos sem fazer nenhum gol", só jogador de linha (fieldOnly, nunca gkOnly)', !!BADGE && (html.match(/id:'alergico_gol'/g) || []).length === 1 && BADGE.id === 'alergico_gol' && BADGE.emoji === '🤧' && BADGE.label === 'Alérgico a Gol' && BADGE.desc === '3 campeonatos seguidos sem fazer nenhum gol' && BADGE.fieldOnly === true && !BADGE.gkOnly && !BADGE.specialFor, BADGE);
  check('a conquista sai com 3 campeonatos seguidos sem gol (check: consecGoalless ≥ 3) e não com 2; sem o dado (undefined) não sai', BADGE.check({ consecGoalless: 3 }) === true && BADGE.check({ consecGoalless: 4 }) === true && BADGE.check({ consecGoalless: 2 }) === false && BADGE.check({ consecGoalless: 0 }) === false && BADGE.check({}) === false);
  check('sem campeonato nenhum: 0', streak([], 'Ana') === 0 && streak([SEM(D(0))], 'Ana') === 1);
  check('3 campeonatos seguidos no elenco sem gol: 3 (a conquista sai); 2: não', streak([SEM(D(0)), SEM(D(1)), SEM(D(2))], 'Ana') === 3 && streak([SEM(D(0)), SEM(D(1))], 'Ana') === 2);
  check('vale o MAIOR trecho, sem limite de 3: 5 seguidos = 5', streak([0, 1, 2, 3, 4].map(i => SEM(D2(i))), 'Ana') === 5);
  check('fazer um gol zera a sequência: sem, sem, COM, sem, sem, sem = 3 (o trecho depois do gol); sem, sem, COM, sem, sem = 2 (nunca chega a 3)', streak([SEM(D2(0)), SEM(D2(1)), COM(D2(2)), SEM(D2(3)), SEM(D2(4)), SEM(D2(5))], 'Ana') === 3 && streak([SEM(D2(0)), SEM(D2(1)), COM(D2(2)), SEM(D2(3)), SEM(D2(4))], 'Ana') === 2);
  check('um gol no começo e outro no fim, com 2 sem gol no meio: 2 (a conquista não sai)', streak([COM(D2(0)), SEM(D2(1)), SEM(D2(2)), COM(D2(3))], 'Ana') === 2);
  check('faltar a um campeonato (fora do elenco) também zera: sem, FALTOU, sem, sem = 2; sem, sem, FALTOU, sem = 2', streak([SEM(D2(0)), FALTOU(D2(1)), SEM(D2(2)), SEM(D2(3))], 'Ana') === 2 && streak([SEM(D2(0)), SEM(D2(1)), FALTOU(D2(2)), SEM(D2(3))], 'Ana') === 2);
  check('campeonato sem NENHUM gol registrado (ninguém marcou: o admin provavelmente não lançou): zera, não vale como "sem gol": sem, SEMGOLS, sem, sem = 2; sem, SEMGOLS, sem = 1; só SEMGOLS = 0', streak([SEM(D2(0)), SEMGOLS(D2(1)), SEM(D2(2)), SEM(D2(3))], 'Ana') === 2 && streak([SEM(D2(0)), SEMGOLS(D2(1)), SEM(D2(2))], 'Ana') === 1 && streak([SEMGOLS(D2(0)), SEMGOLS(D2(1)), SEMGOLS(D2(2))], 'Ana') === 0);
  check('três campeonatos sem nenhum gol lançado NÃO dão a conquista a ninguém (o erro mais perigoso para uma conquista que depende de "não fazer")', streak([0, 1, 2].map(i => SEMGOLS(D(i))), 'Ana') === 0 && streak([0, 1, 2].map(i => SEMGOLS(D(i))), 'Bia') === 0);
  check('campeonato sem elenco registrado (teamRosters ausente): não dá para saber se jogou, então zera: sem, SEM-ELENCO, sem = 1', streak([SEM(D2(0)), SEM(D2(1), { noRosters: true }), SEM(D2(2))], 'Ana') === 1 && streak([0, 1, 2].map(i => SEM(D(i), { noRosters: true })), 'Ana') === 0);
  // final: a regra dos gols da final é a do resto do app
  const comFinal = (date, finalGoals, goals = { Bia: 2 }) => champ(date, ['Ana', 'Bia'], goals, { finalGoals });
  check('gol de Ana na FINAL (finalGoals) conta como gol: o campeonato zera a sequência', streak([SEM(D2(0)), comFinal(D2(1), [{ player: 'Ana' }]), SEM(D2(2)), SEM(D2(3))], 'Ana') === 2);
  check('a final usa finalGoals quando existe; senão usa goals (como as outras contas do app): gol de Ana só em goals da final sem finalGoals CONTA; com finalGoals de outro jogador, o goals da final é ignorado', (() => {
    const finalSoGoals = ['x'].map(() => champ(D2(1), ['Ana', 'Bia'], { Bia: 1 }, { matches: [{ phase: 'regular', played: true, goals: goalsOf({ Bia: 1 }) }, { phase: 'final', played: true, goals: [{ player: 'Ana' }], finalGoals: [] }] }))[0];
    const finalComFG = champ(D2(1), ['Ana', 'Bia'], { Bia: 1 }, { matches: [{ phase: 'regular', played: true, goals: goalsOf({ Bia: 1 }) }, { phase: 'final', played: true, goals: [{ player: 'Ana' }], finalGoals: [{ player: 'Bia' }] }] });
    return streak([SEM(D2(0)), finalSoGoals, SEM(D2(2))], 'Ana') === 1 && streak([SEM(D2(0)), finalComFG, SEM(D2(2))], 'Ana') === 3;
  })());
  check('partida NÃO jogada é ignorada: gol de Ana numa partida que não aconteceu não conta (e uma partida não jogada com gols não faz o campeonato "ter gols")', (() => {
    const naoJogada = champ(D2(1), ['Ana', 'Bia'], {}, { matches: [{ phase: 'regular', played: true, goals: goalsOf({ Bia: 1 }) }, { phase: 'regular', played: false, goals: goalsOf({ Ana: 3 }) }] });
    const soNaoJogada = champ(D2(1), ['Ana', 'Bia'], {}, { matches: [{ phase: 'regular', played: false, goals: goalsOf({ Bia: 4 }) }] });
    return streak([SEM(D2(0)), naoJogada, SEM(D2(2))], 'Ana') === 3 && streak([SEM(D2(0)), soNaoJogada, SEM(D2(2))], 'Ana') === 1;
  })());
  check('gol em qualquer partida da fase regular conta (não só na primeira): Ana marca na 3ª partida e zera', (() => {
    const c = champ(D2(1), ['Ana', 'Bia'], {}, { matches: [{ phase: 'regular', played: true, goals: goalsOf({ Bia: 1 }) }, { phase: 'regular', played: true, goals: [] }, { phase: 'semifinal', played: true, goals: goalsOf({ Ana: 1 }) }] });
    return streak([SEM(D2(0)), c, SEM(D2(2)), SEM(D2(3))], 'Ana') === 2;
  })());
  check('o nome tem de ser exatamente o do jogador: gol de "Ana Maria" não é de "Ana" (e vice-versa); elenco por nome exato', (() => {
    const am = champ(D(1), ['Ana', 'Ana Maria'], { 'Ana Maria': 2 });
    const soAnaMaria = champ(D(1), ['Bia', 'Ana Maria'], { Bia: 2 }); // "Ana" NÃO está no elenco (só a "Ana Maria"): "Ana" faltou
    return streak([SEM(D(0)), am, SEM(D(2))], 'Ana') === 3 && streak([SEM(D(0)), am, SEM(D(2))], 'Ana Maria') === 0 && streak([am, am, am], 'Ana Maria') === 0 && streak([am, am, am], 'Ana') === 3
      && streak([SEM(D2(0)), soAnaMaria, SEM(D2(2)), SEM(D2(3))], 'Ana') === 2 && streak([soAnaMaria, soAnaMaria, soAnaMaria], 'Ana') === 0;
  })());
  check('finalGoals só vale na partida da FINAL: numa partida da fase regular que tenha finalGoals por engano, valem os gols normais (goals)', (() => {
    const c = champ(D2(1), ['Ana', 'Bia'], {}, { matches: [{ phase: 'regular', played: true, goals: [{ player: 'Ana' }], finalGoals: [{ player: 'Bia' }] }, { phase: 'final', played: true, goals: [], finalGoals: [{ player: 'Bia' }] }] });
    return streak([SEM(D2(0)), c, SEM(D2(2)), SEM(D2(3))], 'Ana') === 2;
  })());
  check('goleiro ou não, a conta é a mesma; quem está em qualquer time do elenco conta como jogou (azul ou verde)', streak([champ(D(0), ['Bia'], { Bia: 1 }, {}), champ(D(1), ['Bia'], { Bia: 1 }), champ(D(2), ['Bia'], { Bia: 1 })].map(c => ({ ...c, teamRosters: { azul: ['Bia'], verde: ['Ana'] } })), 'Ana') === 3);
  const seq = [SEM(D2(0)), SEM(D2(1)), COM(D2(2)), SEM(D2(3)), SEM(D2(4)), SEM(D2(5)), FALTOU(D2(6)), SEM(D2(7))];
  check('a ordem de leitura não muda o resultado (o maior trecho é o mesmo de trás para frente)', streak(seq, 'Ana') === streak([...seq].reverse(), 'Ana') && streak(seq, 'Ana') === 3);
  check('dados estranhos não quebram: campeonato sem partidas, partidas sem gols, gols sem jogador, lista de nomes vazia', (() => { try { return streak([{ teamRosters: { a: ['Ana'] } }, { teamRosters: { a: ['Ana'] }, matches: [{ played: true }] }, { teamRosters: { a: ['Ana'] }, matches: [{ played: true, goals: [{}] }] }, { teamRosters: {}, matches: [] }], 'Ana') >= 0; } catch (_) { return false; } })());

  // ══ 2. O CÁLCULO DE TODOS OS JOGADORES (computePlayerBadgeStats) ══════════════════════════════════
  const players = [{ name: 'Ana' }, { name: 'Bia' }, { name: 'Gil', goleiro: true }];
  const base = [SEM('2026-09-09'), SEM('2026-09-16'), SEM('2026-09-23')];
  const S = champs => makeStats(players, champs).computePlayerBadgeStats('Ana');
  check('computePlayerBadgeStats devolve consecGoalless: 3 campeonatos seguidos sem gol = 3 (a conquista sai pelo check do catálogo)', S(base).consecGoalless === 3 && BADGE.check(S(base)) === true, S(base).consecGoalless);
  check('2 campeonatos: 2 (a conquista NÃO sai); com um gol no meio: 1', S(base.slice(0, 2)).consecGoalless === 2 && BADGE.check(S(base.slice(0, 2))) === false && S([SEM('2026-09-09'), COM('2026-09-16'), SEM('2026-09-23')]).consecGoalless === 1);
  check('o resultado vem na mesma conta mesmo com a lista fora de ordem (o app guarda do mais novo para o mais antigo)', S([...base].reverse()).consecGoalless === 3 && S([base[1], base[2], base[0]]).consecGoalless === 3);
  check('só conta a partir de 08/09/2026 (antes não há gols registrados): um campeonato de 01/09 sem gol não entra (3 + o antigo continua 3; 2 + o antigo continua 2, não vira 3)', S([...base, SEM('2026-09-01')]).consecGoalless === 3 && S([...base.slice(0, 2), SEM('2026-09-01')]).consecGoalless === 2 && S([SEM('2026-09-07'), SEM('2026-09-06'), SEM('2026-09-05')]).consecGoalless === 0);
  check('o dia 08/09/2026 já conta (o limite é inclusivo)', S([SEM('2026-09-08'), SEM('2026-09-09'), SEM('2026-09-10')]).consecGoalless === 3);
  check('campeonato do plano gratuito (freeMode) e campeonato que não terminou ficam de fora: não somam nem quebram a sequência no meio', S([base[0], base[1], SEM('2026-09-20', { free: true, tag: 'f' }), SEM('2026-09-21', { status: 'active', tag: 'a' }), base[2]]).consecGoalless === 3 && S([base[0], SEM('2026-09-12', { free: true, tag: 'f' }), SEM('2026-09-13', { status: 'active', tag: 'a' }), base[1]]).consecGoalless === 2);
  check('um campeonato "gratuito" ou em andamento SEM gol não zera a sequência (ele nem entra na conta)', S([base[0], base[1], SEMGOLS('2026-09-20', { free: true, tag: 'f' }), base[2]]).consecGoalless === 3);
  check('quem não jogou (fora de todos os elencos) fica com 0; quem jogou mas fez gol em todos também', makeStats(players, base).computePlayerBadgeStats('Fulano').consecGoalless === 0 && makeStats(players, [COM('2026-09-09'), COM('2026-09-16'), COM('2026-09-23')]).computePlayerBadgeStats('Ana').consecGoalless === 0);
  check('a estatística é por jogador: no mesmo campeonato quem fez gol (Bia) fica com 0 e quem não fez (Ana) com 3', makeStats(players, base).computePlayerBadgeStats('Bia').consecGoalless === 0 && makeStats(players, base).computePlayerBadgeStats('Ana').consecGoalless === 3);
  check('as outras estatísticas continuam sendo calculadas (a conta nova não mexeu nelas): títulos, gols e campeonatos disputados', (() => { const s = S([COM('2026-09-09'), COM('2026-09-16'), SEM('2026-09-23')]); return s.totalGoals === 2 && s.champsPlayedCutoff === 3 && s.done_count === 3 && s.consecHatTrickChamps === 0; })());

  // ══ 3. LIGAÇÃO NO APP (aba EU e cache de todos os jogadores) ══════════════════════════════════════
  const view = html.slice(html.indexOf('function vMeuJogador()'), html.indexOf('function vSelectLeague()') > html.indexOf('function vMeuJogador()') ? html.indexOf('function vSelectLeague()') : html.length);
  check('a aba EU calcula a sequência com os campeonatos de gol (done, a partir de 08/09/2026), do mais antigo para o mais novo, e a põe nas estatísticas das conquistas', /const consecGoalless = goallessStreak\(\[\.\.\.done\]\.reverse\(\), myName\);/.test(view) && /consecHatTrickChamps, consecGoalless, hasLastPlaceChurrasco/.test(view) && /const done = doneAll\.filter\(c => c\.date >= CUTOFF\);/.test(view) && /const doneAll = st\.champs\.filter\(c => c\.status === 'completed' && !c\.freeMode\)/.test(view), view.match(/const consecGoalless.{0,80}/)?.[0]);
  check('o cálculo de todos os jogadores (cache) faz o mesmo: mesma função, mesma lista (done, mais antigo primeiro) e a devolve nas estatísticas', /const consecGoalless=goallessStreak\(\[\.\.\.done\]\.reverse\(\),name\);/.test(statsCode) && /consecHatTrickChamps,consecGoalless,hasLastPlaceChurrasco/.test(statsCode) && /const done=doneAll\.filter\(c=>c\.date>=CUT\);/.test(statsCode) && /const doneAll=\(st\.champs\|\|\[\]\)\.filter\(c=>c\.status==='completed'&&!c\.freeMode\)/.test(statsCode));
  check('as duas contas usam a MESMA função (uma só definição) e ela só é chamada nesses dois lugares', (html.match(/function goallessStreak\(/g) || []).length === 1 && (html.match(/goallessStreak\(/g) || []).length === 3, (html.match(/goallessStreak\(/g) || []).length);
  check('goleiros não recebem: o filtro do catálogo na aba EU e no cache tira as conquistas "fieldOnly" de quem é goleiro (e o catálogo marca esta como fieldOnly)', /BADGE_CATALOG\.filter\(b => !\(b\.fieldOnly && isGK\)/.test(view) && /if\(b\.fieldOnly&&isGK\) return false;/.test(html) && BADGE.fieldOnly === true, null);
  check('a conquista nunca é "impossível" nem exclusiva: sem minGoalsMatch (não depende do limite de gols por jogo), sem specialFor e sem visible (aparece bloqueada em toda liga)', !('minGoalsMatch' in BADGE) && !('specialFor' in BADGE) && !('visible' in BADGE) && !('icon' in BADGE));
  check('o emoji 🤧 e o nome não repetem os de outra conquista', (html.match(/emoji:'🤧'/g) || []).length === 1 && (html.match(/label:'Alérgico a Gol'/g) || []).length === 1);

  // ══ 4. MANUAL ═════════════════════════════════════════════════════════════════════════════════════
  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const sec13 = plainM(manual.slice(manual.indexOf('id="conquistas"'), manual.indexOf('<h3>Presença emprestada')));
  const row = (sec13.match(/🤧 Alérgico a Gol.{0,700}/) || [''])[0];
  check('manual (seção 13): a linha da conquista, na tabela "Partidas e records" da linha de campo, com o critério dos 3 campeonatos seguidos', /🤧 Alérgico a Gol 3 campeonatos seguidos sem fazer nenhum gol/.test(row) && (manual.match(/Alérgico a Gol/g) || []).length === 1 && manual.indexOf('Alérgico a Gol') > manual.indexOf('Viciado em Hat-trick') && manual.indexOf('Alérgico a Gol') < manual.indexOf('<td>😭 Gols, Glória e... Derrota!</td>'), row.slice(0, 200));
  check('manual: explica que precisa estar no elenco, que o campeonato precisa ter gols registrados, que faltar ou fazer gol zera, o corte de 08/09/2026, o plano gratuito e que goleiros não recebem', /precisa estar no elenco do campeonato/.test(row) && /precisa ter gols registrados/.test(row) && /se ninguém marcou, o campeonato não conta e a sequência recomeça/.test(row) && /faltar a um campeonato, ou fazer um gol, também zera a sequência/.test(row) && /a partir de 08\/09\/2026/.test(row) && /fora do plano gratuito/.test(row) && /Goleiros não recebem esta badge/.test(row), row);

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
