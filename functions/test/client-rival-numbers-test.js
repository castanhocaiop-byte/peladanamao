// Comparar os NÚMEROS com os de um RIVAL (index.html): extrai o código real e o executa num ambiente simulado, sem navegador. Segue as regras da comparação de conquistas: a escolha do
// rival fica só no aparelho, ele não é avisado, a comparação só existe no PRÓPRIO perfil (nunca na simulação do admin) e a legenda nunca leva nome. Os números saem do que a liga já mostra a
// todos (títulos do ranking, campeonatos, gols e vezes artilheiro do cálculo das conquistas e as vitórias, empates e derrotas dos jogos dos times), com a MESMA conta para os dois lados, e a
// conta das vitórias/empates/derrotas é a mesma função que alimenta o Resumo de Jogos da aba EU (matchRecord). Aqui também: as abas da janela, a tabela, a frase de quem está na frente, o cartão
// "Meus números × rival" (Story e Feed) e o manual.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8').replace(/\r\n/g, '\n');
const ci = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
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
const code = slice('const MJ_CARD = {', '/* ── Painel do dono');
const rivalCode = slice('/* ── Rival ─', 'function closeModal()');
const eligCode = slice('function badgeEligibleCount(b) {', 'function goallessStreak(');
const keyCode = slice('const playerKey = name =>', '\n\n');
const escCode = slice('const esc = s =>', 'function toast(');
const streakCode = slice('function goallessStreak(chron, name) {', 'function getPlayerRarestBadge(');
const statsCode = slice('function computePlayerBadgeStats(name) {', 'function getBadgeCache()');

// ── contexto de desenho falso: guarda o que foi desenhado e mede texto como "0,5 × tamanho da fonte por letra" ──
function fakeCtx() {
  const ctx = { texts: [], images: [], strokes: [], fills: [], fillRects: [], radials: [], stops: [], arcs: [], k: 1, tx: 0, ty: 0, stack: [], clips: 0, saves: 0, restores: 0, font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: 'left', textBaseline: 'alphabetic' };
  const size = () => Number((/(\d+)px/.exec(ctx.font) || [0, 16])[1]);
  const noop = () => {};
  Object.assign(ctx, {
    closePath: noop, moveTo: noop, arcTo: noop, rect: noop,
    beginPath() { ctx._last = null; }, arc(x, y, r) { const a = { x, y, r, fill: null }; ctx.arcs.push(a); ctx._last = a; },
    createLinearGradient: () => ({ addColorStop: (o, c) => ctx.stops.push(c) }), createRadialGradient: (...a) => { ctx.radials.push(a); return { addColorStop: (o, c) => ctx.stops.push(c) }; },
    save() { ctx.saves++; ctx.stack.push([ctx.k, ctx.tx, ctx.ty]); }, restore() { ctx.restores++; [ctx.k, ctx.tx, ctx.ty] = ctx.stack.pop() || [1, 0, 0]; }, clip() { ctx.clips++; },
    translate(x, y) { ctx.tx += ctx.k * x; ctx.ty += ctx.k * y; }, scale(s) { ctx.k *= s; }, fillRect(x, y, w, h) { ctx.fillRects.push({ x, y, w, h }); },
    stroke() { ctx.strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth }); },
    fill() { ctx.fills.push(ctx.fillStyle); if (ctx._last) { ctx._last.fill = ctx.fillStyle; ctx._last = null; } },
    drawImage(img, ...a) { ctx.images.push({ img, args: a, ax: ctx.tx + ctx.k * a[0], ay: ctx.ty + ctx.k * a[1], aw: ctx.k * a[2], ah: ctx.k * a[3], clipped: ctx.clips > 0 && ctx.saves > ctx.restores }); },
    measureText: t => ({ width: String(t).length * size() * 0.5 }),
    fillText(text, x, y) { ctx.texts.push({ text: String(text), x, y, ax: ctx.tx + ctx.k * x, ay: ctx.ty + ctx.k * y, k: ctx.k, font: ctx.font, fill: ctx.fillStyle, align: ctx.textAlign, base: ctx.textBaseline }); },
  });
  return ctx;
}

// ── a liga de mentira: 3 campeonatos concluídos com times, jogos, gols e campeões (os números esperados estão calculados à mão, no comentário de cada jogador) ──
const PLAYERS = [{ name: 'Ana' }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Gil', goleiro: true }, { name: 'Éder' }, { name: 'Zeca', active: false }, { name: 'Novo' }];
const g = (...names) => names.map(player => ({ player }));
const mt = (phase, home, away, hs, as, goals = [], extra = {}) => ({ phase, home, away, hs, as, played: true, goals: phase === 'final' ? [] : goals, ...(phase === 'final' ? { finalGoals: goals } : {}), ...extra });
const CHAMPS = [
  { id: 'c1', date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Bruno'], verde: ['Carla', 'Gil'] }, champion: 'azul', champion_players: [{ name: 'Ana' }, { name: 'Bruno' }],
    matches: [mt('regular', 'azul', 'verde', 2, 1, g('Ana', 'Ana', 'Carla')), mt('regular', 'azul', 'verde', 0, 0), mt('regular', 'verde', 'azul', 3, 1, g('Carla', 'Carla', 'Carla', 'Bruno')), mt('final', 'azul', 'verde', 1, 0, g('Bruno'))] },
  { id: 'c2', date: '2026-09-16', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Carla'], verde: ['Bruno', 'Gil'] }, champion: 'verde', champion_players: [{ name: 'Bruno' }, { name: 'Gil' }],
    matches: [mt('regular', 'azul', 'verde', 1, 2, g('Ana', 'Bruno', 'Bruno')), mt('regular', 'azul', 'verde', 2, 2, g('Carla', 'Ana', 'Bruno', 'Bruno')), mt('final', 'verde', 'azul', 1, 1, g('Bruno', 'Ana'), { penaltyWinner: 'verde' })] },
  { id: 'c3', date: '2026-09-23', status: 'completed', freeMode: false, teamRosters: { azul: ['Bruno', 'Carla'], verde: ['Gil', 'Éder'] }, champion: 'azul', champion_players: [{ name: 'Bruno' }, { name: 'Carla' }],
    matches: [mt('regular', 'azul', 'verde', 4, 0, g('Bruno', 'Bruno', 'Carla', 'Carla')), mt('final', 'azul', 'verde', 2, 1, g('Bruno', 'Carla', 'Éder'))] },
];
// Ana: 2 campeonatos, 7 jogos (2 V, 3 E, 2 D), 5 gols, 0 vezes artilheira, 1 título.  Bruno: 3 camp., 9 jogos (5 V, 3 E, 1 D), 10 gols, 2 vezes artilheiro, 3 títulos.
// Carla: 3 camp., 9 jogos (3 V, 3 E, 3 D), 8 gols, 2 vezes artilheira, 1 título.  Gil (goleiro): 3 camp., 9 jogos (2 V, 3 E, 4 D), 0 gols, 1 título.  Éder: 1 camp., 2 jogos (0 V, 0 E, 2 D), 1 gol, 0 título.
const RANKS = [['Ana', 1], ['Bruno', 3], ['Carla', 1], ['Gil', 1], ['Éder', 0]].map(([name, titles]) => ({ id: name === 'Éder' ? 'eder' : name.toLowerCase(), name, titles }));

const statsApi = (players, champs) => { const env2 = { st: { players, champs, ranks: [], finMens: {}, finCfg: {} }, getChampAwards: () => null, computeAwardStats: () => ({ posAwards: 0, negAwards: 0, hasCarregado: false, hasCraqueTimePequeno: false }), getPaid: () => false, getPaidDate: () => null }; const n2 = Object.keys(env2); return new Function(...n2, streakCode + '\n' + statsCode + '\nreturn { computePlayerBadgeStats };')(...n2.map(x => env2[x])); };

function makeEnv({ champs = CHAMPS, players = PLAYERS, ranks = RANKS, me = 'ana', sim = null, canShare = true, copyOk = true, storage = {}, patchStats = null, league = 'Série B Aceoma' } = {}) {
  const calls = { events: [], toasts: [], shared: [], clicks: [], revoked: [], canvases: [], copied: [], renders: 0 };
  let urlN = 0;
  const fakeUrl = { createObjectURL: b => `blob:teste/${++urlN}-${b.size}`, revokeObjectURL: u => { calls.revoked.push(u); } };
  const layers = [];
  const doc = {
    fonts: { load: async () => [] }, getElementById: id => layers.find(x => x.id === id) || null,
    querySelectorAll: () => [],
    createElement: tag => {
      if (tag === 'canvas') { const cv = { width: 0, height: 0, ctx: fakeCtx(), getContext() { return cv.ctx; }, toBlob(cb) { setTimeout(() => cb(new Blob(['png' + cv.height], { type: 'image/png' })), 0); } }; calls.canvases.push(cv); return cv; }
      if (tag === 'a') { const a = { href: '', download: '', click() { calls.clicks.push({ href: a.href, download: a.download }); }, remove() {} }; return a; }
      const el = { id: '', className: '', innerHTML: '', remove() { const i = layers.indexOf(el); if (i >= 0) layers.splice(i, 1); } }; return el;
    },
    body: { appendChild: el => { if (el.id) layers.push(el); } },
  };
  class FakeImage { set src(v) { this._src = v; setTimeout(() => { this.naturalWidth = 400; this.naturalHeight = 300; this.__photo = !String(v).includes('logo'); this.onload?.(); }, 0); } get src() { return this._src; } }
  const nav = { share: async d => { calls.shared.push(d); }, canShare: () => canShare };
  const store = new Map(Object.entries(storage));
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  // as estatísticas de cada jogador saem do cálculo REAL de todos os jogadores (computePlayerBadgeStats), não de números combinados à mão
  const S = statsApi(players, champs), playerStats = {};
  for (const p of players) playerStats[p.name] = S.computePlayerBadgeStats(p.name);
  if (patchStats) patchStats(playerStats);
  const env = {
    st: { authUser: { uid: 'u1' }, leagueId: 'liga1', userDoc: { playerKey: me }, players, champs, ranks, availableLeagues: [{ id: 'liga1', name: league }], photos: { [me]: 'https://res.cloudinary.com/x/foto.jpg', bruno: 'https://res.cloudinary.com/x/bruno.jpg' }, modal: null, mjPreviewKey: sim },
    document: doc, navigator: nav, Image: FakeImage, URL: fakeUrl, pixCopyText: async t => { calls.copied.push(t); return copyOk; },
    trackEvent: (n, once = true) => { calls.events.push([n, once]); }, toast: (m, t) => { calls.toasts.push([m, t]); },
    localStorage, render: () => { calls.renders++; }, BADGE_CATALOG: [], getBadgeCache: () => ({ playerBadges: {}, badgeHolders: {}, playerStats }),
  };
  const names = Object.keys(env);
  const body = escCode + '\n' + keyCode + '\n' + code + '\n' + eligCode + '\n' + rivalCode + `
return { MJ_CARD, MJ_STORY, MJ_TIERS, MJ_KINDS, matchRecord, mjRivalNumData, mjRivalNumVerdict, mjRivalNumCaption, drawMjRivalNumCard, drawMjRivalNumStory, openMjShare, closeMjCard, shareMjCard, copyMjCaption,
  downloadMjCard, setMjFormat, getKind: () => _mjKind, getBlobs: () => _mjBlobs, rivalSet, rivalGet, rivalPair, rivalStatsOf, rivalNumbers, rivalCompare, RIVAL_NUMBER_ROWS, rivalPctOf, rivalTitlesText, rivalTab,
  openMjRivalNumbers, openRival, rivalPick, rivalChange, rivalRemove, rivalStrip, mRival, playerKey };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, layers, store, playerStats };
}

const tick = () => new Promise(r => setTimeout(r, 15));
const W = 1080, H = 1350;
const logo = { naturalWidth: 1024, naturalHeight: 1024 }, photo = { naturalWidth: 400, naturalHeight: 300, __photo: true };
const COLORS = { legendary: '#f0b429', epic: '#b06eff', rare: '#4db8ff', common: '#00d67f' };
const LINK = 'https://peladanamao.com.br/?ref=cartao';
const said = ctx => ctx.texts.map(t => t.text);
const rowsOf = n => n.rows.map(r => [r.label, r.mine, r.theirs, r.lead, r.scored]);
const A = makeEnv().api;

(async () => {
  // ══ 1. A CONTA DE VITÓRIAS, EMPATES E DERROTAS (matchRecord) ══════════════════════════════════════════
  const rec = (name, champs = CHAMPS) => A.matchRecord(champs, name);
  check('a conta dos jogos de cada jogador (os números da liga de teste, calculados à mão): Ana 2V 3E 2D em 7, Bruno 5V 3E 1D em 9, Carla 3V 3E 3D, Gil 2V 3E 4D, Éder 0V 0E 2D em 2', JSON.stringify(rec('Ana')) === '{"w":2,"d":3,"l":2,"matches":7}' && JSON.stringify(rec('Bruno')) === '{"w":5,"d":3,"l":1,"matches":9}' && JSON.stringify(rec('Carla')) === '{"w":3,"d":3,"l":3,"matches":9}' && JSON.stringify(rec('Gil')) === '{"w":2,"d":3,"l":4,"matches":9}' && JSON.stringify(rec('Éder')) === '{"w":0,"d":0,"l":2,"matches":2}', [rec('Ana'), rec('Bruno'), rec('Carla'), rec('Gil'), rec('Éder')]);
  check('quem não está em nenhum time (inativo, novo ou nome que não existe) tem tudo zerado, e lista vazia também', ['Zeca', 'Novo', 'Fulano', ''].every(n => JSON.stringify(rec(n)) === '{"w":0,"d":0,"l":0,"matches":0}') && JSON.stringify(A.matchRecord([], 'Ana')) === '{"w":0,"d":0,"l":0,"matches":0}');
  check('jogos = vitórias + empates + derrotas, sempre', ['Ana', 'Bruno', 'Carla', 'Gil', 'Éder'].every(n => { const r = rec(n); return r.matches === r.w + r.d + r.l; }));
  const one = (hs, as, o = {}) => [{ id: 'x', teamRosters: { azul: ['Ana'], verde: ['Bia'] }, matches: [{ phase: 'regular', home: 'azul', away: 'verde', hs, as, played: true, ...o }] }];
  check('em casa e fora: ganhar, empatar e perder contam do lado certo', JSON.stringify(rec('Ana', one(2, 1))) === '{"w":1,"d":0,"l":0,"matches":1}' && JSON.stringify(rec('Ana', one(1, 1))) === '{"w":0,"d":1,"l":0,"matches":1}' && JSON.stringify(rec('Ana', one(0, 3))) === '{"w":0,"d":0,"l":1,"matches":1}' && JSON.stringify(rec('Bia', one(2, 1))) === '{"w":0,"d":0,"l":1,"matches":1}' && JSON.stringify(rec('Bia', one(1, 1))) === '{"w":0,"d":1,"l":0,"matches":1}' && JSON.stringify(rec('Bia', one(0, 3))) === '{"w":1,"d":0,"l":0,"matches":1}');
  check('jogo que não foi disputado (played falso ou ausente) não conta; jogo de outros times também não', rec('Ana', one(2, 1, { played: false })).matches === 0 && rec('Ana', one(2, 1, { played: undefined })).matches === 0 && rec('Ana', [{ id: 'x', teamRosters: { azul: ['Ana'], verde: ['Bia'], preto: ['Cid'] }, matches: [{ home: 'verde', away: 'preto', hs: 1, as: 0, played: true }] }]).matches === 0);
  check('campeonato sem elenco registrado (teamRosters ausente) ou sem jogos (matches ausente) não conta e não quebra', rec('Ana', [{ id: 'x', matches: [{ home: 'azul', away: 'verde', hs: 1, as: 0, played: true }] }]).matches === 0 && rec('Ana', [{ id: 'x', teamRosters: { azul: ['Ana'] } }]).matches === 0);
  check('a final decidida nos pênaltis conta como EMPATE no placar (1 x 1), igual ao Resumo de Jogos da aba EU', JSON.stringify(rec('Ana', one(1, 1, { phase: 'final', penaltyWinner: 'azul' }))) === '{"w":0,"d":1,"l":0,"matches":1}');
  const antes = JSON.stringify(CHAMPS); rec('Ana'); rec('Bruno');
  check('não altera a lista de campeonatos que recebe', JSON.stringify(CHAMPS) === antes);
  // a conta ANTIGA da aba EU (copiada como era, antes de virar função) tem de dar o mesmo resultado que a função nova em qualquer liga: testado com ligas sorteadas
  const oldWdl = (doneAll, myName) => {
    let myW = 0, myD = 0, myL = 0, myMatchesPlayed = 0;
    for (const c of doneAll) {
      if (!c.teamRosters) continue;
      let myTeamWDL = null;
      for (const [team, roster] of Object.entries(c.teamRosters)) { if (roster.includes(myName)) { myTeamWDL = team; break; } }
      if (!myTeamWDL) continue;
      for (const m of (c.matches || [])) {
        if (!m.played) continue;
        if (m.home !== myTeamWDL && m.away !== myTeamWDL) continue;
        myMatchesPlayed++;
        const iHome = m.home === myTeamWDL;
        if (m.hs === m.as) myD++;
        else if ((iHome && m.hs > m.as) || (!iHome && m.as > m.hs)) myW++;
        else myL++;
      }
    }
    return { w: myW, d: myD, l: myL, matches: myMatchesPlayed };
  };
  // gerador de números sorteados com semente fixa (mulberry32): o teste dá sempre o mesmo resultado, mas varia de verdade (um gerador congruencial simples ficava preso em "sempre 0" nos bits baixos)
  const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rand = mulberry32(12345), rnd = n => Math.floor(rand() * n);
  const NAMES = ['Ana', 'Bruno', 'Carla', 'Gil', 'Éder', 'Zeca'], TEAMS = ['azul', 'verde', 'preto', 'branco'];
  let diffs = 0, doisTimes = 0, comJogos = 0, finais = 0, semElenco = 0, naoJogados = 0;
  for (let i = 0; i < 300; i++) {
    const champs = Array.from({ length: rnd(5) }, () => {
      const teamRosters = {}; for (const t of TEAMS.slice(0, 2 + rnd(3))) teamRosters[t] = NAMES.filter(() => rnd(3) === 0);
      const teams = Object.keys(teamRosters), c = { id: 'r' + rnd(99), teamRosters: rnd(6) === 0 ? undefined : teamRosters, matches: Array.from({ length: rnd(8) }, () => ({ phase: ['regular', 'final'][rnd(2)], home: teams[rnd(teams.length)], away: teams[rnd(teams.length)], hs: rnd(4), as: rnd(4), played: rnd(5) !== 0 })) };
      if (rnd(8) === 0) delete c.matches; return c;
    });
    for (const n of NAMES) {
      if (JSON.stringify(A.matchRecord(champs, n)) !== JSON.stringify(oldWdl(champs, n))) diffs++;
      if (A.matchRecord(champs, n).matches > 0) comJogos++;
      for (const c of champs) { if (!c.teamRosters) semElenco++; else if (Object.values(c.teamRosters).filter(r => r.includes(n)).length > 1) doisTimes++; for (const mm of (c.matches || [])) { if (mm.phase === 'final') finais++; if (!mm.played) naoJogados++; } }
    }
  }
  check('a função nova dá o MESMO resultado da conta antiga da aba EU em 1800 casos sorteados (300 ligas × 6 jogadores, com jogador em dois times, campeonato sem elenco, jogos não disputados, finais…)', diffs === 0, diffs);
  check('o sorteio é variado de verdade (cobre os casos difíceis): muitos jogadores com jogos, jogador listado em dois times do mesmo campeonato, campeonato sem elenco, finais e jogos não disputados', comJogos > 500 && doisTimes > 100 && semElenco > 100 && finais > 100 && naoJogados > 100, { comJogos, doisTimes, semElenco, finais, naoJogados });
  check('jogador listado em dois times do mesmo campeonato: vale o PRIMEIRO time (igual à aba EU)', JSON.stringify(A.matchRecord([{ teamRosters: { azul: ['Ana'], verde: ['Ana'] }, matches: [{ home: 'azul', away: 'verde', hs: 2, as: 0, played: true }] }], 'Ana')) === '{"w":1,"d":0,"l":0,"matches":1}');
  check('a aba EU passou a usar a função (um só cálculo para a aba EU e para o rival) e a conta antiga saiu de lá', /const \{ w: myW, d: myD, l: myL, matches: myMatchesPlayed \} = matchRecord\(doneAll, myName\);/.test(html) && !/myTeamWDL/.test(html) && (html.match(/function matchRecord\(/g) || []).length === 1);

  // ══ 2. OS NÚMEROS DE CADA LADO ════════════════════════════════════════════════════════════════════════
  let e = makeEnv(); e.api.rivalSet('carla');
  check('o jogador sem rival, sem jogador vinculado ou na simulação do admin ("Ver como") não tem números (null), como na comparação das conquistas', makeEnv().api.rivalNumbers() === null && (() => { const z = makeEnv({ me: undefined }); z.env.st.userDoc.playerKey = undefined; z.api.rivalSet('carla'); return z.api.rivalNumbers() === null; })() && (() => { const z = makeEnv({ sim: 'bruno' }); z.api.rivalSet('carla'); return z.api.rivalNumbers() === null && z.api.rivalPair() === null && z.api.rivalCompare() === null; })() && (() => { const z = makeEnv({ sim: 'ana' }); z.api.rivalSet('carla'); return z.api.rivalNumbers() !== null; })());
  check('rival inválido (eu mesmo, inativo ou que não existe mais): sem números', ['ana', 'zeca', 'fulano'].every(k => { const z = makeEnv(); z.api.rivalSet(k); return z.api.rivalNumbers() === null; }));
  check('eu e o rival, com os nomes do elenco (sem o jogador no elenco, a chave)', JSON.stringify(e.api.rivalPair()) === '{"me":"Ana","rival":"Carla"}' && (() => { const z = makeEnv({ players: PLAYERS.filter(p => p.name !== 'Ana') }); z.api.rivalSet('carla'); return z.api.rivalPair().me === 'ana'; })());
  const sa = e.api.rivalStatsOf('Ana'), sb = e.api.rivalStatsOf('Bruno');
  check('os números de um jogador: títulos do ranking, campeonatos, gols e vezes artilheiro do cálculo das conquistas e os jogos (V, E, D)', JSON.stringify(sa) === '{"titles":1,"champs":2,"goals":5,"art":0,"w":2,"d":3,"l":2,"matches":7}' && JSON.stringify(sb) === '{"titles":3,"champs":3,"goals":10,"art":2,"w":5,"d":3,"l":1,"matches":9}', [sa, sb]);
  check('jogador sem ranking nem estatística (novo, ou fora da cache): tudo zero, sem quebrar', JSON.stringify(e.api.rivalStatsOf('Fulano')) === '{"titles":0,"champs":0,"goals":0,"art":0,"w":0,"d":0,"l":0,"matches":0}' && (() => { const z = makeEnv(); z.env.st.ranks = undefined; z.env.st.champs = undefined; return z.api.rivalStatsOf('Ana').titles === 0 && z.api.rivalStatsOf('Ana').matches === 0; })());
  check('só campeonato concluído e fora do plano gratuito entra nos jogos (um ativo e um do plano gratuito não contam)', (() => { const extra = [{ ...CHAMPS[0], id: 'a1', status: 'active' }, { ...CHAMPS[0], id: 'f1', freeMode: true }]; const z = makeEnv({ champs: [...CHAMPS, ...extra] }); return z.api.rivalStatsOf('Ana').matches === 7; })());
  // campeonatos de antes dos cortes do app: um sem elenco de 20/08 (conta como disputado para todos), um de 05/09 com elenco (conta como disputado, mas os gols dele ficam de fora porque o registro
  // de gols só começou em 08/09/2026) e o campeonato 1 de sempre; os jogos do time contam em todos os campeonatos com elenco
  const antigos = [{ id: 'p00', date: '2026-08-20', status: 'completed', freeMode: false, matches: [] }, { id: 'p0', date: '2026-09-05', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana'], verde: ['Bruno'] }, matches: [mt('regular', 'azul', 'verde', 3, 1, g('Ana', 'Ana', 'Ana', 'Bruno'))] }, CHAMPS[0]];
  const ea = makeEnv({ champs: antigos });
  check('campeonatos disputados contam os de antes do registro (inclusive sem elenco); gols e vezes artilheiro só contam desde 08/09/2026; vitórias, empates e derrotas contam de todos os campeonatos com elenco', JSON.stringify(ea.api.rivalStatsOf('Ana')) === '{"titles":1,"champs":3,"goals":2,"art":0,"w":3,"d":1,"l":1,"matches":5}' && JSON.stringify(ea.api.rivalStatsOf('Bruno')) === '{"titles":3,"champs":3,"goals":2,"art":0,"w":2,"d":1,"l":2,"matches":5}', [ea.api.rivalStatsOf('Ana'), ea.api.rivalStatsOf('Bruno')]);
  const cm = e.api.rivalNumbers();
  check('Ana × Carla: títulos, campeonatos, jogos, V, E, D, % de vitórias, gols e vezes artilheira, cada linha com os dois lados e quem está na frente', JSON.stringify(rowsOf(cm)) === JSON.stringify([
    ['Títulos', '1', '1', '', true], ['Campeonatos', '2', '3', '', false], ['Jogos', '7', '9', '', false], ['Vitórias', '2', '3', 'theirs', true], ['Empates', '3', '3', '', false],
    ['Derrotas', '2', '3', 'mine', true], ['% de vitórias', '29%', '33%', 'theirs', true], ['Gols', '5', '8', 'theirs', true], ['Vezes artilheiro', '0', '2', 'theirs', true]]), rowsOf(cm));
  check('o saldo: 1 linha minha, 4 do rival, 6 disputando (títulos empatados também contam como disputa) → o rival está na frente', cm.me === 'Ana' && cm.rival === 'Carla' && cm.mineLead === 1 && cm.theirsLead === 4 && cm.scored === 6 && cm.status === 'behind', cm);
  e.api.rivalSet('bruno'); const bm = e.api.rivalNumbers();
  check('Ana × Bruno: ele está na frente em todas as 6 que disputam (menos derrotas: 1 contra as minhas 2)', bm.theirsLead === 6 && bm.mineLead === 0 && bm.scored === 6 && bm.status === 'behind' && bm.rows.find(r => r.id === 'losses').lead === 'theirs' && bm.rows.find(r => r.id === 'titles').theirs === '3', rowsOf(bm));
  e.api.rivalSet('gil'); const gm = e.api.rivalNumbers();
  check('Ana × Gil (goleiro, 0 gols, nunca artilheiro): vezes artilheiro some (os dois têm zero); eu na frente em 3 das 5 que disputam (derrotas, % de vitórias e gols)', gm.rows.map(r => r.id).join() === 'titles,champs,matches,wins,draws,losses,winpct,goals' && gm.mineLead === 3 && gm.theirsLead === 0 && gm.scored === 5 && gm.status === 'ahead' && gm.rows.find(r => r.id === 'winpct').theirs === '22%' && gm.rows.find(r => r.id === 'wins').lead === '', rowsOf(gm));
  e.api.rivalSet('eder'); const em = e.api.rivalNumbers();
  check('Ana × Éder (2 jogos): empate em derrotas (2 x 2), eu na frente em 4 das 5 que disputam; vezes artilheiro some', em.rows.find(r => r.id === 'losses').lead === '' && em.mineLead === 4 && em.scored === 5 && em.status === 'ahead' && !em.rows.some(r => r.id === 'art'), rowsOf(em));
  e.api.rivalSet('novo'); const nm = e.api.rivalNumbers();
  check('quem nunca jogou (Novo): as linhas de jogos aparecem (eu joguei), mas SÓ INFORMAM: ele não "ganha" em derrotas por ter 0, a % dele é "—" e nada disso conta no saldo', JSON.stringify(rowsOf(nm)) === JSON.stringify([
    ['Títulos', '1', '0', 'mine', true], ['Campeonatos', '2', '0', '', false], ['Jogos', '7', '0', '', false], ['Vitórias', '2', '0', '', false], ['Empates', '3', '0', '', false],
    ['Derrotas', '2', '0', '', false], ['% de vitórias', '29%', '—', '', false], ['Gols', '5', '0', 'mine', true]]) && nm.scored === 2 && nm.mineLead === 2 && nm.status === 'ahead', rowsOf(nm));
  check('o mesmo ao contrário: se eu nunca joguei, ele não perde para mim em derrotas nem ganha de graça', (() => { const z = makeEnv({ me: 'novo' }); z.env.st.players = PLAYERS; z.api.rivalSet('ana'); const n = z.api.rivalNumbers(); return n.rows.find(r => r.id === 'losses').lead === '' && n.rows.find(r => r.id === 'wins').lead === '' && n.rows.find(r => r.id === 'winpct').mine === '—' && n.rows.find(r => r.id === 'winpct').theirs === '29%'; })());

  // linhas que só informam, o que some e o que empata
  const emp = (extraChamps, ranks = RANKS, players = PLAYERS, who = 'ana', rival = 'bruno') => { const z = makeEnv({ champs: extraChamps, ranks, players, me: who }); z.api.rivalSet(rival); return z.api.rivalNumbers(); };
  const semJogo = [{ id: 'x1', date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Bruno'] }, matches: [] }];
  const so = emp(semJogo, []);
  check('só campeonatos disputados, sem título, jogo nem gol: sobra "Campeonatos" (que só informa) e nada disputa → sem saldo ("none")', JSON.stringify(rowsOf(so)) === JSON.stringify([['Campeonatos', '1', '1', '', false]]) && so.scored === 0 && so.status === 'none', rowsOf(so));
  const vazio = emp([], []);
  check('liga sem campeonato nenhum: nenhuma linha (os dois têm zero em tudo) e nada quebra', vazio.rows.length === 0 && vazio.scored === 0 && vazio.status === 'none');
  const igual = emp([{ id: 'y1', date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Bruno'], verde: ['Carla'] }, matches: [mt('regular', 'azul', 'verde', 1, 0)] }], [{ id: 'ana', name: 'Ana', titles: 1 }, { id: 'bruno', name: 'Bruno', titles: 1 }]);
  check('dois jogadores iguais em tudo (mesmo time, mesmo título): todas as linhas empatam, as que disputam contam (títulos, vitórias, derrotas, % de vitórias = 4) e o saldo é empate; "Empates 0 x 0" aparece porque os dois jogaram', igual.status === 'tie' && igual.mineLead === 0 && igual.theirsLead === 0 && igual.scored === 4 && igual.rows.every(r => r.lead === '') && igual.rows.find(r => r.id === 'draws').mine === '0' && igual.rows.find(r => r.id === 'losses').scored === true && !igual.rows.some(r => r.id === 'goals' || r.id === 'art'), rowsOf(igual));
  const metade = emp(CHAMPS, [{ id: 'ana', name: 'Ana', titles: 2.5 }, { id: 'carla', name: 'Carla', titles: 2 }], PLAYERS, 'ana', 'carla');
  check('título e meio título: "2½" contra "2", e quem tem 2,5 está na frente de quem tem 2', metade.rows[0].mine === '2½' && metade.rows[0].theirs === '2' && metade.rows[0].lead === 'mine' && e.api.rivalTitlesText(0) === '0' && e.api.rivalTitlesText(7) === '7' && e.api.rivalTitlesText(0.5) === '0½' && e.api.rivalTitlesText(3.5) === '3½', metade.rows[0]);
  check('as linhas só mostram o zero quando o outro lado tem algo: títulos 0 x 0 some, 0 x 1 aparece', !emp(CHAMPS, [], PLAYERS, 'ana', 'carla').rows.some(r => r.id === 'titles') && emp(CHAMPS, [{ id: 'carla', name: 'Carla', titles: 1 }], PLAYERS, 'ana', 'carla').rows.find(r => r.id === 'titles').lead === 'theirs');
  // % de vitórias: compara os valores ARREDONDADOS que a tela mostra (33,3% contra 33% é empate)
  const muitos = (id, team, wins, losses) => ({ id, date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { [team]: [id], outro: ['Z' + id] }, matches: [...Array.from({ length: wins }, () => mt('regular', team, 'outro', 1, 0)), ...Array.from({ length: losses }, () => mt('regular', team, 'outro', 0, 1))] });
  const pct = emp([muitos('Ana', 'azul', 1, 2), muitos('Bruno', 'verde', 33, 67)], [], [{ name: 'Ana' }, { name: 'Bruno' }]);
  check('% de vitórias: 1 de 3 (33,3%) contra 33 de 100 (33%) mostram "33%" dos dois lados e EMPATAM (compara o que aparece, não os decimais escondidos); vitórias dele (33) na frente, derrotas minhas (2) na frente', pct.rows.find(r => r.id === 'winpct').mine === '33%' && pct.rows.find(r => r.id === 'winpct').theirs === '33%' && pct.rows.find(r => r.id === 'winpct').lead === '' && pct.rows.find(r => r.id === 'wins').lead === 'theirs' && pct.rows.find(r => r.id === 'losses').lead === 'mine', rowsOf(pct));
  check('arredondamento da % de vitórias: 2/3 = 67%, 1/6 = 17%, 5/9 = 56%, sem jogos = null', e.api.rivalPctOf({ w: 2, matches: 3 }) === 67 && e.api.rivalPctOf({ w: 1, matches: 6 }) === 17 && e.api.rivalPctOf({ w: 5, matches: 9 }) === 56 && e.api.rivalPctOf({ w: 0, matches: 0 }) === null && e.api.rivalPctOf({ w: 0, matches: 4 }) === 0);
  check('a lista de linhas: 9 linhas na ordem da tabela; só 6 disputam (títulos, vitórias, derrotas, % de vitórias, gols, vezes artilheiro); derrotas é a única em que menos é melhor; campeonatos, jogos e empates só informam', e.api.RIVAL_NUMBER_ROWS.map(r => r.id).join() === 'titles,champs,matches,wins,draws,losses,winpct,goals,art' && e.api.RIVAL_NUMBER_ROWS.filter(r => r.better).map(r => r.id).join() === 'titles,wins,losses,winpct,goals,art' && e.api.RIVAL_NUMBER_ROWS.filter(r => r.better === 'low').map(r => r.id).join() === 'losses' && e.api.RIVAL_NUMBER_ROWS.filter(r => !r.better).map(r => r.id).join() === 'champs,matches,draws' && e.api.RIVAL_NUMBER_ROWS.filter(r => r.games).map(r => r.id).join() === 'matches,wins,draws,losses,winpct');
  const nenhumGol = makeEnv({ patchStats: s => { for (const k of Object.keys(s)) { s[k].totalGoals = 0; s[k].myArt = 0; } } }); nenhumGol.api.rivalSet('carla');
  check('quando ninguém tem gol registrado, as linhas de gols e de vezes artilheiro somem (não mostra "0 x 0")', !nenhumGol.api.rivalNumbers().rows.some(r => r.id === 'goals' || r.id === 'art'));
  check('os números não dependem de o rival ter conquistas: a comparação de conquistas e a de números são independentes (rivalCompare segue sem erro com o catálogo vazio)', (() => { const z = makeEnv(); z.api.rivalSet('carla'); const c = z.api.rivalCompare(); return c.me === 'Ana' && c.rival === 'Carla' && c.myCount === 0 && c.rivalCount === 0; })());

  // ══ 3. A JANELA: AS DUAS ABAS ═════════════════════════════════════════════════════════════════════════
  e = makeEnv(); e.api.rivalSet('carla'); e.env.st.modal = { type: 'rival', picking: false };
  let m = e.api.mRival();
  check('a janela abre na aba das CONQUISTAS (a de sempre), com as duas abas no alto: "🏅 Conquistas" marcada e "📊 Números" desmarcada; o botão é o de compartilhar a comparação de conquistas', /aria-pressed="true"[^>]*>🏅 Conquistas<\/button>/.test(m) && /aria-pressed="false"[^>]*>📊 Números<\/button>/.test(m) && /onclick="rivalTab\('badges'\)"/.test(m) && /onclick="rivalTab\('numbers'\)"/.test(m) && /openMjRival\(\)/.test(m) && !/openMjRivalNumbers/.test(m) && m.indexOf('🏅 Conquistas') < m.indexOf('Só você tem'), m.slice(0, 400));
  for (const tab of [undefined, 'badges', 'x', null, 5, '__proto__', 'Numbers']) { const z = makeEnv(); z.api.rivalSet('carla'); z.env.st.modal = { type: 'rival', picking: false, tab }; if (/openMjRivalNumbers/.test(z.api.mRival()) || !/Só você tem/.test(z.api.mRival())) { check('uma aba desconhecida cai nas conquistas: ' + String(tab), false); } }
  check('uma aba desconhecida (nada, "x", null, número, "Numbers" com maiúscula) cai nas conquistas', true);
  e.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  m = e.api.mRival();
  check('na aba dos NÚMEROS: "📊 Números" marcada, "🏅 Conquistas" desmarcada, o botão é "📤 Compartilhar números" (openMjRivalNumbers) e as conquistas (grupos, "Compartilhar comparação") não aparecem', /aria-pressed="false"[^>]*>🏅 Conquistas<\/button>/.test(m) && /aria-pressed="true"[^>]*>📊 Números<\/button>/.test(m) && /onclick="openMjRivalNumbers\(\)"[^>]*>📤 Compartilhar números<\/button>/.test(m) && !/Só você tem|Compartilhar comparação|openMjRival\(\)/.test(m), m.slice(0, 300));
  const parse = h => [...h.matchAll(/<div style="text-align:center;font-size:20px;font-weight:800;color:([^"]+)">([^<]*)<\/div>\s*<div style="text-align:center;font-size:11px[^>]*>([^<]*)<\/div>\s*<div style="text-align:center;font-size:20px;font-weight:800;color:([^"]+)">([^<]*)<\/div>/g)].map(x => [x[3], x[2], x[5], x[1], x[4]]);
  const linhas = parse(m);
  check('a tabela: uma linha por número, com o meu à esquerda, o nome no meio e o dele à direita; quem está na frente leva a cor (verde se sou eu, azul se é o rival) e o resto fica na cor normal', JSON.stringify(linhas) === JSON.stringify([
    ['Títulos', '1', '1', 'var(--text)', 'var(--text)'], ['Campeonatos', '2', '3', 'var(--text)', 'var(--text)'], ['Jogos', '7', '9', 'var(--text)', 'var(--text)'], ['Vitórias', '2', '3', 'var(--text)', '#4db8ff'], ['Empates', '3', '3', 'var(--text)', 'var(--text)'],
    ['Derrotas', '2', '3', '#00d67f', 'var(--text)'], ['% de vitórias', '29%', '33%', 'var(--text)', '#4db8ff'], ['Gols', '5', '8', 'var(--text)', '#4db8ff'], ['Vezes artilheiro', '0', '2', 'var(--text)', '#4db8ff']]), linhas);
  check('a frase no alto, em azul porque o rival está na frente: "Carla está na frente em 4 de 6 números"; os dois lados com as iniciais, "Você" e o nome; ela só na cor neutra (branca) e ele na azul', /color:#4db8ff;margin-bottom:10px">Carla está na frente em 4 de 6 números<\/div>/.test(m) && />A<\/div><div style="font-size:13px;font-weight:700;color:var\(--text2\);overflow-wrap:anywhere">Você</.test(m) && /border:2px solid #e6edf3[^>]*>A</.test(m) && /border:2px solid #4db8ff[^>]*>C</.test(m) && />Carla<\/div>/.test(m), m.slice(0, 1200));
  check('as notas da tabela explicam as cores e de onde vêm os gols; o aviso de privacidade e os botões de trocar e remover ficam nas duas abas', /Quem leva a cor está na frente naquele número \(em derrotas, quem tem menos\)\. Campeonatos, jogos e empates só informam\. Gols e vezes artilheiro contam desde 08\/09\/2026, quando o registro de gols começou\./.test(m) && /rivalChange\(\)/.test(m) && /rivalRemove\(\)/.test(m) && /A imagem mostra o nome do seu rival: compartilhe só se ele topar a brincadeira\. A escolha do rival fica só neste aparelho e ele não é avisado\./.test(m) && (() => { const z = makeEnv(); z.api.rivalSet('carla'); z.env.st.modal = { type: 'rival', picking: false }; const h = z.api.mRival(); return /rivalChange\(\)/.test(h) && /rivalRemove\(\)/.test(h) && /A imagem mostra o nome do seu rival/.test(h); })());
  e.api.rivalSet('gil'); const mg = e.api.mRival();
  check('na frente (Gil): "Você está na frente em 3 de 5 números!" em verde, eu com a cor do vencedor (verde) e ele neutro; vezes artilheiro (0 x 0) não aparece', /color:var\(--accent\);margin-bottom:10px">Você está na frente em 3 de 5 números!<\/div>/.test(mg) && /border:2px solid #00d67f[^>]*>A</.test(mg) && /border:2px solid #e6edf3[^>]*>G</.test(mg) && !/Vezes artilheiro/.test(mg), mg.slice(0, 900));
  e.api.rivalSet('novo'); const mn = e.api.mRival();
  check('quando só uma linha disputa, a frase fica no singular ("1 de 1 número"); com a linha de jogos sem disputa a frase conta as 2 que disputam', /Você está na frente em 2 de 2 números!/.test(mn) && (() => { const z = makeEnv({ champs: [{ id: 'k', date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Bruno'] }, matches: [] }], ranks: [{ id: 'ana', name: 'Ana', titles: 2 }] }); z.api.rivalSet('bruno'); z.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' }; return /Você está na frente em 1 de 1 número!/.test(z.api.mRival()); })());
  const zempate = makeEnv({ champs: [{ id: 'y1', date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Bruno'], verde: ['Carla'] }, matches: [mt('regular', 'azul', 'verde', 1, 0)] }], ranks: [{ id: 'ana', name: 'Ana', titles: 1 }, { id: 'bruno', name: 'Bruno', titles: 1 }] });
  zempate.api.rivalSet('bruno'); zempate.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  const mz = zempate.api.mRival();
  check('empate nos números: "Empate nos números!" em cinza (text2) e os dois lados com a cor de quem está na frente (verde e azul)', /color:var\(--text2\);margin-bottom:10px">Empate nos números!<\/div>/.test(mz) && /border:2px solid #00d67f[^>]*>A</.test(mz) && /border:2px solid #4db8ff[^>]*>B</.test(mz), mz.slice(0, 700));
  const znone = makeEnv({ champs: semJogo, ranks: [] }); znone.api.rivalSet('bruno'); znone.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  const mznone = znone.api.mRival();
  check('só "Campeonatos" (nada disputa): sem frase de quem está na frente, mas com a tabela e o botão de compartilhar', !/está na frente em|Empate nos números/.test(mznone) && parse(mznone).length === 1 && /openMjRivalNumbers/.test(mznone), mznone.slice(0, 600));
  const zvazio = makeEnv({ champs: [], ranks: [] }); zvazio.api.rivalSet('bruno'); zvazio.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  const mzv = zvazio.api.mRival();
  check('liga sem números: aviso "Ainda não há números para comparar…", sem tabela e SEM o botão de compartilhar; as abas e o trocar/remover continuam', /Ainda não há números para comparar: eles aparecem aqui quando os campeonatos tiverem jogos e gols\./.test(mzv) && parse(mzv).length === 0 && !/openMjRivalNumbers/.test(mzv) && /rivalTab\('badges'\)/.test(mzv) && /rivalChange\(\)/.test(mzv), mzv.slice(0, 500));
  const xss = makeEnv({ players: [...PLAYERS, { name: '<img src=x onerror=alert(1)> & "oi"' }], ranks: [...RANKS, { id: A.playerKey('<img src=x onerror=alert(1)> & "oi"'), name: '<img src=x onerror=alert(1)> & "oi"', titles: 2 }], patchStats: s => { s['<img src=x onerror=alert(1)> & "oi"'].totalGoals = 9; } });
  xss.api.rivalSet(xss.api.playerKey('<img src=x onerror=alert(1)> & "oi"')); xss.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  const mx = xss.api.mRival();
  check('o nome do rival é escapado na aba dos números (na frase "… está na frente em 2 de 2 números" e no lado do rival; sem HTML solto)', xss.api.rivalNumbers() !== null && xss.api.rivalNumbers().status === 'behind' && (mx.match(/&lt;img/g) || []).length === 2 && !/<img/.test(mx) && /está na frente em 2 de 2 números/.test(mx), mx.slice(0, 900));
  // o nome do número e os valores também passam pelo escape (hoje são constantes e números, mas a janela não pode confiar nisso)
  const mlb = (() => {
    const z = makeEnv(), lbl = z.api.RIVAL_NUMBER_ROWS.find(r => r.id === 'goals'); // o ambiente tem a sua própria lista de linhas: muda e desenha no MESMO
    lbl.label = '<b>Gols</b> & "x"'; lbl.text = v => '<u>' + v + '</u>';
    z.api.rivalSet('carla'); z.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
    return z.api.mRival();
  })();
  check('o nome do número e os valores da linha são escapados na janela (sem HTML solto)', !/<b>Gols|<u>/.test(mlb) && /&lt;b>Gols&lt;\/b> &amp; &quot;x&quot;/.test(mlb) && /&lt;u>5&lt;\/u>/.test(mlb), mlb.match(/.{40}Gols.{60}/)?.[0]);

  // trocar de aba
  e = makeEnv(); e.api.rivalSet('carla'); e.env.st.modal = { type: 'rival', picking: false };
  e.api.rivalTab('numbers');
  check('tocar em "Números" muda a aba e redesenha; tocar em "Conquistas" volta', e.env.st.modal.tab === 'numbers' && e.calls.renders === 1 && (() => { e.api.rivalTab('badges'); return e.env.st.modal.tab === 'badges' && e.calls.renders === 2; })());
  const rt = makeEnv(); rt.api.rivalSet('carla'); rt.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  for (const t of ['x', undefined, null, 5, '', 'NUMBERS', "numbers'); alert(1); ('"]) rt.api.rivalTab(t);
  check('aba que não existe (texto estranho, vazio, número, maiúscula): ignora, não muda nada e não redesenha', rt.env.st.modal.tab === 'numbers' && rt.calls.renders === 0);
  const rp = makeEnv(); rp.api.rivalSet('carla'); rp.env.st.modal = { type: 'rival', picking: true, tab: 'numbers' }; rp.api.rivalTab('badges');
  const ro = makeEnv(); ro.env.st.modal = { type: 'badgeInfo' }; ro.api.rivalTab('numbers'); const rn = makeEnv(); rn.api.rivalTab('numbers');
  check('na lista de escolha do rival, com outra janela aberta ou sem janela: tocar em uma aba não faz nada', rp.env.st.modal.tab === 'numbers' && rp.calls.renders === 0 && ro.env.st.modal.tab === undefined && ro.calls.renders === 0 && rn.env.st.modal === null && rn.calls.renders === 0);
  const pk = makeEnv(); pk.env.st.modal = { type: 'rival', picking: true, tab: 'numbers' }; pk.api.rivalPick('bruno');
  check('trocar de rival na aba dos números continua na aba dos números (escolher o novo rival não volta para as conquistas)', pk.env.st.modal.tab === 'numbers' && pk.env.st.modal.picking === false && pk.api.rivalGet() === 'bruno' && (() => { const z = makeEnv(); z.env.st.modal = { type: 'rival', picking: true }; z.api.rivalPick('bruno'); return z.env.st.modal.tab === undefined; })());
  check('Voltar para a comparação (a janela de escolha) e remover o rival não perdem nem sujam nada: remover vai para a lista de escolha', (() => { const z = makeEnv(); z.api.rivalSet('carla'); z.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' }; z.api.rivalRemove(); return z.env.st.modal.picking === true && z.api.rivalGet() === '' && z.api.rivalNumbers() === null; })());
  const strip = makeEnv().api.rivalStrip(false);
  check('o convite da faixa passou a falar dos números ("Compare as suas conquistas e os seus números com os de um rival da liga.")', /Compare as suas conquistas e os seus números com os de um rival da liga\./.test(strip), strip.slice(0, 300));

  const pickM = (() => { const z = makeEnv(); z.env.st.modal = { type: 'rival', picking: true }; return z.api.mRival(); })();
  check('a lista de escolha avisa que vai comparar as conquistas E os números', /Escolha um jogador da liga para comparar as conquistas e os números\. A escolha fica só neste aparelho e o outro jogador não é avisado\./.test(pickM) && !/Compartilhar números/.test(pickM) && !/rivalTab\(/.test(pickM), pickM.slice(0, 500));

  // ══ 4. OS DADOS DO CARTÃO ═════════════════════════════════════════════════════════════════════════════
  const rowsB = [{ label: 'Títulos', mine: '1', theirs: '3', lead: 'theirs', scored: true }, { label: 'Campeonatos', mine: '2', theirs: '3', lead: '', scored: false }, { label: 'Derrotas', mine: '2', theirs: '1', lead: 'theirs', scored: true }, { label: 'Gols', mine: '5', theirs: '2', lead: 'mine', scored: true }];
  const d1 = A.mjRivalNumData({ name: 'Ana Maria Souza', league: 'Série B Aceoma', photo: 'https://res.cloudinary.com/x/foto.jpg', rivalName: 'Bruno Costa', rows: rowsB });
  check('dados: nome, liga, foto https, iniciais dos dois, as linhas e o saldo (1 minha, 2 dele, 3 disputando) → o rival na frente, cor azul (rara)', d1.name === 'Ana Maria Souza' && d1.league === 'Série B Aceoma' && d1.photo === 'https://res.cloudinary.com/x/foto.jpg' && d1.initials === 'AM' && d1.rivalName === 'Bruno Costa' && d1.rivalInitials === 'BC' && d1.rows.length === 4 && d1.mineLead === 1 && d1.theirsLead === 2 && d1.scored === 3 && d1.status === 'behind' && d1.tier === 'rare' && d1.tone === A.MJ_TIERS.rare, d1);
  const d2 = A.mjRivalNumData({ name: 'A', rivalName: 'B', rows: [{ label: 'Gols', mine: '5', theirs: '2', lead: 'mine', scored: true }] }), d3 = A.mjRivalNumData({ name: 'A', rivalName: 'B', rows: [{ label: 'Gols', mine: '2', theirs: '2', lead: '', scored: true }] }), d4 = A.mjRivalNumData({ name: 'A', rivalName: 'B', rows: [{ label: 'Campeonatos', mine: '1', theirs: '1', lead: '', scored: false }] });
  check('a cor do cartão conta o saldo: na frente dourado (lendária), atrás azul (rara), empate verde (comum) e "nada em disputa" também verde', d2.status === 'ahead' && d2.tone === A.MJ_TIERS.legendary && d1.tone === A.MJ_TIERS.rare && d3.status === 'tie' && d3.tone === A.MJ_TIERS.common && d4.status === 'none' && d4.tone === A.MJ_TIERS.common);
  const dm = A.mjRivalNumData({ name: 'A', rivalName: 'B', rows: [{ label: 'Jogos', mine: '9', theirs: '1', lead: 'mine', scored: false }, { label: 'Gols', mine: '1', theirs: '2', lead: 'ninguem', scored: true }, { label: 'X', mine: 1, theirs: null, lead: 'theirs', scored: 1 }] });
  check('linha que não disputa nunca conta ponto, mesmo que venha com "quem está na frente"; "quem" desconhecido não conta; números viram texto e nulo vira vazio', dm.rows[0].lead === '' && dm.rows[1].lead === '' && dm.rows[2].lead === 'theirs' && dm.rows[2].mine === '1' && dm.rows[2].theirs === '' && dm.mineLead === 0 && dm.theirsLead === 1 && dm.scored === 2 && dm.status === 'behind', dm);
  const dv = A.mjRivalNumData({});
  check('sem nada: "Jogador" contra "Rival", iniciais J e R, sem liga, sem foto, sem linhas e sem saldo (nunca quebra)', dv.name === 'Jogador' && dv.rivalName === 'Rival' && dv.initials === 'J' && dv.rivalInitials === 'R' && dv.league === '' && dv.photo === '' && dv.rows.length === 0 && dv.status === 'none' && A.mjRivalNumData({ rows: 'oi' }).rows.length === 0);
  check('a foto só vale se for https; linhas sem nome saem; no máximo 12 linhas', ['http://x/f.jpg', 'javascript:alert(1)', '/foto.jpg', 'data:image/png;base64,AA', 123, null].every(p => A.mjRivalNumData({ photo: p }).photo === '') && A.mjRivalNumData({ rows: [null, {}, { label: '' }, { label: 'ok', mine: '1', theirs: '2' }] }).rows.length === 1 && A.mjRivalNumData({ rows: Array.from({ length: 30 }, (_, i) => ({ label: 'L' + i })) }).rows.length === 12);
  const priv = A.mjRivalNumData({ name: 'Ana', rivalName: 'Bruno', rows: rowsB, email: 'ana@x.com', whatsapp: '11999998888', uid: 'abc123', phone: '1133334444', rivalEmail: 'b@x.com', rivalPhoto: 'https://x.com/rival.jpg' });
  check('PRIVACIDADE: e-mail, WhatsApp, telefone, id de conta e a foto do rival que cheguem por engano NÃO entram nos dados do cartão', !/ana@x\.com|b@x\.com|11999998888|abc123|1133334444|whatsapp|email|rival\.jpg/i.test(JSON.stringify(priv)) && priv.photo === '', priv);
  const fr = (st, a, b, n) => A.mjRivalNumVerdict({ status: st, mineLead: a, theirsLead: b, scored: n });
  check('a frase em primeira pessoa e no plural certo: "Estou na frente em 4 de 6 números!", "Meu rival está na frente em 1 de 1 número", "Empatados nos números!" e vazia sem disputa', fr('ahead', 4, 1, 6) === 'Estou na frente em 4 de 6 números!' && fr('ahead', 1, 0, 1) === 'Estou na frente em 1 de 1 número!' && fr('behind', 2, 3, 6) === 'Meu rival está na frente em 3 de 6 números' && fr('behind', 0, 1, 1) === 'Meu rival está na frente em 1 de 1 número' && fr('tie', 2, 2, 5) === 'Empatados nos números!' && fr('none', 0, 0, 0) === '');
  const cap = A.mjRivalNumCaption(d1);
  check('legenda: gancho, a frase, a pergunta, o convite com ?ref=cartao e as hashtags, em 4 linhas, SEM nome de ninguém nem liga; sem disputa a frase some (3 linhas)', cap === `Eu x meu rival no Pelada na Mão ⚔️\nMeu rival está na frente em 2 de 3 números\nQuem é o destaque de verdade na sua pelada? Compare os seus números: ${LINK}\n#pelada #futebolamador #peladanamao` && !/Ana|Bruno|Série|Souza|Costa/.test(cap) && A.mjRivalNumCaption(d4) === `Eu x meu rival no Pelada na Mão ⚔️\nQuem é o destaque de verdade na sua pelada? Compare os seus números: ${LINK}\n#pelada #futebolamador #peladanamao`, cap);
  const K = A.MJ_KINDS.rivalnum;
  check('o tipo de janela "rivalnum": título, arquivos diferentes dos outros, texto de compartilhar com a frase e o link (sem nomes) e a legenda', K.title === '📤 Meus números × rival' && K.file.story === 'rival-numeros-pelada-na-mao-story.png' && K.file.feed === 'rival-numeros-pelada-na-mao.png' && K.text(d1) === `Meus números x os do meu rival no Pelada na Mão ⚔️ Meu rival está na frente em 2 de 3 números\nFaça a liga da sua pelada: ${LINK}` && K.text(d4) === `Meus números x os do meu rival no Pelada na Mão ⚔️\nFaça a liga da sua pelada: ${LINK}` && K.caption(d1) === cap && !/Ana|Bruno|Série/.test(K.text(d1)) && typeof K.draw.feed === 'function' && typeof K.draw.story === 'function' && ![A.MJ_KINDS.player, A.MJ_KINDS.badge, A.MJ_KINDS.badges, A.MJ_KINDS.rival].some(o => Object.values(o.file).some(f => Object.values(K.file).includes(f))));

  // ══ 5. O DESENHO ══════════════════════════════════════════════════════════════════════════════════════
  const draw = (data, ph = null, lg = logo, fn = 'drawMjRivalNumCard') => { const x = fakeCtx(); A[fn](x, data, ph, lg); return x; };
  const full = A.mjRivalNumData({ name: 'Ana Maria Souza', league: 'Série B Aceoma', rivalName: 'Bruno Costa', rows: (() => { const z = makeEnv(); z.api.rivalSet('carla'); return z.api.rivalNumbers().rows; })() });
  let c = draw(full, photo);
  const tx = s => c.texts.find(t => t.text === s);
  check('textos do cartão: título, os dois nomes em maiúsculas, a frase, cada nome de número em maiúsculas, os valores dos dois lados, a liga e o rodapé', ['EU × MEU RIVAL · OS NÚMEROS', 'ANA MARIA SOUZA', 'BRUNO COSTA', 'Meu rival está na frente em 4 de 6 números', 'TÍTULOS', 'CAMPEONATOS', 'JOGOS', 'VITÓRIAS', 'EMPATES', 'DERROTAS', '% DE VITÓRIAS', 'GOLS', 'VEZES ARTILHEIRO', '29%', '33%', 'Série B Aceoma', 'Crie a liga da sua pelada', 'peladanamao.com.br'].every(t => said(c).includes(t)), said(c));
  check('a minha foto vai DENTRO do recorte redondo (esquerda); o rival só tem as iniciais (BC) e NENHUMA outra foto é desenhada; o logo no topo', c.images.length === 2 && c.images[0].img === logo && c.images[1].img === photo && c.images[1].clipped === true && c.images[1].ax < 540 && tx('BC') && tx('BC').x === 810 && !tx('AM'), c.images.map(i => [i.clipped, i.ax]));
  const sf = draw(full, null);
  check('sem foto minha: as minhas iniciais (AM) no lugar, na cor do cartão, e o logo continua; o rival tem as iniciais em cinza', sf.images.length === 1 && sf.texts.find(t => t.text === 'AM').fill === COLORS.rare && sf.texts.find(t => t.text === 'BC').fill === '#8b949e');
  for (const [k, status, cor, outras] of [['na frente', 'ahead', COLORS.legendary, [COLORS.rare, COLORS.common]], ['atrás', 'behind', COLORS.rare, [COLORS.legendary, COLORS.common]], ['empate', 'tie', COLORS.common, [COLORS.legendary, COLORS.rare]]]) {
    const lead = status === 'ahead' ? 'mine' : status === 'behind' ? 'theirs' : '';
    const data = A.mjRivalNumData({ name: 'Ana', rivalName: 'Bruno', rows: [{ label: 'Gols', mine: '5', theirs: '2', lead, scored: true }, { label: 'Jogos', mine: '7', theirs: '9', lead: '', scored: false }] });
    const x = draw(data, null);
    const stops = [A.MJ_TIERS.legendary, A.MJ_TIERS.epic, A.MJ_TIERS.rare, A.MJ_TIERS.common].filter(t => t.color !== cor).flatMap(t => [t.bg, t.glow]);
    check(`saldo ${k}: moldura, título, frase e rodapé na cor ${cor}; fundo e brilho do nível; nenhuma cor dos outros placares aparece`, x.strokes.length === 1 && x.strokes[0].color === cor && x.strokes[0].width === 6 && x.texts.find(t => t.text === 'EU × MEU RIVAL · OS NÚMEROS').fill === cor && x.texts.find(t => t.text === 'peladanamao.com.br').fill === cor && x.texts.find(t => /na frente|Empatados/.test(t.text)).fill === cor && x.stops.includes(A.MJ_TIERS[data.tier].bg) && x.stops.includes(A.MJ_TIERS[data.tier].glow) && !stops.some(s => x.stops.includes(s)) && !x.texts.some(t => outras.includes(t.fill)) && !x.fills.some(f => outras.includes(f)), [x.strokes, x.stops]);
  }
  const valor = (ctx, label, lado) => { const y = ctx.texts.find(t => t.text === label.toUpperCase()).y; return ctx.texts.find(t => t.x === (lado === 'meu' ? 270 : 810) && Math.abs(t.y - (y + 1)) <= 3 && /Bebas|Impact/.test(t.font)); };
  check('em cada linha que disputa, quem está na frente leva a cor do cartão e o outro fica branco; linha que só informa e empate ficam brancos dos dois lados', valor(c, 'Vitórias', 'meu').fill === '#ffffff' && valor(c, 'Vitórias', 'rival').fill === COLORS.rare && valor(c, 'Derrotas', 'meu').fill === COLORS.rare && valor(c, 'Derrotas', 'rival').fill === '#ffffff' && valor(c, 'Títulos', 'meu').fill === '#ffffff' && valor(c, 'Títulos', 'rival').fill === '#ffffff' && valor(c, 'Campeonatos', 'meu').fill === '#ffffff' && valor(c, 'Campeonatos', 'rival').fill === '#ffffff' && valor(c, 'Gols', 'rival').fill === COLORS.rare, c.texts.filter(t => t.x === 270 || t.x === 810).map(t => [t.text, t.x, t.y, t.fill]));
  const ys = full.rows.map(r => c.texts.find(t => t.text === r.label.toUpperCase()).y);
  check('as 9 linhas: uma embaixo da outra, de 66 em 66 px, entre 590 e 1190, com o nome do número centralizado na imagem (x = 540) e os valores em 270 e 810', ys.length === 9 && ys.every((y, i) => i === 0 || Math.abs(y - ys[i - 1] - 66) < 0.001) && ys[0] - 33 >= 590 && ys[8] + 33 <= 1190 && full.rows.every(r => c.texts.find(t => t.text === r.label.toUpperCase()).x === 540) && c.texts.filter(t => /Bebas|Impact/.test(t.font) && (t.x === 270 || t.x === 810) && t.y > 590).length === 18, ys);
  const dentro = ctx => ctx.texts.filter(t => t.x < 0 || t.x > W || t.y < 0 || t.y > H);
  check('todo texto fica dentro da imagem (1080×1350) e a última linha termina antes do rodapé ("Crie a liga…" em 1236)', dentro(c).length === 0 && ys[8] + 33 < tx('Crie a liga da sua pelada').y - 30 && tx('Crie a liga da sua pelada').y === 1236 && tx('peladanamao.com.br').y === 1296, ys);
  const poucas = draw(A.mjRivalNumData({ name: 'Ana', rivalName: 'Bruno', rows: [rowsB[0], rowsB[3]] }), null), yp = poucas.texts.filter(t => t.text === 'TÍTULOS' || t.text === 'GOLS').map(t => t.y);
  check('com poucas linhas elas ficam no centro da área da tabela (590 a 1190), com 66 px cada: 2 linhas → os nomes em 858 e 924 (linhas centradas em 857 e 923), a média em 891 (o meio da área, 890, mais 1 px do alinhamento do texto)', yp.length === 2 && yp[0] === 858 && yp[1] === 924 && (yp[0] + yp[1]) / 2 === 891, yp);
  const doze = draw(A.mjRivalNumData({ name: 'Ana', rivalName: 'Bruno', rows: Array.from({ length: 14 }, (_, i) => ({ label: 'Linha ' + i, mine: String(i), theirs: String(i + 1), lead: 'theirs', scored: true })) }), null), yd = Array.from({ length: 12 }, (_, i) => doze.texts.find(t => t.text === 'LINHA ' + i)?.y);
  check('com o máximo que os dados aceitam (12 linhas) a tabela se aperta (50 px cada) e continua entre 590 e 1190, sem passar do rodapé', yd.every(y => typeof y === 'number') && yd.every((y, i) => i === 0 || y - yd[i - 1] === 50) && yd[0] - 26 >= 590 && yd[11] + 24 <= 1190 && !doze.texts.some(t => t.text === 'LINHA 12'), yd);
  check('as faixas claras alternadas atrás das linhas: uma a cada duas (9 linhas → 5 faixas; 2 linhas → 1; 12 linhas → 6)', c.fills.filter(f => f === 'rgba(255,255,255,0.06)').length === 5 && poucas.fills.filter(f => f === 'rgba(255,255,255,0.06)').length === 1 && doze.fills.filter(f => f === 'rgba(255,255,255,0.06)').length === 6, [c.fills.length, poucas.fills.length, doze.fills.length]);
  const sem = draw(A.mjRivalNumData({ name: 'Ana', rivalName: 'Bruno' }), null);
  check('sem nenhuma linha: o cartão sai (título, nomes, rodapé) sem frase e sem quebrar', said(sem).includes('EU × MEU RIVAL · OS NÚMEROS') && said(sem).includes('ANA') && said(sem).includes('BRUNO') && !said(sem).some(t => /na frente|Empatados/.test(t)) && dentro(sem).length === 0);
  const longo = draw(A.mjRivalNumData({ name: 'Fulano de Tal da Silva Sauro Pereira Gonçalves de Albuquerque Junior Neto Filho', rivalName: 'Letícia Moreira Santos de Albuquerque Filha do Meio', league: 'Liga dos Veteranos do Bairro Alto da Boa Vista do Meio do Nada e Adjacências', rows: [{ label: 'Um nome de número bem comprido demais', mine: '1000000000000', theirs: '2000000000000', lead: 'mine', scored: true }] }), null);
  check('nomes enormes (os dois, a liga, o nome do número e os valores): encolhem/cortam e ficam dentro da largura (440 px para cada nome, 680 para a liga, 340 para o nome do número, 300 para cada valor)', longo.texts.filter(t => /FULANO|LETÍCIA/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 440) && longo.texts.filter(t => /Liga dos/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 680) && longo.texts.filter(t => /UM NOME|^UM /.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 340) && longo.texts.filter(t => /^\d{3,}/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 300) && dentro(longo).length === 0, longo.texts.map(t => [t.text, t.font]));
  const ss = draw(full, photo, logo, 'drawMjRivalNumStory'), S = A.MJ_STORY, kS = (S.H - S.TOP - S.BOTTOM) / A.MJ_CARD.H;
  check('Story: o MESMO cartão inteiro, escalado entre as margens de 250 e 340 px, com os mesmos textos, o brilho acompanhando (y = 250 + 400·k) e a mesma cor do saldo', ss.texts.every(t => Math.abs(t.k - kS) < 1e-9 && t.ay >= S.TOP && t.ay <= S.H - S.BOTTOM + 60) && JSON.stringify(said(ss)) === JSON.stringify(said(c)) && Math.abs(ss.radials[0][1] - (S.TOP + 400 * kS)) < 1e-6 && ss.strokes[0].color === COLORS.rare && ss.images.length === 2, ss.radials[0]);

  // ══ 6. COMPARTILHAR ═══════════════════════════════════════════════════════════════════════════════════
  e = makeEnv(); e.api.rivalSet('carla'); e.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' };
  const op = e.api.openMjRivalNumbers();
  check('Compartilhar números: fecha a janela do rival, redesenha e abre a janela dos cartões ("📤 Meus números × rival", "Montando a comparação…"), contando a abertura (cardOpen)', e.env.st.modal === null && e.calls.renders === 1 && e.layers.length === 1 && /📤 Meus números × rival/.test(e.layers[0].innerHTML) && /Montando a comparação…/.test(e.layers[0].innerHTML) && e.api.getKind() === 'rivalnum' && JSON.stringify(e.calls.events) === '[["cardOpen",true]]', [e.env.st.modal, e.calls.events]);
  await op;
  const ctxF = e.calls.canvases[0].ctx, ctxS = e.calls.canvases[1].ctx;
  check('pronto: duas imagens (Feed 1080×1350 e Story 1080×1920) com os meus dados e os do rival: nomes, a frase, a tabela; a minha foto (do aparelho) e só as iniciais do rival; atrás = azul', e.calls.canvases.length === 2 && e.calls.canvases[0].height === 1350 && e.calls.canvases[1].height === 1920 && ['ANA', 'CARLA', 'Série B Aceoma', 'Meu rival está na frente em 4 de 6 números', 'VITÓRIAS', '29%', '33%'].every(t => said(ctxF).includes(t) && said(ctxS).includes(t)) && ctxF.images.length === 2 && ctxF.images[1].img.__photo === true && ctxF.strokes[0].color === COLORS.rare && ctxS.strokes[0].color === COLORS.rare && !said(ctxF).includes('BRUNO'), said(ctxF));
  const br = makeEnv(); br.api.rivalSet('bruno'); br.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' }; await br.api.openMjRivalNumbers();
  const imgs = br.calls.canvases.flatMap(cv => cv.ctx.images.map(i => i.img._src));
  check('a foto do rival NUNCA é carregada nem desenhada, mesmo ele tendo foto na liga (o Bruno tem): nos dois formatos só o logo e a minha foto', imgs.length === 4 && imgs.filter(s => /logo/.test(s)).length === 2 && imgs.filter(s => /foto\.jpg$/.test(s)).length === 2 && !imgs.some(s => /bruno/.test(s)), imgs);
  check('o alt da prévia fala da comparação de números e os botões são os de sempre (Compartilhar, Copiar legenda, Baixar)', /alt="Comparação de números com o meu rival no Pelada na Mão, formato Story"/.test(e.layers[0].innerHTML) && /shareMjCard\(\)/.test(e.layers[0].innerHTML) && /copyMjCaption\(\)/.test(e.layers[0].innerHTML) && /downloadMjCard\(\)/.test(e.layers[0].innerHTML));
  await e.api.shareMjCard(); const sh = e.calls.shared[0];
  check('compartilhar no Story: arquivo rival-numeros-pelada-na-mao-story.png, título "Meus números x os do meu rival no Pelada na Mão" e o texto só com a frase e o link ?ref=cartao (sem nenhum nome); conta cardShare', sh.files[0].name === 'rival-numeros-pelada-na-mao-story.png' && sh.title === 'Meus números x os do meu rival no Pelada na Mão' && sh.text === `Meus números x os do meu rival no Pelada na Mão ⚔️ Meu rival está na frente em 4 de 6 números\nFaça a liga da sua pelada: ${LINK}` && !/Ana|Carla|Série/.test(sh.text) && JSON.stringify(e.calls.events) === '[["cardOpen",true],["cardShare",false]]' && (await sh.files[0].text()) === 'png1920', [sh.files[0].name, sh.text, e.calls.events]);
  e.api.setMjFormat('feed'); await e.api.shareMjCard();
  check('no Feed: arquivo rival-numeros-pelada-na-mao.png (a imagem de 1350 px)', e.calls.shared[1].files[0].name === 'rival-numeros-pelada-na-mao.png' && (await e.calls.shared[1].files[0].text()) === 'png1350');
  await e.api.copyMjCaption();
  check('Copiar legenda: a dos números (4 linhas, com a frase), sem nome nenhum', e.calls.copied[0] === `Eu x meu rival no Pelada na Mão ⚔️\nMeu rival está na frente em 4 de 6 números\nQuem é o destaque de verdade na sua pelada? Compare os seus números: ${LINK}\n#pelada #futebolamador #peladanamao` && !/Ana|Carla|Série/.test(e.calls.copied[0]), e.calls.copied);
  e.api.downloadMjCard();
  check('baixar: rival-numeros-pelada-na-mao.png (o Feed está escolhido)', e.calls.clicks.length === 1 && e.calls.clicks[0].download === 'rival-numeros-pelada-na-mao.png');
  const ahead = makeEnv(); ahead.api.rivalSet('gil'); ahead.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' }; await ahead.api.openMjRivalNumbers();
  check('na frente (Ana × Gil): cartão dourado e "Estou na frente em 3 de 5 números!" no cartão e na legenda', ahead.calls.canvases[0].ctx.strokes[0].color === COLORS.legendary && said(ahead.calls.canvases[0].ctx).includes('Estou na frente em 3 de 5 números!') && (await (async () => { await ahead.api.copyMjCaption(); return /Estou na frente em 3 de 5 números!/.test(ahead.calls.copied[0]); })()));
  const igualE = makeEnv({ champs: [{ id: 'y1', date: '2026-09-09', status: 'completed', freeMode: false, teamRosters: { azul: ['Ana', 'Bruno'], verde: ['Carla'] }, matches: [mt('regular', 'azul', 'verde', 1, 0)] }], ranks: [{ id: 'ana', name: 'Ana', titles: 1 }, { id: 'bruno', name: 'Bruno', titles: 1 }] });
  igualE.api.rivalSet('bruno'); await igualE.api.openMjRivalNumbers();
  check('empate: cartão verde e "Empatados nos números!"', igualE.calls.canvases[0].ctx.strokes[0].color === COLORS.common && said(igualE.calls.canvases[0].ctx).includes('Empatados nos números!'));
  const e3 = makeEnv({ canShare: false }); e3.api.rivalSet('carla'); await e3.api.openMjRivalNumbers(); await e3.api.shareMjCard();
  check('computador (sem compartilhar arquivo): baixa a imagem dos números em vez de ficar parado', e3.calls.shared.length === 0 && e3.calls.clicks.length === 1 && e3.calls.clicks[0].download === 'rival-numeros-pelada-na-mao-story.png');
  const sr = makeEnv(), pn = sr.api.openMjRivalNumbers(), z2 = makeEnv({ sim: 'bruno' }); z2.api.rivalSet('carla'); z2.api.openMjRivalNumbers();
  const z3 = makeEnv({ champs: [], ranks: [] }); z3.api.rivalSet('bruno'); z3.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' }; z3.api.openMjRivalNumbers();
  check('sem rival, na simulação do admin ou sem nenhum número para mostrar: Compartilhar números não abre nada, não conta evento nem fecha a janela', pn === undefined && sr.layers.length === 0 && sr.calls.events.length === 0 && sr.calls.renders === 0 && z2.layers.length === 0 && z2.calls.events.length === 0 && z3.layers.length === 0 && z3.calls.events.length === 0 && z3.env.st.modal?.type === 'rival' && z3.calls.renders === 0);
  const fh = makeEnv(); fh.api.rivalSet('carla'); fh.env.st.modal = { type: 'rival', picking: false, tab: 'numbers' }; fh.env.st.photos = {}; await fh.api.openMjRivalNumbers();
  check('sem foto minha: o cartão sai com as minhas iniciais (e só o logo é desenhado)', fh.calls.canvases[0].ctx.images.length === 1 && said(fh.calls.canvases[0].ctx).includes('AM') === false && said(fh.calls.canvases[0].ctx).includes('A'));

  // ══ 7. COMO ESTÁ LIGADO NO APP ════════════════════════════════════════════════════════════════════════
  const semComentarios = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('o bloco do rival continua sem falar com o servidor nem contar evento: nenhuma chamada de rede, banco, evento ou Firebase (os números saem do que o app já tem na memória)', !/callFn|DB\.|fetch\(|trackEvent|firebase|firestore|XMLHttp|sendBeacon/i.test(semComentarios(rivalCode)) && /localStorage/.test(semComentarios(rivalCode)));
  check('PRIVACIDADE: o bloco do rival (com os números) não cita e-mail, WhatsApp nem contatos; a conta aparece só na chave da guarda', !/whatsapp|e-?mail|contacts|waOf/i.test(semComentarios(rivalCode)) && semComentarios(rivalCode).split('\n').filter(l => /authUser/.test(l)).every(l => /^const rivalStoreKey = \(\) => \(st\.authUser\?\.uid/.test(l.trim())));
  check('PRIVACIDADE: os dados, o desenho, a legenda e a conta dos jogos dos números nem citam e-mail, WhatsApp, contatos nem a conta logada', (() => { const s = slice('function mjRivalNumData', 'function mjRoundRect') + slice('function drawMjRivalNumCard', 'function mjLoadImage') + slice('function mjRivalNumCaption', 'async function copyMjCaption') + slice('function matchRecord', 'function goallessStreak') + slice('const rivalTitlesText', 'function rivalPick') + slice('function rivalTab', 'function mRival'); return !/whatsapp|e-?mail|contacts|authUser|waOf|\.uid/i.test(semComentarios(s)); })());
  check('nenhum contador novo no servidor: o módulo do cartão continua só com cardOpen e cardShare e um único link (?ref=cartao)', JSON.stringify([...new Set([...code.matchAll(/trackEvent\('([A-Za-z]+)'/g)].map(x => x[1]))].sort()) === JSON.stringify(['cardOpen', 'cardShare']) && (code.match(/\?ref=/g) || []).length === 1);
  check('a política de privacidade do app cita os números do rival (as conquistas e os números de cada um, o que a liga já mostra, e que a imagem leva o nome do rival)', /<strong>Rival:<\/strong> se você escolher um rival para comparar conquistas e números, a escolha fica guardada só neste aparelho \(nada é enviado ao servidor e o outro jogador não é avisado\)\. A comparação usa o que a liga já mostra para todos os jogadores: as conquistas e os números de cada um \(títulos, campeonatos, gols, vezes artilheiro e as vitórias, empates e derrotas dos times em que jogou\)\. Se você compartilhar a imagem da comparação, ela leva o nome do seu rival\./.test(html));
  check('o passo do teste novo está no CI (job test), sem ": " no nome do passo (que quebra o YAML)', /- name: Testes do app \(comparar os números com o rival - [^\n:]*\)\n\s+working-directory: functions\n\s+run: node test\/client-rival-numbers-test\.js/.test(ci));

  // ══ 8. MANUAL ═════════════════════════════════════════════════════════════════════════════════════════
  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(').trim();
  const sec13 = plainM(manual.slice(manual.indexOf('<h3 id="rival">'), manual.indexOf('<h3>Modo de teste (admin)</h3>')));
  const sec29 = plainM(manual.slice(manual.indexOf('id="cartao-jogador"'), manual.indexOf('<!-- 30. Página de Apresentação')));
  check('manual (seção 13): as duas abas (Conquistas e Números), a tabela com as 9 linhas e de onde vêm, o que desaparece, quem leva a cor (derrotas ao contrário; campeonatos, jogos e empates só informam), a frase de saldo e o botão de compartilhar números', /duas abas: 🏅 Conquistas \(a janela abre nela\) e 📊 Números/.test(sec13) && /Tabela de números \(aba Números\)/.test(sec13) && ['Títulos', 'Campeonatos', 'Jogos', 'Vitórias', 'Empates', 'Derrotas', '% de vitórias', 'Gols', 'Vezes artilheiro'].every(t => sec13.includes(t)) && /Resumo de Jogos/.test(sec13) && /desde 08\/09\/2026, quando o registro de gols começou/.test(sec13) && /A linha em que os dois têm zero não aparece/.test(sec13) && /em Derrotas, quem tem menos/.test(sec13) && /Campeonatos, Jogos e Empates só informam/.test(sec13) && /só disputam quando os dois já jogaram/.test(sec13) && /Você está na frente em 4 de 6 números!/.test(sec13) && /Empate nos números!/.test(sec13) && /Compartilhar números/.test(sec13), sec13.slice(0, 400));
  check('manual (seção 13): a privacidade diz que os números saem do que a liga já mostra E avisa que vitórias, empates e derrotas do rival passam a aparecer (antes só no perfil de cada um); o técnico cita rivalNumbers e matchRecord', /Atenção: o Resumo de Jogos \(vitórias, empates e derrotas\) só aparecia no perfil de cada um; agora quem escolhe um rival vê esses três números dele/.test(sec13) && /na aba Números, os títulos, os campeonatos, os gols, as vezes artilheiro e as vitórias, empates e derrotas/.test(sec13) && /rivalNumbers/.test(sec13) && /matchRecord/.test(sec13) && /RIVAL_NUMBER_ROWS/.test(sec13) && /nada é enviado ao servidor e o rival não é avisado/.test(sec13), sec13.slice(-900));
  const sec29n = sec29.slice(sec29.indexOf('Cartão "Meus números × rival"')); // só a explicação do cartão dos números (o do rival das conquistas, logo acima, tem frases parecidas)
  check('manual (seção 29): o arquivo e a legenda do cartão dos números na tabela e a explicação do cartão (lado a lado, iniciais do rival e nunca a foto, frase, tabela com a cor de quem está na frente, dourado/azul/verde, legenda sem nome, rivalNumbers e rivalnum)', /Meus números × rival rival-numeros-pelada-na-mao-story\.png \/ rival-numeros-pelada-na-mao\.png/.test(sec29) && sec29n.startsWith('Cartão "Meus números × rival"') && /iniciais do rival, nunca a foto dele/.test(sec29n) && /tabela dos números, uma linha por número, com o meu à esquerda e o do rival à direita/.test(sec29n) && /dourado quando estou, azul quando o rival está e verde no empate/.test(sec29n) && /A legenda e o texto que vão junto levam só a frase, sem nome nenhum/.test(sec29n) && /rivalNumbers/.test(sec29n) && /rivalnum/.test(sec29n) && /drawMjRivalNumCard/.test(sec29n) && /mjRivalNumData/.test(sec29n), sec29n.slice(0, 300));
  check('manual × código: os nomes de arquivo do manual são os do código', Object.values(A.MJ_KINDS.rivalnum.file).every(f => manual.includes('<code>' + f + '</code>')) && /dourado quando estou, azul quando o rival está e verde no empate/.test(sec29) && /status === 'ahead' \? 'legendary' : status === 'behind' \? 'rare' : 'common'/.test(slice('function mjRivalNumData', 'function mjRoundRect')));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
