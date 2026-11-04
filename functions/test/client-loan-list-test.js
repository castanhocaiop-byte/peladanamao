// A lista "+ Emprestado" da tela de gols (item 44): mostra SÓ os jogadores dos OUTROS times do campeonato (nem o time da vez, nem o adversário, nem quem não está em time nenhum), em ordem
// alfabética. Confere as duas pontas da partida, a ordem (acento e maiúscula), quem sai da lista, o que continua aparecendo (os emprestados já marcados), o campeonato sem elenco registrado
// (volta a listar todos os cadastrados, senão não haveria como apontar quem jogou), os botões e o escape dos nomes. O código é o REAL do index.html (fatiado e executado com um aplicativo falso).
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
const teamCode = slice('const T = {', 'function enabledColors()');
const pickersCode = slice('function renderGoalPickers() {', 'function confirmScore() {');

const PLAYERS = ['Ana', 'Bruno', 'Carla', 'Davi', 'Edu', 'Fabi', 'Gil', 'Hugo', 'Iara'].map(name => ({ name })).concat([{ name: 'Juca', somenteChurrasco: true }]);
const R4 = { azul: ['Ana', 'Bruno'], verde: ['Carla', 'Davi'], amarelo: ['Fabi', 'Edu'], vermelho: ['Hugo', 'Gil'] }; // amarelo e vermelho fora de ordem de propósito
const CH = (o = {}) => ({ id: 'c1', status: 'active', teams: ['azul', 'verde', 'amarelo', 'vermelho'], teamRosters: R4, matches: [], ...o });
const MOD = (o = {}) => ({ type: 'score', id: 'm1', home: 'azul', away: 'verde', phase: 'regular', hs: 0, as: 0, homeGoalMap: {}, awayGoalMap: {}, homeEmpPartic: {}, awayEmpPartic: {}, ...o });

function pickers({ players = PLAYERS, champs = [CH()], modal = MOD() } = {}) {
  const st = { players, champs, modal };
  const env = { st, activeChamp: () => st.champs.find(c => c.status === 'active') };
  const names = Object.keys(env);
  const api = new Function(...names, [escCode, teamCode, pickersCode].join('\n') + '\nreturn { renderGoalPickers };')(...names.map(n => env[n]));
  const h = api.renderGoalPickers();
  // os nomes da lista "+ Emprestado" de cada lado, na ordem em que aparecem (só os botões ⚽ da lista fecham o <details>)
  const lend = { home: [], away: [] };
  for (const m of h.matchAll(/onclick="adjGoal\('(home|away)','((?:[^'\\]|\\.)*)',1\);this\.closest\('details'\)\.open=false"/g)) lend[m[1]].push(m[2].replace(/\\(.)/g, '$1'));
  return { h, lend };
}
const J = JSON.stringify;

// ══ 1. QUEM APARECE ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const p1 = pickers();
check('azul × verde: a lista dos dois lados traz só os jogadores dos outros times (amarelo e vermelho), em ordem alfabética: Edu, Fabi, Gil, Hugo', J(p1.lend.home) === '["Edu","Fabi","Gil","Hugo"]' && J(p1.lend.away) === '["Edu","Fabi","Gil","Hugo"]', p1.lend);
check('o time da vez e o adversário NÃO aparecem na lista (antes o adversário vinha primeiro): Ana, Bruno, Carla e Davi ficam de fora dos dois lados', ['Ana', 'Bruno', 'Carla', 'Davi'].every(n => !p1.lend.home.includes(n) && !p1.lend.away.includes(n)), p1.lend);
check('quem não está em time nenhum (Iara, cadastrada) e o "só churrasco" (Juca) não aparecem', !p1.lend.home.includes('Iara') && !p1.lend.home.includes('Juca') && !p1.lend.away.includes('Iara') && !p1.lend.away.includes('Juca'));
const p2 = pickers({ modal: MOD({ home: 'amarelo', away: 'vermelho' }) });
check('amarelo × vermelho: a lista traz os jogadores de azul e verde em ordem alfabética (Ana, Bruno, Carla, Davi)', J(p2.lend.home) === '["Ana","Bruno","Carla","Davi"]' && J(p2.lend.away) === '["Ana","Bruno","Carla","Davi"]', p2.lend);
const p3 = pickers({ modal: MOD({ home: 'vermelho', away: 'azul' }) });
check('a ordem dos times na partida não muda a lista (vermelho em casa contra o azul: Carla, Davi, Edu, Fabi)', J(p3.lend.home) === '["Carla","Davi","Edu","Fabi"]' && J(p3.lend.away) === '["Carla","Davi","Edu","Fabi"]', p3.lend);
const rev = { vermelho: ['Hugo', 'Gil'], amarelo: ['Fabi', 'Edu'], verde: ['Carla', 'Davi'], azul: ['Ana', 'Bruno'] };
check('a ordem dos times no campeonato também não muda a lista (elencos guardados ao contrário)', J(pickers({ champs: [CH({ teamRosters: rev })] }).lend.home) === '["Edu","Fabi","Gil","Hugo"]');

// ══ 2. A ORDEM ALFABÉTICA ═════════════════════════════════════════════════════════════════════════════════════════════════════
const accent = pickers({ champs: [CH({ teams: ['azul', 'verde', 'amarelo'], teamRosters: { azul: ['Ana2'], verde: ['Bia'], amarelo: ['zé', 'Ângelo', 'bruno', 'Ana', 'carla'] } })], modal: MOD() });
check('a ordem ignora maiúscula e acento no português: Ana, Ângelo, bruno, carla, zé', J(accent.lend.home) === '["Ana","Ângelo","bruno","carla","zé"]', accent.lend);
check('o mesmo nome em dois elencos (dado repetido) aparece uma vez só', J(pickers({ champs: [CH({ teams: ['azul', 'verde', 'amarelo', 'vermelho'], teamRosters: { azul: ['Ana'], verde: ['Carla'], amarelo: ['Edu', 'Fabi'], vermelho: ['Fabi', 'Gil'] } })] }).lend.home) === '["Edu","Fabi","Gil"]');
check('quem está no elenco de um dos times da partida e também em outro elenco (dado repetido: a Ana no azul e no vermelho) não aparece na lista, nem no lado do azul nem no do verde (para o verde ela é do adversário)', (() => { const x = pickers({ champs: [CH({ teamRosters: { ...R4, vermelho: ['Hugo', 'Ana'] } })] }); return J(x.lend.home) === '["Edu","Fabi","Hugo"]' && J(x.lend.away) === '["Edu","Fabi","Hugo"]'; })());

// ══ 3. O QUE CONTINUA APARECENDO ══════════════════════════════════════════════════════════════════════════════════════════════
const emp = pickers({ modal: MOD({ homeGoalMap: { Edu: 2, Iara: 1 }, homeEmpPartic: { Fabi: true } }) });
check('emprestado que já foi marcado (com gols, ou "✓ jogo") continua aparecendo na lista de cima, com a etiqueta, e sai da lista de escolha desse lado', /Edu <span[^>]*>emp\.<\/span>/.test(emp.h) && /Fabi <span[^>]*>emp\. ✓jogo<\/span>/.test(emp.h) && J(emp.lend.home) === '["Gil","Hugo"]', [emp.lend, emp.h.slice(0, 400)]);
check('o outro lado da partida não é afetado: lá o Edu e o Fabi continuam na lista de escolha', J(emp.lend.away) === '["Edu","Fabi","Gil","Hugo"]', emp.lend);
check('marca antiga de quem NÃO está em time nenhum (a Iara fez gol emprestada pela regra antiga) continua aparecendo no jogo, para o admin ver e corrigir, mas ela não entra na lista de escolha', /Iara <span[^>]*>emp\.<\/span>/.test(emp.h) && !emp.lend.home.includes('Iara') && !emp.lend.away.includes('Iara'));
const roster = pickers({ modal: MOD({ homeGoalMap: { Ana: 1 } }) });
check('os jogadores do elenco do time continuam com os botões − e + de gol e o contador (nada mudou ali)', /adjGoal\('home','Ana',-1\)/.test(roster.h) && /adjGoal\('home','Ana',1\)/.test(roster.h) && /adjGoal\('away','Carla',1\)/.test(roster.h) && /Ana[\s\S]*?color:#4DB8FF">1<\/span>/.test(roster.h), roster.h.slice(0, 400));
check('cada nome da lista leva os dois botões do lado certo: ⚽ (1 gol) e "✓ Jogo"', /adjGoal\('home','Edu',1\);this\.closest\('details'\)\.open=false/.test(p1.h) && /toggleEmpPartic\('home','Edu'\);this\.closest\('details'\)\.open=false/.test(p1.h) && /adjGoal\('away','Hugo',1\);this\.closest\('details'\)\.open=false/.test(p1.h) && /toggleEmpPartic\('away','Hugo'\);this\.closest\('details'\)\.open=false/.test(p1.h));

// ══ 4. QUEM É DE OUTRO TIME APARECE, MESMO SENDO INATIVO OU CONVIDADO ═══════════════════════════════════════════════════════════
const odd = pickers({ players: PLAYERS.map(p => (p.name === 'Edu' ? { ...p, active: false } : p)), champs: [CH({ teamRosters: { ...R4, vermelho: ['Hugo', 'Gil', 'Zeca Convidado'] } })] });
check('quem está em outro time aparece mesmo se estiver inativo no cadastro (Edu) e o convidado sem cadastro (Zeca Convidado) também', J(odd.lend.home) === '["Edu","Fabi","Gil","Hugo","Zeca Convidado"]', odd.lend);

// ══ 5. SEM ELENCO REGISTRADO ═══════════════════════════════════════════════════════════════════════════════════════════════════
const sem1 = pickers({ champs: [CH({ teamRosters: undefined })] }), sem2 = pickers({ champs: [CH({ teamRosters: {} })] }), sem3 = pickers({ champs: [CH({ teamRosters: { azul: [], verde: [] } })] });
check('campeonato sem elenco nenhum registrado (sem a lista, vazia ou com times vazios): a lista volta a trazer todos os cadastrados que jogam, em ordem alfabética (o "só churrasco" não)', [sem1, sem2, sem3].every(x => J(x.lend.home) === '["Ana","Bruno","Carla","Davi","Edu","Fabi","Gil","Hugo","Iara"]' && J(x.lend.away) === J(x.lend.home)), [sem1.lend, sem2.lend, sem3.lend]);
const nenhum = pickers({ champs: [CH({ teams: ['azul', 'verde', 'amarelo'], teamRosters: { azul: ['Ana'], verde: ['Bruno'], amarelo: [] } })] });
check('com elencos registrados mas os outros times vazios não há ninguém para emprestar: a seção "+ Emprestado" nem aparece (quem não está em time nenhum entra pelo card Elencos)', !/\+ Emprestado/.test(nenhum.h) && nenhum.lend.home.length === 0 && nenhum.lend.away.length === 0, nenhum.h.slice(0, 300));
const dois = pickers({ champs: [CH({ teams: ['azul', 'verde'], teamRosters: { azul: ['Ana'], verde: ['Bruno'] } })] });
check('campeonato com só dois times: ninguém para emprestar (os dois da partida não aparecem), a seção some', !/\+ Emprestado/.test(dois.h) && dois.lend.home.length === 0);
check('com gente para emprestar a seção "+ Emprestado" aparece nos dois lados', (p1.h.match(/\+ Emprestado/g) || []).length === 2);

// ══ 6. FINAL, JOGO DE CAMPEONATO ANTIGO E ESCAPE ═════════════════════════════════════════════════════════════════════════════════
const fin = pickers({ modal: MOD({ type: 'finalGoals', champId: 'c1', phase: 'final' }) });
check('a janela dos gols da final (finalGoals) usa a mesma lista', J(fin.lend.home) === '["Edu","Fabi","Gil","Hugo"]' && J(fin.lend.away) === '["Edu","Fabi","Gil","Hugo"]', fin.lend);
const velho = pickers({ champs: [CH({ id: 'novo' }), CH({ id: 'c1', status: 'completed', teamRosters: { azul: ['Ana'], verde: ['Bruno'], amarelo: ['Zé'], vermelho: ['Ari'] } })], modal: MOD({ pastChamp: true, champId: 'c1' }) });
check('jogo de um campeonato já concluído (pastChamp) usa os elencos DAQUELE campeonato, em ordem alfabética (Ari, Zé), e não os do campeonato em andamento', J(velho.lend.home) === '["Ari","Zé"]' && J(velho.lend.away) === '["Ari","Zé"]', velho.lend);
const esc = pickers({ champs: [CH({ teamRosters: { azul: ['Ana'], verde: ['Bruno'], amarelo: ["D'Ávila", '<b>x</b>'], vermelho: [] } })] });
check('nome com apóstrofo vai escapado no botão (não quebra o clique) e nome com etiqueta aparece sem virar HTML', J(esc.lend.home) === '["&lt;b>x&lt;/b>","D\'Ávila"]' && /adjGoal\('home','D\\'Ávila',1\)/.test(esc.h) && /&lt;b>x&lt;\/b>/.test(esc.h) && !/<b>x<\/b>/.test(esc.h), [esc.lend, esc.h.slice(0, 300)]);
const aspas = pickers({ champs: [CH({ teamRosters: { azul: ['Ana'], verde: ['Bruno'], amarelo: ['Zé "Pelé"', 'A & B', 'Rafa\\Jr'], vermelho: [] } })] });
check('nome com aspas, & ou barra vai escapado no atributo do botão (aspas viram &quot;, & vira &amp;, a barra é dobrada): não quebra o clique nem o desenho da lista', /adjGoal\('home','Zé &quot;Pelé&quot;',1\);this\.closest/.test(aspas.h) && /adjGoal\('home','A &amp; B',1\);this\.closest/.test(aspas.h) && /adjGoal\('home','Rafa\\\\Jr',1\);this\.closest/.test(aspas.h) && !/onclick="[^"]*Pelé"/.test(aspas.h) && aspas.lend.home.length === 3, aspas.lend);
check('sem o modal de gols aberto a função devolve vazio', (() => { const st = { players: PLAYERS, champs: [CH()], modal: null }; const env = { st, activeChamp: () => null }; const n = Object.keys(env); return new Function(...n, [escCode, teamCode, pickersCode].join('\n') + '\nreturn renderGoalPickers();')(...n.map(k => env[k])) === ''; })());

// ══ 7. AS LIGAÇÕES NO CÓDIGO E NO MANUAL ═══════════════════════════════════════════════════════════════════════════════════════
check('a lista de escolha de cada lado vem da lista dos outros times (lendable) menos os dois times da partida e os emprestados já mostrados, e a conta velha (adversário primeiro + todos os cadastrados) saiu', /const others=lendable\.filter\(n=>!roster\.includes\(n\)&&!oppositeRoster\.includes\(n\)&&!empShown\.has\(n\)\);/.test(html) && !/\[\.\.\.oppositeRoster,\.\.\.allActive/.test(html));
check('a lista dos outros times vem dos elencos do campeonato menos os dois times da partida, sem repetir nome, e é ordenada em português', /const lendable=\(hasRosters\s*\? \[\.\.\.new Set\(Object\.entries\(rosters\)\.filter\(\(\[t\]\)=>t!==m\.home&&t!==m\.away\)\.flatMap\(\(\[,r\]\)=>r\|\|\[\]\)\)\]\s*: allActive\)\.sort\(\(a,b\)=>a\.localeCompare\(b,'pt'\)\);/.test(html));
const card = (manual.match(/<div class="ind-name">Emprestados — com gol<\/div>\s*<div class="ind-desc">([\s\S]*?)<\/div>/) || [])[1] || '';
const txt = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('o manual diz que a lista "+ Emprestado" traz só os jogadores dos outros times do campeonato, em ordem alfabética, sem os dois times da partida nem quem não está em time nenhum, e manda quem chegou depois para o elenco (com o link)', /outros times do campeonato/.test(txt) && /ordem alfabética/.test(txt) && /os dois times da partida e quem não está em nenhum time não aparecem/.test(txt) && /Jogador que chegou depois do sorteio/.test(txt) && /href="#elenco-tardio"/.test(card), txt);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
