// Resumo do campeonato para o grupo do WhatsApp (index.html, gerarResumoChamp): a primeira linha leva o NOME DA LIGA em maiúsculas
// (antes era "ACEOMA" fixo, em qualquer liga); sem nome, "Pelada na Mão"; os asteriscos do nome saem (no WhatsApp o *…* é o negrito).
// Extrai o código real do index.html e o executa num ambiente simulado.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const at = s => { const i = html.indexOf(s); if (i < 0) throw new Error('trecho não encontrado: ' + s); return i; };
function slice(from, to) { const a = at(from); const b = html.indexOf(to, a); if (b < 0) throw new Error('marcador não encontrado: ' + to); return html.slice(a, b); }
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(');

// O código real: a formatação da data (fdt), o ajudante do nome da liga e a montagem do resumo.
const fdtSrc = slice('const fdt = d =>', '\n');
const code = slice('// Primeira linha do resumo do campeonato para o grupo', 'function copyChampSummary(');

function makeEnv({ leagues, leagueId = 'L', date = '2026-09-12' } = {}) {
  const env = {
    st: { availableLeagues: leagues, leagueId, ranks: [], champs: [{ id: 'c1', date, champion: 'azul', teamRosters: { azul: ['Ana', 'Bia'] }, champion_players: [] }] },
    T: { azul: { l: 'Azul' } },
    champArtilheiros: () => [], champGoalTally: () => ({}), champPlayerGames: () => 0,
    computeNewBadgesInChamp: () => ({}), getBadgeCache: () => ({ badgeHolders: {} }), BADGE_CATALOG: [], getChampAwards: () => null,
  };
  const names = Object.keys(env);
  const api = new Function(...names, fdtSrc + '\n' + code + '\nreturn { resumoLeagueName, gerarResumoChamp };')(...names.map(n => env[n]));
  return api;
}
const linhas = msg => msg.split('\n');
const comLiga = (name, extra) => makeEnv({ leagues: [{ id: 'L', name }], ...extra });

// ── o título leva o nome da liga ────────────────────────────────────────────────────────────
let api = comLiga('Série B Aceoma');
let msg = api.gerarResumoChamp('c1');
check('liga "Série B Aceoma": a primeira linha é o nome da liga em maiúsculas e a data do campeonato', linhas(msg)[0] === '🏆 *SÉRIE B ACEOMA — 12/09/2026*', linhas(msg)[0]);
check('o resto do resumo não mudou (campeão e elenco logo depois do título, com uma linha em branco entre eles)', linhas(msg)[1] === '' && linhas(msg)[2] === '🥇 *Campeão: Azul*' && linhas(msg)[3] === '👥 Ana, Bia', linhas(msg).slice(0, 5));

api = comLiga('FutQuarta');
msg = api.gerarResumoChamp('c1');
check('liga "FutQuarta": o título é FUTQUARTA, e o nome antigo ACEOMA não aparece em lugar nenhum da mensagem', linhas(msg)[0] === '🏆 *FUTQUARTA — 12/09/2026*' && !/ACEOMA/i.test(msg), linhas(msg)[0]);

api = makeEnv({ leagues: [{ id: 'L1', name: 'Liga Um' }, { id: 'L2', name: 'Liga Dois' }, { id: 'L3', name: 'Liga Três' }], leagueId: 'L2' });
check('com várias ligas, usa a liga ABERTA (a escolhida em st.leagueId), não a primeira nem outra', linhas(api.gerarResumoChamp('c1'))[0] === '🏆 *LIGA DOIS — 12/09/2026*', linhas(api.gerarResumoChamp('c1'))[0]);
api = comLiga('FutQuarta', { date: '2026-10-03' });
check('a data do título é a do campeonato (03/10/2026)', linhas(api.gerarResumoChamp('c1'))[0] === '🏆 *FUTQUARTA — 03/10/2026*', linhas(api.gerarResumoChamp('c1'))[0]);

api = comLiga('⚽ Série B — Aceoma & Cia!');
check('nome com emoji, acento e símbolos: só vai para maiúsculas, nada some', api.resumoLeagueName() === '⚽ SÉRIE B — ACEOMA & CIA!', api.resumoLeagueName());

// ── o nome não pode quebrar o negrito do WhatsApp (*…*) nem a linha ─────────────────────────
api = comLiga('*Pelada* Top*');
const tituloAst = linhas(api.gerarResumoChamp('c1'))[0];
check('asteriscos no nome saem: o título continua com exatamente 2 (o negrito) e o nome fica "PELADA TOP"', tituloAst === '🏆 *PELADA TOP — 12/09/2026*' && (tituloAst.match(/\*/g) || []).length === 2, tituloAst);
api = comLiga('  Liga   do\nBairro  ');
check('espaços repetidos, bordas e quebra de linha no nome viram um espaço só (o título fica numa linha)', api.resumoLeagueName() === 'LIGA DO BAIRRO' && linhas(api.gerarResumoChamp('c1'))[0] === '🏆 *LIGA DO BAIRRO — 12/09/2026*', api.resumoLeagueName());

// ── sem nome: "Pelada na Mão", nunca o nome antigo ──────────────────────────────────────────
for (const [caso, a] of [
  ['liga sem nome', comLiga('')],
  ['nome só com espaços e asteriscos', comLiga(' * * ')],
  ['nome ausente (undefined)', comLiga(undefined)],
  ['a liga aberta não está na lista', makeEnv({ leagues: [{ id: 'OUTRA', name: 'Outra' }], leagueId: 'L' })],
  ['lista de ligas vazia', makeEnv({ leagues: [] })],
  ['lista de ligas ainda não carregada (undefined)', makeEnv({ leagues: undefined })],
]) {
  const t = linhas(a.gerarResumoChamp('c1'))[0];
  check(`${caso}: o título usa "PELADA NA MÃO" (o nome do produto) e não quebra`, t === '🏆 *PELADA NA MÃO — 12/09/2026*' && !/ACEOMA/i.test(t), t);
}
check('campeonato que não existe: continua devolvendo texto vazio (a janela não abre)', comLiga('FutQuarta').gerarResumoChamp('nao-existe') === '');

// ── como está ligado no app ─────────────────────────────────────────────────────────────────
const fnSrc = slice('function gerarResumoChamp(', 'function copyChampSummary(');
check('gerarResumoChamp monta o título com o ajudante do nome da liga (uma vez) e não tem nenhum "ACEOMA"/"Aceoma" escrito dentro', (fnSrc.match(/resumoLeagueName\(\)/g) || []).length === 1 && /let msg = `🏆 \*\$\{resumoLeagueName\(\)\} — \$\{fdt\(champ\.date\)\}\*\\n\\n`;/.test(fnSrc) && !/aceoma/i.test(fnSrc), fnSrc.slice(fnSrc.indexOf('let msg'), fnSrc.indexOf('let msg') + 120));
check('a janela do resumo, o botão Copiar e o botão WhatsApp usam a MESMA função (o nome da liga vai nos três)', /function copyChampSummary\(champId\) \{\s*const msg = gerarResumoChamp\(champId\);/.test(html) && /function openWhatsAppSummary\(champId\) \{\s*const msg = gerarResumoChamp\(champId\);/.test(html) && /function mChampSummary\(\) \{[\s\S]*?const msg = gerarResumoChamp\(m\.champId\);/.test(html));
check('nenhuma mensagem do app começa com o nome antigo em maiúsculas (*ACEOMA …*)', !/\*ACEOMA/.test(html));
check('PRIVACIDADE: o ajudante só lê o nome da liga já carregado (não chama banco, funções nem rede)', !/\bfetch\(|callFn|XMLHttpRequest|\bDB\.|ldoc\(|\bcol\(|firebase\.|sendBeacon|trackEvent/.test(slice('function resumoLeagueName()', 'function gerarResumoChamp(')));

// ── manual ──────────────────────────────────────────────────────────────────────────────────
const resumoSec = plain(manual.slice(manual.indexOf('id="resumo"'), manual.indexOf('<!-- 17. Múltiplas Ligas -->')));
check('manual (seção 15): diz que a primeira linha do resumo traz o nome da liga em maiúsculas e a data, que os asteriscos saem e que sem nome sai "Pelada na Mão"', /🏆 Título A primeira linha traz o nome da liga, em maiúsculas, e a data do campeonato/.test(resumoSec) && /FUTQUARTA — 12\/09\/2026/.test(resumoSec) && /Os asteriscos que o nome tiver são tirados/.test(resumoSec) && /uma liga sem nome sai como "Pelada na Mão"/.test(resumoSec), resumoSec.slice(0, 300));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
