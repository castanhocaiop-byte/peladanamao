// Destaques do mês (item 42), no app: quem foi o Maior Campeão, o Artilheiro, o Rei das Artilharias, o Rei das Finais e das Artilharias de Finais, o Xodó e o Perna de Pau (votos totais), os feitos
// (Cartão Ponto, Marca Todas, Varreu o Mês), o Craque do Mês, a Hegemonia e a Dinastia; o mês que fecha, os mínimos, o empate, o goleiro; as 18 conquistas do catálogo; o card da aba Ranking, o Meu mês e o comparativo entre meses; a imagem
// do card (Feed 4:5 e Story 9:16) e a legenda. O código é o REAL do index.html (fatiado e executado com um aplicativo falso, um relógio falso e um desenho falso).
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
const escCode = slice('const esc = s =>', 'function toast(');
const keyCode = slice('const playerKey = name =>', '\n\n');
const timeCode = slice('const pad2 = n =>', '// Os números de um jogador num mês'); // pad2, localDate, monthShift, monthLabel
const closedCode = slice('const brtMonth =', '// Os meses fechados que ainda não têm resultado'); // brtMonth, rivalMonthClosed
const fmtMonthCode = slice('function fmtMonth(ym) {', 'function availableMonths()');
const voteCode = slice('const VOTE_DAYS = 3;', 'function computeAwardTotals() {'); // a votação de verdade (prazo de 3 dias, votingUsed, getChampAwards)
const finalsCode = slice('function finalsEnabled()', '// As badges do frente a frente');
const mhCode = slice('/* ── Destaques do mês (item 42)', 'function mBadgeInfo() {');
const mjConstCode = slice('const MJ_CARD = {', 'const MJ_TIERS = {');
const tierCode = slice('const MJ_TIERS = {', 'let _mjBlobs');
const mjHelpersCode = slice('function mjRoundRect(', 'function drawMjCard(');
const mjAvatarCode = slice('function mjAvatar(', '// Cartão com VÁRIAS conquistas'); // a foto redonda (ou as iniciais) do Meu mês e do comparativo
const mjStoryCode = slice('function drawMjStoryOf(', 'function drawMjStory(');
const mjDataCode = slice('// Os nomes de uma linha do card', '// Carrega uma imagem');
const captionCode = slice('// A legenda dos destaques nunca leva nome', 'async function copyMjCaption()');
const catalogText = slice('  // destaques do mês (item 42): calculadas', '];\n\n/* ── championship logic');

// ── um relógio falso POR AMBIENTE (o aparelho está no horário de Brasília, UTC−3): cada ambiente anda no seu tempo, sem atrapalhar os outros ──
const RealDate = Date;
function makeDate(clock, offset) {
  const shifted = d => new RealDate(d.getTime() + offset);
  return class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
    getFullYear() { return shifted(this).getUTCFullYear(); }
    getMonth() { return shifted(this).getUTCMonth(); }
    getDate() { return shifted(this).getUTCDate(); }
  };
}

// ── os jogadores e os campeonatos de mentira ──
const PLAYERS = ['Ana', 'Bruno', 'Carla', 'Davi', 'Edu', 'Fabi'].map(name => ({ name })).concat([{ name: 'Gil', goleiro: true }]);
const ROSTER = { azul: ['Ana', 'Bruno', 'Gil'], verde: ['Carla', 'Davi'], rosa: ['Edu', 'Fabi'] };
const g = list => list.map(player => ({ player }));
const mt = (home, away, hs, as, goals = [], phase = 'regular', extra = {}) => ({ phase, home, away, hs, as, played: true, goals: g(goals), ...extra });
const V = rows => Object.fromEntries(rows.map(([voter, pos, neg]) => [voter.toLowerCase(), { pos, neg }])); // votos: [quem vota, Bola Cheia, Bola Murcha]
function camp(id, date, o = {}) {
  const c = { id, date, status: o.status || 'completed', freeMode: !!o.free, teamRosters: o.rosters || ROSTER, matches: o.matches || [],
    champion_players: (o.champ || []).map(n => ({ name: n, weight: o.weights?.[n] ?? 1 })) };
  if (o.voting) { c.voting = { pos: o.voting.pos !== false, neg: o.voting.neg !== false, openedAt: o.openedAt || `${date}T22:00:00.000Z`, ...(o.closedAt ? { closedAt: o.closedAt } : {}) }; c.votes = o.votes || {}; }
  return c;
}
const AZUL = ['Ana', 'Bruno', 'Gil'], VERDE = ['Carla', 'Davi'], ROSA = ['Edu', 'Fabi'];
const R2 = { azul: AZUL, verde: VERDE, rosa: ['Edu'] }; // a Fabi não veio
const R4 = { azul: AZUL, verde: ['Carla'], rosa: ROSA }; // o Davi não veio
// OUTUBRO de 2026: 4 campeonatos (terças 6, 13, 20 e 27), cada um com final. Azul campeão em 1, 2 e 4; verde em 3.
const OCT = [
  camp('o1', '2026-10-06', { champ: AZUL, voting: true, votes: V([['Ana', 'Bruno', 'Fabi'], ['Gil', 'Bruno', 'Fabi'], ['Carla', 'Bruno', 'Edu'], ['Davi', 'Carla', 'Fabi']]), matches: [
    mt('azul', 'verde', 3, 1, ['Bruno', 'Bruno', 'Ana', 'Carla']), mt('verde', 'rosa', 1, 1, ['Davi', 'Edu']), mt('azul', 'rosa', 1, 0, ['Bruno']), mt('azul', 'verde', 2, 1, ['Bruno', 'Ana', 'Carla'], 'final')] }),
  camp('o2', '2026-10-13', { champ: AZUL, rosters: R2, voting: true, votes: V([['Bruno', 'Ana', 'Edu'], ['Carla', 'Ana', 'Edu'], ['Davi', 'Ana', 'Edu'], ['Gil', 'Bruno', 'Davi']]), matches: [
    mt('azul', 'rosa', 3, 0, ['Ana', 'Ana', 'Ana']), mt('verde', 'rosa', 1, 0, ['Carla']), mt('azul', 'verde', 2, 0, ['Bruno', 'Bruno']), mt('azul', 'verde', 1, 0, ['Ana'], 'final')] }),
  camp('o3', '2026-10-20', { champ: VERDE, rosters: R2, voting: true, votes: V([['Ana', 'Carla', 'Edu'], ['Bruno', 'Carla', 'Edu'], ['Gil', 'Carla', 'Edu'], ['Davi', 'Bruno', 'Edu']]), matches: [
    mt('azul', 'verde', 0, 2, ['Carla', 'Carla']), mt('azul', 'rosa', 1, 0, ['Bruno']), mt('azul', 'verde', 0, 1, ['Carla'], 'final')] }),
  camp('o4', '2026-10-27', { champ: AZUL, rosters: R4, voting: true, votes: V([['Ana', 'Bruno', 'Edu'], ['Gil', 'Bruno', 'Edu'], ['Carla', 'Bruno', 'Edu'], ['Edu', 'Bruno', 'Carla']]), matches: [
    mt('azul', 'verde', 1, 1, ['Bruno', 'Carla']), mt('azul', 'rosa', 0, 1, ['Edu']), mt('azul', 'rosa', 3, 1, ['Bruno', 'Bruno', 'Ana', 'Edu'], 'final')] }),
];
const TEAM = { azul: AZUL, verde: VERDE, rosa: ROSA };
// um mês simples, só com títulos (a final é do vencedor contra um adversário): `winners` diz quem ganhou cada campeonato ('azul', 'verde' ou 'rosa')
const simple = (month, winners, extra = {}) => winners.map((w, i) => camp(`${month}-${i}`, `${month}-${String(3 + i * 7).padStart(2, '0')}`, { champ: TEAM[w], matches: [mt(w, w === 'azul' ? 'verde' : 'azul', 1, 0, [], 'final')], ...extra }));
// um mês em que ninguém repete o feito nem esteve em todos os campeonatos: 3 campeonatos com elencos diferentes, 1 gol de cada um
const EMPTY_MONTH = [
  camp('e1', '2026-10-06', { champ: AZUL, rosters: { azul: AZUL, verde: VERDE }, matches: [mt('azul', 'verde', 1, 0, ['Ana'])] }),
  camp('e2', '2026-10-13', { champ: ['Fabi', 'Carla'], rosters: { azul: ['Ana', 'Edu'], verde: ['Fabi', 'Carla'] }, matches: [mt('azul', 'verde', 0, 1, ['Edu'])] }),
  camp('e3', '2026-10-20', { champ: ['Davi'], rosters: { azul: ['Bruno', 'Davi'], rosa: ROSA }, matches: [mt('azul', 'rosa', 1, 0, ['Bruno'])] }),
];

function makeEnv({ champs = [], players = PLAYERS, appCfg = {}, now = '2027-03-10T15:00:00.000Z', utcOffset = -3, league = 'Liga X', mhMonth } = {}) {
  const clock = { now: RealDate.parse(now) };
  const calls = { toasts: [], shared: [], renders: 0 };
  const st = { champs, players, appCfg: { hasFinais: true, votePos: true, voteNeg: true, ...appCfg }, availableLeagues: [{ id: 'L', name: league }], leagueId: 'L', mhMonth, modal: null };
  const env = { st, Date: makeDate(clock, utcOffset * 3600000), render: () => { calls.renders++; }, toast: (m, t) => { calls.toasts.push([m, t]); }, openMjShare: (k, d) => { calls.shared.push([k, d]); } };
  const names = Object.keys(env);
  const body = [escCode, keyCode, timeCode, closedCode, fmtMonthCode, voteCode, finalsCode, mjConstCode, tierCode, mjHelpersCode, mjAvatarCode, mjStoryCode, mjDataCode, captionCode, mhCode].join('\n') + `
return { getMonthHighlights, mhRankingCard, mhShareData, mhNavMonths, mhSelected, mhSetMonth, openMjDestaques, monthAwardStats, mhTimes, mhMonthsOf, mhHolderNote, mjDestaquesData, drawMjDestaquesCard,
  drawMjDestaquesStory, mjDestaquesCaption, mjNamesText, mhRows, mhBuildMonth, mhLines, monthBadgesOn, MH_LEADERS, MH_FEATS, MH_BADGE_IDS, MH_BY_BADGE, MH_FIRST, MH_MIN_CHAMPS, MH_MIN_PLAYED,
  MH_MIN_REPEAT, MH_MIN_VOTINGS, rivalMonthClosed, localDate, brtMonth, monthLabel, fmtMonth, mhNum, mhValueText, MJ_CARD, MJ_STORY, finalsEnabled, votingUsed, mhRatePick, mhPlayerMonth, mmTiles, mhCompare, MH_COMPARE, mmCard, mmNavMonths, mmSelected, mmSetMonth, mmSetMode, openMjMeuMes, openMjComparativo,
  mjMeuMesData, mjComparativoData, drawMjMeuMesCard, drawMjMeuMesStory, drawMjComparativoCard, drawMjComparativoStory, mjMeuMesCaption, mjComparativoCaption, mjComparativoVerdict, MH_MIN_GAMES, MH_MIN_GOALKEEPERS, MM_GOOD, MM_BAD, mmWhy };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, st, calls, clock };
}
function fakeCtx() {
  const log = [];
  const ctx = {
    font: '400 10px x', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic',
    measureText(t) { const px = +(/(\d+)px/.exec(this.font)?.[1] || 10); return { width: String(t).length * px * 0.55 }; },
    fillText(t, x, y) { log.push({ op: 'text', t: String(t), x, y, font: this.font, fill: this.fillStyle, align: this.textAlign }); },
    fillRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, arc() {}, clip() {},
    stroke() { log.push({ op: 'stroke', color: this.strokeStyle }); }, fill() { log.push({ op: 'fill', fill: this.fillStyle }); },
    createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; },
    drawImage(img, ...a) { log.push({ op: 'img', img, a }); }, save() { log.push({ op: 'save' }); }, restore() { log.push({ op: 'restore' }); },
    translate(x, y) { log.push({ op: 'translate', x, y }); }, scale(x, y) { log.push({ op: 'scale', x, y }); },
  };
  return { ctx, log };
}
const texts = log => log.filter(l => l.op === 'text').map(l => l.t);
const paintTmp = data => { const f = fakeCtx(); makeEnv().api.drawMjDestaquesCard(f.ctx, data, null, null); return f.log; };
const names = (mo, id) => mo.leaders[id]?.names;
const J = JSON.stringify;
const stripVoting = c => { const { voting, votes, ...rest } = c; return rest; };

(() => {
  // ══ 1. AS REGRAS (constantes) E O MÊS VÁLIDO ═══════════════════════════════════════════════════════
  const A = makeEnv({ champs: OCT }).api;
  check('as regras: vale a partir de outubro/2026, mês com 3 campeonatos, jogador com 2, destaque que repete 2 vezes, 2 votações encerradas', A.MH_FIRST === '2026-10' && A.MH_MIN_CHAMPS === 3 && A.MH_MIN_PLAYED === 2 && A.MH_MIN_REPEAT === 2 && A.MH_MIN_VOTINGS === 2);
  const hs = A.getMonthHighlights();
  check('outubro vale (4 campeonatos concluídos, a partir de outubro) e já está fechado em 10/03/2027', hs.byMonth['2026-10'].valid === true && hs.byMonth['2026-10'].nChamps === 4 && hs.byMonth['2026-10'].closed === true, hs.byMonth['2026-10']);
  const filler = (month, n) => Array.from({ length: n }, (_, i) => camp(`${month}-${i}`, `${month}-${String(2 + i * 6).padStart(2, '0')}`, { champ: AZUL, matches: [mt('azul', 'verde', 1, 0, ['Ana', 'Ana'], 'final')] }));
  const B = makeEnv({ champs: [...filler('2026-09', 5), ...filler('2026-11', 2), ...filler('2026-12', 3)] }).api.getMonthHighlights();
  check('setembro de 2026 (antes de outubro) não vale, mesmo com 5 campeonatos; novembro com 2 não vale; dezembro com 3 vale', B.byMonth['2026-09'].valid === false && B.byMonth['2026-11'].valid === false && B.byMonth['2026-12'].valid === true && !Object.keys(B.byMonth['2026-09'].leaders).length, J([B.byMonth['2026-09'].valid, B.byMonth['2026-11'].valid, B.byMonth['2026-12'].valid]));
  check('só entram campeonatos CONCLUÍDOS e FORA do plano gratuito: em andamento, agendado e freeMode ficam de fora da conta do mês', makeEnv({ champs: [...filler('2026-10', 3), camp('x1', '2026-10-30', { status: 'active' }), camp('x2', '2026-10-31', { status: 'preset' }), camp('x3', '2026-10-29', { free: true })] }).api.getMonthHighlights().byMonth['2026-10'].nChamps === 3);
  check('campeonato sem data (ou com data estragada) não derruba o cálculo', (() => { try { return makeEnv({ champs: [...OCT, { id: 'q', status: 'completed' }, { id: 'r', status: 'completed', date: 'xx' }] }).api.getMonthHighlights().byMonth['2026-10'].nChamps === 4; } catch (e) { return false; } })());

  // ══ 2. OUTUBRO INTEIRO: QUEM LEVOU O QUÊ ═══════════════════════════════════════════════════════════
  const oct = hs.byMonth['2026-10'];
  check('Maior Campeão do Mês: Ana, Bruno e Gil empatam com 3 títulos (azul foi campeão em 3 dos 4); o goleiro também leva (título não é só de linha)', J(names(oct, 'campeao')) === '["Ana","Bruno","Gil"]' && oct.leaders.campeao.value === 3, oct.leaders.campeao);
  check('Artilheiro do Mês: o Bruno, com 10 gols (a Ana e a Carla fizeram 7)', J(names(oct, 'artilheiro')) === '["Bruno"]' && oct.leaders.artilheiro.value === 10, oct.leaders.artilheiro);
  check('Rei das Artilharias do Mês: o Bruno foi o artilheiro de 2 dos 4 campeonatos (a Ana e a Carla de 1 cada)', J(names(oct, 'rei_art')) === '["Bruno"]' && oct.leaders.rei_art.value === 2, oct.leaders.rei_art);
  check('Rei das Artilharias de Finais do Mês: Ana, Bruno e Carla empatam com 2 finais em que foram artilheiros', J(names(oct, 'rei_art_final')) === '["Ana","Bruno","Carla"]' && oct.leaders.rei_art_final.value === 2, oct.leaders.rei_art_final);
  check('Rei das Finais do Mês: Ana, Bruno e Gil jogaram as 4 finais (a Carla e o Davi 3, o Edu e a Fabi 1)', J(names(oct, 'rei_finais')) === '["Ana","Bruno","Gil"]' && oct.leaders.rei_finais.value === 4 && oct.nFinals === 4, [oct.leaders.rei_finais, oct.nFinals]);
  check('Xodó do Mês: o Bruno, com 9 votos de Bola Cheia somados nos 4 campeonatos (a Carla 4, a Ana 3)', J(names(oct, 'xodo')) === '["Bruno"]' && oct.leaders.xodo.value === 9, oct.leaders.xodo);
  check('Perna de Pau do Mês: o Edu, com 11 votos de Bola Murcha somados (a Fabi 3)', J(names(oct, 'perna_pau')) === '["Edu"]' && oct.leaders.perna_pau.value === 11, oct.leaders.perna_pau);
  check('valem os VOTOS TOTAIS e não as vezes eleito: o Bruno somou 9 votos e a Carla 4, a Ana 3; o Edu somou 11 de Bola Murcha, a Fabi 3, o Davi 1 e a Carla 1', (() => { const r = oct.rows; return r.Bruno.pos === 9 && r.Carla.pos === 4 && r.Ana.pos === 3 && r.Edu.neg === 11 && r.Fabi.neg === 3 && r.Davi.neg === 1 && r.Carla.neg === 1; })(), oct.rows);
  check('Cartão Ponto: quem esteve nos 4 campeonatos (Ana, Bruno, Carla, Edu e Gil; o Davi faltou ao 4º e a Fabi ao 2º e 3º)', J(oct.feats.cartao_ponto) === '["Ana","Bruno","Carla","Edu","Gil"]', oct.feats.cartao_ponto);
  check('Marca Todas: Bruno e Carla fizeram gol nos 4 campeonatos que jogaram (a Ana ficou sem gol no 3º)', J(oct.feats.marca_todas) === '["Bruno","Carla"]', oct.feats.marca_todas);
  check('Varreu o Mês: ninguém (azul perdeu o 3º campeonato)', oct.feats.varreu === undefined, oct.feats);
  check('Craque do Mês: o Bruno, que levou 7 dos destaques (a Ana 4, o Gil 3, a Carla 1); o Perna de Pau, o Pé Frio, a Pipoca e os feitos não entram na conta', J(oct.craque) === '{"names":["Bruno"],"value":7}', oct.craque);
  check('os números de cada jogador no mês: Bruno jogou 4, tem 3 títulos, 10 gols, 4 finais e 2 artilharias; o Davi jogou 3, a Fabi 2 e o Edu fez 1 final', (() => { const r = oct.rows; return r.Bruno.played === 4 && r.Bruno.titles === 3 && r.Bruno.goals === 10 && r.Bruno.finals === 4 && r.Bruno.art === 2 && r.Fabi.played === 2 && r.Davi.played === 3 && r.Edu.finals === 1; })(), oct.rows);

  // ══ 3. O MÊS QUE FECHA ═════════════════════════════════════════════════════════════════════════════
  const open = makeEnv({ champs: OCT, now: '2026-10-29T15:00:00.000Z' }).api;
  const mo = open.getMonthHighlights().byMonth['2026-10'];
  check('em 29/10 outubro vale mas NÃO fechou: o card mostra o parcial e ninguém ganha a conquista ainda', mo.valid === true && mo.closed === false && J(mo.leaders.campeao.names) === '["Ana","Bruno","Gil"]' && !Object.keys(open.getMonthHighlights().byPlayer).length, [mo.closed, open.getMonthHighlights().byPlayer]);
  const at = (now, champs = OCT) => makeEnv({ champs, now }).api.getMonthHighlights().byMonth['2026-10'].closed;
  check('fecha só DEPOIS do último dia, no horário do aparelho (UTC−3): 31/10 às 23:59 ainda não; 1º/11 à 00:00 sim', at('2026-11-01T02:59:59.000Z') === false && at('2026-11-01T03:00:00.000Z') === true);
  const late = OCT.map(c => (c.id === 'o4' ? { ...c, voting: { ...c.voting, openedAt: '2026-10-30T12:00:00.000Z' } } : c));
  check('…e também espera as votações: com a votação do campeonato de 27/10 aberta até 02/11, outubro segue aberto em 1º/11 e fecha depois', at('2026-11-01T12:00:00.000Z', late) === false && at('2026-11-03T12:00:00.000Z', late) === true);
  check('enquanto uma votação do mês está aberta, os votos dela não entram (getChampAwards só conta votação encerrada)', (() => { const m = makeEnv({ champs: late, now: '2026-11-01T12:00:00.000Z' }).api.getMonthHighlights().byMonth['2026-10']; return m.rows.Bruno.pos === 5 && m.nVot.pos === 3; })());
  check('um campeonato do mês ainda em andamento também mantém o mês aberto', at('2027-03-10T15:00:00.000Z', [...OCT, camp('ativo', '2026-10-31', { status: 'active' })]) === false);

  // ══ 4. HEGEMONIA, DINASTIA E VARREU O MÊS ══════════════════════════════════════════════════════════
  const run = extra => makeEnv({ champs: [...OCT, ...extra] }).api.getMonthHighlights();
  const NOV = simple('2026-11', ['azul', 'azul', 'azul']), DEC = simple('2026-12', ['azul', 'azul', 'verde']), JAN = simple('2027-01', ['azul', 'azul']), FEV = simple('2027-02', ['azul', 'azul', 'azul']);
  const h2 = run(NOV);
  check('Hegemonia: Maior Campeão do Mês em outubro e em novembro (2 seguidos) para Ana, Bruno e Gil; ninguém tem a Dinastia ainda', ['Ana', 'Bruno', 'Gil'].every(n => h2.byPlayer[n].hegemonia === true && h2.byPlayer[n].dinastia === false) && !h2.byPlayer.Carla?.hegemonia, J(h2.byPlayer.Ana));
  const h3 = run([...NOV, ...DEC]);
  check('Dinastia: com dezembro (azul ganhou 2 de 3) são 3 meses seguidos: Hegemonia e Dinastia para Ana, Bruno e Gil', ['Ana', 'Bruno', 'Gil'].every(n => h3.byPlayer[n].hegemonia && h3.byPlayer[n].dinastia) && h3.byMonth['2026-12'].leaders.campeao.value === 2, J(h3.byPlayer.Bruno));
  check('o Maior Campeão de cada mês entra no histórico do jogador com o mês: Bruno ×3 (out, nov, dez)', J(h3.byPlayer.Bruno.months.campeao) === '["2026-10","2026-11","2026-12"]' && h3.byPlayer.Bruno.n.campeao === 3 && h3.byPlayer.Carla.n.campeao === undefined, h3.byPlayer.Bruno);
  const h4 = run([...NOV, ...DEC, ...JAN, ...FEV]);
  check('mês com menos de 3 campeonatos (janeiro) não conta nem quebra a sequência: com fevereiro são 4 meses válidos seguidos', h4.byMonth['2027-01'].valid === false && h4.byPlayer.Ana.n.campeao === 4 && h4.byPlayer.Ana.dinastia === true, [h4.byMonth['2027-01'].valid, h4.byPlayer.Ana.n]);
  const quebra = run(simple('2026-11', ['verde', 'verde', 'verde']));
  check('um mês válido em que OUTRO time foi o maior campeão quebra a sequência: sem Hegemonia para ninguém', Object.values(quebra.byPlayer).every(p => !p.hegemonia && !p.dinastia) && J(quebra.byMonth['2026-11'].leaders.campeao.names) === '["Carla","Davi"]', quebra.byMonth['2026-11'].leaders);
  const nobody = makeEnv({ champs: [...OCT, ...simple('2026-11', ['azul', 'verde', 'rosa']), ...simple('2026-12', ['azul', 'azul', 'azul'])] }).api.getMonthHighlights();
  check('um mês válido em que NINGUÉM chegou a 2 títulos (3 campeões diferentes) também quebra: outubro e dezembro não viram Hegemonia', !nobody.byMonth['2026-11'].leaders.campeao && !nobody.byPlayer.Ana.hegemonia && nobody.byPlayer.Ana.n.campeao === 2, [nobody.byMonth['2026-11'].leaders, nobody.byPlayer.Ana]);
  const sweep = run(NOV);
  check('Varreu o Mês: em novembro o azul ganhou os 3 campeonatos e Ana, Bruno e Gil levam o feito; o Maior Campeão de novembro tem 3 títulos', J(sweep.byMonth['2026-11'].feats.varreu) === '["Ana","Bruno","Gil"]' && sweep.byMonth['2026-11'].leaders.campeao.value === 3, sweep.byMonth['2026-11'].feats);
  check('meio título (peso 0,5) soma 0,5 no Maior Campeão e NÃO conta para o Varreu o Mês (só título inteiro)', (() => {
    const meio = simple('2026-11', ['azul', 'azul', 'azul']).map((c, i) => (i === 0 ? { ...c, champion_players: c.champion_players.map(p => (p.name === 'Ana' ? { ...p, weight: 0.5 } : p)) } : c));
    const m = makeEnv({ champs: meio }).api.getMonthHighlights().byMonth['2026-11'];
    return m.rows.Ana.titles === 2.5 && J(m.feats.varreu) === '["Bruno","Gil"]' && J(m.leaders.campeao.names) === '["Bruno","Gil"]';
  })());
  const tie = makeEnv({ champs: simple('2026-10', ['azul', 'azul', 'verde']), appCfg: { votePos: false, voteNeg: false } }).api.getMonthHighlights().byMonth['2026-10'];
  check('Craque do Mês com empate: Ana, Bruno e Gil levam 2 destaques (Maior Campeão e Rei das Finais) e a Carla e o Davi só 1', J(tie.craque) === '{"names":["Ana","Bruno","Gil"],"value":2}', tie.craque);
  const one = makeEnv({ champs: simple('2026-10', ['azul', 'azul', 'verde']), appCfg: { hasFinais: false, votePos: false, voteNeg: false } }).api.getMonthHighlights().byMonth['2026-10'];
  check('Craque do Mês precisa de pelo menos 2 destaques: com um destaque só por pessoa (final desligada) ninguém é o Craque', J(Object.keys(one.leaders)) === '["campeao"]' && one.craque === null, [one.leaders, one.craque]);

  // ══ 5. GOLEIRO, MÍNIMOS E CONFIGURAÇÕES ════════════════════════════════════════════════════════════
  const GKM = [1, 2, 3].map(i => camp(`k${i}`, `2026-10-${String(5 + i * 7).padStart(2, '0')}`, { champ: AZUL, matches: [mt('azul', 'verde', 4, 0, ['Gil', 'Gil', 'Gil', 'Ana']), mt('azul', 'verde', 1, 0, ['Gil'], 'final')] }));
  const gk = makeEnv({ champs: GKM }).api.getMonthHighlights().byMonth['2026-10'];
  check('goleiro que fez mais gols NÃO leva Artilheiro, Rei das Artilharias nem Marca Todas (conquistas de linha); a Ana, que fez 3 gols, leva o Artilheiro e o Marca Todas', gk.rows.Gil.goals === 12 && J(names(gk, 'artilheiro')) === '["Ana"]' && gk.leaders.artilheiro.value === 3 && gk.rows.Gil.art === 3 && !names(gk, 'rei_art') && J(gk.feats.marca_todas) === '["Ana"]', [gk.leaders, gk.feats]);
  check('…mas o goleiro leva o que não é de linha: Maior Campeão, Rei das Finais e Cartão Ponto', names(gk, 'campeao').includes('Gil') && names(gk, 'rei_finais').includes('Gil') && gk.feats.cartao_ponto.includes('Gil'), [gk.leaders, gk.feats]);
  const mins = makeEnv({ champs: OCT.slice(0, 2) }).api.getMonthHighlights();
  check('mês com 2 campeonatos concluídos não vale: nenhum destaque e nenhuma conquista', mins.byMonth['2026-10'].valid === false && !Object.keys(mins.byPlayer).length);
  const empty = makeEnv({ champs: EMPTY_MONTH }).api.getMonthHighlights().byMonth['2026-10'];
  check('o destaque precisa REPETIR o feito (2 ou mais) e o feito de presença exige estar em todos: mês com um campeão por vez e 1 gol de cada não tem destaque nem feito nem Craque', empty.valid === true && !Object.keys(empty.leaders).length && !Object.keys(empty.feats).length && empty.craque === null, [empty.leaders, empty.feats]);
  const SOLO = [
    camp('s1', '2026-10-06', { champ: ['Edu', 'Hugo'], rosters: { azul: AZUL, verde: VERDE, rosa: ['Edu', 'Hugo'] }, matches: [mt('rosa', 'azul', 5, 0, ['Hugo', 'Hugo', 'Hugo', 'Hugo', 'Hugo'])] }),
    camp('s2', '2026-10-13', { champ: AZUL, matches: [mt('azul', 'verde', 1, 0, ['Ana'])] }),
    camp('s3', '2026-10-20', { champ: AZUL, matches: [mt('azul', 'verde', 1, 0, ['Ana'])] }),
  ];
  const solo = makeEnv({ champs: SOLO }).api.getMonthHighlights().byMonth['2026-10'];
  check('o jogador precisa ter jogado pelo menos 2 campeonatos do mês: o Hugo jogou 1 e fez 5 gols, mas o Artilheiro é a Ana (2 gols); o Hugo não leva nada', solo.rows.Hugo.played === 1 && solo.rows.Hugo.goals === 5 && J(names(solo, 'artilheiro')) === '["Ana"]' && solo.leaders.artilheiro.value === 2 && !Object.values(solo.leaders).some(l => l.names.includes('Hugo')) && !Object.values(solo.feats).some(l => l.includes('Hugo')), [solo.leaders, solo.feats]);
  const fin2 = makeEnv({ champs: OCT.map(c => ({ ...c, matches: c.matches.map(m => (m.phase === 'final' && c.id !== 'o1' && c.id !== 'o2' ? { ...m, phase: 'regular' } : m)) })) }).api.getMonthHighlights().byMonth['2026-10'];
  check('Rei das Finais e Rei das Artilharias de Finais exigem 3 finais no mês: com só 2 finais não existem', fin2.nFinals === 2 && !fin2.leaders.rei_finais && !fin2.leaders.rei_art_final);
  const noFin = makeEnv({ champs: OCT, appCfg: { hasFinais: false } }).api.getMonthHighlights().byMonth['2026-10'];
  check('liga sem final: as duas de final somem (os outros destaques continuam)', noFin.nFinals === 0 && !noFin.leaders.rei_finais && !noFin.leaders.rei_art_final && !!noFin.leaders.campeao && !!noFin.leaders.artilheiro);
  check('os votos entram quando a liga usou a votação (campeonatos com votação), mesmo com a opção desligada hoje', !!makeEnv({ champs: OCT, appCfg: { votePos: false, voteNeg: false } }).api.getMonthHighlights().byMonth['2026-10'].leaders.xodo);
  const noVote = makeEnv({ champs: OCT.map(stripVoting), appCfg: { votePos: false, voteNeg: false } }).api.getMonthHighlights().byMonth['2026-10'];
  check('liga que nunca votou: sem Xodó nem Perna de Pau', !noVote.leaders.xodo && !noVote.leaders.perna_pau && noVote.nVot.pos === 0);
  const two = makeEnv({ champs: OCT.map((c, i) => (i < 2 ? c : stripVoting(c))) }).api.getMonthHighlights().byMonth['2026-10'];
  const oneV = makeEnv({ champs: OCT.map((c, i) => (i < 1 ? c : stripVoting(c))) }).api.getMonthHighlights().byMonth['2026-10'];
  check('com 2 votações encerradas no mês o Xodó ainda vale (Bruno, 4 votos); com só 1 não vale nem o Perna de Pau', two.nVot.pos === 2 && J(names(two, 'xodo')) === '["Bruno"]' && two.leaders.xodo.value === 4 && oneV.nVot.pos === 1 && !oneV.leaders.xodo && !oneV.leaders.perna_pau, [two.leaders.xodo, oneV.leaders]);
  const onlyPos = makeEnv({ champs: OCT.map(c => ({ ...c, voting: { ...c.voting, neg: false } })) }).api.getMonthHighlights().byMonth['2026-10'];
  check('votação só de Bola Cheia: o Xodó existe e o Perna de Pau não', !!onlyPos.leaders.xodo && !onlyPos.leaders.perna_pau && onlyPos.nVot.neg === 0);

  // gols da final decidida nos pênaltis: valem os gols do tempo normal e da prorrogação (finalGoals), nunca os pênaltis (que ficam em goals)
  const PEN = [6, 13, 20].map((d, i) => camp('p' + i, '2026-10-' + String(d).padStart(2, '0'), { champ: AZUL, matches: [mt('azul', 'verde', 1, 1, ['Ana', 'Ana', 'Ana', 'Ana'], 'final', { finalGoals: g(['Bruno', 'Bruno']) })] }));
  const pen = makeEnv({ champs: PEN }).api.getMonthHighlights().byMonth['2026-10'];
  check('final nos pênaltis: os gols da final são os de finalGoals (Bruno 2 por final = 6) e os pênaltis do goals não contam (Ana 0); o artilheiro da final é o Bruno nas 3', pen.rows.Bruno.goals === 6 && pen.rows.Ana.goals === 0 && J(names(pen, 'artilheiro')) === '["Bruno"]' && pen.rows.Bruno.artFin === 3 && J(names(pen, 'rei_art_final')) === '["Bruno"]' && pen.leaders.rei_art_final.value === 3, [pen.rows.Bruno, pen.rows.Ana]);
  check('jogo que não foi disputado (played falso) não conta gol nem final', (() => { const x = PEN.map((c, i) => (i === 0 ? { ...c, matches: c.matches.map(m => ({ ...m, played: false })) } : c)); const m = makeEnv({ champs: x }).api.getMonthHighlights().byMonth['2026-10']; return m.rows.Bruno.goals === 4 && m.nFinals === 2 && m.rows.Bruno.finals === 2; })());

  // quem jogou exatamente 2 campeonatos concorre (o mínimo é 2), mas o Marca Todas exige 3
  const DOIS = [
    camp('d1', '2026-10-06', { champ: AZUL, rosters: { azul: AZUL, verde: VERDE, rosa: ['Edu'] }, matches: [mt('azul', 'verde', 1, 0, ['Ana'])] }),
    camp('d2', '2026-10-13', { champ: AZUL, rosters: { azul: AZUL, verde: VERDE }, matches: [mt('azul', 'verde', 1, 0, ['Ana'])] }),
    camp('d3', '2026-10-20', { champ: AZUL, rosters: { azul: AZUL, verde: VERDE, rosa: ['Edu'] }, matches: [mt('azul', 'rosa', 0, 4, ['Edu', 'Edu', 'Edu']), mt('azul', 'verde', 1, 0, ['Ana'])] }),
  ];
  const dois = makeEnv({ champs: DOIS }).api.getMonthHighlights().byMonth['2026-10'];
  check('o Edu jogou exatamente 2 campeonatos do mês e fez 3 gols em 1: concorre e é o Artilheiro do Mês (a Ana fez 3 também: empatam)', dois.rows.Edu.played === 2 && J(names(dois, 'artilheiro')) === '["Ana","Edu"]' && dois.leaders.artilheiro.value === 3, [dois.rows.Edu, dois.leaders]);
  check('Marca Todas exige 3 campeonatos: o Edu fez gol nos 2 que jogou e NÃO leva; a Ana fez gol nos 3 e leva', J(dois.feats.marca_todas) === '["Ana"]' && dois.rows.Edu.scoredIn === 1, [dois.feats.marca_todas, dois.rows.Edu]);
  const sem2 = [1, 2, 3].map(i => camp('m' + i, '2026-10-' + String(5 + i * 7).padStart(2, '0'), { champ: i < 3 ? ['Edu', 'Fabi'] : AZUL, rosters: { azul: AZUL, verde: VERDE, rosa: ROSA }, matches: [mt('rosa', 'azul', 1, 0, ['Edu'], 'regular')] }));
  const marca2 = makeEnv({ champs: sem2.map((c, i) => (i === 2 ? { ...c, teamRosters: { azul: AZUL, verde: VERDE, rosa: [] } } : c)) }).api.getMonthHighlights().byMonth['2026-10'];
  check('Marca Todas com 2 campeonatos jogados e gol nos dois não vale (Edu jogou o 1º e o 2º, fez gol neles e faltou ao 3º)', marca2.rows.Edu.played === 2 && marca2.rows.Edu.scoredIn === 2 && !(marca2.feats.marca_todas || []).includes('Edu'), [marca2.rows.Edu, marca2.feats]);

  // a Perna de Pau (negativa) não entra na conta do Craque: o Edu é o Perna de Pau e um dos maiores campeões (só 1 destaque positivo): sem Craque
  const NEG = simple('2026-10', ['rosa', 'rosa', 'azul'], { voting: { pos: false }, votes: V([['Ana', undefined, 'Edu'], ['Bruno', undefined, 'Edu'], ['Carla', undefined, 'Edu']]) });
  const neg = makeEnv({ champs: NEG, appCfg: { hasFinais: false, votePos: false, voteNeg: true } }).api.getMonthHighlights().byMonth['2026-10'];
  check('Craque do Mês: o Perna de Pau não conta destaque (Edu é o Perna de Pau e Maior Campeão, só 1 destaque que conta: sem Craque)', J(names(neg, 'perna_pau')) === '["Edu"]' && J(names(neg, 'campeao')) === '["Edu","Fabi"]' && neg.craque === null && Object.keys(neg.leaders).length === 2, [neg.leaders, neg.craque]);

  // o mês virar sozinho (sem nenhuma votação) refaz a conta: só a data da chave muda
  check('cache: com campeonatos sem votação, só o mês virar (o relógio andar) já refaz a conta e a conquista aparece', (() => {
    const e = makeEnv({ champs: simple('2026-10', ['azul', 'azul', 'azul']), now: '2026-10-29T15:00:00.000Z' }); const a = e.api.getMonthHighlights();
    e.clock.now = RealDate.parse('2026-11-05T15:00:00.000Z'); const b = e.api.getMonthHighlights();
    return a.byMonth['2026-10'].closed === false && !Object.keys(a.byPlayer).length && b.byMonth['2026-10'].closed === true && b.byPlayer.Ana.n.campeao === 1;
  })());

  // ══ 6. EMPATE, ORDEM E NOMES ═══════════════════════════════════════════════════════════════════════
  const accents = [1, 2, 3].map(i => camp(`a${i}`, `2026-10-${String(5 + i * 7).padStart(2, '0')}`, { champ: ['Éder', 'Zé', 'Ana'], rosters: { azul: ['Éder', 'Zé', 'Ana'], verde: ['Carla'] }, matches: [mt('azul', 'verde', 1, 0, [], 'final')] }));
  const ac = makeEnv({ champs: accents, players: [] }).api.getMonthHighlights().byMonth['2026-10'];
  check('os nomes empatados saem em ordem alfabética do português (Ana, Éder, Zé), mesmo sem a lista de jogadores', J(names(ac, 'campeao')) === '["Ana","Éder","Zé"]', names(ac, 'campeao'));

  // ══ 7. POR JOGADOR E O CACHE ═══════════════════════════════════════════════════════════════════════
  const ms = A.monthAwardStats('Bruno').mh;
  check('o que cada jogador leva para as conquistas (monthAwardStats): Bruno tem 10 tipos de destaque, cada um 1 vez, e os meses', Object.keys(ms.n).length === 10 && Object.values(ms.n).every(v => v === 1) && J(ms.months.xodo) === '["2026-10"]' && ms.hegemonia === false, ms);
  check('jogador sem nada: monthAwardStats devolve o vazio (sem quebrar) e mhTimes dá 0', Object.keys(A.monthAwardStats('Ninguém').mh.n).length === 0 && A.mhTimes('Ninguém', 'mes_campeao') === 0 && A.mhTimes('Bruno', 'hat_trick') === 0);
  check('mhTimes e mhMonthsOf por conquista do catálogo: Bruno 1 vez Maior Campeão (outubro) e nenhuma Perna de Pau; o Edu 1 Perna de Pau', A.mhTimes('Bruno', 'mes_campeao') === 1 && J(A.mhMonthsOf('Bruno', 'mes_campeao')) === '["2026-10"]' && A.mhTimes('Bruno', 'mes_perna_pau') === 0 && A.mhTimes('Edu', 'mes_perna_pau') === 1);
  check('cache: a segunda chamada devolve o MESMO resultado; trocar a lista de campeonatos (novo array) refaz a conta', (() => {
    const e = makeEnv({ champs: OCT }); const a = e.api.getMonthHighlights(), b = e.api.getMonthHighlights();
    e.st.champs = [...OCT, ...NOV]; const c = e.api.getMonthHighlights();
    return a === b && c !== a && !!c.byMonth['2026-11'];
  })());
  check('cache: mudar a lista de jogadores (a Ana vira goleira) ou a configuração (final desligada) refaz a conta', (() => {
    const e = makeEnv({ champs: OCT }); const a = e.api.getMonthHighlights();
    e.st.players = PLAYERS.map(p => (p.name === 'Ana' ? { ...p, goleiro: true } : p)); const b = e.api.getMonthHighlights();
    e.st.appCfg = { ...e.st.appCfg, hasFinais: false }; const c = e.api.getMonthHighlights();
    return b !== a && J(names(a.byMonth['2026-10'], 'rei_art_final')) === '["Ana","Bruno","Carla"]' && J(names(b.byMonth['2026-10'], 'rei_art_final')) === '["Bruno","Carla"]' && c !== b && !c.byMonth['2026-10'].leaders.rei_finais;
  })());
  check('cache: o relógio andar para o mês seguinte (outubro fecha) refaz a conta', (() => {
    const e = makeEnv({ champs: OCT, now: '2026-10-29T15:00:00.000Z' }); const a = e.api.getMonthHighlights();
    e.clock.now = RealDate.parse('2026-11-05T15:00:00.000Z'); const b = e.api.getMonthHighlights();
    return a.byMonth['2026-10'].closed === false && b.byMonth['2026-10'].closed === true && b.byPlayer.Bruno.n.campeao === 1;
  })());
  check('cache: uma votação que fecha (o prazo passa sem a lista de campeonatos mudar) refaz a conta e os votos passam a contar', (() => {
    const e = makeEnv({ champs: late, now: '2026-11-01T12:00:00.000Z' }); const a = e.api.getMonthHighlights();
    e.clock.now = RealDate.parse('2026-11-03T12:00:00.000Z'); const b = e.api.getMonthHighlights();
    return a.byMonth['2026-10'].rows.Bruno.pos === 5 && b.byMonth['2026-10'].rows.Bruno.pos === 9 && b.byMonth['2026-10'].closed === true;
  })());

  // ══ 8. AS 18 CONQUISTAS DO CATÁLOGO ════════════════════════════════════════════════════════════════
  const makeCat = (appCfg = {}, champs = OCT) => { const e = makeEnv({ champs, appCfg }); return new Function('monthBadgesOn', 'finalsEnabled', 'votingUsed', 'return [' + catalogText + ']')(e.api.monthBadgesOn, e.api.finalsEnabled, e.api.votingUsed); };
  const CAT = makeCat();
  check('18 conquistas novas no catálogo, com estes códigos, na ordem dos blocos, e iguais a MH_BADGE_IDS (que também bate com as definições)', CAT.length === 18 && J(CAT.map(b => b.id)) === J(A.MH_BADGE_IDS) && J(CAT.map(b => b.id)) === '["mes_campeao","mes_artilheiro","mes_rei_art","mes_rei_art_final","mes_rei_finais","mes_xodo","mes_perna_pau","mes_cartao_ponto","mes_marca_todas","mes_varreu","mes_pe_quente","mes_pe_frio","mes_invicto","mes_paredao","mes_pipoca","mes_craque","mes_hegemonia","mes_dinastia"]' && J([...A.MH_LEADERS.map(d => d.badge), ...A.MH_FEATS.map(d => d.badge), 'mes_craque', 'mes_hegemonia', 'mes_dinastia'].sort()) === J([...A.MH_BADGE_IDS].sort()), CAT.map(b => b.id));
  check('os nomes que o dono aprovou', J(CAT.map(b => b.label)) === '["Maior Campeão do Mês","Artilheiro do Mês","Rei das Artilharias do Mês","Rei das Artilharias de Finais do Mês","Rei das Finais do Mês","Xodó do Mês","Perna de Pau do Mês","Cartão Ponto","Marca Todas","Varreu o Mês","Pé Quente do Mês","Pé Frio do Mês","Invicto do Mês","Paredão do Mês","Pipoca do Mês","Craque do Mês","Hegemonia","Dinastia"]', CAT.map(b => b.label));
  check('as 4 de gol são só de jogador de linha (fieldOnly), o Paredão do Mês é só de goleiro (gkOnly) e as outras 13 valem para os dois', J(CAT.filter(b => b.fieldOnly).map(b => b.id)) === '["mes_artilheiro","mes_rei_art","mes_rei_art_final","mes_marca_todas"]' && J(CAT.filter(b => b.gkOnly).map(b => b.id)) === '["mes_paredao"]' && CAT.filter(b => !b.fieldOnly && !b.gkOnly).length === 13);
  const by = Object.fromEntries(CAT.map(b => [b.id, b]));
  const stats = n => A.monthAwardStats(n);
  const has = n => CAT.filter(b => b.check(stats(n))).map(b => b.id);
  check('Bruno tem 10 das 18 conquistas (todas menos Perna de Pau, Varreu, Pé Frio, Invicto, Paredão, Pipoca, Hegemonia e Dinastia)', J(has('Bruno')) === '["mes_campeao","mes_artilheiro","mes_rei_art","mes_rei_art_final","mes_rei_finais","mes_xodo","mes_cartao_ponto","mes_marca_todas","mes_pe_quente","mes_craque"]', has('Bruno'));
  check('Edu tem o Perna de Pau do Mês, o Cartão Ponto e o Pé Frio do Mês; a Fabi não tem nenhuma', J(has('Edu')) === '["mes_perna_pau","mes_cartao_ponto","mes_pe_frio"]' && has('Fabi').length === 0, [has('Edu'), has('Fabi')]);
  check('Hegemonia e Dinastia só com a sequência (outubro sozinho não dá)', !by.mes_hegemonia.check(stats('Bruno')) && !by.mes_dinastia.check(stats('Bruno')) && by.mes_hegemonia.check({ mh: { n: {}, hegemonia: true } }) && by.mes_dinastia.check({ mh: { n: {}, dinastia: true } }));
  check('as conquistas não quebram com estatísticas sem o campo do mês (testes e telas antigas)', CAT.every(b => b.check({}) === false));
  const vis = cfg => makeCat(cfg).filter(b => b.visible()).map(b => b.id);
  check('visíveis com tudo ligado: as 18', vis({}).length === 18);
  check('o admin desligou os destaques do mês (monthBadges: false): as 18 somem', vis({ monthBadges: false }).length === 0);
  check('liga sem final: somem o Rei das Artilharias de Finais, o Rei das Finais e a Pipoca (15 visíveis)', vis({ hasFinais: false }).length === 15 && !vis({ hasFinais: false }).includes('mes_pipoca') && !vis({ hasFinais: false }).includes('mes_rei_finais') && !vis({ hasFinais: false }).includes('mes_rei_art_final'));
  check('sem votação de Bola Cheia some o Xodó; sem a de Bola Murcha some o Perna de Pau (liga que nunca votou)', (() => { const a = makeCat({ votePos: false, voteNeg: true }, []).filter(b => b.visible()).map(b => b.id), b = makeCat({ votePos: true, voteNeg: false }, []).filter(x => x.visible()).map(x => x.id); return !a.includes('mes_xodo') && a.includes('mes_perna_pau') && b.includes('mes_xodo') && !b.includes('mes_perna_pau'); })());
  check('a descrição de cada conquista diz o mínimo (pelo menos 2, pelo menos 5 jogos, mês com 3 ou mais, ou meses seguidos)', CAT.every(b => /pelo menos [25]|3 ou mais|seguidos/.test(b.desc)), CAT.map(b => b.desc));

  // ══ 9. O CARD DA ABA RANKING ═══════════════════════════════════════════════════════════════════════
  const card = makeEnv({ champs: [...OCT, ...NOV], now: '2026-11-20T15:00:00.000Z' });
  const c0 = card.api.mhRankingCard();
  check('o card abre no mês mais novo que vale (novembro, em andamento = PARCIAL), com a seta para o mês anterior, o botão de compartilhar e a mensagem do mês em andamento', /Destaques de novembro/.test(c0) && /PARCIAL/.test(c0) && /openMjDestaques\('2026-11'\)/.test(c0) && /mhSetMonth\('2026-10'\)/.test(c0) && /Mês em andamento/.test(c0), c0.slice(0, 500));
  check('no mês mais novo a seta para frente fica desligada (sem mês depois) e a de trás liga', /disabled aria-label="Próximo mês"/.test(c0) && !/disabled aria-label="Mês anterior"/.test(c0));
  card.api.mhSetMonth('2026-10');
  const c1 = card.api.mhRankingCard();
  check('escolher outubro troca o mês e pede para redesenhar a tela', card.st.mhMonth === '2026-10' && card.calls.renders === 1);
  check('outubro (fechado): sem PARCIAL, com o Craque, os destaques e os números, e as setas ao contrário (sem anterior, com próximo)', /Destaques de outubro/.test(c1) && !/PARCIAL/.test(c1) && /Craque do Mês/.test(c1) && /Bruno/.test(c1) && /10 gols/.test(c1) && /9 votos/.test(c1) && /11 votos/.test(c1) && /3 títulos/.test(c1) && /Mês fechado/.test(c1) && /disabled aria-label="Mês anterior"/.test(c1) && !/disabled aria-label="Próximo mês"/.test(c1), c1.slice(0, 400));
  check('o Perna de Pau aparece em vermelho (negativa) e o Cartão Ponto e o Marca Todas aparecem sem número', /color:var\(--danger\)[^>]*>11 votos/.test(c1) && /Cartão Ponto/.test(c1) && /Marca Todas/.test(c1));
  check('um mês escolhido que não existe mais volta para o mais novo', (() => { card.st.mhMonth = '2020-01'; return card.api.mhSelected() === '2026-11'; })());
  check('o admin desligou os destaques: o card some; sem nenhum mês válido o card também não aparece', makeEnv({ champs: OCT, appCfg: { monthBadges: false } }).api.mhRankingCard() === '' && makeEnv({ champs: OCT.slice(0, 2) }).api.mhRankingCard() === '' && makeEnv({ champs: [] }).api.mhRankingCard() === '');
  check('o nome do jogador passa pelo escape (nenhuma etiqueta solta)', (() => {
    const xss = simple('2026-10', ['azul', 'azul', 'azul']).map(c => ({ ...c, teamRosters: { azul: ['<b>Ana</b>', 'Bruno'], verde: ['Carla'] }, champion_players: [{ name: '<b>Ana</b>', weight: 1 }, { name: 'Bruno', weight: 1 }] }));
    const h = makeEnv({ champs: xss }).api.mhRankingCard();
    return /&lt;b>Ana&lt;\/b>/.test(h) && !/<b>Ana<\/b>/.test(h);
  })());
  check('mês válido sem nenhum destaque: o card avisa que ninguém chegou ao mínimo', /Ninguém chegou ao mínimo/.test(makeEnv({ champs: EMPTY_MONTH }).api.mhRankingCard()));

  // ══ 10. OS DADOS E A IMAGEM DO CARD ════════════════════════════════════════════════════════════════
  const A26 = makeEnv({ champs: OCT, now: '2026-11-10T15:00:00.000Z' }).api; // em 2026 o mês sai sem o ano; em outro ano, "outubro de 2026"
  const sd = A26.mhShareData('2026-10');
  check('em outro ano o nome do mês leva o ano (outubro de 2026) no card e na imagem', A.mhShareData('2026-10').monthName === 'outubro de 2026' && texts(paintTmp(A.mhShareData('2026-10'))).includes('OUTUBRO DE 2026') && /Destaques de outubro de 2026/.test(A.mjDestaquesCaption(A.mhShareData('2026-10'))) && /Destaques de outubro de 2026/.test(A.mhRankingCard()));
  check('os dados da imagem: o nome da liga, o mês, 12 linhas (10 destaques + Cartão Ponto + Marca Todas), o Craque e nada de foto', sd.league === 'Liga X' && sd.monthName === 'outubro' && sd.partial === false && sd.rows.length === 12 && sd.craque.who === 'Bruno' && sd.craque.value === 7 && sd.tier === 'legendary' && !('photo' in sd), [sd.rows.length, sd.rows.map(r => r.label)]);
  check('as linhas saem na ordem do card: Maior Campeão (3 títulos), Artilheiro (10 gols), Rei das Artilharias (2 artilharias), … Perna de Pau (11 votos, negativa)', J(sd.rows.slice(0, 3).map(r => [r.label, r.value])) === '[["Maior Campeão","3 títulos"],["Artilheiro","10 gols"],["Rei das Artilharias","2 artilharias"]]' && sd.rows[6].label === 'Perna de Pau do Mês' && sd.rows[6].negative === true && sd.rows[6].value === '11 votos', sd.rows.map(r => [r.label, r.value]));
  check('vários nomes empatados saem juntos com "·" (Ana · Bruno · Gil) e, com mais de 3, "+N"', sd.rows[0].who === 'Ana · Bruno · Gil' && A.mjNamesText(['A', 'B', 'C', 'D', 'E']) === 'A · B · C +2' && A.mjNamesText(['A']) === 'A');
  check('1 título e 1 gol no singular; 2,5 títulos sem o símbolo de meio', A.mhValueText(A.MH_LEADERS[0], 1) === '1 título' && A.mhValueText(A.MH_LEADERS[1], 1) === '1 gol' && A.mhValueText(A.MH_LEADERS[0], 2.5) === '2,5 títulos' && A.mhNum(3) === '3' && !/½/.test(A.mhNum(2.5)));
  check('mês em andamento: os dados vão como parcial (verde)', (() => { const d = makeEnv({ champs: OCT, now: '2026-10-29T15:00:00.000Z' }).api.mhShareData('2026-10'); return d.partial === true && d.tier === 'common'; })());
  check('mês que não vale não gera imagem (null); a janela de compartilhar abre com o tipo "destaques"; sem nada para mostrar avisa e não abre', (() => {
    const bad = A26.mhShareData('2026-09') === null && A26.mhShareData('2099-01') === null;
    const e2 = makeEnv({ champs: OCT, now: '2026-11-10T15:00:00.000Z' }); e2.api.openMjDestaques('2026-10');
    const e3 = makeEnv({ champs: EMPTY_MONTH, now: '2026-11-10T15:00:00.000Z' }); e3.api.openMjDestaques('2026-10');
    return bad && e2.calls.shared.length === 1 && e2.calls.shared[0][0] === 'destaques' && e2.calls.shared[0][1].monthName === 'outubro' && e3.calls.shared.length === 0 && /ainda não tem destaques/.test(e3.calls.toasts[0]?.[0] || '');
  })());
  check('openMjDestaques sem mês usa o mês escolhido na aba Ranking', (() => { const e = makeEnv({ champs: [...OCT, ...NOV], mhMonth: '2026-10' }); e.api.openMjDestaques(); return e.calls.shared[0][1].month === '2026-10'; })());
  const nd = A.mjDestaquesData({ league: ' Liga ', month: '2026-10', monthName: 'outubro', rows: [{ emoji: '🏆', label: 'Maior Campeão', names: [' Ana ', '', 'Bruno'], value: '3 títulos' }, { label: 'sem nomes', names: [] }, null, { names: ['x'] }], craque: { names: ['Bruno'], value: '6' } });
  check('a normalização limpa: nome sem espaços e sem vazios, linha sem nome ou sem rótulo descartada, craque com valor numérico', nd.league === 'Liga' && nd.rows.length === 1 && J(nd.rows[0].names) === '["Ana","Bruno"]' && nd.craque.value === 6 && A.mjDestaquesData({}).rows.length === 0 && A.mjDestaquesData({}).craque === null && A.mjDestaquesData({ craque: { names: [] } }).craque === null && A.mjDestaquesData({}).monthName === 'mês');
  check('no máximo 16 linhas (11 destaques e 4 feitos cabem)', A.mjDestaquesData({ rows: Array.from({ length: 20 }, (_, i) => ({ label: 'L' + i, names: ['x'] })) }).rows.length === 16);

  // o desenho do Feed e do Story
  const paint = (data, story = false, photo = null, logo = null) => { const f = fakeCtx(); (story ? A.drawMjDestaquesStory : A.drawMjDestaquesCard)(f.ctx, data, photo, logo); return f.log; };
  const fl = paint(sd);
  check('o Feed desenha o alto (liga, "DESTAQUES DO MÊS", o mês em maiúsculas), o Craque, as linhas e o rodapé', (() => { const t = texts(fl); return t.includes('Liga X') && t.includes('DESTAQUES DO MÊS') && t.includes('OUTUBRO') && t.some(x => /CRAQUE DO MÊS · 7 DESTAQUES/.test(x)) && t.includes('Bruno') && t.includes('Ana · Bruno · Gil') && t.includes('10 GOLS') && t.includes('11 VOTOS') && t.includes('Crie a liga da sua pelada') && t.includes('peladanamao.com.br'); })(), texts(fl));
  check('cada linha leva o nome do destaque em maiúsculas e o emoji', (() => { const t = texts(fl); return t.includes('MAIOR CAMPEÃO') && t.includes('REI DAS ARTILHARIAS DE FINAIS') && t.includes('🏆') && t.includes('🥾') && t.includes('🥅'); })());
  check('as linhas começam abaixo da faixa do Craque (o cartão tem 12 linhas: layout compacto, a faixa vai de y = 336 a 420) e, sem Craque e com poucas linhas, logo abaixo do mês', (() => { const first = fl.find(l => l.op === 'text' && l.t === 'MAIOR CAMPEÃO'); const sem = paint(A26.mjDestaquesData({ rows: sd.rows.slice(0, 3), monthName: 'outubro' })).find(l => l.op === 'text' && l.t === 'MAIOR CAMPEÃO'); return first.y > 420 && sem.y > 400 && sem.y < 900; })());
  check('o texto do Craque fica dentro da faixa dele (no layout compacto, entre y = 336 e 420)', (() => { const lab = fl.find(l => l.op === 'text' && /^CRAQUE DO MÊS/.test(l.t)), who = fl.find(l => l.op === 'text' && l.t === 'Bruno' && l.x === 170); return lab.y > 336 && lab.y < 420 && who.y > lab.y && who.y < 420; })());
  const partialData = makeEnv({ champs: OCT, now: '2026-10-29T15:00:00.000Z' }).api.mhShareData('2026-10');
  check('o mês parcial diz PARCIAL no alto e o mês fechado não', texts(paint(partialData)).includes('DESTAQUES DO MÊS · PARCIAL') && !texts(fl).some(x => /PARCIAL/.test(x)));
  check('a cor do Feed: dourado no mês fechado, verde no parcial; o Perna de Pau em vermelho', fl.some(l => l.op === 'stroke' && l.color === '#f0b429') && paint(partialData).some(l => l.op === 'stroke' && l.color === '#00d67f') && fl.some(l => l.op === 'text' && l.t === '11 VOTOS' && l.fill === '#ff7b72'));
  const lines = (n, nf = 0) => A.mjDestaquesData({ rows: [...Array.from({ length: n }, (_, i) => ({ emoji: '⚽', label: 'Destaque ' + i, names: ['Fulano'], value: i + ' gols' })), ...Array.from({ length: nf }, (_, i) => ({ emoji: '📆', label: 'Feito ' + i, names: ['Beltrano'], value: '', feat: true }))], craque: n + nf > 9 ? { names: ['Z'], value: 3 } : null, monthName: 'outubro' });
  check('com poucas ou muitas linhas nada passa do rodapé: o último destaque e o último feito terminam antes de y = 1180 (1, 3, 9, 12 e 15 linhas, com e sem o Craque e com 0, 2 e 4 feitos)', [[1, 0], [3, 0], [9, 0], [12, 0], [9, 2], [11, 4], [3, 4]].every(([n, nf]) => { const f = paint(lines(n, nf)); const t = f.filter(l => l.op === 'text' && /^\d+ GOLS$/.test(l.t)), ft = f.filter(l => l.op === 'text' && l.t === 'Beltrano'); return t.length === n && (!t.length || Math.max(...t.map(x => x.y)) <= 1180) && ft.length === nf && (!ft.length || Math.max(...ft.map(x => x.y)) <= 1180); }));
  check('nome comprido não estoura: o nome fica dentro da largura da linha (reticências ou fonte menor)', (() => { const d = A.mjDestaquesData({ rows: [{ label: 'Artilheiro', names: ['Fulano de Tal da Silva Sauro Pereira Albuquerque'], value: '10 gols' }], monthName: 'outubro' }); const l = paint(d).find(x => x.op === 'text' && /Fulano/.test(x.t)); const px = +(/(\d+)px/.exec(l.font)[1]); return l.t.length * px * 0.55 <= 1080 - 92 - 168 - 250 + 1; })());
  check('o desenho nunca usa foto de jogador (só a logo, quando existe): com uma "foto" e uma "logo" a única imagem desenhada é a logo', paint(sd).every(l => l.op !== 'img') && (() => { const f = fakeCtx(); A.drawMjDestaquesCard(f.ctx, sd, { fake: 'foto' }, { fake: 'logo' }); const imgs = f.log.filter(l => l.op === 'img'); return imgs.length === 1 && imgs[0].img.fake === 'logo'; })());
  const sl = paint(sd, true);
  check('o Story (9:16) desenha o MESMO cartão escalado entre as margens do Instagram (250 em cima e 340 embaixo)', (() => { const k = (1920 - 250 - 340) / 1350; const sc = sl.find(l => l.op === 'scale'), tr = sl.find(l => l.op === 'translate'); return Math.abs(sc.x - k) < 1e-9 && tr.y === 250 && Math.abs(tr.x - (1080 - 1080 * k) / 2) < 1e-9 && texts(sl).includes('OUTUBRO') && texts(sl).includes('peladanamao.com.br'); })(), sl.filter(l => l.op === 'scale' || l.op === 'translate'));
  const cap = A.mjDestaquesCaption(sd), capP = A.mjDestaquesCaption({ ...sd, partial: true });
  check('a legenda não leva nome de jogador nem da liga, leva o mês, o link do cartão e as hashtags; no parcial diz "(parcial)"', /Destaques de outubro na minha pelada/.test(cap) && !/Bruno|Ana|Liga X/.test(cap) && /https:\/\/peladanamao\.com\.br\/\?ref=cartao/.test(cap) && /#pelada #futebolamador #peladanamao/.test(cap) && !/parcial/.test(cap) && /\(parcial\)/.test(capP), cap);

  // ══ 11. AS LIGAÇÕES NO APP ═════════════════════════════════════════════════════════════════════════
  check('as DUAS contas das conquistas (a aba Meu Craque e o cache de todos os jogadores) recebem os destaques do mês', (html.match(/\.\.\.monthAwardStats\(/g) || []).length === 2 && /\.\.\.rivalPublicStats\(name\),\.\.\.monthAwardStats\(name\),myName:name\}/.test(html) && /\.\.\.rivalPublicStats\(myName\), \.\.\.monthAwardStats\(myName\), myName \}/.test(html));
  check('as conquistas do mês não aparecem como "novas neste campeonato" no resumo (computeNewBadgesInChamp ignora MH_BADGE_IDS)', /after\.filter\(id=>!before\.has\(id\)&&!MH_BADGE_IDS\.includes\(id\)\)/.test(html));
  check('o app lê monthBadges da configuração da liga (ligado por padrão) e o Painel Admin tem o interruptor', /monthBadges:\s+data\.monthBadges\s+\?\? true,/.test(html) && /saveAppCfg\(\{monthBadges:true\}\)/.test(html) && /saveAppCfg\(\{monthBadges:false\}\)/.test(html) && /tog\(cfg\.monthBadges !== false\)[^<]*>Ligados</.test(html) && /tog\(cfg\.monthBadges === false\)[^<]*>Desligados</.test(html));
  check('o card fica no ALTO da aba Ranking, antes do Ranking de Campeões', /return `\$\{mhRankingCard\(\)\}<div class="card">\s*<div class="card-hdr"><span class="card-lbl">Ranking de Campeões<\/span>/.test(html));
  check('o tipo "destaques" está nos tipos de cartão (arquivos, desenho dos dois formatos, legenda) e usa o link ?ref=cartao que o servidor já conta', /destaques: \{\s*title: '📤 Destaques do mês'[\s\S]*?draw: \{ feed: drawMjDestaquesCard, story: drawMjDestaquesStory \}[\s\S]*?caption: d => mjDestaquesCaption\(d\)/.test(html) && /destaques-pelada-na-mao-story\.png/.test(html) && /destaques-pelada-na-mao\.png/.test(html) && !/ref=destaques/.test(html));
  check('a janela do cartão mostra o aviso de que o card leva nomes de jogadores', /note: 'O card mostra o nome dos jogadores da liga: poste só se o grupo estiver de acordo\.'/.test(html) && /\$\{mjKindNow\(\)\.note \? `/.test(html));
  check('o tile da conquista mostra ×N quando a conquista do mês foi ganha mais de uma vez; a janela da conquista mostra ×N e os meses de cada pessoa', /\$\{esc\(b\.label\)\}\$\{earned && mhTimes\(myName, b\.id\) > 1 \? ` ×\$\{mhTimes\(myName, b\.id\)\}` : ''\}/.test(html) && /\$\{esc\(n\)\}\$\{mhHolderNote\(n, b\.id\)\}/.test(html));
  check('a janela da conquista mostra os meses (Out/26) sem ×; com dois meses, ×2 · Out/26, Nov/26; conquista que não é do mês fica sem nada', !A.mhHolderNote('Bruno', 'mes_campeao').includes('×') && A.mhHolderNote('Bruno', 'mes_campeao').includes('Out/26') && A.mhHolderNote('Bruno', 'hat_trick') === '' && (() => { const n = makeEnv({ champs: [...OCT, ...NOV] }).api.mhHolderNote('Bruno', 'mes_campeao'); return /×2/.test(n) && /Out\/26, Nov\/26/.test(n); })());
  check('nada do que o card faz vai ao servidor: sem chamada de função nem gravação no bloco dos destaques', !/callFn\(|httpsCallable|\.add\(|\.set\(|\.update\(/.test(mhCode));

  // ══ 12. O MANUAL ═══════════════════════════════════════════════════════════════════════════════════
  const ini = manual.indexOf('<section class="section" id="destaques-do-mes">');
  const sec = ini < 0 ? '' : manual.slice(ini, manual.indexOf('</section>', ini));
  check('o manual tem a seção 33 e o índice (as duas listas) aponta para ela', sec.length > 3000 && (manual.match(/<a href="#destaques-do-mes"><span class="num">33<\/span> Destaques do Mês \(conquistas, cards e comparativo\)<\/a>/g) || []).length === 2 && /<span class="sn">33<\/span> Destaques do Mês/.test(sec), sec.length);
  check('a tabela do manual traz as 18 conquistas com o mesmo emoji e nome do catálogo', CAT.every(b => sec.includes('<tr><td>' + b.emoji + ' ' + b.label + '</td>')), CAT.filter(b => !sec.includes('<tr><td>' + b.emoji + ' ' + b.label + '</td>')).map(b => b.id));
  check('os números das regras do manual batem com o código (3 campeonatos, 2 jogados, repetir 2, 2 votações, outubro de 2026, 3 finais)', new RegExp('pelo menos <strong>' + A.MH_MIN_CHAMPS + ' campeonatos concluídos</strong>').test(sec) && new RegExp('pelo menos <strong>' + A.MH_MIN_PLAYED + '</strong> desses campeonatos').test(sec) && new RegExp('pelo menos <strong>' + A.MH_MIN_REPEAT + '</strong> \\(').test(sec) && new RegExp('pelo menos ' + A.MH_MIN_VOTINGS + ' votações encerradas').test(sec) && /<strong>Outubro de 2026<\/strong>/.test(sec) && A.MH_FIRST === '2026-10' && new RegExp('pelo menos ' + A.MH_MIN_CHAMPS + ' finais').test(sec));
  check('o manual explica o mês fechado (último dia, horário de Brasília, votação de 3 dias), o PARCIAL, o empate e o goleiro', /último dia do mês<\/strong> \(horário de Brasília\)/.test(sec) && /a votação dura 3 dias/.test(sec) && /<strong>PARCIAL<\/strong>/.test(sec) && /Todos os empatados levam/.test(sec) && /<tr><td>Goleiro<\/td>/.test(sec));
  check('o manual descreve o card (aba Ranking, setas, Craque do Mês, Story 9:16 e Feed 4:5, Compartilhar, Copiar legenda, Baixar)', /aba <strong>Ranking<\/strong>, no alto/.test(sec) && /Craque do Mês<\/strong> em destaque/.test(sec) && /Story 9:16<\/strong> ou <strong>Feed 4:5<\/strong>/.test(sec) && /Copiar legenda/.test(sec) && /Baixar a imagem/.test(sec));
  check('o manual diz que QUALQUER jogador gera o card, que a imagem leva nomes e nenhuma foto, que a legenda não leva nomes e o link ?ref=cartao', /<strong>Qualquer jogador<\/strong> pode gerar o card/.test(sec) && /<strong>nenhuma foto<\/strong>/.test(sec) && /a legenda não leva nomes/.test(sec) && /<code>\?ref=cartao<\/code>/.test(sec));
  check('o manual explica a Hegemonia e a Dinastia (mês com menos de 3 não quebra; mês sem ele quebra) e o ×N com os meses', /Hegemonia e na Dinastia, um mês com menos de 3 campeonatos não conta nem quebra/.test(sec) && /×2<\/strong>, <strong>×3/.test(sec) && /Out\/26, Nov\/26/.test(sec));
  check('o manual explica o interruptor do admin (no Painel Admin, com o nome da configuração, e na seção 33) e o aviso na seção das conquistas', /id="destaques-mes-admin"[\s\S]*?guardada em <code>app_config\/main<\/code> \(<code>monthBadges<\/code>\)/.test(manual) && /Além das conquistas abaixo, existem <strong>18 conquistas/.test(manual) && /<h3>Desligar <span class="tag">Admin<\/span><\/h3>/.test(sec));
  check('o manual diz que não há função nem regra nova do servidor e que a legenda nunca leva nome', /Não há função nem regra nova do servidor/.test(sec) && /nunca leva nome de pessoa nem da liga/.test(sec));

  check('o manual lista os dois arquivos do card na tabela dos cartões (seção 29), com os mesmos nomes do app', manual.includes('<code>destaques-pelada-na-mao-story.png</code> / <code>destaques-pelada-na-mao.png</code>') && /destaques: \{[\s\S]*?file: \{ story: 'destaques-pelada-na-mao-story\.png', feed: 'destaques-pelada-na-mao\.png' \}/.test(html));
  check('o manual avisa, nas duas frases da liga sem final (seções 3 e 13), que as duas conquistas do mês ligadas às finais também somem', /além de <strong>Rei das Finais do Mês<\/strong>, <strong>Rei das Artilharias de Finais do Mês<\/strong> e <strong>Pipoca do Mês<\/strong> \(seção 33\)/.test(manual) && /além das de ½ título e das três conquistas do mês ligadas às finais \(Rei das Finais do Mês, Rei das Artilharias de Finais do Mês e Pipoca do Mês\)/.test(manual));

  // ══ 13. RESULTADO EM CAMPO: PÉ QUENTE, PÉ FRIO, INVICTO, PAREDÃO E PIPOCA (entrega 2) ═══════════════════════════
  check('os jogos de cada jogador em outubro (a mesma conta do Resumo de Jogos): o time azul fez 12 jogos (8V 1E 3D, 8 gols sofridos, 5 sem sofrer gol); Carla 9 (3V 2E 4D); Davi 8 (3V 1E 4D); Edu 7 (1V 1E 5D); Fabi 4', (() => { const r = oct.rows; return ['Ana', 'Bruno', 'Gil'].every(n => r[n].matches === 12 && r[n].w === 8 && r[n].d === 1 && r[n].l === 3 && r[n].ga === 8 && r[n].cs === 5) && r.Carla.matches === 9 && r.Carla.w === 3 && r.Carla.d === 2 && r.Carla.l === 4 && r.Davi.matches === 8 && r.Davi.w === 3 && r.Davi.d === 1 && r.Davi.l === 4 && r.Edu.matches === 7 && r.Edu.w === 1 && r.Edu.d === 1 && r.Edu.l === 5 && r.Fabi.matches === 4; })(), oct.rows);
  check('as finais perdidas do mês: Carla e Davi perderam 2 (a 1ª e a 2ª finais), Ana, Bruno e Gil 1 (a 3ª), Edu e Fabi 1 (a 4ª)', (() => { const r = oct.rows; return r.Carla.finalsLost === 2 && r.Davi.finalsLost === 2 && ['Ana', 'Bruno', 'Gil'].every(n => r[n].finalsLost === 1) && r.Edu.finalsLost === 1 && r.Fabi.finalsLost === 1; })(), oct.rows);
  check('Pé Quente do Mês: o time azul (Ana, Bruno e Gil), com 25 de 36 pontos = 69%', J(names(oct, 'pe_quente')) === '["Ana","Bruno","Gil"]' && Math.round(oct.leaders.pe_quente.value * 100) === 69, oct.leaders.pe_quente);
  check('Pé Frio do Mês: o Edu, com 4 de 21 pontos = 19% (a Fabi, com 4 jogos, não concorre)', J(names(oct, 'pe_frio')) === '["Edu"]' && Math.round(oct.leaders.pe_frio.value * 100) === 19, oct.leaders.pe_frio);
  check('Pipoca do Mês: Carla e Davi, com 2 finais perdidas; some na liga sem final', J(names(oct, 'pipoca')) === '["Carla","Davi"]' && oct.leaders.pipoca.value === 2 && !makeEnv({ champs: OCT, appCfg: { hasFinais: false } }).api.getMonthHighlights().byMonth['2026-10'].leaders.pipoca, oct.leaders.pipoca);
  check('Invicto do Mês: ninguém (o azul perdeu 3 jogos); Paredão do Mês: ninguém (só 1 goleiro concorre)', oct.feats.invicto === undefined && oct.leaders.paredao === undefined);
  check('as linhas do card trazem os rótulos e os valores novos (69%, 19%, 2 finais) e as negativas vão em vermelho', sd.rows[7].label === 'Pé Quente (aproveitamento)' && sd.rows[7].value === '69%' && sd.rows[8].label === 'Pé Frio (aproveitamento)' && sd.rows[8].value === '19%' && sd.rows[8].negative === true && sd.rows[9].label === 'Pipoca (finais perdidas)' && sd.rows[9].value === '2 finais' && sd.rows[9].negative === true && sd.rows[10].feat === true && sd.rows[11].feat === true && !sd.rows[0].feat, sd.rows.map(r => [r.label, r.value, r.feat]));

  // times pequenos com resultado conhecido: o azul (Ana, Bruno e o goleiro Gil) contra o verde (Carla, Davi e o goleiro Hugo), 2 jogos por campeonato
  const P2 = ['Ana', 'Bruno', 'Carla', 'Davi'].map(name => ({ name })).concat([{ name: 'Gil', goleiro: true }, { name: 'Hugo', goleiro: true }]);
  const R2T = { azul: ['Ana', 'Bruno', 'Gil'], verde: ['Carla', 'Davi', 'Hugo'] };
  const res = (month, resultados, o = {}) => resultados.map((ms, i) => camp(month + '-' + i, month + '-' + String(5 + i * 7).padStart(2, '0'), { champ: o.champ ?? ['Ana', 'Bruno', 'Gil'], rosters: R2T, matches: ms.map(([hs, as]) => mt('azul', 'verde', hs, as)), ...(o.extra || {}) }));
  const resMes = (resultados, o = {}) => makeEnv({ champs: res('2026-10', resultados, o), players: o.players || P2 }).api.getMonthHighlights().byMonth['2026-10'];
  const R1 = [[[2, 0], [1, 0]], [[3, 1], [1, 1]], [[2, 0], [4, 0]]]; // o azul: 5 vitórias e 1 empate (16 de 18 pontos); o verde: 1 empate e 5 derrotas
  const r1 = resMes(R1);
  check('mês de 3 campeonatos com 2 jogos cada: Pé Quente é o azul (16 de 18 pontos = 89%), Pé Frio é o verde (1 de 18 = 6%) e Invicto é o azul (5 vitórias e 1 empate, nenhuma derrota)', J(names(r1, 'pe_quente')) === '["Ana","Bruno","Gil"]' && Math.round(r1.leaders.pe_quente.value * 100) === 89 && J(names(r1, 'pe_frio')) === '["Carla","Davi","Hugo"]' && Math.round(r1.leaders.pe_frio.value * 100) === 6 && J(r1.feats.invicto) === '["Ana","Bruno","Gil"]', [r1.leaders, r1.feats]);
  check('Paredão do Mês: com 2 goleiros concorrendo leva o que menos tomou gol por jogo (Gil, 2 gols em 6 jogos; o Hugo tomou 13)', J(names(r1, 'paredao')) === '["Gil"]' && Math.abs(r1.leaders.paredao.value - 2 / 6) < 1e-9 && r1.rows.Gil.ga === 2 && r1.rows.Hugo.ga === 13, r1.leaders.paredao);
  check('Craque do Mês conta o Pé Quente e o Paredão (Gil 3 destaques: Maior Campeão, Pé Quente e Paredão; Ana e Bruno 2); o Pé Frio não conta', J(r1.craque) === '{"names":["Gil"],"value":3}', r1.craque);
  check('só 1 goleiro concorrendo: não há Paredão do Mês (o Hugo deixa de ser goleiro)', !resMes(R1, { players: P2.map(p => (p.name === 'Hugo' ? { name: 'Hugo' } : p)) }).leaders.paredao);
  const eq = resMes([[[1, 1], [1, 1]], [[1, 1], [1, 1]], [[1, 1], [1, 1]]], { champ: [] });
  check('todos com o mesmo aproveitamento (6 empates): ninguém é Pé Quente, Pé Frio nem Paredão, mas TODOS são Invictos (empate não é derrota)', !eq.leaders.pe_quente && !eq.leaders.pe_frio && !eq.leaders.paredao && J(eq.feats.invicto) === '["Ana","Bruno","Carla","Davi","Gil","Hugo"]', [eq.leaders, eq.feats]);
  const g3 = resMes([[[2, 0]], [[0, 1]], [[1, 0]]]);
  check('com 3 jogos no mês ninguém concorre ao Pé Quente, Pé Frio, Invicto nem Paredão (pelo menos 5 jogos)', !g3.leaders.pe_quente && !g3.leaders.pe_frio && !g3.leaders.paredao && !g3.feats.invicto && g3.rows.Ana.matches === 3, [g3.leaders, g3.feats]);
  const g5 = resMes([[[2, 0], [1, 0]], [[1, 0], [3, 0]], [[2, 0]]]), g4 = resMes([[[2, 0], [1, 0]], [[1, 0], [3, 0]], []]);
  check('o limite: com exatamente 5 jogos já concorre (azul Pé Quente, verde Pé Frio, azul Invicto, Gil Paredão); com 4 jogos não', J(names(g5, 'pe_quente')) === '["Ana","Bruno","Gil"]' && J(names(g5, 'pe_frio')) === '["Carla","Davi","Hugo"]' && J(g5.feats.invicto) === '["Ana","Bruno","Gil"]' && J(names(g5, 'paredao')) === '["Gil"]' && !g4.leaders.pe_quente && !g4.leaders.pe_frio && !g4.feats.invicto && !g4.leaders.paredao && g4.rows.Ana.matches === 4, [g5.leaders, g4.leaders]);
  check('o goleiro leva Pé Quente e Invicto também (resultado de time, não é só de linha); Pé Quente, Pé Frio e Invicto contam o goleiro', names(r1, 'pe_quente').includes('Gil') && r1.feats.invicto.includes('Gil') && names(r1, 'pe_frio').includes('Hugo'));
  const g1 = resMes([[[2, 0], [1, 0]], [[1, 0], [0, 1]], [[2, 0]]]); // o azul: 5 jogos, 4 vitórias e 1 derrota
  check('Invicto: uma única derrota já tira o feito (o azul fez 5 jogos, 4V 1D); o Pé Quente continua sendo do azul (80%) e o Pé Frio do verde (20%)', !g1.feats.invicto && g1.rows.Ana.l === 1 && g1.rows.Ana.matches === 5 && J(names(g1, 'pe_quente')) === '["Ana","Bruno","Gil"]' && Math.round(g1.leaders.pe_quente.value * 100) === 80 && J(names(g1, 'pe_frio')) === '["Carla","Davi","Hugo"]' && Math.round(g1.leaders.pe_frio.value * 100) === 20, [g1.feats, g1.rows.Ana]);
  // T3: jogo que não foi disputado não conta
  const up = makeEnv({ players: P2, champs: res('2026-10', [[[2, 0], [1, 0]], [[1, 0]], [[2, 0]]]).map((c, i) => (i === 0 ? { ...c, matches: [...c.matches, { phase: 'regular', home: 'azul', away: 'verde', hs: 0, as: 9, played: false, goals: [] }] } : c)) }).api.getMonthHighlights().byMonth['2026-10'];
  check('jogo que não foi disputado não entra nos jogos, nas derrotas nem nos gols sofridos (o azul tem 4 jogos, todos vencidos, e nenhum gol sofrido; o verde tem 4 derrotas)', up.rows.Ana.matches === 4 && up.rows.Ana.l === 0 && up.rows.Ana.ga === 0 && up.rows.Ana.cs === 4 && up.rows.Carla.matches === 4 && up.rows.Carla.l === 4 && up.rows.Carla.ga === 6, up.rows.Ana);
  const rowsPick = { X: { w: 4, d: 0, matches: 6 }, Y: { w: 6, d: 0, matches: 9 }, Z: { w: 1, d: 0, matches: 6 }, W: { w: 0, d: 2, matches: 6 } };
  const num = r => 3 * r.w + r.d, den = r => 3 * r.matches;
  check('mhRatePick compara em cruz, sem arredondar: 4 vitórias em 6 jogos e 6 em 9 empatam no melhor aproveitamento (2/3); o pior é a W (2 empates em 6 = 11%)', J(A.mhRatePick(rowsPick, ['X', 'Y', 'Z', 'W'], num, den, false)) === '{"names":["X","Y"],"value":0.6666666666666666}' && J(A.mhRatePick(rowsPick, ['X', 'Y', 'Z', 'W'], num, den, true).names) === '["W"]', A.mhRatePick(rowsPick, ['X', 'Y', 'Z', 'W'], num, den, false));
  const rowsFine = { X: { w: 4, d: 0, matches: 6 }, R: { w: 133, d: 0, matches: 200 } }; // 66,67% contra 66,5%: arredondados dariam o mesmo número
  check('mhRatePick não arredonda: 66,67% (4 vitórias em 6 jogos) e 66,5% (133 em 200) são diferentes: o melhor é só o X e o pior é só o R', J(A.mhRatePick(rowsFine, ['X', 'R'], num, den, false).names) === '["X"]' && J(A.mhRatePick(rowsFine, ['X', 'R'], num, den, true).names) === '["R"]');
  check('mhRatePick: com menos de 2 concorrentes ou todos iguais devolve nulo', A.mhRatePick(rowsPick, ['X'], num, den, false) === null && A.mhRatePick(rowsPick, [], num, den, true) === null && A.mhRatePick(rowsPick, ['X', 'Y'], r => 1, r => 1, true) === null);
  const penPip = n => makeEnv({ champs: [6, 13, 20].map((d, i) => camp('pp' + i, '2026-10-' + String(d).padStart(2, '0'), { champ: AZUL, matches: [mt('azul', 'verde', 1, 1, [], 'final', n ? { penaltyWinner: 'azul' } : {})] })) }).api.getMonthHighlights().byMonth['2026-10'];
  check('final empatada decidida nos pênaltis: quem perdeu nos pênaltis perdeu a final (Pipoca para Carla e Davi, 3 finais perdidas); sem o vencedor dos pênaltis registrado ninguém perdeu', J(names(penPip(true), 'pipoca')) === '["Carla","Davi"]' && penPip(true).leaders.pipoca.value === 3 && !penPip(false).leaders.pipoca && penPip(false).rows.Carla.finalsLost === 0, [penPip(true).leaders, penPip(false).rows.Carla]);

  // ══ 14. MEU MÊS: OS NÚMEROS DO JOGADOR NO MÊS ═══════════════════════════════════════════════════════════════
  const pmB = A.mhPlayerMonth('Bruno', '2026-10');
  check('Meu mês do Bruno em outubro: jogou os 4 campeonatos (100%), 12 jogos (8V 1E 3D, 69% dos pontos), 3 títulos, 10 gols (0,83 por jogo), 2 artilharias, 4 finais (1 perdida), 9 votos de Bola Cheia, nenhum de Bola Murcha, mês fechado', pmB.played === 4 && pmB.pres === 100 && pmB.nChamps === 4 && pmB.matches === 12 && pmB.w === 8 && pmB.d === 1 && pmB.l === 3 && Math.round(pmB.apr * 100) === 69 && pmB.titles === 3 && pmB.goals === 10 && Math.round(pmB.gpj * 100) === 83 && pmB.art === 2 && pmB.finals === 4 && pmB.finalsLost === 1 && pmB.pos === 9 && pmB.neg === 0 && pmB.isGK === false && pmB.closed === true, pmB);
  check('os destaques que o Bruno levou, na ordem do card: 7 "o melhor", 2 feitos e o Craque', J(pmB.won.map(w => w.id)) === '["campeao","artilheiro","rei_art","rei_art_final","rei_finais","xodo","pe_quente","cartao_ponto","marca_todas","craque"]' && pmB.won.every(w => !w.negative), pmB.won.map(w => w.id));
  const pmE = A.mhPlayerMonth('Edu', '2026-10'), pmG = A.mhPlayerMonth('Gil', '2026-10');
  check('o Edu levou o Perna de Pau e o Pé Frio (marcados como negativos) e o Cartão Ponto; o goleiro Gil: 8 gols sofridos em 12 jogos (0,67 por jogo) e 5 jogos sem sofrer gol', J(pmE.won.map(w => [w.id, w.negative])) === '[["perna_pau",true],["pe_frio",true],["cartao_ponto",false]]' && pmG.isGK === true && pmG.ga === 8 && Math.round(pmG.gapj * 100) === 67 && pmG.cs === 5, [pmE.won, pmG]);
  check('presença: o Davi jogou 3 dos 4 campeonatos (75%) e a Fabi 2 (50%); quem não jogou o mês (Hugo) ou mês que não vale não tem números (null)', A.mhPlayerMonth('Davi', '2026-10').pres === 75 && A.mhPlayerMonth('Fabi', '2026-10').pres === 50 && A.mhPlayerMonth('Hugo', '2026-10') === null && A.mhPlayerMonth('Bruno', '2026-09') === null && A.mhPlayerMonth('Bruno', '2099-01') === null);
  const tB = A.mmTiles(pmB);
  check('os quadradinhos do Bruno: presença, jogos, aproveitamento, títulos, gols, artilharias, finais, Bola Cheia e Bola Murcha, com o texto de apoio de cada um', J(tB.map(t => t.key)) === '["pres","jogos","apr","titles","goals","art","finals","pos","neg"]' && tB[0].value === '100%' && tB[0].sub === '4 de 4 campeonatos' && tB[1].value === '12' && tB[1].sub === '8V · 1E · 3D' && tB[2].value === '69%' && tB[3].value === '3' && tB[4].value === '10' && tB[4].sub === '0,83 por jogo' && tB[5].value === '2' && tB[6].value === '4' && tB[6].sub === '1 perdida' && tB[7].value === '9' && tB[7].sub === 'votos' && tB[8].value === '0', tB);
  const tG = A.mmTiles(pmG);
  check('os quadradinhos do goleiro: gols sofridos e jogos sem sofrer gol no lugar de gols e artilharias', J(tG.map(t => t.key)) === '["pres","jogos","apr","titles","ga","cs","finals","pos","neg"]' && tG.find(t => t.key === 'ga').value === '8' && tG.find(t => t.key === 'ga').sub === '0,67 por jogo' && tG.find(t => t.key === 'cs').value === '5' && tG.find(t => t.key === 'cs').sub === 'jogos', tG);
  const semFV = makeEnv({ champs: OCT.map(stripVoting), appCfg: { hasFinais: false, votePos: false, voteNeg: false } }).api;
  check('sem final e sem votação a liga não vê os quadradinhos de finais e de votos', J(semFV.mmTiles(semFV.mhPlayerMonth('Bruno', '2026-10')).map(t => t.key)) === '["pres","jogos","apr","titles","goals","art"]');
  const tilesOf = (cfg, champs = OCT) => { const e = makeEnv({ champs, appCfg: cfg }).api; return J(e.mmTiles(e.mhPlayerMonth('Bruno', '2026-10')).map(t => t.key)); };
  check('com final e sem nenhuma votação no mês só aparece o quadradinho das finais; com final e votação aparecem as finais e os dois votos; só a Bola Cheia desligada na configuração continua aparecendo (a liga votou)', tilesOf({}, OCT.map(stripVoting)) === '["pres","jogos","apr","titles","goals","art","finals"]' && tilesOf({}) === '["pres","jogos","apr","titles","goals","art","finals","pos","neg"]' && tilesOf({ votePos: false }) === '["pres","jogos","apr","titles","goals","art","finals","pos","neg"]' && tilesOf({ hasFinais: false }) === '["pres","jogos","apr","titles","goals","art","pos","neg"]');
  const zero = makeEnv({ champs: [1, 2, 3].map(i => camp('z' + i, '2026-10-0' + i, { champ: [] })) }).api;
  check('mês sem jogo registrado: não há quadradinho de jogos nem de aproveitamento (e nada de divisão por zero)', J(zero.mmTiles(zero.mhPlayerMonth('Ana', '2026-10')).map(t => t.key)) === '["pres","titles","goals","art"]' && zero.mhPlayerMonth('Ana', '2026-10').apr === null && zero.mhPlayerMonth('Ana', '2026-10').gpj === null);

  // ══ 15. O COMPARATIVO ENTRE MESES ════════════════════════════════════════════════════════════════════════════
  const mini = (month, resultados) => resultados.map(([hs, as, goals, champ], i) => camp(month + '-' + i, month + '-' + String(4 + i * 7).padStart(2, '0'), { champ: champ === 'azul' ? AZUL : VERDE, rosters: { azul: AZUL, verde: VERDE }, matches: [mt('azul', 'verde', hs, as, goals)] }));
  const M1 = mini('2026-10', [[2, 1, ['Bruno'], 'azul'], [0, 1, [], 'verde'], [1, 1, [], 'verde']]); // Bruno: vitória, derrota e empate (44%), 1 gol, 1 título
  const M2 = mini('2026-11', [[3, 0, ['Bruno', 'Bruno'], 'azul'], [2, 0, ['Bruno'], 'azul'], [1, 0, [], 'azul']]); // Bruno: 3 vitórias (100%), 3 gols, 3 títulos
  const M3 = mini('2026-12', [[0, 1, [], 'verde'], [0, 1, [], 'verde'], [0, 2, [], 'verde']]); // Bruno: 3 derrotas (0%), nenhum gol, nenhum título
  const cmpEnv = (extra = [], now) => makeEnv({ champs: [...M1, ...M2, ...extra], now: now || '2027-03-10T15:00:00.000Z' }).api;
  const rowOf = (c, k) => c.rows.find(r => r.key === k);
  const c21 = cmpEnv().mhCompare('Bruno', '2026-11');
  check('novembro contra outubro (Bruno): 8 números; 7 melhoraram e 1 ficou igual (a presença)', c21.ok === true && c21.monthA === '2026-10' && c21.monthB === '2026-11' && c21.rows.length === 8 && c21.better === 7 && c21.worse === 0 && c21.same === 1 && J(c21.rows.map(r => r.key)) === '["pres","apr","w","l","titles","goals","gpj","art"]', [c21.better, c21.worse, c21.same, c21.rows.map(r => r.key)]);
  check('os números e as diferenças: aproveitamento 44% → 100% (+56 pts), vitórias 1 → 3 (+2), títulos 1 → 3, gols 1 → 3, gols por jogo 0,33 → 1 (+0,67), artilharias 1 → 2 (+1)', (() => { const g = k => rowOf(c21, k); return g('apr').fa === '44%' && g('apr').fb === '100%' && g('apr').dText === '+56 pts' && g('w').dText === '+2' && g('titles').fa === '1' && g('titles').fb === '3' && g('goals').dText === '+2' && g('gpj').fa === '0,33' && g('gpj').fb === '1' && g('gpj').dText === '+0,67' && g('art').dText === '+1' && g('pres').fa === '100%' && g('pres').dText === '=' && g('pres').verdict === 'same'; })(), c21.rows);
  check('em derrotas menos é melhor: 1 → 0 derrota é "−1" e MELHOROU', rowOf(c21, 'l').fa === '1' && rowOf(c21, 'l').fb === '0' && rowOf(c21, 'l').dText === '−1' && rowOf(c21, 'l').verdict === 'better', rowOf(c21, 'l'));
  const c32 = cmpEnv(M3).mhCompare('Bruno', '2026-12');
  check('dezembro contra novembro (Bruno): tudo piorou (7) e só a presença ficou igual; aproveitamento 100% → 0% (−100 pts), derrotas 0 → 3 (+3) é PIOR, títulos 3 → 0', c32.ok && c32.monthA === '2026-11' && c32.better === 0 && c32.worse === 7 && c32.same === 1 && rowOf(c32, 'apr').dText === '−100 pts' && rowOf(c32, 'apr').verdict === 'worse' && rowOf(c32, 'l').dText === '+3' && rowOf(c32, 'l').verdict === 'worse' && rowOf(c32, 'titles').dText === '−3' && rowOf(c32, 'gpj').dText === '−1' && rowOf(c32, 'art').dText === '−2', c32.rows);
  const cG = cmpEnv().mhCompare('Gil', '2026-11');
  check('o goleiro compara gols sofridos por jogo (1 → 0, "−1", melhorou) e jogos sem sofrer gol (0 → 3), e não tem gols nem artilharias: 7 números, 6 melhoraram', cG.ok && cG.isGK && J(cG.rows.map(r => r.key)) === '["pres","apr","w","l","titles","gapj","cs"]' && rowOf(cG, 'gapj').fa === '1' && rowOf(cG, 'gapj').fb === '0' && rowOf(cG, 'gapj').dText === '−1' && rowOf(cG, 'gapj').verdict === 'better' && rowOf(cG, 'cs').dText === '+3' && cG.better === 6 && cG.same === 1, cG.rows);
  const miniV = (month, votes) => [0, 1, 2].map(i => camp(month + '-' + i, month + '-' + String(4 + i * 7).padStart(2, '0'), { champ: AZUL, rosters: { azul: AZUL, verde: VERDE }, matches: [mt('azul', 'verde', 1, 0)], voting: true, votes: i === 0 ? votes : {} }));
  const MV1 = miniV('2026-10', V([['Ana', 'Carla', 'Bruno'], ['Carla', 'Ana', 'Bruno'], ['Davi', 'Bruno', 'Bruno'], ['Gil', 'Carla', 'Ana']]));
  const MV2 = miniV('2026-11', V([['Ana', 'Bruno', 'Carla'], ['Carla', 'Bruno', 'Davi'], ['Davi', 'Bruno', 'Bruno'], ['Gil', 'Ana', 'Carla']]));
  const cV = makeEnv({ champs: [...MV1, ...MV2] }).api.mhCompare('Bruno', '2026-11');
  check('votos: Bola Cheia 1 → 3 (+2) melhorou; Bola Murcha 3 → 1 ("−2") também MELHOROU (menos é melhor)', rowOf(cV, 'pos').fa === '1' && rowOf(cV, 'pos').fb === '3' && rowOf(cV, 'pos').verdict === 'better' && rowOf(cV, 'neg').fa === '3' && rowOf(cV, 'neg').fb === '1' && rowOf(cV, 'neg').dText === '−2' && rowOf(cV, 'neg').verdict === 'better', cV.rows);
  check('final e votos só entram no comparativo quando os DOIS meses têm final e votação (os meses sem votação não trazem as linhas de votos e de finais)', !rowOf(c21, 'pos') && !rowOf(c21, 'neg') && !rowOf(c21, 'finals') && !rowOf(cV, 'finals'), [c21.rows.map(r => r.key), cV.rows.map(r => r.key)]);
  check('a liga sem final não compara finais: com OCT e uma cópia em novembro, a linha de finais aparece com final e some sem', (() => {
    const nov = OCT.map((c, i) => ({ ...c, id: 'n' + i, date: '2026-11-' + c.date.slice(8) }));
    const com = makeEnv({ champs: [...OCT, ...nov] }).api.mhCompare('Bruno', '2026-11'), sem = makeEnv({ champs: [...OCT, ...nov], appCfg: { hasFinais: false } }).api.mhCompare('Bruno', '2026-11');
    return !!rowOf(com, 'finals') && !rowOf(sem, 'finals') && com.better === 0 && com.worse === 0 && com.rows.every(r => r.verdict === 'same' && r.dText === '=');
  })());
  check('um mês igual ao outro dá tudo "=": nenhum melhorou nem piorou; a linha que ficou zero nos dois meses (Bola Murcha do Bruno) some e as outras 10 ficam', (() => {
    const nov = OCT.map((c, i) => ({ ...c, id: 'n' + i, date: '2026-11-' + c.date.slice(8) }));
    const c = makeEnv({ champs: [...OCT, ...nov] }).api.mhCompare('Bruno', '2026-11');
    return c.ok && c.better === 0 && c.worse === 0 && c.same === 10 && c.rows.length === 10 && !c.rows.some(r => r.key === 'neg') && c.rows.some(r => r.key === 'pos');
  })());
  check('sem mês anterior (o 1º mês), com o mês em andamento e com menos de 2 campeonatos jogados, o comparativo diz por quê', (() => {
    const w = (champs, name, month, now) => makeEnv({ champs, now: now || '2027-03-10T15:00:00.000Z' }).api.mhCompare(name, month);
    const M1b = M1.map((c, i) => (i === 0 ? c : { ...c, teamRosters: { azul: ['Ana', 'Gil'], verde: VERDE } })), M2b = M2.map((c, i) => (i === 0 ? c : { ...c, teamRosters: { azul: ['Ana', 'Gil'], verde: VERDE } }));
    return w([...M1, ...M2], 'Bruno', '2026-10').why === 'sem-anterior' && w([...M1, ...M2], 'Bruno', '2099-01').why === 'sem-anterior' && w([...M1, ...M2], 'Bruno', '2026-11', '2026-11-20T15:00:00.000Z').why === 'parcial'
      && w([...M1b, ...M2], 'Bruno', '2026-11').why === 'poucos-a' && w([...M1, ...M2b], 'Bruno', '2026-11').why === 'poucos-b' && w([...M1, ...M2], 'Zé', '2026-11').why === 'poucos-a' && w([...M1b, ...M2], 'Bruno', '2026-11').ok === false;
  })());
  const M2p = M2.map((c, i) => (i === 2 ? { ...c, teamRosters: { azul: ['Ana', 'Gil'], verde: VERDE }, champion_players: c.champion_players.filter(p => p.name !== 'Bruno') } : c)); // o Bruno faltou ao 3º campeonato de novembro
  const cP = makeEnv({ champs: [...M1, ...M2p], now: '2027-03-10T15:00:00.000Z' }).api.mhCompare('Bruno', '2026-11');
  check('presença: de 3 de 3 campeonatos (100%) para 2 de 3 (67%) é "−33 pts" e PIOROU, e os títulos de 1 para 2 melhoraram junto', cP.ok && rowOf(cP, 'pres').fa === '100%' && rowOf(cP, 'pres').fb === '67%' && rowOf(cP, 'pres').dText === '−33 pts' && rowOf(cP, 'pres').verdict === 'worse' && rowOf(cP, 'titles').dText === '+1' && rowOf(cP, 'titles').verdict === 'better', [rowOf(cP, 'pres'), rowOf(cP, 'titles')]);
  const M1g = M1.map((c, i) => (i === 0 ? { ...c, matches: [mt('azul', 'verde', 2, 1, ['Bruno', 'Gil'])] } : c)), M2g = M2.map((c, i) => (i === 0 ? { ...c, matches: [mt('azul', 'verde', 3, 0, ['Bruno', 'Bruno', 'Gil'])] } : c));
  const cGg = makeEnv({ champs: [...M1g, ...M2g], now: '2027-03-10T15:00:00.000Z' }).api.mhCompare('Gil', '2026-11');
  check('o goleiro que fez gol nos dois meses continua sem comparar gols, gols por jogo nem artilharias (são números de jogador de linha): as mesmas 7 linhas do goleiro', cGg.ok && J(cGg.rows.map(r => r.key)) === '["pres","apr","w","l","titles","gapj","cs"]', cGg.rows && cGg.rows.map(r => r.key));
  check('…e o jogador de linha que fez gol nos dois meses compara os gols (1 → 3), os gols por jogo e as artilharias, mas não os gols sofridos', (() => { const c = makeEnv({ champs: [...M1g, ...M2g], now: '2027-03-10T15:00:00.000Z' }).api.mhCompare('Bruno', '2026-11'); return c.ok && !rowOf(c, 'gapj') && !rowOf(c, 'cs') && rowOf(c, 'goals').fa === '1' && rowOf(c, 'goals').fb === '3'; })());
  check('o comparativo também não sai se o mês ANTERIOR ainda está aberto (um campeonato de outubro em andamento), mesmo com novembro já fechado', (() => {
    const aberto = [...M1, camp('ativo', '2026-10-30', { status: 'active', champ: [] })];
    const e = makeEnv({ champs: [...aberto, ...M2], now: '2027-03-10T15:00:00.000Z' }).api;
    return e.getMonthHighlights().byMonth['2026-10'].closed === false && e.getMonthHighlights().byMonth['2026-11'].closed === true && e.mhCompare('Bruno', '2026-11').why === 'parcial';
  })());
  const semFinalNoMes = c => ({ ...c, matches: c.matches.map(m => ({ ...m, phase: 'regular' })) });
  const novOct = OCT.map((c, i) => ({ ...c, id: 'n' + i, date: '2026-11-' + c.date.slice(8) }));
  check('final só no mês novo (ou só no antigo): a linha de finais não aparece; votação só no mês novo (ou só no antigo): as linhas de votos não aparecem', (() => {
    const k = (champs, cfg) => makeEnv({ champs, appCfg: cfg }).api.mhCompare('Bruno', '2026-11').rows.map(r => r.key).filter(x => ['finals', 'pos', 'neg'].includes(x)).join();
    const novSemVoto = novOct.map(stripVoting), octSemVoto = OCT.map(stripVoting);
    return k([...OCT.map(semFinalNoMes), ...novOct], {}) === 'pos' && k([...OCT, ...novOct.map(semFinalNoMes)], {}) === 'pos' && k([...OCT, ...novSemVoto], {}) === 'finals' && k([...octSemVoto, ...novOct], {}) === 'finals' && k([...OCT, ...novOct], {}) === 'finals,pos';
  })(), null);
  check('o mês anterior é o anterior que VALE: sem novembro, dezembro compara com outubro', makeEnv({ champs: [...M1, ...M3] }).api.mhCompare('Bruno', '2026-12').monthA === '2026-10' && makeEnv({ champs: [...M1, ...M3] }).api.mhCompare('Bruno', '2026-12').ok === true);
  check('as mensagens de por que não compara (mmWhy) falam do mês certo', (() => { const e = makeEnv({ champs: [...M1, ...M2], now: '2026-12-10T15:00:00.000Z' }).api; return /primeiro mês com destaques/.test(e.mmWhy({ why: 'sem-anterior' })) && /só sai com os dois meses fechados/.test(e.mmWhy({ why: 'parcial' })) && /menos de 2 campeonatos em outubro/.test(e.mmWhy({ why: 'poucos-a', monthA: '2026-10', monthB: '2026-11' })) && /menos de 2 campeonatos em novembro/.test(e.mmWhy({ why: 'poucos-b', monthA: '2026-10', monthB: '2026-11' })) && e.mmWhy({ why: 'x' }) === ''; })());

  // ══ 16. O CARD "MEU MÊS" NA ABA MEU CRAQUE ══════════════════════════════════════════════════════════════════
  const ce = makeEnv({ champs: [...M1, ...M2], now: '2026-12-10T15:00:00.000Z' });
  ce.st._mmShare = { name: 'Bruno', league: 'Liga X', photo: '' };
  const m0 = ce.api.mmCard('Bruno', false);
  check('o card abre no mês mais novo (novembro, fechado): título, ◀ ▶, os dois botões (Meu mês marcado), os quadradinhos, os destaques e o botão de compartilhar', /Meu mês · novembro/.test(m0) && !/PARCIAL/.test(m0) && /Nov\/26 · 3 campeonatos/.test(m0) && /mmSetMonth\('2026-10'\)/.test(m0) && /disabled aria-label="Próximo mês"/.test(m0) && /onclick="mmSetMode\('mes'\)" aria-pressed="true"/.test(m0) && /onclick="mmSetMode\('comparar'\)" aria-pressed="false"/.test(m0) && /Comparar com o mês anterior/.test(m0) && /Presença/.test(m0) && /Aproveitamento/.test(m0) && /Destaques do mês/.test(m0) && /🏆 Maior Campeão do Mês/.test(m0) && /openMjMeuMes\(\)/.test(m0) && /📤 Compartilhar meu mês/.test(m0), m0.slice(0, 700));
  check('o botão de compartilhar só existe no PRÓPRIO perfil: na simulação do admin ou sem os dados da aba (st._mmShare) não aparece', !/openMjMeuMes/.test(ce.api.mmCard('Bruno', true)) && (() => { const e2 = makeEnv({ champs: [...M1, ...M2], now: '2026-12-10T15:00:00.000Z' }); return !/openMjMeuMes/.test(e2.api.mmCard('Bruno', false)); })());
  ce.api.mmSetMode('comparar');
  const m1 = ce.api.mmCard('Bruno', false);
  check('"Comparar com o mês anterior": o placar (7 melhoraram, 0 pioraram, 1 igual), a tabela com ▲ +56 pts, o aviso "menos é melhor" e o botão do comparativo; sem os quadradinhos', ce.st.mmMode === 'comparar' && ce.calls.renders === 1 && /▲ 7 melhoraram/.test(m1) && /▼ 0 pioraram/.test(m1) && /= 1 igual/.test(m1) && /Aproveitamento/.test(m1) && /▲ \+56 pts/.test(m1) && /menos é melhor/.test(m1) && /openMjComparativo\(\)/.test(m1) && !/openMjMeuMes/.test(m1) && !/Liderando|Destaques do mês/.test(m1) && /onclick="mmSetMode\('comparar'\)" aria-pressed="true"/.test(m1), m1.slice(0, 900));
  ce.api.mmSetMonth('2026-10');
  check('no 1º mês o comparativo explica que ainda não há mês anterior e não mostra botão de compartilhar', /primeiro mês com destaques/.test(ce.api.mmCard('Bruno', false)) && !/openMjComparativo/.test(ce.api.mmCard('Bruno', false)) && ce.st.mmMonth === '2026-10');
  ce.api.mmSetMode('mes'); ce.api.mmSetMonth('2020-01');
  check('mês escolhido que não existe volta para o mais novo; voltar para a visão do mês funciona', ce.api.mmSelected('Bruno') === '2026-11' && ce.st.mmMode === 'mes' && ce.api.mmNavMonths('Bruno').join() === '2026-10,2026-11' && ce.api.mmNavMonths('Zé').length === 0);
  const pe = makeEnv({ champs: [...M1, ...M2], now: '2026-11-20T15:00:00.000Z' }); pe.api.mmSetMode('comparar');
  check('mês em andamento: marca PARCIAL e o comparativo diz que só sai com os dois meses fechados (e "Liderando até agora" no Meu mês)', /PARCIAL/.test(pe.api.mmCard('Bruno', false)) && /só sai com os dois meses fechados/.test(pe.api.mmCard('Bruno', false)) && (() => { pe.api.mmSetMode('mes'); return /Liderando até agora/.test(pe.api.mmCard('Bruno', false)); })());
  const mx = makeEnv({ champs: [...M1, ...M2] }); mx.api.mmSetMonth('2026-11'); mx.api.mmSetMode('comparar');
  check('o aviso de poucos jogos cita o mês: jogou 1 campeonato em outubro', (() => { const e = makeEnv({ champs: [...M1.map((c, i) => (i === 0 ? c : { ...c, teamRosters: { azul: ['Ana', 'Gil'], verde: VERDE } })), ...M2], now: '2026-12-10T15:00:00.000Z' }); e.api.mmSetMode('comparar'); return /menos de 2 campeonatos em outubro/.test(e.api.mmCard('Bruno', false)); })());
  check('o admin desligou os destaques do mês: o card some; quem não jogou mês nenhum não vê o card', makeEnv({ champs: OCT, appCfg: { monthBadges: false } }).api.mmCard('Bruno', false) === '' && makeEnv({ champs: OCT }).api.mmCard('Hugo', false) === '' && makeEnv({ champs: OCT.slice(0, 2) }).api.mmCard('Bruno', false) === '');
  check('o goleiro vê gols sofridos e jogos sem sofrer gol no card (e não gols nem artilharias)', (() => { const h = makeEnv({ champs: OCT }).api.mmCard('Gil', false); return /Gols sofridos/.test(h) && /Sem sofrer gol/.test(h) && !/>Artilharias</.test(h); })());

  // ══ 17. A IMAGEM DO MEU MÊS E A DO COMPARATIVO ══════════════════════════════════════════════════════════════
  const cpData0 = makeEnv({ champs: [...M1, ...M2, ...M3], now: '2027-01-10T15:00:00.000Z' }).api;
  const nm = A26.mjMeuMesData({ name: ' Bruno Silva ', league: ' Liga X ', photo: 'https://img.exemplo.com/b.jpg', monthName: 'outubro', partial: false, tiles: A26.mmTiles(A26.mhPlayerMonth('Bruno', '2026-10')), badges: A26.mhPlayerMonth('Bruno', '2026-10').won });
  check('os dados do Meu mês: nome limpo, iniciais, foto só em https, os 9 quadradinhos, os destaques, dourado no mês fechado e verde no parcial', nm.name === 'Bruno Silva' && nm.initials === 'BS' && nm.photo === 'https://img.exemplo.com/b.jpg' && A26.mjMeuMesData({ name: 'x', photo: 'http://a/b.jpg' }).photo === '' && nm.tiles.length === 9 && nm.badges.length === 10 && nm.tier === 'legendary' && A26.mjMeuMesData({ partial: true }).tier === 'common' && A26.mjMeuMesData({}).monthName === 'mês' && A26.mjMeuMesData({}).name === 'Jogador' && A26.mjMeuMesData({ tiles: Array.from({ length: 15 }, (_, i) => ({ label: 'L' + i, value: '1' })) }).tiles.length === 10, nm);
  const paintW = (fn, data, photo = null, logo = null) => { const f = fakeCtx(); fn(f.ctx, data, photo, logo); return f.log; };
  check('a foto do comparativo também só vale em https, e o comparativo limpa o nome e a liga', cpData0.mjComparativoData({ name: ' Bruno Silva ', league: ' Liga X ', photo: 'http://a/b.jpg' }).photo === '' && cpData0.mjComparativoData({ photo: 'https://a/b.jpg' }).photo === 'https://a/b.jpg' && cpData0.mjComparativoData({ name: ' Bruno Silva ', league: ' Liga X ' }).initials === 'BS' && cpData0.mjComparativoData({ name: ' Bruno Silva ', league: ' Liga X ' }).league === 'Liga X' && cpData0.mjComparativoData({}).name === 'Jogador');
  const manyB = Array.from({ length: 15 }, (_, i) => ({ emoji: '🏅', label: 'Destaque ' + i }));
  check('com muitos destaques a imagem mostra 12 emojis e o "+N" do resto (+3), e os nomes cabem em uma linha só', (() => { const f = paintW(A26.drawMjMeuMesCard, A26.mjMeuMesData({ ...nm, badges: manyB })); return f.filter(l => l.op === 'text' && l.t === '🏅').length === 12 && f.some(l => l.op === 'text' && l.t === '+3') && A26.mjMeuMesData({ ...nm, badges: manyB }).badges.length === 15 && A26.mjMeuMesData({ ...nm, badges: Array.from({ length: 30 }, (_, i) => ({ emoji: '🏅', label: 'D' + i })) }).badges.length === 20; })());
  const mmL = paintW(A26.drawMjMeuMesCard, nm);
  check('o Meu mês desenha "MEU MÊS", o nome em maiúsculas, o mês, os quadradinhos (rótulos, valores e apoio), os destaques e o rodapé', (() => { const t = texts(mmL); return t.includes('MEU MÊS') && t.includes('BRUNO SILVA') && t.includes('OUTUBRO') && t.includes('PRESENÇA') && t.includes('100%') && t.includes('4 de 4 campeonatos') && t.includes('JOGOS') && t.includes('8V · 1E · 3D') && t.includes('APROVEITAMENTO') && t.includes('69%') && t.includes('GOLS') && t.includes('0,83 por jogo') && t.includes('BOLA CHEIA') && t.includes('DESTAQUES DO MÊS') && t.includes('🏆') && t.includes('Liga X') && t.includes('Crie a liga da sua pelada') && t.includes('peladanamao.com.br'); })(), texts(mmL));
  check('o Meu mês parcial diz "MEU MÊS · PARCIAL" e "LIDERANDO ATÉ AGORA"; sem destaques a faixa some e os quadradinhos ganham o espaço', (() => { const p = texts(paintW(A26.drawMjMeuMesCard, A26.mjMeuMesData({ ...nm, partial: true, monthName: 'outubro' }))); const s = texts(paintW(A26.drawMjMeuMesCard, A26.mjMeuMesData({ ...nm, badges: [] }))); return p.includes('MEU MÊS · PARCIAL') && p.includes('LIDERANDO ATÉ AGORA') && !texts(mmL).some(x => /PARCIAL|LIDERANDO/.test(x)) && !s.includes('DESTAQUES DO MÊS'); })());
  check('nada passa do lugar: com 9 quadradinhos e os destaques, todos os quadradinhos terminam antes de y = 1030 e os destaques ficam entre 1060 e 1190 (folga para a chamada do rodapé); sem destaques os quadradinhos vão até 1170', (() => { const tiles = mmL.filter(l => l.op === 'text' && l.y > 560 && l.y < 1070 && /^(100%|12|69%|3|10|2|4|9|0)$/.test(l.t)); const bad = mmL.filter(l => l.op === 'text' && l.y > 1070 && l.y < 1215).length; const none = paintW(A26.drawMjMeuMesCard, A26.mjMeuMesData({ ...nm, badges: [] })).filter(l => l.op === 'text' && l.y > 560 && l.y < 1175); return tiles.length >= 9 && Math.max(...tiles.map(l => l.y)) <= 1030 && bad > 0 && none.length > 0 && Math.max(...none.map(l => l.y)) <= 1175 && Math.max(...mmL.filter(l => l.op === 'text' && l.t !== 'Crie a liga da sua pelada' && l.t !== 'peladanamao.com.br').map(l => l.y)) <= 1190; })());
  check('a foto de quem compartilha vai no cartão (a logo e a foto são as 2 imagens); sem elas, nenhuma', paintW(A26.drawMjMeuMesCard, nm).every(l => l.op !== 'img') && (() => { const f = fakeCtx(); A26.drawMjMeuMesCard(f.ctx, nm, { fake: 'foto' }, { fake: 'logo' }); return f.log.filter(l => l.op === 'img').map(l => l.img.fake).sort().join() === 'foto,logo'; })());
  check('o Story do Meu mês é o mesmo cartão escalado (250 em cima e 340 embaixo)', (() => { const sl = paintW(A26.drawMjMeuMesStory, nm), k = (1920 - 250 - 340) / 1350, sc = sl.find(l => l.op === 'scale'); return Math.abs(sc.x - k) < 1e-9 && sl.find(l => l.op === 'translate').y === 250 && texts(sl).includes('MEU MÊS'); })());
  const cpData = cmpEnv(M3, '2027-01-10T15:00:00.000Z'); // os três meses (outubro, novembro e dezembro) já fechados
  const cmpB = cpData.mhCompare('Bruno', '2026-11'), cmpW = cpData.mhCompare('Bruno', '2026-12');
  const nc = cpData.mjComparativoData({ name: 'Bruno', league: 'Liga X', photo: '', monthA: 'outubro', monthB: 'novembro', rows: cmpB.rows }), nw = cpData.mjComparativoData({ name: 'Bruno', league: 'Liga X', monthA: 'novembro', monthB: 'dezembro', rows: cmpW.rows });
  check('os dados do comparativo: placar de 7 melhoraram, 0 pioraram e 1 igual; dourado se melhorou mais, azul se piorou mais, verde se empatou; linhas limpas (veredito estranho vira "igual") e no máximo 13', nc.better === 7 && nc.worse === 0 && nc.same === 1 && nc.tier === 'legendary' && nw.worse === 7 && nw.tier === 'rare' && cpData.mjComparativoData({ rows: [{ label: 'a', fa: '1', fb: '1', dText: '=', verdict: 'x' }] }).tier === 'common' && cpData.mjComparativoData({ rows: [{ label: 'a', verdict: 'x' }] }).rows[0].verdict === 'same' && cpData.mjComparativoData({ rows: Array.from({ length: 20 }, (_, i) => ({ label: 'L' + i, verdict: 'better' })) }).rows.length === 13 && cpData.mjComparativoData({}).monthA === 'mês anterior' && cpData.mjComparativoData({}).monthB === 'mês', [nc.better, nc.worse, nc.same, nc.tier]);
  const cpL = paintW(cpData.drawMjComparativoCard, nc);
  check('o comparativo desenha o título "MEU MÊS · NOVEMBRO × OUTUBRO", o nome, o placar em 3 pílulas, os dois meses no cabeçalho (OUT e NOV) e cada linha (número, antes, agora e a variação)', (() => { const t = texts(cpL); return t.includes('MEU MÊS · NOVEMBRO × OUTUBRO') && t.includes('BRUNO') && t.includes('▲ 7 MELHORARAM') && t.includes('▼ 0 PIORARAM') && t.includes('= 1 IGUAL') && t.includes('OUT') && t.includes('NOV') && t.includes('Aproveitamento') && t.includes('44%') && t.includes('100%') && t.includes('▲ +56 pts') && t.includes('Gols por jogo') && t.includes('0,33') && t.includes('▲ +0,67') && t.includes('=') && t.includes('Crie a liga da sua pelada'); })(), texts(cpL));
  check('o cabeçalho OUT/NOV fica logo acima da primeira linha da tabela (de 20 a 70 px), com 8 linhas ou com 13', (() => { const gap = f => f.find(l => l.op === 'text' && l.t === 'Presença' || l.op === 'text' && l.t === 'Número 0').y - f.find(l => l.op === 'text' && l.t === 'OUT').y; const rows13 = Array.from({ length: 13 }, (_, i) => ({ label: 'Número ' + i, fa: String(i), fb: String(i + 1), dText: '+1', verdict: 'better' })); const f13 = paintW(cpData.drawMjComparativoCard, cpData.mjComparativoData({ monthA: 'outubro', monthB: 'novembro', rows: rows13 })); return gap(cpL) > 20 && gap(cpL) < 70 && gap(f13) > 20 && gap(f13) < 70; })());
  check('as cores: verde na melhora e vermelho na piora (delta), cinza no "=", moldura dourada no mês melhor e azul no pior', (() => { const fill = (log, t) => log.find(l => l.op === 'text' && l.t === t)?.fill; const wl = paintW(cpData.drawMjComparativoCard, nw); return fill(cpL, '▲ +56 pts') === '#00d67f' && fill(wl, '▼ −100 pts') === '#ff7b72' && fill(cpL, '=') === '#8b949e' && cpL.some(l => l.op === 'stroke' && l.color === '#f0b429') && wl.some(l => l.op === 'stroke' && l.color === '#4db8ff') && fill(cpL, '▲ 7 MELHORARAM') === '#00d67f' && fill(cpL, '▼ 0 PIORARAM') === '#ff7b72'; })(), null);
  check('no singular: 1 melhorou, 1 piorou, 1 igual', (() => { const d = cpData.mjComparativoData({ monthA: 'a', monthB: 'b', rows: [{ label: 'x', fa: '1', fb: '2', dText: '+1', verdict: 'better' }, { label: 'y', fa: '2', fb: '1', dText: '−1', verdict: 'worse' }, { label: 'z', fa: '1', fb: '1', dText: '=', verdict: 'same' }] }); const t = texts(paintW(cpData.drawMjComparativoCard, d)); return t.includes('▲ 1 MELHOROU') && t.includes('▼ 1 PIOROU') && t.includes('= 1 IGUAL'); })());
  check('com 13 linhas (o máximo) a tabela cabe: o último texto termina antes de y = 1190 e o texto das linhas nunca fica menor que 18 px', (() => { const rows13 = Array.from({ length: 13 }, (_, i) => ({ label: 'Número ' + i, fa: String(i), fb: String(i + 1), dText: '+1', verdict: 'better' })); const f = paintW(cpData.drawMjComparativoCard, cpData.mjComparativoData({ monthA: 'outubro', monthB: 'novembro', rows: rows13 })); const lab = f.filter(l => l.op === 'text' && /^Número/.test(l.t)); return lab.length === 13 && Math.max(...lab.map(l => l.y)) <= 1190 && lab.every(l => +(/(\d+)px/.exec(l.font)[1]) >= 18); })());
  check('o Story do comparativo é o mesmo cartão escalado', (() => { const sl = paintW(cpData.drawMjComparativoStory, nc), k = (1920 - 250 - 340) / 1350; return Math.abs(sl.find(l => l.op === 'scale').x - k) < 1e-9 && texts(sl).includes('▲ 7 MELHORARAM'); })());
  check('o resumo do comparativo em primeira pessoa: melhorou mais, piorou mais, empate e tudo igual', (() => { const v = (better, worse, same) => cpData.mjComparativoVerdict({ better, worse, same }); return v(5, 2, 1) === 'Melhorei em 5 números e piorei em 2!' && v(1, 0, 3) === 'Melhorei em 1 número!' && v(2, 5, 0) === 'Piorei em 5 números e melhorei em 2' && v(0, 1, 4) === 'Piorei em 1 número' && v(3, 3, 0) === 'Melhorei em 3 e piorei em 3: empate!' && v(0, 0, 6) === 'Tudo igual ao mês anterior'; })());
  const capM = A26.mjMeuMesCaption(nm), capMp = A26.mjMeuMesCaption({ ...nm, partial: true }), capC = cpData.mjComparativoCaption(nc);
  check('as legendas não levam nome de jogador nem da liga: Meu mês (com "(parcial)" no mês aberto) e o comparativo (com o resumo e o link do cartão)', /Meu outubro no Pelada na Mão/.test(capM) && !/parcial/.test(capM) && /\(parcial\)/.test(capMp) && /ref=cartao/.test(capM) && /#pelada #futebolamador #peladanamao/.test(capM) && !/Bruno|Liga X/.test(capM + capMp + capC) && /Meu novembro contra o outubro no Pelada na Mão/.test(capC) && /Melhorei em 7 números!/.test(capC) && /ref=cartao/.test(capC), [capM, capC]);

  // abrir a janela de compartilhar: só no próprio perfil
  const sh = makeEnv({ champs: [...M1, ...M2], now: '2026-12-10T15:00:00.000Z' });
  sh.api.openMjMeuMes(); sh.api.openMjComparativo();
  check('sem os dados da aba (st._mmShare, que só existe no próprio perfil) nenhuma das duas janelas abre e nem aviso aparece', sh.calls.shared.length === 0 && sh.calls.toasts.length === 0);
  sh.st._mmShare = { name: 'Bruno', league: 'Liga X', photo: 'https://img.exemplo.com/b.jpg' };
  sh.api.openMjMeuMes();
  check('openMjMeuMes abre a janela do tipo "meumes" com o mês escolhido (novembro), os quadradinhos, os destaques sem os negativos e a foto de quem compartilha', sh.calls.shared.length === 1 && sh.calls.shared[0][0] === 'meumes' && sh.calls.shared[0][1].name === 'Bruno' && sh.calls.shared[0][1].monthName === 'novembro' && sh.calls.shared[0][1].partial === false && sh.calls.shared[0][1].tiles.length >= 4 && sh.calls.shared[0][1].photo === 'https://img.exemplo.com/b.jpg' && sh.calls.shared[0][1].badges.every(b => b.label !== 'Perna de Pau do Mês'), sh.calls.shared[0]);
  sh.api.openMjComparativo();
  check('o Meu mês compartilhado não leva as conquistas negativas: o Edu levou o Perna de Pau, o Pé Frio e o Cartão Ponto em outubro e a imagem só leva o Cartão Ponto', (() => { const e = makeEnv({ champs: OCT }); e.st._mmShare = { name: 'Edu', league: 'L', photo: '' }; e.api.openMjMeuMes(); const d = e.calls.shared[0]?.[1]; return !!d && J(d.badges.map(b => b.label)) === '["Cartão Ponto"]' && e.api.mhPlayerMonth('Edu', '2026-10').won.length === 3; })());
  check('openMjComparativo abre a janela do tipo "comparativo" (novembro contra outubro, 8 linhas)', sh.calls.shared.length === 2 && sh.calls.shared[1][0] === 'comparativo' && sh.calls.shared[1][1].monthA === 'outubro' && sh.calls.shared[1][1].monthB === 'novembro' && sh.calls.shared[1][1].rows.length === 8 && sh.calls.shared[1][1].better === 7, sh.calls.shared[1]);
  sh.api.mmSetMonth('2026-10'); sh.api.openMjComparativo();
  check('no 1º mês o comparativo não abre e avisa; quem não tem números no mês avisa também', sh.calls.shared.length === 2 && /Ainda não dá para comparar/.test(sh.calls.toasts.at(-1)?.[0] || '') && (() => { const e = makeEnv({ champs: OCT }); e.st._mmShare = { name: 'Hugo', league: 'L', photo: '' }; e.api.openMjMeuMes(); return e.calls.shared.length === 0 && /não tem números neste mês/.test(e.calls.toasts.at(-1)?.[0] || ''); })());

  // ══ 18. AS LIGAÇÕES NO APP (entrega 2) ═══════════════════════════════════════════════════════════════════════
  check('o card Meu mês fica na aba Meu Craque logo depois do Resumo de Jogos e antes das Sequências', /<span class="card-lbl">Resumo de Jogos<\/span>[\s\S]*?<\/div>`:''\}\s*\$\{mmCard\(myName, isSimulating\)\}\s*\$\{\(\(\)=>\{\s*const rowS=/.test(html));
  check('o que a imagem leva (nome, liga e foto) só existe fora da simulação do admin', /st\._mmShare = !isSimulating \? \{ name: myName, league: st\.availableLeagues\.find\(l => l\.id === st\.leagueId\)\?\.name, photo: st\.photos\?\.\[myKey\] \} : null;/.test(html));
  check('os tipos de cartão "meumes" e "comparativo" (arquivos, desenhos dos dois formatos, legendas)', /meumes: \{\s*title: '📤 Meu mês'[\s\S]*?meu-mes-pelada-na-mao-story\.png[\s\S]*?meu-mes-pelada-na-mao\.png[\s\S]*?draw: \{ feed: drawMjMeuMesCard, story: drawMjMeuMesStory \}[\s\S]*?caption: d => mjMeuMesCaption\(d\)/.test(html) && /comparativo: \{\s*title: '📤 Meu mês × mês anterior'[\s\S]*?evolucao-pelada-na-mao-story\.png[\s\S]*?evolucao-pelada-na-mao\.png[\s\S]*?draw: \{ feed: drawMjComparativoCard, story: drawMjComparativoStory \}[\s\S]*?caption: d => mjComparativoCaption\(d\)/.test(html));
  check('o interruptor do admin descreve o Meu mês e o comparativo', /entrega as conquistas do mês, mostra o card na aba Ranking e o Meu mês e o comparativo na aba Meu Craque/.test(html) && /Desligados, as conquistas, o card, o Meu mês e o comparativo somem para todo o grupo/.test(html));
  check('as conquistas de resultado em campo estão ligadas aos números do motor: o catálogo lê pe_quente, pe_frio, invicto, paredao e pipoca', ['pe_quente', 'pe_frio', 'invicto', 'paredao', 'pipoca'].every(k => new RegExp('s\\.mh\\?\\.n\\.' + k).test(catalogText)));

  // ══ 19. O MANUAL (entrega 2) ═════════════════════════════════════════════════════════════════════════════════
  check('o manual tem as subseções do Meu mês e do Comparativo, com os números, as visões, o ▲▼=, o "menos é melhor" e a regra de só no próprio perfil', /id="meu-mes"/.test(sec) && /id="comparativo-meses"/.test(sec) && /<strong>presença<\/strong>/.test(sec) && /<strong>aproveitamento<\/strong> de pontos/.test(sec) && /<strong>gols sofridos<\/strong>/.test(sec) && /<strong>▲ verde<\/strong> \(melhorou\), <strong>▼ vermelho<\/strong> \(piorou\) ou <strong>=<\/strong> \(igual\)/.test(sec) && /menos é melhor/.test(sec) && /Só no <strong>próprio perfil<\/strong>/.test(sec) && /sem os negativos/.test(sec));
  check('o manual diz quando o comparativo não sai (primeiro mês, mês em andamento, menos de 2 campeonatos) e que os dois cards somem com o interruptor', /<td>É o primeiro mês com destaques/.test(sec) && /<td>Um dos dois meses ainda está em andamento/.test(sec) && /<td>A pessoa jogou menos de 2 campeonatos num dos meses/.test(sec) && /somem junto com o resto quando o admin desliga os destaques do mês/.test(sec));
  check('o manual traz as regras novas: 5 jogos no mês, 2 goleiros para o Paredão, o Pé Quente sem arredondar, a Pipoca e o Craque contando o Pé Quente e o Paredão', /<tr><td>Jogos no mês<\/td><td>Pé Quente, Pé Frio, Invicto e Paredão exigem pelo menos <strong>5 jogos<\/strong>/.test(sec) && /pelo menos <strong>2 goleiros<\/strong> concorrendo/.test(sec) && /Se todos têm o mesmo aproveitamento, ninguém leva/.test(sec) && /final empatada vale o time que perdeu nos pênaltis/.test(sec) && /o Xodó, o Pé Quente e o Paredão; o Perna de Pau, o Pé Frio, a Pipoca e os feitos \(Cartão Ponto, Marca Todas, Varreu o Mês e Invicto\)/.test(sec));
  check('o manual descreve o card encolhido (mais de 9 linhas) e as contas do resultado em campo no bloco técnico', /Com mais de 9 linhas o cartão encolhe o alto/.test(sec) && /mesmas contas do Resumo de Jogos/.test(sec) && /mhPlayerMonth<\/code>\) e o comparativo \(<code>mhCompare<\/code>\)/.test(sec));
  check('o manual lista os arquivos das duas imagens novas na tabela dos cartões', manual.includes('<code>meu-mes-pelada-na-mao-story.png</code> / <code>meu-mes-pelada-na-mao.png</code>') && manual.includes('<code>evolucao-pelada-na-mao-story.png</code> / <code>evolucao-pelada-na-mao.png</code>'));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})();
