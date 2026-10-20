// Comparar as conquistas com as de um RIVAL (index.html): extrai o código real e o executa num ambiente simulado, sem navegador. A escolha do rival fica só no aparelho
// (localStorage, por conta e liga), o rival não é avisado, a comparação usa o mesmo cálculo das conquistas para os dois lados e só aparece no PRÓPRIO perfil (nunca na
// simulação do admin). O cartão "Eu × meu rival" sai em Story e Feed pela mesma janela dos outros cartões, com a cor do placar (dourado na frente, azul atrás, verde no
// empate) e sem nenhum nome na legenda. Junto, a correção do cálculo de todos os jogadores, que não contava os campeonatos com churrasco ("Só vim pra comer").
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
const code = slice('const MJ_CARD = {', '/* ── Painel do dono');
const rivalCode = slice('/* ── Rival ─', 'function closeModal()');
const eligCode = slice('function badgeEligibleCount(b) {', 'function goallessStreak(');
const keyCode = slice('const playerKey = name =>', '\n\n');
const escCode = slice('const esc = s =>', 'function toast(');
const streakCode = slice('function goallessStreak(chron, name) {', 'function getPlayerRarestBadge(');
const statsCode = slice('function computePlayerBadgeStats(name) {', 'function getBadgeCache()');
const h2hCode = slice('function h2hAgainstAll(champs, name) {', '// Quem mais ganhou de `name`'); // h2hAgainstAll + h2hFlags: o código REAL do frente a frente
const pubCode = slice('function rivalPublicStats(name) {', 'const rivalAward =');          // o cadastro público do rival, no formato das contas das conquistas

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

// ── o catálogo de mentira: ícone, nome, regra e, se for o caso, a visibilidade da liga ──
const CAT = [
  { id: 'estreante', emoji: '⭐', label: 'Estreante', desc: 'Participou do 1º campeonato' },
  { id: 'veterano', emoji: '🎖️', label: 'Veterano', desc: '10 ou mais campeonatos' },
  { id: 'campeao', emoji: '🏆', label: 'Campeão', desc: 'Pelo menos 1 título' },
  { id: 'invicto', emoji: '🛡️', label: 'Invicto', desc: 'Campeão sem perder' },
  { id: 'pipoca', emoji: '🍿', label: 'Pipoca', desc: 'Vice 3 vezes', fieldOnly: true },
  { id: 'paredao', emoji: '🧤', label: 'Paredão', desc: 'Clean sheets', gkOnly: true },
  { id: 'meio', emoji: '🌗', label: 'Meio Campeão', desc: 'Meio título', visible: () => false }, // escondida pela liga
  { id: 'pipoca2', emoji: '🥇', label: 'Bicampeão', desc: '2 títulos seguidos' },
];
const PLAYERS = [{ name: 'Ana Maria Souza' }, { name: 'Bruno' }, { name: 'Carla Dias' }, { name: 'Gil', goleiro: true }, { name: 'Zeca', active: false }, { name: 'Éder Álvaro' }];
// quem tem o quê (na cache de conquistas); "meio" está escondida pela liga e não pode contar para ninguém
const BADGES = {
  'Ana Maria Souza': ['estreante', 'veterano', 'campeao', 'pipoca', 'meio'],
  Bruno: ['estreante', 'veterano', 'invicto', 'pipoca2', 'meio'],
  'Carla Dias': ['estreante', 'campeao', 'invicto', 'pipoca', 'pipoca2'],
  Gil: ['estreante', 'paredao'],
  Zeca: ['estreante'],
  'Éder Álvaro': [],
};
const holdersOf = badges => { const h = {}; for (const b of CAT) h[b.id] = Object.entries(badges).filter(([, ids]) => ids.includes(b.id)).map(([n]) => n); return h; };

function makeEnv({ canShare = true, shareImpl, copyOk = true, storage = {}, storageThrows = false, players = PLAYERS, badges = BADGES, catalog = CAT, me = 'ana_maria_souza', sim = null, db = null, fn = null, ready = true } = {}) {
  const calls = { events: [], toasts: [], shared: [], clicks: [], revoked: [], canvases: [], copied: [], renders: 0, queries: 0 };
  let urlN = 0;
  const fakeUrl = { createObjectURL: b => `blob:teste/${++urlN}-${b.size}`, revokeObjectURL: u => { calls.revoked.push(u); } };
  const layers = [];
  const rows = [];
  const doc = {
    fonts: { load: async () => [] }, getElementById: id => layers.find(x => x.id === id) || null,
    querySelectorAll: sel => { calls.queries++; return /rival-list/.test(sel) ? rows : []; },
    createElement: tag => {
      if (tag === 'canvas') { const cv = { width: 0, height: 0, ctx: fakeCtx(), getContext() { return cv.ctx; }, toBlob(cb) { setTimeout(() => cb(new Blob(['png' + cv.height], { type: 'image/png' })), 0); } }; calls.canvases.push(cv); return cv; }
      if (tag === 'a') { const a = { href: '', download: '', click() { calls.clicks.push({ href: a.href, download: a.download }); }, remove() {} }; return a; }
      const el = { id: '', className: '', innerHTML: '', remove() { const i = layers.indexOf(el); if (i >= 0) layers.splice(i, 1); } }; return el;
    },
    body: { appendChild: el => { if (el.id) layers.push(el); } },
  };
  class FakeImage { set src(v) { this._src = v; setTimeout(() => { this.naturalWidth = 400; this.naturalHeight = 300; this.__photo = !String(v).includes('logo'); this.onload?.(); }, 0); } get src() { return this._src; } }
  const nav = { share: async d => { calls.shared.push(d); if (shareImpl) return shareImpl(d); }, canShare: () => canShare };
  const store = new Map(Object.entries(storage));
  const localStorage = {
    getItem: k => { if (storageThrows) throw new Error('bloqueado'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('bloqueado'); store.set(k, String(v)); },
  };
  const env = {
    st: { authUser: { uid: 'u1' }, leagueId: 'liga1', userDoc: { playerKey: me }, players, rivalDoc: null, rivalReady: ready, playersReady: ready, availableLeagues: [{ id: 'liga1', name: 'Série B Aceoma' }], photos: { [me]: 'https://res.cloudinary.com/x/foto.jpg' }, modal: null, mjPreviewKey: sim },
    document: doc, navigator: nav, Image: FakeImage, URL: fakeUrl, pixCopyText: async t => { calls.copied.push(t); return copyOk; },
    trackEvent: (n, once = true) => { calls.events.push([n, once]); }, toast: (m, t) => { calls.toasts.push([m, t]); },
    DB: db, callFn: fn || (async () => ({})), votingUsed: () => false, peerStarsOn: () => false, starsInfo: () => ({ value: 0, source: 'admin' }), starsText: n => String(n), getChampAwards: () => null,
    localStorage, render: () => { calls.renders++; }, BADGE_CATALOG: catalog, getBadgeCache: () => ({ playerBadges: badges, badgeHolders: holdersOf(badges) }),
  };
  const names = Object.keys(env);
  const body = escCode + '\n' + keyCode + '\n' + code + '\n' + eligCode + '\n' + rivalCode + `
return { MJ_CARD, MJ_STORY, MJ_TIERS, MJ_KINDS, mjTierOf, mjByRarity, mjRivalData, mjRivalVerdict, mjRivalCaption, drawMjRivalCard, drawMjRivalStory, openMjShare, closeMjCard, shareMjCard, copyMjCaption,
  downloadMjCard, setMjFormat, getKind: () => _mjKind, getBlobs: () => _mjBlobs, RIVAL_STORE, rivalStoreKey, rivalGet, rivalSince, rivalMigrateLocal, rivalSet, rivalCandidates, rivalPlayer, rivalVisible, rivalBadgeIds, rivalDiff,
  rivalCompare, rivalInitials, rivalStrip, openRival, rivalPick, rivalChange, rivalRemove, rivalFilter, openMjRival, mRival, playerKey, badgeEligibleCount };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, layers, store, rows };
}

const tick = () => new Promise(r => setTimeout(r, 15));
const W = 1080, H = 1350;
const { api: A } = makeEnv();
const logo = { naturalWidth: 1024, naturalHeight: 1024 }, photo = { naturalWidth: 400, naturalHeight: 300, __photo: true };
const COLORS = { legendary: '#f0b429', epic: '#b06eff', rare: '#4db8ff', common: '#00d67f' };
const LINK = 'https://peladanamao.com.br/?ref=cartao';
const said = ctx => ctx.texts.map(t => t.text);
const KEY = 'u1_liga1';

(async () => {
  // ══ 1. CONTA PURA ═════════════════════════════════════════════════════════════════════════════════
  const d1 = A.rivalDiff(['a', 'b', 'c', 'd'], ['c', 'd', 'e']);
  check('diferença: só as minhas (na ordem que vieram), só as do rival e as que os dois têm; sem tocar nas listas', JSON.stringify(d1) === JSON.stringify({ onlyMine: ['a', 'b'], onlyTheirs: ['e'], both: ['c', 'd'] }) && JSON.stringify(A.rivalDiff([], [])) === JSON.stringify({ onlyMine: [], onlyTheirs: [], both: [] }) && JSON.stringify(A.rivalDiff(['a'], [])) === JSON.stringify({ onlyMine: ['a'], onlyTheirs: [], both: [] }) && JSON.stringify(A.rivalDiff([], ['a'])) === JSON.stringify({ onlyMine: [], onlyTheirs: ['a'], both: [] }) && JSON.stringify(A.rivalDiff(['a', 'b'], ['a', 'b'])) === JSON.stringify({ onlyMine: [], onlyTheirs: [], both: ['a', 'b'] }), d1);
  const mine = [{ emoji: '🍿', label: 'Pipoca', holders: 1, eligible: 14 }, { emoji: '🛡️', label: 'Invicto', holders: 4, eligible: 14 }];
  const theirs = [{ emoji: '🏆', label: 'Campeão', holders: 11, eligible: 14 }], both = [{ emoji: '⭐', label: 'Estreante', holders: 12, eligible: 14 }, { emoji: '😭', label: 'Baggio', holders: 2, eligible: 20 }];
  const r = A.mjRivalData({ name: 'Ana Maria Souza', league: 'Série B Aceoma', photo: 'https://res.cloudinary.com/x/foto.jpg', rivalName: 'Bruno Costa', mine, theirs, both });
  check('dados do cartão: nome, liga, foto https, iniciais de cada lado, os três grupos com o nível de cada conquista, os números (4 x 3, diferença +1) e a situação "na frente" em dourado', r.name === 'Ana Maria Souza' && r.league === 'Série B Aceoma' && r.photo === 'https://res.cloudinary.com/x/foto.jpg' && r.initials === 'AM' && r.rivalName === 'Bruno Costa' && r.rivalInitials === 'BC' && r.mine.map(b => b.tier).join() === 'legendary,rare' && r.theirs[0].tier === 'common' && r.both.map(b => b.tier).join() === 'common,epic' && r.myCount === 4 && r.rivalCount === 3 && r.diff === 1 && r.status === 'ahead' && r.tier === 'legendary' && r.tone === A.MJ_TIERS.legendary, r);
  const behind = A.mjRivalData({ name: 'A', rivalName: 'B', mine: [], theirs: theirs, both: [] }), tie = A.mjRivalData({ name: 'A', rivalName: 'B', mine, theirs: mine, both: [] });
  check('a cor do cartão conta o placar: na frente dourado (lendária), atrás azul (rara), empate verde (comum); inclusive 0 x 0 é empate', behind.status === 'behind' && behind.tone === A.MJ_TIERS.rare && behind.diff === -1 && tie.status === 'tie' && tie.tone === A.MJ_TIERS.common && tie.diff === 0 && A.mjRivalData({}).status === 'tie' && A.mjRivalData({}).myCount === 0);
  const vazio = A.mjRivalData({});
  check('sem nada: "Jogador" contra "Rival", iniciais J e R, sem liga, sem foto e grupos vazios (nunca quebra)', vazio.name === 'Jogador' && vazio.rivalName === 'Rival' && vazio.initials === 'J' && vazio.rivalInitials === 'R' && vazio.league === '' && vazio.photo === '' && vazio.mine.length + vazio.theirs.length + vazio.both.length === 0, vazio);
  check('a foto só vale se for https; itens sem ícone ou sem nome saem; no máximo 200 por grupo; o rival NUNCA tem foto nos dados (só as iniciais)', ['http://x/f.jpg', 'javascript:alert(1)', '/foto.jpg', 'data:image/png;base64,AA', 123, null].every(p => A.mjRivalData({ photo: p }).photo === '') && A.mjRivalData({ mine: [...mine, { emoji: '', label: 'x' }, { emoji: '⭐' }, null, 5] }).mine.length === 2 && A.mjRivalData({ both: Array.from({ length: 300 }, () => ({ emoji: '⭐', label: 'B' })) }).both.length === 200 && !('rivalPhoto' in r) && !/rivalPhoto|photoRival/.test(JSON.stringify(Object.keys(r))), Object.keys(r));
  const priv = A.mjRivalData({ name: 'Ana', rivalName: 'Bruno', mine, email: 'ana@x.com', whatsapp: '11999998888', uid: 'abc123', phone: '1133334444', rivalEmail: 'b@x.com' });
  check('PRIVACIDADE: e-mail, WhatsApp, telefone e id de conta que cheguem por engano NÃO entram nos dados do cartão do rival', !/ana@x\.com|b@x\.com|11999998888|abc123|1133334444|whatsapp|email/i.test(JSON.stringify(priv)), priv);
  check('a frase de quem está na frente, em primeira pessoa e no plural certo: "Estou 3 conquistas na frente!", "Estou 1 conquista na frente!", "Meu rival está 2 conquistas na frente", "… 1 conquista …", "Empatados!"', A.mjRivalVerdict({ status: 'ahead', diff: 3 }) === 'Estou 3 conquistas na frente!' && A.mjRivalVerdict({ status: 'ahead', diff: 1 }) === 'Estou 1 conquista na frente!' && A.mjRivalVerdict({ status: 'behind', diff: -2 }) === 'Meu rival está 2 conquistas na frente' && A.mjRivalVerdict({ status: 'behind', diff: -1 }) === 'Meu rival está 1 conquista na frente' && A.mjRivalVerdict({ status: 'tie', diff: 0 }) === 'Empatados!');
  const cap = A.mjRivalCaption(r);
  check('legenda: gancho, "4 x 3 em conquistas: Estou 1 conquista na frente!", o convite com ?ref=cartao e as hashtags, em 4 linhas, SEM nome de ninguém nem liga', cap === `Eu x meu rival no Pelada na Mão ⚔️\n4 x 3 em conquistas: Estou 1 conquista na frente!\nQuem tem mais na sua pelada? Crie a liga: ${LINK}\n#pelada #futebolamador #peladanamao` && !cap.includes('Ana') && !cap.includes('Bruno') && !cap.includes('Série') && cap.split('\n').length === 4, cap);
  check('o tipo de janela "rival": título, arquivos (Story e Feed) diferentes dos outros, texto de compartilhar só com os números e o link ?ref=cartao (sem nomes)', A.MJ_KINDS.rival.title === '📤 Eu × meu rival' && A.MJ_KINDS.rival.file.story === 'rival-pelada-na-mao-story.png' && A.MJ_KINDS.rival.file.feed === 'rival-pelada-na-mao.png' && A.MJ_KINDS.rival.shareTitle === 'Eu x meu rival no Pelada na Mão' && A.MJ_KINDS.rival.text(r) === `Eu 4 x 3 do meu rival em conquistas no Pelada na Mão ⚔️ Faça a liga da sua pelada: ${LINK}` && !A.MJ_KINDS.rival.text(r).includes('Bruno') && !A.MJ_KINDS.rival.text(r).includes('Ana'), A.MJ_KINDS.rival.text(r));

  // ══ 2. O DESENHO ══════════════════════════════════════════════════════════════════════════════════
  const draw = (data, ph = null, lg = logo, fn = 'drawMjRivalCard') => { const x = fakeCtx(); A[fn](x, data, ph, lg); return x; };
  let c = draw(r, photo);
  const tx = s => c.texts.find(t => t.text === s);
  check('textos do cartão: título, o meu nome e o do rival em maiúsculas, os dois números, "conquistas", a frase, os três rótulos com a quantidade, os ícones e o rodapé', ['EU × MEU RIVAL', 'ANA MARIA SOUZA', 'BRUNO COSTA', '4', '3', 'conquistas', 'Estou 1 conquista na frente!', 'SÓ EU TENHO (2)', 'SÓ O MEU RIVAL TEM (1)', 'OS DOIS TÊM (2)', '🍿', '🛡️', '🏆', '⭐', '😭', 'Série B Aceoma', 'Crie a liga da sua pelada', 'peladanamao.com.br', '×'].every(x => said(c).includes(x)), said(c));
  check('o rótulo do grupo das conquistas em comum é no MASCULINO ("OS DOIS TÊM", como o "Os dois têm" da janela): nunca "AS DUAS TÊM" (a maioria dos jogadores é homem), nem na imagem nem no código', !!tx('OS DOIS TÊM (2)') && !said(c).some(t => /AS DUAS/i.test(t)) && /\['OS DOIS TÊM', c\.both\]/.test(code) && !/AS DUAS T/i.test(code), said(c));
  check('a minha foto vai DENTRO do recorte redondo (esquerda); o rival só tem as iniciais (BC) e NENHUMA outra foto é desenhada; o logo no topo', c.images.length === 2 && c.images[0].img === logo && c.images[1].img === photo && c.images[1].clipped === true && !!tx('BC') && !c.texts.some(t => t.text === 'AM') && c.arcs.filter(a => a.r === 94).length === 2 && c.arcs.filter(a => a.r === 94).map(a => a.x).join() === '270,810', c.images.length);
  const semFoto = draw(r, null);
  check('sem foto minha: as minhas iniciais (AM) no lugar, na cor do cartão, e o logo continua', semFoto.images.length === 1 && semFoto.texts.find(t => t.text === 'AM').fill === COLORS.legendary && semFoto.texts.find(t => t.text === 'BC').fill === '#8b949e');
  for (const [k, data, cor, outras] of [['na frente', r, COLORS.legendary, [COLORS.rare, COLORS.common]], ['atrás', behind, COLORS.rare, [COLORS.legendary, COLORS.common]], ['empate', tie, COLORS.common, [COLORS.legendary, COLORS.rare]]]) {
    const x = draw(data, null);
    const stops = [A.MJ_TIERS.legendary, A.MJ_TIERS.epic, A.MJ_TIERS.rare, A.MJ_TIERS.common].filter(t => t.color !== cor).flatMap(t => [t.bg, t.glow]);
    check(`placar ${k}: moldura, título, frase e rodapé na cor ${cor}; fundo e brilho do nível; nenhuma cor dos outros placares aparece`, x.strokes.length === 1 && x.strokes[0].color === cor && x.strokes[0].width === 6 && x.texts.find(t => t.text === 'EU × MEU RIVAL').fill === cor && x.texts.find(t => t.text === 'peladanamao.com.br').fill === cor && !x.texts.some(t => outras.includes(t.fill)) && !x.stops.some(s => stops.includes(s)) && x.stops.includes(data.tone.bg) && x.stops.includes(data.tone.glow), { strokes: x.strokes, stops: x.stops });
  }
  const dest = (data, lado) => draw(data, null).texts.find(t => /170px|150px/.test(t.font) && t.x === (lado === 'meu' ? 270 : 810));
  check('quem está na frente leva a cor no número (e o outro fica branco); no empate os dois levam a cor', dest(r, 'meu').fill === COLORS.legendary && dest(r, 'rival').fill === '#ffffff' && dest(behind, 'meu').fill === '#ffffff' && dest(behind, 'rival').fill === COLORS.rare && dest(tie, 'meu').fill === COLORS.common && dest(tie, 'rival').fill === COLORS.common);
  check('"1 conquista" no singular embaixo do número; zero e plural em "conquistas"', draw(A.mjRivalData({ name: 'A', rivalName: 'B', mine: [mine[0]] })).texts.filter(t => /^conquistas?$/.test(t.text)).map(t => t.text).join() === 'conquista,conquistas');
  const dentro = ctx => ctx.texts.filter(t => t.x < 0 || t.x > W || t.y < 0 || t.y > H);
  check('todo texto fica dentro da imagem (1080×1350), com as linhas das conquistas uma embaixo da outra e acima do rodapé (a última, até 1180, antes de "Crie a liga…" em 1236)', dentro(c).length === 0 && (() => { const ys = ['SÓ EU TENHO (2)', 'SÓ O MEU RIVAL TEM (1)', 'OS DOIS TÊM (2)'].map(s => tx(s).y); return ys[0] < ys[1] && ys[1] < ys[2] && ys[2] + 48 + 30 < tx('Crie a liga da sua pelada').y - 24 && tx('Estou 1 conquista na frente!').y < ys[0]; })(), c.texts.map(t => [t.text, t.y]).filter(x => x[1] > 1100));
  const muitos = A.mjRivalData({ name: 'Ana', rivalName: 'Bruno', mine: Array.from({ length: 12 }, (_, i) => ({ emoji: ['⭐', '🏆', '🛡️', '🥇', '🔥', '💎', '👑', '🎯', '🍿', '🧤', '🌗', '⚡'][i], label: 'M' + i })), theirs: Array.from({ length: 9 }, (_, i) => ({ emoji: '🏅', label: 'T' + i })), both: Array.from({ length: 30 }, () => ({ emoji: '🏆', label: 'B' })) });
  const cm = draw(muitos, null);
  check('mais de 9 conquistas num grupo: 8 ícones e o "+N" (12 → "+4"; 30 → "+22"); 9 cabem todos, sem "+N"; tudo dentro da largura', said(cm).includes('+4') && said(cm).includes('+22') && !said(cm).some(t => t === '+1') && cm.texts.filter(t => /^400 50px/.test(t.font)).length === 8 + 9 + 8 && cm.texts.filter(t => /^\+\d+$/.test(t.text)).length === 2 && cm.texts.filter(t => /^400 50px/.test(t.font)).every(t => t.x > 60 && t.x < W - 60) && dentro(cm).length === 0, said(cm).filter(t => /^\+/.test(t)));
  const centro = y => { const xs = cm.texts.filter(t => t.y === y && (/^400 50px/.test(t.font) || /^\+\d+$/.test(t.text))).map(t => t.x); return Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 540) < 0.001; };
  check('cada linha de ícones fica CENTRALIZADA na imagem, inclusive com o "+N" no fim (o "+N" conta como uma célula)', centro(866) && centro(994) && centro(1122), cm.texts.filter(t => t.y === 1122).map(t => t.x));
  const vz = draw(A.mjRivalData({ name: 'Bia', rivalName: 'Igor' }), null);
  check('sem conquista nenhuma dos dois lados: "—" nos três grupos, "0" e "0", "Empatados!", sem quebrar', vz.texts.filter(t => t.text === '—').length === 3 && said(vz).includes('Empatados!') && vz.texts.filter(t => t.text === '0').length === 2 && said(vz).includes('SÓ EU TENHO (0)') && dentro(vz).length === 0);
  const longo = draw(A.mjRivalData({ name: 'Fulano de Tal da Silva Sauro Pereira Gonçalves de Albuquerque Junior Neto Filho', rivalName: 'Letícia Moreira Santos de Albuquerque Filha do Meio', league: 'Liga dos Veteranos do Bairro Alto da Boa Vista do Meio do Nada', mine, theirs, both }), null);
  check('nomes enormes (os dois e a liga): encolhem/cortam e ficam dentro da largura (440 px para cada nome, 680 para a liga)', longo.texts.filter(t => /FULANO|LETÍCIA/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 440) && longo.texts.filter(t => /^Liga dos/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 680) && dentro(longo).length === 0);
  const sf = draw(r, photo), ss = draw(r, photo, logo, 'drawMjRivalStory'), S = A.MJ_STORY, kS = (S.H - S.TOP - S.BOTTOM) / A.MJ_CARD.H;
  check('Story: o MESMO cartão inteiro e escalado entre as margens de 250 e 340 px, com os mesmos textos, o brilho acompanhando (y = 250 + 400·k) e a mesma cor do placar', ss.texts.every(t => Math.abs(t.k - kS) < 1e-9 && t.ay >= S.TOP && t.ay <= S.H - S.BOTTOM && t.ax >= 0 && t.ax <= S.W) && JSON.stringify(ss.texts.map(t => t.text)) === JSON.stringify(sf.texts.map(t => t.text)) && Math.abs(ss.radials[0][1] - (S.TOP + 400 * kS)) < 1e-6 && ss.fillRects.filter(q => q.w === 1080 && q.h === 1920).length === 2 && ss.stops.includes(A.MJ_TIERS.legendary.bg) && ss.strokes[0].color === COLORS.legendary && ss.saves === ss.restores && ss.k === 1);

  // ══ 3. A ESCOLHA FICA NO SERVIDOR ═════════════════════════════════════════════════════════════════
  let e = makeEnv();
  const docOf = (ownKey, rivalKey, extra = {}) => ({ ownKey, rivalKey, since: '2026-09-10T12:00:00.000Z', mutual: false, lead: '', duels: {}, ...extra });
  check('a chave da guarda ANTIGA é "conta_liga" (hoje só serve para levar a escolha antiga ao servidor); sem conta ou sem liga é vazia', e.api.rivalStoreKey() === KEY && e.api.RIVAL_STORE === 'aceoma_rival' && (() => { const z = makeEnv(); z.env.st.authUser = null; const k1 = z.api.rivalStoreKey(); z.env.st.authUser = { uid: 'u1' }; z.env.st.leagueId = null; return k1 === '' && z.api.rivalStoreKey() === ''; })());
  check('começa sem rival (documento da conta nulo): nem rival, nem data, nem jogador', e.api.rivalGet() === '' && e.api.rivalSince() === '' && e.api.rivalPlayer() === null && e.store.size === 0);
  e.api.rivalSet('bruno');
  check('escolher mostra na hora: o documento da conta ganha o jogador, o rival, a hora, o histórico vazio e "sem par"; nada vai para o aparelho (localStorage) e não redesenha sozinho', JSON.stringify(Object.keys(e.env.st.rivalDoc).sort()) === JSON.stringify(['duels', 'lead', 'mutual', 'ownKey', 'rivalKey', 'since']) && e.env.st.rivalDoc.ownKey === 'ana_maria_souza' && e.env.st.rivalDoc.rivalKey === 'bruno' && /^\d{4}-\d\d-\d\dT/.test(e.env.st.rivalDoc.since) && e.env.st.rivalDoc.mutual === false && e.env.st.rivalDoc.lead === '' && JSON.stringify(e.env.st.rivalDoc.duels) === '{}' && e.api.rivalGet() === 'bruno' && e.api.rivalSince() === e.env.st.rivalDoc.since && e.store.size === 0 && e.calls.renders === 0, e.env.st.rivalDoc);
  check('o rival só vale para o jogador a que a conta está ligada AGORA: documento de outro jogador (conta ligada a outro depois) não conta', (() => { const z = makeEnv(); z.env.st.rivalDoc = docOf('outro_jogador', 'bruno'); return z.api.rivalGet() === '' && z.api.rivalSince() === '' && z.api.rivalPlayer() === null; })() && (() => { const z = makeEnv({ me: undefined }); z.env.st.userDoc.playerKey = undefined; z.env.st.rivalDoc = docOf('ana_maria_souza', 'bruno'); return z.api.rivalGet() === ''; })());
  e.env.st.rivalDoc = docOf('ana_maria_souza', 'bruno', { duels: { '2026-08': { r: 'bruno', res: 'mao', m: 3, t: 1 } }, lead: 'mine', mutual: true });
  e.api.rivalSet('carla_dias');
  check('trocar de rival: já mostra o novo, recomeça a data, tira o "par" e a virada, e MANTÉM os meses de duelo que já fecharam', e.api.rivalGet() === 'carla_dias' && e.env.st.rivalDoc.since !== '2026-09-10T12:00:00.000Z' && e.env.st.rivalDoc.mutual === false && e.env.st.rivalDoc.lead === '' && e.env.st.rivalDoc.duels['2026-08'].res === 'mao', e.env.st.rivalDoc);
  e.api.rivalSet('');
  check('remover: o documento fica (com o histórico), sem rival e sem data', e.api.rivalGet() === '' && e.api.rivalSince() === '' && e.env.st.rivalDoc.rivalKey === '' && e.env.st.rivalDoc.since === '' && e.env.st.rivalDoc.duels['2026-08'].res === 'mao', e.env.st.rivalDoc);
  check('remover quando já não há rival: não faz nada (nem chama o servidor)', await (async () => { const calls2 = []; const z = makeEnv({ db: {}, fn: async (n, d) => { calls2.push([n, d]); return {}; } }); const ok = await z.api.rivalSet(''); return ok === true && calls2.length === 0 && z.env.st.rivalDoc === null; })());

  // com o servidor: a escolha aparece na hora e o servidor confirma (setRival)
  const fnCalls = [];
  let fnImpl = async (n, d) => ({ ok: true, rivalKey: d.rivalKey, since: '2026-10-20T15:00:00.000Z', mutual: true });
  e = makeEnv({ db: {}, fn: (n, d) => { fnCalls.push([n, d]); return fnImpl(n, d); } });
  const pr1 = e.api.rivalSet('bruno');
  check('com o servidor: a escolha já vale na tela antes da resposta e o app fica "ocupado" (uma leitura antiga não a desfaz)', e.api.rivalGet() === 'bruno' && e.env.st._rivalBusy === 1 && JSON.stringify(fnCalls) === JSON.stringify([['setRival', { liga: 'liga1', rivalKey: 'bruno' }]]));
  const ok1 = await pr1;
  check('com o servidor: a resposta traz a hora do servidor e se os dois se escolheram; o app larga o "ocupado" e redesenha uma vez', ok1 === true && e.env.st.rivalDoc.since === '2026-10-20T15:00:00.000Z' && e.env.st.rivalDoc.mutual === true && e.env.st.rivalDoc.rivalKey === 'bruno' && e.env.st._rivalBusy === 0 && e.calls.renders === 1, e.env.st.rivalDoc);
  fnImpl = async () => { throw new Error('Esse jogador não está ativo no elenco desta liga.'); };
  const antes = e.env.st.rivalDoc;
  const ok2 = await e.api.rivalSet('carla_dias');
  check('com o servidor: se ele recusar, a tela volta ao que era, o motivo aparece num aviso e a promessa devolve false', ok2 === false && e.env.st.rivalDoc === antes && e.api.rivalGet() === 'bruno' && e.calls.toasts.length === 1 && /não está ativo/.test(e.calls.toasts[0][0]) && e.env.st._rivalBusy === 0 && e.calls.renders === 2, [e.calls.toasts, e.env.st.rivalDoc]);
  fnImpl = async () => { throw new Error(); };
  await e.api.rivalSet('gil');
  check('com o servidor: erro sem mensagem mostra o aviso padrão', /Não foi possível salvar o rival agora/.test(e.calls.toasts[1][0]));
  fnImpl = async (n, d) => ({ ok: true, rivalKey: '', since: '', mutual: false });
  const ok3 = await e.api.rivalSet('');
  check('com o servidor: tirar o rival também passa pelo servidor (rivalKey vazio) e a tela já fica sem rival', ok3 === true && fnCalls[fnCalls.length - 1][1].rivalKey === '' && e.api.rivalGet() === '' && e.env.st.rivalDoc.since === '', fnCalls[fnCalls.length - 1]);
  check('sem jogador vinculado à conta: rivalSet não faz nada', await (async () => { const z = makeEnv({ db: {}, fn: async () => { throw new Error('não devia chamar'); } }); z.env.st.userDoc.playerKey = undefined; return (await z.api.rivalSet('bruno')) === false && z.env.st.rivalDoc === null; })());

  // duas escolhas seguidas, com as respostas fora de ordem: vale a última, nunca a que chegou por último
  {
    const waits = [];
    const z = makeEnv({ db: {}, fn: (n, d) => new Promise(res => waits.push(() => res({ ok: true, rivalKey: d.rivalKey, since: 'S-' + d.rivalKey, mutual: false }))) });
    const p1 = z.api.rivalSet('bruno'), p2 = z.api.rivalSet('carla_dias');
    check('duas escolhas seguidas: a tela já mostra a última e o app fica ocupado nas duas', z.api.rivalGet() === 'carla_dias' && z.env.st._rivalBusy === 2);
    waits[1](); await p2; waits[0](); await p1;
    check('…a resposta da primeira chegando depois da segunda NÃO desfaz a segunda (a tela fica com carla_dias e a hora dela) e o app larga o "ocupado"', z.api.rivalGet() === 'carla_dias' && z.env.st.rivalDoc.since === 'S-carla_dias' && z.env.st._rivalBusy === 0, z.env.st.rivalDoc);
    const w2 = [];
    const y = makeEnv({ db: {}, fn: (n, d) => new Promise((res, rej) => w2.push(() => (d.rivalKey === 'bruno' ? rej(new Error('erro da 1ª')) : res({ ok: true, rivalKey: d.rivalKey, since: 'S', mutual: false })))) });
    const q1 = y.api.rivalSet('bruno'), q2 = y.api.rivalSet('carla_dias');
    w2[1](); await q2; w2[0](); await q1;
    check('…e o erro da primeira (já substituída) não volta a tela atrás nem avisa; a segunda vale', y.api.rivalGet() === 'carla_dias' && y.calls.toasts.length === 0, [y.env.st.rivalDoc, y.calls.toasts]);
  }

  // quem escolheu o rival antes (só no aparelho) não perde a escolha
  const KEYL = 'u1_liga1';
  const mig = async (storage, opts = {}) => {
    const calls2 = [];
    const z = makeEnv({ db: {}, fn: async (n, d) => { calls2.push([n, d]); if (opts.fails) throw new Error('x'); return { ok: true, rivalKey: d.rivalKey, since: '2026-10-20T15:00:00.000Z', mutual: false }; }, storage, ...(opts.env || {}) });
    if (opts.server) z.env.st.rivalDoc = opts.server;
    z.api.rivalMigrateLocal();
    await tick();
    let left = null; try { left = z.store.has('aceoma_rival') ? JSON.parse(z.store.get('aceoma_rival')) : null; } catch (_) {}
    return { z, calls: calls2, left };
  };
  let mg = await mig({ aceoma_rival: JSON.stringify({ [KEYL]: 'bruno', u9_outra: 'gil' }) });
  check('migração: o rival antigo do aparelho vai para o servidor uma vez, e só a cópia dele sai do aparelho (as outras ligas ficam)', mg.calls.length === 1 && mg.calls[0][0] === 'setRival' && mg.calls[0][1].rivalKey === 'bruno' && mg.z.api.rivalGet() === 'bruno' && JSON.stringify(mg.left) === '{"u9_outra":"gil"}', [mg.calls, mg.left]);
  mg = await mig({ aceoma_rival: JSON.stringify({ [KEYL]: 'bruno' }) }, { server: docOf('ana_maria_souza', 'carla_dias') });
  check('migração: se a conta já tem rival no servidor (escolhido em outro aparelho), vale o do servidor: nada é enviado e a cópia antiga some', mg.calls.length === 0 && mg.z.api.rivalGet() === 'carla_dias' && JSON.stringify(mg.left) === '{}', [mg.calls, mg.left]);
  for (const [rotulo, chave] of [['eu mesmo', 'ana_maria_souza'], ['jogador inativo', 'zeca'], ['jogador que não existe mais', 'fulano_de_tal']]) {
    mg = await mig({ aceoma_rival: JSON.stringify({ [KEYL]: chave }) });
    check(`migração: rival antigo que já não pode ser rival (${rotulo}) não vai ao servidor e a cópia some`, mg.calls.length === 0 && mg.z.api.rivalGet() === '' && JSON.stringify(mg.left) === '{}', [mg.calls, mg.left]);
  }
  mg = await mig({ aceoma_rival: JSON.stringify({ [KEYL]: 'bruno' }) }, { fails: true });
  check('migração: se o servidor falhar, a escolha antiga continua no aparelho para tentar de novo e o app volta a não ter rival', mg.calls.length === 1 && mg.z.api.rivalGet() === '' && JSON.stringify(mg.left) === JSON.stringify({ [KEYL]: 'bruno' }), [mg.calls, mg.left]);
  mg = await mig({ aceoma_rival: JSON.stringify({ [KEYL]: 'bruno' }) }, { env: { ready: false } });
  check('migração: só roda com o documento da conta e o elenco já carregados', mg.calls.length === 0 && JSON.stringify(mg.left) === JSON.stringify({ [KEYL]: 'bruno' }));
  mg = await mig({});
  check('migração: sem escolha antiga no aparelho, nada acontece', mg.calls.length === 0 && mg.left === null);
  const once = await (async () => { const calls2 = []; const z = makeEnv({ db: {}, fn: async (n, d) => { calls2.push(d.rivalKey); return { ok: true, rivalKey: d.rivalKey, since: 's', mutual: false }; }, storage: { aceoma_rival: JSON.stringify({ [KEYL]: 'bruno' }) } }); z.api.rivalMigrateLocal(); z.api.rivalMigrateLocal(); await tick(); z.api.rivalMigrateLocal(); await tick(); return calls2.length; })();
  check('migração: chamada várias vezes (a cada leitura do banco) envia só uma vez', once === 1, once);
  const ruins = [];
  for (const [rotulo, valor] of [['JSON quebrado', '{{{'], ['texto solto', 'oi'], ['lista', '[1,2]'], ['número', '42'], ['null', 'null'], ['valor que não é texto', JSON.stringify({ [KEYL]: 5 })], ['valor objeto', JSON.stringify({ [KEYL]: { a: 1 } })]]) {
    let threw = false, r;
    try { r = await mig({ aceoma_rival: valor }); } catch (_) { threw = true; }
    if (threw || r.calls.length !== 0 || r.z.api.rivalGet() !== '') ruins.push([rotulo, threw]);
  }
  check('migração: armazenamento estragado (JSON quebrado, texto, lista, número, null, valor que não é texto): ignora e segue sem quebrar', ruins.length === 0, ruins);
  const bl = makeEnv({ storageThrows: true, db: {}, fn: async (n, d) => ({ ok: true, rivalKey: d.rivalKey, since: 's', mutual: false }) }); let jogou = false; try { bl.api.rivalMigrateLocal(); bl.api.rivalSet('bruno'); bl.api.rivalSet(''); bl.api.rivalSet('carla_dias'); await tick(); } catch (_) { jogou = true; }
  check('armazenamento bloqueado (navegação privada): nada quebra, a escolha vale pelo servidor', !jogou && bl.api.rivalGet() === 'carla_dias');

  // ══ 4. QUEM PODE SER RIVAL ════════════════════════════════════════════════════════════════════════
  e = makeEnv();
  check('candidatos: os outros jogadores ATIVOS da liga (inclui goleiros), sem eu mesmo e sem inativos, na ordem do elenco', e.api.rivalCandidates().map(p => p.name).join() === 'Bruno,Carla Dias,Gil,Éder Álvaro', e.api.rivalCandidates().map(p => p.name));
  check('sem elenco carregado ou sem jogador vinculado: nenhum candidato e nada quebra', makeEnv({ players: [] }).api.rivalCandidates().length === 0 && (() => { const z = makeEnv(); z.env.st.players = undefined; return z.api.rivalCandidates().length === 0; })());
  e.api.rivalSet('bruno');
  check('o rival escolhido volta como jogador (o mesmo do elenco)', e.api.rivalPlayer()?.name === 'Bruno');
  for (const [rotulo, chave] of [['eu mesmo', 'ana_maria_souza'], ['jogador inativo', 'zeca'], ['jogador que não existe (renomeado, anonimizado ou removido)', 'fulano_de_tal']]) { const z = makeEnv(); z.api.rivalSet(chave); if (z.api.rivalPlayer() !== null || z.api.rivalCompare() !== null) check('rival inválido (' + rotulo + '): não vale', false, chave); }
  check('rival inválido (eu mesmo, inativo ou que não existe mais): não vale (a faixa volta a convidar a escolher e a escolha antiga não quebra nada)', true);
  check('a chave do rival é a do jogador (sem acento, minúscula, com _): "Éder Álvaro" → eder_alvaro', e.api.playerKey('Éder Álvaro') === 'eder_alvaro' && makeEnv().api.rivalCandidates().some(p => e.api.playerKey(p.name) === 'eder_alvaro'));

  // ══ 5. A COMPARAÇÃO ═══════════════════════════════════════════════════════════════════════════════
  e = makeEnv(); e.api.rivalSet('bruno');
  check('só contam as conquistas que a liga mostra (a "Meio Campeão" está escondida pela liga e não entra em NENHUM dos lados), do mesmo jeito para os dois', e.api.rivalBadgeIds('Ana Maria Souza').join() === 'estreante,veterano,campeao,pipoca' && e.api.rivalBadgeIds('Bruno').join() === 'estreante,veterano,invicto,pipoca2' && e.api.rivalVisible('meio') === false && e.api.rivalVisible('estreante') === true && e.api.rivalVisible('nao-existe') === false, e.api.rivalBadgeIds('Bruno'));
  check('conquistas de um jogador que não está na cache: nenhuma (sem quebrar)', e.api.rivalBadgeIds('Fulano').length === 0);
  const cmp = e.api.rivalCompare();
  check('comparação com o Bruno: eu 4 x 4 do rival, empate; só eu (campeão, pipoca), só ele (invicto, bicampeão), os dois (estreante, veterano)', cmp.me === 'Ana Maria Souza' && cmp.rival === 'Bruno' && cmp.myCount === 4 && cmp.rivalCount === 4 && cmp.diff === 0 && cmp.mine.map(b => b.id).sort().join() === 'campeao,pipoca' && cmp.theirs.map(b => b.id).sort().join() === 'invicto,pipoca2' && cmp.both.map(b => b.id).sort().join() === 'estreante,veterano', cmp);
  check('cada conquista da comparação traz ícone, nome, regra, quantos têm na liga e quantos podem ter (a raridade): pipoca de linha (3 de 5 podem? goleiro e inativo contam conforme a base)', (() => { const p = cmp.mine.find(b => b.id === 'pipoca'); return p.emoji === '🍿' && p.label === 'Pipoca' && p.desc === 'Vice 3 vezes' && p.holders === 2 && p.eligible === 5 && cmp.both.find(b => b.id === 'estreante').holders === 5; })(), cmp.mine);
  check('cada grupo vai da mais rara para a mais comum (nível e, dentro dele, menos jogadores com ela)', (() => { const x = e.api.rivalCompare(); const rank = b => ['legendary', 'epic', 'rare', 'common'].indexOf(A.mjTierOf(b.holders, b.eligible)); return [x.mine, x.theirs, x.both].every(g => g.every((b, i) => i === 0 || rank(g[i - 1]) < rank(b) || (rank(g[i - 1]) === rank(b) && g[i - 1].holders <= b.holders))); })());
  e.api.rivalSet('carla_dias');
  const c2 = e.api.rivalCompare();
  check('com a Carla: eu 4 x 5 dela, ela na frente por 1 (diferença −1); trocar de rival refaz a conta', c2.rival === 'Carla Dias' && c2.myCount === 4 && c2.rivalCount === 5 && c2.diff === -1, c2);
  e.api.rivalSet('gil');
  const c3 = e.api.rivalCompare();
  check('com um goleiro (a conta é a mesma para todos): eu 4 x 2 dele, 2 na frente; só ele tem Paredão', c3.rival === 'Gil' && c3.myCount === 4 && c3.rivalCount === 2 && c3.diff === 2 && c3.theirs.map(b => b.id).join() === 'paredao' && c3.both.map(b => b.id).join() === 'estreante', c3);
  e.api.rivalSet('eder_alvaro');
  const c4 = e.api.rivalCompare();
  check('com quem não tem conquista nenhuma: 4 x 0, tudo "só eu"', c4.rivalCount === 0 && c4.theirs.length === 0 && c4.both.length === 0 && c4.mine.length === 4);
  const semMim = makeEnv({ badges: { ...BADGES, 'Ana Maria Souza': [] } }); semMim.api.rivalSet('bruno');
  check('sem nenhuma conquista minha: 0 x 4, ele na frente por 4 (dá para comparar mesmo assim)', semMim.api.rivalCompare().myCount === 0 && semMim.api.rivalCompare().diff === -4 && semMim.api.rivalCompare().theirs.length === 4);
  check('sem rival, sem jogador vinculado ou na simulação do admin (Ver como): não há comparação (null)', makeEnv().api.rivalCompare() === null && (() => { const z = makeEnv({ me: undefined }); z.env.st.userDoc.playerKey = undefined; return z.api.rivalCompare() === null; })() && (() => { const z = makeEnv({ sim: 'carla_dias' }); z.api.rivalSet('bruno'); return z.api.rivalCompare() === null; })() && (() => { const z = makeEnv({ sim: 'ana_maria_souza' }); z.api.rivalSet('bruno'); return z.api.rivalCompare() !== null; })());
  check('o nome que aparece é o do elenco; sem o jogador no elenco cai para a chave', (() => { const z = makeEnv({ players: PLAYERS.filter(p => p.name !== 'Ana Maria Souza') }); z.api.rivalSet('bruno'); return z.api.rivalCompare().me === 'ana_maria_souza'; })());

  // ══ 6. A FAIXA E A JANELA ═════════════════════════════════════════════════════════════════════════
  e = makeEnv();
  let strip = e.api.rivalStrip(false);
  check('faixa sem rival: convite "Compare as suas conquistas e os seus números com os de um rival da liga." e o botão "Escolher rival" (openRival)', /Compare as suas conquistas e os seus números com os de um rival da liga\./.test(strip) && /onclick="openRival\(\)"[^>]*>Escolher rival<\/button>/.test(strip) && /⚔️/.test(strip), strip.slice(0, 300));
  check('a faixa NÃO aparece na simulação do admin, sem elenco ou sem jogador vinculado', e.api.rivalStrip(true) === '' && makeEnv({ players: [] }).api.rivalStrip(false) === '' && (() => { const z = makeEnv(); z.env.st.userDoc.playerKey = undefined; return z.api.rivalStrip(false) === ''; })());
  e.api.rivalSet('carla_dias'); strip = e.api.rivalStrip(false);
  check('faixa com rival: "Você 4 × 5 Carla Dias" (o rival na frente em azul, eu em branco) e o botão Comparar; tocar na faixa toda abre a janela', /Você <b style="color:var\(--text\)">4<\/b> × <b style="color:#4db8ff">5<\/b> Carla Dias/.test(strip) && /onclick="openRival\(\)"/.test(strip.split('<button')[0]) && /event\.stopPropagation\(\);openRival\(\)[^>]*>Comparar<\/button>/.test(strip) && !/Escolher rival/.test(strip), strip.slice(0, 400));
  e.api.rivalSet('bruno'); strip = e.api.rivalStrip(false);
  check('faixa no empate: os dois números em cor neutra; eu na frente: o meu número na cor do app (verde)', /Você <b style="color:var\(--text\)">4<\/b> × <b style="color:var\(--text\)">4<\/b> Bruno/.test(strip) && /Você <b style="color:var\(--accent\)">4<\/b> × <b style="color:var\(--text\)">2<\/b> Gil/.test((() => { const z = makeEnv(); z.api.rivalSet('gil'); return z.api.rivalStrip(false); })()), strip.slice(0, 300));
  const xss = makeEnv({ players: [...PLAYERS, { name: '<img src=x onerror=alert(1)> & "oi"' }], badges: { ...BADGES, '<img src=x onerror=alert(1)> & "oi"': ['estreante'] } }); xss.api.rivalSet(xss.api.playerKey('<img src=x onerror=alert(1)> & "oi"'));
  check('o nome do rival é escapado na faixa e na janela (sem HTML solto)', xss.api.rivalPlayer() !== null && !/<img/.test(xss.api.rivalStrip(false)) && /&lt;img/.test(xss.api.rivalStrip(false)) && (() => { xss.api.openRival(); xss.env.st.modal.picking = false; return !/<img/.test(xss.api.mRival()) && /&lt;img/.test(xss.api.mRival()); })());
  check('o nome do jogador também é escapado na lista de escolha (sem HTML solto)', (() => { xss.env.st.modal = { type: 'rival', picking: true }; const h = xss.api.mRival(); return !/<img/.test(h) && /&lt;img/.test(h); })());
  e = makeEnv(); e.api.openRival();
  check('abrir a janela sem rival: tipo "rival", já na escolha (picking), e redesenha a tela', e.env.st.modal?.type === 'rival' && e.env.st.modal.picking === true && e.calls.renders === 1);
  e.api.rivalSet('bruno'); e.api.openRival();
  check('abrir com rival já escolhido: vai direto para a comparação', e.env.st.modal.picking === false && e.calls.renders === 2);
  check('abrir não faz nada na simulação do admin nem sem jogador vinculado', (() => { const z = makeEnv({ sim: 'carla_dias' }); z.api.openRival(); const z2 = makeEnv(); z2.env.st.userDoc.playerKey = undefined; z2.api.openRival(); return z.env.st.modal === null && z.calls.renders === 0 && z2.env.st.modal === null && z2.calls.renders === 0; })());
  e = makeEnv(); e.env.st.modal = { type: 'rival', picking: true };
  let m = e.api.mRival();
  check('janela de escolha: título, o aviso (na conta, só você vê, o outro jogador não é avisado e, se os dois se escolherem, os dois sabem), a busca por nome e a lista dos candidatos (4), cada um com as iniciais, o nome, quantas conquistas tem e o botão de escolher (rivalPick)', /⚔️ Seu rival/.test(m) && /Escolha um jogador da liga para comparar as conquistas e os números, disputar o duelo do mês e ver o frente a frente\. A escolha fica guardada na sua conta, só você vê, e o outro jogador não é avisado\. Se vocês dois se escolherem, os dois ficam sabendo\./.test(m) && /type="search"[^>]*oninput="rivalFilter\(this\.value\)"/.test(m) && (m.match(/data-rname="/g) || []).length === 4 && /rivalPick\('bruno'\)/.test(m) && /rivalPick\('carla_dias'\)/.test(m) && /rivalPick\('gil'\)/.test(m) && /rivalPick\('eder_alvaro'\)/.test(m) && !/rivalPick\('zeca'\)/.test(m) && !/rivalPick\('ana_maria_souza'\)/.test(m) && /data-rname="bruno"/.test(m) && /data-rname="carla dias"/.test(m) && /data-rname="éder álvaro"/.test(m), m.slice(0, 300));
  check('a lista mostra quantas conquistas cada um tem (só as visíveis): Bruno 4, Carla Dias 5, Gil 2, Éder Álvaro 0; "conquista" no singular só para 1', /Bruno<\/span>\s*<span[^>]*>4 conquistas/.test(m) && /Carla Dias<\/span>\s*<span[^>]*>5 conquistas/.test(m) && /Gil<\/span>\s*<span[^>]*>2 conquistas/.test(m) && /Éder Álvaro<\/span>\s*<span[^>]*>0 conquistas/.test(m) && /1 conquista<\/span>/.test(makeEnv({ badges: { ...BADGES, Bruno: ['estreante'] } }).api.mRival.call(null) || (() => { const z = makeEnv({ badges: { ...BADGES, Bruno: ['estreante'] } }); z.env.st.modal = { type: 'rival', picking: true }; return z.api.mRival(); })()), m.match(/\d+ conquistas?/g));
  check('na escolha sem rival não há "Voltar para a comparação"; com rival já escolhido há', !/Voltar para a comparação/.test(m) && (() => { const z = makeEnv(); z.api.rivalSet('bruno'); z.env.st.modal = { type: 'rival', picking: true }; return /Voltar para a comparação/.test(z.api.mRival()); })());
  check('liga sem outros jogadores: mensagem "Ainda não há outros jogadores na liga para virar seu rival." e sem busca', (() => { const z = makeEnv({ players: [PLAYERS[0]] }); z.env.st.modal = { type: 'rival', picking: true }; const h = z.api.mRival(); return /Ainda não há outros jogadores/.test(h) && !/type="search"/.test(h); })());
  check('outra janela aberta, ou sem jogador vinculado: a janela do rival não aparece (string vazia)', (() => { const z = makeEnv(); z.env.st.modal = { type: 'badgeInfo' }; const a = z.api.mRival(); z.env.st.modal = null; const b = z.api.mRival(); z.env.st.modal = { type: 'rival' }; z.env.st.userDoc.playerKey = undefined; return a === '' && b === '' && z.api.mRival() === ''; })());
  e = makeEnv(); e.api.rivalSet('carla_dias'); e.env.st.modal = { type: 'rival', picking: false };
  m = e.api.mRival();
  check('janela de comparação com a Carla: os dois lados (Você 4, Carla Dias 5, com iniciais), a frase "Carla Dias está 1 conquista na frente" em azul e os três grupos com a quantidade', /Você<\/div><div style="font-size:34px[^>]*>4</.test(m) && /Carla Dias<\/div><div style="font-size:34px[^>]*>5</.test(m) && />CD</.test(m) && />AM</.test(m) && /Carla Dias está 1 conquista na frente/.test(m) && /color:#4db8ff;margin-bottom:4px">Carla Dias está/.test(m) && /Só você tem \(\d\)/.test(m) && /Só Carla Dias tem \(\d\)/.test(m) && /Os dois têm \(\d\)/.test(m), m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
  check('os grupos listam cada conquista como "ícone nome" com a borda na cor do nível (sem borda colorida para a comum) e a regra na dica', /🛡️ Invicto/.test(m) && /🍿 Pipoca/.test(m) && /title="Campeão sem perder"/.test(m) && (m.match(/border:1px solid #f0b429/g) || m.match(/border:1px solid #b06eff/g) || m.match(/border:1px solid #4db8ff/g) || []).length > 0 && /border:1px solid var\(--border\)/.test(m), m.slice(m.indexOf('Só você tem')).slice(0, 500));
  const chipEst = m.match(/<span title="[^"]*" style="[^"]*">⭐ Estreante<\/span>/)?.[0] || '';
  check('a conquista COMUM (Estreante: 5 de 6 têm) fica com a borda neutra, nunca com a cor de um nível', /border:1px solid var\(--border\)/.test(chipEst) && !/border:1px solid #(00d67f|f0b429|b06eff|4db8ff)/.test(chipEst), chipEst);
  check('os botões: Compartilhar comparação (openMjRival), Trocar rival, Remover rival; e o aviso (a imagem mostra o nome do rival: compartilhe só se ele topar; a escolha fica na conta e ele não é avisado, a não ser que os dois se escolham)', /onclick="openMjRival\(\)"[^>]*>📤 Compartilhar comparação<\/button>/.test(m) && /onclick="rivalChange\(\)"[^>]*>Trocar rival<\/button>/.test(m) && /onclick="rivalRemove\(\)"[^>]*>Remover rival<\/button>/.test(m) && /A imagem mostra o nome do seu rival: compartilhe só se ele topar a brincadeira\. A escolha do rival fica guardada na sua conta \(só você vê\) e ele não é avisado, a não ser que vocês dois se escolham\./.test(m));
  check('frases da comparação: na frente ("Você está 2 conquistas na frente!" em verde), "1 conquista" no singular e "Empate!"', (() => { const g = makeEnv(); g.api.rivalSet('gil'); g.env.st.modal = { type: 'rival', picking: false }; const h = g.api.mRival(); const b1 = makeEnv(); b1.api.rivalSet('carla_dias'); b1.env.st.modal = { type: 'rival', picking: false }; const em = makeEnv(); em.api.rivalSet('bruno'); em.env.st.modal = { type: 'rival', picking: false }; return /Você está 2 conquistas na frente!/.test(h) && /color:var\(--accent\);margin-bottom:4px">Você está/.test(h) && /está 1 conquista na frente/.test(b1.api.mRival()) && /Empate!/.test(em.api.mRival()); })());
  check('grupo vazio mostra "Nenhuma": quem não tem conquista nenhuma comparado comigo', (() => { const z = makeEnv(); z.api.rivalSet('eder_alvaro'); z.env.st.modal = { type: 'rival', picking: false }; const h = z.api.mRival(); return /Só Éder Álvaro tem \(0\)<\/div><div[^>]*>Nenhuma</.test(h) && /Os dois têm \(0\)<\/div><div[^>]*>Nenhuma</.test(h); })());
  check('se o rival sumiu (renomeado, anonimizado ou removido) a janela volta para a escolha em vez de quebrar', (() => { const z = makeEnv(); z.api.rivalSet('fulano_de_tal'); z.env.st.modal = { type: 'rival', picking: false }; const h = z.api.mRival(); return /A escolha fica guardada na sua conta/.test(h) && !/Compartilhar comparação/.test(h); })());
  // ações
  e = makeEnv(); e.env.st.modal = { type: 'rival', picking: true };
  e.api.rivalPick('xxx'); e.api.rivalPick('ana_maria_souza'); e.api.rivalPick('zeca'); e.api.rivalPick(undefined); e.api.rivalPick("bruno'); alert(1); ('");
  check('escolher alguém que não é candidato (eu, inativo, que não existe, texto estranho): ignora, não guarda nada e não redesenha', e.store.size === 0 && e.calls.renders === 0 && e.api.rivalGet() === '');
  e.api.rivalPick('bruno');
  check('escolher o Bruno: guarda, passa da escolha para a comparação e redesenha', e.api.rivalGet() === 'bruno' && e.env.st.modal.type === 'rival' && e.env.st.modal.picking === false && e.calls.renders === 1 && e.store.size === 0 && e.env.st.rivalDoc.rivalKey === 'bruno');
  e.api.rivalChange();
  check('Trocar rival: volta para a lista (sem apagar a escolha até escolher outro) e redesenha', e.env.st.modal.picking === true && e.api.rivalGet() === 'bruno' && e.calls.renders === 2);
  e.api.rivalRemove();
  check('Remover rival: tira a escolha, vai para a lista e redesenha', e.api.rivalGet() === '' && e.store.size === 0 && e.env.st.modal.picking === true && e.calls.renders === 3);
  const rm = makeEnv(); rm.api.rivalSet('bruno'); rm.env.st.modal = { type: 'rival', picking: false }; rm.api.rivalRemove();
  check('Remover rival na tela da comparação: apaga a escolha, já mostra a lista de escolha (picking) e redesenha', rm.api.rivalGet() === '' && rm.env.st.modal.picking === true && rm.calls.renders === 1);
  const z0 = makeEnv(); z0.env.st.modal = { type: 'badgeInfo' }; z0.api.rivalChange();
  check('Trocar rival com outra janela aberta: não mexe em nada', z0.env.st.modal.type === 'badgeInfo' && z0.calls.renders === 0);
  const fz = makeEnv(); fz.rows.push({ dataset: { rname: 'bruno' }, style: { display: '' } }, { dataset: { rname: 'carla dias' }, style: { display: '' } }, { dataset: { rname: 'éder álvaro' }, style: { display: '' } });
  const vis = () => fz.rows.filter(x => x.style.display !== 'none').map(x => x.dataset.rname).join();
  fz.api.rivalFilter('CA'); const v1 = vis(); fz.api.rivalFilter('  éd '); const v2 = vis(); fz.api.rivalFilter('zzz'); const v3 = vis(); fz.api.rivalFilter(''); const v4 = vis(); fz.api.rivalFilter(undefined); const v5 = vis(); fz.api.rivalFilter('br'); const v6 = vis();
  check('a busca só esconde e mostra as linhas (sem redesenhar): sem diferença entre maiúscula e minúscula, ignora espaços nas pontas, vazio mostra todos', v1 === 'carla dias' && v2 === 'éder álvaro' && v3 === '' && v4 === 'bruno,carla dias,éder álvaro' && v5 === v4 && v6 === 'bruno' && fz.calls.renders === 0, [v1, v2, v3, v4, v5, v6]);

  // ══ 7. COMPARTILHAR ═══════════════════════════════════════════════════════════════════════════════
  e = makeEnv(); e.api.rivalSet('bruno'); e.env.st.modal = { type: 'rival', picking: false };
  const op = e.api.openMjRival();
  check('Compartilhar comparação: fecha a janela do rival, redesenha e abre a janela dos cartões ("📤 Eu × meu rival", "Montando a comparação…"), contando a abertura (cardOpen)', e.env.st.modal === null && e.calls.renders === 1 && e.layers.length === 1 && /📤 Eu × meu rival/.test(e.layers[0].innerHTML) && /Montando a comparação…/.test(e.layers[0].innerHTML) && e.api.getKind() === 'rival' && JSON.stringify(e.calls.events) === JSON.stringify([['cardOpen', true]]), { ev: e.calls.events, kind: e.api.getKind() });
  await op;
  const ctxF = e.calls.canvases[0].ctx, ctxS = e.calls.canvases[1].ctx;
  check('pronto: duas imagens (Feed 1080×1350 e Story 1080×1920) com os meus dados e os do rival: nomes, números, grupos; a minha foto (do aparelho) e só as iniciais do rival; empate = verde', e.calls.canvases.length === 2 && e.calls.canvases[0].height === 1350 && e.calls.canvases[1].height === 1920 && ['ANA MARIA SOUZA', 'BRUNO', 'Série B Aceoma', 'Empatados!', 'SÓ EU TENHO (2)', 'OS DOIS TÊM (2)'].every(t => said(ctxF).includes(t)) && ctxF.strokes[0].color === COLORS.common && ctxS.strokes[0].color === COLORS.common && ctxF.images.some(i => i.img && i.img.__photo) && ctxF.images.filter(i => i.img && i.img.__photo).length === 1 && said(ctxF).includes('B'), said(ctxF));
  check('o alt da prévia fala da comparação e os botões são os de sempre (Compartilhar, Copiar legenda, Baixar)', /alt="Comparação de conquistas com o meu rival no Pelada na Mão, formato Story"/.test(e.layers[0].innerHTML) && /shareMjCard\(\)/.test(e.layers[0].innerHTML) && /copyMjCaption\(\)/.test(e.layers[0].innerHTML) && /downloadMjCard\(\)/.test(e.layers[0].innerHTML));
  await e.api.shareMjCard(); const sh = e.calls.shared[0];
  check('compartilhar no Story: arquivo rival-pelada-na-mao-story.png, título "Eu x meu rival no Pelada na Mão" e o texto só com os números e o link ?ref=cartao (sem nenhum nome); conta cardShare', sh.files[0].name === 'rival-pelada-na-mao-story.png' && sh.title === 'Eu x meu rival no Pelada na Mão' && sh.text === `Eu 4 x 4 do meu rival em conquistas no Pelada na Mão ⚔️ Faça a liga da sua pelada: ${LINK}` && !/Ana|Bruno|Série/.test(sh.text) && JSON.stringify(e.calls.events.slice(-1)) === JSON.stringify([['cardShare', false]]), sh);
  e.api.setMjFormat('feed'); await e.api.shareMjCard();
  check('no Feed: arquivo rival-pelada-na-mao.png (a imagem de 1350 px)', e.calls.shared[1].files[0].name === 'rival-pelada-na-mao.png' && (await e.calls.shared[1].files[0].text()) === 'png1350');
  await e.api.copyMjCaption();
  check('Copiar legenda: a do rival (4 linhas, "4 x 4 em conquistas: Empatados!"), sem nome nenhum', e.calls.copied[0] === `Eu x meu rival no Pelada na Mão ⚔️\n4 x 4 em conquistas: Empatados!\nQuem tem mais na sua pelada? Crie a liga: ${LINK}\n#pelada #futebolamador #peladanamao` && !/Ana|Bruno|Série/.test(e.calls.copied[0]));
  e.api.downloadMjCard();
  check('baixar: rival-pelada-na-mao.png (o Feed está escolhido)', e.calls.clicks.length === 1 && e.calls.clicks[0].download === 'rival-pelada-na-mao.png');
  check('sem rival ou na simulação do admin: Compartilhar comparação não abre nada nem conta', (async () => true) && (() => { const z = makeEnv(); const p = z.api.openMjRival(); const z2 = makeEnv({ sim: 'carla_dias' }); z2.api.rivalSet('bruno'); z2.api.openMjRival(); return p === undefined && z.layers.length === 0 && z.calls.events.length === 0 && z.calls.renders === 0 && z2.layers.length === 0 && z2.calls.events.length === 0; })());
  const ahead = makeEnv(); ahead.api.rivalSet('gil'); await ahead.api.openMjRival();
  check('na frente (eu 4 x 2 do Gil): cartão dourado e a frase "Estou 2 conquistas na frente!" no cartão e na legenda', ahead.calls.canvases[0].ctx.strokes[0].color === COLORS.legendary && said(ahead.calls.canvases[0].ctx).includes('Estou 2 conquistas na frente!') && (await (async () => { await ahead.api.copyMjCaption(); return /4 x 2 em conquistas: Estou 2 conquistas na frente!/.test(ahead.calls.copied[0]); })()));
  const atras = makeEnv(); atras.api.rivalSet('carla_dias'); await atras.api.openMjRival();
  check('atrás (eu 4 x 5 da Carla): cartão azul e "Meu rival está 1 conquista na frente"', atras.calls.canvases[0].ctx.strokes[0].color === COLORS.rare && said(atras.calls.canvases[0].ctx).includes('Meu rival está 1 conquista na frente'));
  const e3 = makeEnv({ canShare: false }); e3.api.rivalSet('bruno'); await e3.api.openMjRival(); await e3.api.shareMjCard();
  check('computador (sem compartilhar arquivo): baixa a imagem do rival em vez de ficar parado', e3.calls.shared.length === 0 && e3.calls.clicks.length === 1 && e3.calls.clicks[0].download === 'rival-pelada-na-mao-story.png');

  // ══ 8. O CÁLCULO DAS CONQUISTAS DE TODOS OS JOGADORES ═════════════════════════════════════════════
  const statsApi = (players, champs) => { const env2 = { st: { players, champs, ranks: [], finMens: {}, finCfg: {}, rivalPublic: {} }, getChampAwards: () => null, computeAwardStats: () => ({ posAwards: 0, negAwards: 0, hasCarregado: false, hasCraqueTimePequeno: false }), getPaid: () => false, getPaidDate: () => null }; const n2 = Object.keys(env2); return new Function(...n2, keyCode + '\n' + streakCode + '\n' + h2hCode + '\n' + pubCode + '\n' + statsCode + '\nreturn { computePlayerBadgeStats };')(...n2.map(x => env2[x])); };
  const camp = (date, roster, o = {}) => ({ id: 'c' + date, date, status: 'completed', freeMode: false, churrasco: !!o.churrasco, teamRosters: { azul: roster, verde: ['Zé'] }, matches: [{ phase: 'regular', played: true, home: 'azul', away: 'verde', hs: 1, as: 0, goals: [{ player: 'Zé' }] }] });
  const S2 = (champs, nome = 'Ana') => statsApi([{ name: 'Ana' }, { name: 'Zé' }], champs).computePlayerBadgeStats(nome);
  const cs = [camp('2026-09-09', ['Ana'], { churrasco: true }), camp('2026-09-16', ['Ana']), camp('2026-09-23', ['Ana'], { churrasco: true }), camp('2026-09-30', ['Zé'], { churrasco: true })];
  check('o cálculo de todos os jogadores passa a contar os campeonatos com churrasco em que o jogador esteve no elenco (attendedChurrascoChamps): 2 de 4 para a Ana, 1 para o Zé, 0 para quem não jogou', S2(cs).attendedChurrascoChamps === 2 && S2(cs, 'Zé').attendedChurrascoChamps === 3 && S2(cs, 'Fulano').attendedChurrascoChamps === 0, [S2(cs).attendedChurrascoChamps, S2(cs, 'Zé').attendedChurrascoChamps]);
  check('só conta campeonato concluído, fora do plano gratuito e a partir de 08/09/2026; sem elenco registrado não conta', S2([camp('2026-09-01', ['Ana'], { churrasco: true })]).attendedChurrascoChamps === 0 && S2([{ ...camp('2026-09-09', ['Ana'], { churrasco: true }), freeMode: true }]).attendedChurrascoChamps === 0 && S2([{ ...camp('2026-09-09', ['Ana'], { churrasco: true }), status: 'active' }]).attendedChurrascoChamps === 0 && S2([{ ...camp('2026-09-09', ['Ana'], { churrasco: true }), teamRosters: undefined }]).attendedChurrascoChamps === 0 && S2([camp('2026-09-08', ['Ana'], { churrasco: true })]).attendedChurrascoChamps === 1);
  const catSrc = slice('const BADGE_CATALOG = [', '\n];');
  const usados = new Set([...catSrc.matchAll(/\bs\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(x => x[1]));
  const devolvidos = Object.keys(S2(cs));
  const faltam = [...usados].filter(k => !devolvidos.includes(k));
  check(`PARIDADE: toda estatística que alguma conquista do catálogo lê (${usados.size} no total) é devolvida pelo cálculo de todos os jogadores (o que a comparação e as listas de "quem tem" usam); faltando uma, a conquista nunca apareceria para os outros`, usados.size > 30 && faltam.length === 0, faltam);
  const soComer = new Function('return (' + html.match(/^ {2}\{ id:'so_comer'.*\},$/m)[0].trim().replace(/,$/, '').replace(/visible:[^,]+,\s*/, '').replace(/icon:'[^']*'/, "icon:''") + ')')();
  const poucos = [camp('2026-09-09', ['Ana'], { churrasco: true }), camp('2026-09-16', ['Zé']), camp('2026-09-23', ['Zé']), camp('2026-09-30', ['Zé']), camp('2026-10-07', ['Zé'])]; // Ana jogou 1 de 5 (20%), no do churrasco
  check('a conquista "Só vim pra comer" já sai pelo cálculo de todos: foi em churrasco e tem menos de 60% de presença (1 de 5 = 20%); não sai com 3 de 4 (75%) nem sem ter ido a churrasco', soComer.check(S2(poucos)) === true && soComer.check(S2(cs)) === false && soComer.check(S2([camp('2026-09-09', ['Ana']), camp('2026-09-16', ['Zé']), camp('2026-09-23', ['Zé']), camp('2026-09-30', ['Zé']), camp('2026-10-07', ['Zé'])])) === false, [S2(poucos).attendedChurrascoChamps, S2(poucos).champsPlayedCutoff, S2(poucos).done_count]);

  // ══ 9. COMO ESTÁ LIGADO NO APP ════════════════════════════════════════════════════════════════════
  const view = html.slice(html.indexOf('function vMeuJogador()'), html.indexOf('function vSelectLeague()') > html.indexOf('function vMeuJogador()') ? html.indexOf('function vSelectLeague()') : html.length);
  check('a faixa do rival fica dentro do card Conquistas, entre o cabeçalho e a grade de conquistas, e recebe se o admin está simulando', /<\/div>\s*\$\{rivalStrip\(isSimulating\)\}\s*<div style="display:flex;flex-wrap:wrap;gap:8px;padding:14px">\s*\$\{\[\.\.\.earnedBadges\.map/.test(view) && (view.match(/\$\{rivalStrip\(/g) || []).length === 1, view.match(/.{60}rivalStrip.{60}/)?.[0]);
  check('a janela do rival entra na lista de janelas do app (junto da janela da conquista)', /\+mBadgeInfo\(\)\+mRival\(\)\+mVote\(\)/.test(html));
  const semComentarios = rivalCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const migra = (semComentarios.match(/function rivalMigrateLocal\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  check('o rival só fala com o servidor pelas três funções dele (setRival, saveRivalProgress e syncRivals), sem contar evento: o bloco não usa DB direto, fetch, trackEvent nem Firebase', [...semComentarios.matchAll(/callFn\('([A-Za-z]+)'/g)].map(x => x[1]).sort().join() === 'saveRivalProgress,setRival,syncRivals' && (semComentarios.match(/callFn\(/g) || []).length === 3 && !/DB\.|fetch\(|trackEvent|firebase|firestore|XMLHttp|sendBeacon/i.test(semComentarios));
  check('o aparelho (localStorage) só é usado para levar a escolha ANTIGA ao servidor: o bloco lê e apaga a chave antiga lá dentro (rivalMigrateLocal) e em mais nenhum lugar', !!migra && /localStorage\.getItem\(RIVAL_STORE/.test(migra) && /localStorage\.setItem\(RIVAL_STORE/.test(migra) && !/localStorage/.test(semComentarios.replace(migra, '')), migra.length);
  check('PRIVACIDADE: o bloco do rival não cita e-mail, WhatsApp nem contatos; a conta aparece só na chave da guarda (rivalStoreKey)', !/whatsapp|e-?mail|contacts|waOf/i.test(semComentarios) && semComentarios.split('\n').filter(l => /authUser/.test(l)).every(l => /^const rivalStoreKey = \(\) => \(st\.authUser\?\.uid/.test(l.trim())) && /const rivalStoreKey = \(\) => \(st\.authUser\?\.uid/.test(semComentarios));
  check('PRIVACIDADE: o código do cartão do rival (dados, desenho, legenda) nem cita e-mail, WhatsApp, contatos nem a conta logada', (() => { const s = slice('function mjRivalData', 'function mjRoundRect') + slice('function drawMjRivalCard', 'function mjLoadImage') + slice('function mjRivalCaption', 'async function copyMjCaption'); return !/whatsapp|e-?mail|contacts|authUser|waOf|\.uid/i.test(s); })());
  check('nenhum contador novo no servidor: o módulo do cartão continua só com cardOpen e cardShare e um único link (?ref=cartao)', JSON.stringify([...new Set([...code.matchAll(/trackEvent\('([A-Za-z]+)'/g)].map(x => x[1]))].sort()) === JSON.stringify(['cardOpen', 'cardShare']) && (code.match(/\?ref=/g) || []).length === 1);
  check('a política de privacidade do app cita o rival (guardado na conta, no servidor, só a pessoa vê, o rival não é avisado, o Alvo da Galera sem dizer quem, o que a liga vê, os números usados, o nome do rival na imagem compartilhada e o que some ao sair)', /<strong>Rival:<\/strong> se você escolher um rival, a escolha \(quem é o seu rival e desde quando\) fica guardada na sua conta, no servidor, e só você a vê: nem o admin nem o seu rival \(ele não é avisado\)\. Se vocês dois se escolherem, o app avisa os dois; se 3 ou mais jogadores escolherem a mesma pessoa, ela ganha a conquista "Alvo da Galera" \(e com 7 ou mais, a "Inimigo Público"\), sem dizer quem escolheu\./.test(html) && /a liga vê só as conquistas que isso gera \(por exemplo "Passei o Trator"\), nunca quem era o rival\./.test(html) && /A comparação usa o que a liga já mostra para todos os jogadores: as conquistas e os números de cada um \(títulos, campeonatos, gols, vezes artilheiro, presença, destaques da votação, nota do grupo e as vitórias, empates e derrotas dos times em que jogou\) e, no frente a frente, os jogos em que os dois estavam em times opostos\./.test(html) && /Se você compartilhar a imagem da comparação ou do duelo, ela leva o nome do seu rival\./.test(html) && /Ao sair da liga ou excluir a conta, a sua escolha e o seu histórico de duelos são apagados/.test(html));

  // ══ 10. MANUAL ════════════════════════════════════════════════════════════════════════════════════
  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(').trim();
  const sec13 = plainM(manual.slice(manual.indexOf('<h3 id="rival">'), manual.indexOf('<h3>Modo de teste (admin)</h3>')));
  const sec29 = plainM(manual.slice(manual.indexOf('id="cartao-jogador"'), manual.indexOf('<!-- 30. Página de Apresentação')));
  const sec29r = sec29.slice(sec29.indexOf('Cartão "Eu × meu rival"'), sec29.indexOf('Cartão "Meus números × rival"')); // só o parágrafo do cartão das conquistas (o dos números, logo abaixo, tem frases parecidas)
  check('manual (seção 13): a faixa no card Conquistas, Escolher rival, a busca, o placar, os três grupos com a cor do nível e os botões (Compartilhar comparação, Trocar rival, Remover rival)', /Compare as suas conquistas e os seus números com os de um rival da liga/.test(sec13) && /Escolher rival/.test(sec13) && /busca por nome/.test(sec13) && /Você 14 × 11 Fulano/.test(sec13) && /Só você tem, Só o rival tem e Os dois têm/.test(sec13) && /da mais rara para a mais comum/.test(sec13) && /Compartilhar comparação, Trocar rival e Remover rival/.test(sec13), sec13.slice(0, 300));
  check('manual (seção 13): privacidade (na conta, no servidor, só a pessoa lê, o rival não é avisado; Alvo da Galera sem dizer quem; o que a liga vê; apagados ao sair, ser recusado ou excluir; não aparece em "Ver como") e a correção do "Só vim pra comer"', /fica guardada na sua conta, no servidor/.test(sec13) && /só você a lê: nem o admin, nem o rival, nem o dono do sistema pelo app/.test(sec13) && /O rival não é avisado; só quando os dois se escolhem/.test(sec13) && /Alvo da Galera \(3 ou mais escolhas\) e o Inimigo Público \(7 ou mais\) nunca dizem quem escolheu/.test(sec13) && /nunca quem era o rival nem os números do duelo/.test(sec13) && /tem a escolha e o histórico de duelos apagados/.test(sec13) && /não aparecem quando o admin usa "👁 Ver como"/.test(sec13) && /attendedChurrascoChamps/.test(sec13) && /Só vim pra comer nunca aparecia na lista de quem a tem; agora aparece/.test(sec13) && /rivalDiff/.test(sec13), sec13.slice(-600));
  check('manual (seção 29): o arquivo e a legenda do cartão do rival na tabela e a explicação do cartão (lado a lado, iniciais do rival e nunca a foto, placar, três grupos até 9 ícones com "+N", cores dourado/azul/verde, legenda sem nome)', /Eu × meu rival rival-pelada-na-mao-story\.png \/ rival-pelada-na-mao\.png/.test(sec29) && /Cartão "Eu × meu rival"/.test(sec29) && sec29r.startsWith('Cartão "Eu × meu rival"') && /iniciais do rival, nunca a foto dele/.test(sec29r) && /até 9 ícones por grupo; acima disso o último vira "\+N"/.test(sec29r) && /dourado quando estou na frente, azul quando o rival está e verde no empate/.test(sec29r) && /sem nome nenhum/.test(sec29r) && /compartilhar só se ele topar a brincadeira/.test(sec29r) && /rivalCompare/.test(sec29r) && /mjRivalData/.test(sec29r) && /drawMjRivalCard/.test(sec29r), sec29.match(/Cartão "Eu × meu rival".{0,300}/)?.[0]);
  check('manual (seção 29): os três grupos do cartão do rival são "só eu", "só o meu rival" e "os dois" (masculino, como o cartão e a janela), nunca "as duas"', /só eu, só o meu rival e os dois \(até 9 ícones por grupo/.test(sec29) && !/as duas/i.test(sec29.slice(sec29.indexOf('Cartão "Eu × meu rival"'), sec29.indexOf('Cartão "Meus números × rival"'))), sec29.match(/três grupos.{0,120}/)?.[0]);
  check('manual × código: os nomes de arquivo do manual são os do código; o limite de 9 ícones por grupo e as cores do placar batem com o desenho', ['rival-pelada-na-mao-story.png', 'rival-pelada-na-mao.png'].every(f => manual.includes('<code>' + f + '</code>') && Object.values(A.MJ_KINDS.rival.file).includes(f)) && /n > 9 \? list\.slice\(0, 8\) : list/.test(rivalCode.length ? code : '') && /status === 'ahead' \? 'legendary' : status === 'behind' \? 'rare' : 'common'/.test(code));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
