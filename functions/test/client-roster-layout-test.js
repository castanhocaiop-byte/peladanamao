// Elenco (index.html, vPlayers): a linha do jogador não pode espremer o nome por baixo das estrelas e dos botões. Defeito visto no celular do dono
// (14/10/2026): o admin tem 5 estrelas + Ativo + 🍖 + 🧤 + ✏️ + ✕ (uns 300 px) ao lado do nome, o nome encolhia até zero (flex:1;min-width:0) e o
// texto saía por cima das estrelas; o ✕ ainda estourava o cartão. Agora a linha quebra: nome e foto na 1ª linha, estrelas e botões juntos na 2ª
// quando não cabem; em tela larga continua numa linha só. Este teste extrai o código real e confere a estrutura (o visual foi conferido num
// navegador nas larguras 320, 369 e 700 px). Sem navegador aqui: o que importa é o que causava o defeito (nome sem espaço garantido, linha que não quebra).
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8');
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
const code = [slice('function playerAvatar(', 'function resizeImageToBlob('), slice('/* ── Estrelas: o que vale', 'async function setPlayerStars('), slice('function renderStars(', 'function renderDrawCard('), slice('function vPlayers() {', 'function vRanking() {'), slice('function pushStatus(', 'function waVotacaoLink(')].join('\n'); // a última é o rótulo 🔔/🔕 do admin (sem a informação carregada, não aparece nada)

const NOMES = ['Caio', 'Davidson', 'Felipe', 'Guilherme', 'Leandro', 'Nego Du', 'Samuel', 'Wagner'];
function render({ admin = true, churrasco = true, players } = {}) {
  const env = {
    st: { ready: true, photos: {}, appCfg: { hasChurrasco: churrasco }, ranks: [], champs: [], players: players || NOMES.map((name, i) => ({ id: 'p' + i, name, stars: (i % 5) + 1, goleiro: name === 'Leandro' })) },
    isAdmin: () => admin, playerKey: n => n, waOf: () => '',
    esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    importPlayersFromRanking: () => {},
  };
  const names = Object.keys(env);
  return new Function(...names, code + '\nreturn vPlayers();')(...names.map(n => env[n]));
}
const ROW = '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--border2);opacity:';
const linhasDe = h => h.split(ROW).slice(1); // cada pedaço começa no "opacity" da linha e vai até a próxima (a última leva o fim do cartão)
const abre = h => (h.match(/<div/g) || []).length, fecha = h => (h.match(/<\/div>/g) || []).length;

// ── administrador (estrelas clicáveis + todos os botões) ───────────────────────────────────────
const adm = render();
const linhas = linhasDe(adm);
check('Elenco do admin: uma linha por jogador (8), todas com a linha que QUEBRA (flex-wrap:wrap): sem isso o nome é espremido sob as estrelas', linhas.length === 8 && adm.split(ROW).length - 1 === 8, linhas.length);
check('as tags <div> abrem e fecham na mesma quantidade (o grupo novo de controles está fechado)', abre(adm) === fecha(adm), { abre: abre(adm), fecha: fecha(adm) });
const l1 = linhas[0];
const iAvatar = l1.indexOf('<span style="display:inline-flex;margin-right:6px">');
const iNome = l1.indexOf('<div style="flex:1 1 120px;min-width:0;overflow-wrap:anywhere">');
const iGrupo = l1.indexOf('<div style="display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-left:auto">');
const iEstrelas = l1.indexOf('<span style="display:flex;gap:0">');
const iAtivo = l1.indexOf('Ativo'), iChurr = l1.indexOf('togglePlayerChurrasco'), iGoleiro = l1.indexOf('togglePlayerGoleiro'), iEditar = l1.indexOf('✏️'), iExcluir = l1.indexOf('deleteRegisteredPlayer');
check('ordem na linha: foto, nome (com espaço garantido de 120 px e podendo encolher), e DEPOIS o grupo de controles', iAvatar >= 0 && iNome > iAvatar && iGrupo > iNome, { iAvatar, iNome, iGrupo });
check('dentro do grupo de controles, juntos: estrelas, Ativo, 🍖, 🧤, ✏️ e ✕ (descem ou ficam todos juntos, nunca soltos pela linha)', iEstrelas > iGrupo && iAtivo > iEstrelas && iChurr > iAtivo && iGoleiro > iChurr && iEditar > iGoleiro && iExcluir > iEditar, { iGrupo, iEstrelas, iAtivo, iChurr, iGoleiro, iEditar, iExcluir });
check('o grupo fecha logo depois do ✕ e depois fecha a linha (nenhum botão fica fora do grupo)', /✕<\/button>\s*<\/div>\s*<\/div>/.test(l1), l1.slice(-160));
check('o grupo vai para a direita (margin-left:auto, justify-content:flex-end) e também pode quebrar por dentro (flex-wrap) em celular bem estreito', /margin-left:auto/.test(l1.slice(iGrupo, iGrupo + 140)) && /justify-content:flex-end/.test(l1.slice(iGrupo, iGrupo + 140)) && /flex-wrap:wrap/.test(l1.slice(iGrupo, iGrupo + 140)));
const basis = /flex:1 1 (\d+)px;min-width:0/.exec(l1);
check('o nome tem uma base de largura (flex-basis) de pelo menos 100 px antes de os controles tomarem a linha, e min-width:0 só para poder encolher em tela mínima', !!basis && Number(basis[1]) >= 100, basis && basis[0]);
check('o nome quebra palavras muito compridas (overflow-wrap) em vez de sair da linha', /overflow-wrap:anywhere/.test(l1.slice(iNome, iNome + 120)));
check('5 estrelas clicáveis (botões) no grupo, com a mesma regra de antes (clicar na estrela atual tira a nota)', (l1.slice(iEstrelas, iAtivo).match(/class="star-btn"/g) || []).length === 5 && /setPlayerStars\('p0',/.test(l1));
const l5 = linhas[4];
const blocoNome = l5.slice(l5.indexOf('<div style="flex:1 1 120px'), l5.indexOf('<div style="display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end'));
check('a linha do goleiro mostra o 🧤 ao lado do nome, dentro do bloco do nome (e não solto no grupo de controles)', /Leandro/.test(blocoNome) && /🧤/.test(blocoNome), blocoNome);
check('o código antigo (nome com flex:1;min-width:0 e estrelas soltas na linha) não existe mais', !adm.includes('<div style="flex:1;min-width:0">') && !/display:flex;align-items:center;gap:6px;padding:10px 14px;border-top/.test(adm));

// ── sem a churrasqueira, jogador comum, inativo, nomes estranhos ───────────────────────────────
check('sem churrasco na liga: o botão 🍖 não aparece, o resto do grupo continua igual', !/togglePlayerChurrasco/.test(render({ churrasco: false })) && /togglePlayerGoleiro/.test(render({ churrasco: false })) && abre(render({ churrasco: false })) === fecha(render({ churrasco: false })));
const jog = render({ admin: false });
const lj = linhasDe(jog);
check('jogador comum: o mesmo grupo, só com as 5 estrelas (sem botão nenhum), e a linha cabe num celular (nome com base 120 + estrelas de uns 100 px)', lj.length === 8 && lj.every(x => !/<button/.test(x) && (x.match(/★/g) || []).length === 5), lj.map(x => (x.match(/★/g) || []).length));
check('jogador comum: tags <div> equilibradas', abre(jog) === fecha(jog), { abre: abre(jog), fecha: fecha(jog) });
const ina = render({ players: [{ id: 'x1', name: 'Inativo', stars: 3, active: false }] });
check('jogador inativo: a linha fica esmaecida (opacity 0.45, a ativa fica em 1) e o botão diz Inativo', linhasDe(ina)[0].startsWith('0.45">') && /Inativo/.test(linhasDe(ina)[0]) && linhasDe(adm)[0].startsWith('1">'));
const longo = render({ players: [{ id: 'y1', name: 'João Henrique da Silva Santos Albuquerque de Oliveira', stars: 2 }, { id: 'y2', name: 'Supercalifragilisticoexpialidocious', stars: 1 }] });
check('nome muito comprido (uma palavra de 35 letras): fica no bloco do nome, que quebra, nunca em cima dos controles', linhasDe(longo).length === 2 && linhasDe(longo).every(x => x.indexOf('overflow-wrap:anywhere') > 0 && x.indexOf('overflow-wrap:anywhere') < x.indexOf('margin-left:auto')));
const xss = render({ players: [{ id: 'z1', name: '<img src=x onerror=alert(1)>', stars: 1 }] });
check('nome com marcação: vai escapado (nada de tag solta na tela)', !xss.includes('<img src=x') && xss.includes('&lt;img src=x'));
check('lista vazia: continua dizendo "Nenhum jogador cadastrado" (nada quebra sem linhas)', /Nenhum jogador cadastrado/.test(render({ players: [] })) && abre(render({ players: [] })) === fecha(render({ players: [] })));

// ── manual ────────────────────────────────────────────────────────────────────────────────────
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim();
const i1 = manual.indexOf('id="elenco-celular"');
const quadro = i1 >= 0 ? plain(manual.slice(i1, i1 + 1800)) : '';
check('manual: o quadro "Elenco no celular" explica que, em tela estreita, o nome fica na primeira linha e as estrelas e os botões descem juntos para a segunda (e em tela larga ficam na mesma linha)', /Elenco no celular/.test(quadro) && /primeira linha/.test(quadro) && /segunda linha/.test(quadro) && /estrelas/.test(quadro) && /tela larga|computador/.test(quadro), quadro.slice(0, 300));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
