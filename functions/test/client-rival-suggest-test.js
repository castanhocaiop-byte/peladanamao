// SUGESTÃO de rival (index.html): quem está mais perto de você em número de conquistas, na faixa do card Conquistas (embaixo do convite) e no alto da lista de escolha. Extrai o código
// real e o executa num ambiente simulado, sem navegador. Regras: conta só as conquistas que o painel mostra (as escondidas pela liga não entram, para os dois lados); vale o jogador ATIVO
// com a menor diferença; na mesma distância vem quem está na frente (um rival para alcançar) e, ainda empatando, a ordem alfabética do português; quem ainda não tem nenhuma conquista não
// jogou e não é sugerido; sem conquista minha não há "perto" para medir; ao trocar de rival a sugestão pula o rival atual; não aparece na simulação do admin; é calculada só no aparelho
// (nada vai ao servidor, nada é gravado, ninguém é avisado); a faixa e a lista continuam as de sempre quando não há sugestão.
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

// ── o catálogo de mentira: 12 conquistas comuns e uma escondida pela liga (não pode contar para ninguém) ──
const CAT = Array.from({ length: 12 }, (_, i) => ({ id: 'b' + (i + 1), emoji: '⭐', label: 'Conquista ' + (i + 1), desc: 'Regra ' + (i + 1) }))
  .concat([{ id: 'oculta', emoji: '🙈', label: 'Oculta', desc: 'escondida pela liga', visible: () => false }]);
const ids = n => Array.from({ length: n }, (_, i) => 'b' + (i + 1));
const holdersOf = badges => { const h = {}; for (const b of CAT) h[b.id] = Object.entries(badges).filter(([, l]) => l.includes(b.id)).map(([n]) => n); return h; };
// Ana (eu) tem 6 visíveis (+1 escondida, que não conta); Bruno 8 (+2); Carla 7 (+1); Dani 5 (-1); Edu 7 (+1); Fábio só a escondida (0); Gil, goleiro, 6 (0); Hugo inativo, 6; Álvaro 7 (+1)
const PLAYERS = [{ name: 'Ana' }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Dani' }, { name: 'Edu' }, { name: 'Fábio' }, { name: 'Gil', goleiro: true }, { name: 'Hugo', active: false }, { name: 'Álvaro' }];
const BADGES = { Ana: [...ids(6), 'oculta'], Bruno: ids(8), Carla: ids(7), Dani: ids(5), Edu: ids(7), 'Fábio': ['oculta'], Gil: ids(6), Hugo: ids(6), 'Álvaro': ids(7) };

function makeEnv({ players = PLAYERS, badges = BADGES, me = 'ana', sim = null, myName } = {}) {
  const calls = { events: [], toasts: [], renders: 0 };
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const doc = { fonts: { load: async () => [] }, getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ remove() {} }), body: { appendChild() {} } };
  const env = {
    st: { authUser: { uid: 'u1' }, leagueId: 'liga1', userDoc: { playerKey: me }, players, champs: [], ranks: [], availableLeagues: [{ id: 'liga1', name: 'Série B' }], photos: {}, modal: null, mjPreviewKey: sim },
    document: doc, navigator: {}, Image: class {}, URL: {}, pixCopyText: async () => true,
    trackEvent: (n, once = true) => { calls.events.push([n, once]); }, toast: (m, t) => { calls.toasts.push([m, t]); },
    localStorage, render: () => { calls.renders++; }, BADGE_CATALOG: CAT, getBadgeCache: () => ({ playerBadges: badges, badgeHolders: holdersOf(badges), playerStats: {} }),
  };
  const names = Object.keys(env);
  const body = escCode + '\n' + keyCode + '\n' + code + '\n' + eligCode + '\n' + rivalCode + `
return { rivalSuggestion, rivalGapText, rivalSuggestText, rivalCloser, rivalSet, rivalGet, rivalPick, rivalStrip, mRival, openRival, rivalCandidates, rivalBadgeIds, playerKey };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, calls, store };
}
const S = (opts, except) => makeEnv(opts).api.rivalSuggestion(except);
const P = names => names.map(name => ({ name }));
const short = s => (s ? s.key : null);

// um gerador de números com semente fixa (mulberry32): os mesmos "sorteios" em toda rodada
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

(async () => {
  // ══ 1. A CONTA PURA (rivalSuggestion) ═════════════════════════════════════════════════════════════
  check('com 6 conquistas (a escondida pela liga não conta), o mais perto é quem tem 6 (Gil, goleiro, diferença 0); o resultado traz chave, nome, quantas ele tem, quantas eu tenho e a diferença', JSON.stringify(S()) === JSON.stringify({ key: 'gil', name: 'Gil', count: 6, mine: 6, gap: 0 }), S());
  check('a mesma distância 0 vence de qualquer outra: quem tem o MESMO número de conquistas é sempre o primeiro', short(S({ players: P(['Ana', 'Bruno', 'Zoe', 'Carla']), badges: { Ana: ids(5), Bruno: ids(6), Zoe: ids(5), Carla: ids(4) } })) === 'zoe');
  check('sem o Gil: três jogadores a 1 de distância (Álvaro +1, Carla +1, Edu +1, Dani -1): vem quem está NA FRENTE e, entre eles, a ordem alfabética do português ("Álvaro" antes de "Carla": o acento não joga ele para o fim)', short(S({}, 'gil')) === 'alvaro' && ['Álvaro', 'Carla'].sort((a, b) => a.localeCompare(b, 'pt'))[0] === 'Álvaro' && ['Álvaro', 'Carla'].sort()[0] === 'Carla');
  check('sem Gil e sem Álvaro a conta continua: Carla (+1) e Edu (+1) à frente, Dani (-1) atrás: Carla; sem a Carla: Edu', (() => { const base = { players: PLAYERS.filter(p => !['Gil', 'Álvaro'].includes(p.name)) }; return short(S(base)) === 'carla' && short(S(base, 'carla')) === 'edu'; })());
  check('quem está à mesma distância, um na frente e outro atrás: o da frente (um rival para alcançar), mesmo que o de trás venha antes na ordem alfabética', short(S({ players: P(['Ana', 'Carla', 'Beto']), badges: { Ana: ids(6), Carla: ids(7), Beto: ids(5) } })) === 'carla' && short(S({ players: P(['Ana', 'Carla', 'Beto']), badges: { Ana: ids(6), Carla: ids(7), Beto: ids(5) } }, 'carla')) === 'beto');
  check('só tem gente atrás à mesma distância: a ordem alfabética decide (Dani antes de Eva); a menor distância sempre vence, na frente ou atrás (Dani -1 vence Bruno +2)', short(S({ players: P(['Ana', 'Eva', 'Dani']), badges: { Ana: ids(6), Eva: ids(5), Dani: ids(5) } })) === 'dani' && short(S({ players: P(['Ana', 'Bruno', 'Dani']), badges: { Ana: ids(6), Bruno: ids(8), Dani: ids(5) } })) === 'dani');
  check('perto vence "na frente": quem está 1 atrás (Dani) é sugerido antes de quem está 2 à frente (Bruno)', short(S({ players: P(['Ana', 'Bruno', 'Dani']), badges: { Ana: ids(6), Bruno: ids(8), Dani: ids(5) } })) === 'dani' && S({ players: P(['Ana', 'Bruno', 'Dani']), badges: { Ana: ids(6), Bruno: ids(8), Dani: ids(5) } }).gap === -1);
  check('a conquista escondida pela liga não conta para ninguém: quem só tem a escondida (Fábio) tem 0 e não é sugerido, e a minha escondida não entra no meu total (6, não 7)', S().mine === 6 && short(S({ players: P(['Ana', 'Fábio']), badges: { Ana: ids(3), 'Fábio': ['oculta'] } })) === null && short(S({ players: P(['Ana', 'Fábio']), badges: { Ana: ids(3), 'Fábio': [...ids(2), 'oculta'] } })) === 'fabio');
  check('só jogadores ATIVOS e outros que não eu: o inativo (Hugo, 6, igual a mim) e eu mesma nunca são sugeridos', (() => { const r = S({ players: P(['Ana', 'Bruno']).concat([{ name: 'Hugo', active: false }]), badges: { Ana: ids(6), Bruno: ids(9), Hugo: ids(6) } }); return short(r) === 'bruno' && short(S({ players: [{ name: 'Ana' }, { name: 'Hugo', active: false }], badges: { Ana: ids(6), Hugo: ids(6) } })) === null; })());
  check('quem ainda não tem nenhuma conquista (não jogou) não é sugerido, mesmo sendo o mais perto: eu com 1, um com 0 (diferença 1) e outro com 3 (diferença 2) = o de 3', short(S({ players: P(['Ana', 'Zero', 'Tres']), badges: { Ana: ids(1), Zero: [], Tres: ids(3) } })) === 'tres' && short(S({ players: P(['Ana', 'Zero']), badges: { Ana: ids(1), Zero: [] } })) === null);
  check('sem nenhuma conquista MINHA não há sugestão (não há "perto" para medir), nem se só tenho a escondida', S({ players: P(['Ana', 'Bruno']), badges: { Ana: [], Bruno: ids(5) } }) === null && S({ players: P(['Ana', 'Bruno']), badges: { Ana: ['oculta'], Bruno: ids(5) } }) === null && S({ players: P(['Ana', 'Bruno']), badges: { Bruno: ids(5) } }) === null);
  check('goleiro entra na conta como os outros (o Gil, goleiro, é o sugerido quando é o mais perto)', short(S()) === 'gil' && makeEnv().api.rivalCandidates().some(p => p.goleiro));
  check('exceptKey pula um jogador (o rival atual, ao trocar); chave que não existe não muda nada; sem outro candidato = null', short(S({}, 'gil')) !== 'gil' && short(S({}, 'xxx')) === 'gil' && short(S({}, undefined)) === 'gil' && short(S({ players: P(['Ana', 'Bruno']), badges: { Ana: ids(2), Bruno: ids(3) } }, 'bruno')) === null);
  check('na simulação do admin ("Ver como" outro jogador) não há sugestão; "Ver como" eu mesma continua valendo', S({ sim: 'carla' }) === null && short(S({ sim: 'ana' })) === 'gil' && short(S({ sim: null })) === 'gil');
  check('sem jogador vinculado (sem playerKey) ou com o jogador fora do elenco: null (a faixa nem aparece; a conta nunca quebra)', (() => { const z = makeEnv(); z.env.st.userDoc.playerKey = undefined; return z.api.rivalSuggestion() === null; })() && S({ me: 'fulano' }) === null && S({ players: [] }) === null);
  check('sem jogadores, sem outros candidatos ou lista torta: nunca quebra, devolve null', S({ players: [] }) === null && S({ players: [{ name: 'Ana' }] }) === null && (() => { const z = makeEnv(); z.env.st.players = undefined; return z.api.rivalSuggestion() === null; })());
  // propriedade: a mesma conta, feita de outro jeito (ordenando), em muitas ligas sorteadas
  const rnd = mulberry32(20261019);
  const nomes = ['Ana', 'Álvaro', 'Beto', 'Bruno', 'Carla', 'Dani', 'Edu', 'Éder', 'Fábio', 'Gil', 'Hugo', 'Iara', 'João', 'Léo', 'Zé'];
  let agree = 0, nullCount = 0, total = 0, mismatch = null;
  for (let t = 0; t < 400; t++) {
    const n = 2 + Math.floor(rnd() * (nomes.length - 1)), players = nomes.slice(0, n).map(name => ({ name, ...(rnd() < 0.2 ? { active: false } : {}), ...(rnd() < 0.15 ? { goleiro: true } : {}) }));
    const badges = {}; for (const p of players) badges[p.name] = [...ids(Math.floor(rnd() * 13)), ...(rnd() < 0.3 ? ['oculta'] : [])];
    const me = players[Math.floor(rnd() * players.length)].name, key = makeEnv().api.playerKey(me), except = rnd() < 0.3 ? makeEnv().api.playerKey(players[Math.floor(rnd() * players.length)].name) : undefined;
    const visible = l => l.filter(x => x !== 'oculta').length, mine = visible(badges[me] || []);
    const cands = players.filter(p => p.active !== false && makeEnv().api.playerKey(p.name) !== key && makeEnv().api.playerKey(p.name) !== except && visible(badges[p.name]) > 0).map(p => ({ name: p.name, count: visible(badges[p.name]), gap: visible(badges[p.name]) - mine }));
    cands.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap) || (a.gap < 0 ? 1 : 0) - (b.gap < 0 ? 1 : 0) || a.name.localeCompare(b.name, 'pt'));
    const expected = mine && cands.length ? cands[0] : null, got = S({ players, badges, me: key }, except);
    total++; if (!expected) nullCount++;
    if ((!expected && !got) || (expected && got && got.name === expected.name && got.count === expected.count && got.gap === expected.gap && got.mine === mine)) agree++; else if (!mismatch) mismatch = { t, expected, got, me, except };
  }
  check('400 ligas sorteadas (semente fixa): a sugestão é sempre a mesma da conta feita por ordenação (menor distância, depois quem está na frente, depois a ordem alfabética), com ativos, goleiros, escondidas e rival a pular', agree === total && nullCount > 10 && nullCount < total - 100, { total, agree, nullCount, mismatch });

  // ══ 2. OS TEXTOS ══════════════════════════════════════════════════════════════════════════════════
  const A = makeEnv().api;
  check('o texto da diferença, no singular e no plural: "1 conquista a mais que você", "2 conquistas a mais…", "1 conquista a menos…", "3 conquistas a menos…", e o empate "o mesmo número de conquistas que você"', A.rivalGapText({ gap: 1 }) === '1 conquista a mais que você' && A.rivalGapText({ gap: 2 }) === '2 conquistas a mais que você' && A.rivalGapText({ gap: -1 }) === '1 conquista a menos que você' && A.rivalGapText({ gap: -3 }) === '3 conquistas a menos que você' && A.rivalGapText({ gap: 0 }) === 'o mesmo número de conquistas que você');
  check('o texto da janela, com a contagem dele: "12 conquistas, 2 a mais que você", "1 conquista, igual a você", "7 conquistas, 3 a menos que você"', A.rivalSuggestText({ count: 12, gap: 2 }) === '12 conquistas, 2 a mais que você' && A.rivalSuggestText({ count: 1, gap: 0 }) === '1 conquista, igual a você' && A.rivalSuggestText({ count: 7, gap: -3 }) === '7 conquistas, 3 a menos que você' && A.rivalSuggestText({ count: 1, gap: 1 }) === '1 conquista, 1 a mais que você');
  check('a regra de desempate sozinha (rivalCloser): menor distância; na mesma distância a da frente; depois o nome', A.rivalCloser({ gap: 1, name: 'B' }, { gap: 2, name: 'A' }) === true && A.rivalCloser({ gap: 2, name: 'A' }, { gap: 1, name: 'B' }) === false && A.rivalCloser({ gap: 1, name: 'B' }, { gap: -1, name: 'A' }) === true && A.rivalCloser({ gap: -1, name: 'A' }, { gap: 1, name: 'B' }) === false && A.rivalCloser({ gap: 1, name: 'A' }, { gap: 1, name: 'B' }) === true && A.rivalCloser({ gap: 1, name: 'B' }, { gap: 1, name: 'A' }) === false && A.rivalCloser({ gap: 0, name: 'Z' }, { gap: 1, name: 'A' }) === true && A.rivalCloser({ gap: 0, name: 'Z' }, { gap: -1, name: 'A' }) === true);

  // ══ 3. A FAIXA (card Conquistas, aba EU) ══════════════════════════════════════════════════════════
  let e = makeEnv();
  let strip = e.api.rivalStrip(false);
  check('faixa SEM rival e COM sugestão: o convite de sempre, o botão "Escolher rival" (openRival) e embaixo "💡 Sugestão: Gil (o mesmo número de conquistas que você)" como botão que escolhe (rivalPick)', /Compare as suas conquistas e os seus números com os de um rival da liga\./.test(strip) && /onclick="openRival\(\)"[^>]*>Escolher rival<\/button>/.test(strip) && /⚔️/.test(strip) && /<button onclick="rivalPick\('gil'\)"[^>]*>💡 Sugestão: Gil \(o mesmo número de conquistas que você\)<\/button>/.test(strip), strip.slice(0, 700));
  check('a sugestão da faixa fica ABAIXO do convite e DENTRO do bloco do texto (o botão "Escolher rival" continua ao lado, fora dele)', strip.indexOf('Compare as suas conquistas') < strip.indexOf('💡 Sugestão') && strip.indexOf('💡 Sugestão') < strip.indexOf('Escolher rival') && /<div style="flex:1;min-width:0">[\s\S]*Sugestão[\s\S]*<\/div><button onclick="openRival\(\)"/.test(strip));
  check('a faixa da sugestão mostra quem está na frente ou atrás: com a Carla a escolher (sem Gil nem Álvaro) "(1 conquista a mais que você)"; com a Dani "(1 conquista a menos que você)"', /Sugestão: Carla \(1 conquista a mais que você\)/.test(makeEnv({ players: PLAYERS.filter(p => !['Gil', 'Álvaro'].includes(p.name)) }).api.rivalStrip(false)) && /Sugestão: Dani \(1 conquista a menos que você\)/.test(makeEnv({ players: P(['Ana', 'Dani', 'Bruno']), badges: { Ana: ids(6), Dani: ids(5), Bruno: ids(8) } }).api.rivalStrip(false)));
  const semSug = makeEnv({ players: P(['Ana', 'Bruno']), badges: { Ana: [], Bruno: ids(4) } }).api.rivalStrip(false);
  check('faixa SEM sugestão (eu sem nenhuma conquista): igual à de antes, convite e botão, sem 💡 e sem botão de escolher o sugerido', /Compare as suas conquistas e os seus números com os de um rival da liga\./.test(semSug) && /onclick="openRival\(\)"[^>]*>Escolher rival<\/button>/.test(semSug) && !/💡|Sugestão|rivalPick/.test(semSug), semSug.slice(0, 400));
  e.api.rivalSet('bruno'); strip = e.api.rivalStrip(false);
  check('faixa COM rival já escolhido: o placar de sempre, sem sugestão (já escolheu)', /Você <b[^>]*>6<\/b> × <b[^>]*>8<\/b> Bruno/.test(strip) && !/💡|Sugestão/.test(strip) && !/Escolher rival/.test(strip), strip.slice(0, 300));
  check('a faixa não aparece na simulação do admin, sem elenco ou sem jogador vinculado (como antes), e portanto a sugestão também não', makeEnv().api.rivalStrip(true) === '' && makeEnv({ players: [] }).api.rivalStrip(false) === '' && (() => { const z = makeEnv(); z.env.st.userDoc.playerKey = undefined; return z.api.rivalStrip(false) === ''; })());
  const evil = '<img src=x onerror=alert(1)> & "oi"';
  const xss = makeEnv({ players: [{ name: 'Ana' }, { name: evil }], badges: { Ana: ids(5), [evil]: ids(6) } });
  const xs = xss.api.rivalStrip(false);
  check('o nome sugerido é escapado na faixa (sem HTML solto), e o botão chama rivalPick só com a chave (letras minúsculas, números e _): nada de aspas no onclick', /Sugestão: &lt;img/.test(xs) && !/<img/.test(xs) && /rivalPick\('[a-z0-9_]+'\)/.test(xs) && !/rivalPick\('[^']*[<>"&][^']*'\)/.test(xs), xs.slice(0, 500));

  // ══ 4. A JANELA DE ESCOLHA ════════════════════════════════════════════════════════════════════════
  e = makeEnv(); e.env.st.modal = { type: 'rival', picking: true };
  let m = e.api.mRival();
  check('lista de escolha COM sugestão: o cartão (data-rsuggest) "Sugestão: mais perto de você", o nome, "6 conquistas, igual a você" e o botão "Comparar" (rivalPick do sugerido)', /data-rsuggest/.test(m) && /Sugestão: mais perto de você/.test(m) && /<div style="font-size:14px;font-weight:700;overflow-wrap:anywhere">Gil<\/div>/.test(m) && /6 conquistas, igual a você/.test(m) && /<button onclick="rivalPick\('gil'\)"[^>]*>Comparar<\/button>/.test(m), m.slice(0, 900));
  check('o cartão da sugestão fica entre o aviso e a busca (e fora da lista): aviso, sugestão, busca, lista', m.indexOf('Escolha um jogador da liga') < m.indexOf('data-rsuggest') && m.indexOf('data-rsuggest') < m.indexOf('type="search"') && m.indexOf('type="search"') < m.indexOf('id="rival-list"') && !/id="rival-list"[\s\S]*data-rsuggest/.test(m));
  check('a lista continua completa e sem mudança: um botão por jogador ATIVO que não sou eu (7: Bruno, Carla, Dani, Edu, Fábio, Gil, Álvaro), cada um com iniciais, nome e conquistas; a sugestão NÃO usa data-rname (não some na busca)', (m.match(/data-rname="/g) || []).length === 7 && !/data-rname="[^"]*"[^>]*data-rsuggest/.test(m) && !/data-rsuggest[^>]*data-rname/.test(m) && /data-rname="álvaro"/.test(m) && !/data-rname="hugo"/.test(m) && !/data-rname="ana"/.test(m));
  check('o aviso de antes continua igual (só neste aparelho, o outro jogador não é avisado) e a janela não ganhou botão de compartilhar nem abas', /Escolha um jogador da liga para comparar as conquistas e os números\. A escolha fica só neste aparelho e o outro jogador não é avisado\./.test(m) && !/Compartilhar/.test(m) && !/rivalTab\(/.test(m));
  // trocar de rival: a sugestão pula o rival atual
  e = makeEnv(); e.api.rivalSet('gil'); e.env.st.modal = { type: 'rival', picking: true };
  m = e.api.mRival();
  check('ao TROCAR de rival (já tem o Gil), a sugestão pula o rival atual: sugere o Álvaro (+1), não o Gil; e o botão "← Voltar para a comparação" continua lá', /<div style="font-size:14px;font-weight:700;overflow-wrap:anywhere">Álvaro<\/div>/.test(m) && /7 conquistas, 1 a mais que você/.test(m) && /rivalPick\('alvaro'\)"[^>]*>Comparar</.test(m) && !/data-rsuggest[\s\S]{0,400}>Gil</.test(m) && /Voltar para a comparação/.test(m));
  const semM = makeEnv({ players: P(['Ana', 'Bruno']), badges: { Ana: [], Bruno: ids(4) } }); semM.env.st.modal = { type: 'rival', picking: true };
  const mm = semM.api.mRival();
  check('lista de escolha SEM sugestão: sem o cartão, só o aviso, a busca e a lista de sempre', !/data-rsuggest|Sugestão|💡/.test(mm) && /type="search"/.test(mm) && (mm.match(/data-rname="/g) || []).length === 1, mm.slice(0, 400));
  const vazio = makeEnv({ players: [{ name: 'Ana' }] }); vazio.env.st.modal = { type: 'rival', picking: true };
  check('liga sem outros jogadores: a mensagem de sempre e nenhum cartão de sugestão', /Ainda não há outros jogadores na liga para virar seu rival\./.test(vazio.api.mRival()) && !/data-rsuggest/.test(vazio.api.mRival()));
  e = makeEnv(); e.api.rivalSet('bruno'); e.env.st.modal = { type: 'rival', picking: false };
  const cmp = e.api.mRival();
  check('a janela da COMPARAÇÃO (rival já escolhido) não mostra sugestão: só a comparação, as abas e os botões de sempre', !/data-rsuggest|Sugestão|💡/.test(cmp) && /Trocar rival/.test(cmp) && /Remover rival/.test(cmp) && /rivalTab\('badges'\)/.test(cmp));
  const xm = xss; xm.env.st.modal = { type: 'rival', picking: true };
  const xh = xm.api.mRival();
  check('o nome sugerido também é escapado no cartão da janela (sem HTML solto)', /data-rsuggest/.test(xh) && !/<img/.test(xh) && /&lt;img/.test(xh));
  check('na simulação do admin a janela de escolha não ganha sugestão (a janela nem abre: openRival não faz nada)', (() => { const z = makeEnv({ sim: 'carla' }); z.api.openRival(); return z.env.st.modal === null && z.calls.renders === 0 && z.api.rivalSuggestion() === null; })());

  // ══ 5. O TOQUE NA SUGESTÃO ════════════════════════════════════════════════════════════════════════
  e = makeEnv();
  e.api.rivalPick('gil');
  check('tocar na sugestão (da faixa ou do cartão) escolhe aquele jogador e abre a comparação já pronta (janela "rival", sem a lista), redesenhando uma vez', e.api.rivalGet() === 'gil' && e.env.st.modal?.type === 'rival' && e.env.st.modal.picking === false && e.calls.renders === 1 && JSON.stringify(Array.from(e.store.keys())) === JSON.stringify(['aceoma_rival']) && /"u1_liga1":"gil"/.test(e.store.get('aceoma_rival')), [e.env.st.modal, Array.from(e.store.entries())]);
  e = makeEnv(); e.env.st.modal = { type: 'rival', picking: true, tab: 'numbers' }; e.api.rivalPick('alvaro');
  check('escolher a sugestão a partir da lista mantém a aba que estava (como qualquer escolha de rival)', e.env.st.modal.tab === 'numbers' && e.env.st.modal.picking === false && e.api.rivalGet() === 'alvaro');
  e = makeEnv(); e.api.rivalPick('hugo'); e.api.rivalPick('ana'); e.api.rivalPick('xxx');
  check('quem não pode ser rival (inativo, eu mesma ou chave que não existe) continua não podendo, nem pelo botão da sugestão', e.api.rivalGet() === '' && e.env.st.modal === null && e.calls.renders === 0);

  // ══ 6. PRIVACIDADE ════════════════════════════════════════════════════════════════════════════════
  e = makeEnv();
  const antes = JSON.stringify(Array.from(e.store.entries()));
  e.api.rivalSuggestion(); e.api.rivalStrip(false); e.env.st.modal = { type: 'rival', picking: true }; e.api.mRival();
  check('só mostrar a sugestão não grava nada (localStorage intacto), não conta evento nenhum e não manda aviso: calculada e desenhada só no aparelho', JSON.stringify(Array.from(e.store.entries())) === antes && e.calls.events.length === 0 && e.calls.toasts.length === 0 && e.calls.renders === 0, [e.calls, Array.from(e.store.keys())]);
  const fn = slice('const rivalCloser =', '// As linhas da tabela de números.');
  check('PRIVACIDADE: o código da sugestão (conta e textos) não fala com o servidor, não grava nem conta nada (sem callFn, fetch, firebase, ldoc, localStorage, trackEvent, sendBeacon, XMLHttpRequest)', !/callFn|fetch\(|firebase|ldoc|localStorage|trackEvent|sendBeacon|XMLHttpRequest|navigator\./.test(fn) && /rivalBadgeIds/.test(fn) && /rivalCandidates\(\)/.test(fn), fn.length);
  check('a conta usa só o que a liga já mostra a todos: as conquistas de cada um (rivalBadgeIds, que passa pelo filtro de visibilidade do painel) e a lista de jogadores; nenhum e-mail, WhatsApp, contato ou conta logada', !/email|whatsapp|contacts|authUser|uid/i.test(fn) && /rivalBadgeIds\(p\.name\)\.length/.test(fn) && /rivalBadgeIds\(me\.name\)\.length/.test(fn));

  // ══ 7. LIGAÇÃO NO APP ═════════════════════════════════════════════════════════════════════════════
  const stripSrc = slice('function rivalStrip(isSimulating) {', 'function openRival() {');
  const winSrc = slice('function mRival() {', 'function closeModal()');
  check('a conta está definida UMA vez e é usada nos dois lugares: na faixa (sem rival escolhido, sem pular ninguém) e na janela de escolha (pulando o rival atual: rivalGet())', (html.match(/function rivalSuggestion\(/g) || []).length === 1 && (html.match(/rivalSuggestion\(/g) || []).length === 3 && /const sg = rivalSuggestion\(\);/.test(stripSrc) && /const sg = rivalSuggestion\(rivalGet\(\)\);/.test(winSrc));
  check('na faixa a sugestão só existe no ramo SEM rival (if (!c)); com rival o placar de sempre não muda', /if \(!c\) \{\s*const sg = rivalSuggestion\(\);/.test(stripSrc) && stripSrc.indexOf('rivalSuggestion(') < stripSrc.indexOf('const mc = c.diff') && !/rivalSuggestion/.test(stripSrc.slice(stripSrc.indexOf('const mc = c.diff'))));
  check('na janela a sugestão só existe na lista de escolha (if (!c)), não na comparação', /if \(!c\) \{\s*const sg = rivalSuggestion\(rivalGet\(\)\);/.test(winSrc) && !/rivalSuggestion/.test(winSrc.slice(winSrc.indexOf("const tab = m.tab === 'numbers'"))));
  check('os botões da sugestão chamam rivalPick (a mesma escolha da lista) e o nome passa por esc()', (stripSrc.match(/rivalPick\('\$\{sg\.key\}'\)/g) || []).length === 1 && (winSrc.match(/rivalPick\('\$\{sg\.key\}'\)/g) || []).length === 1 && /\$\{esc\(sg\.name\)\}/.test(stripSrc) && /\$\{esc\(sg\.name\)\}/.test(winSrc));
  check('a política de privacidade do app cita a sugestão (só neste aparelho, o que a liga já mostra, ninguém é avisado) sem mexer na frase de antes sobre o rival', /Se você compartilhar a imagem da comparação, ela leva o nome do seu rival\. O app também sugere, só neste aparelho, o jogador mais perto de você em número de conquistas \(a conta usa o que a liga já mostra e ninguém é avisado\)\./.test(html));

  // ══ 8. MANUAL E CI ════════════════════════════════════════════════════════════════════════════════
  const plain = s => s.replace(/<\/(td|th|tr|p|div|li|h3)>|<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const secR = plain(manual.slice(manual.indexOf('id="rival"'), manual.indexOf('<h3>Modo de teste (admin)</h3>')));
  check('manual (seção 13): o parágrafo da faixa fala da 💡 sugestão (mais perto em número de conquistas, na faixa e no alto da lista, Comparar escolhe e abre a comparação)', /Quem ainda não escolheu vê também uma 💡 sugestão: o jogador mais perto de você em número de conquistas, embaixo do convite da faixa e no alto da lista; um toque em Comparar \(ou no nome sugerido, na faixa\) escolhe esse jogador e abre a comparação\./.test(secR), secR.slice(0, 900));
  check('manual: a linha "💡 Sugestão de rival" explica a conta (conquistas que o painel mostra, menor distância, na frente primeiro, ordem alfabética, sem conquista não é sugerido, sem conquista minha não há, Trocar rival pula o atual)', /💡 Sugestão de rival \(na faixa e na lista de escolha\) O jogador ativo da liga cujo número de conquistas está mais perto do seu \(as mesmas que o placar conta: as que o painel mostra\)\. Se duas pessoas estão à mesma distância, vem quem está na frente \(um rival para alcançar\) e, ainda empatando, a ordem alfabética\. Quem ainda não tem nenhuma conquista \(não jogou\) não é sugerido, e sem nenhuma conquista sua não há sugestão\. Ao Trocar rival, a sugestão pula o rival atual\./.test(secR), secR.slice(0, 900));
  check('manual: a linha da sugestão vem ANTES do placar na tabela, e o aviso de privacidade diz que ela também é calculada só no aparelho e o sugerido não é avisado', secR.indexOf('💡 Sugestão de rival') < secR.indexOf('Placar e quem está na frente') && /A sugestão também é calculada só neste aparelho, com o que a liga já mostra a todos, e o jogador sugerido não é avisado\./.test(secR));
  check('manual: o quadro técnico cita rivalSuggestion e rivalBadgeIds', /A sugestão \(rivalSuggestion\) usa a mesma lista de conquistas \(rivalBadgeIds\) e escolhe a menor diferença entre o seu número e o dos outros jogadores ativos\./.test(secR));
  check('CI: o teste da sugestão de rival roda (passo com o nome e o comando), uma vez só', /- name: Testes do app \(sugestão de rival - [^\n]*\)\n {8}working-directory: functions\n {8}run: node test\/client-rival-suggest-test\.js/.test(ci) && (ci.match(/client-rival-suggest-test\.js/g) || []).length === 1);

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
