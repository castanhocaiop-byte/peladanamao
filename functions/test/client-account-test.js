// Testa o código do app (index.html) da tela "✉️ Minha conta" (trocar o e-mail do login e a senha), isolado: extrai as funções reais do arquivo
// e as executa num ambiente simulado, sem navegador.
//  - accountSignIn / emailChangeProblem / passwordChangeProblem / accountErrMsg: como a pessoa entra, as conferências dos campos e as mensagens;
//  - openMyAccount / myAccountHtml: o que cada pessoa vê (senha, Google, dono do sistema) e que o HTML é escapado;
//  - submitEmailChange: o pedido ao servidor (requestEmailChange), o login recente que o servidor exige, os erros do servidor e os do Firebase (senha);
//  - a tela que confirma a troca (o link do e-mail abre o app): handleEmailChangeOnLoad, applyEmailChange, vEmailChange e o render;
//  - submitPasswordChange: confirmar a senha atual e trocar;
//  - syncAccountEmail: depois da troca, o app pede ao servidor (syncMyEmail) para corrigir a cópia do e-mail no cadastro;
//  - as ligações no app: botão nos rodapés da conta, privacidade, manual e o nome da função do servidor.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8').replace(/\r\n/g, '\n');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const escCode = html.match(/const esc = s => [^\n]+/)[0];
const accountCode = slice("const SUPPORT_EMAIL = ", '/* ── Encerrar a liga');
const code = [escCode, accountCode].join('\n');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// ── ambiente do aplicativo falso ─────────────────────────────────────────────────────────────────
function makeEnv({ providers = ['password'], email = 'ana@x.com', owner = false, loggedIn = true, userDocEmail, search = '' } = {}) {
  const dom = {};   // id -> elemento falso
  const calls = { request: [], reauth: [], token: [], updatePw: [], callFn: [], order: [], check: [], apply: [], signOut: 0, history: [], renders: [] };
  const mkEl = (id, attrs = '') => (dom[id] = { id, value: '', hidden: /\bhidden\b/.test(attrs), disabled: false, style: {}, textContent: '', innerHTML: '', focus() { env.focused.push(id); }, remove() { delete dom[id]; } });
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const user = {
    uid: 'u1', email, providerData: providers.map(providerId => ({ providerId })),
    failRequest: [], failReauth: [], failPw: [],
    getIdToken: async force => { calls.token.push(force); calls.order.push('token'); return 'tok'; },
    reauthenticateWithCredential: async c => { calls.reauth.push(c); calls.order.push('reauth'); const f = user.failReauth.shift(); if (f) fail(f); },
    updatePassword: async p => { calls.updatePw.push(p); const f = user.failPw.shift(); if (f) fail(f); },
  };
  const auth = {   // o Firebase Auth falso: a conta aberta e o que o link da troca de e-mail faz (conferir o código, aplicar e sair)
    currentUser: loggedIn ? user : null,
    info: { data: { email: 'novo@x.com', previousEmail: 'ana@x.com' } },
    failCheck: [], failApply: [], failSignOut: false,
    checkActionCode: async code => { calls.check.push(code); calls.order.push('check'); const f = auth.failCheck.shift(); if (f) fail(f); return auth.info; },
    applyActionCode: async code => { calls.apply.push(code); calls.order.push('apply'); const f = auth.failApply.shift(); if (f) fail(f); },
    signOut: async () => { calls.signOut++; if (auth.failSignOut) fail('auth/internal-error'); auth.currentUser = null; },
  };
  const env = {
    focused: [],
    AUTH: auth,
    firebase: { auth: { EmailAuthProvider: { credential: (e, p) => ({ e, p }) } } },
    location: { origin: 'https://peladanamao.com.br', search, pathname: '/' },
    history: { replaceState: (a, b, url) => calls.history.push(url) },
    render: () => calls.renders.push(JSON.parse(JSON.stringify(env.st._emailChange || null))),
    isSystemOwner: () => owner,
    st: { userDoc: { email: userDocEmail === undefined ? email : userDocEmail }, authUser: { uid: 'u1', email } },
    callFn: async (name, data) => {
      calls.callFn.push({ name, data });
      if (name === 'requestEmailChange') {   // como o callFn do app: o servidor responde ou devolve erro com código, motivo estável e mensagem em português
        calls.request.push(data); calls.order.push('request');
        const f = user.failRequest.shift();
        if (f) throw Object.assign(new Error(f.message || f.code || ''), { code: f.code, reason: f.reason || '' });
      }
      return env.respond(name, data);
    },
    respond: () => ({ ok: true, changed: true }),
    document: {
      getElementById: id => dom[id] || null,
      createElement: () => ({
        style: {}, _kids: [],
        set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
        remove() { delete dom[this.id]; this._kids.forEach(k => delete dom[k]); },
      }),
      body: {
        appendChild(e) {   // cria os campos que aparecem no HTML (input, botão, mensagens), como o navegador faria
          dom[e.id] = e;
          const re = /<(?:input|div|button|label|span)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g;
          let m;
          while ((m = re.exec(e._html || ''))) if (m[2] !== e.id) { mkEl(m[2], m[1] + ' ' + m[3]); e._kids.push(m[2]); }
        },
      },
    },
  };
  const names = ['AUTH', 'firebase', 'document', 'location', 'history', 'render', 'isSystemOwner', 'callFn', 'st'];
  const api = new Function(...names, code + `
    return { accountSignIn, emailChangeProblem, passwordChangeProblem, accountErrMsg, myAccountHtml, openMyAccount, closeMyAccount,
             submitEmailChange, submitPasswordChange, syncAccountEmail, SUPPORT_EMAIL,
             handleEmailChangeOnLoad, applyEmailChange, emailChangeErrMsg, closeEmailChange, vEmailChange,
             get acct() { return _acct; }, set acct(v) { _acct = v; }, get tried() { return _emailSyncTried; }, set tried(v) { _emailSyncTried = v; } };`)(...names.map(n => env[n]));
  return { api, env, calls, dom, user, mkEl };
}
const msgOf = (t, which) => t.dom['acct-' + which + '-msg'];
const textOf = el => (el.textContent || '').trim();
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // ══ 1. FUNÇÕES PURAS ═══════════════════════════════════════════════════════════════════════════
  let t = makeEnv();
  const api = t.api;
  check('e-mail de suporte certo (suporte@, nunca contato@)', api.SUPPORT_EMAIL === 'suporte@peladanamao.com.br' && !/contato@peladanamao/.test(accountCode), api.SUPPORT_EMAIL);

  check('accountSignIn: e-mail e senha (ou link por e-mail) → password', (r => r.password && !r.google && /e-mail e senha ou link por e-mail/.test(r.label))(makeEnv({ providers: ['password'] }).api.accountSignIn()));
  check('accountSignIn: só Google → google, sem password', (r => !r.password && r.google && r.label === 'Google')(makeEnv({ providers: ['google.com'] }).api.accountSignIn()));
  check('accountSignIn: Google e senha → os dois', (r => r.password && r.google && /Google/.test(r.label) && /senha/.test(r.label))(makeEnv({ providers: ['password', 'google.com'] }).api.accountSignIn()));
  check('accountSignIn: sem login ou outro método → sem senha e rótulo "outro método"', (r => !r.password && !r.google && r.label === 'outro método')(makeEnv({ providers: ['phone'] }).api.accountSignIn()) && !makeEnv({ loggedIn: false }).api.accountSignIn().password);

  const ep = api.emailChangeProblem;
  check('e-mail novo: vazio pede para digitar', /Digite o e-mail novo/.test(ep('', 'a@x.com')) && /Digite o e-mail novo/.test(ep('   ', 'a@x.com')) && /Digite o e-mail novo/.test(ep(null, 'a@x.com')));
  check('e-mail novo: sem @, sem domínio, com espaço ou só com o @ é recusado', ['ana', 'ana@', '@x.com', 'ana@x', 'ana @x.com', 'ana@x .com', 'a@@x.com'].every(v => /não parece um e-mail/.test(ep(v, 'z@x.com'))), ['ana', 'ana@x'].map(v => ep(v, 'z@x.com')));
  check('e-mail novo: grande demais (mais de 254) é recusado', /não parece um e-mail/.test(ep('a'.repeat(250) + '@x.com', 'z@x.com')));
  check('e-mail novo: igual ao atual (mesmo com maiúsculas e espaços) é recusado', /já é o seu e-mail/.test(ep('ANA@x.com', 'ana@x.com')) && /já é o seu e-mail/.test(ep('  ana@x.com ', 'ana@x.com')));
  check('e-mail novo: válido passa (devolve vazio)', ep('ana.nova@x.com.br', 'ana@x.com') === '' && ep(' bia+teste@sub.x.com ', 'ana@x.com') === '');

  const pp = api.passwordChangeProblem;
  check('senha: atual vazia, nova curta, grande demais, repetição diferente e igual à atual são recusadas, cada uma com seu motivo', /senha atual/.test(pp('', 'abcdef', 'abcdef')) && /pelo menos 6/.test(pp('x', 'abc', 'abc')) && /pelo menos 6/.test(pp('x', '', '')) && /grande demais/.test(pp('x', 'a'.repeat(129), 'a'.repeat(129))) && /não são iguais/.test(pp('x', 'abcdef', 'abcdeg')) && /diferente da atual/.test(pp('abcdef', 'abcdef', 'abcdef')));
  check('senha: 6 caracteres e repetição igual passam', pp('velha1', 'nova123', 'nova123') === '' && pp('x', 'abcdef', 'abcdef') === '');
  check('senha: 5 caracteres ainda é curta (o limite é 6 exatos)', /pelo menos 6/.test(pp('x', 'abcde', 'abcde')) && pp('x', 'abcdef', 'abcdef') === '');

  const em = api.accountErrMsg;
  check('mensagens de erro: tudo em português e nenhum código técnico aparece', ['app/empty-password', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-email', 'auth/weak-password', 'auth/too-many-requests', 'auth/network-request-failed', 'auth/user-token-expired', 'auth/internal-error', undefined, ''].every(c => { const m = em(c); return /[a-zà-ú]/.test(m) && !/auth\//.test(m) && !/firebase/i.test(m); }));
  check('mensagens de erro: senha errada explica o caso de quem entra pelo link', /Senha incorreta/.test(em('auth/wrong-password')) && /entre de novo pelo link/.test(em('auth/invalid-credential')));
  check('mensagens de erro: sem conexão, muitas tentativas e sessão vencida têm texto próprio', /Sem conexão/.test(em('auth/network-request-failed')) && /Muitas tentativas/.test(em('auth/too-many-requests')) && /sessão acabou/.test(em('auth/user-token-expired')) && em('auth/xyz') === 'Não foi possível concluir agora. Tente de novo.');

  // ══ 2. A TELA ══════════════════════════════════════════════════════════════════════════════════
  t = makeEnv({ providers: ['password'], email: 'ana@x.com' });
  t.api.openMyAccount();
  let root = t.dom['acct-root'];
  check('abre a camada "Minha conta" no corpo da página', !!root && root.className === 'overlay' && /✉️ Minha conta/.test(root.innerHTML), root && root.innerHTML.slice(0, 200));
  check('quem entra com e-mail e senha vê o e-mail atual, como entra e os dois formulários', /ana@x\.com/.test(root.innerHTML) && /e-mail e senha ou link por e-mail/.test(root.innerHTML) && /Trocar o e-mail/.test(root.innerHTML) && /Trocar a senha/.test(root.innerHTML) && !!t.dom['acct-newmail'] && !!t.dom['acct-pw-cur'] && !!t.dom['acct-pw-new'] && !!t.dom['acct-pw-rep'] && !!t.dom['acct-mail-go'] && !!t.dom['acct-pw-go'], root.innerHTML.slice(0, 300));
  check('o campo da senha para confirmar nasce escondido e o foco vai para o e-mail novo', t.dom['acct-pass'].hidden === true && t.env.focused.includes('acct-newmail'));
  check('explica que a troca só vale depois do link, que ligas e vínculo continuam e que os aparelhos pedem login de novo', /só vale depois que você tocar no link/.test(root.innerHTML) && /ligas, seu vínculo com o jogador e seus convites continuam como estão/.test(root.innerHTML) && /todos os seus aparelhos pedem login de novo/.test(root.innerHTML));
  check('o aviso de quem entra pelo link do e-mail (sem senha) está na tela', /Entra pelo link do e-mail e não tem senha/.test(root.innerHTML) && /Esqueci minha senha/.test(root.innerHTML));
  check('os campos de senha usam os autocompletar certos do navegador (atual e nova)', /id="acct-pw-cur" type="password" autocomplete="current-password"/.test(root.innerHTML) && /id="acct-pw-new" type="password" autocomplete="new-password"/.test(root.innerHTML) && /id="acct-pw-rep" type="password" autocomplete="new-password"/.test(root.innerHTML) && /id="acct-newmail" type="email" autocomplete="email"/.test(root.innerHTML));
  check('há botão de fechar e clicar fora fecha', /closeMyAccount\(\)/.test(root.innerHTML) && root.onclick === t.api.closeMyAccount);

  t = makeEnv({ providers: ['google.com'], email: 'ana@gmail.com' });
  t.api.openMyAccount();
  root = t.dom['acct-root'];
  check('quem entra SÓ com o Google não vê formulário: vê a explicação e o e-mail do suporte', /controlado pelo <strong>Google<\/strong>/.test(root.innerHTML) && /não dá para trocá-lo por aqui/.test(root.innerHTML) && /mailto:suporte@peladanamao\.com\.br/.test(root.innerHTML) && !t.dom['acct-newmail'] && !t.dom['acct-pw-cur'] && !t.dom['acct-mail-go'], root.innerHTML.slice(0, 300));
  check('Google: promete que o suporte muda "sem você perder suas ligas"', /sem você perder suas ligas/.test(root.innerHTML));
  t = makeEnv({ providers: ['password', 'google.com'] });
  t.api.openMyAccount();
  check('quem tem senha E Google vê os formulários (pode trocar o e-mail e a senha)', !!t.dom['acct-newmail'] && !!t.dom['acct-pw-cur']);
  t = makeEnv({ providers: ['google.com'], email: 'castanho.caiop@gmail.com', owner: true });
  t.api.openMyAccount();
  root = t.dom['acct-root'];
  check('dono do sistema: vê o aviso de que o e-mail dele é fixo no código e nenhum formulário', /dono do sistema/.test(root.innerHTML) && /fixo no código/.test(root.innerHTML) && !t.dom['acct-newmail'] && !t.dom['acct-pw-cur'] && !/mailto:/.test(root.innerHTML));
  t = makeEnv({ providers: ['password'], owner: true });
  t.api.openMyAccount();
  check('dono do sistema com senha também não troca o e-mail por aqui', !t.dom['acct-newmail'] && !t.dom['acct-mail-go']);

  t = makeEnv({ loggedIn: false });
  t.api.openMyAccount();
  check('sem login não abre nada', !t.dom['acct-root']);

  t = makeEnv({ providers: ['password'], email: '"><img src=x onerror=alert(1)>@x.com' });
  t.api.openMyAccount();
  check('e-mail com HTML é escapado na tela (nenhuma tag solta)', !/<img/i.test(t.dom['acct-root'].innerHTML) && /&lt;img/.test(t.dom['acct-root'].innerHTML), t.dom['acct-root'].innerHTML.slice(0, 400));

  t = makeEnv();
  t.api.openMyAccount(); t.api.openMyAccount();
  check('abrir de novo troca a camada (nunca duas)', Object.keys(t.dom).filter(k => k === 'acct-root').length === 1);
  t.api.closeMyAccount();
  check('fechar remove a camada e os campos', !t.dom['acct-root'] && !t.dom['acct-newmail']);
  t.api.openMyAccount();
  t.api.acct = { busy: 'mail', reauth: false };
  t.api.closeMyAccount();
  check('no meio de um pedido não fecha (a pessoa não perde a resposta)', !!t.dom['acct-root']);

  // ══ 3. TROCAR O E-MAIL ═════════════════════════════════════════════════════════════════════════
  t = makeEnv({ email: 'ana@x.com' });
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = '';
  await t.api.submitEmailChange();
  check('e-mail novo vazio: mostra o motivo e não chama o servidor', /Digite o e-mail novo/.test(textOf(msgOf(t, 'mail'))) && t.calls.request.length === 0, t.calls.request);
  t.dom['acct-newmail'].value = 'ana@x.com';
  await t.api.submitEmailChange();
  check('e-mail novo igual ao atual: recusa sem chamar o servidor', /já é o seu e-mail/.test(textOf(msgOf(t, 'mail'))) && t.calls.request.length === 0);

  t.dom['acct-newmail'].value = '  Ana.Nova@x.com  ';
  const p = t.api.submitEmailChange();
  check('enquanto envia: o botão fica desligado e diz "Enviando…"', t.dom['acct-mail-go'].disabled === true && t.dom['acct-mail-go'].textContent === 'Enviando…' && t.api.acct.busy === 'mail');
  const p2 = t.api.submitEmailChange();   // segundo toque no meio do pedido
  await p; await p2;
  check('toque repetido no meio do envio é ignorado (só um pedido ao servidor)', t.calls.request.length === 1, t.calls.request.length);
  check('o pedido vai à função requestEmailChange do servidor só com o e-mail novo (sem espaços nas pontas): o link e o e-mail são do servidor, não do navegador', t.calls.callFn.length === 1 && t.calls.callFn[0].name === 'requestEmailChange' && JSON.stringify(t.calls.callFn[0].data) === '{"newEmail":"Ana.Nova@x.com"}', t.calls.callFn);
  check('sem o servidor pedir login recente, o app não confirma a senha nem renova o token à toa', t.calls.reauth.length === 0 && t.calls.token.length === 0);
  check('depois de enviar: o botão volta ao normal e a mensagem (verde) diz para onde o link foi e o que tocar no e-mail', t.dom['acct-mail-go'].disabled === false && t.dom['acct-mail-go'].textContent === 'Enviar link de confirmação' && /Enviamos um link para <strong>Ana\.Nova@x\.com<\/strong>/.test(msgOf(t, 'mail').innerHTML) && /toque em “Confirmar o novo e-mail”/.test(msgOf(t, 'mail').innerHTML) && msgOf(t, 'mail').style.color === 'var(--accent)', msgOf(t, 'mail').innerHTML);
  check('a mensagem explica o que fazer se o link não chegar (o e-mail já tem conta → entrar nela, Excluir minha conta, voltar)', /não chegar em alguns minutos/.test(msgOf(t, 'mail').innerHTML) && /já tem uma conta/.test(msgOf(t, 'mail').innerHTML) && /Excluir minha conta/.test(msgOf(t, 'mail').innerHTML) && /volte aqui/.test(msgOf(t, 'mail').innerHTML));
  check('a mensagem avisa que os aparelhos pedem login de novo e manda olhar o spam', /todos os seus aparelhos pedem login de novo/.test(msgOf(t, 'mail').innerHTML) && /spam/.test(msgOf(t, 'mail').innerHTML));

  // o e-mail digitado vai escapado na mensagem (o servidor o recusaria, mas a tela nunca pode montar HTML com ele)
  t = makeEnv();
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = '"><svg/onload=alert(1)>@x.com';
  await t.api.submitEmailChange();
  check('e-mail digitado com HTML é escapado na mensagem de sucesso', !/<svg/i.test(msgOf(t, 'mail').innerHTML) && /&lt;svg/.test(msgOf(t, 'mail').innerHTML), msgOf(t, 'mail').innerHTML);

  // login recente: quem exige é o servidor (motivo estável "recent-login")
  t = makeEnv({ email: 'ana@x.com' });
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = 'ana.nova@x.com';
  t.user.failRequest.push({ code: 'failed-precondition', reason: 'recent-login', message: 'Por segurança, confirme que é você: digite a sua senha e toque no botão de novo.' });
  await t.api.submitEmailChange();
  check('o servidor pede login recente: mostra o campo da senha, o foco vai para ele e o botão muda', t.dom['acct-pass'].hidden === false && t.env.focused.includes('acct-password') && /confirme que é você/.test(textOf(msgOf(t, 'mail'))) && t.dom['acct-mail-go'].textContent === 'Confirmar senha e enviar o link' && t.api.acct.reauth === true && msgOf(t, 'mail').style.color === 'var(--danger)', textOf(msgOf(t, 'mail')));
  await t.api.submitEmailChange();
  check('segundo toque com a senha vazia: pede a senha, sem chamar o servidor de novo', /Digite a sua senha/.test(textOf(msgOf(t, 'mail'))) && t.calls.reauth.length === 0 && t.calls.request.length === 1, [t.calls.reauth.length, t.calls.request.length]);
  t.dom['acct-password'].value = 'errada1';
  t.user.failReauth.push('auth/wrong-password');
  await t.api.submitEmailChange();
  check('senha errada: diz que está incorreta, continua pedindo a senha e NÃO pede o e-mail ao servidor', /Senha incorreta/.test(textOf(msgOf(t, 'mail'))) && t.api.acct.reauth === true && t.calls.request.length === 1 && t.calls.reauth[0].e === 'ana@x.com' && t.calls.reauth[0].p === 'errada1' && t.calls.token.length === 0, t.calls.reauth);
  t.dom['acct-password'].value = 'certa123';
  await t.api.submitEmailChange();
  check('senha certa: confirma a senha, renova o token (para o servidor ver o login novo) e só então pede o e-mail ao servidor, nessa ordem', t.calls.reauth.length === 2 && t.calls.reauth[1].p === 'certa123' && t.calls.token.length === 1 && t.calls.token[0] === true && t.calls.request.length === 2 && t.calls.request[1].newEmail === 'ana.nova@x.com' && JSON.stringify(t.calls.order.slice(-3)) === '["reauth","token","request"]' && /Enviamos um link/.test(msgOf(t, 'mail').innerHTML), [t.calls.order, t.calls.token]);
  check('depois de enviar: o campo da senha some, é limpo e a pessoa não fica em "reautenticar"', t.dom['acct-pass'].hidden === true && t.dom['acct-password'].value === '' && t.api.acct.reauth === false);

  // erros que o servidor devolve: a mensagem dele já vem em português e é a que aparece
  for (const [code, message] of [['failed-precondition', 'O e-mail desta conta é controlado pelo Google, então não dá para trocá-lo por aqui.'], ['invalid-argument', 'Este não parece um e-mail. Confira e tente de novo.'], ['resource-exhausted', 'Muitos pedidos de troca de e-mail seguidos. Tente de novo mais tarde.'], ['not-found', 'Conta não encontrada.'], ['unavailable', 'Não foi possível concluir agora. Confira a conexão e tente de novo.']]) {
    t = makeEnv();
    t.api.openMyAccount();
    t.dom['acct-newmail'].value = 'ana.nova@x.com';
    t.user.failRequest.push({ code, message });
    await t.api.submitEmailChange();
    check(`erro do servidor ${code}: aparece a mensagem dele, em vermelho, sem o código técnico, o botão volta ao normal e a senha não é pedida à toa`, textOf(msgOf(t, 'mail')) === message && !new RegExp(code).test(textOf(msgOf(t, 'mail'))) && msgOf(t, 'mail').style.color === 'var(--danger)' && t.dom['acct-mail-go'].disabled === false && t.api.acct.busy === '' && t.api.acct.reauth === false && t.dom['acct-pass'].hidden === true, textOf(msgOf(t, 'mail')));
  }
  t = makeEnv();
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = 'ana.nova@x.com';
  t.user.failRequest.push({ code: undefined, message: '' });
  await t.api.submitEmailChange();
  check('erro sem código nem mensagem: cai na mensagem genérica em português', textOf(msgOf(t, 'mail')) === 'Não foi possível concluir agora. Tente de novo.' && t.api.acct.busy === '');
  // erros do Firebase ao confirmar a senha (a senha ainda é conferida no navegador)
  for (const [code, re] of [['auth/too-many-requests', /Muitas tentativas/], ['auth/network-request-failed', /Sem conexão/], ['auth/internal-error', /Não foi possível concluir/]]) {
    t = makeEnv();
    t.api.openMyAccount();
    t.dom['acct-newmail'].value = 'ana.nova@x.com';
    t.user.failRequest.push({ code: 'failed-precondition', reason: 'recent-login', message: 'x' });
    await t.api.submitEmailChange();
    t.dom['acct-password'].value = 'qualquer1';
    t.user.failReauth.push(code);
    await t.api.submitEmailChange();
    check(`erro ${code} ao confirmar a senha: mensagem em português, vermelha, sem o código técnico, o botão volta ao normal e nada é pedido ao servidor`, re.test(textOf(msgOf(t, 'mail'))) && !/auth\//.test(textOf(msgOf(t, 'mail'))) && msgOf(t, 'mail').style.color === 'var(--danger)' && t.dom['acct-mail-go'].disabled === false && t.api.acct.busy === '' && t.calls.request.length === 1, textOf(msgOf(t, 'mail')));
  }

  // ══ 4. TROCAR A SENHA ══════════════════════════════════════════════════════════════════════════
  t = makeEnv({ email: 'ana@x.com' });
  t.api.openMyAccount();
  t.dom['acct-pw-cur'].value = ''; t.dom['acct-pw-new'].value = 'nova123'; t.dom['acct-pw-rep'].value = 'nova123';
  await t.api.submitPasswordChange();
  check('senha: sem a atual → pede e não chama o Firebase', /senha atual/.test(textOf(msgOf(t, 'pw'))) && t.calls.reauth.length === 0);
  t.dom['acct-pw-cur'].value = 'velha1'; t.dom['acct-pw-rep'].value = 'outra999';
  await t.api.submitPasswordChange();
  check('senha: repetição diferente → recusa antes de chamar o Firebase', /não são iguais/.test(textOf(msgOf(t, 'pw'))) && t.calls.reauth.length === 0 && t.calls.updatePw.length === 0);
  t.dom['acct-pw-rep'].value = 'nova123';
  const pw = t.api.submitPasswordChange();
  check('enquanto troca: botão desligado e "Trocando…"', t.dom['acct-pw-go'].disabled === true && t.dom['acct-pw-go'].textContent === 'Trocando…' && t.api.acct.busy === 'pw');
  await pw;
  check('senha certa: confirma a senha atual e depois troca pela nova, nessa ordem', t.calls.reauth.length === 1 && t.calls.reauth[0].e === 'ana@x.com' && t.calls.reauth[0].p === 'velha1' && t.calls.updatePw.length === 1 && t.calls.updatePw[0] === 'nova123', t.calls);
  check('depois de trocar: campos limpos, mensagem verde e aviso dos outros aparelhos', t.dom['acct-pw-cur'].value === '' && t.dom['acct-pw-new'].value === '' && t.dom['acct-pw-rep'].value === '' && /Senha trocada/.test(textOf(msgOf(t, 'pw'))) && /outros aparelhos/.test(textOf(msgOf(t, 'pw'))) && msgOf(t, 'pw').style.color === 'var(--accent)' && t.dom['acct-pw-go'].disabled === false);
  const t2 = makeEnv({ email: 'ana@x.com' });
  t2.api.openMyAccount();
  t2.dom['acct-pw-cur'].value = 'velha1'; t2.dom['acct-pw-new'].value = 'nova123'; t2.dom['acct-pw-rep'].value = 'nova123';
  const pa = t2.api.submitPasswordChange(), pb = t2.api.submitPasswordChange();   // segundo toque no meio da troca
  await pa; await pb;
  check('toque repetido no meio da troca de senha é ignorado (uma confirmação e uma troca só)', t2.calls.reauth.length === 1 && t2.calls.updatePw.length === 1, t2.calls);
  t.dom['acct-pw-cur'].value = 'velha1'; t.dom['acct-pw-new'].value = 'nova456'; t.dom['acct-pw-rep'].value = 'nova456';
  t.user.failReauth.push('auth/wrong-password');
  await t.api.submitPasswordChange();
  check('senha atual errada: avisa e NÃO troca a senha', /Senha incorreta/.test(textOf(msgOf(t, 'pw'))) && t.calls.updatePw.length === 1 && msgOf(t, 'pw').style.color === 'var(--danger)' && t.dom['acct-pw-new'].value === 'nova456', t.calls.updatePw);
  t.user.failPw.push('auth/weak-password');
  await t.api.submitPasswordChange();
  check('Firebase acha a senha fraca: mensagem em português e a pessoa pode corrigir', /muito fraca/.test(textOf(msgOf(t, 'pw'))) && t.api.acct.busy === '');
  t.user.failPw.push('auth/requires-recent-login');
  await t.api.submitPasswordChange();
  check('login velho demais na troca de senha: mensagem em português, sem código técnico', !/auth\//.test(textOf(msgOf(t, 'pw'))) && textOf(msgOf(t, 'pw')) !== '');

  // ══ 5. CORRIGIR A CÓPIA DO E-MAIL NA ENTRADA ═══════════════════════════════════════════════════
  t = makeEnv({ email: 'ana@x.com', userDocEmail: 'ana@x.com' });
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana@x.com' });
  t.api.syncAccountEmail({ uid: 'u1', email: 'ANA@x.com' });
  await tick();
  check('e-mail do login igual ao do cadastro (até com maiúsculas): não chama o servidor', t.calls.callFn.length === 0, t.calls.callFn);
  t = makeEnv({ email: 'ana.nova@x.com', userDocEmail: 'ana@x.com' });
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('e-mail do login diferente do cadastro: chama a função syncMyEmail do servidor, sem mandar nenhum dado', t.calls.callFn.length === 1 && t.calls.callFn[0].name === 'syncMyEmail' && t.calls.callFn[0].data === undefined, t.calls.callFn);
  check('o servidor corrigiu: o app passa a ter o e-mail novo no cadastro em memória', t.env.st.userDoc.email === 'ana.nova@x.com', t.env.st.userDoc);
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('na mesma sessão a correção é pedida uma vez só', t.calls.callFn.length === 1);
  t = makeEnv({ email: 'ana.nova@x.com', userDocEmail: 'ana@x.com' });
  t.env.respond = () => { throw new Error('offline'); };
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('se o servidor falhar: não quebra, mantém o cadastro como estava e libera uma nova tentativa na próxima entrada', t.env.st.userDoc.email === 'ana@x.com' && t.api.tried === '', t.env.st.userDoc);
  t.env.respond = () => ({ ok: true, changed: true });
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('na nova tentativa corrige', t.env.st.userDoc.email === 'ana.nova@x.com' && t.calls.callFn.length === 2);
  t = makeEnv({ email: 'ana.nova@x.com', userDocEmail: 'ana@x.com' });
  t.env.respond = () => ({ ok: true, changed: false });
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('servidor diz que nada mudou: o cadastro em memória não é mexido', t.env.st.userDoc.email === 'ana@x.com');
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('…e mesmo com o cadastro em memória ainda velho, a correção é pedida uma vez só por sessão (não insiste a cada entrada)', t.calls.callFn.length === 1, t.calls.callFn);
  t = makeEnv({ email: 'ana.nova@x.com', userDocEmail: 'ana@x.com' });
  t.env.st.authUser = { uid: 'outra', email: 'outra@x.com' };   // trocou de conta enquanto a resposta vinha
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('se a pessoa trocou de conta no meio, a resposta não é aplicada à conta nova', t.env.st.userDoc.email === 'ana@x.com');
  t = makeEnv({ email: '', userDocEmail: 'ana@x.com' });
  t.api.syncAccountEmail({ uid: 'u1', email: '' });
  t.api.syncAccountEmail(null);
  t.api.syncAccountEmail({ email: 'a@x.com' });
  await tick();
  check('login sem e-mail, sem usuário ou sem uid: não chama o servidor', t.calls.callFn.length === 0);
  t = makeEnv({ email: 'ana.nova@x.com', userDocEmail: undefined });
  t.env.st.userDoc = {};
  t.api.syncAccountEmail({ uid: 'u1', email: 'ana.nova@x.com' });
  await tick();
  check('cadastro antigo sem o campo e-mail: também pede a correção', t.calls.callFn.length === 1);

  // ══ 6. LIGAÇÕES NO APP E NO MANUAL ═════════════════════════════════════════════════════════════
  const footer = slice('function deleteAccountLink()', 'function anonymizeNameLink()');
  check('o rodapé da conta tem o botão "✉️ Minha conta" ANTES de "Excluir minha conta"', /openMyAccount\(\)[^>]*>✉️ Minha conta</.test(footer) && footer.indexOf('openMyAccount()') < footer.indexOf('openDeleteAccount()'), footer.slice(0, 300));
  check('o rodapé aparece nas telas da conta (onboarding, escolha de liga, pendente) e na aba EU', (html.match(/\$\{deleteAccountLink\(\)\}/g) || []).length >= 4 && /anonymizeNameLink\(\) \+ deleteAccountLink\(\)/.test(html));
  const authBlock = slice('AUTH.onAuthStateChanged(async user => {', "window.__pnmStage = 'user';");
  check('a entrada pede a correção do e-mail logo depois de ler o cadastro (só quando o cadastro existe)', /if \(snap\.exists\) \{\n\s+st\.userDoc = snap\.data\(\);\n\s+syncAccountEmail\(user\);/.test(authBlock), authBlock.slice(authBlock.indexOf('if (snap.exists)'), authBlock.indexOf('if (snap.exists)') + 200));
  check('as funções do servidor chamadas existem com esses nomes (syncMyEmail e requestEmailChange) e são chamáveis', /exports\.syncMyEmail = onCall\(/.test(serverSrc) && /callFn\('syncMyEmail'\)/.test(accountCode) && /exports\.requestEmailChange = onCall\(/.test(serverSrc) && /callFn\('requestEmailChange', \{ newEmail: typed \}\)/.test(accountCode));
  check('o app NÃO usa o e-mail do próprio Firebase para a troca (verifyBeforeUpdateEmail: o link dele dá "The selected page mode is invalid") nem o updateEmail (o Firebase o desliga com a proteção contra descobrir cadastros): o pedido vai ao servidor', !/\.verifyBeforeUpdateEmail\(/.test(html) && !/\.updateEmail\(/.test(html) && /callFn\('requestEmailChange'/.test(accountCode));
  check('o app nunca grava o e-mail direto no cadastro (só o servidor pode; as regras barram)', !/\.update\(\{\s*email/.test(accountCode) && !/\.set\(\{[^}]*email/.test(accountCode));
  check('nenhuma chamada do Firebase fica sem tratamento de erro: cada pedido da tela está dentro de um try, e a correção do e-mail termina em catch', ['submitEmailChange', 'submitPasswordChange', 'applyEmailChange'].every(fn => new RegExp('async function ' + fn + '\\([^)]*\\) \\{[\\s\\S]*?\\btry \\{').test(accountCode)) && /callFn\('syncMyEmail'\)[\s\S]*?\.catch\(/.test(accountCode));
  const priv = slice('function openPrivacyPolicy()', 'function openDeleteAccount()');
  check('a privacidade cita o direito de trocar o e-mail e a senha, o e-mail antigo e as cópias de segurança', /Trocar o e-mail do login e a senha/.test(priv) && /O e-mail antigo deixa de ser usado/.test(priv) && /cópias de segurança diárias/.test(priv));
  check('a privacidade não diz mais "Ambas as opções"', !/Ambas as opções/.test(priv) && /Essas opções ficam no fim da aba/.test(priv));
  check('a tela não repete nenhum e-mail antigo de contato (contato@)', !/contato@/.test(accountCode) && !/contato@/.test(priv));

  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const secStart = manual.indexOf('id="minha-conta"');
  const sec = plainM(manual.slice(secStart, manual.indexOf('</section>', secStart)));
  check('manual: tem a seção "Minha conta" (#minha-conta)', manual.indexOf('id="minha-conta"') > 0, null);
  check('manual: explica o e-mail novo com link, que a troca só vale depois de tocar no link, que as ligas e o vínculo continuam e que os aparelhos pedem login de novo', /link/.test(sec) && /só vale depois/.test(sec) && /ligas/.test(sec) && /vínculo/.test(sec) && /pedem login de novo/.test(sec), sec.slice(0, 400));
  check('manual: explica o que fazer se o link não chegar (o e-mail novo já tem conta) e quem entra só com o Google', /não chegar/.test(sec) && /Quase sempre é porque o e-mail novo já tem uma conta/.test(sec) && /o app não avisa quando isso acontece/.test(sec) && /Google/.test(sec) && /suporte@peladanamao\.com\.br/.test(sec), sec.slice(0, 400));
  check('manual: a tabela diz que o dono do sistema e quem entra só com o Google NÃO trocam o e-mail pelo app, e a senha também se troca em Minha conta', /Dono do sistema Não: o e-mail dele está fixo no código/.test(sec) && /Só com o Google Não: o e-mail dessa conta é controlado pelo Google/.test(sec) && /Trocar a senha Em ✉️ Minha conta/.test(sec) && /a senha atual/.test(sec), sec.slice(0, 400));
  check('manual: tem o passo a passo do dono (script trocar-email.js, simulação antes, repetir com --aplicar, chave de administrador, apagar a chave depois)', /trocar-email\.js/.test(sec) && /Simule primeiro/.test(sec) && /repita o comando com --aplicar/.test(sec) && /chave de administrador/.test(sec) && /Apague o arquivo da chave/.test(sec), sec.slice(0, 600));

  check('manual: o e-mail chega de "Pelada na Mão" com o botão "Confirmar o novo e-mail", o link abre o app na tela "E-mail trocado", e a função requestEmailChange tem login recente, Resend e os limites (5 por minuto e 10 por hora)', /chega de Pelada na Mão \(avisos@notificacoes\.peladanamao\.com\.br\)/.test(sec) && /Confirmar o novo e-mail/.test(sec) && /E-mail trocado/.test(sec) && /requestEmailChange/.test(sec) && /5 chamadas por minuto e 10 por hora/.test(sec) && /Resend/.test(sec) && /login recente/.test(sec), sec.slice(0, 400));
  check('manual: explica por que o e-mail do próprio Firebase não é usado ("The selected page mode is invalid"), a tela que aplica o código e que o link só vale uma vez e por tempo limitado', /The selected page mode is invalid/.test(sec) && /handleEmailChangeOnLoad/.test(sec) && /só vale uma vez e por tempo limitado/.test(sec), sec.slice(0, 400));

  // ══ 7. A TELA QUE CONFIRMA A TROCA (O LINK DO E-MAIL ABRE O APP) ═══════════════════════════════
  const { changeEmailUrl } = require('../account-email');
  const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
  const linkSearch = new URL(changeEmailUrl('https://peladanamao.com.br/', 'ABC_123-x')).search;   // o link que o servidor põe no e-mail
  let a = makeEnv({ email: 'ana@x.com', search: linkSearch });
  a.api.handleEmailChangeOnLoad();
  await settle();
  check('link do e-mail aberto: o app lê o código, confere (checkActionCode) e aplica (applyActionCode), nessa ordem, uma vez só', JSON.stringify(a.calls.check) === '["ABC_123-x"]' && JSON.stringify(a.calls.apply) === '["ABC_123-x"]' && JSON.stringify(a.calls.order.filter(x => x === 'check' || x === 'apply')) === '["check","apply"]', [a.calls.check, a.calls.apply]);
  check('o endereço do link que o servidor monta é o que o app lê (mode=verifyAndChangeEmail e oobCode)', /^\?mode=verifyAndChangeEmail&oobCode=ABC_123-x$/.test(linkSearch), linkSearch);
  check('terminou: tela "E-mail trocado" com o e-mail NOVO (o que o Firebase devolve), e o código sai do endereço da página', a.env.st._emailChange.mode === 'done' && a.env.st._emailChange.email === 'novo@x.com' && a.env.st._emailChange.code === '' && a.calls.history.length === 1 && a.calls.history[0] === '/', [a.env.st._emailChange, a.calls.history]);
  check('mostra "Confirmando…" primeiro e depois o resultado (a tela é redesenhada nas duas etapas)', a.calls.renders.length >= 2 && a.calls.renders[0].mode === 'working' && a.calls.renders[a.calls.renders.length - 1].mode === 'done', a.calls.renders);
  check('quem abriu o link é o dono da troca (o e-mail dele era o antigo): sai da conta, porque o Firebase já encerrou as sessões', a.calls.signOut === 1 && a.env.AUTH.currentUser === null);
  a = makeEnv({ email: 'ana@x.com', search: linkSearch, loggedIn: false });
  a.api.handleEmailChangeOnLoad(); await settle();
  check('sem conta aberta neste navegador: aplica, mostra o resultado e não tenta sair de nada', a.env.st._emailChange.mode === 'done' && a.calls.signOut === 0 && a.calls.apply.length === 1);
  a = makeEnv({ email: 'bia@x.com', search: linkSearch });
  a.api.handleEmailChangeOnLoad(); await settle();
  check('conta aberta é de OUTRA pessoa (link repassado ou armado): aplica o código, mas NÃO derruba a sessão de quem abriu', a.env.st._emailChange.mode === 'done' && a.calls.signOut === 0 && a.env.AUTH.currentUser !== null);
  a = makeEnv({ email: 'ANA@X.com', search: linkSearch });
  a.api.handleEmailChangeOnLoad(); await settle();
  check('a comparação do e-mail ignora maiúsculas: conta ANA@X.com com troca de ana@x.com sai da conta', a.calls.signOut === 1);
  a = makeEnv({ email: 'ana@x.com', search: linkSearch });
  a.env.AUTH.info = { data: { email: 'novo@x.com' } };
  a.api.handleEmailChangeOnLoad(); await settle();
  check('se o Firebase não disser o e-mail antigo, não sai da conta (sem prova de quem é a troca) e ainda assim conclui', a.calls.signOut === 0 && a.env.st._emailChange.mode === 'done');
  a = makeEnv({ email: 'ana@x.com', search: linkSearch });
  a.env.AUTH.failSignOut = true;
  a.api.handleEmailChangeOnLoad(); await settle();
  check('se o signOut falhar, a tela de resultado aparece do mesmo jeito', a.env.st._emailChange.mode === 'done');

  // o que NÃO é um link de troca de e-mail não é tocado (senha esquecida, link de acesso, endereço sem código…)
  for (const [search, why] of [['', 'sem parâmetros'], ['?mode=resetPassword&oobCode=XYZ', 'redefinição de senha'], ['?mode=signIn&oobCode=XYZ&apiKey=k', 'link de acesso por e-mail'], ['?mode=verifyEmail&oobCode=XYZ', 'verificação de e-mail'], ['?mode=verifyAndChangeEmail', 'troca de e-mail sem código'], ['?mode=verifyAndChangeEmail&oobCode=', 'troca de e-mail com código vazio'], ['?oobCode=XYZ', 'código sem modo'], ['?invite=abc&ref=instagram', 'convite']]) {
    a = makeEnv({ search });
    a.api.handleEmailChangeOnLoad(); await settle();
    check(`${why}: o app não mexe em nada (nenhum código conferido ou aplicado, nenhuma tela)`, a.calls.check.length === 0 && a.calls.apply.length === 0 && !a.env.st._emailChange && a.calls.history.length === 0 && a.calls.renders.length === 0, search);
  }

  // link vencido ou já usado
  for (const code of ['auth/invalid-action-code', 'auth/expired-action-code', 'auth/user-not-found']) {
    a = makeEnv({ search: linkSearch });
    a.env.AUTH.failCheck.push(code);
    a.api.handleEmailChangeOnLoad(); await settle();
    check(`${code}: tela "Link vencido" que manda pedir outro em Minha conta, sem aplicar nada, e o código sai do endereço`, a.env.st._emailChange.mode === 'dead' && /já foi usado ou venceu/.test(a.env.st._emailChange.msg) && /Minha conta/.test(a.env.st._emailChange.msg) && a.calls.apply.length === 0 && a.calls.history.length === 1 && a.env.st._emailChange.code === '' && a.calls.signOut === 0, a.env.st._emailChange);
  }
  a = makeEnv({ search: linkSearch });
  a.env.AUTH.failApply.push('auth/invalid-action-code');
  a.api.handleEmailChangeOnLoad(); await settle();
  check('o código vence entre a conferência e a aplicação: também é "Link vencido" e não sai da conta', a.env.st._emailChange.mode === 'dead' && a.calls.signOut === 0);

  // sem rede: pode tentar de novo, e o código continua guardado na memória (não no endereço apagado)
  a = makeEnv({ email: 'ana@x.com', search: linkSearch });
  a.env.AUTH.failApply.push('auth/network-request-failed');
  a.api.handleEmailChangeOnLoad(); await settle();
  check('sem rede ao aplicar: tela "Não deu para confirmar" com o motivo, o código guardado para tentar de novo e o endereço da página mantido', a.env.st._emailChange.mode === 'retry' && /Sem conexão/.test(a.env.st._emailChange.msg) && a.env.st._emailChange.code === 'ABC_123-x' && a.calls.history.length === 0 && a.calls.signOut === 0, a.env.st._emailChange);
  await a.api.applyEmailChange(); await settle();
  check('"Tentar de novo" aplica o mesmo código (agora com rede), mostra o resultado e limpa o endereço', a.calls.apply.length === 2 && a.calls.apply[1] === 'ABC_123-x' && a.env.st._emailChange.mode === 'done' && a.calls.history.length === 1 && a.calls.signOut === 1);
  check('"Tentar de novo" sem código guardado não faz nada (não aplica nada à toa)', await (async () => { const z = makeEnv({}); z.env.st._emailChange = { mode: 'retry', code: '', msg: '' }; await z.api.applyEmailChange(); return z.calls.apply.length === 0 && z.calls.check.length === 0; })());
  for (const [code, re] of [['auth/too-many-requests', /Muitas tentativas/], ['auth/user-disabled', /desativada.*suporte@peladanamao\.com\.br/], ['auth/internal-error', /Não foi possível confirmar agora/], ['app/qualquer', /Não foi possível confirmar agora/]]) {
    a = makeEnv({ search: linkSearch });
    a.env.AUTH.failApply.push(code);
    a.api.handleEmailChangeOnLoad(); await settle();
    check(`erro ${code}: mensagem em português, sem código técnico, e dá para tentar de novo`, re.test(a.env.st._emailChange.msg) && !/auth\//.test(a.env.st._emailChange.msg) && a.env.st._emailChange.mode === 'retry' && a.env.st._emailChange.code === 'ABC_123-x', a.env.st._emailChange);
  }
  a = makeEnv({ search: linkSearch });
  a.env.AUTH.failApply.push('auth/network-request-failed');
  a.api.handleEmailChangeOnLoad(); await settle();
  a.api.closeEmailChange();
  check('Cancelar fecha a tela, limpa o estado, redesenha e tira o código do endereço', !a.env.st._emailChange && a.calls.history.length === 1 && a.calls.renders[a.calls.renders.length - 1] === null, a.calls.renders);

  // a tela
  const v = s => makeEnv().api.vEmailChange(s);
  const done = v({ mode: 'done', email: 'novo@x.com', msg: '' });
  check('tela "E-mail trocado": o e-mail novo em destaque, entrar de novo com a mesma senha, ligas e conquistas como estão, e o botão Entrar', /E-mail trocado/.test(done) && /novo@x\.com/.test(done) && /mesma senha/.test(done) && /ligas, o seu jogador e as suas conquistas continuam como estão/.test(done) && /onclick="closeEmailChange\(\)"[^>]*>Entrar</.test(done) && /\/logo\.webp/.test(done), done.slice(0, 300));
  check('tela "E-mail trocado" sem o e-mail novo: texto genérico, sem "undefined"', /O seu e-mail de login foi trocado\./.test(v({ mode: 'done', email: '', msg: '' })) && !/undefined|null/.test(v({ mode: 'done', msg: '' })));
  check('o e-mail novo vai escapado na tela (nenhuma tag solta: a única <img> é o logo)', (v({ mode: 'done', email: '"><img src=x onerror=alert(1)>@x.com', msg: '' }).match(/<img/gi) || []).length === 1 && /&lt;img/.test(v({ mode: 'done', email: '"><img src=x onerror=alert(1)>@x.com', msg: '' })));
  check('tela "Link vencido": mostra a mensagem e o botão Continuar', /Link vencido/.test(v({ mode: 'dead', msg: 'Este link já foi usado ou venceu.' })) && /Este link já foi usado ou venceu\./.test(v({ mode: 'dead', msg: 'Este link já foi usado ou venceu.' })) && />Continuar</.test(v({ mode: 'dead', msg: 'x' })));
  check('tela "Não deu para confirmar": mostra o motivo, Tentar de novo (applyEmailChange) e Cancelar', /Não deu para confirmar/.test(v({ mode: 'retry', msg: 'Sem conexão' })) && /Sem conexão/.test(v({ mode: 'retry', msg: 'Sem conexão' })) && /onclick="applyEmailChange\(\)"[^>]*>Tentar de novo</.test(v({ mode: 'retry', msg: 'x' })) && /onclick="closeEmailChange\(\)"[^>]*>Cancelar</.test(v({ mode: 'retry', msg: 'x' })));
  check('tela de espera: "Confirmando o seu novo e-mail…" e nenhum botão', /Confirmando o seu novo e-mail/.test(v({ mode: 'working' })) && !/<button/.test(v({ mode: 'working' })));
  check('a mensagem de erro também vai escapada', !/<b>/.test(v({ mode: 'dead', msg: '<b>x</b>' })) && /&lt;b>x/.test(v({ mode: 'dead', msg: '<b>x</b>' })));

  // ligações no app
  const renderFn = html.slice(html.indexOf('function render() {'), html.indexOf('function render() {') + 900);
  check('o render() mostra a tela da troca ANTES do login e do app (com ou sem conta aberta) e limpa o app antes', /if \(lpSync\(\)\) return;[^\n]*\n\s*if \(st\._emailChange\) \{[^\n]*\n\s*if \(document\.getElementById\('main'\)\) app\.innerHTML = '';\n\s*app\.innerHTML = vEmailChange\(st\._emailChange\);\n\s*return;\n\s*\}\n\s*\n?\s*if \(!st\.authUser\)/.test(renderFn), renderFn.slice(0, 700));
  const initBlock = slice('handleEmailLinkOnLoad();', 'AUTH.onAuthStateChanged(async user => {');
  check('na abertura, a troca é tratada logo depois do link de acesso e ANTES de saber quem está logado', /handleEmailLinkOnLoad\(\);\n\s+handleEmailChangeOnLoad\(\);/.test(initBlock), initBlock);
  check('a apresentação para visitantes novos não cobre o link (qualquer parâmetro fora de ref, utm_, fbclid e gclid desliga a apresentação)', /if \(k !== 'ref' && !\/\^utm_\/\.test\(k\) && k !== 'fbclid' && k !== 'gclid'\) ok = false;/.test(html));
  check('a tela da troca só usa o que o Firebase devolve para o e-mail e nunca guarda o código no aparelho (nada de localStorage nem sessionStorage)', !/localStorage|sessionStorage/.test(slice('function handleEmailChangeOnLoad()', 'function vEmailChange(')));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
