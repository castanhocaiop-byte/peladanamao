// Testa o código do app (index.html) que cuida de encerrar a liga, isolado: extrai as funções reais
// do arquivo e as executa num ambiente simulado, sem navegador.
//  - canCloseLeague: quem vê o botão "Encerrar esta liga";
//  - openCloseLeague / confirmCloseLeague: o modal e a chamada ao servidor;
//  - leaveLeague: sair da liga (o único admin é barrado pelo servidor);
//  - checkLeagueStillMine: o que acontece com quem perde a liga com o app aberto.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const escCode = html.match(/const esc = s => [^\n]+/)[0];
const code = [
  escCode,
  slice('function isAdmin()', 'function isLeagueFree()'),
  slice('// Tira a liga da memória do app', 'async function renameLeague'),
  slice('let _closeLg = { busy: false };', 'async function sendMagicLink'),
].join('\n');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

const OWNER_EMAIL = 'castanho.caiop@gmail.com';

function makeEnv({ role = 'admin', uid = 'u1', ownerId = 'u1', authExtra = {}, userDoc, leagues } = {}) {
  const calls = { callFn: [], toast: [], render: 0, confirm: [], alert: [], unsub: 0, userReads: 0 };
  const dom = {};   // id -> elemento falso
  const el = (id, extra = {}) => (dom[id] = { id, value: '', disabled: false, style: {}, textContent: '', remove() { delete dom[id]; }, focus() {}, ...extra });
  const env = {
    st: {
      authUser: { uid, email: uid + '@x.com', emailVerified: false, ...authExtra },
      userRole: role,
      leagueId: 'L',
      modal: { type: 'adminPanel' },
      userDoc: { leagues: { L: { role }, B: { role: 'player' } } },
      availableLeagues: leagues || [{ id: 'L', name: 'Liga L', role, ownerId }, { id: 'B', name: 'Liga B', role: 'player', ownerId: 'x' }],
      champs: [1], ranks: [1], players: [1], finMens: { a: 1 }, finDesp: [1], finAvulsos: [1],
    },
    DB: { doc: () => ({ get: async () => { calls.userReads++; if (env.userDocError) throw new Error('offline'); return userDoc === undefined ? { exists: true, data: () => env.userDocData() } : { exists: !!userDoc, data: () => userDoc }; } }) },
    userDocData: () => ({ leagues: { L: { role } } }),
    userDocError: false,
    toast: (m, t) => calls.toast.push({ m, t }),
    render: () => { calls.render++; },
    callFn: async (name, data) => { calls.callFn.push({ name, data }); return env.respond(name, data); },
    respond: () => ({ ok: true }),
    document: {
      getElementById: id => dom[id] || null,
      createElement: () => ({ style: {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } }),
      body: { appendChild: e => { dom[e.id] = e; } },
    },
    confirm: m => { calls.confirm.push(m); return env.confirmAnswer; },
    confirmAnswer: true,
    alert: m => calls.alert.push(m),
    _unsubListeners: [() => { calls.unsub++; }],
  };
  const names = ['st', 'DB', 'toast', 'render', 'callFn', 'document', 'confirm', 'alert', '_unsubListeners'];
  const api = new Function(...names, code + `
    return { canCloseLeague, forgetLeagueLocally, checkLeagueStillMine, leaveLeague, openCloseLeague, closeCloseLeague, confirmCloseLeague,
             get closeLg() { return _closeLg; }, set closeLg(v) { _closeLg = v; }, esc };`)(...names.map(n => env[n]));
  return { api, env, calls, dom, el };
}

(async () => {
  // ───────── canCloseLeague: quem vê o botão ─────────
  let t = makeEnv({ role: 'admin', uid: 'u1', ownerId: 'u1' });
  check('o criador (admin) vê o botão', t.api.canCloseLeague() === true);
  t = makeEnv({ role: 'admin', uid: 'u2', ownerId: 'u1' });
  check('admin que NÃO criou a liga não vê o botão', t.api.canCloseLeague() === false);
  t = makeEnv({ role: 'admin', uid: 'u2', ownerId: null });
  check('liga antiga, sem criador registrado: qualquer admin vê', t.api.canCloseLeague() === true);
  t = makeEnv({ role: 'player', uid: 'u1', ownerId: 'u1' });
  check('jogador não vê o botão, mesmo se o id bater', t.api.canCloseLeague() === false);
  t = makeEnv({ role: 'admin', uid: 'u2', ownerId: 'u1', authExtra: { email: OWNER_EMAIL, emailVerified: true } });
  check('dono do sistema (e-mail verificado) vê em qualquer liga', t.api.canCloseLeague() === true);
  t = makeEnv({ role: 'admin', uid: 'u2', ownerId: 'u1', authExtra: { email: OWNER_EMAIL, emailVerified: false } });
  check('e-mail do dono SEM verificação não vale', t.api.canCloseLeague() === false);
  t = makeEnv({ role: 'pending', uid: 'u1', ownerId: 'u1' });
  check('pendente não vê o botão', t.api.canCloseLeague() === false);

  // ───────── openCloseLeague: o modal ─────────
  t = makeEnv({ role: 'admin', uid: 'u1', ownerId: 'u1' });
  t.api.openCloseLeague();
  let root = t.dom['closelg-root'];
  check('abre o modal com o nome da liga e a palavra de confirmação', !!root && /Encerrar a liga “Liga L”/.test(root.innerHTML) && /Digite ENCERRAR/i.test(root.innerHTML), root && root.innerHTML.slice(0, 300));
  check('botão de confirmar nasce desabilitado', /id="closelg-go"[^>]*disabled/.test(root.innerHTML));
  check('liga sem plano pago: não fala de plano nem de assinatura', !/Plano pago/.test(root.innerHTML));
  check('explica que apaga tudo e que não tem volta', /de forma definitiva/.test(root.innerHTML) && /Não tem volta/.test(root.innerHTML) && /vínculo de todos os membros/.test(root.innerHTML));

  const future = new Date(Date.now() + 40 * 86400000).toISOString();
  t = makeEnv({ role: 'admin', uid: 'u1', leagues: [{ id: 'L', name: 'Liga L', role: 'admin', ownerId: 'u1', subscriptionActiveUntil: future }] });
  t.api.openCloseLeague();
  check('liga com plano pago ativo: avisa que a assinatura é cancelada e que não há reembolso', /Plano pago/.test(t.dom['closelg-root'].innerHTML) && /cancelada junto/.test(t.dom['closelg-root'].innerHTML) && /Não há reembolso/.test(t.dom['closelg-root'].innerHTML));
  t = makeEnv({ role: 'admin', uid: 'u1', leagues: [{ id: 'L', name: 'Liga L', role: 'admin', ownerId: 'u1', subscriptionActiveUntil: new Date(Date.now() - 86400000).toISOString() }] });
  t.api.openCloseLeague();
  check('plano pago já vencido: não mostra o aviso', !/Plano pago/.test(t.dom['closelg-root'].innerHTML));

  t = makeEnv({ role: 'admin', uid: 'u1', leagues: [{ id: 'L', name: '<img src=x onerror=alert(1)> & "aspas"', role: 'admin', ownerId: 'u1' }] });
  t.api.openCloseLeague();
  check('nome da liga com HTML é escapado (nada de tag solta no modal)', !/<img/i.test(t.dom['closelg-root'].innerHTML) && /&lt;img/.test(t.dom['closelg-root'].innerHTML), t.dom['closelg-root'].innerHTML.slice(0, 200));

  t = makeEnv({ role: 'admin', uid: 'u2', ownerId: 'u1' });
  t.api.openCloseLeague();
  check('quem não pode encerrar não consegue abrir o modal nem pelo console', !t.dom['closelg-root']);

  // ───────── confirmCloseLeague ─────────
  const openedModal = ({ typed = 'ENCERRAR', ...opts } = {}) => {
    const x = makeEnv({ role: 'admin', uid: 'u1', ownerId: 'u1', ...opts });
    x.el('closelg-root');
    x.el('closelg-confirm', { value: typed });
    x.el('closelg-err');
    x.el('closelg-go');
    return x;
  };

  t = openedModal({ typed: 'encerra' });
  await t.api.confirmCloseLeague();
  check('confirmação incompleta: nada acontece', t.calls.callFn.length === 0 && !!t.dom['closelg-root'] && t.calls.toast.length === 0);

  t = openedModal({ typed: '' });
  await t.api.confirmCloseLeague();
  check('campo vazio: nada acontece', t.calls.callFn.length === 0);

  t = openedModal({ typed: '  encerrar  ' });
  await t.api.confirmCloseLeague();
  check('palavra certa (sem diferenciar maiúsculas nem espaços): chama deleteLeague com a liga e a confirmação', t.calls.callFn.length === 1 && t.calls.callFn[0].name === 'deleteLeague' && t.calls.callFn[0].data.liga === 'L' && t.calls.callFn[0].data.confirm === true, t.calls.callFn);
  check('sucesso: a liga some do app (lista, vínculo e dados em memória)', !t.env.st.availableLeagues.some(l => l.id === 'L') && !t.env.st.userDoc.leagues.L && t.env.st.leagueId === null && t.env.st.userRole === null && t.env.st.champs.length === 0 && t.env.st.finAvulsos.length === 0, t.env.st);
  check('sucesso: as outras ligas continuam', t.env.st.availableLeagues.length === 1 && t.env.st.availableLeagues[0].id === 'B' && !!t.env.st.userDoc.leagues.B);
  check('sucesso: para de escutar a liga, fecha o modal e o painel e redesenha', t.calls.unsub === 1 && !t.dom['closelg-root'] && t.env.st.modal === null && t.calls.render === 1);
  check('sucesso: um único aviso, positivo, com o nome da liga', t.calls.toast.length === 1 && t.calls.toast[0].t === 'ok' && /Liga L/.test(t.calls.toast[0].m) && /encerrada/.test(t.calls.toast[0].m), t.calls.toast);
  check('sucesso: libera o estado de ocupado', t.api.closeLg.busy === false);

  // erro do servidor: continua tudo como estava, com a mensagem no próprio modal
  t = openedModal();
  t.env.respond = () => { const e = new Error('Não foi possível conferir a assinatura da liga no Mercado Pago agora. Nada foi apagado — tente de novo em alguns minutos.'); e.code = 'failed-precondition'; throw e; };
  await t.api.confirmCloseLeague();
  check('erro do servidor: mostra a mensagem no modal', /Nada foi apagado/.test(t.dom['closelg-err'].textContent), t.dom['closelg-err'].textContent);
  check('erro do servidor: a liga continua no app e o modal continua aberto', t.env.st.availableLeagues.some(l => l.id === 'L') && t.env.st.leagueId === 'L' && !!t.dom['closelg-root'] && t.calls.toast.length === 0);
  check('erro do servidor: libera o botão para tentar de novo', t.api.closeLg.busy === false && t.dom['closelg-go'].disabled === false);
  t.env.respond = () => ({ ok: true });
  await t.api.confirmCloseLeague();
  check('…e tentar de novo funciona', !t.env.st.availableLeagues.some(l => l.id === 'L') && t.calls.callFn.length === 2);

  t = openedModal();
  t.env.respond = () => { throw new Error(''); };
  await t.api.confirmCloseLeague();
  check('erro sem mensagem: texto padrão no modal', /Tente de novo/.test(t.dom['closelg-err'].textContent), t.dom['closelg-err'].textContent);

  // "não encontrada" = já foi encerrada (a resposta anterior se perdeu): segue como sucesso
  t = openedModal();
  t.env.respond = () => { const e = new Error('Liga não encontrada.'); e.code = 'not-found'; throw e; };
  await t.api.confirmCloseLeague();
  check('liga já encerrada (não encontrada): trata como sucesso', !t.env.st.availableLeagues.some(l => l.id === 'L') && t.env.st.leagueId === null && !t.dom['closelg-root'] && t.calls.toast.length === 1 && t.calls.toast[0].t === 'ok');

  // duplo clique: uma chamada só
  t = openedModal();
  let release;
  t.env.respond = () => new Promise(r => { release = r; });
  const first = t.api.confirmCloseLeague();
  const second = t.api.confirmCloseLeague();
  check('clique repetido enquanto encerra é ignorado', t.calls.callFn.length === 1 && t.api.closeLg.busy === true);
  check('enquanto encerra, o botão mostra o andamento e o modal não fecha por fora', t.dom['closelg-go'].textContent === 'Encerrando…' && (t.api.closeCloseLeague(), !!t.dom['closelg-root']));
  release({ ok: true });
  await first; await second;
  check('depois de concluir, tudo certo e uma chamada só', t.calls.callFn.length === 1 && !t.env.st.availableLeagues.some(l => l.id === 'L'));

  // ───────── checkLeagueStillMine: quem perde a liga com o app aberto ─────────
  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: { leagues: { L: { role: 'player' } } } });
  await t.api.checkLeagueStillMine();
  check('ainda é membro: não faz nada', t.env.st.leagueId === 'L' && t.calls.toast.length === 0 && t.calls.render === 0 && t.env.st.availableLeagues.length === 2);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: { leagues: { B: { role: 'player' } } } });
  await t.api.checkLeagueStillMine();
  check('liga encerrada (o vínculo sumiu do cadastro): volta para a lista e avisa com o nome da liga', t.env.st.leagueId === null && !t.env.st.availableLeagues.some(l => l.id === 'L') && t.calls.toast.length === 1 && /Liga L/.test(t.calls.toast[0].m) && /encerrada/.test(t.calls.toast[0].m) && t.calls.render === 1, t.calls.toast);
  check('…para de escutar a liga e fecha qualquer modal aberto', t.calls.unsub === 1 && t.env.st.modal === null && t.env.st.champs.length === 0);
  check('…e mantém as outras ligas', t.env.st.availableLeagues.length === 1 && t.env.st.availableLeagues[0].id === 'B');

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: null });
  await t.api.checkLeagueStillMine();
  check('cadastro que já não existe: também sai da liga', t.env.st.leagueId === null && t.calls.toast.length === 1);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: { leagues: {} } });
  t.api.closeLg = { busy: true };
  await t.api.checkLeagueStillMine();
  check('quem está encerrando a liga não recebe o aviso duplicado (nem consulta o cadastro)', t.calls.toast.length === 0 && t.env.st.leagueId === 'L' && t.calls.userReads === 0);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: { leagues: {} } });
  t.env.userDocError = true;
  await t.api.checkLeagueStillMine();
  check('sem conexão ao conferir: não mexe em nada', t.env.st.leagueId === 'L' && t.calls.toast.length === 0);
  t.env.userDocError = false;
  await t.api.checkLeagueStillMine();
  check('…e na próxima tentativa funciona (não ficou travado)', t.env.st.leagueId === null && t.calls.toast.length === 1);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: { leagues: {} } });
  await Promise.all([t.api.checkLeagueStillMine(), t.api.checkLeagueStillMine(), t.api.checkLeagueStillMine()]);
  check('vários erros de ouvinte ao mesmo tempo: confere e avisa uma vez só', t.calls.userReads === 1 && t.calls.toast.length === 1);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x', userDoc: { leagues: {} } });
  t.env.st.leagueId = null;
  await t.api.checkLeagueStillMine();
  check('já está na lista de ligas (sem liga aberta): nada a conferir', t.calls.userReads === 0 && t.calls.toast.length === 0);

  // a pessoa troca de liga enquanto o cadastro é lido: não derruba a liga nova
  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x' });
  t.env.DB.doc = () => ({ get: async () => { t.env.st.leagueId = 'B'; return { exists: true, data: () => ({ leagues: {} }) }; } });
  await t.api.checkLeagueStillMine();
  check('trocou de liga durante a conferência: não mexe na liga nova', t.env.st.leagueId === 'B' && t.calls.toast.length === 0 && t.env.st.availableLeagues.length === 2);

  // ───────── leaveLeague ─────────
  t = makeEnv({ role: 'admin', uid: 'u1', ownerId: 'u1' });
  t.env.confirmAnswer = false;
  await t.api.leaveLeague('L');
  check('sair: cancelar a confirmação não chama o servidor', t.calls.callFn.length === 0 && t.env.st.availableLeagues.some(l => l.id === 'L'));
  check('sair: a confirmação do admin explica a regra do único admin', /único admin/.test(t.calls.confirm[0]) && /encerrar a liga/.test(t.calls.confirm[0]), t.calls.confirm);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x' });
  t.env.st.availableLeagues[0].role = 'player';
  await t.api.leaveLeague('L');
  check('sair (jogador): chama leaveLeague e tira a liga do app', t.calls.callFn[0].name === 'leaveLeague' && t.calls.callFn[0].data.liga === 'L' && !t.env.st.availableLeagues.some(l => l.id === 'L') && t.env.st.leagueId === null && t.calls.toast[0].m === 'Você saiu da liga.', t.calls.toast);
  check('sair (jogador): a confirmação de jogador não fala de admin', !/admin/.test(t.calls.confirm[0]), t.calls.confirm);

  t = makeEnv({ role: 'admin', uid: 'u1', ownerId: 'u1' });
  t.env.respond = () => { const e = new Error('Você é o único admin de Liga L. Promova outro admin ou encerre a liga antes de sair.'); e.code = 'failed-precondition'; e.reason = 'last-admin'; throw e; };
  await t.api.leaveLeague('L');
  check('único admin: o servidor barra e o app mostra a mensagem completa com o caminho para encerrar', t.calls.alert.length === 1 && /único admin de Liga L/.test(t.calls.alert[0]) && /Painel Admin → Encerrar esta liga/.test(t.calls.alert[0]), t.calls.alert);
  check('único admin barrado: continua na liga, sem aviso de "saiu"', t.env.st.availableLeagues.some(l => l.id === 'L') && !!t.env.st.userDoc.leagues.L && t.calls.toast.length === 0);

  t = makeEnv({ role: 'player', uid: 'u9', ownerId: 'x' });
  t.env.respond = () => { throw new Error('Sem conexão'); };
  await t.api.leaveLeague('L');
  check('outro erro ao sair: aviso curto e a liga continua', t.calls.alert.length === 0 && /Erro ao sair da liga: Sem conexão/.test(t.calls.toast[0].m) && t.env.st.availableLeagues.some(l => l.id === 'L'), t.calls.toast);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
