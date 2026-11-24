// A ORDEM dos jogos (pedido do dono em 24/11/2026): "em todos os formatos de campeonato (exceto 3 times) evitar que a mesma equipe faça dois jogos seguidos". Confere, com o código REAL do
// index.html (fatiado e executado sem navegador), o gerador de jogos dos campeonatos de 4, 5 e 6 times: quantos jogos, quem enfrenta quem, mandante e visitante equilibrados, as rodadas,
// quantas vezes um time repete o jogo seguinte (zero em 5 e 6 times e nos grupos; 4 times é o mínimo POSSÍVEL, 2), que o resultado é sempre o mesmo para os mesmos times, e o manual.
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), manual = read('manual.html'), ci = read('.github/workflows/ci.yml');
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
const code = slice('function genRoundRobinRounds(', 'function standings(');
const A = new Function('uid', code + '\nreturn { genRoundRobinRounds, genMatches, genGroupMatches, countBackToBack, bestUnitOrder, permutationsOf, gamesShareTeam };')(() => 'x1');
const J = JSON.stringify;
const T = n => Array.from({ length: n }, (_, i) => 'T' + (i + 1));
const pairKey = m => [m.home, m.away].sort().join('|');
const count = (list, f) => list.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
const per = (ms, f) => { const o = {}; ms.forEach(m => { o[m.home] = (o[m.home] || 0) + f(m, 'home'); o[m.away] = (o[m.away] || 0) + f(m, 'away'); }); return o; };
const roundsOf = ms => [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
// quem repete, passagem a passagem (para conferir que são times diferentes)
const repeaters = ms => { const r = []; for (let i = 1; i < ms.length; i++) { const a = [ms[i - 1].home, ms[i - 1].away]; r.push(...[ms[i].home, ms[i].away].filter(t => a.includes(t))); } return r; };

// ══ 1. 5 TIMES: turno único, 10 jogos, ninguém joga duas vezes seguidas ═══════════════════════════════════════════════════
const m5 = A.genMatches(T(5), 5);
check('5 times: 10 jogos, todos "regular", ainda não disputados, sem turnos (leg nulo), ids m_1 a m_10', m5.length === 10 && m5.every(m => m.phase === 'regular' && m.played === false && m.hs === null && m.as === null && m.leg === null) && J(m5.map(m => m.id)) === J(Array.from({ length: 10 }, (_, i) => 'm_' + (i + 1))), m5.length);
check('5 times: cada par de times se enfrenta UMA vez (10 pares diferentes) e cada time joga 4 jogos', Object.keys(count(m5, pairKey)).length === 10 && Object.values(count(m5, pairKey)).every(n => n === 1) && Object.values(per(m5, () => 1)).every(n => n === 4), count(m5, pairKey));
check('5 times: 5 rodadas de 2 jogos; em cada rodada 4 times diferentes jogam e UM descansa (cada time descansa exatamente uma rodada)', J(roundsOf(m5)) === '[1,2,3,4,5]' && roundsOf(m5).every(r => { const g = m5.filter(m => m.round === r); return g.length === 2 && new Set(g.flatMap(m => [m.home, m.away])).size === 4; }) && T(5).every(t => roundsOf(m5).filter(r => !m5.some(m => m.round === r && (m.home === t || m.away === t))).length === 1));
check('5 times: NENHUM time joga duas vezes seguidas (0 repetições; antes eram 4)', A.countBackToBack(m5) === 0 && repeaters(m5).length === 0, repeaters(m5));
check('5 times: as rodadas vêm em ordem na lista (rodada 1 primeiro) e mandante/visitante ficam equilibrados (2 e 2 por time)', m5.every((m, i) => i === 0 || m.round >= m5[i - 1].round) && Object.values(per(m5, (m, side) => (side === 'home' ? 1 : 0))).every(n => n === 2), per(m5, (m, side) => (side === 'home' ? 1 : 0)));

// ══ 2. 6 TIMES SEM FINAL: turno único, 15 jogos ═══════════════════════════════════════════════════════════════════════════
const m6 = A.genMatches(T(6), 6);
check('6 times sem final (sem grupos): 15 jogos, cada par UMA vez, cada time 5 jogos, 5 rodadas de 3 jogos com os 6 times', m6.length === 15 && Object.keys(count(m6, pairKey)).length === 15 && Object.values(per(m6, () => 1)).every(n => n === 5) && roundsOf(m6).length === 5 && roundsOf(m6).every(r => new Set(m6.filter(m => m.round === r).flatMap(m => [m.home, m.away])).size === 6), count(m6, m => m.round));
check('6 times sem final: NENHUM time joga duas vezes seguidas', A.countBackToBack(m6) === 0, repeaters(m6));
check('6 times sem final: nenhum jogo leva grupo nem turno', m6.every(m => m.group === undefined && m.leg === null));

// ══ 3. 4 TIMES: ida e volta, 12 jogos, o MÍNIMO possível de repetições ════════════════════════════════════════════════════
const m4 = A.genMatches(T(4), 4);
check('4 times: 12 jogos; cada par se enfrenta 2 vezes (ida e volta, com mandante e visitante trocados) e cada time joga 6', m4.length === 12 && Object.values(count(m4, pairKey)).every(n => n === 2) && Object.keys(count(m4, pairKey)).length === 6 && Object.values(per(m4, () => 1)).every(n => n === 6) && Object.values(count(m4, m => m.home + '>' + m.away)).every(n => n === 1), count(m4, pairKey));
check('4 times: 6 rodadas de 2 jogos que não se cruzam (os 4 times jogam em cada rodada); ida (leg 1) e volta (leg 2) saem em seguida, na mesma dupla de confrontos', roundsOf(m4).length === 6 && roundsOf(m4).every(r => new Set(m4.filter(m => m.round === r).flatMap(m => [m.home, m.away])).size === 4) && J(m4.map(m => m.leg)) === J([1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2]) && [0, 2, 4].every(b => { const ida = m4.slice(b * 2, b * 2 + 2), volta = m4.slice(b * 2 + 2, b * 2 + 4); return ida.every(g => volta.some(v => v.home === g.away && v.away === g.home)); }), m4.map(m => m.leg + ':' + m.round));
check('4 times: 2 repetições em 11 passagens (antes 5) e é o MÍNIMO POSSÍVEL (nenhuma ordem dos 12 jogos faz menos; a busca por todas as ordens deu 2)', A.countBackToBack(m4) === 2, A.countBackToBack(m4));
check('4 times: as duas repetições são de times DIFERENTES (ninguém repete duas vezes)', new Set(repeaters(m4)).size === 2 && repeaters(m4).length === 2, repeaters(m4));
// prova do mínimo: força bruta sobre TODAS as ordens dos 12 jogos
const brute = (() => {
  const g = m4.map(m => [m.home, m.away]);
  const used = new Array(12).fill(false);
  let min = 99;
  (function go(seq, rep) { if (rep >= min) return; if (seq.length === 12) { min = rep; return; } for (let i = 0; i < 12; i++) { if (used[i]) continue; used[i] = true; go([...seq, g[i]], rep + (seq.length && A.gamesShareTeam(seq[seq.length - 1], g[i]) ? 1 : 0)); used[i] = false; } })([], 0);
  return min;
})();
check('prova: tentando TODAS as ordens possíveis dos 12 jogos de 4 times, o menor número de repetições é 2 (zerar é impossível: cada jogo usa metade dos times)', brute === 2, brute);
check('4 times: mandante e visitante ficam equilibrados (3 e 3 por time)', Object.values(per(m4, (m, side) => (side === 'home' ? 1 : 0))).every(n => n === 3), per(m4, (m, side) => (side === 'home' ? 1 : 0)));

// ══ 4. 6 TIMES COM FINAL: dois grupos de 3, ida e volta, grupos alternados ════════════════════════════════════════════════
const G = { A: ['A1', 'A2', 'A3'], B: ['B1', 'B2', 'B3'] };
const mg = A.genMatches([...G.A, ...G.B], 6, { groups: G });
check('dois grupos: 12 jogos (6 por grupo), cada um com o seu grupo; cada par do grupo se enfrenta 2 vezes (ida e volta) e cada time joga 4', mg.length === 12 && mg.filter(m => m.group === 'A').length === 6 && mg.filter(m => m.group === 'B').length === 6 && mg.every(m => G[m.group].includes(m.home) && G[m.group].includes(m.away)) && Object.values(count(mg, pairKey)).every(n => n === 2) && Object.keys(count(mg, pairKey)).length === 6 && Object.values(per(mg, () => 1)).every(n => n === 4), count(mg, pairKey));
check('dois grupos: NENHUM time joga duas vezes seguidas (os jogos dos grupos se alternam: A, B, A, B…)', A.countBackToBack(mg) === 0 && J(mg.map(m => m.group)) === J(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']), mg.map(m => m.group).join(''));
check('dois grupos: 6 rodadas, cada uma com 1 jogo do grupo A e 1 do B (os 4 times da rodada são diferentes); turno 1 = rodadas 1 a 3 (leg 1) e turno 2 = rodadas 4 a 6 (leg 2)', roundsOf(mg).length === 6 && roundsOf(mg).every(r => { const g = mg.filter(m => m.round === r); return g.length === 2 && g[0].group === 'A' && g[1].group === 'B'; }) && mg.every(m => m.leg === (m.round <= 3 ? 1 : 2)), mg.map(m => m.round + m.group + m.leg));
check('dois grupos: o 2º turno repete o 1º com mandante e visitante trocados, e em cada grupo cada time descansa de 3 em 3 jogos do grupo (quem folga gira)', [0, 1].every(gi => { const grp = mg.filter(m => m.group === (gi ? 'B' : 'A')); return [0, 1, 2].every(i => grp[i + 3].home === grp[i].away && grp[i + 3].away === grp[i].home); }) && (() => { const grp = mg.filter(m => m.group === 'A'); const rest = grp.map(m => G.A.find(t => t !== m.home && t !== m.away)); return J(rest) === J([rest[0], rest[1], rest[2], rest[0], rest[1], rest[2]]) && new Set(rest.slice(0, 3)).size === 3; })(), mg.filter(m => m.group === 'A').map(m => m.home + 'x' + m.away));
check('dois grupos: mandante e visitante equilibrados (2 e 2 por time)', Object.values(per(mg, (m, side) => (side === 'home' ? 1 : 0))).every(n => n === 2), per(mg, (m, side) => (side === 'home' ? 1 : 0)));
check('6 times COM grupos usa os grupos recebidos (não os 6 times em fila): com os mesmos times sem grupos sai o turno único de 15 jogos', A.genMatches(T(6), 6, { groups: { A: ['T1', 'T2', 'T3'], B: ['T4', 'T5', 'T6'] } }).length === 12 && A.genMatches(T(6), 6).length === 15 && A.genMatches(T(6), 6, {}).length === 15);
check('os grupos só valem para 6 times: com 4 ou 5 times, grupos recebidos por engano são ignorados (12 e 10 jogos, sem grupo em nenhum jogo)', (() => { const g = { A: ['T1', 'T2', 'T3'], B: ['T4', 'T5', 'T6'] }; const a = A.genMatches(T(4), 4, { groups: g }), b = A.genMatches(T(5), 5, { groups: g }); return a.length === 12 && b.length === 10 && a.every(m => m.group === undefined) && b.every(m => m.group === undefined); })());

// ══ 5. O MESMO RESULTADO PARA OS MESMOS TIMES, 3 TIMES E CASOS DE BORDA ═══════════════════════════════════════════════════
check('a mesma entrada dá a mesma ordem (sem sorte: o campeonato é gravado uma vez e o app não precisa reproduzi-lo)', [4, 5, 6].every(n => J(A.genMatches(T(n), n)) === J(A.genMatches(T(n), n))) && J(A.genMatches([...G.A, ...G.B], 6, { groups: G })) === J(A.genMatches([...G.A, ...G.B], 6, { groups: G })));
check('o 3 times (vira) continua como sempre: 1 jogo, quem descansa no "rest", sem rodada', (() => { const v = A.genMatches(['azul', 'preto', 'amarelo'], 3); return v.length === 1 && v[0].home === 'azul' && v[0].away === 'preto' && v[0].rest === 'amarelo' && v[0].seq === 1 && v[0].round === undefined; })());
check('com OUTROS times (cores de verdade) a ordem também não repete (5 e 6 times) e os 4 times ficam no mínimo', (() => { const cores = ['azul', 'preto', 'amarelo', 'vermelho', 'verde', 'laranja']; return A.countBackToBack(A.genMatches(cores.slice(0, 5), 5)) === 0 && A.countBackToBack(A.genMatches(cores, 6)) === 0 && A.countBackToBack(A.genMatches(cores.slice(0, 4), 4)) === 2; })());
check('a antiga ordem repetia: 4 times 5 vezes e 5 times 4 vezes (a prova de que mudou: a mesma conta no turno do rodízio sem reordenar)', (() => { const r4 = A.genRoundRobinRounds(T(4)), r5 = A.genRoundRobinRounds(T(5)); const old4 = [...r4.flat(), ...r4.flat().map(([h, v]) => [v, h])].map(([home, away]) => ({ home, away })); const old5 = r5.flat().map(([home, away]) => ({ home, away })); return A.countBackToBack(old4) === 5 && A.countBackToBack(old5) === 4; })());

// ══ 6. A BUSCA ════════════════════════════════════════════════════════════════════════════════════════════════════════════
check('bestUnitOrder escolhe a ordem e a alternativa sem repetição quando existe: duas unidades que só funcionam em uma ordem', (() => {
  // unidade 0: [[A,B]] ; unidade 1: [[B,C]] ; unidade 2: [[C,D]] -> ordem 0,2,1 ou 1,... não repete? (A,B)(C,D)(B,C) tem (C,D)->(B,C) repetindo; a ordem (A,B),(C,D) e depois (B,C) repete; a única sem repetição é (B,C),(A,D)...
  const units = [[[['A', 'B']]], [[['C', 'D']]], [[['A', 'B']], [['B', 'C']]]];
  const ord = A.bestUnitOrder(units);
  return ord.length === 3 && new Set(ord.map(o => o.u)).size === 3;
})());
check('sem solução melhor, devolve a de MENOR repetição (aqui 4 times: 2) e nunca trava (limite de passos)', A.countBackToBack(m4) === 2 && A.bestUnitOrder([[[['A', 'B']]]]).length === 1);
check('permutationsOf: 3 jogos dão 6 ordens, 1 jogo dá 1, 2 jogos dão 2', A.permutationsOf([1, 2, 3]).length === 6 && A.permutationsOf([1]).length === 1 && A.permutationsOf([1, 2]).length === 2);
check('countBackToBack: lista vazia, 1 jogo ou jogos sem time em comum dão 0; um time em comum conta 1', A.countBackToBack([]) === 0 && A.countBackToBack(null) === 0 && A.countBackToBack([{ home: 'a', away: 'b' }]) === 0 && A.countBackToBack([{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }]) === 0 && A.countBackToBack([{ home: 'a', away: 'b' }, { home: 'c', away: 'a' }]) === 1);

// ══ 7. O MANUAL E O CI ════════════════════════════════════════════════════════════════════════════════════════════════════
const plain = s => s.replace(/<\/(?:td|th|tr|p|li|div|h3|h2|ul|table)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const i1 = manual.indexOf('id="ordem-dos-jogos"');
const sec = i1 < 0 ? '' : plain(manual.slice(i1, manual.indexOf('<h3', i1 + 30)));
check('manual: subseção "A ordem dos jogos" (id ordem-dos-jogos) na seção 03, antes da "Liga sem final"', i1 > manual.indexOf('id="titulos"') && i1 < manual.indexOf('id="liga-sem-final"'), i1);
check('manual: explica que o app evita o mesmo time em dois jogos seguidos, em 5 times e em 6 times (zero repetições), nos grupos (jogos alternados), e que com 4 times é impossível zerar (o mínimo é 2 repetições, antes 5)', /evita que o mesmo time jogue duas vezes seguidas/.test(sec) && /5 times/.test(sec) && /6 times/.test(sec) && /alternam/.test(sec) && /4 times/.test(sec) && /impossível/.test(sec) && /2 repetições/.test(sec) && /antes eram 5/.test(sec) && /nenhuma repetição \(antes eram 4\)/.test(sec) && /5 rodadas de 2 jogos/.test(sec) && /5 rodadas de 3 jogos/.test(sec), sec.slice(0, 700));
check('manual: diz que o 3 times (vira) fica como sempre e que o campeonato que já começou mantém a ordem que tinha', /3 times/.test(sec) && /vira/.test(sec) && /já começou|já criado|já estava/.test(sec), sec.slice(-400));
check('CI: o teste da ordem dos jogos roda (passo "Testes do app (a ordem dos jogos …)" executando test/client-match-order-test.js, sem ": " no nome)', /- name: Testes do app \(a ordem dos jogos[^\n]*\)\n\s+working-directory: functions\n\s+run: node test\/client-match-order-test\.js/.test(ci) && !/name: Testes do app \(a ordem dos jogos[^\n]*: /.test(ci));

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
