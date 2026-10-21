// ESTRELAS PELA MÉDIA DO GRUPO (index.html, item 35): qual estrela vale (a do admin, a média do grupo ou a fixada), o sorteio com notas fracionadas, o Elenco (frase miúda, 📌, botão
// "Avaliar o elenco"), a janela de avaliar e o que ela manda ao servidor, os avisos ao servidor quando o elenco muda, o Painel Admin, a política de privacidade, o manual e o CI.
// Extrai o código real e o executa num ambiente simulado, sem navegador. Regras: a opção vem DESLIGADA e desligada nada muda; ligada, a média só vale a partir de metade de quem joga (no
// mínimo 3 votos) e se o admin não fixou a estrela; o sorteio usa a média exata (3,6), com somas em INTEIRO de centésimos (sem erro de ponto flutuante) e, com notas inteiras, sorteia
// EXATAMENTE como antes (comparado com o algoritmo antigo, guardado aqui); ninguém avalia a si mesmo; a nota é de 1 a 5 e tocar de novo na mesma estrela tira a nota.
const fs = require('fs');
const path = require('path');
const sv = require('../star-votes');

const read = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), manual = read('manual.html'), ci = read('.github/workflows/ci.yml'), rules = read('firestore.rules'), fnsSrc = read('functions/index.js');
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
const helpersCode = slice('/* ── Estrelas: o que vale', 'async function setPlayerStars(');
const actionsCode = slice('async function setPlayerStars(', 'function toggleDrawAbsent(');
const drawCode = slice('function balancedDraw(', 'function setDrawTeamColor(') + '\n' + slice('function randomDraw(', 'function addDrawExtra(');
const renderStarsCode = slice('function renderStars(', 'function renderDrawCard(');
const drawCardCode = slice('function renderDrawCard()', 'function vPlayers() {');
const vPlayersCode = slice('function vPlayers() {', 'function vRanking() {');
const avatarCode = slice('function playerAvatar(', 'function resizeImageToBlob(');
const voteMeCode = slice('function myVotePlayer() {', 'function canVoteIn(');
const renameCode = slice('async function deleteRegisteredPlayer(key) {', 'async function migrateRenameInChamps(');
const keyCode = slice('const playerKey = name =>', '\n\n');
const escCode = slice('const esc = s =>', 'function toast(');

const PLAYERS = [
  { id: 'ana', name: 'Ana', stars: 3 }, { id: 'bia', name: 'Bia', stars: 4 }, { id: 'caio', name: 'Caio', stars: 2, goleiro: true }, { id: 'dani', name: 'Dani', stars: 5 },
  { id: 'edu', name: 'Edu', stars: 0 }, { id: 'fabio', name: 'Fábio', stars: 3, active: false }, { id: 'gil', name: 'Gil', stars: 1, somenteChurrasco: true },
  { id: 'hugo', name: 'Hugo', stars: 4 }, { id: 'iara', name: 'Iara', stars: 3 }, { id: 'joao', name: 'João', stars: 2 },
]; // 8 jogam (Fábio é inativo, Gil só vai ao churrasco): são precisos 4 votos

function makeEnv({ players = PLAYERS, appCfg = { peerStars: true }, admin = true, me = 'ana', sim = null, saved = null, readFails = false, callFails = null, confirmAnswer = true, champs = [], lsFails = false, noDB = false, callResult = { ok: true, recipients: 6, withPush: 5 } } = {}) {
  const calls = { updates: [], sets: [], deletes: [], toasts: [], renders: 0, fn: [], confirms: [], reads: [], closes: 0, scroll: [], contacts: [], busyAtCall: [], callingAtCall: [] };
  const ls = new Map();
  const db = { doc: p => ({ get: async () => { calls.reads.push(p); if (readFails) throw new Error('sem permissão'); return saved ? { exists: true, data: () => saved } : { exists: false, data: () => undefined }; } }) };
  const ldoc = p => ({
    update: async d => { calls.updates.push([p, d]); }, set: async d => { calls.sets.push([p, d]); }, delete: async () => { calls.deletes.push(p); },
    get: async () => ({ exists: false, data: () => undefined }),
  });
  const env = {
    st: { authUser: { uid: 'u1' }, leagueId: 'liga1', userDoc: { playerKey: me }, players: players.map(p => ({ ...p })), appCfg: { ...appCfg }, mjPreviewKey: sim, modal: null, ready: true, photos: {}, ranks: [], champs, finMens: {}, drawResult: null, drawTeamColors: [], drawNumTeams: 2, drawMode: 'balanced', drawExtras: [] },
    DB: noDB ? null : db, ldoc, col: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
    isAdmin: () => admin, toast: (m, t) => { calls.toasts.push([m, t]); }, render: () => { calls.renders++; },
    confirm: msg => { calls.confirms.push(msg); return confirmAnswer; },
    callFn: async (name, data) => { calls.fn.push([name, data]); calls.busyAtCall.push(!!(env.st.modal && env.st.modal.busy)); calls.callingAtCall.push(!!env.st._starsCalling); if (callFails) throw new Error(callFails); return name === 'notifyStarRatings' ? callResult : { ok: true }; },
    localStorage: { getItem: k => { if (lsFails) throw new Error('bloqueado'); return ls.has(k) ? ls.get(k) : null; }, setItem: (k, v) => { if (lsFails) throw new Error('bloqueado'); ls.set(k, String(v)); } },
    getModalScrollTop: () => 7, setModalScrollTop: v => { calls.scroll.push(v); },
    closeModal: () => { calls.closes++; env.st.modal = null; },
    waOf: () => '', saveContact: async (k, n) => { calls.contacts.push([k, n]); }, today: () => '2026-10-19',
    drawAbsentSet: () => new Set(), presetChamp: () => null, enabledColors: () => [['azul', { l: 'Azul', c: '#0000ff' }], ['verde', { l: 'Verde', c: '#00aa00' }]],
    T: { azul: { l: 'Azul', c: '#0000ff' }, verde: { l: 'Verde', c: '#00aa00' } }, computeGoalsRanking: () => ({ tally: {} }), getPlayerRarestBadge: () => null,
    getPlayerDrawStats: () => ({ titles: 0, goals: 0, last_date: null }), importPlayersFromRanking: () => {}, fdt: s => s,
  };
  const names = Object.keys(env);
  const body = [escCode, keyCode, avatarCode, voteMeCode, helpersCode, actionsCode, drawCode, renderStarsCode, drawCardCode, vPlayersCode, renameCode].join('\n') + `
return { peerStarsOn, playingPlayers, neededVotes, starsInfo, starsOf, starsText, starsDisplay, starsCaption, drawWeight, setPlayerStars, toggleStarsPinned, starSync, ratingTargets,
  openRateStars, rateStarSet, submitRateStars, mRateStars, starsCallPending, starsCallDone, dismissStarsCall, renderStarsCallBanner, callStarRaters, starsCallKey, balancedDraw, randomDraw, renderStars, renderDrawCard, vPlayers, deleteRegisteredPlayer, renamePlayer, playerKey };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, st: env.st, ls };
}
const withStars = (extra, opts) => { const e = makeEnv(opts); e.st.players = e.st.players.map(p => (p.id === 'ana' ? { ...p, ...extra } : p)); return e; };
const infoOf = (extra, opts) => { const e = withStars(extra, opts); return e.api.starsInfo(e.st.players.find(p => p.id === 'ana')); };
const abre = h => (h.match(/<div/g) || []).length, fecha = h => (h.match(/<\/div>/g) || []).length;
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { const real = Math.random; Math.random = mulberry32(seed); try { return fn(); } finally { Math.random = real; } };

(async () => {
  // ══ 1. QUAL ESTRELA VALE ═════════════════════════════════════════════════════════════════════════
  const E = makeEnv().api;
  check('a opção vem DESLIGADA: sem appCfg.peerStars nada muda (vale sempre a estrela do admin, mesmo com média e votos no cadastro)', (() => { const i = infoOf({ stars: 3, starsAvg: 4.5, starsVotes: 9 }, { appCfg: {} }); return i.source === 'admin' && i.value === 3 && i.votes === 0; })());
  check('opção desligada explicitamente (peerStars:false) também ignora a média e a fixação', infoOf({ stars: 2, starsAvg: 5, starsVotes: 9, starsPinned: true }, { appCfg: { peerStars: false } }).value === 2);
  check('opção ligada, votos suficientes (8 jogam → 4 votos): vale a MÉDIA do grupo', (() => { const i = infoOf({ stars: 3, starsAvg: 4.25, starsVotes: 4 }); return i.source === 'avg' && i.value === 4.25 && i.votes === 4 && i.needed === 4; })());
  check('opção ligada, 3 votos de 4 necessários: ainda vale a estrela do admin (e diz quantos votos faltam)', (() => { const i = infoOf({ stars: 3, starsAvg: 4.25, starsVotes: 3 }); return i.source === 'admin' && i.value === 3 && i.votes === 3 && i.needed === 4; })());
  check('o admin FIXOU a estrela: vale a dele, mesmo com a média pronta', (() => { const i = infoOf({ stars: 5, starsAvg: 1.5, starsVotes: 8, starsPinned: true }); return i.source === 'pinned' && i.value === 5; })());
  check('fixação só vale com o valor verdadeiro (booleano), não com "true" nem 1', infoOf({ stars: 5, starsAvg: 1.5, starsVotes: 8, starsPinned: 'true' }).source === 'avg' && infoOf({ stars: 5, starsAvg: 1.5, starsVotes: 8, starsPinned: 1 }).source === 'avg');
  check('média que não é número (texto, nulo, NaN, ausente) é ignorada: vale a estrela do admin', ['4', null, NaN, undefined, {}, [4]].every(a => infoOf({ stars: 3, starsAvg: a, starsVotes: 9 }).source === 'admin'));
  check('votos que não são número contam como zero', infoOf({ stars: 3, starsAvg: 4, starsVotes: 'muitos' }).source === 'admin' && infoOf({ stars: 3, starsAvg: 4, starsVotes: '9' }).source === 'avg');
  check('estrela do admin ausente ou torta vale 0 (sem nota)', infoOf({ stars: undefined }, { appCfg: {} }).value === 0 && infoOf({ stars: 'x' }, { appCfg: {} }).value === 0 && E.starsInfo(null).value === 0 && E.starsInfo(undefined).value === 0);
  check('starsOf devolve o mesmo valor que starsInfo', (() => { const e = withStars({ stars: 3, starsAvg: 4.25, starsVotes: 9 }); const p = e.st.players[0]; return e.api.starsOf(p) === e.api.starsInfo(p).value && e.api.starsOf(p) === 4.25; })());

  // quantos votos: metade de quem joga, no mínimo 3, igual ao servidor
  const nv = n => { const e = makeEnv(); e.st.players = Array.from({ length: n }, (_, i) => ({ id: 'j' + i, name: 'J' + i })); return e.api.neededVotes(); };
  check('votos necessários: 0 a 6 jogadores → 3; 7 → 4; 10 → 5; 11 → 6; 20 → 10; 30 → 15', [0, 1, 4, 5, 6, 7, 10, 11, 20, 30].map(nv).join() === '3,3,3,3,3,4,5,6,10,15', [0, 1, 4, 5, 6, 7, 10, 11, 20, 30].map(nv));
  check('a conta do app é a MESMA do servidor (functions/star-votes.js) para 0 a 80 jogadores', Array.from({ length: 81 }, (_, n) => n).every(n => nv(n) === sv.neededVotes(n)));
  check('quem não joga não entra na conta: inativo e "só churrasco" ficam de fora (10 no elenco, 8 jogam)', E.playingPlayers().length === 8 && !E.playingPlayers().some(p => ['fabio', 'gil'].includes(p.id)) && E.neededVotes() === 4);
  check('a conta acompanha o elenco: com mais 8 jogadores (16) o mínimo sobe para 8', (() => { const e = makeEnv(); for (let i = 0; i < 8; i++) e.st.players.push({ id: 'x' + i, name: 'X' + i }); return e.api.neededVotes() === 8 && e.api.starsInfo({ stars: 3, starsAvg: 4.5, starsVotes: 7 }).source === 'admin' && e.api.starsInfo({ stars: 3, starsAvg: 4.5, starsVotes: 8 }).source === 'avg'; })());

  // formatação
  check('starsText: inteiro sem casa ("4"), fracionado com UMA casa e vírgula ("3,7"), sem erro de ponto flutuante', [[4, '4'], [3.67, '3,7'], [3.95, '4'], [0, '0'], [2.05, '2,1'], [2.04, '2'], [17.3, '17,3'], [17.000000001, '17'], [16.999999999, '17'], [NaN, '0'], [undefined, '0'], ['x', '0']].every(([n, t]) => E.starsText(n) === t), [3.67, 3.95, 2.05, 17.000000001].map(n => E.starsText(n)));
  check('starsDisplay: "—" sem nota; inteiro = só as estrelas; fracionado = estrelas arredondadas + o número', E.starsDisplay(0) === '—' && E.starsDisplay(4) === '★★★★' && E.starsDisplay(3.7) === '★★★★ 3,7' && E.starsDisplay(3.4) === '★★★ 3,4' && E.starsDisplay(5) === '★★★★★' && E.starsDisplay(4.6) === '★★★★★ 4,6' && E.starsDisplay(undefined) === '—' && E.starsDisplay(1.2) === '★ 1,2');
  check('starsDisplay nunca passa de 5 estrelas nem some com nota baixa', E.starsDisplay(9) === '★★★★★' && E.starsDisplay(0.4) === '★ 0,4');
  const cap = (extra, opts) => { const e = withStars(extra, opts); return e.api.starsCaption(e.st.players[0]); };
  check('frase miúda: desligada = vazia; fixada; média com votos (plural e singular); votos que faltam; sem voto = vazia', cap({ stars: 3, starsAvg: 4, starsVotes: 9 }, { appCfg: {} }) === '' && cap({ stars: 5, starsPinned: true }) === '📌 estrela fixada pelo admin' && cap({ stars: 3, starsAvg: 3.67, starsVotes: 9 }) === 'média do grupo 3,7 · 9 votos' && cap({ stars: 3, starsAvg: 4, starsVotes: 4 }) === 'média do grupo 4 · 4 votos' && cap({ stars: 3, starsVotes: 3 }) === '3 votos de 4 para a média do grupo valer' && cap({ stars: 3, starsVotes: 1 }) === '1 voto de 4 para a média do grupo valer' && cap({ stars: 3 }) === '', [cap({ stars: 3, starsAvg: 3.67, starsVotes: 9 }), cap({ stars: 3, starsVotes: 1 })]);
  check('fixada ganha da média também na frase, mesmo com votos suficientes', cap({ stars: 5, starsPinned: true, starsAvg: 1, starsVotes: 9 }) === '📌 estrela fixada pelo admin');
  check('peso no sorteio: centésimos de estrela em INTEIRO; sem nota vale 3; 4,35 não vira 4,34 por erro de ponto flutuante', (() => { const e = makeEnv(); const w = x => e.api.drawWeight(x); return w({ stars: 4 }) === 400 && w({ stars: 0 }) === 300 && w({}) === 300 && w({ starsAvg: 3.67, starsVotes: 9, stars: 3 }) === 367 && w({ starsAvg: 4.35, starsVotes: 9 }) === 435 && Number.isInteger(w({ starsAvg: 1.1, starsVotes: 9 })); })());

  // ══ 2. O SORTEIO ═════════════════════════════════════════════════════════════════════════════════
  // o algoritmo ANTIGO (só estrelas inteiras, estrela do admin), guardado aqui para provar que ligas sem a opção sorteiam exatamente como antes
  const refBalanced = new Function(`
    function balancedDraw(players, n) {
      const goalies  = players.filter(p => p.goleiro);
      const outfield = players.filter(p => !p.goleiro);
      const shuffleTiers = arr => {
        const byStars = {};
        for (const p of arr) { const s = p.stars||3; (byStars[s]||(byStars[s]=[])).push(p); }
        for (const tier of Object.values(byStars)) {
          for (let i = tier.length-1; i > 0; i--) {
            const j = Math.floor(Math.random()*(i+1));
            [tier[i],tier[j]] = [tier[j],tier[i]];
          }
        }
        return [5,4,3,2,1].flatMap(s => byStars[s]||[]);
      };
      const sortedGoalies  = shuffleTiers(goalies);
      const sorted = shuffleTiers(outfield);
      const minSize = Math.floor(players.length / n);
      const extra   = players.length % n;
      const caps    = Array.from({length:n}, (_,i) => minSize + (i < extra ? 1 : 0));
      const teams = Array.from({length:n}, ()=>[]);
      const sums = new Array(n).fill(0);
      const extraGoalies = [];
      for (let gi = 0; gi < sortedGoalies.length; gi++) {
        const p = sortedGoalies[gi];
        if (gi < n) { teams[gi].push(p); sums[gi] += p.stars || 3; } else { extraGoalies.push(p); }
      }
      const remaining = [...sorted, ...extraGoalies];
      for (const p of remaining) {
        let bestIdx = -1, bestAvg = Infinity;
        for (let i = 0; i < n; i++) {
          if (teams[i].length >= caps[i]) continue;
          const avg = (sums[i] + (p.stars||3)) / (teams[i].length + 1);
          if (bestIdx === -1 || avg < bestAvg || (avg === bestAvg && teams[i].length < teams[bestIdx].length)) { bestAvg = avg; bestIdx = i; }
        }
        if (bestIdx === -1) bestIdx = 0;
        teams[bestIdx].push(p);
        sums[bestIdx] += p.stars || 3;
      }
      const avg = ()=>sums.map((s,i)=>teams[i].length?s/teams[i].length:0);
      let improved = true;
      while (improved) {
        improved = false;
        const avgs = avg();
        const curRange = Math.max(...avgs) - Math.min(...avgs);
        for (let i = 0; i < n && !improved; i++) {
          for (let j = i+1; j < n && !improved; j++) {
            for (let pi = 0; pi < teams[i].length && !improved; pi++) {
              for (let pj = 0; pj < teams[j].length && !improved; pj++) {
                if (teams[i][pi].goleiro || teams[j][pj].goleiro) continue;
                const si = teams[i][pi].stars||3, sj = teams[j][pj].stars||3;
                if (si === sj) continue;
                const ns = [...sums]; ns[i]=ns[i]-si+sj; ns[j]=ns[j]-sj+si;
                const navgs = ns.map((s,k)=>teams[k].length?s/teams[k].length:0);
                if (Math.max(...navgs)-Math.min(...navgs) < curRange) {
                  [teams[i][pi],teams[j][pj]] = [teams[j][pj],teams[i][pi]];
                  sums[i]=ns[i]; sums[j]=ns[j];
                  improved = true;
                }
              }
            }
          }
        }
      }
      return {teams, sums};
    }
    return balancedDraw;`)();
  const rnd = mulberry32(20261019);
  const randLeague = (size, { fractional = false, goalies = true } = {}) => Array.from({ length: size }, (_, i) => ({
    id: 'p' + i, name: 'P' + i, stars: Math.floor(rnd() * 6), goleiro: goalies && rnd() < 0.15,
    ...(fractional ? { starsVotes: 99, starsAvg: Math.round((1 + rnd() * 4) * 100) / 100 } : {}),
  }));
  let same = 0, trials = 0, firstDiff = null;
  for (let t = 0; t < 500; t++) {
    const size = 4 + Math.floor(rnd() * 20), n = 2 + Math.floor(rnd() * 4);
    if (size < n) continue;
    const league = randLeague(size);
    const seed = 1000 + t;
    const old = withSeed(seed, () => refBalanced(league.map(p => ({ ...p })), n));
    const e = makeEnv({ appCfg: {}, players: league });
    const neu = withSeed(seed, () => e.api.balancedDraw(league.map(p => ({ ...p })), n));
    trials++;
    const ids = r => r.teams.map(tm => tm.map(p => p.id).join(',')).join('|');
    if (ids(old) === ids(neu) && old.sums.every((s, i) => Math.abs(s - neu.sums[i]) < 1e-9)) same++; else if (!firstDiff) firstDiff = { t, old: ids(old), neu: ids(neu), os: old.sums, ns: neu.sums };
  }
  check(`com estrelas inteiras (sem a opção) o sorteio equilibrado dá EXATAMENTE o mesmo que o algoritmo antigo: ${same} de ${trials} ligas sorteadas (times, ordem e somas)`, same === trials && trials > 400, firstDiff);

  let okAll = 0, tr2 = 0, worst = null;
  const rangeOf = (r, sizeFix) => { const avgs = r.teams.map((tm, i) => r.sums[i] / tm.length); return Math.max(...avgs) - Math.min(...avgs); };
  for (let t = 0; t < 400; t++) {
    const size = 6 + Math.floor(rnd() * 20), n = 2 + Math.floor(rnd() * 4);
    const league = randLeague(size, { fractional: true });
    const e = makeEnv({ players: league });
    const r = withSeed(5000 + t, () => e.api.balancedDraw(league.map(p => ({ ...p })), n));
    tr2++;
    const placed = r.teams.flat().map(p => p.id).sort().join();
    const sizes = r.teams.map(tm => tm.length), min = Math.floor(size / n), extra = size % n;
    const capsOk = sizes.filter(x => x === min + 1).length === extra && sizes.filter(x => x === min).length === n - extra;
    const sumsOk = r.teams.every((tm, i) => Math.abs(tm.reduce((s, p) => s + (e.api.starsOf(p) || 3), 0) - r.sums[i]) < 1e-9);
    if (placed === league.map(p => p.id).sort().join() && capsOk && sumsOk) okAll++; else if (!worst) worst = { t, sizes, size, n, placed, sums: r.sums };
  }
  check(`com notas fracionadas: todo mundo é sorteado UMA vez, os times ficam com tamanho de no máximo 1 de diferença e as somas batem com as médias (${okAll} de ${tr2} ligas)`, okAll === tr2, worst);

  let better = 0, tr3 = 0;
  for (let t = 0; t < 300; t++) {
    const size = 8 + Math.floor(rnd() * 16), n = 2 + Math.floor(rnd() * 3);
    const league = randLeague(size, { fractional: true, goalies: false });
    const e = makeEnv({ players: league });
    const rb = withSeed(9000 + t, () => e.api.balancedDraw(league.map(p => ({ ...p })), n));
    const rr = withSeed(9000 + t, () => e.api.randomDraw(league.map(p => ({ ...p })), n));
    tr3++;
    if (rangeOf(rb) <= rangeOf(rr) + 1e-9) better++;
  }
  check(`o equilibrado usa as casas decimais de verdade: em ${better} de ${tr3} ligas ele deixa os times mais parecidos (diferença das médias) do que o aleatório`, better / tr3 >= 0.97, { better, tr3 });
  const par = (vals, n) => { const league = vals.map((v, i) => ({ id: 'q' + i, name: 'Q' + i, stars: 3, starsVotes: 9, starsAvg: v })); const e = makeEnv({ players: league }); return e.api.balancedDraw(league, n); };
  let r = par([3.6, 3.4, 3.5, 3.5], 2);
  check('3,6 + 3,4 contra 3,5 + 3,5: as duas somas dão 7 (arredondar para inteiros jogaria isso fora)', Math.abs(r.sums[0] - 7) < 1e-9 && Math.abs(r.sums[1] - 7) < 1e-9, r.sums);
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map(sd => withSeed(sd, () => par([4.4, 4.4, 1.2, 1.2, 3.0, 3.0], 2)));
  check('4,4 + 1,2 + 3 contra 4,4 + 1,2 + 3: 8,6 e 8,6 em todas as 8 sementes (a troca de jogadores acerta com decimais, sem ficar rodando para sempre)', seeds.every(x => x.sums.every(s => Math.abs(s - 8.6) < 1e-9)), seeds.map(x => x.sums));
  r = par([5, 5, 5, 5, 1, 1, 1, 1], 4);
  check('4 times, 8 jogadores (5 e 1): cada time com um 5 e um 1 (soma 6)', r.sums.every(s => Math.abs(s - 6) < 1e-9) && r.teams.every(tm => tm.length === 2), r.sums);
  check('o equilibrado devolve as somas em ESTRELAS (e não em centésimos)', par([4.2, 3.1, 2.5, 4.9], 2).sums.every(s => s > 0 && s < 20));
  const ex = makeEnv({ players: PLAYERS });
  const rg = withSeed(3, () => ex.api.balancedDraw([{ id: 'g1', name: 'G1', goleiro: true, stars: 4 }, { id: 'g2', name: 'G2', goleiro: true, stars: 2 }, ...PLAYERS.slice(0, 6).map(p => ({ ...p, goleiro: false }))], 2));
  check('goleiros continuam um por time quando há dois goleiros para dois times', rg.teams.every(tm => tm.filter(p => p.goleiro).length === 1), rg.teams.map(tm => tm.map(p => p.id)));
  check('avulsos (estrela 2, sem votos) entram no sorteio com o peso 2', makeEnv().api.drawWeight({ name: 'Zé', stars: 2, id: '_extra_Zé' }) === 200);
  const rr2 = withSeed(11, () => makeEnv({ players: PLAYERS }).api.randomDraw(PLAYERS.slice(0, 6).map(p => ({ ...p })), 2));
  check('o sorteio aleatório também devolve somas em estrelas', rr2.sums.every((s, i) => Math.abs(rr2.teams[i].reduce((a, p) => a + (p.stars || 3), 0) - s) < 1e-9));

  // ══ 3. O ELENCO ══════════════════════════════════════════════════════════════════════════════════
  const LEAGUE = [
    { id: 'ana', name: 'Ana', stars: 3, starsAvg: 4.43, starsVotes: 9 },           // a média vale (9 de 4 necessários... com 8 jogam)
    { id: 'bia', name: 'Bia', stars: 4, starsVotes: 2 },                           // faltam votos
    { id: 'caio', name: 'Caio', stars: 5, starsPinned: true, starsAvg: 2.1, starsVotes: 9, goleiro: true }, // fixada
    { id: 'dani', name: 'Dani', stars: 2 },
    { id: 'edu', name: 'Edu', stars: 3 }, { id: 'hugo', name: 'Hugo', stars: 3 }, { id: 'iara', name: 'Iara', stars: 3 }, { id: 'joao', name: 'João', stars: 3 },
  ];
  const ELROW = '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--border2);opacity:';
  const rows = h => h.split(ELROW).slice(1);
  const adm = makeEnv({ players: LEAGUE, admin: true, me: 'ana' });
  const hA = adm.api.vPlayers();
  const rA = rows(hA);
  check('Elenco do admin (opção ligada): uma linha por jogador e as tags <div> equilibradas', rA.length === 8 && abre(hA) === fecha(hA), [rA.length, abre(hA), fecha(hA)]);
  check('Elenco: a média que vale aparece como frase miúda embaixo do nome ("média do grupo 4,4 · 9 votos") e acende 4 estrelas (4,43 arredonda para 4)', /média do grupo 4,4 · 9 votos/.test(rA[0]) && (rA[0].match(/class="star-btn"[^>]*color:var\(--gold\)/g) || []).length === 4, rA[0].slice(0, 700));
  check('Elenco: votos que faltam ("2 votos de 4 para a média do grupo valer") com a estrela do admin acesa (4)', /2 votos de 4 para a média do grupo valer/.test(rA[1]) && (rA[1].match(/class="star-btn"[^>]*color:var\(--gold\)/g) || []).length === 4);
  check('Elenco: estrela fixada mostra "📌 estrela fixada pelo admin" e acende as 5 do admin, mesmo com a média 2,1 pronta', /📌 estrela fixada pelo admin/.test(rA[2]) && (rA[2].match(/class="star-btn"[^>]*color:var\(--gold\)/g) || []).length === 5);
  const CAPTION = '<div style="font-size:10px;color:var(--text3);margin-top:1px">';
  check('Elenco: jogador sem voto não ganha frase miúda (o tooltip do 📌 não conta, só o texto embaixo do nome)', !rA[3].includes(CAPTION) && rA[2].includes(CAPTION), rA[3].slice(0, 400));
  check('Elenco do admin: botão 📌 em todas as linhas; o da fixada vem destacado e desfaz (toggleStarsPinned … true), os outros fixam (… false)', rA.every(x => /toggleStarsPinned\('/.test(x)) && /toggleStarsPinned\('caio',true\)/.test(rA[2]) && /toggleStarsPinned\('ana',false\)/.test(rA[0]) && /border:1px solid var\(--gold\)/.test(rA[2].slice(rA[2].indexOf('toggleStarsPinned'))) && /📌<\/button>/.test(rA[0]));
  check('Elenco do admin: o 📌 fica ANTES do Ativo (dentro do grupo de controles) e as 5 estrelas antes dele', (l => l.indexOf('class="star-btn"') < l.indexOf('toggleStarsPinned') && l.indexOf('toggleStarsPinned') < l.indexOf('togglePlayerActive'))(rA[0]));
  check('Elenco do admin: com a média valendo, tocar numa estrela chama setPlayerStars com aquele número (1 a 5) — nunca com 0, porque não há "zerar" (o 📌 desfaz)', [1, 2, 3, 4, 5].every(k => rA[0].includes(`setPlayerStars('ana',${k})`)) && !/setPlayerStars\('ana',0\)/.test(rA[0]));
  check('Elenco do admin: sem a média valendo, tocar na estrela acesa tira a nota (volta 0) como sempre: Bia tem 4 → a 4ª estrela manda 0', /setPlayerStars\('bia',0\)/.test(rA[1]) && /setPlayerStars\('bia',3\)/.test(rA[1]) && /setPlayerStars\('bia',5\)/.test(rA[1]));
  check('Elenco do admin: o aviso "A estrela de cada jogador vem da média das notas do grupo" aparece, sem botão de avaliar se a conta não tem jogador ligado', /média das notas do grupo/.test(hA) && /anônimas: só a média aparece/.test(hA));
  check('Elenco do admin que é jogador (conta ligada à Ana): tem o botão "Avaliar o elenco" (openRateStars)', /onclick="openRateStars\(\)"[^>]*>Avaliar o elenco</.test(hA));
  const hJ = makeEnv({ players: LEAGUE, admin: false, me: 'bia' }).api.vPlayers();
  check('Elenco do jogador comum: vê a frase miúda e o botão "Avaliar o elenco", mas nenhum botão de admin (📌, Ativo, 🧤…) e as 5 estrelas são só desenho', /Avaliar o elenco/.test(hJ) && /média do grupo 4,4 · 9 votos/.test(hJ) && !/toggleStarsPinned|togglePlayerActive|setPlayerStars/.test(hJ) && rows(hJ).every(x => (x.match(/★/g) || []).length === 5) && abre(hJ) === fecha(hJ));
  check('quem está "vendo como" outro jogador (simulação do admin) NÃO tem o botão de avaliar', !/openRateStars/.test(makeEnv({ players: LEAGUE, admin: true, me: 'ana', sim: 'bia' }).api.vPlayers()));
  check('conta sem jogador ligado: sem botão de avaliar, mas com o aviso', (() => { const e = makeEnv({ players: LEAGUE, admin: false, me: 'ninguem' }); const h = e.api.vPlayers(); return !/openRateStars/.test(h) && /média das notas do grupo/.test(h); })());
  const hOff = makeEnv({ players: LEAGUE, admin: true, appCfg: {} }).api.vPlayers();
  check('opção DESLIGADA: o Elenco é o de sempre — sem aviso, sem frase miúda, sem 📌, sem botão de avaliar, e as estrelas são as do admin', !/média das notas|média do grupo|toggleStarsPinned|openRateStars|📌/.test(hOff) && /setPlayerStars\('ana',0\)/.test(rows(hOff)[0]) && (rows(hOff)[0].match(/class="star-btn"[^>]*color:var\(--gold\)/g) || []).length === 3);
  check('Elenco: nome com marcação vai escapado (também na frase miúda)', (() => { const h = makeEnv({ players: [{ id: 'z', name: '<img src=x onerror=alert(1)>', stars: 2 }], admin: false }).api.vPlayers(); return !h.includes('<img src=x') && h.includes('&lt;img src=x'); })());

  // renderStars sozinha
  const rs = (p, o) => makeEnv(o).api.renderStars(p);
  check('renderStars (admin): 5 botões; (jogador) 5 desenhos sem botão', (rs({ id: 'a', stars: 2 }, { admin: true }).match(/class="star-btn"/g) || []).length === 5 && !/<button/.test(rs({ id: 'a', stars: 2 }, { admin: false })) && (rs({ id: 'a', stars: 2 }, { admin: false }).match(/★/g) || []).length === 5);
  check('renderStars: estrela 0 não acende nada; média 4,6 acende 5; média 1,4 acende 1', !/var\(--gold\)/.test(rs({ id: 'a', stars: 0 }, { appCfg: {} })) && (rs({ id: 'a', starsAvg: 4.6, starsVotes: 9 }, { admin: false }).match(/var\(--gold\)/g) || []).length === 5 && (rs({ id: 'a', starsAvg: 1.4, starsVotes: 9 }, { admin: false }).match(/var\(--gold\)/g) || []).length === 1);

  // ══ 4. O CARTÃO DO SORTEIO ═══════════════════════════════════════════════════════════════════════
  const dc = makeEnv({ players: LEAGUE, admin: true });
  dc.st.drawResult = { teams: [[dc.st.players[0], dc.st.players[1], dc.st.players[3]], [dc.st.players[2], dc.st.players[4], dc.st.players[5]]], sums: [9.43, 10.6] };
  const hD = dc.api.renderDrawCard();
  check('cartão do sorteio: a soma do time aparece com uma casa e vírgula ("9,4★" e "10,6★"), nunca "9.43"', /9,4★/.test(hD) && /10,6★/.test(hD) && !/9\.43|10\.6/.test(hD), hD.match(/\d+[.,]\d+★/g));
  check('cartão do sorteio: cada jogador mostra a estrela que vale (Ana ★★★★ 4,4 pela média; Bia ★★★★ do admin; Caio ★★★★★ fixada)', /Ana[\s\S]{0,260}★★★★ 4,4/.test(hD) && /Bia[\s\S]{0,260}★★★★(?! \d)/.test(hD) && /Caio[\s\S]{0,300}★★★★★(?! \d)/.test(hD));
  check('lista de presentes do sorteio: as mesmas estrelas (média 4,4 com o número)', /Ana[\s\S]{0,260}★★★★ 4,4/.test(hD.slice(0, hD.indexOf('Resultado do Sorteio'))) || /★★★★ 4,4/.test(hD));
  check('cartão do sorteio sem a opção: estrelas inteiras como sempre, soma "9★"', (() => { const e = makeEnv({ players: LEAGUE, appCfg: {} }); e.st.drawResult = { teams: [[e.st.players[0]], [e.st.players[1]]], sums: [3, 4] }; const h = e.api.renderDrawCard(); return /3★/.test(h) && /4★/.test(h) && !/\d,\d/.test(h.slice(h.indexOf('Resultado do Sorteio'))); })());

  // ══ 5. FIXAR A ESTRELA (admin) ═══════════════════════════════════════════════════════════════════
  let e = makeEnv({ players: LEAGUE });
  await e.api.setPlayerStars('bia', 2);
  check('sem a média valendo (Bia, faltam votos): setPlayerStars grava só a estrela do admin, sem pergunta', JSON.stringify(e.calls.updates) === '[["player_registry/bia",{"stars":2}]]' && e.calls.confirms.length === 0, e.calls.updates);
  e = makeEnv({ players: LEAGUE });
  await e.api.setPlayerStars('ana', 5);
  check('com a média valendo (Ana, 4,4): pergunta antes e, se o admin aceita, grava a estrela JUNTO com a fixação', e.calls.confirms.length === 1 && /Fixar a estrela de Ana em 5/.test(e.calls.confirms[0]) && /4,4/.test(e.calls.confirms[0]) && JSON.stringify(e.calls.updates) === '[["player_registry/ana",{"stars":5,"starsPinned":true}]]', [e.calls.confirms, e.calls.updates]);
  e = makeEnv({ players: LEAGUE, confirmAnswer: false });
  await e.api.setPlayerStars('ana', 5);
  check('…se o admin recusa na pergunta, NADA é gravado', e.calls.updates.length === 0 && e.calls.confirms.length === 1);
  e = makeEnv({ players: LEAGUE });
  await e.api.setPlayerStars('ana', 0);
  check('com a média valendo, "zerar" a estrela não faz nada (nem pergunta)', e.calls.updates.length === 0 && e.calls.confirms.length === 0);
  e = makeEnv({ players: LEAGUE });
  await e.api.setPlayerStars('caio', 3);
  check('estrela já fixada: só troca o número, sem perguntar', JSON.stringify(e.calls.updates) === '[["player_registry/caio",{"stars":3}]]' && e.calls.confirms.length === 0);
  e = makeEnv({ players: LEAGUE, appCfg: {} });
  await e.api.setPlayerStars('ana', 4);
  check('opção desligada: só a estrela do admin, sem pergunta nem fixação (mesmo com média no cadastro)', JSON.stringify(e.calls.updates) === '[["player_registry/ana",{"stars":4}]]' && e.calls.confirms.length === 0);
  e = makeEnv({ players: LEAGUE, admin: false });
  await e.api.setPlayerStars('bia', 2);
  check('quem não é admin não grava estrela (e é avisado)', e.calls.updates.length === 0 && e.calls.toasts.length === 1 && /administradores/.test(e.calls.toasts[0][0]));
  e = makeEnv({ players: LEAGUE });
  await e.api.toggleStarsPinned('ana', false);
  await e.api.toggleStarsPinned('caio', true);
  check('📌: fixar grava starsPinned:true e desfazer grava starsPinned:false (a estrela do admin não muda)', JSON.stringify(e.calls.updates) === '[["player_registry/ana",{"starsPinned":true}],["player_registry/caio",{"starsPinned":false}]]', e.calls.updates);
  e = makeEnv({ players: LEAGUE, admin: false });
  await e.api.toggleStarsPinned('ana', false);
  check('📌: quem não é admin não fixa', e.calls.updates.length === 0 && e.calls.toasts.length === 1);

  // ══ 6. AVISAR O SERVIDOR QUANDO O ELENCO MUDA ════════════════════════════════════════════════════
  e = makeEnv({ players: LEAGUE });
  e.api.starSync(); e.api.starSync({ from: 'a', to: 'b' });
  check('starSync (opção ligada): chama syncStarVotes com a liga e, se vier, a troca de chave', JSON.stringify(e.calls.fn) === '[["syncStarVotes",{"liga":"liga1"}],["syncStarVotes",{"liga":"liga1","rename":{"from":"a","to":"b"}}]]', e.calls.fn);
  e = makeEnv({ players: LEAGUE, appCfg: {} });
  e.api.starSync();
  check('starSync (opção desligada, mas ainda há votos no cadastro): chama, porque as notas guardadas precisam seguir o elenco', e.calls.fn.length === 1);
  e = makeEnv({ players: PLAYERS, appCfg: {} });
  e.api.starSync({ from: 'a', to: 'b' });
  check('starSync (opção desligada e nenhum voto na liga — quase todas): NÃO chama o servidor', e.calls.fn.length === 0);
  e = makeEnv({ players: LEAGUE, callFails: 'sem rede' });
  let threw = false; try { e.api.starSync(); await new Promise(r => setTimeout(r, 5)); } catch (_) { threw = true; }
  check('starSync com o servidor fora do ar: nunca estoura nem atrapalha quem chamou', !threw);
  e = makeEnv({ players: LEAGUE });
  await e.api.deleteRegisteredPlayer('bia');
  check('remover jogador do elenco: apaga o cadastro, tira o contato e avisa o servidor (as notas dele deixam de valer)', e.calls.deletes.join() === 'player_registry/bia' && JSON.stringify(e.calls.contacts) === '[["bia",""]]' && JSON.stringify(e.calls.fn) === '[["syncStarVotes",{"liga":"liga1"}]]', [e.calls.deletes, e.calls.fn]);
  e = makeEnv({ players: PLAYERS.map(p => (p.id === 'bia' ? { ...p, stars: 4, goleiro: true, somenteChurrasco: true, starsPinned: true, added: '2026-01-01' } : p)), appCfg: {} });
  e.st.modal = { type: 'renamePlayer', id: 'bia', name: 'Bia', newName: 'Bianca', whatsapp: '' };
  await e.api.renamePlayer();
  const novo = e.calls.sets.find(([p]) => p === 'player_registry/bianca');
  check('renomear (chave nova): o cadastro novo leva a estrela, a fixação, o goleiro e o "só churrasco" (antes o goleiro virava jogador de linha)', novo && novo[1].name === 'Bianca' && novo[1].stars === 4 && novo[1].starsPinned === true && novo[1].goleiro === true && novo[1].somenteChurrasco === true && novo[1].added === '2026-01-01' && novo[1].active === true, novo);
  check('renomear (chave nova): apaga o cadastro antigo e manda o servidor levar as notas (from bia → to bianca) — mesmo com a opção desligada, porque há votos guardados', e.calls.deletes.includes('player_registry/bia') && JSON.stringify(e.calls.fn) === '[]' || JSON.stringify(e.calls.fn) === '[["syncStarVotes",{"liga":"liga1","rename":{"from":"bia","to":"bianca"}}]]', e.calls.fn);
  e = makeEnv({ players: LEAGUE.map(p => (p.id === 'bia' ? { ...p, goleiro: false } : p)) });
  e.st.modal = { type: 'renamePlayer', id: 'bia', name: 'Bia', newName: 'Bianca', whatsapp: '' };
  await e.api.renamePlayer();
  check('renomear com a opção ligada: o servidor recebe a troca de chave', JSON.stringify(e.calls.fn) === '[["syncStarVotes",{"liga":"liga1","rename":{"from":"bia","to":"bianca"}}]]', e.calls.fn);
  e = makeEnv({ players: LEAGUE });
  e.st.modal = { type: 'renamePlayer', id: 'bia', name: 'Bia', newName: 'BIA', whatsapp: '' };
  await e.api.renamePlayer();
  check('renomear só a letra (mesma chave): não chama o servidor', e.calls.fn.length === 0 && e.calls.updates.some(([p, d]) => p === 'player_registry/bia' && d.name === 'BIA'), [e.calls.fn, e.calls.updates]);

  // ══ 7. AVALIAR O ELENCO ══════════════════════════════════════════════════════════════════════════
  e = makeEnv({ players: LEAGUE, me: 'ana' });
  const alvos = e.api.ratingTargets().map(p => p.id);
  check('quem eu avalio: os outros jogadores que jogam, sem mim, em ordem alfabética do português', alvos.join() === 'bia,caio,dani,edu,hugo,iara,joao', alvos);
  check('…inativos e "só churrasco" ficam de fora (Fábio e Gil)', !makeEnv({ me: 'ana' }).api.ratingTargets().some(p => ['fabio', 'gil'].includes(p.id)) && makeEnv({ me: 'ana' }).api.ratingTargets().length === 7);
  check('…na simulação do admin ("Ver como" outro jogador) ou sem jogador ligado a lista é vazia', makeEnv({ me: 'ana', sim: 'bia' }).api.ratingTargets().length === 0 && makeEnv({ me: 'ninguem' }).api.ratingTargets().length === 0);
  const legacy = makeEnv({ players: [{ id: 'x1', name: 'Ana' }, { id: 'x2', name: 'Bia' }, { id: 'x3', name: 'Caio' }], me: 'ana' });
  check('cadastro antigo (id diferente do nome): quem eu avalio continua sem mim (a conta é pelo nome do jogador ligado)', legacy.api.ratingTargets().map(p => p.id).join() === 'x2,x3', legacy.api.ratingTargets());
  const unsorted = makeEnv({ players: [{ id: 'z', name: 'Zé' }, { id: 'ana', name: 'Ana' }, { id: 'al', name: 'Álvaro' }, { id: 'bia', name: 'Bia' }], me: 'bia' });
  check('quem eu avalio: em ordem alfabética do português ("Álvaro" antes de "Ana", "Zé" por último), seja qual for a ordem do cadastro', unsorted.api.ratingTargets().map(p => p.id).join() === 'al,ana,z', unsorted.api.ratingTargets().map(p => p.id));
  e = makeEnv({ players: LEAGUE, me: 'ana', saved: { voterKey: 'ana', ratings: { bia: 4, caio: 2, fantasma: 5, dani: 9, edu: '3', hugo: 0, iara: 5 } } });
  await e.api.openRateStars();
  const m = e.st.modal;
  check('abrir: lê as notas que a pessoa já deu (no documento do próprio uid), ignora as que não valem (jogador que saiu, 9, "3", 0) e deixa tudo pronto para editar', e.calls.reads.join() === 'leagues/liga1/star_votes/u1' && m.type === 'rateStars' && m.loading === false && m.busy === false && JSON.stringify(m.saved) === '{"bia":4,"caio":2,"iara":5}' && JSON.stringify(m.draft) === JSON.stringify(m.saved) && m.draft !== m.saved && m.rows.length === 7, m);
  check('…as linhas levam id, nome e goleiro', m.rows[1].id === 'caio' && m.rows[1].name === 'Caio' && m.rows[1].goleiro === true && m.rows[0].goleiro === false);
  e = makeEnv({ players: LEAGUE, me: 'ana', readFails: true });
  await e.api.openRateStars();
  check('se a leitura das notas antigas falhar, a janela abre mesmo assim, vazia (a pessoa ainda pode avaliar)', e.st.modal && e.st.modal.type === 'rateStars' && e.st.modal.loading === false && JSON.stringify(e.st.modal.saved) === '{}');
  e = makeEnv({ players: LEAGUE, me: 'ana', appCfg: {} });
  await e.api.openRateStars();
  check('opção desligada: não abre ("Avaliação indisponível.")', e.st.modal === null && e.calls.toasts.length === 1 && /indisponível/.test(e.calls.toasts[0][0]) && e.calls.reads.length === 0);
  e = makeEnv({ players: LEAGUE, me: 'ninguem' });
  await e.api.openRateStars();
  check('sem jogador ligado à conta: não abre', e.st.modal === null && e.calls.toasts.length === 1);
  e = makeEnv({ players: LEAGUE, me: 'ana' });
  const openP = e.api.openRateStars();
  check('enquanto lê as notas a janela já aparece "carregando"', e.st.modal && e.st.modal.loading === true && /spinner/.test(e.api.mRateStars()));
  e.env.st.modal = null; // a pessoa fechou antes de terminar
  await openP;
  check('…se a pessoa fechar a janela antes de terminar de ler, nada reabre', e.st.modal === null);

  e = makeEnv({ players: LEAGUE, me: 'ana', saved: { voterKey: 'ana', ratings: { bia: 4 } } });
  await e.api.openRateStars();
  e.api.rateStarSet(1, 3); // caio
  e.api.rateStarSet(0, 4); // bia: tocar na mesma estrela tira a nota
  e.api.rateStarSet(2, 5); e.api.rateStarSet(2, 1); // dani: troca de 5 para 1
  check('tocar numa estrela dá a nota; tocar de novo na mesma tira; tocar em outra troca', JSON.stringify(e.st.modal.draft) === '{"caio":3,"dani":1}' && JSON.stringify(e.st.modal.saved) === '{"bia":4}', e.st.modal.draft);
  check('cada toque redesenha a janela mantendo a rolagem da lista', e.calls.scroll.length === 4 && e.calls.scroll.every(v => v === 7));
  e.api.rateStarSet(99, 3); e.api.rateStarSet(0, 4);
  check('linha que não existe é ignorada', JSON.stringify(Object.keys(e.st.modal.draft)) === '["caio","dani","bia"]' || e.st.modal.draft.bia === 4);
  e = makeEnv({ players: LEAGUE, me: 'ana' });
  const slow = e.api.openRateStars();
  e.api.rateStarSet(0, 5);
  const duranteCarga = JSON.stringify(e.st.modal.draft);
  await slow;
  check('não dá para dar nota enquanto a janela ainda está carregando (nem sobra nota guardada depois)', duranteCarga === '{}' && JSON.stringify(e.st.modal.draft) === '{}', duranteCarga);

  e = makeEnv({ players: LEAGUE, me: 'ana', saved: { voterKey: 'ana', ratings: { bia: 4, caio: 2 } } });
  await e.api.openRateStars();
  await e.api.submitRateStars();
  check('salvar sem mudar nada: não chama o servidor ("Nenhuma nota mudou.")', e.calls.fn.length === 0 && e.calls.toasts.length === 1 && /Nenhuma nota mudou/.test(e.calls.toasts[0][0]) && e.st.modal !== null);
  e.api.rateStarSet(0, 4);   // tira a nota da Bia
  e.api.rateStarSet(1, 5);   // Caio de 2 para 5
  e.api.rateStarSet(2, 3);   // Dani, nova
  await e.api.submitRateStars();
  check('salvar: manda SÓ o que mudou — nota nova e trocada com o número, nota tirada com null — e a liga', JSON.stringify(e.calls.fn) === '[["ratePlayers",{"liga":"liga1","ratings":{"bia":null,"caio":5,"dani":3}}]]', e.calls.fn);
  check('…e enquanto o servidor responde a janela está marcada como ocupada (o botão fica travado)', e.calls.busyAtCall.join() === 'true', e.calls.busyAtCall);
  check('…depois de salvar fecha a janela e avisa que ficou anônimo', e.st.modal === null && e.calls.toasts.some(([t, k]) => /Avaliações salvas/.test(t) && /anônim|só a média/i.test(t) && k === 'ok'), e.calls.toasts);
  e = makeEnv({ players: LEAGUE, me: 'ana', callFails: 'Muitas tentativas em pouco tempo.' });
  await e.api.openRateStars();
  e.api.rateStarSet(0, 5);
  await e.api.submitRateStars();
  check('se o servidor recusar, a janela CONTINUA aberta com as notas que a pessoa escolheu, destrava o botão e mostra o motivo', e.st.modal && e.st.modal.type === 'rateStars' && e.st.modal.busy === false && e.st.modal.draft.bia === 5 && e.calls.toasts.some(([t]) => /Muitas tentativas/.test(t)), [e.st.modal && e.st.modal.busy, e.calls.toasts]);
  e = makeEnv({ players: LEAGUE, me: 'ana' });
  await e.api.openRateStars();
  e.api.rateStarSet(0, 5);
  e.st.modal.busy = true;
  await e.api.submitRateStars();
  check('toque duplo em Salvar (já salvando): não manda duas vezes', e.calls.fn.length === 0);

  const win = (extra = {}) => { const x = makeEnv({ players: LEAGUE, me: 'ana', ...extra }); return x; };
  e = win({ saved: { voterKey: 'ana', ratings: { bia: 4, caio: 2 } } });
  await e.api.openRateStars();
  let hM = e.api.mRateStars();
  check('a janela: título, a frase "As notas são anônimas", uma linha por jogador com 5 estrelas e o placar "Você avaliou 2 de 7"', /Avaliar o elenco/.test(hM) && /As notas são anônimas/.test(hM) && (hM.match(/rateStarSet\(/g) || []).length === 7 * 5 && /Você avaliou 2 de 7\./.test(hM), plain(hM).slice(0, 400));
  check('…as estrelas acesas seguem as notas (Bia 4 acesas, Caio 2) e cada botão tem nome acessível ("3 estrelas para Dani")', (hM.match(/rateStarSet\(0,[1-5]\)[^>]*style="[^"]*color:var\(--gold\)/g) || []).length === 4 && (hM.match(/rateStarSet\(1,[1-5]\)[^>]*style="[^"]*color:var\(--gold\)/g) || []).length === 2 && /aria-label="3 estrelas para Dani"/.test(hM) && /aria-label="1 estrela para Bia"/.test(hM));
  check('…"Salvar avaliações" começa DESATIVADO (nada mudou) e ativa quando muda; o goleiro leva o 🧤; a lista rola (overflow-y:auto como filha direta da janela)', /disabled[^>]*>Salvar avaliações/.test(hM) && (e.api.rateStarSet(2, 3), !/disabled[^>]*>Salvar avaliações/.test(e.api.mRateStars())) && /Caio[\s\S]{0,80}🧤/.test(hM) && /<div class="sheet"[^>]*>[\s\S]*<div style="overflow-y:auto;flex:1">/.test(hM));
  check('…o placar acompanha o que a pessoa marcou AGORA (2 salvas + Dani = "Você avaliou 3 de 7")', /Você avaliou 3 de 7\./.test(e.api.mRateStars()), plain(e.api.mRateStars()).slice(-120));
  check('…as tags <div> abrem e fecham na mesma quantidade', abre(hM) === fecha(hM));
  e = win();
  await e.api.openRateStars();
  e.api.rateStarSet(0, 4); // há mudança para salvar: só o "salvando" pode desativar o botão
  check('…com mudança para salvar o botão está ativo', !/disabled[^>]*>Salvar avaliações/.test(e.api.mRateStars()));
  e.st.modal.busy = true;
  check('…enquanto salva o botão diz "Salvando…" e fica desativado, mesmo havendo mudança', /disabled[^>]*>Salvando…/.test(e.api.mRateStars()));
  e = win({ players: [{ id: 'ana', name: 'Ana' }, { id: 'z', name: '<img src=x onerror=alert(1)>' }] });
  await e.api.openRateStars();
  const hX = e.api.mRateStars();
  check('nome com marcação vai escapado na janela (texto e nome acessível)', !hX.includes('<img src=x') && hX.includes('&lt;img src=x'));
  e = win({ players: [{ id: 'ana', name: 'Ana' }] });
  await e.api.openRateStars();
  check('sem outros jogadores: a janela explica ("Ainda não há outros jogadores…") e o botão fica desativado', /Ainda não há outros jogadores/.test(e.api.mRateStars()) && /disabled[^>]*>Salvar avaliações/.test(e.api.mRateStars()));
  check('janela de outro tipo ou sem janela: não desenha nada', win().api.mRateStars() === '' && (() => { const x = win(); x.st.modal = { type: 'vote' }; return x.api.mRateStars() === ''; })());

  // ══ 8. PAINEL ADMIN, REGISTRO DAS CONFIGURAÇÕES, PRIVACIDADE, MANUAL E CI ═════════════════════════════
  check('a configuração da liga lê peerStars do banco como verdadeiro/falso (começa desligada)', /peerStars:\s+!!data\.peerStars,/.test(html));
  check('Painel Admin: bloco "⭐ Estrelas pela média do grupo" com Ligada/Desligada (saveAppCfg peerStars true/false), antes da votação de destaques, explicando anonimato, o mínimo e o 📌', (() => {
    const a = html.indexOf('⭐ Estrelas pela média do grupo</div>'), b = html.indexOf('🗳️ Votação de destaques</div>');
    const blk = html.slice(a, b);
    return a > 0 && b > a && /saveAppCfg\(\{peerStars:true\}\)[\s\S]*saveAppCfg\(\{peerStars:false\}\)/.test(blk) && /anônimas/.test(blk) && /metade do elenco que joga/.test(blk) && /no mínimo 3/.test(blk) && /📌/.test(blk) && /tog\(!!cfg\.peerStars\)/.test(blk) && /tog\(!cfg\.peerStars\)/.test(blk);
  })());
  check('a janela de avaliar está registrada junto das outras janelas (mRateStars())', /mRival\(\)\+mVote\(\)\+mRateStars\(\)\+mSubscription\(\)/.test(html));
  const priv = html.slice(html.indexOf('🔒 Privacidade</div>'), html.indexOf('🔒 Privacidade</div>') + 14000);
  check('política de privacidade (o que é guardado): notas de estrelas anônimas, só ligadas pelo admin, só a pessoa as vê, e SOMEM se ela sair, for removida ou excluir a conta', /Notas de estrelas<\/strong> \(só se o admin ligar/.test(priv) && /só você as vê/.test(priv) && /sair da liga, for removido dela ou excluir a conta, as notas que você deu são apagadas e a média dos outros é refeita/.test(priv));
  check('política de privacidade (quem vê o quê): ninguém, nem o admin, vê quem deu qual nota; a média com a contagem aparece aos membros a partir de 3 votos', /ninguém \(nem o admin da liga\) vê quem deu qual nota/.test(priv) && /a partir de 3 votos/.test(priv));
  check('as funções do servidor existem e são chamadas pelo app: ratePlayers e syncStarVotes', /exports\.ratePlayers = onCall/.test(fnsSrc) && /exports\.syncStarVotes = onCall/.test(fnsSrc) && /callFn\('ratePlayers'/.test(html) && /callFn\('syncStarVotes'/.test(html));
  check('regras do Firestore: star_votes só lê a dona (uid), ninguém grava; o cadastro não aceita starsAvg/starsVotes vindos do app', /match \/leagues\/\{leagueId\}\/star_votes\/\{uid\}[\s\S]{0,700}request\.auth\.uid == uid[\s\S]{0,60}allow write: if false;/.test(rules) && /function keepsStarsAvgOut\(\)/.test(rules) && /keepsWhatsappOut\(\) && keepsStarsAvgOut\(\)/.test(rules));
  const sec = manual.slice(manual.indexOf('id="estrelas-do-grupo"'), manual.indexOf('id="estrelas-do-grupo"') + 20000);
  const plainSec = x => x.replace(/<\/(?:td|th|tr|p|li|div|h3|h2|ul|table)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const psec = plainSec(sec.slice(0, sec.indexOf('</section>')));
  check('manual: subseção "⭐ Estrelas pela média do grupo" (id estrelas-do-grupo) dentro do Painel Admin', manual.indexOf('id="estrelas-do-grupo"') > manual.indexOf('id="admin"') && manual.indexOf('id="estrelas-do-grupo"') < manual.indexOf('id="resumo"') && /⭐ Estrelas pela média do grupo/.test(sec));
  check('manual: diz que a opção vem DESLIGADA e que desligada nada muda, explica a tela "Avaliar o elenco" e a regra "metade do elenco que joga, no mínimo 3"', /vem desligada, e desligada nada muda/.test(psec) && /Avaliar o elenco/.test(psec) && /Salvar avaliações manda só o que mudou/.test(psec) && /metade do elenco que joga \(ativos, fora do "só churrasco"\), no mínimo 3/.test(psec) && /com 10 jogadores são 5 votos; com 20, são 10/.test(psec), psec.slice(0, 500));
  check('manual: explica o 📌 (fixar a estrela e o aviso ao tocar numa estrela), o que vale antes de ter votos (a estrela do admin) e o sorteio com a média exata', /Fixar a estrela de um jogador/.test(psec) && /o app pergunta se ele quer fixar aquele número/.test(psec) && /Ainda sem votos suficientes A estrela que o admin deu\./.test(psec) && /O admin fixou a estrela \(📌\) A estrela do admin, mesmo que já haja média/.test(psec) && /passa a usar a média exata das notas \(por exemplo 3,6\)/.test(psec), psec.slice(0, 900));
  check('manual: privacidade — notas anônimas (ninguém, nem o admin, vê quem deu qual nota), o que é guardado (star_votes, starsAvg, starsVotes), quem grava e o que apaga as notas (sair, ser removido, mudar de jogador, excluir a conta)', /As notas são anônimas: pelo app, ninguém \(nem o admin da liga\) vê quem deu qual nota/.test(psec) && /só é publicada a partir de 3 votos/.test(psec) && /star_votes/.test(psec) && /starsAvg \(2 casas, só a partir de 3 votos\) e starsVotes/.test(psec) && /a função ratePlayers/.test(psec) && /syncStarVotes \(só admin\)/.test(psec) && /sai da liga, é recusada ou removida pelo admin, é ligada a outro jogador ou exclui a conta \(seção 21\)/.test(psec), psec.slice(-1500));
  check('manual: o plano gratuito inclui as estrelas pela média (lista do que continua funcionando)', /Dar estrelas ao elenco/.test(manual.slice(manual.indexOf('O que continua funcionando no plano free'), manual.indexOf('O que continua funcionando no plano free') + 1600)));
  check('manual: a seção "Excluir a conta" cita as notas de estrelas que a pessoa deu', /notas de estrelas/i.test(manual.slice(manual.indexOf('id="excluir"'), manual.indexOf('id="anonimizar"'))));
  check('CI: o teste do app das estrelas roda (passo "Testes do app (estrelas pela média do grupo …)" executando test/client-stars-test.js e o das funções star-votes-test.js)', /name: Testes do app \(estrelas pela média do grupo[^\n]*\)\n\s+working-directory: functions\n\s+run: node test\/client-stars-test\.js/.test(ci) && /node test\/star-votes-test\.js/.test(ci));

  // ══ 8b. A CHAMADA DO ADMIN PARA O GRUPO AVALIAR ═════════════════════════════════════════════════════
  const AT = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // chamada de 3 horas atrás
  const CALLED = { peerStars: true, starsCallAt: AT, starsCallBy: 'admin-uid' };
  const pend = (o = {}) => { const x = makeEnv({ players: LEAGUE, me: 'ana', admin: false, appCfg: CALLED, ...o }); return { ...x, pending: x.api.starsCallPending() }; };
  check('convite: chamada recente, opção ligada, conta ligada a um jogador e quem chamou é outra pessoa → pendente', pend().pending === true);
  check('convite: com a opção desligada não aparece (mesmo com a chamada gravada)', pend({ appCfg: { ...CALLED, peerStars: false } }).pending === false);
  check('convite: sem chamada gravada não aparece', pend({ appCfg: { peerStars: true } }).pending === false);
  check('convite: data torta (texto, vazio) não aparece', ['ontem', '', 'NaN'].every(v => pend({ appCfg: { ...CALLED, starsCallAt: v } }).pending === false));
  check('convite: o banner dura 14 dias: com 14 dias e meio já não aparece, com 13 e meio ainda aparece', pend({ appCfg: { ...CALLED, starsCallAt: new Date(Date.now() - 14.5 * 86400000).toISOString() } }).pending === false && pend({ appCfg: { ...CALLED, starsCallAt: new Date(Date.now() - 13.5 * 86400000).toISOString() } }).pending === true);
  check('convite: quem chamou (o uid gravado é o da própria conta) não vê o banner', pend({ appCfg: { ...CALLED, starsCallBy: 'u1' } }).pending === false);
  check('convite: conta sem jogador ligado, ou na simulação do admin, não vê o banner', pend({ me: 'ninguem' }).pending === false && pend({ sim: 'bia' }).pending === false);
  const pe = pend();
  const hB = pe.api.renderStarsCallBanner();
  check('convite: o banner tem o título, a explicação do anonimato, "Avaliar agora" (abre a janela) e "Agora não"; tags equilibradas', /O admin pediu para você avaliar o elenco/.test(hB) && /anônimas/.test(hB) && /onclick="openRateStars\(\)"[^>]*>Avaliar agora</.test(hB) && /onclick="dismissStarsCall\(\)"[^>]*>Agora não</.test(hB) && abre(hB) === fecha(hB), hB.slice(0, 300));
  check('convite: sem chamada pendente o banner não desenha nada', pend({ appCfg: { peerStars: true } }).api.renderStarsCallBanner() === '');
  pe.api.dismissStarsCall();
  check('convite: "Agora não" guarda NESTE aparelho (a chave leva a liga e o jogador, o valor é o momento da chamada), redesenha a tela e o banner some', pe.ls.get('pnm_stars_call_liga1_ana') === AT && pe.calls.renders === 1 && pe.api.starsCallPending() === false && pe.api.renderStarsCallBanner() === '', [...pe.ls]);
  check('convite: uma chamada NOVA (outro momento) traz o banner de volta', (() => { pe.st.appCfg.starsCallAt = new Date().toISOString(); return pe.api.starsCallPending() === true; })());
  const lsBad = pend({ lsFails: true });
  check('convite: com o armazenamento do navegador bloqueado o banner ainda aparece e tocar em "Agora não" não quebra', lsBad.pending === true && (() => { try { lsBad.api.dismissStarsCall(); return true; } catch (_) { return false; } })());
  const saveOk = pend();
  await saveOk.api.openRateStars(); saveOk.api.rateStarSet(0, 4); await saveOk.api.submitRateStars();
  check('convite: depois de SALVAR as avaliações o banner some (a pessoa já fez o que o admin pediu)', saveOk.ls.get('pnm_stars_call_liga1_ana') === AT && saveOk.api.starsCallPending() === false, [...saveOk.ls]);
  const saveBad = pend({ callFails: 'Muitas tentativas' });
  await saveBad.api.openRateStars(); saveBad.api.rateStarSet(0, 4); await saveBad.api.submitRateStars();
  check('convite: se salvar falhar o banner continua (a pessoa ainda não avaliou)', saveBad.ls.size === 0 && saveBad.api.starsCallPending() === true);
  check('convite: a chave do aparelho leva a liga e o jogador (outro jogador no mesmo aparelho vê o banner)', (() => { const x = pend(); x.api.dismissStarsCall(); x.st.userDoc.playerKey = 'bia'; return x.api.starsCallKey() === 'pnm_stars_call_liga1_bia' && x.api.starsCallPending() === true; })());

  const adminCall = (o = {}) => makeEnv({ players: LEAGUE, admin: true, me: 'ana', ...o });
  let ac = adminCall();
  await ac.api.callStarRaters();
  check('chamar: o admin confirma (a pergunta explica o aviso e as 6 horas) e a função notifyStarRatings é chamada com a liga; enquanto chama a tela fica marcada e depois destrava', ac.calls.confirms.length === 1 && /Chamar o grupo para avaliar o elenco agora/.test(ac.calls.confirms[0]) && /6 horas/.test(ac.calls.confirms[0]) && JSON.stringify(ac.calls.fn) === '[["notifyStarRatings",{"liga":"liga1"}]]' && ac.calls.callingAtCall.join() === 'true' && ac.st._starsCalling === false && ac.calls.renders === 2, [ac.calls.confirms, ac.calls.fn, ac.calls.callingAtCall, ac.calls.renders]);
  for (const [res, text] of [
    [{ recipients: 6, withPush: 5 }, 'Aviso enviado no celular a 5 de 6 jogadores. O outro vê o convite ao abrir o app.'],
    [{ recipients: 8, withPush: 5 }, 'Aviso enviado no celular a 5 de 8 jogadores. Os outros 3 veem o convite ao abrir o app.'],
    [{ recipients: 4, withPush: 4 }, 'Aviso enviado no celular a 4 de 4 jogadores.'],
    [{ recipients: 1, withPush: 1 }, 'Aviso enviado no celular a 1 de 1 jogador.'],
    [{ recipients: 3, withPush: 0 }, 'Convite registrado para 3 jogadores: ninguém ativou as notificações, então todos o veem ao abrir o app.'],
    [{ recipients: 1, withPush: 0 }, 'Convite registrado para 1 jogador: ninguém ativou as notificações, então todos o veem ao abrir o app.'],
    [{ recipients: 0, withPush: 0 }, 'Convite registrado, mas ainda não há jogadores com a conta ligada ao elenco para avisar.'],
  ]) {
    const x = adminCall({ callResult: { ok: true, ...res } });
    await x.api.callStarRaters();
    check(`chamar: o resultado ${res.withPush} de ${res.recipients} vira a frase certa`, x.calls.toasts.length === 1 && x.calls.toasts[0][0] === text && x.calls.toasts[0][1] === 'ok', x.calls.toasts);
  }
  ac = adminCall({ confirmAnswer: false });
  await ac.api.callStarRaters();
  check('chamar: se o admin não confirmar, nada é enviado', ac.calls.fn.length === 0 && ac.calls.confirms.length === 1 && ac.st._starsCalling !== true);
  ac = adminCall({ noDB: true });
  await ac.api.callStarRaters();
  check('chamar: sem conexão com o banco (app ainda abrindo) nada acontece', ac.calls.fn.length === 0 && ac.calls.confirms.length === 0);
  ac = adminCall({ admin: false });
  await ac.api.callStarRaters();
  check('chamar: quem não é admin nem recebe a pergunta', ac.calls.fn.length === 0 && ac.calls.confirms.length === 0);
  ac = adminCall({ appCfg: {} });
  await ac.api.callStarRaters();
  check('chamar: com a opção desligada nada acontece', ac.calls.fn.length === 0 && ac.calls.confirms.length === 0);
  ac = adminCall();
  ac.st._starsCalling = true;
  await ac.api.callStarRaters();
  check('chamar: toque duplo enquanto já está chamando é ignorado', ac.calls.fn.length === 0 && ac.calls.confirms.length === 0);
  ac = adminCall({ callFails: 'O grupo já foi chamado há pouco. Dá para chamar de novo daqui a 6 h.' });
  await ac.api.callStarRaters();
  check('chamar: se o servidor recusar (já chamou há pouco), o admin lê o motivo e o botão destrava', ac.calls.toasts.length === 1 && ac.calls.toasts[0][0] === 'O grupo já foi chamado há pouco. Dá para chamar de novo daqui a 6 h.' && ac.calls.toasts[0][1] === undefined && ac.st._starsCalling === false, ac.calls.toasts);

  const hCall = adminCall().api.vPlayers();
  check('Elenco: o admin vê "📣 Chamar o grupo" (callStarRaters) junto do "Avaliar o elenco"; tags equilibradas', /onclick="callStarRaters\(\)"[^>]*>📣 Chamar o grupo</.test(hCall) && /Avaliar o elenco/.test(hCall) && abre(hCall) === fecha(hCall));
  check('Elenco: jogador comum não vê o botão de chamar', !/callStarRaters/.test(makeEnv({ players: LEAGUE, admin: false, me: 'bia' }).api.vPlayers()));
  check('Elenco: com a opção desligada nem o admin vê o botão de chamar', !/callStarRaters/.test(adminCall({ appCfg: {} }).api.vPlayers()));
  check('Elenco: enquanto chama o botão diz "Chamando…" e fica desativado', (() => { const x = adminCall(); x.st._starsCalling = true; return /disabled[^>]*>Chamando…/.test(x.api.vPlayers()); })());
  check('Elenco: o admin que não tem jogador ligado vê o botão de chamar e não o de avaliar', (() => { const h = adminCall({ me: 'ninguem' }).api.vPlayers(); return /callStarRaters/.test(h) && !/openRateStars/.test(h); })());
  check('o banner entra na aba EU logo depois dos avisos de votação', html.includes('${renderVoteBanners()}\n    ${renderStarsCallBanner()}'));
  check('a configuração da liga lê starsCallAt e starsCallBy do banco', /starsCallAt:\s+data\.starsCallAt\s+\|\| null,/.test(html) && /starsCallBy:\s+data\.starsCallBy\s+\|\| '',/.test(html));
  check('o texto do Painel Admin cita o botão de chamar e as 6 horas', (blk => /📣 Chamar o grupo/.test(blk) && /6 horas/.test(blk))(html.slice(html.indexOf('⭐ Estrelas pela média do grupo</div>'), html.indexOf('🗳️ Votação de destaques</div>'))));
  check('a função do servidor existe e o app a chama', /exports\.notifyStarRatings = onCall/.test(fnsSrc) && /callFn\('notifyStarRatings'/.test(html));
  check('manual: explica o botão "📣 Chamar o grupo", o aviso no celular, o banner "O admin pediu para você avaliar o elenco" (Avaliar agora / Agora não), quem não recebe, os 14 dias e as 6 horas entre chamadas', (() => {
    const i = manual.indexOf('id="estrelas-do-grupo"');
    const p = manual.slice(i, manual.indexOf('</section>', i)).replace(/<\/(?:td|th|tr|p|li|div|h3|h2|ul|table)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    return /botão 📣 Chamar o grupo no alto da aba Elenco/.test(p) && /quem ativou as notificações recebe um aviso no celular/.test(p) && /O admin pediu para você avaliar o elenco/.test(p) && /Avaliar agora \(abre a janela de avaliar\) e Agora não/.test(p) && /só dá para chamar de novo depois de 6 horas/.test(p) && /quem chamou não recebe o aviso nem o banner/.test(p) && /depois de 14 dias/.test(p);
  })());
  check('manual: a subseção "Chamar o grupo para avaliar" existe, dentro das estrelas pela média e antes de "Qual estrela vale"', (() => { const a = manual.indexOf('<h3>Chamar o grupo para avaliar</h3>'); return a > manual.indexOf('id="estrelas-do-grupo"') && a < manual.indexOf('<h3>Qual estrela vale</h3>'); })());
  check('manual: a nota técnica cita notifyStarRatings, starsCallAt e starsCallBy, o controle rate_limits e a etiqueta que evita empilhar', /A chamada para avaliar<\/strong> — a função <code>notifyStarRatings<\/code>/.test(manual) && /<code>starsCallAt<\/code> e <code>starsCallBy<\/code> em <code>app_config\/main<\/code>/.test(manual) && /controle <code>rate_limits<\/code>/.test(manual) && /repetir não empilha/.test(manual));
  check('manual: a tabela das notificações push tem a linha "⭐ Chamada para avaliar o elenco"', /⭐ Chamada para avaliar o elenco<\/td><td>Jogadores com a conta ligada a um jogador do elenco \(menos o admin que chamou\)/.test(manual.slice(manual.indexOf('id="admin"'), manual.indexOf('id="clima"'))));

  // ══ 9. NENHUM OUTRO LUGAR LÊ A ESTRELA BRUTA DO ADMIN ═══════════════════════════════════════════════
  const rawLines = html.split('\n').filter(l => /\.stars\b|\bstars:/.test(l)).map(l => l.trim());
  const expectedRaw = ['if (old.stars != null) regData.stars = old.stars;', 'vale só a estrela que o admin deu (p.stars)', 'const admin = Number(p?.stars) || 0;', "extras.push({name, stars:2, id:'_extra_'+name});"];
  check('só 4 pontos do app mexem na estrela bruta do admin (p.stars): copiar no renomear, o comentário, a leitura dentro de starsInfo e o peso 2 do avulso; qualquer outra tela precisa passar por starsOf', rawLines.length === 4 && expectedRaw.every(x => rawLines.some(l => l.includes(x))), rawLines);
  const count = x => html.split(x).length - 1;
  check('as telas que somam estrelas leem a estrela que VALE (starsOf): Elencos do campeonato, aba EU (times), detalhe do time e Sortudos & Azarados', ['(st.players||[]).forEach(p=>_sMap[p.name]=starsOf(p));', 'st.players.forEach(p => _starsMap[p.name] = starsOf(p));', 'st.players.forEach(p => starsMap[p.name] = starsOf(p));', '(st.players||[]).forEach(p=>starsM[p.name]=starsOf(p));'].every(x => count(x) === 1));
  check('…e mostram as somas e médias com uma casa e vírgula (starsText) em todas as telas', count('${starsText(teamStars)}★') === 1 && count('${starsText(e.teamStars)}★ · 🏆${e.rosterTitles}') === 2 && count("starsText(avgTeamStars)+'★'") === 1 && count("starsText(avgChampTeamStars)+'★'") === 1 && count('<strong>${starsText(d.teamStars)}</strong> estrelas') === 1 && count('${starsDisplay(stars)}') === 1);
  check('o sorteio mostra a estrela que vale na lista de presentes e em cada time (starsDisplay(starsOf(p))) e a soma do time em starsText', count('starsDisplay(starsOf(p))') === 2 && count('${starsText(sums[i])}★') === 1);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(err => { console.error('ERRO NO TESTE', err); process.exit(1); });
