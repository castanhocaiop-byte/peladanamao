// Testa o código do app (index.html) da tela "✉️ Minha conta" (trocar o e-mail do login e a senha), isolado: extrai as funções reais do arquivo
// e as executa num ambiente simulado, sem navegador.
//  - accountSignIn / emailChangeProblem / passwordChangeProblem / accountErrMsg: como a pessoa entra, as conferências dos campos e as mensagens;
//  - openMyAccount / myAccountHtml: o que cada pessoa vê (senha, Google, dono do sistema) e que o HTML é escapado;
//  - submitEmailChange: o link de confirmação (verifyBeforeUpdateEmail), o login recente exigido pelo Firebase, o endereço de volta;
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
function makeEnv({ providers = ['password'], email = 'ana@x.com', owner = false, loggedIn = true, userDocEmail } = {}) {
  const dom = {};   // id -> elemento falso
  const calls = { verify: [], reauth: [], updatePw: [], callFn: [] };
  const mkEl = (id, attrs = '') => (dom[id] = { id, value: '', hidden: /\bhidden\b/.test(attrs), disabled: false, style: {}, textContent: '', innerHTML: '', focus() { env.focused.push(id); }, remove() { delete dom[id]; } });
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const user = {
    uid: 'u1', email, providerData: providers.map(providerId => ({ providerId })),
    failVerify: [], failReauth: [], failPw: [],
    verifyBeforeUpdateEmail: async (e, s) => { calls.verify.push({ e, s }); const f = user.failVerify.shift(); if (f) fail(f); },
    reauthenticateWithCredential: async c => { calls.reauth.push(c); const f = user.failReauth.shift(); if (f) fail(f); },
    updatePassword: async p => { calls.updatePw.push(p); const f = user.failPw.shift(); if (f) fail(f); },
  };
  const env = {
    focused: [],
    AUTH: { currentUser: loggedIn ? user : null },
    firebase: { auth: { EmailAuthProvider: { credential: (e, p) => ({ e, p }) } } },
    location: { origin: 'https://peladanamao.com.br' },
    isSystemOwner: () => owner,
    st: { userDoc: { email: userDocEmail === undefined ? email : userDocEmail }, authUser: { uid: 'u1', email } },
    callFn: async (name, data) => { calls.callFn.push({ name, data }); return env.respond(name, data); },
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
  const names = ['AUTH', 'firebase', 'document', 'location', 'isSystemOwner', 'callFn', 'st'];
  const api = new Function(...names, code + `
    return { accountSignIn, emailChangeProblem, passwordChangeProblem, accountErrMsg, myAccountHtml, openMyAccount, closeMyAccount,
             submitEmailChange, submitPasswordChange, syncAccountEmail, sendEmailChangeLink, SUPPORT_EMAIL,
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
  check('quem entra SÓ com o Google não vê formulário: vê a explicação e o e-mail do suporte', /entra com o <strong>Google<\/strong>/.test(root.innerHTML) && /controlado pelo Google/.test(root.innerHTML) && /mailto:suporte@peladanamao\.com\.br/.test(root.innerHTML) && !t.dom['acct-newmail'] && !t.dom['acct-pw-cur'] && !t.dom['acct-mail-go'], root.innerHTML.slice(0, 300));
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
  check('e-mail novo vazio: mostra o motivo e não chama o Firebase', /Digite o e-mail novo/.test(textOf(msgOf(t, 'mail'))) && t.calls.verify.length === 0, t.calls.verify);
  t.dom['acct-newmail'].value = 'ana@x.com';
  await t.api.submitEmailChange();
  check('e-mail novo igual ao atual: recusa sem chamar o Firebase', /já é o seu e-mail/.test(textOf(msgOf(t, 'mail'))) && t.calls.verify.length === 0);

  t.dom['acct-newmail'].value = '  Ana.Nova@x.com  ';
  const p = t.api.submitEmailChange();
  check('enquanto envia: o botão fica desligado e diz "Enviando…"', t.dom['acct-mail-go'].disabled === true && t.dom['acct-mail-go'].textContent === 'Enviando…' && t.api.acct.busy === 'mail');
  const p2 = t.api.submitEmailChange();   // segundo toque no meio do pedido
  await p; await p2;
  check('toque repetido no meio do envio é ignorado (só um pedido ao Firebase)', t.calls.verify.length === 1, t.calls.verify.length);
  check('pede o link ao e-mail novo (sem espaços), com o endereço do site para voltar', t.calls.verify[0].e === 'Ana.Nova@x.com' && t.calls.verify[0].s.url === 'https://peladanamao.com.br/', t.calls.verify[0]);
  check('depois de enviar: o botão volta ao normal e a mensagem (verde) diz para onde o link foi', t.dom['acct-mail-go'].disabled === false && t.dom['acct-mail-go'].textContent === 'Enviar link de confirmação' && /Enviamos um link para <strong>Ana\.Nova@x\.com<\/strong>/.test(msgOf(t, 'mail').innerHTML) && msgOf(t, 'mail').style.color === 'var(--accent)', msgOf(t, 'mail').innerHTML);
  check('a mensagem explica o que fazer se o link não chegar (o e-mail já tem conta → entrar nela, Excluir minha conta, voltar)', /não chegar em alguns minutos/.test(msgOf(t, 'mail').innerHTML) && /já tem uma conta/.test(msgOf(t, 'mail').innerHTML) && /Excluir minha conta/.test(msgOf(t, 'mail').innerHTML) && /volte aqui/.test(msgOf(t, 'mail').innerHTML));
  check('a mensagem avisa que os aparelhos pedem login de novo e manda olhar o spam', /todos os seus aparelhos pedem login de novo/.test(msgOf(t, 'mail').innerHTML) && /spam/.test(msgOf(t, 'mail').innerHTML));

  // o e-mail digitado vai escapado na mensagem (o Firebase o recusaria, mas a tela nunca pode montar HTML com ele)
  t = makeEnv();
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = '"><svg/onload=alert(1)>@x.com';
  await t.api.submitEmailChange();
  check('e-mail digitado com HTML é escapado na mensagem de sucesso', !/<svg/i.test(msgOf(t, 'mail').innerHTML) && /&lt;svg/.test(msgOf(t, 'mail').innerHTML), msgOf(t, 'mail').innerHTML);

  // login recente exigido pelo Firebase
  t = makeEnv({ email: 'ana@x.com' });
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = 'ana.nova@x.com';
  t.user.failVerify.push('auth/requires-recent-login');
  await t.api.submitEmailChange();
  check('Firebase pede login recente: mostra o campo da senha, o foco vai para ele e o botão muda', t.dom['acct-pass'].hidden === false && t.env.focused.includes('acct-password') && /confirme que é você/.test(textOf(msgOf(t, 'mail'))) && t.dom['acct-mail-go'].textContent === 'Confirmar senha e enviar o link' && t.api.acct.reauth === true && msgOf(t, 'mail').style.color === 'var(--danger)', textOf(msgOf(t, 'mail')));
  await t.api.submitEmailChange();
  check('segundo toque com a senha vazia: pede a senha, sem chamar o Firebase de novo', /Digite a sua senha/.test(textOf(msgOf(t, 'mail'))) && t.calls.reauth.length === 0 && t.calls.verify.length === 1, [t.calls.reauth.length, t.calls.verify.length]);
  t.dom['acct-password'].value = 'errada1';
  t.user.failReauth.push('auth/wrong-password');
  await t.api.submitEmailChange();
  check('senha errada: diz que está incorreta, continua pedindo a senha e NÃO manda o link', /Senha incorreta/.test(textOf(msgOf(t, 'mail'))) && t.api.acct.reauth === true && t.calls.verify.length === 1 && t.calls.reauth[0].e === 'ana@x.com' && t.calls.reauth[0].p === 'errada1', t.calls.reauth);
  t.dom['acct-password'].value = 'certa123';
  await t.api.submitEmailChange();
  check('senha certa: confirma a senha e então manda o link ao e-mail novo', t.calls.reauth.length === 2 && t.calls.reauth[1].p === 'certa123' && t.calls.verify.length === 2 && t.calls.verify[1].e === 'ana.nova@x.com' && /Enviamos um link/.test(msgOf(t, 'mail').innerHTML), t.calls);
  check('depois de enviar: o campo da senha some, é limpo e a pessoa não fica em "reautenticar"', t.dom['acct-pass'].hidden === true && t.dom['acct-password'].value === '' && t.api.acct.reauth === false);

  // endereço de volta não autorizado neste ambiente
  t = makeEnv();
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = 'ana.nova@x.com';
  t.user.failVerify.push('auth/unauthorized-continue-uri');
  await t.api.submitEmailChange();
  check('endereço de volta não autorizado (site de teste): manda de novo sem ele e dá certo', t.calls.verify.length === 2 && t.calls.verify[0].s && t.calls.verify[1].s === undefined && /Enviamos um link/.test(msgOf(t, 'mail').innerHTML), t.calls.verify);
  t = makeEnv();
  t.api.openMyAccount();
  t.dom['acct-newmail'].value = 'ana.nova@x.com';
  t.user.failVerify.push('auth/invalid-continue-uri');
  await t.api.submitEmailChange();
  check('endereço de volta inválido: também tenta sem ele', t.calls.verify.length === 2 && t.calls.verify[1].s === undefined);

  // outros erros do Firebase
  for (const [code, re] of [['auth/invalid-email', /não parece um e-mail/], ['auth/too-many-requests', /Muitas tentativas/], ['auth/network-request-failed', /Sem conexão/], ['auth/internal-error', /Não foi possível concluir/]]) {
    t = makeEnv();
    t.api.openMyAccount();
    t.dom['acct-newmail'].value = 'ana.nova@x.com';
    t.user.failVerify.push(code);
    await t.api.submitEmailChange();
    check(`erro ${code}: mensagem em português, vermelha, sem o código técnico e o botão volta ao normal`, re.test(textOf(msgOf(t, 'mail'))) && !/auth\//.test(textOf(msgOf(t, 'mail'))) && msgOf(t, 'mail').style.color === 'var(--danger)' && t.dom['acct-mail-go'].disabled === false && t.api.acct.busy === '', textOf(msgOf(t, 'mail')));
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
  check('a função do servidor chamada existe com esse nome (syncMyEmail) e é chamável', /exports\.syncMyEmail = onCall\(/.test(serverSrc) && /callFn\('syncMyEmail'\)/.test(accountCode));
  check('o app usa verifyBeforeUpdateEmail e nunca updateEmail (o Firebase desliga o updateEmail com a proteção contra descobrir cadastros)', /verifyBeforeUpdateEmail\(/.test(accountCode) && !/\.updateEmail\(/.test(accountCode) && !/\.updateEmail\(/.test(html));
  check('o app nunca grava o e-mail direto no cadastro (só o servidor pode; as regras barram)', !/\.update\(\{\s*email/.test(accountCode) && !/\.set\(\{[^}]*email/.test(accountCode));
  check('nenhuma chamada do Firebase fica sem tratamento de erro: cada pedido da tela está dentro de um try, e a correção do e-mail termina em catch', ['sendEmailChangeLink', 'submitEmailChange', 'submitPasswordChange'].every(fn => new RegExp('async function ' + fn + '\\([^)]*\\) \\{[\\s\\S]*?\\btry \\{').test(accountCode)) && /callFn\('syncMyEmail'\)[\s\S]*?\.catch\(/.test(accountCode));
  const priv = slice('function openPrivacyPolicy()', 'function openDeleteAccount()');
  check('a privacidade cita o direito de trocar o e-mail e a senha, o e-mail antigo e as cópias de segurança', /Trocar o e-mail do login e a senha/.test(priv) && /O e-mail antigo deixa de ser usado/.test(priv) && /cópias de segurança diárias/.test(priv));
  check('a privacidade não diz mais "Ambas as opções"', !/Ambas as opções/.test(priv) && /Essas opções ficam no fim da aba/.test(priv));
  check('a tela não repete nenhum e-mail antigo de contato (contato@)', !/contato@/.test(accountCode) && !/contato@/.test(priv));

  const plainM = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const secStart = manual.indexOf('id="minha-conta"');
  const sec = plainM(manual.slice(secStart, manual.indexOf('</section>', secStart)));
  check('manual: tem a seção "Minha conta" (#minha-conta)', manual.indexOf('id="minha-conta"') > 0, null);
  check('manual: explica o e-mail novo com link, que a troca só vale depois de tocar no link, que as ligas e o vínculo continuam e que os aparelhos pedem login de novo', /link/.test(sec) && /só vale depois/.test(sec) && /ligas/.test(sec) && /vínculo/.test(sec) && /pedem login de novo/.test(sec), sec.slice(0, 400));
  check('manual: explica o que fazer se o link não chegar (o e-mail novo já tem conta) e quem entra só com o Google', /não chegar/.test(sec) && /já tem uma conta/.test(sec) && /Google/.test(sec) && /suporte@peladanamao\.com\.br/.test(sec), sec.slice(0, 400));
  check('manual: a tabela diz que o dono do sistema e quem entra só com o Google NÃO trocam o e-mail pelo app, e a senha também se troca em Minha conta', /Dono do sistema Não: o e-mail dele está fixo no código/.test(sec) && /Só com o Google Não: o e-mail dessa conta é controlado pelo Google/.test(sec) && /Trocar a senha Em ✉️ Minha conta/.test(sec) && /a senha atual/.test(sec), sec.slice(0, 400));
  check('manual: tem o passo a passo do dono (script trocar-email.js, simulação antes, repetir com --aplicar, chave de administrador, apagar a chave depois)', /trocar-email\.js/.test(sec) && /Simule primeiro/.test(sec) && /repita o comando com --aplicar/.test(sec) && /chave de administrador/.test(sec) && /Apague o arquivo da chave/.test(sec), sec.slice(0, 600));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
