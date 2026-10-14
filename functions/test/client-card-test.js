// Cartão do jogador (index.html): extrai as funções reais e as executa num ambiente simulado, sem navegador.
// O cartão é montado no aparelho com o que a aba Meu Craque calculou, nunca leva contato (e-mail, WhatsApp), cabe
// nas medidas, cai para as iniciais quando a foto não carrega e só sai do aparelho se a pessoa compartilhar.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const code = slice('const MJ_CARD = {', '/* ── Painel do dono');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// ── contexto de desenho falso: guarda o que foi desenhado e mede texto como "0,5 × tamanho da fonte por letra" ──
function fakeCtx() {
  const ctx = { texts: [], images: [], strokes: [], fills: [], fillRects: [], radials: [], k: 1, tx: 0, ty: 0, stack: [], clips: 0, saves: 0, restores: 0, font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: 'left', textBaseline: 'alphabetic' };
  const size = () => Number((/(\d+)px/.exec(ctx.font) || [0, 16])[1]);
  const noop = () => {};
  Object.assign(ctx, {
    beginPath: noop, closePath: noop, moveTo: noop, arcTo: noop, arc: noop, rect: noop,
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: (...a) => { ctx.radials.push(a); return { addColorStop: noop }; },
    save() { ctx.saves++; ctx.stack.push([ctx.k, ctx.tx, ctx.ty]); }, restore() { ctx.restores++; [ctx.k, ctx.tx, ctx.ty] = ctx.stack.pop() || [1, 0, 0]; }, clip() { ctx.clips++; },
    translate(x, y) { ctx.tx += ctx.k * x; ctx.ty += ctx.k * y; }, scale(s) { ctx.k *= s; }, fillRect(x, y, w, h) { ctx.fillRects.push({ x, y, w, h }); },
    stroke() { ctx.strokes.push(ctx.strokeStyle); }, fill() { ctx.fills.push(ctx.fillStyle); },
    drawImage(img, ...a) { ctx.images.push({ img, args: a, ax: ctx.tx + ctx.k * a[0], ay: ctx.ty + ctx.k * a[1], aw: ctx.k * a[2], ah: ctx.k * a[3], clipped: ctx.clips > 0 && ctx.saves > ctx.restores }); },
    measureText: t => ({ width: String(t).length * size() * 0.5 }),
    fillText(text, x, y) { ctx.texts.push({ text: String(text), x, y, ax: ctx.tx + ctx.k * x, ay: ctx.ty + ctx.k * y, k: ctx.k, font: ctx.font, fill: ctx.fillStyle, align: ctx.textAlign }); },
  });
  return ctx;
}

// ── ambiente do aplicativo falso ────────────────────────────────────────────────────────────────
function makeEnv({ canShare = true, shareImpl, imageFails = [], toBlobFailsWithPhoto = false, toBlobAlwaysFails = false, copyOk = true } = {}) {
  const calls = { events: [], toasts: [], shared: [], clicks: [], revoked: [], canvases: [], copied: [], urlBlobs: new Map() };
  let urlN = 0;
  const fakeUrl = { createObjectURL: b => { const u = `blob:teste/${++urlN}-${b.size}`; calls.urlBlobs.set(u, b); return u; }, revokeObjectURL: u => { calls.revoked.push(u); } }; // cada imagem ganha o seu endereço, e soltar cada um é registrado
  const layers = [];
  const doc = {
    fonts: { load: async () => [] },
    getElementById: id => layers.find(x => x.id === id) || null, // o próprio elemento, como no navegador
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
  const env = {
    st: { _mjCard: null }, document: doc, navigator: nav, Image: FakeImage, URL: fakeUrl, pixCopyText: async t => { calls.copied.push(t); return copyOk; },
    trackEvent: (n, once = true) => { calls.events.push([n, once]); },
    toast: (m, t) => { calls.toasts.push([m, t]); },
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { MJ_CARD, MJ_STORY, MJ_FORMATS, mjCardData, mjFitText, drawMjBackground, drawMjCard, drawMjStory, renderMjCard, openMjCard, closeMjCard, setMjFormat, downloadMjCard, shareMjCard, copyMjCaption, mjCaption, getBlobs: () => _mjBlobs, getUrls: () => _mjUrls, getFormat: () => _mjFormat };')(...names.map(n => env[n]));
  return { api, env, calls, layers };
}

const SRC = { name: 'Ana Maria Souza', league: 'Série B Aceoma', photo: 'https://res.cloudinary.com/x/foto.jpg', titlesText: '3½', titlesNum: 3.5, subtitle: '3½× campeão', champs: 14, champsTotal: 20, goals: 27, goalsNote: 'desde 08/09/2026', art: 4, w: 12, d: 3, l: 5, matches: 20,
  badges: [{ emoji: '🛡️', label: 'Invicto' }, { emoji: '🏆', label: 'Campeão' }, { emoji: '⭐', label: 'Estreante' }] };
const { api: A } = makeEnv();

// ── mjCardData: o que entra no cartão ───────────────────────────────────────────────────────────
let c = A.mjCardData(SRC);
check('dados do cartão: nome, liga, iniciais, subtítulo e campeão', c.name === 'Ana Maria Souza' && c.league === 'Série B Aceoma' && c.initials === 'AM' && c.subtitle === '3½× campeão' && c.isChampion === true, c);
check('…os quatro números (títulos com ½, campeonatos, gols com a nota da data, artilharia)', JSON.stringify(c.stats.map(s => [s[0], s[1]])) === JSON.stringify([['TÍTULOS', '3½'], ['CAMPEONATOS', '14'], ['GOLS', '27'], ['ARTILHARIA', '4']]) && c.stats[1][2] === 'de 20 realizados' && c.stats[2][2] === 'desde 08/09/2026', c.stats);
check('…a campanha (vitórias, empates, derrotas, jogos) e as conquistas na ordem recebida', JSON.stringify(c.record) === JSON.stringify({ w: 12, d: 3, l: 5, matches: 20 }) && c.badges.map(b => b.label).join() === 'Invicto,Campeão,Estreante', c);
check('…a foto só vale se for https', c.photo === SRC.photo && ['http://x/f.jpg', 'javascript:alert(1)', '/foto.jpg', 'data:image/png;base64,AAAA', 123, null, undefined].every(p => A.mjCardData({ ...SRC, photo: p }).photo === ''));
check('sem nome: "Jogador"; sem estatística nenhuma: zeros e sem campanha', (() => { const z = A.mjCardData({}); return z.name === 'Jogador' && z.initials === 'J' && z.record === null && z.stats.every(s => s[1] === '0' || s[1] === '0') && z.badges.length === 0 && z.isChampion === false; })());
check('números negativos, quebrados ou inválidos viram inteiros ≥ 0', (() => { const z = A.mjCardData({ goals: -5, champs: 'abc', art: 2.6, w: null, matches: 3.4 }); return z.stats[2][1] === '0' && z.stats[1][1] === '0' && z.stats[3][1] === '3' && z.record.matches === 3 && z.record.w === 0; })());
check('no máximo 6 conquistas, e só as que têm emoji e nome', (() => { const many = Array.from({ length: 9 }, (_, i) => ({ emoji: '⭐', label: 'B' + i })); const z = A.mjCardData({ badges: [...many, { emoji: '', label: 'x' }, { emoji: '⭐' }, null] }); const y = A.mjCardData({ badges: [{ emoji: '', label: 'x' }, { emoji: '⭐' }, null, { emoji: '🏆', label: 'Ok' }] }); return z.badges.length === 6 && y.badges.length === 1 && y.badges[0].label === 'Ok'; })());
check('iniciais: duas letras do nome, uma para nome único', A.mjCardData({ name: 'Pelé' }).initials === 'P' && A.mjCardData({ name: '  joão  da  silva ' }).initials === 'JD');
const comContato = A.mjCardData({ ...SRC, whatsapp: '11999998888', email: 'ana@x.com', uid: 'abc123', phone: '1133334444' });
check('PRIVACIDADE: e-mail, WhatsApp, telefone e id de conta que cheguem por engano NÃO entram nos dados do cartão', !/11999998888|ana@x\.com|abc123|1133334444|whatsapp|email/i.test(JSON.stringify(comContato)), comContato);
const srcPriv = slice('function mjCardData', 'function mjRoundRect') + slice('function drawMjCard', 'function mjLoadImage');
check('PRIVACIDADE: o código que monta e desenha o cartão nem cita e-mail, WhatsApp, contatos nem a conta logada', !/whatsapp|e-?mail|contacts|authUser|waOf|\.uid/i.test(srcPriv), srcPriv.match(/.{20}(whatsapp|e-?mail|contacts|authUser|waOf|\.uid).{20}/i)?.[0]);

// ── mjFitText ───────────────────────────────────────────────────────────────────────────────────
let ctx = fakeCtx();
check('texto que cabe: fica como está, na fonte inicial', A.mjFitText(ctx, 'ANA', 900, 100, 50, 'Inter', 700) === 'ANA' && ctx.font === '700 100px Inter');
const t1 = A.mjFitText(ctx, 'X'.repeat(30), 900, 100, 50, 'Inter', 700);
check('texto largo: diminui a fonte até caber (30 letras a 100px = 1500; cabe a 60px)', t1.length === 30 && Number(/(\d+)px/.exec(ctx.font)[1]) === 60, ctx.font);
const t2 = A.mjFitText(ctx, 'Y'.repeat(80), 900, 100, 50, 'Inter', 700);
check('texto enorme: chega no mínimo, corta e põe reticências, e o que sobra cabe na largura', t2.endsWith('…') && ctx.measureText(t2).width <= 900 && t2.length < 80, { t2len: t2.length, w: ctx.measureText(t2).width });

// ── drawMjCard ──────────────────────────────────────────────────────────────────────────────────
const photo = { naturalWidth: 400, naturalHeight: 300, __photo: true }, logo = { naturalWidth: 1024, naturalHeight: 1024 };
ctx = fakeCtx();
c = A.mjCardData(SRC);
A.drawMjCard(ctx, c, photo, logo);
const said = ctx.texts.map(t => t.text);
check('o cartão escreve o nome em maiúsculas, a liga, o subtítulo e a chamada do rodapé com o endereço', said.includes('ANA MARIA SOUZA') && said.includes('Série B Aceoma') && said.includes('3½× campeão') && said.includes('Crie a liga da sua pelada') && said.includes('peladanamao.com.br'), said);
check('…os quatro números e seus nomes', ['3½', '14', '27', '4', 'TÍTULOS', 'CAMPEONATOS', 'GOLS', 'ARTILHARIA'].every(x => said.includes(x)), said);
check('…as notas dos quadros ("de 20 realizados", "desde 08/09/2026")', said.includes('de 20 realizados') && said.includes('desde 08/09/2026'));
check('…as conquistas (emojis) e o nome da mais rara', ['🛡️', '🏆', '⭐'].every(e => said.includes(e)) && said.includes('Conquista mais rara: Invicto'), said);
check('…a campanha: V 12, E 3, D 5 e "20 jogos"', said.includes('V 12') && said.includes('E 3') && said.includes('D 5') && said.includes('20 jogos'), said);
check('com foto: a foto é desenhada DENTRO do recorte redondo e cobre o círculo; o logo vem no topo', ctx.images.length === 2 && ctx.images[0].img === logo && ctx.images[1].img === photo && ctx.images[1].clipped === true && ctx.images[1].args[2] >= 280 && ctx.images[1].args[3] >= 280, ctx.images.map(i => ({ w: i.args[2], h: i.args[3], clipped: i.clipped })));
check('campeão: moldura dourada; quem nunca foi campeão: moldura verde', ctx.strokes.includes('#f0b429') && !fakeDraw({ ...SRC, titlesNum: 0, titlesText: '0' }).strokes.includes('#f0b429') && fakeDraw({ ...SRC, titlesNum: 0, titlesText: '0' }).strokes.includes('#00d67f'));
function fakeDraw(src, ph = photo, lg = logo) { const x = fakeCtx(); A.drawMjCard(x, A.mjCardData(src), ph, lg); return x; }
const sem = fakeDraw(SRC, null, null);
check('sem foto (e sem logo): desenha as iniciais no lugar, sem imagem nenhuma e sem quebrar', sem.images.length === 0 && sem.texts.some(t => t.text === 'AM'), sem.texts.map(t => t.text));
// dentro das medidas
const W = A.MJ_CARD.W, H = A.MJ_CARD.H;
const fora = ctx.texts.filter(t => t.x < 0 || t.x > W || t.y < 0 || t.y > H);
check('todo texto está dentro da imagem (1080×1350)', fora.length === 0 && A.MJ_CARD.W === 1080 && A.MJ_CARD.H === 1350, fora);
const footerY = Math.min(...ctx.texts.filter(t => t.text === 'Crie a liga da sua pelada').map(t => t.y));
const acima = ctx.texts.filter(t => !['Crie a liga da sua pelada', 'peladanamao.com.br'].includes(t.text)).map(t => t.y);
check('NADA bate no rodapé: o último texto do corpo (campanha) fica bem acima da chamada', Math.max(...acima) + 12 < footerY - 32, { maxBody: Math.max(...acima), footerY });
const larguras = ctx.texts.filter(t => t.text === 'ANA MARIA SOUZA').map(t => t.text.length * Number(/(\d+)px/.exec(t.font)[1]) * 0.5);
check('o nome cabe nos 920 px do cartão', larguras.length === 1 && larguras[0] <= 920, larguras);
const longo = fakeDraw({ ...SRC, name: 'Fulano de Tal da Silva Sauro Pereira Gonçalves de Albuquerque Junior Neto Filho' });
const nomeLongo = longo.texts.find(t => /FULANO/.test(t.text));
check('nome enorme: encolhe/corta com reticências e continua dentro da largura', !!nomeLongo && nomeLongo.text.length * Number(/(\d+)px/.exec(nomeLongo.font)[1]) * 0.5 <= 920, nomeLongo);
const semBadges = fakeDraw({ ...SRC, badges: [] });
check('sem conquistas: não escreve a legenda e os quadros sobem para o espaço (não deixam buraco)', !semBadges.texts.some(t => /Conquista mais rara/.test(t.text)) && semBadges.texts.find(t => t.text === '3½' && t.font.includes('76px')).y === 740 + 80, semBadges.texts.find(t => t.text === '3½'));
const todas = fakeDraw({ ...SRC, badges: Array.from({ length: 8 }, (_, i) => ({ emoji: ['🥇', '🥈', '🥉', '⭐', '🛡️', '🏆', '⚡', '🔥'][i], label: 'B' + i })) });
const emojis = todas.texts.filter(t => /^(🥇|🥈|🥉|⭐|🛡️|🏆|⚡|🔥)$/.test(t.text));
check('com 8 conquistas mostra só 6, simétricas em torno do centro e dentro da imagem', emojis.length === 6 && Math.abs(emojis.reduce((s, t) => s + t.x, 0) / 6 - 540) < 0.01 && emojis.every(t => t.x > 60 && t.x < W - 60), emojis.map(t => t.x));
const semTudo = fakeDraw({ name: 'Zé' }, null, null);
check('só com o nome (sem liga, subtítulo, campanha, conquistas): desenha e não escreve nada vazio', semTudo.texts.every(t => t.text.trim().length > 0) && !semTudo.texts.some(t => /^V \d|jogo/.test(t.text)) && semTudo.texts.some(t => t.text === 'ZÉ'), semTudo.texts.map(t => t.text));
check('um jogo só: "1 jogo" no singular', fakeDraw({ ...SRC, matches: 1, w: 1, d: 0, l: 0 }).texts.some(t => t.text === '1 jogo'));

// ── abrir, compartilhar, baixar ─────────────────────────────────────────────────────────────────
const tick = () => new Promise(r => setTimeout(r, 15));
(async () => {
  let e = makeEnv();
  await e.api.openMjCard();
  check('sem dados do cartão (quem ainda não jogou): nada abre e nada é contado', e.layers.length === 0 && e.calls.events.length === 0);
  e.env.st._mjCard = c; // o código lê st._mjCard; o objeto é o mesmo `st` capturado pela função
  e = makeEnv(); e.env.st._mjCard = c;
  const opening = e.api.openMjCard();
  check('abrir: a camada aparece na hora com "Montando seu cartão…" e conta a abertura (uma vez por sessão)', e.layers.length === 1 && e.layers[0].id === 'mj-card' && /Montando seu cartão/.test(e.layers[0].innerHTML) && JSON.stringify(e.calls.events) === JSON.stringify([['cardOpen', true]]), { layers: e.layers.map(l => l.id), ev: e.calls.events });
  await opening;
  const inner = e.layers[0].innerHTML;
  check('…e quando fica pronto mostra a imagem e os botões Compartilhar, Copiar legenda e Baixar, com o aviso de privacidade', /<img src="blob:/.test(inner) && /shareMjCard\(\)/.test(inner) && /copyMjCaption\(\)/.test(inner) && /downloadMjCard\(\)/.test(inner) && /não leva e-mail nem WhatsApp/i.test(inner) && !!e.api.getBlobs()?.story && !!e.api.getBlobs()?.feed && !!e.api.getUrls()?.story && !!e.api.getUrls()?.feed, inner.slice(-700));
  check('…as duas imagens foram desenhadas, cada uma com a foto e o logo: Feed 1080×1350 e Story 1080×1920', e.calls.canvases.length === 2 && e.calls.canvases[0].width === 1080 && e.calls.canvases[0].height === 1350 && e.calls.canvases[1].width === 1080 && e.calls.canvases[1].height === 1920 && e.calls.canvases.every(cv => cv.ctx.images.length === 2), e.calls.canvases.map(x => [x.width, x.height, x.ctx.images.length]));

  // compartilhar pela janela do celular
  await e.api.shareMjCard();
  const sh = e.calls.shared[0];
  check('compartilhar (a janela abre no Story): usa a janela do celular com o arquivo PNG do Story, o título e o texto com o link ?ref=cartao', e.calls.shared.length === 1 && sh.files.length === 1 && sh.files[0].name === 'cartao-pelada-na-mao-story.png' && sh.files[0].type === 'image/png' && /peladanamao\.com\.br\/\?ref=cartao/.test(sh.text) && /Pelada na Mão/.test(sh.title), sh);
  check('…conta o toque (sempre) e NÃO baixa nada quando o compartilhamento deu certo', JSON.stringify(e.calls.events.slice(-1)) === JSON.stringify([['cardShare', false]]) && e.calls.clicks.length === 0);

  // cancelou
  let e2 = makeEnv({ shareImpl: async () => { const err = new Error('cancelado'); err.name = 'AbortError'; throw err; } }); e2.env.st._mjCard = c;
  await e2.api.openMjCard(); await e2.api.shareMjCard();
  check('a pessoa cancelou a janela de compartilhar: não é erro, não baixa nada e não mostra aviso', e2.calls.clicks.length === 0 && e2.calls.toasts.length === 0);
  // erro de verdade
  e2 = makeEnv({ shareImpl: async () => { throw new Error('falhou'); } }); e2.env.st._mjCard = c;
  await e2.api.openMjCard(); await e2.api.shareMjCard();
  check('o compartilhamento falhou de verdade: cai para baixar a imagem', e2.calls.clicks.length === 1 && e2.calls.clicks[0].download === 'cartao-pelada-na-mao-story.png' && e2.calls.toasts.some(([m, t]) => /Imagem salva/.test(m) && t === 'ok'), e2.calls);
  // sem suporte (computador)
  e2 = makeEnv({ canShare: false }); e2.env.st._mjCard = c;
  await e2.api.openMjCard(); await e2.api.shareMjCard();
  check('o aparelho não compartilha arquivo (computador, navegador antigo): baixa a imagem em vez de ficar parado', e2.calls.shared.length === 0 && e2.calls.clicks.length === 1, e2.calls);
  await e2.api.downloadMjCard();
  check('baixar: o link do arquivo é o da imagem montada', e2.calls.clicks.every(k => /^blob:/.test(k.href)));

  // antes de abrir / depois de fechar
  e2 = makeEnv(); e2.env.st._mjCard = c;
  await e2.api.shareMjCard(); e2.api.downloadMjCard();
  check('sem cartão montado: compartilhar e baixar não fazem nada e não contam', e2.calls.shared.length === 0 && e2.calls.clicks.length === 0 && e2.calls.events.length === 0);
  await e2.api.openMjCard();
  e2.api.closeMjCard();
  await e2.api.shareMjCard();
  check('fechar: some a camada, solta a imagem da memória e o compartilhar deixa de existir', e2.layers.length === 0 && e2.api.getBlobs() === null && e2.api.getUrls() === null && e2.calls.shared.length === 0);
  const e3 = makeEnv(); e3.env.st._mjCard = c;
  const op3 = e3.api.openMjCard(); e3.api.closeMjCard(); await op3;
  check('fechou antes de a imagem ficar pronta: a camada não ressuscita e nada fica guardado na memória (imagem e endereço dela)', e3.layers.length === 0 && e3.api.getBlobs() === null && e3.api.getUrls() === null, { layers: e3.layers.length, blobs: !!e3.api.getBlobs(), urls: e3.api.getUrls() });

  // foto que não carrega / foto que contamina o canvas / falha total
  const f1 = makeEnv({ imageFails: ['cloudinary'] }); f1.env.st._mjCard = c;
  await f1.api.openMjCard();
  check('a foto não carrega (erro de rede): o cartão sai com as iniciais, sem erro', /<img src="blob:/.test(f1.layers[0].innerHTML) && f1.calls.canvases.length === 2 && f1.calls.canvases.every(cv => cv.ctx.images.length === 1 && cv.ctx.texts.some(t => t.text === 'AM')), f1.calls.canvases.map(x => x.ctx.images.length));
  const f2 = makeEnv({ toBlobFailsWithPhoto: true }); f2.env.st._mjCard = c;
  await f2.api.openMjCard();
  check('a foto "contaminou" o canvas (servidor sem CORS): refaz o cartão sem a foto e entrega a imagem', f2.calls.canvases.length === 4 && /<img src="blob:/.test(f2.layers[0].innerHTML) && f2.calls.canvases.slice(2).every(cv => cv.ctx.texts.some(t => t.text === 'AM')), f2.calls.canvases.length);
  const f3 = makeEnv({ toBlobAlwaysFails: true }); f3.env.st._mjCard = c;
  await f3.api.openMjCard();
  check('não consegue gerar a imagem de jeito nenhum: mostra a mensagem de erro (e nenhum botão de compartilhar)', /Não foi possível montar o cartão/.test(f3.layers[0].innerHTML) && !/shareMjCard/.test(f3.layers[0].innerHTML));
  const f4 = makeEnv(); f4.env.st._mjCard = A.mjCardData({ name: 'Sem Foto', champs: 2 }); await f4.api.openMjCard();
  check('jogador sem foto: o cartão sai direto com as iniciais (só o logo é carregado)', /<img src="blob:/.test(f4.layers[0].innerHTML) && f4.calls.canvases[0].ctx.images.length === 1);

  // ── ligação com a aba Meu Craque ──────────────────────────────────────────────────────────────
  const view = html.slice(html.indexOf('function vMeuJogador()'), html.indexOf('function vSelectLeague()') > html.indexOf('function vMeuJogador()') ? html.indexOf('function vSelectLeague()') : html.length);
  check('os dados do cartão só existem fora da simulação do admin e para quem já jogou (champsPlayed > 0)', /st\._mjCard = \(!isSimulating && champsPlayed > 0\) \? mjCardData\(/.test(html), null);
  check('os dados vêm dos números que a própria aba calculou (títulos, gols, artilharia, campanha, conquistas por raridade)', /titlesText: fmtT\(titles\)/.test(html) && /goals: totalGoals/.test(html) && /art: myArt/.test(html) && /w: myW, d: myD, l: myL, matches: myMatchesPlayed/.test(html) && /getBadgeHolders\(a\.id\)\.length - getBadgeHolders\(b\.id\)\.length/.test(html));
  check('o botão "Compartilhar meu cartão" fica embaixo do nome e só aparece quando há cartão', /\$\{st\._mjCard \? `<button onclick="openMjCard\(\)"[^`]*📤 Compartilhar meu cartão/.test(html));
  check('os três contadores do cartão estão na lista de eventos do painel', ['cardOpen', 'cardShare', 'cardVisit'].every(n => html.includes("'" + n + "'")));
  // ══ Story (9:16) e Feed (4:5) ═══════════════════════════════════════════════════════════════════════
  // O cartão saía só em 4:5 (1080×1350). No editor de vídeo (Reels, Edits) uma imagem 4:5 é ampliada para preencher e perde o topo (logo) e o
  // rodapé (endereço do site): visto no celular do dono em 14/10/2026. Agora há o Story 9:16 (1080×1920) com o cartão INTEIRO entre as margens que
  // o Instagram cobre, e o Feed 4:5 de sempre, e a pessoa escolhe na janela do cartão.
  const S = A.MJ_STORY;
  check('Story: 1080×1920 (9:16), com margens de 250 px em cima (foto de perfil do Instagram) e 340 px embaixo (caixa de resposta)', S.W === 1080 && S.H === 1920 && S.TOP === 250 && S.BOTTOM === 340 && Math.abs(S.W / S.H - 9 / 16) < 1e-9, S);
  check('os dois formatos: Story 9:16 (cartao-pelada-na-mao-story.png) e Feed 4:5 (cartao-pelada-na-mao.png, o de sempre, 1080×1350)', A.MJ_FORMATS.story.ratio === '9:16' && A.MJ_FORMATS.story.file === 'cartao-pelada-na-mao-story.png' && A.MJ_FORMATS.feed.ratio === '4:5' && A.MJ_FORMATS.feed.file === 'cartao-pelada-na-mao.png' && A.MJ_CARD.W / A.MJ_CARD.H === 0.8, A.MJ_FORMATS);
  const kS = (S.H - S.TOP - S.BOTTOM) / A.MJ_CARD.H;
  const sctx = fakeCtx(); A.drawMjStory(sctx, c, photo, logo);
  const fctx = fakeCtx(); A.drawMjCard(fctx, c, photo, logo);
  check('Story: o fundo é pintado na imagem INTEIRA (1080×1920) e o cartão não pinta outro fundo de 1080×1350 por cima (sem emenda)', sctx.fillRects.filter(r => r.w === 1080 && r.h === 1920 && r.x === 0 && r.y === 0).length === 2 && !sctx.fillRects.some(r => r.h === 1350), sctx.fillRects);
  check('Feed: continua pintando o fundo UMA vez em 1080×1350 (degradê e clarão), sem escala nem deslocamento (igual ao de antes)', fctx.fillRects.filter(r => r.w === 1080 && r.h === 1350).length === 2 && fctx.k === 1 && fctx.tx === 0 && fctx.ty === 0 && fctx.texts.every(t => t.k === 1 && t.ax === t.x && t.ay === t.y), fctx.fillRects);
  check('o clarão atrás da foto: no Feed em (540, 330) com raio 500; no Story acompanha o cartão (y = 250 + 330·k, raio 500·k)', JSON.stringify(fctx.radials[0]) === JSON.stringify([540, 330, 20, 540, 330, 500]) && Math.abs(sctx.radials[0][1] - (250 + 330 * kS)) < 1e-6 && Math.abs(sctx.radials[0][5] - 500 * kS) < 1e-6, { feed: fctx.radials[0], story: sctx.radials[0] });
  check('Story: o cartão INTEIRO vai escalado (k = 1330/1350 ≈ 0,985): nenhum texto passa das margens de cima (250) e de baixo (1920 − 340 = 1580) nem das laterais', sctx.texts.length > 0 && sctx.texts.every(t => Math.abs(t.k - kS) < 1e-9 && t.ay >= S.TOP && t.ay <= S.H - S.BOTTOM && t.ax >= 0 && t.ax <= S.W), sctx.texts.map(t => [t.text, Math.round(t.ax), Math.round(t.ay)]).filter(x => x[2] < 250 || x[2] > 1580));
  const rodapeStory = sctx.texts.find(t => t.text === 'peladanamao.com.br');
  check('Story: o endereço do site (rodapé do cartão) fica ACIMA da caixa de resposta do Instagram (y ≤ 1580) e o logo dentro da área segura (que era o que o corte do 4:5 levava)', !!rodapeStory && rodapeStory.ay <= 1580 && sctx.images[0].img === logo && sctx.images[0].ay >= S.TOP && sctx.images[0].ay + sctx.images[0].ah <= S.H - S.BOTTOM, { rodape: rodapeStory && rodapeStory.ay, logo: sctx.images[0] });
  const nomeS = sctx.texts.find(t => t.text === 'ANA MARIA SOUZA');
  check('Story: o cartão fica centralizado na horizontal (o nome, que é centrado no cartão, cai no meio da imagem: x = 540)', !!nomeS && Math.abs(nomeS.ax - 540) < 1e-6, nomeS);
  check('Story: o cartão tem exatamente os mesmos textos do Feed (nada a mais, nada a menos) e a mesma foto no recorte redondo', JSON.stringify(sctx.texts.map(t => t.text)) === JSON.stringify(fctx.texts.map(t => t.text)) && sctx.images.length === 2 && sctx.images[1].img === photo, { story: sctx.texts.length, feed: fctx.texts.length });
  check('Story: a transformação é desfeita no fim (save/restore equilibrados, sem escala nem deslocamento sobrando)', sctx.saves === sctx.restores && sctx.k === 1 && sctx.tx === 0 && sctx.ty === 0, { saves: sctx.saves, restores: sctx.restores, k: sctx.k });
  const sSem = fakeCtx(); A.drawMjStory(sSem, A.mjCardData({ ...SRC, titlesNum: 0, titlesText: '0' }), null, null);
  check('Story sem foto e sem logo: iniciais no lugar, sem imagem, moldura verde (quem nunca foi campeão), e nada quebra; campeão: moldura dourada', sSem.images.length === 0 && sSem.texts.some(t => t.text === 'AM') && sSem.strokes.includes('#00d67f') && sctx.strokes.includes('#f0b429'), sSem.strokes);

  // ── a janela do cartão: Story ou Feed ────────────────────────────────────────────────────────────────
  let u = makeEnv(); u.env.st._mjCard = c;
  await u.api.openMjCard();
  let htmlU = u.layers[0].innerHTML;
  check('abre no formato Story (o do status e dos Stories): o botão Story marcado (aria-pressed=true), o Feed não, a imagem do Story e o texto dizendo para que serve', /setMjFormat\('story'\)" aria-pressed="true"/.test(htmlU) && /setMjFormat\('feed'\)" aria-pressed="false"/.test(htmlU) && /formato Story/.test(htmlU) && /Para Stories do Instagram e do Facebook, Reels e o status do WhatsApp/.test(htmlU) && !/escolha 4:5/.test(htmlU) && u.api.getFormat() === 'story', htmlU.slice(0, 900));
  check('as duas imagens ficam PRONTAS ao abrir (o iPhone só deixa compartilhar arquivo logo depois de um toque: nada a montar depois), com endereços diferentes, e a prévia usa a do Story', !!u.api.getBlobs().story && !!u.api.getBlobs().feed && u.api.getUrls().story !== u.api.getUrls().feed && htmlU.includes(u.api.getUrls().story) && !htmlU.includes(u.api.getUrls().feed), u.api.getUrls());
  check('cada endereço aponta para a imagem do SEU formato (o do Story para a imagem do Story, o do Feed para a do Feed), e as duas imagens são diferentes', u.calls.urlBlobs.get(u.api.getUrls().story) === u.api.getBlobs().story && u.calls.urlBlobs.get(u.api.getUrls().feed) === u.api.getBlobs().feed && u.api.getBlobs().story !== u.api.getBlobs().feed, u.calls.urlBlobs.size);
  check('o Feed e o Story são imagens diferentes: 1080×1350 e 1080×1920 (dois canvases)', u.calls.canvases.length === 2 && u.calls.canvases[0].height === 1350 && u.calls.canvases[1].height === 1920 && u.calls.canvases.every(cv => cv.width === 1080), u.calls.canvases.map(x => [x.width, x.height]));
  check('cada imagem sai do seu desenho: o Feed (1º canvas) pelo desenho do cartão, sem escala, com o fundo de 1080×1350; o Story (2º canvas) pelo desenho do Story, com o fundo de 1080×1920 e o cartão escalado', u.calls.canvases[0].ctx.fillRects.some(r => r.h === 1350) && u.calls.canvases[0].ctx.texts.every(t => t.k === 1) && u.calls.canvases[1].ctx.fillRects.some(r => r.h === 1920) && u.calls.canvases[1].ctx.texts.every(t => Math.abs(t.k - kS) < 1e-9), u.calls.canvases.map(x => [x.height, x.ctx.texts[0] && x.ctx.texts[0].k]));
  u.api.setMjFormat('feed');
  htmlU = u.layers[0].innerHTML;
  check('tocar em Feed: troca a prévia para a imagem do Feed (sem montar nada de novo), marca o Feed e muda o texto', u.api.getFormat() === 'feed' && /setMjFormat\('feed'\)" aria-pressed="true"/.test(htmlU) && /setMjFormat\('story'\)" aria-pressed="false"/.test(htmlU) && htmlU.includes(u.api.getUrls().feed) && !htmlU.includes(u.api.getUrls().story) && /formato Feed/.test(htmlU) && /Para publicações do Instagram e conversas\. Se o Instagram mostrar o cartão cortado \(ele abre em quadrado\), toque no botão de proporção do editor \(ícone de cantos\) e escolha 4:5\./.test(htmlU) && u.calls.canvases.length === 2, htmlU.slice(0, 700));
  check('o aviso de privacidade, o aviso da legenda do Instagram e os 3 botões (Compartilhar, Copiar legenda, Baixar) continuam depois de trocar o formato', /shareMjCard\(\)/.test(htmlU) && /copyMjCaption\(\)/.test(htmlU) && /downloadMjCard\(\)/.test(htmlU) && /não leva e-mail nem WhatsApp/i.test(htmlU) && /No Instagram a legenda não vai junto com a imagem/.test(htmlU), htmlU.slice(-600));
  await u.api.shareMjCard();
  let sh2 = u.calls.shared[0];
  check('compartilhar no Feed: o arquivo é o do Feed (cartao-pelada-na-mao.png, a imagem de 1350 px de altura), com o mesmo texto e o link ?ref=cartao de sempre', sh2.files[0].name === 'cartao-pelada-na-mao.png' && (await sh2.files[0].text()) === 'png1350' && /\?ref=cartao/.test(sh2.text), sh2.files[0].name);
  u.api.setMjFormat('story'); await u.api.shareMjCard();
  sh2 = u.calls.shared[1];
  check('compartilhar no Story: o arquivo é o do Story (cartao-pelada-na-mao-story.png, a imagem de 1920 px de altura) e cada toque conta (cardShare)', sh2.files[0].name === 'cartao-pelada-na-mao-story.png' && (await sh2.files[0].text()) === 'png1920' && u.calls.events.filter(x => x[0] === 'cardShare').length === 2, u.calls.events);
  const urlsAntes = u.api.getUrls();
  u.api.downloadMjCard(); u.api.setMjFormat('feed'); u.api.downloadMjCard();
  check('baixar: o nome do arquivo e o endereço da imagem seguem o formato (Story: …-story.png com a imagem do Story; Feed: o nome de sempre com a imagem do Feed)', u.calls.clicks.slice(-2).map(k => k.download).join() === 'cartao-pelada-na-mao-story.png,cartao-pelada-na-mao.png' && u.calls.clicks.slice(-2).map(k => k.href).join() === [urlsAntes.story, urlsAntes.feed].join(), u.calls.clicks);
  const antes = u.api.getFormat();
  for (const ruim of ['reels', '', undefined, null, 42, '__proto__', 'constructor', 'toString', 'Story']) u.api.setMjFormat(ruim);
  check('formato desconhecido (reels, vazio, __proto__, constructor, "Story" com maiúscula…): não muda nada', u.api.getFormat() === antes, u.api.getFormat());
  const ux = makeEnv(); ux.env.st._mjCard = c; let jogou = false;
  try { ux.api.setMjFormat('feed'); } catch (_) { jogou = true; }
  check('trocar o formato antes de abrir o cartão: nada acontece e nada quebra', !jogou && ux.api.getFormat() === 'story' && ux.layers.length === 0);
  u.api.closeMjCard(); u.api.setMjFormat('story');
  check('fechar: solta as DUAS imagens da memória (os dois endereços), some a camada e o setMjFormat deixa de agir', u.calls.revoked.length === 2 && u.api.getBlobs() === null && u.api.getUrls() === null && u.layers.length === 0 && u.api.getFormat() === 'feed', { revoked: u.calls.revoked, fmt: u.api.getFormat() });

  // ── Copiar legenda ───────────────────────────────────────────────────────────────────────────────────
  const legenda = A.mjCaption();
  check('legenda: título, descrição, o link com ?ref=cartao e as hashtags (#pelada #futebolamador #peladanamao), em 4 linhas', /^Meu cartão no Pelada na Mão ⚽🏆\n/.test(legenda) && /\nFaça o da sua: https:\/\/peladanamao\.com\.br\/\?ref=cartao\n/.test(legenda) && /#pelada #futebolamador #peladanamao$/.test(legenda) && legenda.split('\n').length === 4, legenda);
  check('PRIVACIDADE: a legenda é a mesma para todo mundo (a função nem recebe o cartão) e não leva nome, liga, arroba, e-mail nem WhatsApp', A.mjCaption.length === 0 && !legenda.includes(SRC.name) && !legenda.includes(SRC.league) && !/@|e-?mail|whatsapp/i.test(legenda), legenda);
  const cp = makeEnv(); cp.env.st._mjCard = c; await cp.api.copyMjCaption();
  check('Copiar legenda: copia a legenda pronta e avisa "Legenda copiada! Cole na publicação do Instagram."', cp.calls.copied.length === 1 && cp.calls.copied[0] === legenda && cp.calls.toasts.some(([m, t]) => /Legenda copiada! Cole na publicação do Instagram/.test(m) && t === 'ok'), cp.calls);
  const cq = makeEnv({ copyOk: false }); await cq.api.copyMjCaption();
  check('Copiar legenda sem conseguir copiar: avisa que não conseguiu (não promete o que não fez)', cq.calls.toasts.length === 1 && /Não consegui copiar a legenda/.test(cq.calls.toasts[0][0]) && cq.calls.toasts[0][1] === 'err', cq.calls.toasts);
  check('Copiar legenda não conta evento, não compartilha e não manda nada ao servidor (só a área de transferência)', cp.calls.events.length === 0 && cp.calls.shared.length === 0 && cp.calls.clicks.length === 0);

  // ── como está no código ─────────────────────────────────────────────────────────────────────────────
  check('o código: Story como formato padrão, as duas imagens guardadas juntas (_mjBlobs/_mjUrls) e o fundo único (drawMjBackground) usado pelo Feed e pelo Story', /let _mjBlobs = null, _mjUrls = null, _mjFormat = 'story';/.test(html) && /function drawMjBackground\(/.test(html) && (html.match(/(?<!function )drawMjBackground\(ctx, c,/g) || []).length === 2 && /function drawMjStory\(/.test(html) && !/_mjCardBlob|_mjCardUrl/.test(html));
  check('o formato só vale se for uma chave própria da tabela (hasOwnProperty): "__proto__" e "constructor" não passam', /!Object\.prototype\.hasOwnProperty\.call\(MJ_FORMATS, fmt\)/.test(html));
  const uiSrc = slice('const mjSheet', 'async function copyMjCaption') + slice('function mjCaption()', 'async function copyMjCaption');
  check('PRIVACIDADE: a janela e a legenda do cartão não citam e-mail, contatos nem a conta logada (o aviso "Não leva e-mail nem WhatsApp" é o único trecho que fala disso)', !/contacts|authUser|waOf|\.uid|\.email/i.test(uiSrc.replace(/Não leva e-mail nem WhatsApp\./g, '')), uiSrc.match(/.{20}(contacts|authUser|waOf|\.uid|\.email).{20}/i)?.[0]);

  // ── manual ────────────────────────────────────────────────────────────────────────────────────────────
  const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8');
  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const sec29 = plainM(manual.slice(manual.indexOf('id="cartao-jogador"'), manual.indexOf('<!-- 30. Página de Apresentação')));
  check('manual (seção 29): explica os dois formatos (Story 9:16 de 1080×1920 e Feed 4:5 de 1080×1350), as margens do Story (250 e 340 px) e que o cartão não é cortado', /Story/.test(sec29) && /1080×1920/.test(sec29) && /9:16/.test(sec29) && /Feed/.test(sec29) && /1080×1350/.test(sec29) && /4:5/.test(sec29) && /250 px em cima/.test(sec29) && /340 px embaixo/.test(sec29) && /sem cortar/.test(sec29) && /Story 1080×1920 \(9:16\) Stories do Instagram/.test(sec29) && /Feed 1080×1350 \(4:5\) Publicação do Instagram/.test(sec29), sec29.slice(0, 400));
  check('manual: diz que a janela abre no Story, que dá para trocar para o Feed na hora, e explica o Copiar legenda (o Instagram ignora o texto enviado junto com a imagem)', /abre no formato Story|já no formato Story/.test(sec29) && /Escolher o formato no alto da janela/.test(sec29) && /Copiar legenda/.test(sec29) && /Instagram ignora o texto/.test(sec29), sec29.slice(0, 400));
  check('manual: o quadro "Cortado no Instagram?" explica que o editor de publicação abre em quadrado (1:1) e corta, que a saída é o botão de proporção (escolher 4:5) e que Stories e Reels usam o Story (9:16)', /Cortado no Instagram/.test(sec29) && /editor de publicação do Instagram abre a imagem em quadrado \(1:1\)/.test(sec29) && /corta/.test(sec29) && /botão de proporção/.test(sec29) && /escolher 4:5/.test(sec29) && /editor de vídeo/.test(sec29) && /Stories e Reels use o Story \(9:16\)/.test(sec29), sec29.slice(0, 300));
  check('manual (técnico): cita drawMjStory, o fundo único e que as duas imagens ficam prontas antes do toque (trocar de formato só troca a imagem mostrada)', /drawMjStory/.test(sec29) && /fundo/.test(sec29) && /trocar Story\/Feed só troca a imagem mostrada/.test(sec29), sec29.slice(-500));

  check('a política de privacidade do app cita o cartão do jogador', /Cartão do jogador:<\/strong> a imagem é montada no seu aparelho/.test(html));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
