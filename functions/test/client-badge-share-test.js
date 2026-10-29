// Compartilhar conquistas como imagem (index.html): extrai o código real e o executa num ambiente simulado, sem navegador.
// Três cartões saem da aba EU, só no PRÓPRIO perfil (nunca na simulação do admin): o de UMA conquista (janela da conquista e aviso de conquista nova), o de
// "Minhas conquistas" (todas as do jogador) e o de "Conquistas novas". A cor do cartão segue a RARIDADE da conquista na liga (lendária dourado, épica roxo, rara
// azul, comum verde). Tudo é montado no aparelho, em Story e Feed, e só sai dele se a pessoa compartilhar.
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
const bannerCode = slice('// Conquistas novas ainda sem compartilhar.', 'function dismissNotifBanner() {');
const eligCode = slice('function badgeEligibleCount(b) {', 'function getPlayerRarestBadge(');
const escCode = slice('const esc = s =>', 'function toast(');
const modalCode = slice('function mBadgeInfo() {', 'function closeModal()');

// ── contexto de desenho falso: guarda o que foi desenhado e mede texto como "0,5 × tamanho da fonte por letra" ──
function fakeCtx() {
  const ctx = { texts: [], images: [], strokes: [], fills: [], fillRects: [], radials: [], stops: [], arcs: [], k: 1, tx: 0, ty: 0, stack: [], clips: 0, saves: 0, restores: 0, font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: 'left', textBaseline: 'alphabetic' };
  const size = () => Number((/(\d+)px/.exec(ctx.font) || [0, 16])[1]);
  const noop = () => {};
  Object.assign(ctx, {
    closePath: noop, moveTo: noop, arcTo: noop, rect: noop,
    beginPath() { ctx._last = null; }, // o círculo desenhado por último: a cor dele é a do fill() que vem depois
    arc(x, y, r) { const a = { x, y, r, fill: null }; ctx.arcs.push(a); ctx._last = a; },
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

// ── ambiente do aplicativo falso ────────────────────────────────────────────────────────────────
const CATALOG = [
  { id: 'pipoca', emoji: '🍿', label: 'Pipoca', desc: 'Vice-campeão em 3 campeonatos consecutivos', fieldOnly: true },
  { id: 'tafarel', emoji: '🙏', label: 'Tafarel', desc: 'Campeão em final decidida nos pênaltis', gkOnly: true },
  { id: 'alex', emoji: '🏆', label: 'Maior Campeão', desc: 'Conquista única', specialFor: ['Ana'] },
];
function makeEnv({ canShare = true, shareImpl, imageFails = [], toBlobFailsWithPhoto = false, toBlobAlwaysFails = false, copyOk = true, storage = {}, storageThrows = false, now = 1_700_000_000_000, holders = {} } = {}) {
  const calls = { events: [], toasts: [], shared: [], clicks: [], revoked: [], canvases: [], copied: [], urlBlobs: new Map(), renders: 0 };
  let urlN = 0;
  const fakeUrl = { createObjectURL: b => { const u = `blob:teste/${++urlN}-${b.size}`; calls.urlBlobs.set(u, b); return u; }, revokeObjectURL: u => { calls.revoked.push(u); } };
  const layers = [];
  const doc = {
    fonts: { load: async () => [] },
    getElementById: id => layers.find(x => x.id === id) || null,
    createElement: tag => {
      if (tag === 'canvas') {
        const cv = { width: 0, height: 0, ctx: fakeCtx(), getContext() { return cv.ctx; },
          toBlob(cb) { const drewPhoto = cv.ctx.images.some(i => i.img && i.img.__photo); setTimeout(() => cb(toBlobAlwaysFails || (toBlobFailsWithPhoto && drewPhoto) ? null : new Blob(['png' + cv.height], { type: 'image/png' })), 0); } };
        calls.canvases.push(cv); return cv;
      }
      if (tag === 'a') { const a = { href: '', download: '', click() { calls.clicks.push({ href: a.href, download: a.download }); }, remove() {} }; return a; }
      const el = { id: '', className: '', innerHTML: '', remove() { const i = layers.indexOf(el); if (i >= 0) layers.splice(i, 1); } }; return el;
    },
    body: { appendChild: el => { if (el.id) layers.push(el); } },
  };
  class FakeImage {
    set src(v) { this._src = v; setTimeout(() => { if (imageFails.some(f => String(v).includes(f))) this.onerror?.(); else { this.naturalWidth = 400; this.naturalHeight = 300; this.__photo = !String(v).includes('logo'); this.onload?.(); } }, 0); }
    get src() { return this._src; }
  }
  const nav = { share: async d => { calls.shared.push(d); if (shareImpl) return shareImpl(d); }, canShare: () => canShare };
  const clock = { t: now };
  const store = new Map(Object.entries(storage));
  const localStorage = {
    getItem: k => { if (storageThrows) throw new Error('bloqueado'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('bloqueado'); store.set(k, String(v)); },
  };
  const env = {
    st: { _mjCard: null, _mjShare: null, authUser: { uid: 'u1' }, leagueId: 'liga1', players: [], modal: null },
    document: doc, navigator: nav, Image: FakeImage, URL: fakeUrl, pixCopyText: async t => { calls.copied.push(t); return copyOk; },
    trackEvent: (n, once = true) => { calls.events.push([n, once]); },
    toast: (m, t) => { calls.toasts.push([m, t]); },
    localStorage, render: () => { calls.renders++; }, Date: { now: () => clock.t },
    BADGE_CATALOG: CATALOG, getBadgeCache: () => ({ badgeHolders: holders }), mhHolderNote: () => '',
  };
  const names = Object.keys(env);
  const body = escCode + '\n' + code + '\n' + bannerCode + '\n' + eligCode + '\n' + modalCode + `
return { MJ_CARD, MJ_STORY, MJ_FORMATS, MJ_TIERS, MJ_TIER_ORDER, MJ_KINDS, mjTierOf, mjByRarity, mjCardData, mjBadgeData, mjBadgesData, mjGridLayout, mjWrapText, mjTitleLines,
  drawMjBackground, drawMjCard, drawMjStory, drawMjStoryOf, drawMjBadgeCard, drawMjBadgeStory, drawMjBadgesCard, drawMjBadgesStory, renderMjCard, openMjCard, openMjShare, openMjBadge, openMjBadges,
  closeMjCard, setMjFormat, downloadMjCard, shareMjCard, copyMjCaption, mjCaption, mjBadgeCaption, mjBadgesCaption, getKind: () => _mjKind, getData: () => _mjData, getBlobs: () => _mjBlobs,
  getUrls: () => _mjUrls, getFormat: () => _mjFormat, NEW_BADGES_STORE, NEW_BADGES_TTL, newBadgesKey, newBadgesRead, newBadgesWrite, newBadgeIds, newBadgesAdd, dismissNewBadges, shareNewBadges,
  newBadgesBanner, badgeEligibleCount, mBadgeInfo };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, layers, store, clock };
}

const tick = () => new Promise(r => setTimeout(r, 15));
const W = 1080, H = 1350;
const { api: A } = makeEnv();
const logo = { naturalWidth: 1024, naturalHeight: 1024 }, photo = { naturalWidth: 400, naturalHeight: 300, __photo: true };
const PLAYER = { name: 'Ana Maria Souza', league: 'Série B Aceoma' };
const B = (id, emoji, label, desc, holders, eligible) => ({ id, emoji, label, desc, holders, eligible });
// da mais rara para a mais comum: lendária (1 de 14), épica (2 de 20 = 10%), rara (4 de 14 = 29%), comum (11 de 14 = 79%)
const EARNED = [B('pipoca', '🍿', 'Pipoca', 'Vice-campeão em 3 campeonatos consecutivos', 1, 14), B('baggio', '😭', 'Baggio', 'Perdeu pênalti na final e o título foi embora junto', 2, 20), B('invicto', '🛡️', 'Invicto', 'Campeão sem perder nenhum jogo', 4, 14), B('campeao', '🏆', 'Campeão', 'Pelo menos 1 título inteiro', 11, 14)];
const SHARE = () => ({ name: PLAYER.name, league: PLAYER.league, photo: '', total: 58, earned: EARNED.map(b => ({ ...b })) });
const said = ctx => ctx.texts.map(t => t.text);
const LINK = 'https://peladanamao.com.br/?ref=cartao';
const COLORS = { legendary: '#f0b429', epic: '#b06eff', rare: '#4db8ff', common: '#00d67f' };

(async () => {
  // ══ 1. RARIDADE ═══════════════════════════════════════════════════════════════════════════════════
  const T = A.MJ_TIERS;
  check('4 níveis de raridade, da mais rara para a mais comum (lendária, épica, rara, comum), cada um com nome, cor, fundo e brilho próprios', JSON.stringify(A.MJ_TIER_ORDER) === JSON.stringify(['legendary', 'epic', 'rare', 'common']) && Object.keys(T).length === 4 && A.MJ_TIER_ORDER.every(k => T[k].name && T[k].label && T[k].color && T[k].bg && T[k].glow) && new Set(A.MJ_TIER_ORDER.map(k => T[k].color)).size === 4 && new Set(A.MJ_TIER_ORDER.map(k => T[k].bg)).size === 4, T);
  check('as cores: lendária dourado, épica roxo, rara azul, comum verde (as cores da marca e as do próprio app); nomes LENDÁRIA, ÉPICA, RARA e COMUM', A.MJ_TIER_ORDER.every(k => T[k].color === COLORS[k]) && T.legendary.name === 'LENDÁRIA' && T.epic.name === 'ÉPICA' && T.rare.name === 'RARA' && T.common.name === 'COMUM' && T.epic.label === 'Épica', T);
  const tiers = [[[1, 1], 'legendary'], [[1, 14], 'legendary'], [[1, 0], 'legendary'], [['1', '14'], 'legendary'], [[0, 14], 'common'], [[0, 0], 'common'],
    [[2, 20], 'epic'], [[3, 20], 'epic'], [[4, 20], 'rare'], [[7, 20], 'rare'], [[8, 20], 'common'], [[2, 14], 'epic'], [[3, 14], 'rare'], [[4, 14], 'rare'], [[5, 14], 'common'],
    [[5, 0], 'common'], [[5, undefined], 'common'], [[3, 2], 'common'], [[NaN, 5], 'common'], [[-2, 5], 'common'], [['x', 'y'], 'common'], [[2.4, 20], 'epic'], [[2.6, 20], 'epic'], [[null, null], 'common'], [[12, 12], 'common']];
  const errTier = tiers.filter(([[h, e], want]) => A.mjTierOf(h, e) !== want).map(([a, want]) => [a, want, A.mjTierOf(...a)]);
  check('raridade pela fatia dos que podem ter: só 1 jogador = lendária (qualquer base); até 15% = épica; até 35% = rara; o resto = comum (limites inclusos: 3 de 20 é épica, 7 de 20 é rara)', errTier.length === 0, errTier);
  check('raridade com dados ruins (texto, vazio, negativo, NaN, sem base): nunca quebra e cai em comum', ['x', null, undefined, NaN, -5, {}, []].every(v => A.mjTierOf(v, v) === 'common'));
  const unsorted = [{ label: 'Z', holders: 5, eligible: 20 }, { label: 'A', holders: 1, eligible: 20 }, { label: 'C', holders: 3, eligible: 20 }, { label: 'B', holders: 3, eligible: 20 }, { label: 'D', holders: 2, eligible: 20 }, { label: 'Y', holders: 12, eligible: 20 }];
  const keep = JSON.stringify(unsorted);
  check('ordem por raridade: primeiro o nível, depois quantos jogadores têm, depois o nome; não mexe na lista original', A.mjByRarity(unsorted).map(b => b.label).join('') === 'ADBCZY' && JSON.stringify(unsorted) === keep && A.mjByRarity([]).length === 0 && A.mjByRarity([{ label: 'só' }]).length === 1);
  check('níveis diferentes com a mesma contagem de jogadores: a base (quantos podem ter) manda (2 de 4 é rara; 2 de 20 é épica)', A.mjByRarity([{ label: 'a', holders: 2, eligible: 4 }, { label: 'b', holders: 2, eligible: 20 }]).map(b => b.label).join('') === 'ba');

  // ── quem pode ter a conquista (a base da raridade e do "% dos elegíveis") ──
  const env0 = makeEnv(); env0.env.st.players = [{ name: 'Ana' }, { name: 'Bia', goleiro: true }, { name: 'Caio' }, { name: 'Dani', goleiro: true }];
  const E = env0.api.badgeEligibleCount;
  check('elegíveis: conquista de linha não conta goleiros, de goleiro só conta goleiros, sem restrição conta todos, exclusiva conta só a pessoa (e 0 se ela não está na liga)', E({ fieldOnly: true }) === 2 && E({ gkOnly: true }) === 2 && E({}) === 4 && E({ specialFor: ['Ana'] }) === 1 && E({ specialFor: ['Zé'] }) === 0 && E({ specialFor: ['Ana', 'Bia'], fieldOnly: true }) === 2);
  env0.env.st.players = undefined;
  check('sem elenco carregado: 0 elegíveis, sem quebrar', E({}) === 0);

  // ══ 2. DADOS DOS CARTÕES ══════════════════════════════════════════════════════════════════════════
  let d = A.mjBadgeData({ ...PLAYER, emoji: '🍿', label: 'Pipoca', desc: 'Vice 3x', holders: 1, eligible: 14 });
  check('dados de UMA conquista: nome, liga, ícone, nome da conquista, regra, quantos têm e a raridade com as cores do nível', d.name === PLAYER.name && d.league === PLAYER.league && d.emoji === '🍿' && d.label === 'Pipoca' && d.desc === 'Vice 3x' && d.holders === 1 && d.tier === 'legendary' && d.tone === T.legendary, d);
  const vazio = A.mjBadgeData({});
  check('sem nada: "Jogador", 🏅, "Conquista", sem liga nem regra, 0 jogadores e raridade comum (nunca quebra)', vazio.name === 'Jogador' && vazio.emoji === '🏅' && vazio.label === 'Conquista' && vazio.league === '' && vazio.desc === '' && vazio.holders === 0 && vazio.tier === 'common' && vazio.tone === T.common, vazio);
  check('textos aparados e números inválidos viram inteiros ≥ 0', (() => { const z = A.mjBadgeData({ name: '  Zé  ', label: '  X  ', holders: -3.4, eligible: 'abc' }); return z.name === 'Zé' && z.label === 'X' && z.holders === 0; })());
  const priv = A.mjBadgeData({ ...PLAYER, emoji: '🍿', label: 'Pipoca', holders: 2, eligible: 20, email: 'ana@x.com', whatsapp: '11999998888', uid: 'abc123', phone: '1133334444' });
  check('PRIVACIDADE: e-mail, WhatsApp, telefone e id de conta que cheguem por engano NÃO entram nos dados do cartão de uma conquista', !/ana@x\.com|11999998888|abc123|1133334444|whatsapp|email/i.test(JSON.stringify(priv)), priv);

  const items = [{ emoji: '🍿', label: 'Pipoca', holders: 1, eligible: 14 }, { emoji: '😭', label: 'Baggio', holders: 2, eligible: 20 }, { emoji: '🛡️', label: 'Invicto', holders: 4, eligible: 14 }, { emoji: '🏆', label: 'Campeão', holders: 11, eligible: 14 }];
  let g = A.mjBadgesData({ ...PLAYER, photo: 'https://res.cloudinary.com/x/foto.jpg', items, count: 4, total: 58 });
  check('dados de VÁRIAS conquistas: nome, liga, iniciais, foto https, modo "todas", itens na ordem recebida com o nível de cada um, contagem e total', g.name === PLAYER.name && g.league === PLAYER.league && g.initials === 'AM' && g.photo === 'https://res.cloudinary.com/x/foto.jpg' && g.mode === 'all' && g.items.map(b => b.label).join() === 'Pipoca,Baggio,Invicto,Campeão' && g.items.map(b => b.tier).join() === 'legendary,epic,rare,common' && g.count === 4 && g.total === 58, g);
  check('a cor do cartão é a da raridade mais alta que aparece nele; "tiers" lista só os níveis presentes, na ordem de raridade', g.tier === 'legendary' && g.tone === T.legendary && g.tiers.join() === 'legendary,epic,rare,common' && A.mjBadgesData({ items: items.slice(1) }).tier === 'epic' && A.mjBadgesData({ items: items.slice(2) }).tier === 'rare' && A.mjBadgesData({ items: items.slice(3) }).tier === 'common' && A.mjBadgesData({ items: [items[3], items[1]] }).tiers.join() === 'epic,common' && A.mjBadgesData({ items: [] }).tier === 'common' && A.mjBadgesData({ items: [] }).tiers.length === 0);
  check('a foto só vale se for https; modo "novas" só quando pedido; itens sem ícone ou sem nome saem; no máximo 200', ['http://x/f.jpg', 'javascript:alert(1)', '/foto.jpg', 'data:image/png;base64,AAAA', 123, null, undefined].every(p => A.mjBadgesData({ items, photo: p }).photo === '') && A.mjBadgesData({ items, mode: 'new' }).mode === 'new' && ['x', null, undefined, 'NEW', 5].every(m => A.mjBadgesData({ items, mode: m }).mode === 'all') && A.mjBadgesData({ items: [...items, { emoji: '', label: 'x' }, { emoji: '⭐' }, null, 7] }).items.length === 4 && A.mjBadgesData({ items: Array.from({ length: 300 }, (_, i) => ({ emoji: '⭐', label: 'B' + i })) }).items.length === 200);
  check('contagem nunca é menor que os itens mostrados (modo "novas": count é o total do jogador); sem nada: "Jogador", iniciais "J", 0 e comum', A.mjBadgesData({ items, count: 1 }).count === 4 && A.mjBadgesData({ items: items.slice(0, 2), mode: 'new', count: 23, total: 58 }).count === 23 && (() => { const z = A.mjBadgesData({}); return z.name === 'Jogador' && z.initials === 'J' && z.items.length === 0 && z.count === 0 && z.total === 0 && z.tier === 'common'; })());
  const privG = A.mjBadgesData({ ...PLAYER, items, email: 'ana@x.com', whatsapp: '11999998888', uid: 'abc123' });
  check('PRIVACIDADE: o cartão de várias conquistas também não leva e-mail, WhatsApp nem id de conta', !/ana@x\.com|11999998888|abc123|whatsapp|email/i.test(JSON.stringify(privG)), privG);

  // ══ 3. GRADE ══════════════════════════════════════════════════════════════════════════════════════
  const LAY = [[1, 3, 110, 30, 210], [3, 3, 110, 30, 210], [4, 4, 92, 26, 184], [8, 4, 92, 26, 184], [9, 4, 80, 24, 168], [12, 4, 80, 24, 168], [13, 5, 60, 22, 144], [20, 5, 60, 22, 144], [21, 8, 62, 0, 94], [48, 8, 62, 0, 94], [200, 8, 62, 0, 94]];
  const errLay = LAY.filter(([n, cols, emoji, label, rowH]) => { const L = A.mjGridLayout(n); return L.cols !== cols || L.emoji !== emoji || L.label !== label || L.rowH !== rowH; }).map(x => x[0]);
  check('grade: até 3 conquistas 3 colunas grandes; até 8 e até 12 em 4 colunas; até 20 em 5 (com o nome embaixo); de 21 em diante só os ícones em 8 colunas', errLay.length === 0, errLay);
  check('a grade sempre cabe na área entre a contagem e a legenda (575 a 1150 px, com 1 px de folga): linhas × altura da linha, de 1 até 200 conquistas (acima de 48 são 48 células: 47 ícones e o "+N")', Array.from({ length: 200 }, (_, i) => i + 1).every(n => { const L = A.mjGridLayout(n), cells = Math.min(n, 48); return Math.ceil(cells / L.cols) * L.rowH <= 576; }));

  // ══ 4. TEXTOS DAS LINHAS ══════════════════════════════════════════════════════════════════════════
  let c0 = fakeCtx(); c0.font = '400 40px X';
  check('quebra de texto: 2 palavras por linha, 3 linhas no máximo, o que sobra fica junto na última, palavra enorme não é partida, vazio = nenhuma linha', JSON.stringify(A.mjWrapText(c0, 'aaa bbb ccc ddd', 160, 3)) === JSON.stringify(['aaa bbb', 'ccc ddd']) && JSON.stringify(A.mjWrapText(c0, 'aaa bbb ccc ddd', 160, 1)) === JSON.stringify(['aaa bbb ccc ddd']) && JSON.stringify(A.mjWrapText(c0, 'aaa bbb ccc ddd eee fff', 160, 2)) === JSON.stringify(['aaa bbb', 'ccc ddd eee fff']) && JSON.stringify(A.mjWrapText(c0, 'x'.repeat(30), 160, 2)) === JSON.stringify(['x'.repeat(30)]) && A.mjWrapText(c0, '', 160, 2).length === 0 && A.mjWrapText(c0, '   ', 160, 2).length === 0);
  const t1 = A.mjTitleLines(fakeCtx(), 'PIPOCA', 940), t2 = A.mjTitleLines(fakeCtx(), 'CAMPEÃO SUPREMO', 940), t3 = A.mjTitleLines(fakeCtx(), 'EU SOU BOM, MEU EMPRESÁRIO QUE É RUIM', 940), t4 = A.mjTitleLines(fakeCtx(), 'PALAVRA '.repeat(30).trim(), 940);
  check('título da conquista: nome curto em 1 linha a 150 px; um pouco maior diminui a fonte (124 px); nome longo vai para 2 linhas de 118 px; nunca passa de 2 linhas', t1.lines.length === 1 && t1.size === 150 && t2.lines.length === 1 && t2.size === 124 && t3.lines.length === 2 && t3.size === 118 && t4.lines.length === 2 && t4.size === 118, { t1, t2, t3, t4: t4.lines.length });

  // ══ 5. CARTÃO DE UMA CONQUISTA ════════════════════════════════════════════════════════════════════
  const sd = (o = {}) => A.mjBadgeData({ ...PLAYER, emoji: '🍿', label: 'Pipoca', desc: 'Vice-campeão em 3 campeonatos consecutivos', holders: 1, eligible: 14, ...o });
  const drawB = (o, fn = 'drawMjBadgeCard', ph = null, lg = logo) => { const x = fakeCtx(); A[fn](x, sd(o), ph, lg); return x; };
  let s = drawB();
  const sy = txt => s.texts.find(t => t.text === txt);
  check('cartão de uma conquista: selo, ícone, faixa com o nível, nome em maiúsculas, regra, destaque de raridade, quem conquistou, liga e o rodapé com o endereço', ['CONQUISTA DESBLOQUEADA', '🍿', 'LENDÁRIA', 'PIPOCA', 'Só você tem na liga!', 'CONQUISTADA POR', 'ANA MARIA SOUZA', 'Série B Aceoma', 'Crie a liga da sua pelada', 'peladanamao.com.br'].every(x => said(s).includes(x)) && /Vice-campeão em 3 campeonatos/.test(said(s).join(' ')) && /consecutivos/.test(said(s).join(' ')), said(s));
  check('o ícone vai no centro do anel (540, 418) e o selo e o nome do jogador ficam centralizados', sy('🍿').x === 540 && sy('🍿').y === 418 && sy('CONQUISTA DESBLOQUEADA').x === 540 && sy('CONQUISTA DESBLOQUEADA').y === 232 && sy('ANA MARIA SOUZA').x === 540 && sy('LENDÁRIA').x === 540, [sy('🍿'), sy('LENDÁRIA')]);
  check('o logo vai no topo, à esquerda, e a liga à direita', s.images.length === 1 && s.images[0].img === logo && s.images[0].args[0] === 56 && s.images[0].args[1] === 44 && sy('Série B Aceoma').align === 'right', s.images.map(i => i.args));
  for (const k of A.MJ_TIER_ORDER) {
    const holdersFor = { legendary: 1, epic: 2, rare: 4, common: 11 }[k], elig = { legendary: 14, epic: 20, rare: 14, common: 14 }[k];
    const x = drawB({ holders: holdersFor, eligible: elig });
    const other = A.MJ_TIER_ORDER.filter(o => o !== k).map(o => COLORS[o]);
    check(`raridade ${T[k].label}: moldura (6 px), anel e faixa na cor ${COLORS[k]}, fundo e brilho do nível, a faixa escreve ${T[k].name} e NENHUMA cor de outro nível aparece`, x.strokes.length === 1 && x.strokes[0].color === COLORS[k] && x.strokes[0].width === 6 && x.arcs[0].fill === COLORS[k] && x.arcs[0].r === 154 && x.arcs[1].fill === '#161b22' && x.arcs[1].r === 140 && x.fills.filter(f => f === COLORS[k]).length === 2 && x.stops.includes(T[k].bg) && x.stops.includes(T[k].glow) && x.texts.some(t => t.text === T[k].name) && !x.texts.some(t => other.includes(t.fill)) && !x.fills.some(f => other.includes(f)) && !x.strokes.some(t => other.includes(t.color)) && !x.stops.some(c => A.MJ_TIER_ORDER.filter(o => o !== k).some(o => c === T[o].bg || c === T[o].glow)), { strokes: x.strokes, arcs: x.arcs, stops: x.stops, fills: x.fills });
  }
  const R = h => said(drawB({ holders: h, eligible: 40 })).filter(t => /Só /.test(t));
  check('destaque de raridade na liga: 1 jogador "Só você tem na liga!", 2 e 3 "Só N jogadores da liga têm", 4 ou mais (ou nenhum) não escreve nada', R(1).join() === 'Só você tem na liga!' && R(2).join() === 'Só 2 jogadores da liga têm' && R(3).join() === 'Só 3 jogadores da liga têm' && R(4).length === 0 && R(0).length === 0 && R(30).length === 0, [R(1), R(2), R(3), R(4)]);
  check('o destaque de raridade usa a cor do nível', drawB({ holders: 2, eligible: 20 }).texts.find(t => /Só 2/.test(t.text)).fill === COLORS.epic && drawB({ holders: 1 }).texts.find(t => /Só você/.test(t.text)).fill === COLORS.legendary);
  const semLogo = drawB({}, 'drawMjBadgeCard', null, null);
  check('sem logo: desenha tudo sem imagem e sem quebrar; sem liga e sem regra: não escreve linha vazia', semLogo.images.length === 0 && semLogo.texts.length > 5 && drawB({ league: '', desc: '' }).texts.every(t => t.text.trim().length > 0) && !drawB({ league: '' }).texts.some(t => t.align === 'right') && !drawB({ desc: '' }).texts.some(t => /Vice/.test(t.text)));
  const cases = [];
  for (const label of ['Pipoca', 'Gols, Glória e... Derrota!', 'Eu sou bom, meu empresário que é ruim', 'Palavra '.repeat(30), 'X'.repeat(120)])
    for (const desc of ['', 'Curta', 'Vice-campeão em 3 campeonatos consecutivos', 'Artilheiro do campeonato, artilheiro da final, campeão e destaque positivo no mesmo campeonato e ainda mais um pouco de texto', 'palavra '.repeat(80)])
      for (const holders of [1, 5]) cases.push({ label: label.trim(), desc: desc.trim(), holders });
  const bad = [], titleBad = [];
  for (const o of cases) {
    const x = drawB(o);
    const body = x.texts.filter(t => t.y > 593 && t.y < 1090).map(t => t.y), lab = x.texts.find(t => t.text === 'CONQUISTADA POR');
    if (!(Math.max(...body) <= 1062 && Math.min(...body) >= 600 && lab.y === 1100) || x.texts.some(t => t.x < 0 || t.x > W || t.y < 0 || t.y > H)) bad.push([o.label.slice(0, 12), o.desc.slice(0, 12), o.holders, Math.min(...body), Math.max(...body)]);
    const titles = x.texts.filter(t => /Bebas/.test(t.font) && t.y > 593 && t.y < 1000);
    if (titles.length < 1 || titles.length > 2 || titles.some(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 > 940)) titleBad.push([o.label.slice(0, 12), titles.length]);
  }
  check(`${cases.length} combinações de nome (curto, médio, 2 linhas, enorme), regra (nenhuma, curta, 2 linhas, enorme) e raridade: o bloco do meio fica entre a faixa (600) e o rótulo "CONQUISTADA POR" (1100), nada passa da imagem`, bad.length === 0, bad.slice(0, 5));
  check('o nome da conquista ocupa no máximo 2 linhas e cada uma cabe nos 940 px (o que passar é cortado com reticências)', titleBad.length === 0, titleBad.slice(0, 5));
  const enorme = drawB({ label: 'X'.repeat(120), desc: 'palavra '.repeat(80) });
  check('nome e regra enormes: terminam em reticências; a regra tem no máximo 3 linhas', enorme.texts.some(t => /Bebas/.test(t.font) && t.text.endsWith('…') && t.y < 1000) && enorme.texts.filter(t => /500 42px/.test(t.font) && t.y > 593 && t.y < 1090).length === 3 && enorme.texts.filter(t => /500 42px/.test(t.font)).slice(-1)[0].text.endsWith('…'), enorme.texts.map(t => [t.text.slice(0, 15), t.y]));
  const nomeEnorme = drawB({ name: 'Fulano de Tal da Silva Sauro Pereira Gonçalves de Albuquerque Junior Neto Filho', league: 'Liga dos Veteranos do Bairro Alto da Boa Vista do Meio do Nada' });
  check('nome do jogador e da liga enormes: encolhem/cortam e ficam dentro da largura', nomeEnorme.texts.filter(t => /FULANO/.test(t.text) || /Liga dos/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= (/FULANO/.test(t.text) ? 900 : 680)));
  // Story
  const S = A.MJ_STORY, kS = (S.H - S.TOP - S.BOTTOM) / A.MJ_CARD.H;
  const sf = drawB({}), ss = drawB({}, 'drawMjBadgeStory');
  check('Story da conquista: o MESMO cartão, inteiro e escalado (k ≈ 0,985) entre as margens de 250 e 340 px; nenhum texto passa delas; os mesmos textos do Feed', ss.texts.length > 0 && ss.texts.every(t => Math.abs(t.k - kS) < 1e-9 && t.ay >= S.TOP && t.ay <= S.H - S.BOTTOM && t.ax >= 0 && t.ax <= S.W) && JSON.stringify(ss.texts.map(t => t.text)) === JSON.stringify(sf.texts.map(t => t.text)) && ss.saves === ss.restores && ss.k === 1 && ss.tx === 0 && ss.ty === 0, ss.texts.map(t => [t.text, Math.round(t.ay)]).filter(x => x[1] < 250 || x[1] > 1580));
  check('Story da conquista: fundo na imagem INTEIRA (1080×1920), com o brilho do cartão (y = 250 + 410·k, raio 500·k) e as cores do nível; o cartão não pinta outro fundo', ss.fillRects.filter(r => r.w === 1080 && r.h === 1920).length === 2 && !ss.fillRects.some(r => r.h === 1350) && Math.abs(ss.radials[0][1] - (S.TOP + 410 * kS)) < 1e-6 && Math.abs(ss.radials[0][5] - 500 * kS) < 1e-6 && JSON.stringify(sf.radials[0]) === JSON.stringify([540, 410, 20, 540, 410, 500]) && ss.stops.includes(T.legendary.bg) && sf.stops.includes(T.legendary.bg), { feed: sf.radials[0], story: ss.radials[0] });
  for (const k of ['epic', 'rare', 'common']) {
    const holdersFor = { epic: 2, rare: 4, common: 11 }[k], elig = { epic: 20, rare: 14, common: 14 }[k];
    const x = drawB({ holders: holdersFor, eligible: elig }, 'drawMjBadgeStory');
    check(`Story da conquista ${T[k].label}: a moldura e o fundo também mudam de cor (${COLORS[k]})`, x.strokes[0].color === COLORS[k] && x.stops.includes(T[k].bg) && !x.stops.includes(T.legendary.bg));
  }

  // ══ 6. CARTÃO COM VÁRIAS CONQUISTAS ═══════════════════════════════════════════════════════════════
  const EM = ['⭐', '⚜️', '🌗', '🥇', '🏅', '💎', '👑', '🔱', '🃏', '🤌', '🍿', '🔥'];
  const many = (n, mode = 'all', extra = {}) => A.mjBadgesData({ ...PLAYER, mode, count: mode === 'new' ? 23 : n, total: 58, ...extra, items: Array.from({ length: n }, (_, i) => ({ emoji: EM[i % EM.length], label: 'Conquista ' + (i + 1), holders: [1, 2, 5, 12][Math.min(i, 3)], eligible: 20 })) });
  const drawG = (data, ph = null, lg = logo, fn = 'drawMjBadgesCard') => { const x = fakeCtx(); A[fn](x, data, ph, lg); return x; };
  let g6 = drawG(many(6));
  check('cartão com várias (6): título, nome em maiúsculas, "6 de 58 conquistas", liga, o nome e o ícone de cada conquista e o rodapé', ['MINHAS CONQUISTAS', 'ANA MARIA SOUZA', '6 de 58 conquistas', 'Série B Aceoma', 'Crie a liga da sua pelada', 'peladanamao.com.br'].every(x => said(g6).includes(x)) && Array.from({ length: 6 }, (_, i) => 'Conquista ' + (i + 1)).every(x => said(g6).includes(x)) && EM.slice(0, 6).every(e => said(g6).includes(e)), said(g6));
  check('cada cartão toma a cor da raridade mais alta: moldura, anel da foto, título e rodapé na mesma cor (lendária dourado, épica roxo, rara azul, comum verde)', A.MJ_TIER_ORDER.every(k => { const data = A.mjBadgesData({ ...PLAYER, items: [{ emoji: '⭐', label: 'X', holders: { legendary: 1, epic: 2, rare: 4, common: 11 }[k], eligible: 14 }], count: 1, total: 5 }); const x = drawG(data); return x.strokes[0].color === COLORS[k] && x.strokes[0].width === 6 && x.arcs[0].fill === COLORS[k] && x.texts.find(t => t.text === 'MINHAS CONQUISTAS').fill === COLORS[k] && x.texts.find(t => t.text === 'peladanamao.com.br').fill === COLORS[k] && x.stops.includes(T[k].bg) && x.stops.includes(T[k].glow) && x.arcs[0].r === 88; }));
  check('bordas pela raridade: só as conquistas rara, épica e lendária ganham borda (3 px) na cor do seu nível; a comum fica sem borda; a moldura do cartão continua uma só', (() => { const x = drawG(many(6)); const bs = x.strokes.filter(t => t.width === 3).map(t => t.color); return bs.join() === [COLORS.legendary, COLORS.epic, COLORS.rare].join() && x.strokes.filter(t => t.width === 6).length === 1; })(), drawG(many(6)).strokes);
  const soComum = drawG(A.mjBadgesData({ ...PLAYER, items: Array.from({ length: 5 }, (_, i) => ({ emoji: EM[i], label: 'C' + i, holders: 12, eligible: 20 })), count: 5, total: 58 }));
  check('só conquistas comuns: nenhuma borda, nenhuma legenda de cores e o cartão inteiro em verde', soComum.strokes.length === 1 && soComum.strokes[0].color === COLORS.common && !said(soComum).some(t => /Raridade/.test(t)) && soComum.arcs.filter(a => a.r === 9).length === 0);
  check('legenda das cores: "Raridade na liga:" e os níveis especiais que aparecem (Lendária, Épica, Rara), cada um com a sua bolinha na cor; "Comum" não entra', said(g6).includes('Raridade na liga:') && ['Lendária', 'Épica', 'Rara'].every(x => said(g6).includes(x)) && !said(g6).includes('Comum') && g6.arcs.filter(a => a.r === 9).map(a => a.fill).join() === [COLORS.legendary, COLORS.epic, COLORS.rare].join(), g6.arcs.filter(a => a.r === 9));
  check('a legenda só mostra os níveis que existem no cartão (só épicas: só "Épica")', (() => { const x = drawG(A.mjBadgesData({ ...PLAYER, items: [{ emoji: '⭐', label: 'X', holders: 2, eligible: 20 }, { emoji: '🏅', label: 'Y', holders: 12, eligible: 20 }], count: 2, total: 9 })); return said(x).includes('Épica') && !said(x).includes('Lendária') && !said(x).includes('Rara') && x.arcs.filter(a => a.r === 9).length === 1; })());
  const comFoto = drawG(many(6, 'all', { photo: 'https://res.cloudinary.com/x/foto.jpg' }), photo);
  const semFoto = drawG(many(6));
  check('foto de perfil: desenhada DENTRO do recorte redondo e cobrindo o círculo (anel na cor do cartão); sem foto, as iniciais na cor do cartão', comFoto.images.length === 2 && comFoto.images[1].img === photo && comFoto.images[1].clipped === true && comFoto.images[1].args[2] >= 156 && comFoto.arcs[0].fill === COLORS.legendary && semFoto.images.length === 1 && semFoto.texts.find(t => t.text === 'AM').fill === COLORS.legendary, comFoto.images.map(i => ({ w: i.args[2], clipped: i.clipped })));
  const cc = A.mjBadgesData({ ...PLAYER, items: [{ emoji: '⭐', label: 'X', holders: 2, eligible: 20 }], count: 1, total: 5 });
  check('as iniciais seguem a cor do nível também em outros níveis (épica = roxo)', drawG(cc).texts.find(t => t.text === 'AM').fill === COLORS.epic);
  const n2 = drawG(many(2, 'new'));
  check('modo "novas": título CONQUISTAS NOVAS, "2 novas · 23 no total" (e "1 nova" no singular); modo "todas" sem total: "N conquistas" ("1 conquista")', said(n2).includes('CONQUISTAS NOVAS') && said(n2).includes('2 novas · 23 no total') && said(drawG(many(1, 'new'))).includes('1 nova · 23 no total') && said(drawG(many(3, 'all', { total: 0 }))).includes('3 conquistas') && said(drawG(A.mjBadgesData({ ...PLAYER, items: [{ emoji: '⭐', label: 'X' }], count: 1 }))).includes('1 conquista') && said(drawG(many(3, 'all', { total: 2, count: 3 }))).includes('3 conquistas'));
  const g30 = drawG(many(30)), g60 = drawG(many(60));
  const icons = (x, n) => x.texts.filter(t => /400 62px/.test(t.font));
  check('de 21 em diante só os ícones (sem o nome de cada uma) e o nome da mais rara vai na contagem ("· mais rara: …")', icons(g30).length === 30 && !said(g30).some(t => /^Conquista \d+$/.test(t)) && said(g30).some(t => /^30 de 58 conquistas · mais rara: Conquista 1$/.test(t)) && !said(g6).some(t => /mais rara/.test(t)), said(g30).filter(t => /conquistas/.test(t)));
  check('acima de 48: 47 ícones e uma célula "+N" com as que não couberam (60 → "+13"); até 48 mostra todas', icons(g60).length === 47 && said(g60).includes('+13') && icons(drawG(many(48))).length === 48 && !said(drawG(many(48))).some(t => /^\+\d+$/.test(t)) && said(drawG(many(49))).includes('+2') && icons(drawG(many(49))).length === 47);
  const dentro = [], posicoes = [];
  for (const n of [1, 2, 3, 4, 6, 8, 9, 12, 13, 16, 20, 21, 30, 47, 48, 49, 60, 120]) {
    const x = drawG(many(n)), tiles = x.texts.filter(t => /400 (110|92|80|60|62)px/.test(t.font));
    const FIXOS = ['Crie a liga da sua pelada', 'peladanamao.com.br', 'Raridade na liga:', 'Lendária', 'Épica', 'Rara', 'Comum'];
    const ys = x.texts.filter(t => t.y > 560 && !FIXOS.includes(t.text)).map(t => t.y); // só o texto da grade: da contagem para baixo, menos o rodapé e a legenda
    if (x.texts.some(t => t.x < 0 || t.x > W || t.y < 0 || t.y > H)) dentro.push(['fora', n]);
    if (!ys.length || Math.min(...ys) < 575 || Math.max(...ys) > 1156) dentro.push(['grade', n, Math.min(...ys), Math.max(...ys)]);
    const legend = x.texts.find(t => t.text === 'Raridade na liga:');
    if (legend && !(legend.y === 1180 && Math.max(...ys) < 1166)) dentro.push(['legenda', n]);
    const pos = tiles.map(t => t.x + ',' + t.y); if (new Set(pos).size !== pos.length) posicoes.push(n);
  }
  check('de 1 a 120 conquistas: todo texto dentro da imagem, a grade entre a contagem e a legenda (até 1156) e a legenda fixa em y=1180, sem nada em cima do rodapé', dentro.length === 0, dentro.slice(0, 6));
  check('nenhum ícone fica em cima de outro (posições todas diferentes) em qualquer quantidade', posicoes.length === 0, posicoes);
  const longoG = drawG(many(6, 'all', { name: 'Fulano de Tal da Silva Sauro Pereira Gonçalves de Albuquerque Junior Neto Filho' }));
  check('nome enorme no cartão com várias: encolhe/corta e fica dentro da largura', longoG.texts.filter(t => /FULANO/.test(t.text)).every(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5 <= 920));
  check('nomes de conquista muito longos nas células: no máximo 2 linhas, cortadas com reticências, e dentro da célula', (() => { const x = drawG(A.mjBadgesData({ ...PLAYER, items: Array.from({ length: 6 }, (_, i) => ({ emoji: '⭐', label: 'Eu sou bom, meu empresário que é ruim, de verdade ' + i, holders: 12, eligible: 20 })), count: 6, total: 58 })); const labs = x.texts.filter(t => /600 26px/.test(t.font)); return labs.length === 12 && labs.every(t => t.text.length * 26 * 0.5 <= (968 / 4) - 28 + 0.01) && labs.some(t => t.text.endsWith('…')); })());
  const gs = drawG(many(6), null, logo, 'drawMjBadgesStory');
  const gf = drawG(many(6));
  check('Story das conquistas: o MESMO cartão escalado entre as margens (250 e 340 px), com os mesmos textos do Feed, o brilho acompanhando a foto (y = 250 + 262·k) e a cor do nível', gs.texts.every(t => Math.abs(t.k - kS) < 1e-9 && t.ay >= S.TOP && t.ay <= S.H - S.BOTTOM && t.ax >= 0 && t.ax <= S.W) && JSON.stringify(gs.texts.map(t => t.text)) === JSON.stringify(gf.texts.map(t => t.text)) && Math.abs(gs.radials[0][1] - (S.TOP + 262 * kS)) < 1e-6 && gs.fillRects.filter(r => r.w === 1080 && r.h === 1920).length === 2 && gs.stops.includes(T.legendary.bg) && gs.saves === gs.restores && gs.strokes[0].color === COLORS.legendary);

  // ══ 7. O PLAYER CARD CONTINUA IGUAL ═══════════════════════════════════════════════════════════════
  const pc = A.mjCardData({ name: 'Ana', titlesNum: 0, titlesText: '0', champs: 2 }), pcx = fakeCtx(), pcy = fakeCtx();
  A.drawMjCard(pcx, pc, null, logo); A.drawMjStory(pcy, pc, null, logo);
  check('o cartão do jogador não mudou de cor: quem nunca foi campeão fica verde (fundo #0b2a21), campeão dourado (#2a1f05); o Story do jogador também', pcx.stops.includes('#0b2a21') && pcx.stops.includes('rgba(0,214,127,0.26)') && pcy.stops.includes('#0b2a21') && A.mjCardData({ name: 'Ana', titlesNum: 2 }).isChampion === true && (() => { const x = fakeCtx(); A.drawMjCard(x, A.mjCardData({ name: 'Ana', titlesNum: 2 }), null, logo); return x.stops.includes('#2a1f05') && x.stops.includes('rgba(240,180,41,0.32)') && x.strokes[0].color === '#f0b429'; })());
  check('os tipos de janela: jogador, conquista e conquistas, cada um com seus dois arquivos (Story e Feed) e todos diferentes; o do jogador mantém os nomes de sempre', Object.keys(A.MJ_KINDS).join() === 'player,badge,badges,rival,rivalnum,rivalduel,destaques,meumes,comparativo' && A.MJ_KINDS.meumes.file.story === 'meu-mes-pelada-na-mao-story.png' && A.MJ_KINDS.meumes.file.feed === 'meu-mes-pelada-na-mao.png' && A.MJ_KINDS.comparativo.file.story === 'evolucao-pelada-na-mao-story.png' && A.MJ_KINDS.comparativo.file.feed === 'evolucao-pelada-na-mao.png' && A.MJ_KINDS.destaques.file.story === 'destaques-pelada-na-mao-story.png' && A.MJ_KINDS.destaques.file.feed === 'destaques-pelada-na-mao.png' && A.MJ_KINDS.rivalduel.file.story === 'duelo-pelada-na-mao-story.png' && A.MJ_KINDS.rivalduel.file.feed === 'duelo-pelada-na-mao.png' && A.MJ_KINDS.rivalnum.file.story === 'rival-numeros-pelada-na-mao-story.png' && A.MJ_KINDS.rivalnum.file.feed === 'rival-numeros-pelada-na-mao.png' && A.MJ_KINDS.rival.file.story === 'rival-pelada-na-mao-story.png' && A.MJ_KINDS.rival.file.feed === 'rival-pelada-na-mao.png' && A.MJ_KINDS.player.file.story === 'cartao-pelada-na-mao-story.png' && A.MJ_KINDS.player.file.feed === 'cartao-pelada-na-mao.png' && A.MJ_KINDS.badge.file.story === 'conquista-pelada-na-mao-story.png' && A.MJ_KINDS.badge.file.feed === 'conquista-pelada-na-mao.png' && A.MJ_KINDS.badges.file.story === 'conquistas-pelada-na-mao-story.png' && A.MJ_KINDS.badges.file.feed === 'conquistas-pelada-na-mao.png' && new Set(Object.values(A.MJ_KINDS).flatMap(k => [k.file.story, k.file.feed])).size === 18);

  // ══ 8. A JANELA DE COMPARTILHAR ═══════════════════════════════════════════════════════════════════
  let e = makeEnv(); e.env.st._mjShare = SHARE();
  let op = e.api.openMjBadge('pipoca');
  check('abrir uma conquista: a janela aparece na hora ("📤 Sua conquista", "Montando sua conquista…") e conta a abertura (uma vez por sessão)', e.layers.length === 1 && e.layers[0].id === 'mj-card' && /📤 Sua conquista/.test(e.layers[0].innerHTML) && /Montando sua conquista…/.test(e.layers[0].innerHTML) && JSON.stringify(e.calls.events) === JSON.stringify([['cardOpen', true]]) && e.api.getKind() === 'badge', { ev: e.calls.events, kind: e.api.getKind() });
  await op;
  let inner = e.layers[0].innerHTML;
  check('pronta: prévia do Story, com a descrição "Sua conquista no Pelada na Mão, formato Story", os botões Compartilhar, Copiar legenda e Baixar e o aviso de privacidade', /<img src="blob:/.test(inner) && /alt="Sua conquista no Pelada na Mão, formato Story"/.test(inner) && /shareMjCard\(\)/.test(inner) && /copyMjCaption\(\)/.test(inner) && /downloadMjCard\(\)/.test(inner) && /setMjFormat\('story'\)" aria-pressed="true"/.test(inner) && /não leva e-mail nem WhatsApp/i.test(inner) && !/Seu cartão/.test(inner), inner.slice(0, 300));
  check('as duas imagens (Feed 1080×1350 e Story 1080×1920) já ficam prontas, cada uma desenhada pelo cartão da conquista (Feed sem escala, Story escalado), e a abertura NÃO baixa nada', e.calls.canvases.length === 2 && e.calls.canvases[0].height === 1350 && e.calls.canvases[1].height === 1920 && e.calls.canvases.every(cv => cv.width === 1080 && said(cv.ctx).includes('PIPOCA') && said(cv.ctx).includes('LENDÁRIA')) && e.calls.canvases[0].ctx.texts.every(t => t.k === 1) && e.calls.canvases[1].ctx.texts.every(t => Math.abs(t.k - kS) < 1e-9) && e.calls.clicks.length === 0 && e.calls.canvases.every(cv => cv.ctx.images.length === 1), e.calls.canvases.map(x => [x.width, x.height]));
  await e.api.shareMjCard();
  let sh = e.calls.shared[0];
  check('compartilhar no Story: arquivo conquista-pelada-na-mao-story.png (a imagem de 1920 px), título "Minha conquista no Pelada na Mão" e o texto cita o nome da conquista, o nível e o link ?ref=cartao', sh.files[0].name === 'conquista-pelada-na-mao-story.png' && sh.files[0].type === 'image/png' && (await sh.files[0].text()) === 'png1920' && sh.title === 'Minha conquista no Pelada na Mão' && sh.text === `Desbloqueei "Pipoca" (conquista lendária) no Pelada na Mão 🏅 Faça a liga da sua pelada: ${LINK}`, sh);
  check('…conta o toque (sempre, como o cartão do jogador) e não baixa nada quando o compartilhamento deu certo', JSON.stringify(e.calls.events.slice(-1)) === JSON.stringify([['cardShare', false]]) && e.calls.clicks.length === 0);
  e.api.setMjFormat('feed'); await e.api.shareMjCard();
  sh = e.calls.shared[1];
  check('compartilhar no Feed: arquivo conquista-pelada-na-mao.png (a imagem de 1350 px)', sh.files[0].name === 'conquista-pelada-na-mao.png' && (await sh.files[0].text()) === 'png1350', sh.files[0].name);
  e.api.downloadMjCard(); e.api.setMjFormat('story'); e.api.downloadMjCard();
  check('baixar: o nome do arquivo segue o tipo e o formato (conquista… Feed, conquista…-story Story) e o endereço é o da imagem de cada formato', e.calls.clicks.map(k => k.download).join() === 'conquista-pelada-na-mao.png,conquista-pelada-na-mao-story.png' && e.calls.clicks[0].href === e.api.getUrls().feed && e.calls.clicks[1].href === e.api.getUrls().story, e.calls.clicks);
  await e.api.copyMjCaption();
  const cap = e.calls.copied[0];
  check('Copiar legenda: gancho, ícone + nome + regra, a raridade, o convite com ?ref=cartao e as hashtags, em 5 linhas', cap === `Conquista desbloqueada no Pelada na Mão 🏅\n🍿 Pipoca: Vice-campeão em 3 campeonatos consecutivos\nRaridade na liga: Lendária\nQual é a sua? Crie a liga da sua pelada: ${LINK}\n#pelada #futebolamador #peladanamao`, cap);
  check('PRIVACIDADE: a legenda e o texto de compartilhar não levam o nome do jogador nem o da liga (a imagem leva; quem compartilha escolhe)', !cap.includes(PLAYER.name) && !cap.includes(PLAYER.league) && !sh.text.includes(PLAYER.name) && !sh.text.includes(PLAYER.league) && !/@|e-?mail|whatsapp/i.test(cap + sh.text));
  e.api.closeMjCard();
  check('fechar: solta as duas imagens, some a janela e volta ao tipo "jogador" (sem dados guardados)', e.layers.length === 0 && e.calls.revoked.length === 2 && e.api.getBlobs() === null && e.api.getUrls() === null && e.api.getKind() === 'player' && e.api.getData() === null);
  // conquista comum, sem destaque de nível no texto
  e = makeEnv(); e.env.st._mjShare = SHARE(); await e.api.openMjBadge('campeao'); await e.api.shareMjCard();
  check('conquista comum: o texto de compartilhar não cita o nível ("Desbloqueei \\"Campeão\\" no Pelada na Mão 🏅 …") e o cartão sai verde', e.calls.shared[0].text === `Desbloqueei "Campeão" no Pelada na Mão 🏅 Faça a liga da sua pelada: ${LINK}` && e.calls.canvases[0].ctx.strokes[0].color === COLORS.common && said(e.calls.canvases[0].ctx).includes('COMUM'));
  await e.api.copyMjCaption();
  check('a legenda da conquista comum diz "Raridade na liga: Comum"', /\nRaridade na liga: Comum\n/.test(e.calls.copied[0]));
  // cancelou / erro / sem suporte
  let e2 = makeEnv({ shareImpl: async () => { const err = new Error('cancelado'); err.name = 'AbortError'; throw err; } }); e2.env.st._mjShare = SHARE();
  await e2.api.openMjBadge('pipoca'); await e2.api.shareMjCard();
  check('cancelou a janela de compartilhar: não é erro, não baixa e não mostra aviso', e2.calls.clicks.length === 0 && e2.calls.toasts.length === 0);
  e2 = makeEnv({ shareImpl: async () => { throw new Error('falhou'); } }); e2.env.st._mjShare = SHARE();
  await e2.api.openMjBadge('pipoca'); await e2.api.shareMjCard();
  check('o compartilhamento falhou de verdade: cai para baixar a imagem do tipo (conquista…-story.png)', e2.calls.clicks.length === 1 && e2.calls.clicks[0].download === 'conquista-pelada-na-mao-story.png' && e2.calls.toasts.some(([m, t]) => /Imagem salva/.test(m) && t === 'ok'), e2.calls);
  e2 = makeEnv({ canShare: false }); e2.env.st._mjShare = SHARE();
  await e2.api.openMjBadges('all'); await e2.api.shareMjCard();
  check('o aparelho não compartilha arquivo (computador): baixa a imagem do cartão com várias (conquistas…-story.png)', e2.calls.shared.length === 0 && e2.calls.clicks.length === 1 && e2.calls.clicks[0].download === 'conquistas-pelada-na-mao-story.png', e2.calls);

  // ── quantas conquistas: todas / só as novas ──
  e = makeEnv(); e.env.st._mjShare = SHARE();
  op = e.api.openMjBadges('all');
  check('abrir "Minhas conquistas": "📤 Suas conquistas", "Montando suas conquistas…", tipo "badges"', /📤 Suas conquistas/.test(e.layers[0].innerHTML) && /Montando suas conquistas…/.test(e.layers[0].innerHTML) && e.api.getKind() === 'badges' && e.calls.events.length === 1);
  await op;
  check('pronta: descrição "Suas conquistas no Pelada na Mão, formato Story"; o cartão tem as 4 conquistas, "4 de 58 conquistas", a legenda das cores e a cor lendária', /alt="Suas conquistas no Pelada na Mão, formato Story"/.test(e.layers[0].innerHTML) && said(e.calls.canvases[0].ctx).includes('4 de 58 conquistas') && ['Pipoca', 'Baggio', 'Invicto', 'Campeão'].every(x => said(e.calls.canvases[0].ctx).includes(x)) && said(e.calls.canvases[0].ctx).includes('Raridade na liga:') && e.calls.canvases[0].ctx.strokes[0].color === COLORS.legendary && e.calls.canvases[1].height === 1920, said(e.calls.canvases[0].ctx));
  await e.api.shareMjCard(); sh = e.calls.shared[0];
  check('compartilhar as conquistas: arquivo conquistas-pelada-na-mao-story.png, título "Minhas conquistas no Pelada na Mão" e o texto com o link ?ref=cartao', sh.files[0].name === 'conquistas-pelada-na-mao-story.png' && sh.title === 'Minhas conquistas no Pelada na Mão' && sh.text === `Minhas conquistas no Pelada na Mão 🏅 Faça a liga da sua pelada: ${LINK}`, sh);
  await e.api.copyMjCaption();
  check('legenda das conquistas: título, "N conquistas desbloqueadas na minha pelada.", o convite com ?ref=cartao e as hashtags, em 4 linhas, sem nome nem liga', e.calls.copied[0] === `Minhas conquistas no Pelada na Mão 🏅\n4 conquistas desbloqueadas na minha pelada.\nCrie a liga da sua: ${LINK}\n#pelada #futebolamador #peladanamao` && !e.calls.copied[0].includes(PLAYER.name), e.calls.copied[0]);
  e = makeEnv(); e.env.st._mjShare = SHARE(); e.env.st._mjShare.earned = [EARNED[0]];
  await e.api.openMjBadges('all'); await e.api.copyMjCaption();
  check('com 1 conquista só: "1 conquista desbloqueada" no singular', /\n1 conquista desbloqueada na minha pelada\.\n/.test(e.calls.copied[0]));
  e = makeEnv(); e.env.st._mjShare = SHARE();
  await e.api.openMjBadges('new', ['pipoca', 'baggio', 'nao-existe']);
  check('"Conquistas novas": só as que vieram na lista e que o jogador tem; título CONQUISTAS NOVAS e "2 novas · 4 no total"', e.api.getKind() === 'badges' && said(e.calls.canvases[0].ctx).includes('CONQUISTAS NOVAS') && said(e.calls.canvases[0].ctx).includes('2 novas · 4 no total') && ['Pipoca', 'Baggio'].every(x => said(e.calls.canvases[0].ctx).includes(x)) && !said(e.calls.canvases[0].ctx).includes('Invicto'), said(e.calls.canvases[0].ctx));
  await e.api.shareMjCard(); await e.api.copyMjCaption();
  check('as novas: o texto diz "Conquistas novas no Pelada na Mão 🏅 …" e a legenda lista os ícones das novas', e.calls.shared[0].text === `Conquistas novas no Pelada na Mão 🏅 Faça a liga da sua pelada: ${LINK}` && e.calls.copied[0] === `Conquistas novas no Pelada na Mão 🏅\n2 conquistas novas na minha pelada: 🍿 😭\nCrie a liga da sua: ${LINK}\n#pelada #futebolamador #peladanamao`, e.calls.copied[0]);
  // nada a compartilhar
  const nada = [];
  for (const [rotulo, prep, fn] of [
    ['conquista que não existe', st => { st._mjShare = SHARE(); }, a => a.openMjBadge('nao-existe')],
    ['conquista sem o id', st => { st._mjShare = SHARE(); }, a => a.openMjBadge(undefined)],
    ['conquista na simulação do admin (sem dados para compartilhar)', st => { st._mjShare = null; }, a => a.openMjBadge('pipoca')],
    ['conquistas na simulação do admin', st => { st._mjShare = null; }, a => a.openMjBadges('all')],
    ['conquistas sem nenhuma conquista', st => { st._mjShare = { ...SHARE(), earned: [] }; }, a => a.openMjBadges('all')],
    ['conquistas sem a lista', st => { st._mjShare = { name: 'x' }; }, a => a.openMjBadges('all')],
    ['novas sem a lista de ids', st => { st._mjShare = SHARE(); }, a => a.openMjBadges('new')],
    ['novas com ids que o jogador não tem', st => { st._mjShare = SHARE(); }, a => a.openMjBadges('new', ['x', 'y'])],
    ['novas com ids que não são lista', st => { st._mjShare = SHARE(); }, a => a.openMjBadges('new', 'pipoca')],
    ['tipo desconhecido (__proto__)', st => {}, a => a.openMjShare('__proto__', { x: 1 })],
    ['tipo desconhecido (constructor)', st => {}, a => a.openMjShare('constructor', { x: 1 })],
    ['tipo desconhecido (toString)', st => {}, a => a.openMjShare('toString', { x: 1 })],
    ['tipo ausente', st => {}, a => a.openMjShare(undefined, { x: 1 })],
    ['tipo certo sem dados', st => {}, a => a.openMjShare('badge', null)],
  ]) { const x = makeEnv(); prep(x.env.st); await fn(x.api); if (x.layers.length || x.calls.events.length || x.calls.canvases.length) nada.push(rotulo); }
  check('nada a compartilhar (conquista inexistente, simulação do admin, sem conquistas, ids vazios ou de quem não tem, tipo desconhecido): nada abre, nada é contado, nada é desenhado', nada.length === 0, nada);
  // trocar de tipo
  e = makeEnv(); e.env.st._mjShare = SHARE(); e.env.st._mjCard = A.mjCardData({ name: 'Ana', champs: 3 });
  await e.api.openMjBadge('pipoca'); const urlsB = e.api.getUrls();
  await e.api.openMjCard();
  check('abrir o cartão do jogador depois de uma conquista: a janela volta a ser "📤 Seu cartão" (jogador), as imagens da conquista são soltas e os arquivos são os de sempre', e.api.getKind() === 'player' && /📤 Seu cartão/.test(e.layers[0].innerHTML) && e.layers.length === 1 && e.calls.revoked.includes(urlsB.story) && e.calls.revoked.includes(urlsB.feed) && /alt="Seu cartão no Pelada na Mão, formato Story"/.test(e.layers[0].innerHTML), e.layers[0].innerHTML.slice(0, 200));
  await e.api.shareMjCard();
  check('…e compartilhar sai com o nome e o texto do cartão do jogador (não os da conquista)', e.calls.shared[0].files[0].name === 'cartao-pelada-na-mao-story.png' && e.calls.shared[0].title === 'Meu cartão no Pelada na Mão' && /Meu cartão no Pelada na Mão ⚽🏆/.test(e.calls.shared[0].text));
  // falhas de imagem
  const f3 = makeEnv({ toBlobAlwaysFails: true }); f3.env.st._mjShare = SHARE(); await f3.api.openMjBadge('pipoca');
  check('não consegue gerar a imagem da conquista: mostra a mensagem do tipo ("Não foi possível montar a imagem agora.") e nenhum botão de compartilhar', /Não foi possível montar a imagem agora/.test(f3.layers[0].innerHTML) && !/shareMjCard/.test(f3.layers[0].innerHTML));
  const f1 = makeEnv({ toBlobFailsWithPhoto: true }); f1.env.st._mjShare = { ...SHARE(), photo: 'https://res.cloudinary.com/x/foto.jpg' }; await f1.api.openMjBadges('all');
  check('cartão com várias e a foto "contaminou" o canvas: refaz sem a foto (iniciais) e entrega a imagem', f1.calls.canvases.length === 4 && /<img src="blob:/.test(f1.layers[0].innerHTML) && f1.calls.canvases.slice(2).every(cv => cv.ctx.texts.some(t => t.text === 'AM')) && f1.calls.canvases.slice(0, 2).every(cv => cv.ctx.images.some(i => i.img && i.img.__photo)), f1.calls.canvases.length);
  const f2 = makeEnv({ imageFails: ['cloudinary'] }); f2.env.st._mjShare = { ...SHARE(), photo: 'https://res.cloudinary.com/x/foto.jpg' }; await f2.api.openMjBadges('all');
  check('a foto não carrega: o cartão sai com as iniciais, sem erro', f2.calls.canvases.length === 2 && /<img src="blob:/.test(f2.layers[0].innerHTML) && f2.calls.canvases.every(cv => cv.ctx.texts.some(t => t.text === 'AM')));
  const fq = makeEnv(); fq.env.st._mjShare = SHARE(); const opq = fq.api.openMjBadge('pipoca'); fq.api.closeMjCard(); await opq;
  check('fechou antes de a imagem ficar pronta: a janela não ressuscita e nada fica guardado', fq.layers.length === 0 && fq.api.getBlobs() === null && fq.api.getUrls() === null && fq.api.getKind() === 'player');

  // ══ 9. AVISO DE CONQUISTA NOVA ════════════════════════════════════════════════════════════════════
  const KEY = 'u1_liga1', TTL = 7 * 24 * 60 * 60 * 1000;
  let n = makeEnv();
  check('chave de guarda por conta e liga ("uid_liga"); sem conta ou sem liga: vazia e nada é guardado', n.api.newBadgesKey() === KEY && (() => { const z = makeEnv(); z.env.st.authUser = null; const k1 = z.api.newBadgesKey(); z.env.st.authUser = { uid: 'u1' }; z.env.st.leagueId = null; const k2 = z.api.newBadgesKey(); z.api.newBadgesAdd(['a']); return k1 === '' && k2 === '' && z.api.newBadgeIds().length === 0 && z.store.size === 0; })());
  check('o aviso fica 7 dias e só neste aparelho (localStorage "aceoma_newBadges")', n.api.NEW_BADGES_TTL === TTL && n.api.NEW_BADGES_STORE === 'aceoma_newBadges');
  check('começa vazio', n.api.newBadgeIds().length === 0 && n.store.size === 0);
  n.api.newBadgesAdd(['pipoca', 'baggio']);
  let saved = JSON.parse(n.store.get('aceoma_newBadges'));
  check('conquistas novas são guardadas por conta e liga, só com os códigos e a hora (nada de nome, e-mail ou liga por extenso)', JSON.stringify(Object.keys(saved)) === JSON.stringify([KEY]) && JSON.stringify(saved[KEY].ids) === JSON.stringify(['pipoca', 'baggio']) && saved[KEY].ts === n.clock.t && !/Ana|@|Série/.test(n.store.get('aceoma_newBadges')), saved);
  n.api.newBadgesAdd(['baggio', 'invicto', 'pipoca']); n.api.newBadgesAdd([]); n.api.newBadgesAdd(undefined);
  check('novas conquistas se juntam às que já estavam (sem repetir); lista vazia ou ausente não faz nada', JSON.stringify(n.api.newBadgeIds()) === JSON.stringify(['pipoca', 'baggio', 'invicto']) && JSON.stringify(JSON.parse(n.store.get('aceoma_newBadges'))[KEY].ids) === JSON.stringify(['pipoca', 'baggio', 'invicto']));
  n.env.st._newBadges = null;
  check('depois de recarregar o app (memória vazia) as conquistas novas voltam do aparelho', JSON.stringify(n.api.newBadgeIds()) === JSON.stringify(['pipoca', 'baggio', 'invicto']));
  n.env.st.leagueId = 'outra';
  check('outra liga da mesma conta tem a sua própria lista (vazia); a primeira continua guardada', n.api.newBadgeIds().length === 0 && JSON.parse(n.store.get('aceoma_newBadges'))[KEY].ids.length === 3);
  n.api.newBadgesAdd(['x']); n.env.st.leagueId = 'liga1'; n.env.st._newBadges = null;
  check('as duas ligas convivem no mesmo armazenamento sem se misturar', JSON.stringify(n.api.newBadgeIds()) === JSON.stringify(['pipoca', 'baggio', 'invicto']) && Object.keys(JSON.parse(n.store.get('aceoma_newBadges'))).sort().join() === 'u1_liga1,u1_outra');
  n.clock.t += TTL - 1; n.env.st._newBadges = null;
  check('ainda vale 1 ms antes de completar 7 dias', n.api.newBadgeIds().length === 3);
  n.clock.t += 1; n.env.st._newBadges = null;
  check('com 7 dias completos o aviso expira (a lista volta vazia)', n.api.newBadgeIds().length === 0);
  const ruins = [];
  for (const [rotulo, valor] of [['JSON quebrado', '{{{'], ['texto solto', 'oi'], ['lista em vez de objeto', '[1,2]'], ['número', '42'], ['entrada sem ids', JSON.stringify({ [KEY]: { ts: 1_700_000_000_000 } })], ['ids que não é lista', JSON.stringify({ [KEY]: { ids: 'pipoca', ts: 1_700_000_000_000 } })], ['sem hora', JSON.stringify({ [KEY]: { ids: ['a'] } })], ['null', 'null']]) {
    const z = makeEnv({ storage: { aceoma_newBadges: valor } });
    let threw = false, antes, depois, guardado = null; try { antes = z.api.newBadgeIds(); z.api.newBadgesAdd(['b']); depois = z.api.newBadgeIds(); guardado = JSON.parse(z.store.get('aceoma_newBadges'))[KEY]; } catch (_) { threw = true; }
    if (threw || antes.length !== 0 || JSON.stringify(depois) !== JSON.stringify(['b']) || !guardado || JSON.stringify(guardado.ids) !== JSON.stringify(['b'])) ruins.push([rotulo, threw, antes, depois, guardado]);
  }
  check('armazenamento estragado (JSON quebrado, texto solto, lista, número, sem ids, ids que não é lista, sem hora, null): ignora, segue sem quebrar e a próxima gravação conserta o que estava estragado', ruins.length === 0, ruins);
  check('só entram códigos de texto vindos do aparelho (números e objetos são descartados na leitura)', (() => { const z = makeEnv({ storage: { aceoma_newBadges: JSON.stringify({ [KEY]: { ids: ['a', 5, null, { x: 1 }, 'b'], ts: 1_700_000_000_000 } }) } }); return JSON.stringify(z.api.newBadgeIds()) === JSON.stringify(['a', 'b']); })());
  const bloqueado = makeEnv({ storageThrows: true });
  let jogou = false; try { bloqueado.api.newBadgesAdd(['a', 'b']); bloqueado.api.dismissNewBadges(); bloqueado.api.newBadgesAdd(['c']); } catch (_) { jogou = true; }
  check('armazenamento bloqueado (navegação privada): nada quebra e o aviso ainda funciona na memória da sessão', !jogou && JSON.stringify(bloqueado.api.newBadgeIds()) === JSON.stringify(['c']));
  n = makeEnv(); n.env.st._mjShare = SHARE();
  check('aviso: sem conquista nova, ou sem dados para compartilhar (simulação do admin): não aparece', n.api.newBadgesBanner() === '' && (() => { const z = makeEnv(); z.env.st._mjShare = null; z.api.newBadgesAdd(['pipoca']); return z.api.newBadgesBanner() === ''; })());
  n.api.newBadgesAdd(['nao-tenho-essa']);
  check('aviso: códigos de conquistas que o jogador não tem (mais) não aparecem', n.api.newBadgesBanner() === '');
  n.api.newBadgesAdd(['baggio']);
  let ban = n.api.newBadgesBanner();
  check('1 conquista nova: "Nova conquista desbloqueada!", o ícone e o nome, o botão 📤 Compartilhar e o × que fecha (com rótulo para leitor de tela)', /Nova conquista desbloqueada!/.test(ban) && /😭 Baggio/.test(ban) && /onclick="shareNewBadges\(\)"/.test(ban) && /📤 Compartilhar/.test(ban) && /onclick="dismissNewBadges\(\)"/.test(ban) && /aria-label="Fechar o aviso"/.test(ban) && !/novas conquistas/.test(ban), ban.slice(0, 300));
  n.api.newBadgesAdd(['pipoca', 'invicto']);
  ban = n.api.newBadgesBanner();
  check('3 conquistas novas: "3 novas conquistas desbloqueadas!" com os nomes na ordem de raridade do jogador, sem "+N"', /3 novas conquistas desbloqueadas!/.test(ban) && ban.indexOf('Pipoca') < ban.indexOf('Baggio') && ban.indexOf('Baggio') < ban.indexOf('Invicto') && !/\+\d/.test(ban), ban.slice(0, 400));
  n.env.st._mjShare.earned.push(B('c5', '⭐', 'Estreante', 'x', 12, 14)); n.env.st._mjShare.earned.push(B('c6', '🎖️', 'Veterano', 'x', 12, 14)); n.api.newBadgesAdd(['c5', 'c6']);
  ban = n.api.newBadgesBanner();
  check('5 conquistas novas: mostra 3 nomes e "+2"', /5 novas conquistas desbloqueadas!/.test(ban) && /· \+2/.test(ban) && !/Estreante|Veterano/.test(ban), ban.slice(0, 400));
  n = makeEnv(); n.env.st._mjShare = SHARE(); n.env.st._mjShare.earned[0] = B('xss', '⭐', '<img src=x onerror=alert(1)> & "oi"', 'x', 1, 14); n.api.newBadgesAdd(['xss']);
  ban = n.api.newBadgesBanner();
  check('o nome da conquista é escapado no aviso (sem HTML solto)', !/<img/.test(ban) && /&lt;img/.test(ban) && /&amp;|&quot;oi&quot;/.test(ban), ban.slice(0, 300));
  n = makeEnv(); n.env.st._mjShare = SHARE(); n.api.newBadgesAdd(['baggio']);
  n.api.dismissNewBadges();
  check('fechar o aviso (×): zera a lista (memória e aparelho), redesenha a tela uma vez e o aviso some', n.api.newBadgeIds().length === 0 && !('u1_liga1' in JSON.parse(n.store.get('aceoma_newBadges') || '{}')) && n.calls.renders === 1 && n.api.newBadgesBanner() === '');
  n = makeEnv(); n.env.st.authUser = null; n.api.dismissNewBadges();
  check('fechar o aviso sem conta: não faz nada e não redesenha', n.calls.renders === 0 && n.store.size === 0);
  // compartilhar a partir do aviso
  n = makeEnv(); n.env.st._mjShare = SHARE(); n.api.newBadgesAdd(['baggio']); n.api.shareNewBadges(); await tick();
  check('compartilhar o aviso com 1 conquista nova: abre o cartão DELA (tipo "conquista", com "BAGGIO" e o nível Épica)', n.api.getKind() === 'badge' && said(n.calls.canvases[0].ctx).includes('BAGGIO') && said(n.calls.canvases[0].ctx).includes('ÉPICA'), n.api.getKind());
  n = makeEnv(); n.env.st._mjShare = SHARE(); n.api.newBadgesAdd(['baggio', 'pipoca', 'invicto']); n.api.shareNewBadges(); await tick();
  check('com 2 ou mais: abre o cartão "Conquistas novas" só com elas (3 de 4, "3 novas · 4 no total")', n.api.getKind() === 'badges' && said(n.calls.canvases[0].ctx).includes('CONQUISTAS NOVAS') && said(n.calls.canvases[0].ctx).includes('3 novas · 4 no total') && !said(n.calls.canvases[0].ctx).includes('Campeão'), said(n.calls.canvases[0].ctx));
  n = makeEnv(); n.env.st._mjShare = SHARE(); n.api.newBadgesAdd(['baggio', 'sumiu']); n.api.shareNewBadges(); await tick();
  check('conquista que sumiu da lista do jogador não conta: sobrou 1, abre o cartão dessa', n.api.getKind() === 'badge' && said(n.calls.canvases[0].ctx).includes('BAGGIO'));
  n = makeEnv(); n.env.st._mjShare = SHARE(); n.api.shareNewBadges(); n.env.st._mjShare = null; n.api.newBadgesAdd(['baggio']); n.api.shareNewBadges(); await tick();
  check('compartilhar sem nada novo, ou sem dados (simulação): não abre nada', n.layers.length === 0 && n.calls.events.length === 0);

  // ══ 10. A JANELA DA CONQUISTA (mBadgeInfo) ════════════════════════════════════════════════════════
  const mk = (modal, share, holdersMap, players) => { const x = makeEnv({ holders: holdersMap }); x.env.st.players = players; x.env.st.modal = modal; x.env.st._mjShare = share; return x.api.mBadgeInfo(); };
  const PL = [{ name: 'Ana' }, { name: 'Bia', goleiro: true }, { name: 'Caio' }, { name: 'Dani' }];
  const mine = { earned: [{ id: 'pipoca' }] };
  let mi = mk({ type: 'badgeInfo', id: 'pipoca', earned: true }, mine, { pipoca: ['Ana'] }, PL);
  check('janela da conquista já ganha, no próprio perfil: botão "📤 Compartilhar conquista" que fecha a janela e abre o cartão (closeModal();openMjBadge) e continua o botão Fechar', /<button class="btn btn-primary"[^>]*onclick="closeModal\(\);openMjBadge\('pipoca'\)">📤 Compartilhar conquista<\/button>/.test(mi) && /onclick="closeModal\(\)">Fechar<\/button>/.test(mi) && /✓ Conquistada/.test(mi), mi.slice(-400));
  check('sem botão: conquista ainda não ganha, simulação do admin (sem dados), conquista que não está na lista do jogador, ou outra janela', !/Compartilhar conquista/.test(mk({ type: 'badgeInfo', id: 'pipoca', earned: false }, mine, { pipoca: [] }, PL)) && !/Compartilhar conquista/.test(mk({ type: 'badgeInfo', id: 'pipoca', earned: true }, null, { pipoca: ['Ana'] }, PL)) && !/Compartilhar conquista/.test(mk({ type: 'badgeInfo', id: 'pipoca', earned: true }, { earned: [{ id: 'baggio' }] }, { pipoca: ['Ana'] }, PL)) && !/Compartilhar conquista/.test(mk({ type: 'badgeInfo', id: 'pipoca', earned: true }, { earned: [] }, { pipoca: ['Ana'] }, PL)) && mk({ type: 'outra' }, mine, {}, PL) === '' && mk({ type: 'badgeInfo', id: 'nao-existe', earned: true }, mine, {}, PL) === '');
  check('"% dos elegíveis" da janela continua certo (mesma conta de antes): de linha 1 de 3 = 33%, de goleiro 1 de 1 = 100%, exclusiva 1 de 1, sem elenco 0%, "jogador" no singular e "jogadores" no plural', /1 jogador · 33% dos elegíveis/.test(mi) && /1 jogador · 100% dos elegíveis/.test(mk({ type: 'badgeInfo', id: 'tafarel', earned: true }, null, { tafarel: ['Bia'] }, PL)) && /1 jogador · 100% dos elegíveis/.test(mk({ type: 'badgeInfo', id: 'alex', earned: true }, null, { alex: ['Ana'] }, PL)) && /0 jogadores · 0% dos elegíveis/.test(mk({ type: 'badgeInfo', id: 'pipoca', earned: false }, null, {}, [])) && /2 jogadores · 67% dos elegíveis/.test(mk({ type: 'badgeInfo', id: 'pipoca', earned: true }, null, { pipoca: ['Ana', 'Caio'] }, PL)), mi.match(/\d+ jogador.{0,40}elegíveis/)?.[0]);

  // ══ 12. MANUAL (seção 29 e seção 13) ═══════════════════════════════════════════════════════════════
  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const sec29 = plainM(manual.slice(manual.indexOf('id="cartao-jogador"'), manual.indexOf('<!-- 30. Página de Apresentação')));
  const sec13 = plainM(manual.slice(manual.indexOf('id="conquistas"'), manual.indexOf('<h3>Presença</h3>')));
  check('manual: o título da seção 29 e as duas entradas do sumário dizem "Cartão do Jogador e das Conquistas (compartilhar)"', (manual.match(/Cartão do Jogador e das Conquistas \(compartilhar\)/g) || []).length === 3 && manual.includes('<!-- 29. Cartão do Jogador (compartilhar) -->'));
  check('manual: os três caminhos (janela da conquista, faixa de conquista nova, card Conquistas), só no próprio perfil e nunca na simulação do admin, só de conquista que o jogador já tem', /Compartilhar conquista/.test(sec29) && /Nova conquista desbloqueada/.test(sec29) && /Minhas conquistas/.test(sec29) && /Conquistas novas/.test(sec29) && /só no próprio perfil/.test(sec29) && /nunca na simulação do admin/.test(sec29) && /já tem/.test(sec29) && /Só você tem na liga!/.test(sec29) && /Só 2 jogadores da liga têm/.test(sec29), sec29.slice(0, 300));
  check('manual: a tabela de raridade (LENDÁRIA dourado: só 1 jogador; ÉPICA roxo: até 15%; RARA azul: até 35%; COMUM verde: o resto) e a base ("% dos elegíveis", goleiros e exclusivas)', /LENDÁRIA Dourado Só 1 jogador da liga tem a conquista/.test(sec29) && /ÉPICA Roxo Até 15% dos jogadores que podem ter/.test(sec29) && /RARA Azul Até 35% dos jogadores que podem ter/.test(sec29) && /COMUM Verde O resto/.test(sec29) && /% dos elegíveis/.test(sec29) && /não contam goleiros/.test(sec29) && /exclusivas de uma pessoa/.test(sec29) && /nível é da liga/.test(sec29), sec29.match(/LENDÁRIA.{0,200}/)?.[0]);
  check('manual: o cartão com várias toma a cor do nível mais alto, tem borda por nível (a comum sem borda) e legenda das cores; até 20 com nome, de 21 a 48 só ícones, acima de 48 "+N"', /nível mais alto/.test(sec29) && /borda/.test(sec29) && /a comum fica sem borda/.test(sec29) && /legenda das cores/.test(sec29) && /Raridade na liga/.test(sec29) && /Até 20 conquistas aparecem com o nome embaixo/.test(sec29) && /de 21 a 48 só os ícones/.test(sec29) && /acima de 48, os últimos viram "\+N"/.test(sec29), sec29.match(/O cartão com várias.{0,400}/)?.[0]);
  check('manual: o aviso de conquista nova (faixa dourada, nomes, botão, 7 dias ou ×, só neste aparelho, só os códigos, por conta e liga, nada vai ao servidor)', /Nova conquista desbloqueada!/.test(sec29) && /N novas conquistas desbloqueadas!/.test(sec29) && /fica por 7 dias ou até a pessoa tocar no ×/.test(sec29) && /só neste aparelho/.test(sec29) && /apenas os códigos das conquistas e a hora/.test(sec29) && /por conta e por liga/.test(sec29) && /nada vai ao servidor/.test(sec29) && /Em outro aparelho a faixa não aparece/.test(sec29), sec29.match(/Aviso de conquista nova.{0,400}/)?.[0]);
  check('manual: os quatro nomes de arquivo, o convite ?ref=cartao, os mesmos contadores do cartão (sem contador separado) e a legenda sem nome nem liga', Object.values(A.MJ_KINDS).slice(1).flatMap(k => [k.file.story, k.file.feed]).every(f => manual.includes('<code>' + f + '</code>')) && /\?ref=cartao/.test(sec29) && /mesmos contadores do cartão/.test(sec29) && /não há contador separado/.test(sec29) && /nunca levam o nome do jogador nem o da liga/.test(sec29));
  check('manual (técnico): MJ_KINDS, drawMjStoryOf, st._mjShare, mjByRarity, mjTierOf, badgeEligibleCount, MJ_TIERS, aceoma_newBadges, e que só o app muda (sem função, regra, evento nem canal novo)', ['MJ_KINDS', 'drawMjStoryOf', 'st._mjShare', 'mjByRarity', 'mjTierOf', 'badgeEligibleCount', 'MJ_TIERS', 'aceoma_newBadges', 'localStorage', 'cardOpen', 'cardShare'].every(x => sec29.includes(x)) && /Só o app muda: nenhuma função nem regra do servidor, e nenhum evento ou canal novo/.test(sec29), sec29.slice(-700));
  check('manual: a privacidade da seção 29 cita as conquistas (nome, foto, nome da liga, estatísticas e conquistas) e a seção 13 aponta para o compartilhar e para a cor da raridade', /Entram só nome, foto, nome da liga, estatísticas e conquistas que a própria pessoa já vê/.test(sec29) && /compartilhadas como imagem/.test(sec13) && /raridade/.test(sec13) && /seção 29/.test(sec13), sec13.slice(0, 500));
  check('manual × código: os números do manual são os do código (15% e 35% da raridade, 7 dias do aviso, 20 conquistas com nome e 48 no máximo)', /share <= 0\.15 \? 'epic' : share <= 0\.35 \? 'rare' : 'common'/.test(code) && A.NEW_BADGES_TTL === 7 * 24 * 60 * 60 * 1000 && A.mjGridLayout(20).label > 0 && A.mjGridLayout(21).label === 0 && /const MAX = 48;/.test(code) && A.MJ_TIER_ORDER.join() === 'legendary,epic,rare,common');

  // ══ 11. COMO ESTÁ LIGADO NO APP ═══════════════════════════════════════════════════════════════════
  const view = html.slice(html.indexOf('function vMeuJogador()'), html.indexOf('function vSelectLeague()') > html.indexOf('function vMeuJogador()') ? html.indexOf('function vSelectLeague()') : html.length);
  check('os dados para compartilhar só existem fora da simulação do admin e quando já há conquista; o total é ganhas + pendentes; a lista vem por raridade com a base de elegíveis', /st\._mjShare = \(!isSimulating && earnedBadges\.length\) \? \{/.test(view) && /total: earnedBadges\.length \+ lockedBadges\.length/.test(view) && /earned: mjByRarity\(earnedBadges\.map\(b => \(\{ id: b\.id, emoji: b\.emoji, label: b\.label, desc: b\.desc, holders: getBadgeHolders\(b\.id\)\.length, eligible: badgeEligibleCount\(b\) \}\)\)\)/.test(view) && /name: myName, league: st\.availableLeagues\.find\(l => l\.id === st\.leagueId\)\?\.name, photo: st\.photos\?\.\[myKey\]/.test(view));
  check('o botão 📤 Compartilhar fica no cabeçalho do card "Conquistas", só quando há dados (st._mjShare), e abre todas as conquistas', /\$\{st\._mjShare \? `<button onclick="openMjBadges\('all'\)"[^`]*📤 Compartilhar<\/button>` : ''\}\s*<span style="font-size:12px;font-weight:700;color:var\(--gold\)">\$\{earnedBadges\.length\}\/\$\{total\}<\/span>/.test(view));
  check('o aviso de conquista nova fica logo acima do banner do resumo, na aba EU', view.indexOf('${newBadgesBanner()}') > 0 && /\$\{newBadgesBanner\(\)\}\s*<div style="margin-bottom:16px">\$\{banner\}<\/div>/.test(view));
  check('toda conquista nova percebida (no 1º carregamento e durante a sessão) entra na lista do aviso ANTES de avisar o servidor', (view.match(/newBadgesAdd\(newBadges\.map\(b => b\.id\)\);\s*notifyNewBadges\(newBadges, allIds\)/g) || []).length === 2);
  check('a janela da conquista usa a mesma base de elegíveis (badgeEligibleCount) e só mostra o botão para conquista que o jogador tem, no próprio perfil', /const nEligible = badgeEligibleCount\(b\);/.test(modalCode) && !/allP\.filter/.test(modalCode) && /const canShare = !!\(m\.earned && st\._mjShare\?\.earned\?\.some\(x => x\.id === b\.id\)\);/.test(modalCode));
  check('nenhum contador novo no servidor: o módulo só usa cardOpen e cardShare e um único link (?ref=cartao); não há canal nem evento novo para publicar nas funções', JSON.stringify([...new Set([...code.matchAll(/trackEvent\('([A-Za-z]+)'/g)].map(m => m[1]))].sort()) === JSON.stringify(['cardOpen', 'cardShare']) && (code.match(/\?ref=/g) || []).length === 1 && /LINK: 'https:\/\/peladanamao\.com\.br\/\?ref=cartao'/.test(code) && !/trackEvent/.test(bannerCode));
  const srcPriv = slice('function mjBadgeData', 'function mjRoundRect') + slice('function drawMjStoryOf', 'function mjLoadImage');
  check('PRIVACIDADE: o código que monta e desenha os cartões de conquista nem cita e-mail, WhatsApp, contatos nem a conta logada', !/whatsapp|e-?mail|contacts|authUser|waOf|\.uid/i.test(srcPriv), srcPriv.match(/.{20}(whatsapp|e-?mail|contacts|authUser|waOf|\.uid).{20}/i)?.[0]);
  const uiSrc = slice('const mjSheet', 'async function copyMjCaption') + slice('function mjBadgeCaption', 'async function copyMjCaption') + slice('const MJ_KINDS', 'const mjKindNow');
  check('PRIVACIDADE: a janela, os textos e as legendas dos cartões não citam e-mail, contatos nem a conta logada (o aviso "Não leva e-mail nem WhatsApp" é o único trecho que fala disso)', !/contacts|authUser|waOf|\.uid|\.email/i.test(uiSrc.replace(/Não leva e-mail nem WhatsApp\./g, '')), uiSrc.match(/.{20}(contacts|authUser|waOf|\.uid|\.email).{20}/i)?.[0]);
  check('o aviso de conquista nova só guarda os códigos das conquistas no aparelho (sem nome, e-mail nem WhatsApp); o servidor não é chamado', !/callFn|DB\.|fetch\(|whatsapp|e-?mail/i.test(bannerCode.replace(/\/\/[^\n]*/g, '')) && /localStorage/.test(bannerCode));
  check('a política de privacidade do app cita as conquistas junto do cartão do jogador', /Cartão do jogador:<\/strong> a imagem é montada no seu aparelho, com os dados que você já vê \(nome, foto, estatísticas e conquistas\), e só sai dele se você tocar em Compartilhar \(vale também para as imagens das suas conquistas\)\. Nunca leva e-mail nem WhatsApp\./.test(html));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
