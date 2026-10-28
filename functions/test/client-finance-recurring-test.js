// Testa o código do app (index.html) das DESPESAS RECORRENTES (fixa mensal e semanal) do Financeiro, isolado: extrai os trechos reais do arquivo e os
// executa num ambiente simulado, sem navegador.
//  - o caso real de 28/10/2026: o admin apagou as despesas recorrentes "de outubro" e as pagas de setembro sumiram junto, porque a despesa recorrente é UM
//    registro só para todos os meses (cada mês é calculado a partir dele) e o 🗑 apagava o registro inteiro (e o saldo em caixa mudava);
//  - agora o 🗑 de uma despesa recorrente pergunta o que apagar: só esta data, esta e as próximas (grava `fim`: o passado continua como está) ou tudo
//    (avisa quantas datas já pagas se perdem e pede confirmação); a despesa única segue com a pergunta simples;
//  - a lista do mês, os totais pagos e pendentes e os meses da evolução ficam iguais aos de antes quando não há `fim` nem `ignoradas` (conferido
//    contra uma cópia do código antigo), e respeitam `fim` (exclusivo) e `ignoradas` quando existem;
//  - ajuste de 28/10/2026: a despesa fixa só aparece a partir do MÊS do "A partir de" (antes a lista a mostrava também nos meses anteriores, como
//    "em aberto", enquanto os totais já começavam no mês de início); no mês de início continuam aparecendo todas as datas do mês.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8').replace(/\r\n/g, '\n');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const escCode = slice('const esc = s =>', 'function toast(');
const helpersCode = slice('function daysInMonth(y, m) {', 'function vFinanceiro() {'); // daysInMonth, getWeekdayOccurrences, despRecOcorrencias, despRecTodas, getDespMes
const totalsBlock = slice('let despRecPagas = 0, despRecPend = 0;', 'const despPagas    = despOneTimePagas + despRecPagas;'); // totais de despesa recorrente paga e pendente
const monsBlock = slice('const _recMons = [];', 'const allMonths = ['); // meses de despesa recorrente que entram na evolução mensal
const flowCode = slice('async function deleteDespesa(', 'async function deleteComprovante('); // deleteDespesa, despRecPagasResumo, excluirDespesaRec
const modalCode = slice('function mFinDespesaExcluir() {', 'function mFinConfig() {');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const clone = o => JSON.parse(JSON.stringify(o));

// "agora" fixo: 28/10/2026
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } }

function makeEnv({ finDesp = [], modal = null, confirmAnswer = true, failWrites = false } = {}) {
  const calls = { updates: [], deletes: [], toasts: [], renders: 0, confirms: [] };
  const st = { finDesp, modal };
  const ldoc = p => ({
    update: async arg => { if (failWrites) throw new Error('sem rede'); calls.updates.push({ path: p, arg }); },
    delete: async () => { if (failWrites) throw new Error('sem rede'); calls.deletes.push(p); },
  });
  const confirm = msg => { calls.confirms.push(msg); return confirmAnswer; };
  const toast = (msg, kind) => calls.toasts.push([msg, kind || '']);
  const render = () => { calls.renders++; };
  const closeModal = () => { st.modal = null; render(); };
  const factory = new Function('st', 'ldoc', 'confirm', 'toast', 'render', 'closeModal', 'DB', 'Date',
    escCode + '\n' + helpersCode + '\n' + flowCode + '\n' + modalCode +
    '\nreturn { getDespMes, despRecOcorrencias, despRecTodas, despRecPagasResumo, deleteDespesa, excluirDespesaRec, mFinDespesaExcluir, daysInMonth, getWeekdayOccurrences };');
  const api = factory(st, ldoc, confirm, toast, render, closeModal, true, FakeDate);
  return { st, calls, ...api };
}

// o Firestore aplica `update({ 'ignoradas.2026-10-13': true })` criando o mapa: o teste imita o que o banco devolveria depois
function applyUpdate(doc, arg) {
  for (const [k, v] of Object.entries(arg)) {
    const parts = k.split('.');
    let o = doc;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = v;
  }
}

const totaisDe = (env, curMon = '2026-10') =>
  new Function('st', 'despRecTodas', 'curMon', totalsBlock + '\nreturn { despRecPagas, despRecPend };')(env.st, env.despRecTodas, curMon);
const mesesDe = env =>
  [...new Set(new Function('st', 'despRecTodas', 'Date', monsBlock + '\nreturn _recMons;')(env.st, env.despRecTodas, FakeDate))].sort();

// cópia do código ANTIGO (antes de 28/10/2026), para provar que nada muda quando não há `fim` nem `ignoradas`
function legacyGetDespMes(env, month) {
  const { st, daysInMonth, getWeekdayOccurrences } = env;
  const [y, mon] = month.split('-').map(Number);
  const entries = [];
  for (const d of (st.finDesp || [])) {
    if (!d.recorrencia) {
      if ((d.data || '').startsWith(month)) entries.push({ ...d, occKey: null });
    } else if (d.recorrencia === 'mensal') {
      const day = Math.min(d.diaDoMes || 1, daysInMonth(y, mon));
      const data = `${month}-${String(day).padStart(2, '0')}`;
      const paga = (d.pagamentos || {})[month] === true;
      entries.push({ ...d, data, paga, occKey: month });
    } else if (d.recorrencia === 'semanal') {
      for (const date of getWeekdayOccurrences(y, mon, d.diaSemana || 0)) {
        const paga = (d.pagamentos || {})[date] === true;
        entries.push({ ...d, data: date, paga, occKey: date });
      }
    }
  }
  return entries.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}
function legacyTotals(env, curMon) {
  const { st, getWeekdayOccurrences } = env;
  let despRecPagas = 0, despRecPend = 0;
  const recMons = [];
  for (const _d of (st.finDesp || [])) {
    if (!_d.recorrencia) continue;
    let [sy, sm] = ((_d.data || curMon).slice(0, 7)).split('-').map(Number);
    const [ey, em] = curMon.split('-').map(Number);
    while (sy < ey || (sy === ey && sm <= em)) {
      const mon2 = `${sy}-${String(sm).padStart(2, '0')}`;
      recMons.push(mon2);
      if (_d.recorrencia === 'mensal') {
        const paid = (_d.pagamentos || {})[mon2] === true;
        if (paid) despRecPagas += _d.valor || 0; else despRecPend += _d.valor || 0;
      } else if (_d.recorrencia === 'semanal') {
        for (const dt of getWeekdayOccurrences(sy, sm, _d.diaSemana || 0)) {
          const paid = (_d.pagamentos || {})[dt] === true;
          if (paid) despRecPagas += _d.valor || 0; else despRecPend += _d.valor || 0;
        }
      }
      sm++; if (sm > 12) { sm = 1; sy++; }
    }
  }
  return { despRecPagas, despRecPend, recMons: [...new Set(recMons)].sort() };
}

(async () => {
  // ── 1. nada muda para quem não usa o novo recurso ─────────────────────────────────────────────────────────────────────────────────────────────────
  const SERIES = [
    { id: 'm5', descricao: 'Taxa do campo', recorrencia: 'mensal', diaDoMes: 5, data: '2026-09-01', valor: 300, categoria: 'Campo/Aluguel', pagamentos: { '2026-09': true } },
    { id: 'm31', descricao: 'Dia 31', recorrencia: 'mensal', diaDoMes: 31, data: '2026-01-15', valor: 10, pagamentos: { '2026-01': true, '2026-02': true } },
    { id: 'm1', descricao: 'Sem dia', recorrencia: 'mensal', data: '2026-07-20', valor: 20 },
    ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ id: 's' + i, descricao: 'Semanal ' + i, recorrencia: 'semanal', diaSemana: i, data: '2026-08-10', valor: 15 + i, pagamentos: { ['2026-09-0' + (i + 1)]: true, ['2026-10-1' + i]: true } })),
    { id: 'sd', descricao: 'Sem data', recorrencia: 'semanal', diaSemana: 2, valor: 5 },
    { id: 'u1', descricao: 'Bola nova', data: '2026-09-10', valor: 50, paga: true },
    { id: 'u2', descricao: 'Colete', data: '2026-10-03', valor: 80, paga: false },
  ];
  const env0 = makeEnv({ finDesp: clone(SERIES) });
  const meses = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  // a única diferença para o código antigo: a despesa fixa não aparece nos meses ANTERIORES ao mês do "A partir de"
  const inicioDe = (e, id) => (e.st.finDesp.find(x => x.id === id) || {}).data;
  const aindaNaoComecou = (e, x, m) => !!x.recorrencia && typeof inicioDe(e, x.id) === 'string' && m < inicioDe(e, x.id).slice(0, 7);
  const antigoDesdeOInicio = (e, m) => legacyGetDespMes(e, m).filter(x => !aindaNaoComecou(e, x, m));
  const difMes = meses.filter(m => JSON.stringify(env0.getDespMes(m)) !== JSON.stringify(antigoDesdeOInicio(env0, m)));
  check('sem "fim" nem "ignoradas", a lista de cada mês é igual à do código antigo, menos as despesas fixas dos meses anteriores ao "A partir de" (10 meses, 12 despesas de todos os tipos)', difMes.length === 0, difMes);
  const sumiram = meses.flatMap(m => legacyGetDespMes(env0, m).filter(x => aindaNaoComecou(env0, x, m)).map(x => x.id + '@' + m));
  check('... e essa diferença existe de verdade na série de teste (o código antigo listava as despesas fixas antes de elas começarem)', sumiram.length > 40, sumiram.length);
  check('a lista do mês não ficou vazia por engano (setembro tem despesas recorrentes e a única)', env0.getDespMes('2026-09').length > 20, env0.getDespMes('2026-09').length);
  for (const cur of ['2026-10', '2026-12', '2027-02']) {
    const novo = totaisDe(env0, cur), velho = legacyTotals(env0, cur);
    check(`sem "fim" nem "ignoradas", os totais pagos e pendentes até ${cur} são iguais aos do código antigo`, novo.despRecPagas === velho.despRecPagas && novo.despRecPend === velho.despRecPend && novo.despRecPagas + novo.despRecPend > 0, { novo, velho: { p: velho.despRecPagas, d: velho.despRecPend } });
  }
  const mesesNovo = mesesDe(env0), mesesVelho = legacyTotals(env0, '2026-10').recMons;
  check('sem "fim" nem "ignoradas", os meses da evolução mensal são os mesmos do código antigo', JSON.stringify(mesesNovo) === JSON.stringify(mesesVelho), { mesesNovo, mesesVelho });

  // ── 1b. a despesa só aparece a partir do MÊS do "A partir de" ─────────────────────────────────────────────────────────────────────────────────────
  // Antes a lista mostrava a despesa fixa também nos meses anteriores ao início (como "em aberto"), mas os totais já começavam no mês de início.
  const listadaEm = (e, id, mes) => e.getDespMes(mes).filter(x => x.id === id).map(x => x.data);
  const mesesListada = (e, id, de, ate) => {
    const out = [];
    let [y, m] = de.split('-').map(Number);
    const [ey, em] = ate.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const mes = `${y}-${String(m).padStart(2, '0')}`;
      if (e.getDespMes(mes).some(x => x.id === id)) out.push(mes);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  };
  const MENS = { id: 'M', descricao: 'Taxa do campo', recorrencia: 'mensal', diaDoMes: 5, data: '2026-10-15', valor: 100 }; // começa em outubro, dia 15 (o dia 05 já passou)
  const SEMA = { id: 'S', descricao: 'Água', recorrencia: 'semanal', diaSemana: 4, data: '2026-10-15', valor: 10 };    // quintas; 15/10/2026 é quinta
  const eB = makeEnv({ finDesp: clone([MENS, SEMA]) });
  check('a mensal que começa em outubro não aparece em setembro nem em agosto', listadaEm(eB, 'M', '2026-09').length === 0 && listadaEm(eB, 'M', '2026-08').length === 0, listadaEm(eB, 'M', '2026-09'));
  check('... e a semanal também não (nem em setembro nem no começo do ano)', listadaEm(eB, 'S', '2026-09').length === 0 && listadaEm(eB, 'S', '2026-01').length === 0, listadaEm(eB, 'S', '2026-09'));
  check('no MÊS de início aparecem todas as datas do mês, mesmo as anteriores ao dia escolhido (mensal dia 05 com início em 15/10; quintas 1, 8, 15, 22 e 29)',
    JSON.stringify(listadaEm(eB, 'M', '2026-10')) === '["2026-10-05"]' && JSON.stringify(listadaEm(eB, 'S', '2026-10')) === '["2026-10-01","2026-10-08","2026-10-15","2026-10-22","2026-10-29"]', { m: listadaEm(eB, 'M', '2026-10'), s: listadaEm(eB, 'S', '2026-10') });
  check('depois do mês de início a despesa continua aparecendo (novembro e março do ano seguinte)', listadaEm(eB, 'M', '2026-11').length === 1 && listadaEm(eB, 'S', '2026-11').length === 4 && listadaEm(eB, 'M', '2027-03').length === 1, [listadaEm(eB, 'M', '2026-11'), listadaEm(eB, 'S', '2026-11'), listadaEm(eB, 'M', '2027-03')]);
  const tB = totaisDe(eB);
  check('os totais não mudaram: contam outubro inteiro (a mensal R$ 100 e as 5 quintas R$ 50) e nada dos meses anteriores', tB.despRecPagas === 0 && tB.despRecPend === 150, tB);

  // limites: primeiro e último dia do mês, virada de ano e o mesmo mês de outro ano
  const inicio = data => makeEnv({ finDesp: [{ id: 'X', descricao: 'X', recorrencia: 'mensal', diaDoMes: 5, data, valor: 1 }] });
  check('início no dia 1 ou no dia 31 de outubro: outubro já mostra e setembro não', inicio('2026-10-01').getDespMes('2026-10').length === 1 && inicio('2026-10-01').getDespMes('2026-09').length === 0 && inicio('2026-10-31').getDespMes('2026-10').length === 1 && inicio('2026-10-31').getDespMes('2026-09').length === 0);
  check('virada de ano: início em 10/01/2027 mostra janeiro de 2027 e não mostra dezembro nem outubro de 2026', inicio('2027-01-10').getDespMes('2027-01').length === 1 && inicio('2027-01-10').getDespMes('2026-12').length === 0 && inicio('2027-01-10').getDespMes('2026-10').length === 0);
  check('o mesmo mês de um ano antes também não mostra (outubro e dezembro de 2025), e outubro de 2027 mostra', inicio('2026-10-05').getDespMes('2025-10').length === 0 && inicio('2026-10-05').getDespMes('2025-12').length === 0 && inicio('2026-10-05').getDespMes('2027-10').length === 1);

  // a lista e os totais passam a concordar: cada despesa fixa é listada exatamente nos meses que os totais contam
  const envS = makeEnv({ finDesp: clone(SERIES) });
  const comInicio = SERIES.filter(x => x.recorrencia && x.data);
  const desencontros = comInicio.filter(x => JSON.stringify(mesesListada(envS, x.id, '2025-06', '2027-03')) !== JSON.stringify([...new Set(envS.despRecTodas(x, '2027-03').map(o => o.data.slice(0, 7)))]));
  check('a lista e os totais concordam: cada despesa fixa é listada exatamente nos meses que os totais contam (10 despesas, de 06/2025 a 03/2027)', desencontros.length === 0 && comInicio.length === 10, desencontros.map(x => x.id));

  // pagamentos marcados em meses anteriores ao início (não existem nos dados reais): a lista e os totais os ignoram, e nada é apagado do banco
  const eP = makeEnv({ finDesp: clone([{ ...MENS, pagamentos: { '2026-08': true, '2026-09': true } }]) });
  const tP = totaisDe(eP);
  check('pagamentos marcados antes do início ficam fora da lista e dos totais (só outubro conta: R$ 100 em aberto)', listadaEm(eP, 'M', '2026-09').length === 0 && tP.despRecPagas === 0 && tP.despRecPend === 100 && eP.st.finDesp[0].pagamentos['2026-09'] === true, tP);
  const eF = makeEnv({ finDesp: clone([{ ...MENS, fim: '2026-09-01' }]) });
  check('`fim` antes do início: a despesa não aparece em mês nenhum e os totais ficam zerados', mesesListada(eF, 'M', '2025-01', '2027-12').length === 0 && totaisDe(eF).despRecPend === 0 && totaisDe(eF).despRecPagas === 0);
  const eD = makeEnv({ finDesp: clone([{ id: 'SD', descricao: 'Sem data', recorrencia: 'mensal', diaDoMes: 3, valor: 5 }, { id: 'ND', descricao: 'Data estranha', recorrencia: 'mensal', diaDoMes: 3, data: 20261005, valor: 5 }, { id: 'LX', descricao: 'Lixo', recorrencia: 'mensal', diaDoMes: 3, data: 'abc', valor: 5 }]) });
  check('sem `data` (ou com `data` que não é uma data) nada é escondido: a despesa aparece em qualquer mês, como antes, e nada quebra', ['SD', 'ND', 'LX'].every(id => listadaEm(eD, id, '2020-01').length === 1 && listadaEm(eD, id, '2026-10').length === 1), ['SD', 'ND', 'LX'].map(id => listadaEm(eD, id, '2020-01')));

  // ── 2. o caso real: apagar de outubro sem perder setembro ─────────────────────────────────────────────────────────────────────────────────────────
  // Terças de 2026: setembro 1, 8, 15, 22, 29; outubro 6, 13, 20, 27.
  const A = { id: 'A', descricao: 'Aluguel da quadra', recorrencia: 'semanal', diaSemana: 2, data: '2026-09-01', valor: 100, categoria: 'Campo/Aluguel',
    pagamentos: { '2026-09-01': true, '2026-09-08': true, '2026-09-15': true, '2026-09-22': true, '2026-09-29': true } };
  const B = { id: 'B', descricao: 'Taxa do campo', recorrencia: 'mensal', diaDoMes: 5, data: '2026-09-01', valor: 300, categoria: 'Campo/Aluguel', pagamentos: { '2026-09': true } };
  const C = { id: 'C', descricao: 'Bola nova', data: '2026-09-10', valor: 50, paga: true, categoria: 'Bola' };
  const doDe = (env, id, mes) => env.getDespMes(mes).filter(e => e.id === id);

  let env = makeEnv({ finDesp: clone([A, B, C]) });
  check('antes: setembro tem as 5 terças da despesa semanal, todas pagas', doDe(env, 'A', '2026-09').length === 5 && doDe(env, 'A', '2026-09').every(e => e.paga === true), doDe(env, 'A', '2026-09').map(e => [e.data, e.paga]));
  check('antes: setembro tem a taxa mensal paga e outubro as 4 terças e a taxa, ainda em aberto', doDe(env, 'B', '2026-09')[0]?.paga === true && doDe(env, 'A', '2026-10').length === 4 && doDe(env, 'A', '2026-10').every(e => e.paga === false) && doDe(env, 'B', '2026-10')[0]?.paga === false);
  let t = totaisDe(env);
  check('antes: despesas recorrentes pagas R$ 800 (5 terças de R$ 100 + a taxa de R$ 300) e pendentes R$ 700 (4 terças + a taxa de outubro)', t.despRecPagas === 800 && t.despRecPend === 700, t);

  // 🗑 numa linha de outubro da despesa semanal
  await env.deleteDespesa('A', '2026-10-06', '2026-10-06');
  check('🗑 numa despesa recorrente NÃO apaga nada de cara e não faz a pergunta simples: abre a janela "o que apagar"', env.calls.deletes.length === 0 && env.calls.updates.length === 0 && env.calls.confirms.length === 0 && env.st.modal?.type === 'finDespesaExcluir' && env.st.modal.id === 'A' && env.st.modal.occKey === '2026-10-06' && env.st.modal.data === '2026-10-06' && env.calls.renders === 1, { modal: env.st.modal, calls: env.calls });
  const janela = env.mFinDespesaExcluir();
  check('a janela oferece as três opções e o Cancelar', /excluirDespesaRec\('uma'\)/.test(janela) && /excluirDespesaRec\('daqui'\)/.test(janela) && /excluirDespesaRec\('tudo'\)/.test(janela) && /closeModal\(\)/.test(janela), janela.slice(0, 200));

  // "Esta e as próximas" a partir de outubro: setembro continua inteiro
  await env.excluirDespesaRec('daqui');
  check('"Esta e as próximas" grava só `fim` (a data da linha) e NÃO apaga o registro', env.calls.updates.length === 1 && env.calls.updates[0].path === 'financeiro_despesas/A' && JSON.stringify(env.calls.updates[0].arg) === '{"fim":"2026-10-06"}' && env.calls.deletes.length === 0, env.calls);
  check('depois da gravação a janela fecha e avisa', env.st.modal === null && env.calls.toasts.some(([m]) => /para de valer/.test(m)), { modal: env.st.modal, toasts: env.calls.toasts });
  applyUpdate(env.st.finDesp[0], env.calls.updates[0].arg);
  check('depois de parar em outubro, SETEMBRO continua inteiro: as 5 terças, todas pagas', doDe(env, 'A', '2026-09').length === 5 && doDe(env, 'A', '2026-09').every(e => e.paga === true), doDe(env, 'A', '2026-09').map(e => [e.data, e.paga]));
  check('... e outubro não tem mais a despesa semanal; a taxa mensal e a despesa única não foram tocadas', doDe(env, 'A', '2026-10').length === 0 && doDe(env, 'B', '2026-10').length === 1 && doDe(env, 'B', '2026-09').length === 1 && env.getDespMes('2026-09').some(e => e.id === 'C'));
  t = totaisDe(env);
  check('... o que foi PAGO continua somando R$ 800 (o caixa não muda) e só o pendente de outubro da semanal sai (sobram R$ 300 da taxa)', t.despRecPagas === 800 && t.despRecPend === 300, t);

  // a mesma coisa na despesa mensal
  env = makeEnv({ finDesp: clone([A, B, C]) });
  await env.deleteDespesa('B', '2026-10', '2026-10-05');
  check('na despesa mensal a janela guarda o mês e a data da linha', env.st.modal?.occKey === '2026-10' && env.st.modal.data === '2026-10-05', env.st.modal);
  await env.excluirDespesaRec('daqui');
  check('parar a mensal a partir de outubro grava `fim` com a data do mês (05/10)', JSON.stringify(env.calls.updates[0]?.arg) === '{"fim":"2026-10-05"}', env.calls.updates);
  applyUpdate(env.st.finDesp[1], env.calls.updates[0].arg);
  t = totaisDe(env);
  check('... setembro da mensal continua paga, outubro some, e o total pago continua R$ 800', doDe(env, 'B', '2026-09')[0]?.paga === true && doDe(env, 'B', '2026-10').length === 0 && t.despRecPagas === 800 && t.despRecPend === 400, { t });

  // "Só esta data" (semanal) e "Só este mês" (mensal)
  env = makeEnv({ finDesp: clone([A, B, C]) });
  await env.deleteDespesa('A', '2026-10-13', '2026-10-13');
  await env.excluirDespesaRec('uma');
  check('"Só esta data" grava `ignoradas.<data>` e nada mais', env.calls.updates.length === 1 && env.calls.updates[0].path === 'financeiro_despesas/A' && JSON.stringify(env.calls.updates[0].arg) === '{"ignoradas.2026-10-13":true}' && env.calls.deletes.length === 0, env.calls.updates);
  applyUpdate(env.st.finDesp[0], env.calls.updates[0].arg);
  check('... só 13/10 some: outubro fica com 6, 20 e 27 e setembro continua inteiro e pago', JSON.stringify(doDe(env, 'A', '2026-10').map(e => e.data)) === '["2026-10-06","2026-10-20","2026-10-27"]' && doDe(env, 'A', '2026-09').length === 5 && doDe(env, 'A', '2026-09').every(e => e.paga));
  t = totaisDe(env);
  check('... os totais acompanham (pendente: 3 terças + a taxa = R$ 600; pago continua R$ 800)', t.despRecPagas === 800 && t.despRecPend === 600, t);
  env = makeEnv({ finDesp: clone([A, B, C]) });
  await env.deleteDespesa('B', '2026-10', '2026-10-05');
  await env.excluirDespesaRec('uma');
  check('"Só este mês" grava `ignoradas.<mês>`', JSON.stringify(env.calls.updates[0]?.arg) === '{"ignoradas.2026-10":true}', env.calls.updates);
  applyUpdate(env.st.finDesp[1], env.calls.updates[0].arg);
  check('... outubro da mensal some e setembro continua pago', doDe(env, 'B', '2026-10').length === 0 && doDe(env, 'B', '2026-09')[0]?.paga === true);

  // "Tudo": pede confirmação e avisa o que já foi pago
  env = makeEnv({ finDesp: clone([A, B, C]), confirmAnswer: false });
  await env.deleteDespesa('A', '2026-10-06', '2026-10-06');
  await env.excluirDespesaRec('tudo');
  check('"Tudo" pede confirmação e, se o admin recusa, não apaga nada e a janela continua aberta', env.calls.confirms.length === 1 && env.calls.deletes.length === 0 && env.calls.updates.length === 0 && env.st.modal?.type === 'finDespesaExcluir', env.calls);
  check('a confirmação diz quanto já foi pago e se perde (5 datas, R$ 500,00), que o caixa muda e que não dá para desfazer', /inclusive 5 já pagas \(R\$ 500,00\)/.test(env.calls.confirms[0]) && /saldo em caixa muda/.test(env.calls.confirms[0]) && /não dá para desfazer/.test(env.calls.confirms[0]) && /Aluguel da quadra/.test(env.calls.confirms[0]), env.calls.confirms[0]);
  env = makeEnv({ finDesp: clone([A, B, C]), confirmAnswer: true });
  await env.deleteDespesa('B', '2026-10', '2026-10-05');
  await env.excluirDespesaRec('tudo');
  check('"Tudo" confirmado apaga o registro inteiro, uma vez, e fecha a janela', env.calls.deletes.length === 1 && env.calls.deletes[0] === 'financeiro_despesas/B' && env.calls.updates.length === 0 && env.st.modal === null && env.calls.toasts.some(([m]) => /removida/.test(m)), env.calls);
  check('a confirmação no singular (1 data paga, R$ 300,00)', /inclusive 1 já paga \(R\$ 300,00\)/.test(env.calls.confirms[0]), env.calls.confirms[0]);
  env = makeEnv({ finDesp: clone([{ ...B, id: 'B2', pagamentos: {} }]), confirmAnswer: true });
  await env.deleteDespesa('B2', '2026-10', '2026-10-05');
  await env.excluirDespesaRec('tudo');
  check('sem nada pago a confirmação não fala em "inclusive"', env.calls.confirms.length === 1 && !/inclusive/.test(env.calls.confirms[0]), env.calls.confirms[0]);

  // despesa única: a pergunta simples de sempre
  env = makeEnv({ finDesp: clone([A, B, C]) });
  await env.deleteDespesa('C', null, null);
  check('despesa única: continua com a pergunta simples e apaga o registro (sem janela)', env.calls.confirms.length === 1 && /Excluir esta despesa\?/.test(env.calls.confirms[0]) && env.calls.deletes.length === 1 && env.calls.deletes[0] === 'financeiro_despesas/C' && env.st.modal === null, env.calls);
  env = makeEnv({ finDesp: clone([A, B, C]), confirmAnswer: false });
  await env.deleteDespesa('C', null, null);
  check('despesa única: se o admin recusa, nada é apagado', env.calls.deletes.length === 0 && env.calls.updates.length === 0);

  // limites do `fim` e combinação com `ignoradas`
  env = makeEnv({ finDesp: clone([{ ...A, fim: '2026-10-13' }]) });
  check('`fim` é exclusivo: com fim em 13/10 a terça de 06/10 continua e a de 13/10 já não existe', JSON.stringify(doDe(env, 'A', '2026-10').map(e => e.data)) === '["2026-10-06"]', doDe(env, 'A', '2026-10').map(e => e.data));
  env = makeEnv({ finDesp: clone([{ ...B, fim: '2026-10-05' }]) });
  check('`fim` no mesmo dia da mensal tira o mês; um dia depois (06/10) mantém', doDe(env, 'B', '2026-10').length === 0 && makeEnv({ finDesp: clone([{ ...B, fim: '2026-10-06' }]) }).getDespMes('2026-10').filter(e => e.id === 'B').length === 1 && doDe(env, 'B', '2026-09').length === 1);
  env = makeEnv({ finDesp: clone([{ ...A, fim: '2026-10-20', ignoradas: { '2026-10-06': true } }]) });
  check('`fim` e `ignoradas` juntos: outubro fica só com 13/10', JSON.stringify(doDe(env, 'A', '2026-10').map(e => e.data)) === '["2026-10-13"]', doDe(env, 'A', '2026-10').map(e => e.data));
  env = makeEnv({ finDesp: clone([{ ...B, diaDoMes: 31, fim: '2027-03-01' }]) });
  check('mensal no dia 31 cai no último dia de fevereiro e `fim` em 01/03 mantém fevereiro', env.getDespMes('2027-02')[0]?.data === '2027-02-28' && env.getDespMes('2027-03').length === 0, env.getDespMes('2027-02').map(e => e.data));
  env = makeEnv({ finDesp: clone([{ ...A, fim: '2026-10-01' }, { ...B, fim: '2026-10-01' }]) });
  check('os meses da evolução mensal não ganham outubro quando tudo parou em outubro (e setembro continua)', JSON.stringify(mesesDe(env)) === '["2026-09"]', mesesDe(env));
  env = makeEnv({ finDesp: clone([{ ...A, ignoradas: Object.fromEntries(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'].map(d => [d, true])) }]) });
  check('um mês em que todas as datas foram tiradas também não entra na evolução', JSON.stringify(mesesDe(env)) === '["2026-09"]', mesesDe(env));
  t = totaisDe(makeEnv({ finDesp: clone([{ ...A, fim: '2026-10-01' }, { ...B, fim: '2026-10-01' }]) }));
  check('com tudo parado em outubro: pago R$ 800 e pendente zero', t.despRecPagas === 800 && t.despRecPend === 0, t);

  // erros e proteções
  env = makeEnv({ finDesp: clone([A, B, C]), failWrites: true });
  await env.deleteDespesa('A', '2026-10-06', '2026-10-06');
  await env.excluirDespesaRec('daqui');
  check('se a gravação falha (rede), avisa o erro e a janela continua aberta para tentar de novo', env.calls.toasts.some(([m]) => /Erro: sem rede/.test(m)) && env.st.modal?.type === 'finDespesaExcluir', { toasts: env.calls.toasts, modal: env.st.modal });
  env = makeEnv({ finDesp: clone([A, B, C]), modal: { type: 'finDespesaExcluir', id: 'A', occKey: null, data: null } });
  await env.excluirDespesaRec('uma');
  await env.excluirDespesaRec('daqui');
  await env.excluirDespesaRec('qualquer');
  check('sem a data ou o mês da linha, "só esta" e "daqui" não gravam nada; modo desconhecido também não', env.calls.updates.length === 0 && env.calls.deletes.length === 0 && env.st.modal?.type === 'finDespesaExcluir', env.calls);
  env = makeEnv({ finDesp: clone([A]), modal: { type: 'finDespesaExcluir', id: 'ZZ', occKey: '2026-10-06', data: '2026-10-06' } });
  await env.excluirDespesaRec('tudo');
  check('se a despesa já não existe (apagada por outro admin), a janela só fecha e nada é gravado', env.st.modal === null && env.calls.updates.length === 0 && env.calls.deletes.length === 0 && env.mFinDespesaExcluir() === '', env.calls);
  env = makeEnv({ finDesp: clone([A, B, C]) });
  check('a janela não aparece para outro tipo de janela', env.mFinDespesaExcluir() === '' && (env.st.modal = { type: 'finDespesa' }, env.mFinDespesaExcluir() === ''));

  // ── 3. o texto da janela ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  env = makeEnv({ finDesp: clone([A, B, C]), modal: { type: 'finDespesaExcluir', id: 'A', occKey: '2026-10-06', data: '2026-10-06' } });
  let j = env.mFinDespesaExcluir();
  check('semanal: diz que repete "toda terça", mostra "Só esta data (06/10)" e "Para de valer a partir de 06/10"', /Aluguel da quadra<\/strong> se repete toda terça/.test(j) && /Só esta data \(06\/10\)/.test(j) && /Para de valer a partir de 06\/10/.test(j), j.slice(0, 900));
  check('mostra "Esta e as próximas", "Tudo: apagar a despesa inteira" e o que se perde (5 datas pagas, R$ 500,00)', /Esta e as próximas/.test(j) && /Tudo: apagar a despesa inteira/.test(j) && /inclusive 5 já pagas \(R\$ 500,00\)\. O saldo em caixa muda\./.test(j), j.slice(0, 1800));
  const botoes = j.split("<button onclick=\"excluirDespesaRec(").slice(1);
  const bUma = botoes.find(b => b.startsWith("'uma'")), bDaqui = botoes.find(b => b.startsWith("'daqui'")), bTudo = botoes.find(b => b.startsWith("'tudo'"));
  check('"Esta e as próximas" é a opção em destaque (verde) e "Tudo" é a de perigo (vermelha); "Só esta" é neutra', botoes.length === 3 && /var\(--accent\)/.test(bDaqui) && !/var\(--danger\)/.test(bDaqui) && /var\(--danger\)/.test(bTudo) && !/var\(--accent\)/.test(bUma) && !/var\(--danger\)/.test(bUma), botoes.map(b => b.slice(0, 160)));
  check('a data da linha ainda não paga não leva o aviso de "já estava paga"', !/Esta já estava paga/.test(j));
  check('semanal: "Só esta data" diz que as outras datas continuam', /Só esta data \(06\/10\)<\/div>\s*<div[^>]*>As outras datas continuam\./.test(j), j.slice(500, 900));
  env.st.modal = { type: 'finDespesaExcluir', id: 'A', occKey: '2026-09-08', data: '2026-09-08' };
  check('numa data já paga, avisa que o valor deixa de contar no caixa', /Esta já estava paga: o valor deixa de contar no caixa\./.test(env.mFinDespesaExcluir()));
  env.st.modal = { type: 'finDespesaExcluir', id: 'B', occKey: '2026-10', data: '2026-10-05' };
  j = env.mFinDespesaExcluir();
  check('mensal: "Só este mês" diz que os outros meses continuam (e não "as outras datas")', /Só este mês \(out\/26\)<\/div>\s*<div[^>]*>Os outros meses continuam\./.test(j) && !/As outras datas continuam/.test(j), j.slice(500, 900));
  check('mensal: diz "todo mês", "Só este mês (out/26)" e "Para de valer a partir de out/26"; 1 data paga (R$ 300,00)',/Taxa do campo<\/strong> se repete todo mês/.test(j) && /Só este mês \(out\/26\)/.test(j) && /Para de valer a partir de out\/26/.test(j) && /inclusive 1 já paga \(R\$ 300,00\)/.test(j), j.slice(0, 1800));
  const dia = n => makeEnv({ finDesp: [{ id: 'X', descricao: 'Y', recorrencia: 'semanal', diaSemana: n, data: '2026-10-01', valor: 1 }], modal: { type: 'finDespesaExcluir', id: 'X', occKey: '2026-10-04', data: '2026-10-04' } }).mFinDespesaExcluir();
  check('o dia da semana sai no gênero certo: todo domingo, toda segunda … toda sexta, todo sábado', /se repete todo domingo/.test(dia(0)) && /se repete toda segunda/.test(dia(1)) && /se repete toda sexta/.test(dia(5)) && /se repete todo sábado/.test(dia(6)));
  const comHtml = makeEnv({ finDesp: [{ id: 'X', descricao: '<b>x</b>', recorrencia: 'mensal', diaDoMes: 1, data: '2026-10-01', valor: 1 }], modal: { type: 'finDespesaExcluir', id: 'X', occKey: '2026-10', data: '2026-10-01' } }).mFinDespesaExcluir();
  check('o nome da despesa passa pelo escape do app (nenhuma etiqueta HTML solta vinda do nome)', /&lt;b>x&lt;\/b>/.test(comHtml) && !/<b>x<\/b>/.test(comHtml), comHtml.slice(0, 400));

  // ── 4. ligações com o app, as regras e o manual ───────────────────────────────────────────────────────────────────────────────────────────────────
  check('o 🗑 da lista passa o mês ou a data e a data da linha para deleteDespesa', html.includes('data-occ="${d.occKey||\'\'}" data-data="${d.recorrencia?d.data:\'\'}" onclick="deleteDespesa(this.dataset.id,this.dataset.occ||null,this.dataset.data||null)"'));
  check('a janela de "o que apagar" está na lista de janelas do app', /mFinDespesa\(\)\+mFinDespesaExcluir\(\)\+mFinConfig\(\)/.test(html));
  const despRule = rules.slice(rules.indexOf('match /leagues/{leagueId}/financeiro_despesas/{docId}'));
  const despBlock = despRule.slice(0, despRule.indexOf('\n    }') + 6);
  check('as regras só deixam o ADMIN gravar nas despesas e não limitam os campos (o `fim` e as `ignoradas` passam)', /allow write: if isLeagueAdmin\(leagueId\);/.test(despBlock) && !/hasOnly|affectedKeys|keys\(\)/.test(despBlock), despBlock);
  check('o manual explica as três opções, cada uma na sua linha da tabela, e o que se perde ao apagar tudo', manual.includes('<tr><td>Só esta data (ou Só este mês)</td>') && manual.includes('<tr><td>Esta e as próximas</td>') && manual.includes('<tr><td>Tudo: apagar a despesa inteira</td>') && /todos os meses, inclusive as datas já pagas/.test(manual) && /um registro só/.test(manual));
  check('o manual manda encerrar a despesa fixa por "Esta e as próximas"', /Para encerrar uma despesa fixa, use "Esta e as próximas"/.test(manual));
  check('o manual explica que a despesa vale a partir do MÊS de "A partir de" (meses anteriores sem a despesa, mês de início com todas as datas)', /vale a partir do <strong>mês<\/strong> de <em>A partir de<\/em>: os meses anteriores a ele <strong>não mostram<\/strong> a despesa nem a somam\./.test(manual) && /aparecem <strong>todas as datas do mês<\/strong>, mesmo as anteriores ao dia escolhido/.test(manual));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
