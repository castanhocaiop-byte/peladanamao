// Destaques do mês (item 42), no app: quem foi o Maior Campeão, o Artilheiro, o Rei das Artilharias, o Rei das Finais e das Artilharias de Finais, o Xodó e o Perna de Pau (votos totais), os feitos
// (Cartão Ponto, Marca Todas, Varreu o Mês), o Craque do Mês, a Hegemonia e a Dinastia; o mês que fecha, os mínimos, o empate, o goleiro; as 13 conquistas do catálogo; o card da aba Ranking; a imagem
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
  const body = [escCode, keyCode, timeCode, closedCode, fmtMonthCode, voteCode, finalsCode, mjConstCode, tierCode, mjHelpersCode, mjStoryCode, mjDataCode, captionCode, mhCode].join('\n') + `
return { getMonthHighlights, mhRankingCard, mhShareData, mhNavMonths, mhSelected, mhSetMonth, openMjDestaques, monthAwardStats, mhTimes, mhMonthsOf, mhHolderNote, mjDestaquesData, drawMjDestaquesCard,
  drawMjDestaquesStory, mjDestaquesCaption, mjNamesText, mhRows, mhBuildMonth, mhLines, monthBadgesOn, MH_LEADERS, MH_FEATS, MH_BADGE_IDS, MH_BY_BADGE, MH_FIRST, MH_MIN_CHAMPS, MH_MIN_PLAYED,
  MH_MIN_REPEAT, MH_MIN_VOTINGS, rivalMonthClosed, localDate, brtMonth, monthLabel, fmtMonth, mhNum, mhValueText, MJ_CARD, MJ_STORY, finalsEnabled, votingUsed };`;
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
  check('Craque do Mês: o Bruno, que levou 6 dos destaques (a Ana 3, o Gil 2, a Carla 1); o Perna de Pau e os feitos não entram na conta', J(oct.craque) === '{"names":["Bruno"],"value":6}', oct.craque);
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
  check('o que cada jogador leva para as conquistas (monthAwardStats): Bruno tem 9 tipos de destaque, cada um 1 vez, e os meses', Object.keys(ms.n).length === 9 && Object.values(ms.n).every(v => v === 1) && J(ms.months.xodo) === '["2026-10"]' && ms.hegemonia === false, ms);
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

  // ══ 8. AS 13 CONQUISTAS DO CATÁLOGO ════════════════════════════════════════════════════════════════
  const makeCat = (appCfg = {}, champs = OCT) => { const e = makeEnv({ champs, appCfg }); return new Function('monthBadgesOn', 'finalsEnabled', 'votingUsed', 'return [' + catalogText + ']')(e.api.monthBadgesOn, e.api.finalsEnabled, e.api.votingUsed); };
  const CAT = makeCat();
  check('13 conquistas novas no catálogo, com estes códigos, na mesma ordem de MH_BADGE_IDS', CAT.length === 13 && J(CAT.map(b => b.id)) === J(A.MH_BADGE_IDS) && J(CAT.map(b => b.id)) === '["mes_campeao","mes_artilheiro","mes_rei_art","mes_rei_art_final","mes_rei_finais","mes_xodo","mes_perna_pau","mes_cartao_ponto","mes_marca_todas","mes_varreu","mes_craque","mes_hegemonia","mes_dinastia"]', CAT.map(b => b.id));
  check('os nomes que o dono aprovou', J(CAT.map(b => b.label)) === '["Maior Campeão do Mês","Artilheiro do Mês","Rei das Artilharias do Mês","Rei das Artilharias de Finais do Mês","Rei das Finais do Mês","Xodó do Mês","Perna de Pau do Mês","Cartão Ponto","Marca Todas","Varreu o Mês","Craque do Mês","Hegemonia","Dinastia"]', CAT.map(b => b.label));
  check('as 4 de gol são só de jogador de linha (fieldOnly) e as outras 9 valem para o goleiro; nenhuma é só de goleiro', J(CAT.filter(b => b.fieldOnly).map(b => b.id)) === '["mes_artilheiro","mes_rei_art","mes_rei_art_final","mes_marca_todas"]' && CAT.every(b => !b.gkOnly));
  const by = Object.fromEntries(CAT.map(b => [b.id, b]));
  const stats = n => A.monthAwardStats(n);
  const has = n => CAT.filter(b => b.check(stats(n))).map(b => b.id);
  check('Bruno tem 9 das 13 conquistas (todas menos Perna de Pau, Varreu, Hegemonia e Dinastia)', J(has('Bruno')) === '["mes_campeao","mes_artilheiro","mes_rei_art","mes_rei_art_final","mes_rei_finais","mes_xodo","mes_cartao_ponto","mes_marca_todas","mes_craque"]', has('Bruno'));
  check('Edu tem só o Perna de Pau do Mês e o Cartão Ponto; a Fabi não tem nenhuma', J(has('Edu')) === '["mes_perna_pau","mes_cartao_ponto"]' && has('Fabi').length === 0, [has('Edu'), has('Fabi')]);
  check('Hegemonia e Dinastia só com a sequência (outubro sozinho não dá)', !by.mes_hegemonia.check(stats('Bruno')) && !by.mes_dinastia.check(stats('Bruno')) && by.mes_hegemonia.check({ mh: { n: {}, hegemonia: true } }) && by.mes_dinastia.check({ mh: { n: {}, dinastia: true } }));
  check('as conquistas não quebram com estatísticas sem o campo do mês (testes e telas antigas)', CAT.every(b => b.check({}) === false));
  const vis = cfg => makeCat(cfg).filter(b => b.visible()).map(b => b.id);
  check('visíveis com tudo ligado: as 13', vis({}).length === 13);
  check('o admin desligou os destaques do mês (monthBadges: false): as 13 somem', vis({ monthBadges: false }).length === 0);
  check('liga sem final: somem o Rei das Artilharias de Finais e o Rei das Finais (11 visíveis)', vis({ hasFinais: false }).length === 11 && !vis({ hasFinais: false }).includes('mes_rei_finais') && !vis({ hasFinais: false }).includes('mes_rei_art_final'));
  check('sem votação de Bola Cheia some o Xodó; sem a de Bola Murcha some o Perna de Pau (liga que nunca votou)', (() => { const a = makeCat({ votePos: false, voteNeg: true }, []).filter(b => b.visible()).map(b => b.id), b = makeCat({ votePos: true, voteNeg: false }, []).filter(x => x.visible()).map(x => x.id); return !a.includes('mes_xodo') && a.includes('mes_perna_pau') && b.includes('mes_xodo') && !b.includes('mes_perna_pau'); })());
  check('a descrição de cada conquista diz o mínimo (pelo menos 2, ou mês com 3 ou mais, ou meses seguidos)', CAT.every(b => /pelo menos 2|3 ou mais|seguidos/.test(b.desc)), CAT.map(b => b.desc));

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
  check('os dados da imagem: o nome da liga, o mês, 9 linhas (7 destaques + Cartão Ponto + Marca Todas), o Craque e nada de foto', sd.league === 'Liga X' && sd.monthName === 'outubro' && sd.partial === false && sd.rows.length === 9 && sd.craque.who === 'Bruno' && sd.craque.value === 6 && sd.tier === 'legendary' && !('photo' in sd), [sd.rows.length, sd.rows.map(r => r.label)]);
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
  check('no máximo 12 linhas', A.mjDestaquesData({ rows: Array.from({ length: 20 }, (_, i) => ({ label: 'L' + i, names: ['x'] })) }).rows.length === 12);

  // o desenho do Feed e do Story
  const paint = (data, story = false, photo = null, logo = null) => { const f = fakeCtx(); (story ? A.drawMjDestaquesStory : A.drawMjDestaquesCard)(f.ctx, data, photo, logo); return f.log; };
  const fl = paint(sd);
  check('o Feed desenha o alto (liga, "DESTAQUES DO MÊS", o mês em maiúsculas), o Craque, as linhas e o rodapé', (() => { const t = texts(fl); return t.includes('Liga X') && t.includes('DESTAQUES DO MÊS') && t.includes('OUTUBRO') && t.some(x => /CRAQUE DO MÊS · 6 DESTAQUES/.test(x)) && t.includes('Bruno') && t.includes('Ana · Bruno · Gil') && t.includes('10 GOLS') && t.includes('11 VOTOS') && t.includes('Crie a liga da sua pelada') && t.includes('peladanamao.com.br'); })(), texts(fl));
  check('cada linha leva o nome do destaque em maiúsculas e o emoji', (() => { const t = texts(fl); return t.includes('MAIOR CAMPEÃO') && t.includes('REI DAS ARTILHARIAS DE FINAIS') && t.includes('🏆') && t.includes('🥾') && t.includes('🥅'); })());
  check('as linhas começam abaixo da faixa do Craque (que termina em y = 518) e, sem Craque, logo abaixo do mês', (() => { const first = fl.find(l => l.op === 'text' && l.t === 'MAIOR CAMPEÃO'); const sem = paint(A26.mjDestaquesData({ rows: sd.rows, monthName: 'outubro' })).find(l => l.op === 'text' && l.t === 'MAIOR CAMPEÃO'); return first.y > 518 && sem.y > 400 && sem.y < first.y + 200; })());
  check('o texto do Craque fica dentro da faixa dele (entre y = 400 e 496)', (() => { const lab = fl.find(l => l.op === 'text' && /^CRAQUE DO MÊS/.test(l.t)), who = fl.find(l => l.op === 'text' && l.t === 'Bruno' && l.x === 170); return lab.y > 400 && lab.y < 496 && who.y > lab.y && who.y < 496; })());
  const partialData = makeEnv({ champs: OCT, now: '2026-10-29T15:00:00.000Z' }).api.mhShareData('2026-10');
  check('o mês parcial diz PARCIAL no alto e o mês fechado não', texts(paint(partialData)).includes('DESTAQUES DO MÊS · PARCIAL') && !texts(fl).some(x => /PARCIAL/.test(x)));
  check('a cor do Feed: dourado no mês fechado, verde no parcial; o Perna de Pau em vermelho', fl.some(l => l.op === 'stroke' && l.color === '#f0b429') && paint(partialData).some(l => l.op === 'stroke' && l.color === '#00d67f') && fl.some(l => l.op === 'text' && l.t === '11 VOTOS' && l.fill === '#ff7b72'));
  const lines = n => A.mjDestaquesData({ rows: Array.from({ length: n }, (_, i) => ({ emoji: '⚽', label: 'Destaque ' + i, names: ['Fulano'], value: i + ' gols' })), craque: n > 9 ? { names: ['Z'], value: 3 } : null, monthName: 'outubro' });
  check('com poucas ou muitas linhas nada passa do rodapé: a última linha termina antes de y = 1180 (1, 3, 9 e 12 linhas, com e sem o Craque)', [1, 3, 9, 12].every(n => { const t = paint(lines(n)).filter(l => l.op === 'text' && /^\d+ GOLS$/.test(l.t)); return t.length === n && Math.max(...t.map(x => x.y)) <= 1180; }));
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
  check('o manual tem a seção 33 e o índice (as duas listas) aponta para ela', sec.length > 3000 && (manual.match(/<a href="#destaques-do-mes"><span class="num">33<\/span> Destaques do Mês \(conquistas e card\)<\/a>/g) || []).length === 2 && /<span class="sn">33<\/span> Destaques do Mês/.test(sec), sec.length);
  check('a tabela do manual traz as 13 conquistas com o mesmo emoji e nome do catálogo', CAT.every(b => sec.includes('<tr><td>' + b.emoji + ' ' + b.label + '</td>')), CAT.filter(b => !sec.includes('<tr><td>' + b.emoji + ' ' + b.label + '</td>')).map(b => b.id));
  check('os números das regras do manual batem com o código (3 campeonatos, 2 jogados, repetir 2, 2 votações, outubro de 2026, 3 finais)', new RegExp('pelo menos <strong>' + A.MH_MIN_CHAMPS + ' campeonatos concluídos</strong>').test(sec) && new RegExp('pelo menos <strong>' + A.MH_MIN_PLAYED + '</strong> desses campeonatos').test(sec) && new RegExp('pelo menos <strong>' + A.MH_MIN_REPEAT + '</strong> \\(').test(sec) && new RegExp('pelo menos ' + A.MH_MIN_VOTINGS + ' votações encerradas').test(sec) && /<strong>Outubro de 2026<\/strong>/.test(sec) && A.MH_FIRST === '2026-10' && new RegExp('pelo menos ' + A.MH_MIN_CHAMPS + ' finais').test(sec));
  check('o manual explica o mês fechado (último dia, horário de Brasília, votação de 3 dias), o PARCIAL, o empate e o goleiro', /último dia do mês<\/strong> \(horário de Brasília\)/.test(sec) && /a votação dura 3 dias/.test(sec) && /<strong>PARCIAL<\/strong>/.test(sec) && /Todos os empatados levam/.test(sec) && /<tr><td>Goleiro<\/td>/.test(sec));
  check('o manual descreve o card (aba Ranking, setas, Craque do Mês, Story 9:16 e Feed 4:5, Compartilhar, Copiar legenda, Baixar)', /aba <strong>Ranking<\/strong>, no alto/.test(sec) && /Craque do Mês<\/strong> em destaque/.test(sec) && /Story 9:16<\/strong> ou <strong>Feed 4:5<\/strong>/.test(sec) && /Copiar legenda/.test(sec) && /Baixar a imagem/.test(sec));
  check('o manual diz que QUALQUER jogador gera o card, que a imagem leva nomes e nenhuma foto, que a legenda não leva nomes e o link ?ref=cartao', /<strong>Qualquer jogador<\/strong> pode gerar o card/.test(sec) && /<strong>nenhuma foto<\/strong>/.test(sec) && /a legenda não leva nomes/.test(sec) && /<code>\?ref=cartao<\/code>/.test(sec));
  check('o manual explica a Hegemonia e a Dinastia (mês com menos de 3 não quebra; mês sem ele quebra) e o ×N com os meses', /Hegemonia e na Dinastia, um mês com menos de 3 campeonatos não conta nem quebra/.test(sec) && /×2<\/strong>, <strong>×3/.test(sec) && /Out\/26, Nov\/26/.test(sec));
  check('o manual explica o interruptor do admin (no Painel Admin, com o nome da configuração, e na seção 33) e o aviso na seção das conquistas', /id="destaques-mes-admin"[\s\S]*?guardada em <code>app_config\/main<\/code> \(<code>monthBadges<\/code>\)/.test(manual) && /Além das conquistas abaixo, existem <strong>13 conquistas/.test(manual) && /<h3>Desligar <span class="tag">Admin<\/span><\/h3>/.test(sec));
  check('o manual diz que não há função nem regra nova do servidor e que a legenda nunca leva nome', /Não há função nem regra nova do servidor/.test(sec) && /nunca leva nome de pessoa nem da liga/.test(sec));

  check('o manual lista os dois arquivos do card na tabela dos cartões (seção 29), com os mesmos nomes do app', manual.includes('<code>destaques-pelada-na-mao-story.png</code> / <code>destaques-pelada-na-mao.png</code>') && /destaques: \{[\s\S]*?file: \{ story: 'destaques-pelada-na-mao-story\.png', feed: 'destaques-pelada-na-mao\.png' \}/.test(html));
  check('o manual avisa, nas duas frases da liga sem final (seções 3 e 13), que as duas conquistas do mês ligadas às finais também somem', /além de <strong>Rei das Finais do Mês<\/strong> e <strong>Rei das Artilharias de Finais do Mês<\/strong> \(seção 33\)/.test(manual) && /além das de ½ título e das duas conquistas do mês ligadas às finais \(Rei das Finais do Mês e Rei das Artilharias de Finais do Mês\)/.test(manual));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})();
