// Testa o código do app (index.html) que tira da lista de despesas o COMPROVANTE VENCIDO (mais de 39 dias), isolado: extrai o trecho real do arquivo e o executa num
// ambiente simulado, sem navegador.
//  - o comprovante vencido some da lista para todo mundo, mas só o ADMIN apaga o dado no banco (as regras do Firestore só deixam o admin gravar em financeiro_despesas):
//    quem só lê (jogador) não pode tentar gravar, senão o banco responde "Missing or insufficient permissions" e o monitor recebe uma "Falha não tratada" (caso real de 26/10/2026);
//  - uma falha de rede ao apagar (admin) não pode virar erro solto (promessa rejeitada sem tratamento);
//  - a conta dos 39 dias, com a data guardada como texto AAAA-MM-DD (como o app grava), e os comprovantes sem data ou ainda dentro do prazo, que ficam como estão.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const block = slice('const expiredComp = d.comprovante', "if (d.comprovante) {"); // o trecho real: a conta do prazo e a limpeza do comprovante vencido

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// "agora" fixo: 26/10/2026, meio-dia (UTC)
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } }
const DEL = { __delete: true };
const runner = new Function('d', 'isAdmin', 'ldoc', 'firebase', 'Date', block + "\nreturn 'segue';");

// roda o trecho para uma despesa; devolve o que ele retornou, as chamadas ao banco e quantas promessas ficaram rejeitadas sem tratamento
async function run(d, { admin, updateFails = false } = {}) {
  const calls = [];
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  const ldoc = p => ({ update: arg => { calls.push({ path: p, arg }); return updateFails ? Promise.reject(Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' })) : Promise.resolve(); } });
  const firebase = { firestore: { FieldValue: { delete: () => DEL } } };
  const out = runner(d, () => admin, ldoc, firebase, FakeDate);
  await new Promise(r => setTimeout(r, 40)); // dá tempo de uma rejeição solta aparecer
  process.off('unhandledRejection', onUnhandled);
  return { out, calls, unhandled };
}

(async () => {
  // ── comprovante vencido (data de 12/09/2026: 44 dias antes de "agora") ──────────────────────────────────────────────────────────────────────────────
  const old = { id: 'd1', comprovante: 'https://res.cloudinary.com/x/y.jpg', comprovanteAt: '2026-09-12' };
  let r = await run(old, { admin: false });
  check('jogador (não admin) vê a despesa sem o comprovante vencido', r.out === '', r.out);
  check('jogador NÃO tenta apagar o comprovante no banco (só o admin pode gravar: era a "Falha não tratada" do monitor)', r.calls.length === 0, r.calls);
  check('jogador: nenhuma promessa rejeitada sem tratamento', r.unhandled === 0, r.unhandled);

  r = await run(old, { admin: true });
  check('admin vê a despesa sem o comprovante vencido', r.out === '', r.out);
  check('admin apaga o comprovante vencido no banco, uma vez, no documento certo', r.calls.length === 1 && r.calls[0].path === 'financeiro_despesas/d1', r.calls);
  check('admin apaga os DOIS campos (comprovante e comprovanteAt) e mais nada', r.calls[0] && JSON.stringify(Object.keys(r.calls[0].arg).sort()) === JSON.stringify(['comprovante', 'comprovanteAt']) && r.calls[0].arg.comprovante === DEL && r.calls[0].arg.comprovanteAt === DEL, r.calls[0]);
  check('admin: sem erro solto quando a gravação dá certo', r.unhandled === 0, r.unhandled);

  r = await run(old, { admin: true, updateFails: true });
  check('admin: a lista continua sem o comprovante mesmo quando a gravação falha (rede)', r.out === '', r.out);
  check('admin: falha de rede ao apagar NÃO vira erro solto (promessa rejeitada sem tratamento)', r.unhandled === 0, r.unhandled);
  check('admin: a gravação foi tentada mesmo assim', r.calls.length === 1, r.calls);

  // ── o prazo de 39 dias ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // 17/09/2026 00:00 UTC até "agora" = 39,5 dias (vencido); 18/09/2026 = 38,5 dias (ainda vale)
  r = await run({ id: 'd2', comprovante: 'https://x/y', comprovanteAt: '2026-09-17' }, { admin: true });
  check('com 39,5 dias o comprovante está vencido', r.out === '' && r.calls.length === 1, { out: r.out, calls: r.calls.length });
  r = await run({ id: 'd3', comprovante: 'https://x/y', comprovanteAt: '2026-09-18' }, { admin: true });
  check('com 38,5 dias o comprovante ainda vale: nada é apagado e a lista segue normal', r.out === 'segue' && r.calls.length === 0, { out: r.out, calls: r.calls.length });
  r = await run({ id: 'd4', comprovante: 'https://x/y', comprovanteAt: '2026-10-20' }, { admin: false });
  check('comprovante recente: o jogador também vê normalmente e nada é apagado', r.out === 'segue' && r.calls.length === 0, { out: r.out, calls: r.calls.length });

  // ── despesas sem comprovante ou sem data ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  r = await run({ id: 'd5', descricao: 'Bola' }, { admin: true });
  check('despesa sem comprovante: nada a apagar', r.out === 'segue' && r.calls.length === 0, { out: r.out, calls: r.calls.length });
  r = await run({ id: 'd6', comprovante: 'https://x/y' }, { admin: true });
  check('comprovante sem data (cadastro antigo) nunca vence sozinho', r.out === 'segue' && r.calls.length === 0, { out: r.out, calls: r.calls.length });
  r = await run({ id: 'd7', comprovanteAt: '2026-09-12' }, { admin: true });
  check('data de comprovante sem o comprovante (sobra de um cadastro): nada a apagar e a lista segue normal', r.out === 'segue' && r.calls.length === 0, { out: r.out, calls: r.calls.length });

  // ── ligação com as regras e com o app ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const despRule = rules.slice(rules.indexOf('match /leagues/{leagueId}/financeiro_despesas/{docId}'));
  const despBlock = despRule.slice(0, despRule.indexOf('\n    }') + 6); // até o fecha-chaves do match (recuo de 4 espaços)
  check('as regras só deixam o ADMIN gravar em financeiro_despesas (é por isso que o jogador não pode apagar o comprovante)', /allow write: if isLeagueAdmin\(leagueId\);/.test(despBlock), despBlock);
  check('o trecho do app guarda a gravação atrás de isAdmin() e trata a falha com .catch', /if \(isAdmin\(\)\) ldoc\(`financeiro_despesas\/\$\{d\.id\}`\)\.update\(\{[\s\S]*?\}\)\.catch\(/.test(block), block);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
