// "Cobrar no grupo" no Financeiro (index.html + manual.html + ci.yml). Só a MENSALIDADE: o churrasco é facultativo e não entra na mensagem (decisão do dono, 17/11/2026).
// Pedido do dono em 17/11/2026: criar uma mensagem com os jogadores que ainda não pagaram e mandar no grupo
// do WhatsApp (hoje só existe a cobrança individual, o botão 💬 de cada jogador, e a notificação aos inadimplentes). O botão "💬 Cobrar no grupo" (só admin) monta UMA mensagem com os
// nomes de quem deve o mês aberto no Financeiro, escritos com "@", o valor, se vence ou está em atraso, a chave PIX e o convite para pagar pelo app; abre numa janela editável com
// "Copiar" e "WhatsApp". O WhatsApp não deixa um link marcar a pessoa de verdade: o "@" é texto. Este teste extrai o código real do index.html e o executa num ambiente simulado.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const manual = read('manual.html');
const ci = read('.github', 'workflows', 'ci.yml');
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
function one(re) {
  const m = html.match(re);
  if (!m) throw new Error('trecho não encontrado no index.html: ' + re);
  return m[0];
}

const code = [
  slice('const esc = s =>', 'function toast('),
  one(/^function isAdmin\(\) \{.*\}$/m),
  slice('function getPaid(pagamentos, playerName, type) {', 'function getPaidDate'),
  slice('/* ── PIX copia e cola', '/* ── fim do PIX copia e cola'),
  slice('function waMensalidadeLink(', '/* ── fim do Cobrar no grupo'),     // a cobrança individual e a do grupo
].join('\n');

// ── o aplicativo falso ───────────────────────────────────────────────────────────────────────────
const PIX_EMAIL = 'pelada@exemplo.com.br';
const PLAYERS = () => [
  { name: 'Ana' }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Dudu', somenteChurrasco: true }, { name: 'Eva', active: false }, { name: 'Zé *Bola*' }, { name: 'Álvaro' },
];
function makeEnv({ admin = true, mes = '2020-01', liga = 'Liga Aceoma', cfg = {}, appCfg = {}, players = PLAYERS(), pagamentos = { Ana: { mensalidade: true } }, clip = 'ok', origin = 'https://peladanamao.com.br' } = {}) {
  const calls = { toasts: [], renders: 0, opened: [], clips: [] };
  const st = {
    leagueId: 'L1', availableLeagues: [{ id: 'L1', name: liga }], userRole: admin ? 'admin' : 'player', finMonth: mes, modal: null,
    finCfg: { valorMensalidade: 30, valorChurrasco: 0, valorSomenteChurrasco: 0, vencimentoDia: 10, chavePix: PIX_EMAIL, chavePixTipo: 'email', ...cfg },
    appCfg: { hasChurrasco: false, churrascoSeparado: false, ...appCfg },
    finMens: { [mes]: { pagamentos } }, players, contacts: {},
  };
  const env = {
    st, location: { origin },
    toast: (m, t = 'err') => calls.toasts.push([m, t]), render: () => { calls.renders++; },
    window: { open: (u, alvo) => calls.opened.push([u, alvo]) },
    navigator: { clipboard: { writeText: async t => { if (clip === 'reject') throw new Error('negado'); calls.clips.push(t); } } },
    document: { getElementById: () => null }, trackEvent: () => {}, ldoc: () => ({ set: async () => {} }), DB: {}, playerKey: n => String(n).trim().toLowerCase(),
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { cobrancaGrupoMsg, openCobrancaGrupo, copyCobrancaGrupo, openWhatsAppCobrancaGrupo, mFinCobrancaGrupo, waMensalidadeLink, pixDue };')(...names.map(n => env[n]));
  return { api, st, calls };
}
const tick = () => new Promise(r => setTimeout(r, 10));
const linhas = s => s.split('\n');
const individual = (E, mes, nome = 'Bruno') => new URL(E.api.waMensalidadeLink('11999990000', nome, E.st.finCfg.valorMensalidade, mes)).searchParams.get('text');

(async () => {
  // ══ 1. A MENSAGEM: SÓ MENSALIDADE, MÊS JÁ VENCIDO ═════════════════════════════════════════════════
  {
    const E = makeEnv();
    const msg = E.api.cobrancaGrupoMsg('2020-01');
    const esperado = [
      '⚽ *Liga Aceoma* — pendências de janeiro de 2020',
      '',
      '💵 *Mensalidade* · R$ 30,00 · *em atraso*',
      '• @Álvaro', '• @Bruno', '• @Carla', '• @Zé Bola',
      '',
      '🔑 Chave PIX: pelada@exemplo.com.br',
      '',
      '💸 Prefere o PIX copia e cola, com o valor já preenchido? Toque em "Pagar com PIX" no app: https://peladanamao.com.br',
    ].join('\n');
    check('mês vencido, só mensalidade: o texto inteiro (título com o nome da liga e o mês por extenso, valor, "em atraso", os nomes com @, chave PIX e o convite do app)', msg === esperado, msg);
    check('quem entra: só jogador ATIVO que NÃO pagou e paga mensalidade (fora: Ana que pagou, Eva inativa e Dudu "só churrasco")', !/Ana|Eva|Dudu/.test(msg) && /@Bruno/.test(msg) && /@Carla/.test(msg), msg);
    check('os nomes saem em ordem alfabética do português (Álvaro antes de Bruno; acento não conta) e o asterisco do nome some (o * é o negrito do WhatsApp)', linhas(msg).filter(l => l.startsWith('• @')).join() === '• @Álvaro,• @Bruno,• @Carla,• @Zé Bola', msg);
    check('montar a mensagem não muda a ordem da lista de jogadores do app (st.players)', E.st.players.map(p => p.name).join() === 'Ana,Bruno,Carla,Dudu,Eva,Zé *Bola*,Álvaro', E.st.players.map(p => p.name));
    check('o nome do jogador sem pendência (Ana) e o telefone nunca aparecem, e nenhum número com 8 ou mais dígitos entra na mensagem (a chave PIX deste teste é um e-mail)', !/\d{8,}/.test(msg), msg);
  }
  {
    // mês que ainda vai vencer
    const E = makeEnv({ mes: '2099-01' });
    const msg = E.api.cobrancaGrupoMsg('2099-01');
    check('mês que ainda não venceu: "vence em *10/01/2099*" em vez de "em atraso"', msg.includes('💵 *Mensalidade* · R$ 30,00 · vence em *10/01/2099*') && !msg.includes('em atraso'), msg);
    const E5 = makeEnv({ mes: '2099-03', cfg: { vencimentoDia: 5 } });
    check('o dia do vencimento é o configurado na liga (dia 5: 05/03/2099)', E5.api.cobrancaGrupoMsg('2099-03').includes('vence em *05/03/2099*'));
    const Ed = makeEnv({ mes: '2099-03', cfg: { vencimentoDia: undefined } });
    check('sem dia de vencimento configurado vale o dia 10, como na cobrança individual', Ed.api.cobrancaGrupoMsg('2099-03').includes('vence em *10/03/2099*'));
  }
  {
    // o tom e as datas são os MESMOS da cobrança individual (botão 💬 de cada jogador)
    let igual = true; const detalhe = [];
    const agora = new Date(), mesAgora = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    for (const [mes, dia] of [['2020-01', 10], ['2099-01', 10], ['2099-03', 5], ['2099-12', 31], ['2020-06', 0], ['2099-06', 0], ['2099-02', undefined], [mesAgora, agora.getDate()]]) {
      const E = makeEnv({ mes, cfg: { vencimentoDia: dia } });
      const g = E.api.cobrancaGrupoMsg(mes), i = individual(E, mes);
      const grupoAtraso = g.includes('*em atraso*'), indAtraso = i.includes('em atraso');
      const dataG = (g.match(/vence em \*(\d\d\/\d\d\/\d{4})\*/) || [])[1], dataI = (i.match(/vence em \*(\d\d\/\d\d\/\d{4})\*/) || [])[1];
      if (grupoAtraso !== indAtraso || dataG !== dataI) { igual = false; detalhe.push({ mes, dia, grupoAtraso, indAtraso, dataG, dataI }); }
    }
    check('o "em atraso" e a data de vencimento do grupo são os mesmos da cobrança individual em 8 combinações de mês e dia (inclusive dia 0, dia 31, sem dia e o vencimento que cai HOJE)', igual, detalhe);
  }

  // ══ 2. O CHURRASCO NÃO ENTRA (É FACULTATIVO) E A MENSALIDADE ZERADA ═════════════════════════════════
  {
    const E = makeEnv({
      appCfg: { hasChurrasco: true, churrascoSeparado: true }, cfg: { valorChurrasco: 25, valorSomenteChurrasco: 20 },
      players: [{ name: 'Ana' }, { name: 'Aline', somenteChurrasco: true }, { name: 'Bruno' }, { name: 'Carla' }, { name: 'Dudu', somenteChurrasco: true }, { name: 'Eva', somenteChurrasco: true }, { name: 'Fábio' }],
      pagamentos: { Ana: { mensalidade: true, churrasco: true }, Carla: { churrasco: true }, Eva: { churrasco: true }, 'Fábio': { mensalidade: true } },
    });
    const msg = E.api.cobrancaGrupoMsg('2020-01');
    const esperado = ['⚽ *Liga Aceoma* — pendências de janeiro de 2020', '', '💵 *Mensalidade* · R$ 30,00 · *em atraso*', '• @Bruno', '• @Carla', '', '🔑 Chave PIX: pelada@exemplo.com.br', '',
      '💸 Prefere o PIX copia e cola, com o valor já preenchido? Toque em "Pagar com PIX" no app: https://peladanamao.com.br'].join('\n');
    check('com churrasco cobrado à parte e pendente (R$ 25,00 e R$ 20,00 de quem é só churrasco): a mensagem só tem a MENSALIDADE (Bruno e Carla), sem bloco de churrasco', msg === esperado, msg);
    check('o churrasco é facultativo e não entra: nenhuma palavra "Churrasco", nenhum 🍖 e nenhum valor de churrasco (R$ 25,00 ou R$ 20,00) na mensagem', !/Churrasco|churrasco|🍖|25,00|20,00/.test(msg), msg);
    check('quem só deve o churrasco não é listado: Fábio (mensalidade paga, churrasco pendente) e Aline e Dudu (só churrasco, pendentes)', !/Fábio|Aline|Dudu/.test(msg), msg);
    const soChurr = makeEnv({ appCfg: { hasChurrasco: true, churrascoSeparado: true }, cfg: { valorChurrasco: 25 }, players: [{ name: 'Ana' }, { name: 'Bruno' }], pagamentos: { Ana: { mensalidade: true, churrasco: true }, Bruno: { mensalidade: true } } });
    check('todos pagaram a mensalidade e falta só o churrasco: não há mensagem (o churrasco não se cobra no grupo)', soChurr.api.cobrancaGrupoMsg('2020-01') === '');
    soChurr.api.openCobrancaGrupo();
    check('...e o botão avisa "Todos já pagaram janeiro de 2020 🎉" em verde, sem abrir a janela', soChurr.st.modal === null && JSON.stringify(soChurr.calls.toasts) === JSON.stringify([['Todos já pagaram janeiro de 2020 🎉', 'ok']]), soChurr.calls.toasts);
    const semChurr = makeEnv({ appCfg: { hasChurrasco: true, churrascoSeparado: false }, cfg: { valorChurrasco: 25 } });
    check('churrasco que NÃO é cobrado à parte: a mensagem é a mesma de uma liga sem churrasco', semChurr.api.cobrancaGrupoMsg('2020-01') === makeEnv().api.cobrancaGrupoMsg('2020-01'));
    const mens0 = makeEnv({ cfg: { valorMensalidade: 0 }, appCfg: { hasChurrasco: true, churrascoSeparado: true } });
    check('liga sem mensalidade (valor zero): ninguém deve mensalidade, nenhuma mensagem (mesmo com churrasco cobrado à parte)', mens0.api.cobrancaGrupoMsg('2020-01') === '');
  }

  // ══ 3. CHAVE PIX, NOME DA LIGA, NINGUÉM DEVENDO ═══════════════════════════════════════════════════
  {
    const sem = makeEnv({ cfg: { chavePix: '' } }).api.cobrancaGrupoMsg('2020-01');
    check('sem chave PIX configurada: não há a linha da chave nem o convite do app', !sem.includes('Chave PIX') && !sem.includes('Pagar com PIX') && sem.includes('• @Bruno'), sem);
    const ruim = makeEnv({ cfg: { chavePix: 'isto não é uma chave', chavePixTipo: '' } }).api.cobrancaGrupoMsg('2020-01');
    check('chave que o app não reconhece: a linha da chave aparece (como na cobrança individual), mas o convite para pagar pelo app não', ruim.includes('🔑 Chave PIX: isto não é uma chave') && !ruim.includes('Pagar com PIX'), ruim);
    check('nome da liga com asterisco ou espaços repetidos é limpo no título', makeEnv({ liga: '  Liga *Top*   Sul ' }).api.cobrancaGrupoMsg('2020-01').startsWith('⚽ *Liga Top Sul* — pendências de'));
    check('liga sem nome: o título usa "Pelada na Mão"', makeEnv({ liga: '' }).api.cobrancaGrupoMsg('2020-01').startsWith('⚽ *Pelada na Mão* — pendências de'));
    const todos = makeEnv({ pagamentos: { Ana: { mensalidade: true }, Bruno: { mensalidade: true }, Carla: { mensalidade: true }, 'Zé *Bola*': { mensalidade: true }, 'Álvaro': { mensalidade: true } } });
    check('todos pagaram: a mensagem é vazia', todos.api.cobrancaGrupoMsg('2020-01') === '');
    const aberto = makeEnv({ mes: '2020-01' }).api.cobrancaGrupoMsg('2020-02');
    check('a mensagem usa o mês PEDIDO: com 2020-01 aberto (Ana pagou) e pedindo 2020-02 (ninguém pagou), traz a Ana e "fevereiro de 2020"', aberto.includes('pendências de fevereiro de 2020') && aberto.includes('• @Ana'), aberto);
    const esp = makeEnv({ cfg: { chavePix: `  ${PIX_EMAIL}  ` } }).api.cobrancaGrupoMsg('2020-01');
    check('a chave PIX com espaços nas pontas sai limpa na mensagem', esp.includes(`🔑 Chave PIX: ${PIX_EMAIL}\n`), esp);
    const outroMes = makeEnv({ mes: '2020-02', pagamentos: {} });
    check('o mês é o que está aberto no Financeiro: 2020-02 sem nenhum pagamento lançado deve a mensalidade de fevereiro de 2020', outroMes.api.cobrancaGrupoMsg('2020-02').includes('pendências de fevereiro de 2020') && outroMes.api.cobrancaGrupoMsg('2020-02').includes('• @Ana'));
  }

  // ══ 4. O BOTÃO ABRE A JANELA (só admin) ═════════════════════════════════════════════════════════════
  {
    const E = makeEnv();
    E.api.openCobrancaGrupo();
    check('admin: abre a janela com o texto pronto (type finCobrancaGrupo) e redesenha uma vez', E.st.modal && E.st.modal.type === 'finCobrancaGrupo' && E.st.modal.text === E.api.cobrancaGrupoMsg('2020-01') && E.calls.renders === 1 && E.calls.toasts.length === 0, E.st.modal);
    const P = makeEnv({ admin: false });
    P.api.openCobrancaGrupo();
    check('quem não é admin não abre nada (sem janela, sem aviso, sem redesenhar)', P.st.modal === null && P.calls.toasts.length === 0 && P.calls.renders === 0);
    const T = makeEnv({ pagamentos: { Ana: { mensalidade: true }, Bruno: { mensalidade: true }, Carla: { mensalidade: true }, 'Zé *Bola*': { mensalidade: true }, 'Álvaro': { mensalidade: true } } });
    T.api.openCobrancaGrupo();
    check('todos pagaram: avisa em verde "Todos já pagaram janeiro de 2020 🎉" e não abre a janela', T.st.modal === null && T.calls.renders === 0 && JSON.stringify(T.calls.toasts) === JSON.stringify([['Todos já pagaram janeiro de 2020 🎉', 'ok']]), T.calls.toasts);
  }

  // ══ 5. A JANELA: TEXTO EDITÁVEL, COPIAR E WHATSAPP ═══════════════════════════════════════════════════
  {
    const E = makeEnv({ players: [{ name: 'Ana <b>x</b> & "Cia"' }, { name: 'Bruno' }], pagamentos: {} });
    E.api.openCobrancaGrupo();
    const h = E.api.mFinCobrancaGrupo();
    check('a janela tem a caixa de texto com a mensagem, o aviso sobre o @, e os botões Copiar, WhatsApp e Fechar', /<textarea id="cg-text"/.test(h) && h.includes('Cobrar no grupo') && h.includes('Os nomes vão escritos com @. Para marcar de verdade (a pessoa recebe o aviso), apague o @ do nome e escolha o contato no WhatsApp.') && /<button onclick="copyCobrancaGrupo\(\)"[^>]*>\s*📋 Copiar\s*<\/button>/.test(h) && /<button onclick="openWhatsAppCobrancaGrupo\(\)"[^>]*>\s*💬 WhatsApp\s*<\/button>/.test(h) && /<button onclick="closeModal\(\)"[^>]*>Fechar<\/button>/.test(h), h);
    check('o texto na caixa vai escapado (um nome com < e aspas não vira HTML nem quebra a caixa)', !h.includes('<b>x</b>') && h.includes('Ana &lt;b>x&lt;/b> &amp; &quot;Cia&quot;'), h.slice(h.indexOf('<textarea'), h.indexOf('</textarea>') + 11));
    check('a caixa guarda o que o admin digita no estado da janela (oninput) para o Copiar e o WhatsApp usarem', /<textarea id="cg-text"[^>]*oninput="st\.modal\.text=this\.value"/.test(h));
    const outra = makeEnv(); outra.st.modal = { type: 'champion', text: 'x' };
    check('outra janela aberta (ou nenhuma): nada desenhado', outra.api.mFinCobrancaGrupo() === '' && makeEnv().api.mFinCobrancaGrupo() === '');
  }
  {
    const E = makeEnv();
    E.api.openCobrancaGrupo();
    E.st.modal.text = 'Pessoal, mensalidade em aberto 🙏\n• @Bruno';   // o admin editou a caixa
    E.api.copyCobrancaGrupo(); await tick();
    check('Copiar copia o texto que está na caixa AGORA (o editado) e avisa "Copiado!" em verde', E.calls.clips.length === 1 && E.calls.clips[0] === 'Pessoal, mensalidade em aberto 🙏\n• @Bruno' && JSON.stringify(E.calls.toasts) === JSON.stringify([['Copiado!', 'ok']]), E.calls);
    E.api.openWhatsAppCobrancaGrupo();
    check('WhatsApp abre o link SEM número (o WhatsApp deixa escolher o grupo) com o texto editado, em nova aba', E.calls.opened.length === 1 && E.calls.opened[0][0] === 'https://wa.me/?text=' + encodeURIComponent('Pessoal, mensalidade em aberto 🙏\n• @Bruno') && E.calls.opened[0][1] === '_blank', E.calls.opened);
    check('o link do WhatsApp do grupo não leva nenhum número de telefone no endereço', /^https:\/\/wa\.me\/\?text=/.test(E.calls.opened[0][0]) && !/wa\.me\/\d/.test(E.calls.opened[0][0]));
  }
  {
    const E = makeEnv({ clip: 'reject' });
    E.api.openCobrancaGrupo();
    E.api.copyCobrancaGrupo(); await tick();
    check('se o aparelho recusar a cópia, avisa "Erro ao copiar" em vermelho', JSON.stringify(E.calls.toasts) === JSON.stringify([['Erro ao copiar', 'err']]), E.calls.toasts);
    const V = makeEnv();
    V.api.openCobrancaGrupo(); V.st.modal.text = '   \n  ';
    V.api.copyCobrancaGrupo(); V.api.openWhatsAppCobrancaGrupo(); await tick();
    check('caixa apagada (só espaços): nem copia nem abre o WhatsApp', V.calls.clips.length === 0 && V.calls.opened.length === 0 && V.calls.toasts.length === 0);
    const O = makeEnv(); O.st.modal = { type: 'champion', text: 'x' };
    O.api.copyCobrancaGrupo(); O.api.openWhatsAppCobrancaGrupo(); await tick();
    check('com outra janela aberta, Copiar e WhatsApp do grupo não fazem nada', O.calls.clips.length === 0 && O.calls.opened.length === 0);
  }

  // ══ 6. AS LIGAÇÕES NO APP, O MANUAL E O CI ═══════════════════════════════════════════════════════════
  {
    const bloco = html.slice(html.indexOf('${isAdmin() && mensPayers.length ? `<div style="padding:4px 12px 8px;border-bottom:1px solid var(--border2);display:flex;gap:6px;flex-wrap:wrap">'), html.indexOf('<div style="display:grid;grid-template-columns:${hasChurrSep'));
    check('no Financeiro, ao lado de "🔔 Notificar inadimplentes", o botão "💬 Cobrar no grupo" só aparece para o admin e quando há quem paga mensalidade', bloco.includes('onclick="notifyInadimplentes()"') && bloco.includes('🔔 Notificar inadimplentes') && bloco.includes('onclick="openCobrancaGrupo()"') && bloco.includes('💬 Cobrar no grupo') && bloco.trim().endsWith(": ''}"), bloco);
    check('a janela entra na lista de janelas que o app desenha', /\+mFinConfig\(\)\+mFinCobrancaGrupo\(\)\+mRenamePlayer\(\)\+/.test(html));
    const sec = manual.slice(manual.indexOf('id="cobrar-no-grupo"'), manual.indexOf('id="despesas-recorrentes"'));
    check('manual (seção 12): o subtítulo "Cobrar no grupo" existe, com âncora, ao lado da cobrança individual e da notificação', sec.length > 300 && sec.includes('📣 Cobrar no grupo') && sec.includes('<strong>💬 Cobrar no grupo</strong>') && sec.includes('<strong>🔔 Notificar inadimplentes</strong>'), sec.slice(0, 200));
    check('manual: explica quem entra na lista (as mesmas regras da lista de contribuições), o @, o valor, o vence em ou em atraso, a chave PIX e que nenhum telefone vai na mensagem', sec.includes('mesmas regras da lista de contribuições') && sec.includes('<strong>@</strong>') && sec.includes('<strong>em atraso</strong>') && sec.includes('chave PIX') && sec.includes('Nenhum telefone vai na mensagem'));
    check('manual: diz que dá para editar o texto, que Copiar e WhatsApp existem e que o WhatsApp abre para escolher o grupo; e que se todos pagaram o app só avisa', sec.includes('editar o texto') && sec.includes('<strong>📋 Copiar</strong>') && sec.includes('<strong>💬 WhatsApp</strong>') && sec.includes('escolher o grupo') && sec.includes('Se todos já pagaram a mensalidade, o app avisa e não abre a janela'));
    check('manual: diz que o churrasco NÃO entra na mensagem porque é facultativo (e que quem é Só Churrasco não aparece) e não promete bloco de churrasco', sec.includes('O <strong>churrasco não entra</strong> na mensagem, porque é facultativo') && sec.includes('quem é <em>Só Churrasco</em> não paga mensalidade e não aparece') && !sec.includes('bloco próprio') && !sec.includes('um bloco para cada valor'), sec.slice(0, 900));
    check('manual: avisa que o @ é só texto (o WhatsApp só marca de verdade se a pessoa for escolhida dentro dele) e aponta a notificação como o jeito de avisar cada um', sec.includes('O @ é só texto') && sec.includes('só vale quando você escolhe o contato dentro do WhatsApp') && sec.includes('Para avisar cada pessoa direto no celular dela, use <strong>🔔 Notificar inadimplentes</strong>'));
    check('CI: o teste está nos passos do job test', /node test\/client-group-charge-test\.js/.test(ci));
  }

  console.log(fails ? `\n${fails} verificação(ões) FALHARAM` : '\nTodas as verificações passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERRO no teste:', e && e.stack || e); process.exit(1); });
