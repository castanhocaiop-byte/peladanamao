// PIX copia e cola (index.html): o que cada jogador deve, o botão "Pagar com PIX", a janela de pagamento, a cópia do código,
// a configuração da chave pelo admin e a mensagem de cobrança do WhatsApp. Extrai as funções reais do index.html e as roda
// num ambiente simulado, sem navegador. O formato do código em si é conferido em pix-test.js.
const fs = require('fs');
const path = require('path');
const funnel = require('../funnel-metrics');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const pixCode = slice('/* ── PIX copia e cola', '/* ── fim do PIX copia e cola');
const code = [
  slice('const esc = s =>', 'function toast('),
  slice('function getPaid(pagamentos, playerName, type) {', 'function getPaidDate'),
  pixCode,
  slice('function waMensalidadeLink(', 'async function cancelPresetChamp'),
  slice('function mFinConfig() {', 'async function notifyInadimplentes'),
  slice('async function saveFinConfig() {', 'async function toggleDespesaPaga'),
].join('\n');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// leitor do formato do código (para olhar dentro do que foi copiado)
function tlv(s) { const out = []; let i = 0; while (i < s.length) { const len = Number(s.slice(i + 2, i + 4)); out.push([s.slice(i, i + 2), s.slice(i + 4, i + 4 + len)]); i += 4 + len; } return out; }
const campo = (c, id) => (tlv(c).find(x => x[0] === id) || [])[1];
const mensagemDe = c => (tlv(campo(c, '26')).find(x => x[0] === '02') || [])[1];

const CPF = '12345678909';
function makeEnv({ clipboard = 'ok', execCommand = true, db = true, origin = 'https://peladanamao.com.br', st: stOver = {} } = {}) {
  const calls = { events: [], toasts: [], renders: 0, clips: [], exec: [], sets: [], removed: 0 };
  const els = {};
  const st = {
    leagueId: 'lg', availableLeagues: [{ id: 'lg', name: 'FutQuarta' }],
    userDoc: { playerKey: 'ana maria' },
    players: [{ name: 'Ana Maria' }, { name: 'Beto', somenteChurrasco: true }],
    appCfg: { hasChurrasco: false, churrascoSeparado: false },
    finCfg: { valorMensalidade: 50, valorChurrasco: 0, valorSomenteChurrasco: 0, vencimentoDia: 10, chavePix: CPF, chavePixTipo: '' },
    finMens: {}, modal: null, ...stOver,
  };
  const textarea = () => {
    const ta = { value: '', style: {}, attrs: {}, setAttribute(k, v) { ta.attrs[k] = v; }, select() {}, setSelectionRange() {}, remove() { calls.removed++; } };
    return ta;
  };
  const doc = {
    createElement: tag => { const t = textarea(); t.tag = tag; return t; },
    body: { appendChild: el => { el.attached = true; } },
    execCommand: cmd => { calls.exec.push(cmd); return execCommand; },
    getElementById: id => els[id] || null,
  };
  const nav = clipboard === 'none' ? {} : { clipboard: { writeText: async t => { if (clipboard === 'reject') throw new Error('negado'); calls.clips.push(t); } } };
  const env = {
    st, document: doc, navigator: nav, location: { origin },
    trackEvent: (n, once = true) => calls.events.push([n, once]),
    toast: (m, t = 'err') => calls.toasts.push([m, t]), // como o toast de verdade: 'err' quando não se diz o tipo
    render: () => { calls.renders++; },
    ldoc: p => ({ set: async d => { calls.sets.push([p, d]); } }),
    DB: db ? {} : null,
    playerKey: n => String(n).trim().toLowerCase(),
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { pixSetup, pixDue, pixSelected, pixToggleItem, pixPayload, pixTestPayload, pixButton, pixCopyText, openPixPay, copyPixCode, mPixPay, pixKeyStatusHtml, pixKeyInput, pixPickType, copyPixTest, mFinConfig, saveFinConfig, waMensalidadeLink, pixBRL };')(...names.map(n => env[n]));
  return { api, st, calls, els, env };
}
const tick = () => new Promise(r => setTimeout(r, 10));
const MES = '2026-10';

// ── o que o jogador deve ────────────────────────────────────────────────────────────────────────
let e = makeEnv();
let d = e.api.pixDue('Ana Maria', MES);
check('mensalidade em aberto: um item de R$ 50,00 e total 50', d.itens.length === 1 && d.itens[0].tipo === 'mensalidade' && d.itens[0].valor === 50 && d.total === 50, d);
e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true } } };
check('mensalidade paga: nada a pagar (total 0, sem itens)', e.api.pixDue('Ana Maria', MES).total === 0 && e.api.pixDue('Ana Maria', MES).itens.length === 0);
e.st.finMens[MES] = { pagamentos: { 'Ana Maria': true } };
check('dado antigo (pagamento salvo só como true): conta como mensalidade paga', e.api.pixDue('Ana Maria', MES).total === 0);
e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: false } } };
check('mensalidade marcada como não paga: continua devendo', e.api.pixDue('Ana Maria', MES).total === 50);
check('outro mês sem registro nenhum: deve a mensalidade daquele mês', e.api.pixDue('Ana Maria', '2026-09').total === 50 && e.api.pixDue('Ana Maria', '2027-01').total === 50);
e = makeEnv({ st: { appCfg: { hasChurrasco: true, churrascoSeparado: true }, finCfg: { valorMensalidade: 29.9, valorChurrasco: 10.1, valorSomenteChurrasco: 25, vencimentoDia: 10, chavePix: CPF, chavePixTipo: '' } } });
d = e.api.pixDue('Ana Maria', MES);
check('churrasco cobrado separado: mensalidade + churrasco somam em centavos exatos (29,90 + 10,10 = 40,00)', d.itens.map(i => i.tipo).join() === 'mensalidade,churrasco' && d.total === 40, d);
check('a soma é feita em centavos: 0,10 + 0,20 dá 0,30 (e não 0,30000000000000004)', (() => { const x = makeEnv({ st: { appCfg: { hasChurrasco: true, churrascoSeparado: true }, finCfg: { valorMensalidade: 0.1, valorChurrasco: 0.2, chavePix: CPF } } }); return x.api.pixDue('Ana Maria', MES).total === 0.3; })());
e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true, churrasco: false } } };
check('só o churrasco em aberto: só ele entra (R$ 10,10)', e.api.pixDue('Ana Maria', MES).itens.map(i => i.tipo).join() === 'churrasco' && e.api.pixDue('Ana Maria', MES).total === 10.1);
d = e.api.pixDue('Beto', MES);
check('jogador "só churrasco": paga o valor próprio (R$ 25), nunca a mensalidade', d.itens.length === 1 && d.itens[0].tipo === 'churrasco' && d.total === 25, d);
e.st.finMens[MES] = { pagamentos: { Beto: { churrasco: true } } };
check('…e depois de pagar o churrasco, não deve mais nada', e.api.pixDue('Beto', MES).total === 0);
e = makeEnv({ st: { appCfg: { hasChurrasco: true, churrascoSeparado: false }, finCfg: { valorMensalidade: 50, valorChurrasco: 30, valorSomenteChurrasco: 25, vencimentoDia: 10, chavePix: CPF, chavePixTipo: '' } } });
check('churrasco incluído na mensalidade (não separado): só a mensalidade; e o "só churrasco" não tem o que pagar aqui', e.api.pixDue('Ana Maria', MES).total === 50 && e.api.pixDue('Beto', MES).total === 0);
e = makeEnv({ st: { finCfg: { valorMensalidade: 0, chavePix: CPF, chavePixTipo: '' } } });
check('mensalidade configurada com R$ 0: nada a cobrar (sem botão, sem código)', e.api.pixDue('Ana Maria', MES).total === 0 && e.api.pixButton('Ana Maria', MES, 'pill') === '' && e.api.pixPayload('Ana Maria', MES) === '');
e = makeEnv({ st: { finCfg: { valorMensalidade: '50,5', chavePix: CPF } } });
check('valor salvo como texto inválido não vira "NaN" (conta como zero)', e.api.pixDue('Ana Maria', MES).total === 0);
check('quem não está no elenco (nome que não existe, ou a chave no lugar do nome em Meu Craque) não tem o que pagar: sem botão e sem código', (() => { const x = makeEnv(); return x.api.pixDue('Desconhecido', MES).total === 0 && x.api.pixButton('Desconhecido', MES, 'pill') === '' && x.api.pixPayload('Desconhecido', MES) === ''; })());
check('quem saiu da liga (jogador inativo) também não: a lista do Financeiro só cobra jogadores ativos', (() => { const x = makeEnv({ st: { players: [{ name: 'Ana Maria', active: false }] } }); return x.api.pixDue('Ana Maria', MES).total === 0 && x.api.pixButton('Ana Maria', MES, 'row') === ''; })() && makeEnv({ st: { players: [{ name: 'Ana Maria', active: true }] } }).api.pixDue('Ana Maria', MES).total === 50 && makeEnv({ st: { players: [{ name: 'Ana Maria' }] } }).api.pixDue('Ana Maria', MES).total === 50);
check('elenco ainda carregando (lista vazia ou ausente): nada a cobrar, sem erro', makeEnv({ st: { players: [] } }).api.pixDue('Ana Maria', MES).total === 0 && makeEnv({ st: { players: undefined } }).api.pixDue('Ana Maria', MES).total === 0);

// ── a chave pronta para uso ─────────────────────────────────────────────────────────────────────
check('sem chave, com chave inválida ou com 11 números ambíguos sem escolha: sem PIX (null)', [
  { chavePix: '' }, { chavePix: 'minha chave' }, { chavePix: '12345' }, { chavePix: '65910340646' }, {}, undefined,
].every(f => makeEnv({ st: { finCfg: f === undefined ? undefined : { valorMensalidade: 50, ...f } } }).api.pixSetup() === null));
check('chave válida: pronta (tipo e chave normalizada)', (() => { const k = makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: '(11) 91234-5678' } } }).api.pixSetup(); return k && k.tipo === 'celular' && k.chave === '+5511912345678'; })());
check('11 números ambíguos COM a escolha salva: pronta, e cada escolha vira uma chave diferente', (() => { const f = t => makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: '65910340646', chavePixTipo: t } } }).api.pixSetup(); return f('cpf').chave === '65910340646' && f('celular').chave === '+5565910340646'; })());
check('escolha salva que não combina com o texto da chave (alguém mexeu): sem PIX em vez de chave errada', makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: 'a@b.co', chavePixTipo: 'cpf' } } }).api.pixSetup() === null);

// ── o código de cada jogador ────────────────────────────────────────────────────────────────────
e = makeEnv();
let c = e.api.pixPayload('Ana Maria', MES);
check('código do jogador: chave do admin, valor da mensalidade e nome da liga (sem acento, em maiúsculas)', campo(c, '54') === '50.00' && tlv(campo(c, '26'))[1][1] === CPF && campo(c, '59') === 'FUTQUARTA' && campo(c, '60') === 'BRASIL', c);
check('…a mensagem diz o que é, o mês e quem pagou (para o admin reconhecer apelidos: "Pezão" ≠ nome no banco)', mensagemDe(c) === 'Mensalidade 10/2026 Ana Maria', mensagemDe(c));
e = makeEnv({ st: { appCfg: { hasChurrasco: true, churrascoSeparado: true }, finCfg: { valorMensalidade: 50, valorChurrasco: 30, chavePix: 'tesouraria@futquarta.com.br' } } });
c = e.api.pixPayload('Ana Maria', MES);
check('mensalidade + churrasco: um código só, com o total (R$ 80,00) e a mensagem "Mensalidade e Churrasco"', campo(c, '54') === '80.00' && /^Mensalidade e Churrasco 10\/2026 Ana/.test(mensagemDe(c) || ''), { v: campo(c, '54'), m: mensagemDe(c) });
e = makeEnv();
e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true } } };
check('tudo pago: nenhum código ("" em vez de um código de R$ 0)', e.api.pixPayload('Ana Maria', MES) === '');
e = makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: '' } } });
check('sem chave cadastrada: nenhum código', e.api.pixPayload('Ana Maria', MES) === '');
e = makeEnv({ st: { availableLeagues: [], leagueId: null } });
check('liga sem nome conhecido: o código sai assim mesmo, com o nome genérico PELADA NA MAO', campo(e.api.pixPayload('Ana Maria', MES), '59') === 'PELADA NA MAO');
e = makeEnv({ st: { availableLeagues: [{ id: 'lg', name: '⚽ Série B — Aceoma & Cia!' }] } });
check('nome de liga com acento, emoji e símbolos vira texto válido no código', campo(e.api.pixPayload('Ana Maria', MES), '59') === 'SERIE B ACEOMA CIA', campo(e.api.pixPayload('Ana Maria', MES), '59'));
e = makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: 'jogador@exemplo.com' } } });
check('código de teste do admin: R$ 1,00 e a mensagem de teste, com a chave digitada (mesmo sem salvar)', (() => { const t = e.api.pixTestPayload('(11) 91234-5678', ''); return campo(t, '54') === '1.00' && tlv(campo(t, '26'))[1][1] === '+5511912345678' && mensagemDe(t) === 'Teste Pelada na Mao'; })() && e.api.pixTestPayload('lixo', '') === '' && e.api.pixTestPayload('', '') === '');

// ── botão "Pagar com PIX" ───────────────────────────────────────────────────────────────────────
e = makeEnv();
const pill = e.api.pixButton('Ana Maria', MES, 'pill'), row = e.api.pixButton('Ana Maria', MES, 'row');
check('botão grande (Meu Craque): "💸 Pagar com PIX · R$ 50,00", abre a janela com o mês e o jogador', /💸 Pagar com PIX · R\$ 50,00/.test(pill) && /openPixPay\(this\.dataset\.month,this\.dataset\.player\)/.test(pill) && /data-month="2026-10"/.test(pill) && /data-player="Ana Maria"/.test(pill), pill);
check('botão pequeno (linha do Financeiro): "💸 PIX"', /💸 PIX</.test(row) && !/Pagar com PIX/.test(row.replace(/title="[^"]*"/, '')) && /openPixPay/.test(row), row);
check('sem o que pagar, ou sem chave: nenhum botão', (() => { const x = makeEnv(); x.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true } } }; return x.api.pixButton('Ana Maria', MES, 'pill') === ''; })() && makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: '' } } }).api.pixButton('Ana Maria', MES, 'row') === '');
e = makeEnv({ st: { players: [{ name: 'Zé "<b>x</b>" O\'Brien' }] } });
const sujo = e.api.pixButton('Zé "<b>x</b>" O\'Brien', MES, 'pill');
check('nome com aspas e tags não escapa do atributo (sem injeção de HTML)', !/<b>/.test(sujo) && /data-player="Zé &quot;&lt;b>x&lt;\/b>&quot; O'Brien"/.test(sujo), sujo);

// ── abrir a janela ──────────────────────────────────────────────────────────────────────────────
e = makeEnv();
e.api.openPixPay(MES, 'Ana Maria');
check('abrir: guarda mês e jogador na janela, redesenha e conta a abertura (uma vez por sessão)', JSON.stringify(e.st.modal) === JSON.stringify({ type: 'pixPay', month: MES, name: 'Ana Maria' }) && e.calls.renders === 1 && JSON.stringify(e.calls.events) === JSON.stringify([['pixOpen', true]]), { m: e.st.modal, ev: e.calls.events });
for (const [rot, mes, nome, over] of [['mês inválido', 'xx', 'Ana Maria', {}], ['mês vazio', '', 'Ana Maria', {}], ['mês com lixo', '2026-10; alert(1)', 'Ana Maria', {}], ['nada a pagar', MES, 'Ana Maria', { finMens: { [MES]: { pagamentos: { 'Ana Maria': { mensalidade: true } } } } }], ['sem chave', MES, 'Ana Maria', { finCfg: { valorMensalidade: 50, chavePix: '' } }]]) {
  const x = makeEnv({ st: over });
  x.api.openPixPay(mes, nome);
  check(`abrir com ${rot}: não abre nada, não redesenha e não conta`, x.st.modal === null && x.calls.renders === 0 && x.calls.events.length === 0);
}

// ── copiar o código ─────────────────────────────────────────────────────────────────────────────
(async () => {
  e = makeEnv();
  e.api.openPixPay(MES, 'Ana Maria');
  await e.api.copyPixCode();
  const esperado = e.api.pixPayload('Ana Maria', MES);
  check('copiar: coloca na área de transferência exatamente o código do jogador, conta o toque (sempre) e avisa', e.calls.clips.length === 1 && e.calls.clips[0] === esperado && esperado.length > 100 && JSON.stringify(e.calls.events.slice(-1)) === JSON.stringify([['pixCopy', false]]) && e.calls.toasts.slice(-1)[0][1] === 'ok' && /copiado/i.test(e.calls.toasts.slice(-1)[0][0]), { clips: e.calls.clips, ev: e.calls.events, t: e.calls.toasts });
  check('…sem mostrar o código na tela quando a cópia funcionou', e.st.modal.showCode === undefined && !/<textarea/.test(e.api.mPixPay()));

  e = makeEnv({ clipboard: 'none' });
  e.api.openPixPay(MES, 'Ana Maria');
  await e.api.copyPixCode();
  check('aparelho sem área de transferência moderna: usa o plano B (campo escondido + copiar) e remove o campo depois', e.calls.exec.join() === 'copy' && e.calls.removed === 1 && e.st.modal.showCode === undefined && e.calls.toasts.slice(-1)[0][1] === 'ok');

  e = makeEnv({ clipboard: 'reject' });
  e.api.openPixPay(MES, 'Ana Maria');
  await e.api.copyPixCode();
  check('permissão negada na área de transferência: também cai no plano B', e.calls.exec.join() === 'copy' && e.calls.toasts.slice(-1)[0][1] === 'ok');

  e = makeEnv({ clipboard: 'none', execCommand: false });
  e.api.openPixPay(MES, 'Ana Maria');
  const renders0 = e.calls.renders;
  await e.api.copyPixCode();
  check('nada funcionou: mostra o código num campo para copiar na mão, redesenha e avisa (não finge que copiou)', e.st.modal.showCode === true && e.calls.renders === renders0 + 1 && e.calls.toasts.slice(-1)[0][1] === 'err' && /Toque no código/.test(e.calls.toasts.slice(-1)[0][0]) && /<textarea[^>]*readonly/.test(e.api.mPixPay()) && e.api.mPixPay().includes(e.api.pixPayload('Ana Maria', MES)), e.calls.toasts);

  e = makeEnv();
  e.api.openPixPay(MES, 'Ana Maria');
  e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true } } }; // o admin marcou como pago com a janela aberta
  await e.api.copyPixCode();
  check('se o admin marcar como pago com a janela aberta: não copia código de R$ 0, avisa que não há nada pendente', e.calls.clips.length === 0 && /nada pendente/i.test(e.calls.toasts.slice(-1)[0][0]) && !e.calls.events.some(x => x[0] === 'pixCopy'));
  const x2 = makeEnv(); await x2.api.copyPixCode();
  const x3 = makeEnv({ st: { modal: { type: 'finConfig' } } }); await x3.api.copyPixCode();
  check('copiar sem a janela de pagamento aberta: não faz nada', x2.calls.clips.length === 0 && x3.calls.clips.length === 0 && x2.calls.toasts.length === 0);

  // ── cópia: função de baixo nível ───────────────────────────────────────────────────────────────
  e = makeEnv();
  check('pixCopyText: devolve true quando copiou, false quando nenhum jeito funcionou', await e.api.pixCopyText('abc') === true && (await makeEnv({ clipboard: 'none', execCommand: false }).api.pixCopyText('abc')) === false);

  // ── janela de pagamento ────────────────────────────────────────────────────────────────────────
  e = makeEnv({ st: { appCfg: { hasChurrasco: true, churrascoSeparado: true }, finCfg: { valorMensalidade: 50, valorChurrasco: 30, chavePix: CPF } } });
  e.st.modal = { type: 'pixPay', month: MES, name: 'Ana Maria' };
  let m = e.api.mPixPay();
  const txt = m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('janela: título, mês por extenso, cada item com valor, total de R$ 80,00 e o nome da liga', /Pagar com PIX/.test(txt) && /Mensalidade · outubro de 2026 R\$ 50,00/.test(txt) && /Churrasco · outubro de 2026 R\$ 30,00/.test(txt) && /Total R\$ 80,00/.test(txt) && /FutQuarta/.test(txt), txt);
  check('janela: a chave aparece escondida (***.456.789-**), NUNCA inteira, e o tipo (CPF) é dito', /chave PIX \(CPF\) \*\*\*\.456\.789-\*\*/.test(txt) && !m.includes(CPF), txt);
  check('janela: o botão chama a cópia, os passos explicam o Pix Copia e Cola, que o admin marca como pago e que o app não recebe o dinheiro', /onclick="copyPixCode\(\)"/.test(m) && /Pix Copia e Cola/.test(txt) && /avise o admin/.test(txt) && /marca a mensalidade como paga/.test(txt) && /não recebe nem guarda esse dinheiro/.test(txt), txt);
  check('janela: sem o campo do código enquanto a cópia não falhar', !/<textarea/.test(m));
  e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true, churrasco: true } } };
  m = e.api.mPixPay();
  check('tudo pago com a janela aberta: mostra "Nada pendente em outubro de 2026" e some o botão de copiar', /Nada pendente em outubro de 2026/.test(m) && !/copyPixCode/.test(m));
  e = makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: '' } } });
  e.st.modal = { type: 'pixPay', month: MES, name: 'Ana Maria' };
  m = e.api.mPixPay();
  check('admin sem chave válida (mudou depois que a janela abriu): explica em vez de mostrar valor ou botão', /ainda não cadastrou uma chave PIX/.test(m) && !/copyPixCode/.test(m));
  e = makeEnv({ st: { availableLeagues: [{ id: 'lg', name: '<img src=x onerror=alert(1)>' }] } });
  e.st.modal = { type: 'pixPay', month: MES, name: 'Ana Maria' };
  check('nome da liga com HTML é escapado na janela', !/<img src=x/.test(e.api.mPixPay()) && /&lt;img/.test(e.api.mPixPay()));
  check('sem a janela de pagamento aberta: nada é desenhado', makeEnv().api.mPixPay() === '' && makeEnv({ st: { modal: { type: 'finConfig' } } }).api.mPixPay() === '');
  e = makeEnv({ st: { finCfg: { valorMensalidade: 50, chavePix: 'jogador@exemplo.com' } } });
  e.st.modal = { type: 'pixPay', month: MES, name: 'Ana Maria' };
  check('chave de e-mail também sai escondida (j***@exemplo.com) e nunca inteira', /j\*\*\*@exemplo\.com/.test(e.api.mPixPay()) && !/jogador@exemplo/.test(e.api.mPixPay()));

  // ── desmarcar o churrasco (quando é cobrado à parte) ───────────────────────────────────────────
  const COM_CHURRASCO = { appCfg: { hasChurrasco: true, churrascoSeparado: true }, finCfg: { valorMensalidade: 50, valorChurrasco: 30, valorSomenteChurrasco: 25, vencimentoDia: 10, chavePix: CPF, chavePixTipo: '' } };
  const novaJanela = (over = {}, modal = {}) => { const x = makeEnv({ st: { ...COM_CHURRASCO, ...over } }); x.st.modal = { type: 'pixPay', month: MES, name: 'Ana Maria', ...modal }; return x; };
  const caixas = h => (h.match(/type="checkbox"/g) || []).length;
  const texto = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const tipos = s => s.itens.map(i => i.tipo).join();

  // o que entra na conta
  e = novaJanela();
  const due = e.api.pixDue('Ana Maria', MES);
  check('sem desmarcar nada (ou com a lista vazia): tudo o que se deve entra, mensalidade + churrasco = R$ 80,00', tipos(e.api.pixSelected(due, undefined)) === 'mensalidade,churrasco' && e.api.pixSelected(due, undefined).total === 80 && e.api.pixSelected(due, []).total === 80);
  check('desmarcando o churrasco: sobra só a mensalidade (R$ 50,00)', tipos(e.api.pixSelected(due, ['churrasco'])) === 'mensalidade' && e.api.pixSelected(due, ['churrasco']).total === 50);
  check('a mensalidade NUNCA sai da conta, nem com um estado estranho (lista com "mensalidade" ou nomes que não existem)', e.api.pixSelected(due, ['mensalidade']).total === 80 && e.api.pixSelected(due, ['mensalidade', 'churrasco']).total === 50 && e.api.pixSelected(due, ['xyz']).total === 80);
  check('lista inválida (nula, texto, número, objeto) vale como "nada desmarcado"', [null, 'churrasco', 5, {}].every(o => e.api.pixSelected(due, o).total === 80));
  check('a conta continua em centavos exatos: 29,90 + 10,10 = 40,00 e, sem o churrasco, 29,90', (() => { const x = novaJanela({ finCfg: { valorMensalidade: 29.9, valorChurrasco: 10.1, chavePix: CPF } }); const d = x.api.pixDue('Ana Maria', MES); return x.api.pixSelected(d, []).total === 40 && x.api.pixSelected(d, ['churrasco']).total === 29.9; })());
  check('…e com valores que quebram em ponto flutuante (0,10 + 0,20 e 1,10 + 2,20) a soma continua exata, com e sem o churrasco', [[0.1, 0.2, 0.3], [1.1, 2.2, 3.3]].every(([a, b, soma]) => { const x = novaJanela({ finCfg: { valorMensalidade: a, valorChurrasco: b, chavePix: CPF } }); const d = x.api.pixDue('Ana Maria', MES); return x.api.pixSelected(d, []).total === soma && x.api.pixSelected(d, ['churrasco']).total === a; }));
  check('não mexe no que se deve: pixDue continua devolvendo os dois itens (o botão grande mostra o total cheio)', tipos(due) === 'mensalidade,churrasco' && due.total === 80 && /Pagar com PIX · R\$ 80,00/.test(e.api.pixButton('Ana Maria', MES, 'pill')));
  const dBeto = e.api.pixDue('Beto', MES);
  check('jogador "só churrasco" (R$ 25): o churrasco é o único item; desmarcado, não sobra nada (total 0)', tipos(dBeto) === 'churrasco' && e.api.pixSelected(dBeto, []).total === 25 && e.api.pixSelected(dBeto, ['churrasco']).total === 0 && e.api.pixSelected(dBeto, ['churrasco']).itens.length === 0);

  // o código
  const semChurrasco = e.api.pixPayload('Ana Maria', MES, ['churrasco']);
  check('código sem o churrasco: valor R$ 50,00 e a mensagem diz só "Mensalidade 10/2026 Ana Maria"', campo(semChurrasco, '54') === '50.00' && mensagemDe(semChurrasco) === 'Mensalidade 10/2026 Ana Maria', { v: campo(semChurrasco, '54'), m: mensagemDe(semChurrasco) });
  check('…sem desmarcar nada: o mesmo de antes, R$ 80,00 e "Mensalidade e Churrasco"', campo(e.api.pixPayload('Ana Maria', MES), '54') === '80.00' && campo(e.api.pixPayload('Ana Maria', MES, []), '54') === '80.00' && /^Mensalidade e Churrasco 10\/2026/.test(mensagemDe(e.api.pixPayload('Ana Maria', MES, [])) || ''));
  check('…churrasco desmarcado de quem só paga churrasco: nenhum código ("" em vez de um código de R$ 0)', e.api.pixPayload('Beto', MES, ['churrasco']) === '' && e.api.pixPayload('Beto', MES) !== '');

  // a janela
  let wj;
  e = novaJanela();
  wj = e.api.mPixPay();
  let tj = texto(wj);
  check('churrasco cobrado à parte: o churrasco ganha uma caixa de marcar, já marcada, e a mensalidade não tem caixa (uma só)', caixas(wj) === 1 && /<input type="checkbox" checked onchange="pixToggleItem\('churrasco'\)"/.test(wj) && !/<label[^>]*>(?:(?!<\/label>)[\s\S])*Mensalidade/.test(wj), wj);
  check('…total R$ 80,00, dica de desmarcar quem não vai ao churrasco e botão de copiar ligado', /Total R\$ 80,00/.test(tj) && /Não vai ao churrasco neste mês\? Desmarque o churrasco e pague só a mensalidade\./.test(tj) && /onclick="copyPixCode\(\)"/.test(wj) && !/disabled/.test(wj), tj);
  check('…a linha do churrasco inteira é a caixa (tocar no nome ou no valor também marca): é um <label> com o nome e o valor dentro', /<label[^>]*>[^]*Churrasco · outubro de 2026<\/span><b[^>]*>R\$ 30,00<\/b><\/label>/.test(wj) && !/line-through/.test(wj));
  e = novaJanela({}, { off: ['churrasco'] });
  wj = e.api.mPixPay(); tj = texto(wj);
  check('churrasco desmarcado: caixa sem "checked", nome e valor riscados (continuam escritos), total R$ 50,00 e mensalidade intacta', caixas(wj) === 1 && !/type="checkbox" checked/.test(wj) && (wj.match(/line-through/g) || []).length === 2 && /Total R\$ 50,00/.test(tj) && /Mensalidade · outubro de 2026 R\$ 50,00/.test(tj) && /Churrasco · outubro de 2026 R\$ 30,00/.test(tj), wj);
  check('…o botão de copiar continua ligado (ainda há a mensalidade)', /onclick="copyPixCode\(\)"/.test(wj) && !/disabled/.test(wj));
  e = makeEnv(); e.st.modal = { type: 'pixPay', month: MES, name: 'Ana Maria' };
  wj = e.api.mPixPay();
  check('churrasco incluído na mensalidade (ou liga sem churrasco): a janela não tem caixa nem dica nem a palavra churrasco', caixas(wj) === 0 && !/churrasco/i.test(texto(wj)), texto(wj));
  e = novaJanela({}, { name: 'Beto' });
  wj = e.api.mPixPay(); tj = texto(wj);
  check('"só churrasco": o churrasco tem a caixa, mas sem a dica "pague só a mensalidade" (ele não paga mensalidade); total R$ 25,00', caixas(wj) === 1 && !/pague só a mensalidade/.test(tj) && /Total R\$ 25,00/.test(tj), tj);
  e = novaJanela({}, { name: 'Beto', off: ['churrasco'] });
  wj = e.api.mPixPay(); tj = texto(wj);
  check('…desmarcado: total R$ 0,00 e o botão fica desligado, dizendo "Marque ao menos um item" (nada de código de R$ 0)', /Total R\$ 0,00/.test(tj) && /<button class="btn btn-primary" disabled[^>]*>📋 Marque ao menos um item<\/button>/.test(wj) && !/copyPixCode/.test(wj), wj);
  e = novaJanela({}, { showCode: true, off: ['churrasco'] });
  check('campo do código (quando a cópia falhou): mostra o código SEM o churrasco, igual ao que seria copiado', e.api.mPixPay().includes(e.api.pixPayload('Ana Maria', MES, ['churrasco'])) && !e.api.mPixPay().includes(e.api.pixPayload('Ana Maria', MES)));
  e = novaJanela({}, { name: 'Beto', showCode: true, off: ['churrasco'] });
  check('…sem nada marcado, o campo do código some', !/<textarea/.test(e.api.mPixPay()));

  // marcar e desmarcar
  e = novaJanela();
  const r0b = e.calls.renders;
  e.api.pixToggleItem('churrasco');
  check('desmarcar o churrasco: guarda na janela (sem perder mês nem jogador) e redesenha', JSON.stringify(e.st.modal) === JSON.stringify({ type: 'pixPay', month: MES, name: 'Ana Maria', off: ['churrasco'] }) && e.calls.renders === r0b + 1, e.st.modal);
  e.api.pixToggleItem('churrasco');
  check('…marcar de novo: a lista volta a ficar vazia, redesenha e o código volta a ser o completo', JSON.stringify(e.st.modal.off) === '[]' && e.calls.renders === r0b + 2 && e.api.pixPayload('Ana Maria', MES, e.st.modal.off) === e.api.pixPayload('Ana Maria', MES));
  e.api.pixToggleItem('mensalidade'); e.api.pixToggleItem('xyz'); e.api.pixToggleItem(undefined);
  check('a mensalidade (ou qualquer outro nome) não pode ser desmarcada: nada muda e nada é redesenhado', JSON.stringify(e.st.modal.off) === '[]' && e.calls.renders === r0b + 2);
  for (const ruim of ['churrasco', {}, 7, null]) {
    const z = novaJanela({}, { off: ruim });
    let estourou = false; try { z.api.pixToggleItem('churrasco'); } catch (_) { estourou = true; }
    check(`lista de desmarcados corrompida na janela (${JSON.stringify(ruim)}): não estoura e o churrasco fica desmarcado só uma vez`, !estourou && JSON.stringify(z.st.modal.off) === '["churrasco"]', z.st.modal);
  }
  const e3 = makeEnv({ st: { modal: { type: 'finConfig' } } }); e3.api.pixToggleItem('churrasco');
  const e4 = makeEnv(); e4.api.pixToggleItem('churrasco');
  check('fora da janela de pagamento (outra janela ou nenhuma): ignora', e3.calls.renders === 0 && e4.calls.renders === 0 && JSON.stringify(e3.st.modal) === JSON.stringify({ type: 'finConfig' }) && e4.st.modal === null);
  e = novaJanela({}, { showCode: true });
  e.api.pixToggleItem('churrasco');
  check('desmarcar com o campo do código aberto: o campo continua aberto e já mostra o código novo', e.st.modal.showCode === true && e.api.mPixPay().includes(e.api.pixPayload('Ana Maria', MES, ['churrasco'])));

  // copiar
  e = novaJanela(); e.api.openPixPay(MES, 'Ana Maria'); e.api.pixToggleItem('churrasco');
  await e.api.copyPixCode();
  check('copiar com o churrasco desmarcado: copia o código de R$ 50,00 (não o de R$ 80,00) e conta a cópia', e.calls.clips.length === 1 && campo(e.calls.clips[0], '54') === '50.00' && mensagemDe(e.calls.clips[0]) === 'Mensalidade 10/2026 Ana Maria' && e.calls.events.some(x => x[0] === 'pixCopy'), e.calls.clips);
  e = novaJanela(); e.api.openPixPay(MES, 'Beto'); e.api.pixToggleItem('churrasco');
  await e.api.copyPixCode();
  check('copiar sem nada marcado: não copia, não conta e pede para marcar ao menos um item (não diz "nada pendente", que não é verdade)', e.calls.clips.length === 0 && !e.calls.events.some(x => x[0] === 'pixCopy') && e.calls.toasts.slice(-1)[0][0] === 'Marque ao menos um item para pagar.' && e.calls.toasts.slice(-1)[0][1] === 'err', e.calls.toasts);
  e = novaJanela(); e.api.openPixPay(MES, 'Ana Maria'); e.api.pixToggleItem('churrasco'); e.st.modal = null; e.api.openPixPay(MES, 'Ana Maria');
  check('fechar e abrir de novo: o churrasco volta marcado (a escolha vale só para aquela abertura)', e.st.modal.off === undefined && /type="checkbox" checked/.test(e.api.mPixPay()) && /Total R\$ 80,00/.test(texto(e.api.mPixPay())));
  e = novaJanela(); e.api.openPixPay(MES, 'Ana Maria'); e.api.pixToggleItem('churrasco');
  e.st.finMens[MES] = { pagamentos: { 'Ana Maria': { mensalidade: true, churrasco: true } } };
  await e.api.copyPixCode();
  check('tudo pago com a janela aberta (e o churrasco desmarcado): continua dizendo que não há nada pendente', /nada pendente/i.test(e.calls.toasts.slice(-1)[0][0]) && e.calls.clips.length === 0);

  // como está escrito no código
  check('só o churrasco pode ser desmarcado (lista fixa no código), e a caixa chama pixToggleItem com o tipo do item', /const PIX_OPCIONAIS = \['churrasco'\];/.test(pixCode) && /onchange="pixToggleItem\('\$\{i\.tipo\}'\)"/.test(pixCode));
  check('o total da janela, o botão, o campo do código e a cópia usam o que ficou marcado (e não o total cheio)', /pixBRL\(sel\.total\)/.test(pixCode) && /sel\.total > 0/.test(pixCode) && (pixCode.match(/pixPayload\(m\.name, m\.month, m\.off\)/g) || []).length === 2 && !/pixPayload\(m\.name, m\.month\)/.test(pixCode));

  // ── janela do admin: reconhecimento da chave ───────────────────────────────────────────────────
  const S = (chavePix, chavePixTipo = '') => e2().api.pixKeyStatusHtml({ chavePix, chavePixTipo });
  function e2() { return makeEnv(); }
  check('chave vazia: dica de que o botão "Pagar com PIX" aparece com o valor preenchido e que a chave vai no WhatsApp', /Pagar com PIX/.test(S('')) && /WhatsApp/.test(S('')) && !/copyPixTest/.test(S('')));
  check('chave reconhecida: "✓ Chave reconhecida: CPF", botão de código de teste e a orientação de só conferir o nome', /✓ Chave reconhecida: CPF\./.test(S('123.456.789-09')) && /copyPixTest\(\)/.test(S('123.456.789-09')) && /Copiar código de teste \(R\$ 1,00\)/.test(S('123.456.789-09')) && /não precisa pagar/i.test(S('123.456.789-09')));
  check('…cada tipo dá o nome certo (celular, e-mail, chave aleatória, CNPJ)', /reconhecida: celular/.test(S('(11) 91234-5678')) && /reconhecida: e-mail/.test(S('a@b.co')) && /reconhecida: chave aleatória/.test(S('123e4567-e12b-12d1-a456-426655440000')) && /reconhecida: CNPJ/.test(S('11.222.333/0001-81')));
  check('11 números ambíguos: pergunta "CPF ou celular?" com dois botões e SEM botão de teste', /CPF ou um celular/.test(S('65910340646')) && /pixPickType\('cpf'\)/.test(S('65910340646')) && /pixPickType\('celular'\)/.test(S('65910340646')) && !/copyPixTest/.test(S('65910340646')));
  check('…depois da escolha vira "reconhecida" no tipo escolhido', /reconhecida: celular/.test(S('65910340646', 'celular')) && /reconhecida: CPF/.test(S('65910340646', 'cpf')));
  check('chave inválida: aviso em vermelho dizendo que sem chave reconhecida o botão não aparece, sem botão de teste', /Não reconheci essa chave/.test(S('abc')) && /#FF5C5C/.test(S('abc')) && /não aparece para os jogadores/.test(S('abc')) && !/copyPixTest/.test(S('abc')));

  e = makeEnv();
  e.st.modal = { type: 'finConfig', chavePix: '65910340646', chavePixTipo: 'cpf' };
  const alvo = { innerHTML: '' }; e.els['pix-key-status'] = alvo;
  const r0 = e.calls.renders;
  e.api.pixKeyInput('(11) 91234-5678');
  check('digitar na chave: guarda o texto, ZERA a escolha antiga (CPF/celular) e atualiza só o aviso, sem redesenhar a janela (o campo não perde o foco)', e.st.modal.chavePix === '(11) 91234-5678' && e.st.modal.chavePixTipo === '' && /reconhecida: celular/.test(alvo.innerHTML) && e.calls.renders === r0, { m: e.st.modal, h: alvo.innerHTML.slice(0, 80), r: e.calls.renders });
  e.els = {}; e.env.document.getElementById = () => null;
  let boom = false; try { e.api.pixKeyInput('x'); } catch (err) { boom = true; }
  check('digitar sem o aviso na tela (janela já fechada): não quebra', !boom);
  e = makeEnv();
  e.st.modal = { type: 'finConfig', chavePix: '65910340646', chavePixTipo: '' };
  e.api.pixPickType('celular');
  check('escolher "É um celular": guarda a escolha e redesenha a janela', e.st.modal.chavePixTipo === 'celular' && e.calls.renders === 1);
  e = makeEnv(); e.api.pixPickType('cpf');
  e.st.modal = { type: 'pixPay' }; e.api.pixPickType('cpf');
  check('escolher o tipo fora da janela de configuração: ignora', e.st.modal.chavePixTipo === undefined && e.calls.renders === 0);

  e = makeEnv();
  e.st.modal = { type: 'finConfig', chavePix: 'jogador@exemplo.com', chavePixTipo: '' };
  await e.api.copyPixTest();
  check('código de teste: copia o código de R$ 1,00 da chave DIGITADA (ainda não salva) e avisa', e.calls.clips.length === 1 && campo(e.calls.clips[0], '54') === '1.00' && tlv(campo(e.calls.clips[0], '26'))[1][1] === 'jogador@exemplo.com' && e.calls.toasts.slice(-1)[0][1] === 'ok', e.calls.clips);
  e = makeEnv();
  e.st.modal = { type: 'finConfig', chavePix: 'lixo', chavePixTipo: '' };
  await e.api.copyPixTest();
  check('código de teste com chave inválida: não copia nada e pede para conferir a chave', e.calls.clips.length === 0 && /Confira a chave/.test(e.calls.toasts.slice(-1)[0][0]) && e.calls.toasts.slice(-1)[0][1] === 'err');
  e = makeEnv({ clipboard: 'none', execCommand: false });
  e.st.modal = { type: 'finConfig', chavePix: 'jogador@exemplo.com' };
  await e.api.copyPixTest();
  check('código de teste sem conseguir copiar: avisa o erro (não diz que copiou)', e.calls.toasts.slice(-1)[0][1] === 'err' && /Não consegui copiar/.test(e.calls.toasts.slice(-1)[0][0]));

  // ── janela ⚙️ Financeiro e salvar ──────────────────────────────────────────────────────────────
  e = makeEnv();
  e.st.modal = { type: 'finConfig', valorMensalidade: 50, valorChurrasco: 0, valorSomenteChurrasco: 0, reserva: 300, saldoInicial: 0, valorAvulso: 20, vencimentoDia: 10, chavePix: 'a"b<c', chavePixTipo: '' };
  const fc = e.api.mFinConfig();
  check('janela do financeiro: campo da chave com aviso embaixo, atualizado a cada letra digitada; texto da chave escapado', /placeholder="CPF, CNPJ, celular, e-mail ou chave aleatória"/.test(fc) && /oninput="pixKeyInput\(this\.value\)"/.test(fc) && /id="pix-key-status"/.test(fc) && /value="a&quot;b&lt;c"/.test(fc) && !/value="a"b/.test(fc), fc.match(/placeholder="CPF[\s\S]{0,260}/)?.[0]);
  check('…e o aviso já vem preenchido ao abrir a janela (chave inválida → "Não reconheci essa chave"; chave válida → "reconhecida" com o botão de teste)', /Não reconheci essa chave/.test(fc) && (() => { const x = makeEnv(); x.st.modal = { type: 'finConfig', chavePix: 'jogador@exemplo.com' }; const h = x.api.mFinConfig(); return /Chave reconhecida: e-mail/.test(h) && /copyPixTest\(\)/.test(h); })() && (() => { const x = makeEnv(); x.st.modal = { type: 'finConfig', chavePix: '65910340646', chavePixTipo: '' }; return /CPF ou um celular/.test(x.api.mFinConfig()); })(), fc.match(/pix-key-status[\s\S]{0,200}/)?.[0]);
  check('…os outros campos continuam lá (mensalidade, reserva, avulso, vencimento, saldo) e o botão Salvar', /Mensalidade — quadra/.test(fc) && /Reserva quadra/.test(fc) && /Valor Avulso/.test(fc) && /Vencimento mensalidade/.test(fc) && /Saldo Inicial/.test(fc) && /saveFinConfig\(\)/.test(fc));
  check('sem a janela de configuração aberta: nada é desenhado', makeEnv().api.mFinConfig() === '');

  const salvar = async (modal, over = {}) => { const x = makeEnv(over); x.st.modal = { type: 'finConfig', valorMensalidade: 50, valorChurrasco: 0, valorSomenteChurrasco: 0, reserva: 300, saldoInicial: 10, valorAvulso: 20, vencimentoDia: 10, ...modal }; await x.api.saveFinConfig(); return x; };
  let s = await salvar({ chavePix: '  123.456.789-09 ', chavePixTipo: '' });
  check('salvar chave válida: grava o texto sem espaços nas pontas e o tipo reconhecido (cpf), junto dos outros valores', s.calls.sets.length === 1 && s.calls.sets[0][0] === 'financeiro_config/main' && s.calls.sets[0][1].chavePix === '123.456.789-09' && s.calls.sets[0][1].chavePixTipo === 'cpf' && s.calls.sets[0][1].valorMensalidade === 50 && s.calls.sets[0][1].reserva === 300 && s.calls.sets[0][1].saldoInicial === 10 && s.calls.sets[0][1].vencimentoDia === 10 && s.st.modal === null && s.calls.toasts.slice(-1)[0][0] === 'Configuração salva!', s.calls.sets);
  s = await salvar({ chavePix: '65910340646', chavePixTipo: '' });
  check('salvar 11 números ambíguos sem escolher: salva, mas SEM tipo, e avisa que falta escolher CPF ou celular', s.calls.sets[0][1].chavePix === '65910340646' && s.calls.sets[0][1].chavePixTipo === '' && /escolher se a chave PIX é CPF ou celular/.test(s.calls.toasts.slice(-1)[0][0]), { set: s.calls.sets[0][1], t: s.calls.toasts });
  s = await salvar({ chavePix: '65910340646', chavePixTipo: 'celular' });
  check('…com a escolha feita: grava o tipo escolhido (celular) e o aviso é o normal', s.calls.sets[0][1].chavePixTipo === 'celular' && s.calls.toasts.slice(-1)[0][0] === 'Configuração salva!');
  s = await salvar({ chavePix: 'minha chave', chavePixTipo: 'cpf' });
  check('chave que o app não reconhece: salva (o texto continua nas mensagens do WhatsApp), tipo vazio e aviso de que o botão não vai aparecer', s.calls.sets[0][1].chavePix === 'minha chave' && s.calls.sets[0][1].chavePixTipo === '' && /não foi reconhecida/.test(s.calls.toasts.slice(-1)[0][0]) && /só aparece com uma chave válida/.test(s.calls.toasts.slice(-1)[0][0]), s.calls.toasts);
  s = await salvar({ chavePix: '   ' });
  check('chave apagada: salva vazia, sem tipo e sem aviso de erro', s.calls.sets[0][1].chavePix === '' && s.calls.sets[0][1].chavePixTipo === '' && s.calls.toasts.slice(-1)[0][0] === 'Configuração salva!');
  s = await salvar({ chavePix: undefined });
  check('chave nunca preenchida (campo ausente): não quebra', s.calls.sets.length === 1 && s.calls.sets[0][1].chavePix === '' && s.calls.sets[0][1].chavePixTipo === '');
  s = await salvar({ chavePix: CPF }, { db: false });
  check('sem conexão com o banco: não grava nada', s.calls.sets.length === 0);
  s = await salvar({ chavePix: CPF }, {});
  check('o tipo gravado sempre corresponde ao texto: CPF vira "cpf"; e-mail, "email"; chave aleatória, "aleatoria"; CNPJ, "cnpj"', ['123.456.789-09', 'a@b.co', '123e4567-e12b-12d1-a456-426655440000', '11.222.333/0001-81'].length === 4 && (await Promise.all(['123.456.789-09', 'a@b.co', '123e4567-e12b-12d1-a456-426655440000', '11.222.333/0001-81'].map(k => salvar({ chavePix: k })))).map(x => x.calls.sets[0][1].chavePixTipo).join() === 'cpf,email,aleatoria,cnpj');

  // ── mensagem de cobrança do WhatsApp ───────────────────────────────────────────────────────────
  const msg = (envOver, valor = 50, mes = '2020-01', nome = 'Ana Maria') => { const x = makeEnv(envOver); const url = x.api.waMensalidadeLink('(11) 91234-5678', nome, valor, mes); return { url, texto: decodeURIComponent(url.split('?text=')[1]) }; };
  let w = msg({});
  check('WhatsApp: abre a conversa com o número em formato internacional (55 + DDD + número)', w.url.startsWith('https://wa.me/5511912345678?text='), w.url);
  check('WhatsApp, em atraso: usa o NOME DA LIGA (não "Futebol ACEOMA" fixo), o mês por extenso, o valor e a chave', /^⚽ Olá, Ana Maria!/.test(w.texto) && /mensalidade da liga \*FutQuarta\* de janeiro de 2020 está \*em atraso\*/.test(w.texto) && /💰 Valor: R\$ 50,00/.test(w.texto) && /🔑 Chave PIX: 12345678909/.test(w.texto) && !/ACEOMA/.test(w.texto), w.texto);
  check('…e convida a pagar com o PIX copia e cola no app, com o endereço do próprio app (o de teste aponta para o de teste)', /💸 Prefere o PIX copia e cola, com o valor já preenchido\? Toque em "Pagar com PIX" no app: https:\/\/peladanamao\.com\.br$/.test(w.texto) && /seriebaceoma-staging\.web\.app$/.test(msg({ origin: 'https://seriebaceoma-staging.web.app' }).texto), w.texto);
  w = msg({}, 50, '2099-12');
  check('WhatsApp, antes do vencimento: "vence em DD/MM/AAAA" com o dia configurado e o mesmo convite', /vence em \*10\/12\/2099\*/.test(w.texto) && /Pagar com PIX/.test(w.texto) && /da liga \*FutQuarta\*/.test(w.texto), w.texto);
  w = msg({ st: { finCfg: { valorMensalidade: 50, vencimentoDia: 10, chavePix: 'texto livre que não é chave' } } });
  check('chave que o app não reconhece: a chave continua na mensagem (como sempre), mas SEM o convite para o botão que não existe', /🔑 Chave PIX: texto livre que não é chave/.test(w.texto) && !/Pagar com PIX/.test(w.texto), w.texto);
  w = msg({ st: { finCfg: { valorMensalidade: 50, vencimentoDia: 10, chavePix: '' } } });
  check('sem chave: nem a linha da chave nem o convite (como antes)', !/Chave PIX/.test(w.texto) && !/Pagar com PIX/.test(w.texto) && /Valor: R\$ 50,00/.test(w.texto), w.texto);
  w = msg({}, 0);
  check('valor zero: sem convite para pagar (não há o que pagar)', !/Pagar com PIX/.test(w.texto));
  w = msg({ st: { availableLeagues: [], leagueId: null } });
  check('liga sem nome conhecido: usa "Pelada na Mão" em vez de "undefined"', /da liga \*Pelada na Mão\*/.test(w.texto) && !/undefined/.test(w.texto), w.texto);
  check('nunca escreve "undefined" nem "NaN" na mensagem', !/undefined|NaN/.test(msg({}).texto) && !/undefined|NaN/.test(msg({}, 50, '2099-12').texto));

  // ── ligações no resto do app (o que não dá para rodar sem navegador) ───────────────────────────
  check('Meu Craque: o botão vem logo abaixo do subtítulo, NÃO aparece na simulação do admin ("Ver como") e usa o mês corrente', /\$\{subtitle\}<\/div>\s*\$\{isSimulating \? '' : pixButton\(myName, curMonth, 'pill'\)\}\s*\$\{st\._mjCard \?/.test(html), html.match(/\$\{subtitle\}[\s\S]{0,200}/)?.[0]);
  check('Financeiro: o botão pequeno aparece só na linha do próprio jogador (isMe), no mês que a tela mostra', /const isMe = st\.userDoc\?\.playerKey === playerKey\(p\.name\);\s*const pixBtn = isMe \? pixButton\(p\.name, month, 'row'\) : '';/.test(html), html.match(/const isMe[\s\S]{0,160}/)?.[0]);
  check('…e fica EMBAIXO do nome (não como mais um item da linha: no celular de 375 px a linha do admin com churrasco separado já está no limite e o botão ficava cortado)', /\$\{esc\(p\.name\)\}[^\n]*\$\{pixBtn \? `<span style="display:block;margin-top:6px">\$\{pixBtn\}<\/span>` : ''\}\s*<\/span>/.test(html) && !/\$\{waPayBtn\}\s*\$\{pixBtn\}/.test(html), html.match(/\$\{esc\(p\.name\)\}[^\n]{0,200}/)?.[0]);
  check('a janela de pagamento está na lista de janelas desenhadas', /\+mSubscription\(\)\+mPixPay\(\);/.test(html));
  check('configuração do financeiro: o tipo da chave é lido do banco, tem valor inicial e vai na janela ⚙️', /chavePixTipo: data\.chavePixTipo \?\? '',/.test(html) && /vencimentoDia: 10, chavePix: '', chavePixTipo: ''\}/.test(html) && /chavePix:st\.finCfg\?\.chavePix\|\|'',chavePixTipo:st\.finCfg\?\.chavePixTipo\|\|''\};render\(\)/.test(html) && /vencimentoDia: 0, chavePix: '', chavePixTipo: '',/.test(html));
  const usados = [...pixCode.matchAll(/trackEvent\('(\w+)'/g)].map(m => m[1]);
  check('os contadores usados no PIX existem na lista do servidor (senão o servidor recusaria e o painel nunca veria)', usados.length === 2 && usados.every(n => funnel.EVENT_NAMES_CLIENT.includes(n)), usados);

  // ── privacidade e "não somos intermediário" ─────────────────────────────────────────────────────
  // (a palavra "WhatsApp" aparece num texto da tela do admin; o que não pode existir é LER contato ou dado da conta)
  const lePessoa = /st\.contacts|waOf\(|waOfAvulso|authUser|userDoc|\.uid\b|displayName|\.whatsapp\b|\.phone\b|st\.users/;
  check('PRIVACIDADE: o código do PIX não lê WhatsApp, e-mail, contatos nem dados da conta logada (só nome do jogador e valores)', !lePessoa.test(pixCode) && ['const w = st.contacts[p.id];', 'waOf(p)', 'st.authUser.email', 'st.userDoc.email', 'x.whatsapp', 'u.uid'].every(amostra => lePessoa.test(amostra)), pixCode.match(/.{20}(st\.contacts|waOf\(|authUser|userDoc|\.uid\b|displayName|\.whatsapp\b).{20}/)?.[0]);
  check('NADA vai para o servidor: o bloco do PIX não chama banco, funções nem rede (só o contador anônimo trackEvent)', !/\bfetch\(|callFn|XMLHttpRequest|\bDB\.|ldoc\(|\bcol\(|firebase\.|\.add\(|\.set\(|\.update\(|sendBeacon|WebSocket/.test(pixCode), pixCode.match(/.{20}(fetch\(|callFn|XMLHttpRequest|DB\.|ldoc\(|col\(|firebase\.|\.add\(|\.set\(|\.update\(|sendBeacon).{20}/)?.[0]);
  check('a política de privacidade do app cita a chave PIX do admin no Financeiro', /<strong>Financeiro:<\/strong> mensalidades, cobranças avulsas e a chave PIX que o admin cadastrar para receber/.test(html));
  check('o app só escreve o código: não existe marcação automática de pago a partir do PIX', !/pixCopy[\s\S]{0,300}togglePagamento/.test(pixCode) && !/togglePagamento|financeiro_mensalidades/.test(pixCode));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})();
