// Rival (item 36), o manual contra o código: as 17 badges novas (nome, ícone e regra de cada uma nas tabelas certas), os números das regras (3 jogos, dia 5, 24 meses, sequência de 3, Alvo com 3,
// tempo de 3, 6 e 12 meses, limites de chamadas), os nomes de funções e variáveis citados no texto técnico (todos existem de verdade), os arquivos do cartão do duelo e a privacidade.
// Quando o código muda um número e o manual esquece, este teste falha.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), manual = read('manual.html'), serverIndex = read('functions/index.js'), rivalSrc = read('functions/rival.js');
let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const between = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + from.length); if (a < 0 || b < 0) throw new Error('marcador não achado: ' + from + ' … ' + to); return src.slice(a, b); };
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(').trim();
const num = (src, re) => { const m = src.match(re); if (!m) throw new Error('número não achado: ' + re); return Number(m[1]); };

const H2H_IDS = ['carrasco', 'fregues', 'tira_teima', 'classico'];
const RIVAL_IDS = ['duelo_aluno', 'duelo_fora_liga', 'duelo_mao', 'duelo_trator', 'duelo_dono', 'duelo_sombra', 'rival_passou', 'rival_ultrapassada', 'rival_3m', 'rival_6m', 'rival_12m', 'rival_declarada', 'alvo_galera'];
const entryOf = id => { const m = html.match(new RegExp(`^ {2}\\{ id:'${id}',\\s+emoji:'([^']*)',\\s+label:'([^']*)',\\s+desc:'([^']*)'`, 'm')); if (!m) throw new Error('badge fora do catálogo: ' + id); return { id, emoji: m[1], label: m[2], desc: m[3] }; };

// ── 1. as tabelas das badges ──
const tabH2h = between(manual, '<h3 id="badges-frente-a-frente">', '</table>');
const tabRival = between(manual, '<h3 id="badges-rival">', '</table>');
check('as 4 badges do frente a frente estão na tabela do manual, com o ícone e o nome do catálogo, e a tabela não tem mais nada', H2H_IDS.every(id => { const e = entryOf(id); return tabH2h.includes(`<td>${e.emoji} ${e.label}</td>`); }) && (tabH2h.match(/<tr><td>/g) || []).length === 4, tabH2h.slice(0, 200));
check('as 13 badges do rival estão na tabela do manual, com o ícone e o nome do catálogo, e a tabela não tem mais nada', RIVAL_IDS.every(id => { const e = entryOf(id); return tabRival.includes(`<td>${e.emoji} ${e.label}</td>`); }) && (tabRival.match(/<tr><td>/g) || []).length === 13, tabRival.slice(0, 200));
check('nenhuma badge das duas tabelas aparece na tabela errada', H2H_IDS.every(id => !tabRival.includes(entryOf(id).label)) && RIVAL_IDS.every(id => !tabH2h.includes(entryOf(id).label)));
check('o nome é "Passei o Trator" (pedido do dono, 20/10/2026) em todo o app e no manual; "Passou o Rodo" não existe em lugar nenhum', entryOf('duelo_trator').label === 'Passei o Trator' && manual.includes('🚜 Passei o Trator') && !/Passou o Rodo/i.test(html) && !/Passou o Rodo/i.test(manual) && !/Passou o Rodo/i.test(serverIndex + rivalSrc));
const tdOf = (tab, e) => { const m = tab.match(new RegExp(`<td>${e.emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${e.label}</td><td>(.*?)</td>`)); return m ? plain(m[1]) : ''; };
// ── 2. os números das regras: o do código tem de ser o do manual ──
const carr = html.match(/h2hCarrasco: all\.some\(r => r\.w >= (\d+) && r\.w - r\.l >= (\d+)\)/), freg = html.match(/h2hFregues: all\.some\(r => r\.l >= (\d+) && r\.l - r\.w >= (\d+)\)/), tira = num(html, /h2hTiraTeima: all\.some\(r => r\.games >= (\d+) && r\.w === r\.l\)/), clas = num(html, /h2hClassico: all\.some\(r => r\.games >= (\d+)\)/);
check(`Carrasco e Freguês: o manual diz ${carr[1]} ou mais jogos e pelo menos ${carr[2]} a mais (como o código)`, tdOf(tabH2h, entryOf('carrasco')).includes(`Ganhou ${carr[1]} ou mais jogos`) && tdOf(tabH2h, entryOf('carrasco')).includes(`pelo menos ${carr[2]} a mais do que perdeu`) && tdOf(tabH2h, entryOf('fregues')).includes(`perdeu ${freg[1]} ou mais jogos`) && tdOf(tabH2h, entryOf('fregues')).includes(`pelo menos ${freg[2]} a mais do que ganhou`) && carr[1] === freg[1] && carr[2] === freg[2], [carr && carr.slice(1), freg && freg.slice(1)]);
check(`Tira-teima (${tira} jogos) e Clássico (${clas} jogos) batem com o código`, tdOf(tabH2h, entryOf('tira_teima')).includes(`${tira} ou mais jogos`) && tdOf(tabH2h, entryOf('classico')).startsWith(`${clas} ou mais jogos`));
const STREAK = num(rivalSrc, /STREAK_LENGTH = (\d+)/), ALVO = num(rivalSrc, /ALVO_MIN = (\d+)/), KEEP = num(rivalSrc, /KEEP_MONTHS = (\d+)/);
const TEN = [...rivalSrc.matchAll(/\[(\d+), "(rival_\d+m)"\]/g)].map(m => [Number(m[1]), m[2]]);
check(`sequência de ${STREAK} (Dono e Sombra do Rival), Alvo da Galera com ${ALVO} jogadores e tempo de ${TEN.map(t => t[0]).join(', ')} meses batem com o servidor`, tdOf(tabRival, entryOf('duelo_dono')).includes(`${STREAK} duelos do mês seguidos`) && tdOf(tabRival, entryOf('duelo_sombra')).includes(`${STREAK} duelos do mês seguidos`) && tdOf(tabRival, entryOf('alvo_galera')).includes(`${ALVO} ou mais jogadores`) && TEN.length === 3 && TEN.every(([n, id]) => tdOf(tabRival, entryOf(id)).startsWith(`${n} meses com o mesmo rival`)), [STREAK, ALVO, TEN]);
check('as descrições do catálogo (o que o jogador lê ao tocar na badge) dizem os mesmos números que o manual', entryOf('duelo_dono').desc.includes(`${STREAK} duelos`) && entryOf('duelo_sombra').desc.includes(`${STREAK} duelos`) && entryOf('alvo_galera').desc.includes(`${ALVO} ou mais`) && TEN.every(([n, id]) => entryOf(id).desc.startsWith(`${n} meses`)) && entryOf('carrasco').desc.includes(`${carr[1]}+`) && entryOf('classico').desc.includes(`${clas}+`) && entryOf('tira_teima').desc.includes(`${tira}+`));
const MIN_GAMES = num(html, /RIVAL_MIN_GAMES = (\d+)/), CLOSE = num(html, /RIVAL_CLOSE_DAY = (\d+)/);
const rivalSec = between(manual, '<h3 id="rival">', '<h3>Modo de teste (admin)</h3>');
const rivalTxt = plain(rivalSec);
check(`o duelo: o manual diz ${MIN_GAMES} jogos ou mais, que o mês fecha no dia ${CLOSE} do mês seguinte, histórico de ${KEEP} meses e as regras de 3 e de 4 números decididos`, rivalTxt.includes(`${MIN_GAMES} jogos ou mais`) && rivalTxt.includes(`fecha no dia ${CLOSE} do mês seguinte`) && rivalTxt.includes(`histórico privado (${KEEP} meses)`) && rivalTxt.includes('(com 3 ou mais decididos)') && rivalTxt.includes('todos (4 ou mais)') && rivalTxt.includes('metade para cada lado (4 ou mais decididos) é empate'), [MIN_GAMES, CLOSE, KEEP]);
check('o código do duelo usa as mesmas regras do manual (classificação: 3 decididos, 4 para "todos" e para o empate)', /if \(decided < 3\) return 'none';/.test(html) && /return t === 0 && m >= 4 \? 'trator' : 'mao';/.test(html) && /return m === 0 && t >= 4 \? 'fora' : 'aluno';/.test(html) && /case "empate": return m === t && decided >= 4;/.test(rivalSrc));
check('as badges "Fora da Sua Liga" e "Passei o Trator" dizem no manual que precisam de 4 ou mais números com vencedor', tdOf(tabRival, entryOf('duelo_fora_liga')).includes('4 ou mais números com vencedor') && tdOf(tabRival, entryOf('duelo_trator')).includes('4 ou mais números com vencedor'));

// ── 3. os nomes citados no texto técnico existem de verdade ──
const cited = [...new Set([...rivalSec.matchAll(/<code>([A-Za-z_][A-Za-z0-9_]*)<\/code>/g)].map(m => m[1]))];
const exists = id => new RegExp(`\\b${id}\\b`).test(html) || new RegExp(`\\b${id}\\b`).test(serverIndex) || new RegExp(`\\b${id}\\b`).test(rivalSrc);
check(`todos os ${cited.length} nomes entre <code> na seção do rival existem no código (função, variável ou campo)`, cited.length > 15 && cited.every(exists), cited.filter(id => !exists(id)));
check('o manual cita as funções do servidor do rival e elas existem em functions/index.js', ['setRival', 'saveRivalProgress', 'syncRivals'].every(f => rivalSec.includes(`<code>${f}</code>`) && new RegExp(`exports\\.${f} = onCall`).test(serverIndex)));
const limitOf = f => num(serverIndex, new RegExp(`checkRateLimit\\(auth\\.uid, "${f}", (\\d+)\\)`));
const fnRow = f => { const m = manual.match(new RegExp(`<td><code>${f}</code></td>\\s*<td>(.*?)</td>\\s*<td>(.*?)</td>`, 's')); return m ? plain(m[1] + ' ' + m[2]) : ''; };
check(`a tabela de funções do manual diz os limites de chamadas por minuto de cada uma (${limitOf('setRival')}, ${limitOf('saveRivalProgress')} e ${limitOf('syncRivals')})`, fnRow('setRival').includes(`Limite de ${limitOf('setRival')} chamadas por minuto`) && fnRow('saveRivalProgress').includes(`Limite de ${limitOf('saveRivalProgress')} chamadas por minuto`) && fnRow('syncRivals').includes(`Limite de ${limitOf('syncRivals')} chamadas por minuto`), [fnRow('setRival'), fnRow('saveRivalProgress'), fnRow('syncRivals')]);
check('quem pode chamar cada função, no manual, é o que o código exige (setRival e saveRivalProgress: a própria conta ligada a um jogador; syncRivals: admin da liga)', /Jogador ou admin da liga, com a conta ligada a um jogador do elenco/.test(fnRow('setRival')) && /A própria conta, com um rival escolhido/.test(fnRow('saveRivalProgress')) && /Admin da liga e o dono do sistema/.test(fnRow('syncRivals')) && /await requireLeagueAdmin\(auth, liga\);\n  const rename/.test(serverIndex.slice(serverIndex.indexOf('exports.syncRivals'))));

// ── 4. o cartão do duelo ──
const duelFiles = html.match(/rivalduel: \{[\s\S]*?file: \{ story: '([^']+)', feed: '([^']+)' \}/);
const cartao = between(manual, '<h3 id="cartao-duelo">', '<h3 id="cartao-rival-numeros">');
check('os arquivos do cartão do duelo (Story e Feed) são os do código, na tabela de arquivos e na subseção; a legenda sai sem nome', !!duelFiles && manual.includes(`<code>${duelFiles[1]}</code> / <code>${duelFiles[2]}</code>`) && /Duelo do mês × rival/.test(manual) && /A legenda traz só a frase, sem nome\./.test(cartao) && /duelo-pelada-na-mao-story\.png/.test(manual), duelFiles && duelFiles.slice(1));
check('o botão do cartão do duelo (📤 Compartilhar duelo) tem o mesmo nome no app e no manual', html.includes('📤 Compartilhar duelo') && rivalSec.includes('📤 Compartilhar duelo'));

// ── 5. privacidade, admin e plano gratuito ──
check('privacidade (LGPD): a escolha fica no servidor, só a própria conta lê, o rival não é avisado, o que a liga vê e o que é apagado ao sair, ser recusado, ser ligado a outro jogador ou excluir a conta', /leagues\/\{liga\}\/rivals\/\{uid\}/.test(rivalSec) && rivalTxt.includes('só você a lê: nem o admin, nem o rival, nem o dono do sistema pelo app') && rivalTxt.includes('O rival não é avisado; só quando os dois se escolhem') && rivalTxt.includes('nunca quem era o rival nem os números do duelo') && rivalTxt.includes('Quem sai da liga, é recusado, é ligado a outro jogador ou exclui a conta tem a escolha e o histórico de duelos apagados'));
check('as regras do Firestore do manual batem com firestore.rules (rivals só a própria conta lê e rival_public a liga ativa lê; nenhuma gravação direta)', (() => { const rules = read('firestore.rules'); const a = rules.slice(rules.indexOf('/rivals/{uid}')), b = rules.slice(rules.indexOf('/rival_public/{key}')); return /allow read: if[^;]*request\.auth\.uid == uid/.test(a.slice(0, 400)) && /allow write: if false;/.test(a.slice(0, 500)) && /allow read: if[^;]*isLeagueActiveUser/.test(b.slice(0, 400)) && /allow write: if false;/.test(b.slice(0, 500)); })());
check('exclusão da conta e anonimização do nome: as tabelas de LGPD do manual citam a escolha de rival e o histórico de duelos', manual.includes('Escolha de rival da conta e histórico dos duelos do mês (seção 13)') && /Rival \(seção 13\): a escolha dela, as escolhas que apontam para ela, o histórico de duelos e as badges do rival/.test(manual));
check('o interruptor do admin tem a seção própria (id badges-confronto-direto) e cita o campo h2hBadges, ligado por padrão', /<h3 id="badges-confronto-direto">/.test(manual) && between(manual, '<h3 id="badges-confronto-direto">', '<h3 id="estrelas-do-grupo">').includes('<code>h2hBadges</code>') && between(manual, '<h3 id="badges-confronto-direto">', '<h3 id="estrelas-do-grupo">').includes('Elas vêm <strong>ligadas</strong>') && /h2hBadges: +data\.h2hBadges +\?\? true/.test(html));
check('o plano gratuito: o manual lista o rival, o frente a frente e o duelo do mês entre o que o plano gratuito tem (e o código não limita o rival por plano)', manual.includes('Escolher um rival, comparar, ver o frente a frente e disputar o duelo do mês') && !/freeMode|isFree|planFree/.test(html.slice(html.indexOf('/* ── Rival ─'), html.indexOf('function closeModal()')).replace(/!c\.freeMode/g, '').replace(/c\.freeMode/g, '')));
check('texto sobre jogadores no masculino genérico: nada de "as duas pessoas / as duas têm / as duas se escolheram" na seção do rival, nas tabelas das badges novas nem no código ("as duas" para as abas é feminino certo)', !/as duas (pessoas|têm|tem|se |escolh|ficam|jogadoras)/i.test(plain(rivalSec) + plain(tabRival) + plain(tabH2h)) && !/AS DUAS/.test(html.slice(html.indexOf('/* ── Rival ─'), html.indexOf('function closeModal()'))));
check('meio título (½) não aparece nas tabelas novas nem na seção do rival, fora o formato do número de títulos (regra de divulgação: poucas ligas usam)', !/meio t[ií]tulo/i.test(tabRival + tabH2h) && !/meio t[ií]tulo/i.test(rivalSec));

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
