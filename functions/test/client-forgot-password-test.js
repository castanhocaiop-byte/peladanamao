// "Esqueci minha senha" (index.html): extrai o código real e o executa num ambiente simulado, sem navegador. O Firebase não diz se o e-mail tem conta
// (proteção ligada nos dois ambientes: endereço desconhecido também devolve sucesso), então um endereço digitado errado mostrava "Email enviado!" e nada
// chegava. Agora o aviso diz "se existir uma conta", nunca revela quem tem cadastro e lembra que quem entra só com o Google não tem senha.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8');
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
const forgotSrc = slice('// "Esqueci minha senha": o Firebase não diz', '// Texto em português para quem não conseguiu entrar com o Google');
const errSrc = slice('function _firebaseErrMsg(code) {', 'async function requestProfileLink()');
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function makeEnv({ emailValue = '', reset = async () => {}, errEl = true, emailEl = true } = {}) {
  const calls = { reset: [] };
  const err = { textContent: '', style: { color: '' } };
  const document = { getElementById: id => (id === 'li-email' ? (emailEl ? { value: emailValue } : null) : id === 'login-err' ? (errEl ? err : null) : null) };
  const AUTH = { sendPasswordResetEmail: async e => { calls.reset.push(e); return reset(e); } };
  const api = new Function('document', 'AUTH', errSrc + '\n' + forgotSrc + '\nreturn { doForgotPassword, _firebaseErrMsg, FORGOT_PASSWORD_OK };')(document, AUTH);
  return { api, calls, err };
}
const OK = 'Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. Confira a caixa de entrada e o spam. Quem entra com o Google não tem senha: use o botão do Google.';
const codeErr = code => async () => { const e = new Error('texto técnico do Firebase'); e.code = code; throw e; };

(async () => {
  // ── e-mail vazio ──
  for (const [rotulo, valor] of [['vazio', ''], ['só espaços', '   '], ['campo ausente', undefined]]) {
    const t = makeEnv({ emailValue: valor === undefined ? '' : valor, emailEl: valor !== undefined });
    await t.api.doForgotPassword();
    check(`e-mail ${rotulo}: pede o e-mail, em vermelho, e NÃO manda nada ao Firebase`, t.calls.reset.length === 0 && t.err.textContent === 'Digite seu email no campo acima primeiro.' && t.err.style.color === 'var(--danger)', { calls: t.calls, err: t.err });
  }
  // ── com e-mail ──
  let t = makeEnv({ emailValue: '  ana@exemplo.com  ' });
  await t.api.doForgotPassword();
  check('e-mail preenchido: pede ao Firebase com o e-mail SEM os espaços das pontas, e mostra o aviso novo, em verde', JSON.stringify(t.calls.reset) === JSON.stringify(['ana@exemplo.com']) && t.err.textContent === OK && t.err.style.color === 'var(--accent)', { calls: t.calls, err: t.err });
  check('o aviso novo diz "se existir uma conta", manda conferir a caixa de entrada e o spam e orienta quem entra com o Google (não tem senha)', /Se existir uma conta com esse e-mail/.test(t.err.textContent) && /Confira a caixa de entrada e o spam/.test(t.err.textContent) && /Quem entra com o Google não tem senha: use o botão do Google/.test(t.err.textContent), t.err.textContent);
  check('o aviso NÃO afirma que enviou ("Email enviado!" saiu): quem digita o endereço errado não é enganado', !/Email enviado/i.test(t.err.textContent) && !/Email enviado/.test(html), t.err.textContent);
  // ── nunca revela quem tem conta ──
  t = makeEnv({ emailValue: 'ninguem@exemplo.com', reset: codeErr('auth/user-not-found') });
  await t.api.doForgotPassword();
  check('se o Firebase um dia responder "usuário não encontrado": mostra o MESMO aviso em verde (nunca revela quem tem conta)', t.err.textContent === OK && t.err.style.color === 'var(--accent)' && !/não encontrado/i.test(t.err.textContent), t.err);
  const ok1 = makeEnv({ emailValue: 'a@b.com' }); await ok1.api.doForgotPassword();
  check('com conta e sem conta o texto na tela é IDÊNTICO (nada muda conforme o e-mail existe ou não)', ok1.err.textContent === t.err.textContent && ok1.err.style.color === t.err.style.color);
  // ── outros erros ──
  for (const [code, msg] of [['auth/invalid-email', 'Email inválido.'], ['auth/too-many-requests', 'Muitas tentativas. Tente mais tarde.'], ['auth/network-request-failed', 'Sem conexão com a internet. Confira a rede e tente de novo.'], ['auth/algo-novo', 'Erro de autenticação.']]) {
    const e = makeEnv({ emailValue: 'a@b.com', reset: codeErr(code) });
    await e.api.doForgotPassword();
    check(`erro ${code}: mensagem em português, em vermelho, sem o texto técnico (${msg})`, e.err.textContent === msg && e.err.style.color === 'var(--danger)' && !/Firebase|texto técnico/.test(e.err.textContent), e.err);
  }
  for (const [rotulo, jogar] of [['sem código', async () => { throw new Error('sem código'); }], ['erro vazio', async () => { throw undefined; }], ['erro nulo', async () => { throw null; }]]) {
    const e = makeEnv({ emailValue: 'a@b.com', reset: jogar });
    await e.api.doForgotPassword();
    check(`erro ${rotulo}: "Erro de autenticação.", em vermelho, e nada quebra`, e.err.textContent === 'Erro de autenticação.' && e.err.style.color === 'var(--danger)', e.err);
  }
  // ── tela sem o campo de mensagem ──
  let jogou = false;
  try { for (const v of ['', 'a@b.com']) await makeEnv({ emailValue: v, errEl: false }).api.doForgotPassword(); await makeEnv({ emailValue: 'a@b.com', errEl: false, reset: codeErr('auth/user-not-found') }).api.doForgotPassword(); await makeEnv({ emailValue: 'a@b.com', errEl: false, reset: codeErr('auth/invalid-email') }).api.doForgotPassword(); } catch (_) { jogou = true; }
  check('sem o campo de mensagem na tela (login-err): nenhum caminho quebra', !jogou);
  // ── mensagens do login que já existiam continuam iguais ──
  const m = makeEnv().api._firebaseErrMsg;
  check('as mensagens de erro do login que já existiam não mudaram', m('auth/user-not-found') === 'Email não encontrado.' && m('auth/wrong-password') === 'Senha incorreta.' && m('auth/invalid-credential') === 'Email ou senha inválidos.' && m('auth/email-already-in-use') === 'Email já cadastrado. Tente entrar.' && m('auth/weak-password') === 'Senha muito fraca (mínimo 6 caracteres).' && m('auth/invalid-email') === 'Email inválido.' && m('auth/too-many-requests') === 'Muitas tentativas. Tente mais tarde.' && m('x') === 'Erro de autenticação.' && m(undefined) === 'Erro de autenticação.');
  // ── como está ligado no app ──
  const login = slice('function vLogin() {', 'function slugify(');
  check('o botão "Esqueci minha senha" continua na tela de login, uma vez só, chamando doForgotPassword() (que só existe para ele)', login.split('onclick="doForgotPassword()"').length - 1 === 1 && login.includes('>Esqueci minha senha<') && html.split('doForgotPassword()').length - 1 === 2, html.split('doForgotPassword()').length - 1);
  check('o código só chama o envio de redefinição do Firebase (sendPasswordResetEmail) e não guarda nem lê a senha', (html.match(/sendPasswordResetEmail\(/g) || []).length === 1 && !/password.{0,40}localStorage|localStorage.{0,40}password/i.test(forgotSrc));
  // ── manual ──
  const sec = plain(manual.slice(manual.indexOf('<h3>Esqueci minha senha</h3>'), manual.indexOf('<h3 id="endereco-login-google">')));
  check('manual: a tabela traz o aviso novo (se existir uma conta…, caixa de entrada e spam, quem entra com o Google) e diz que e-mail errado não recebe nada', /Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha/.test(sec) && /Confira a caixa de entrada e o spam/.test(sec) && /Quem entra com o Google não tem senha: use o botão do Google/.test(sec) && /se o e-mail foi digitado errado, nada chega/.test(sec), sec.slice(0, 400));
  check('manual: o quadro explica por que o aviso diz "se existir uma conta" (não promete envio), que antes dizia "Email enviado!", que o mesmo texto vale se o Firebase disser "não encontrado" e que quem entra só com o Google não tem senha', /não afirma que o e-mail foi enviado/.test(sec) && /antes dizia "Email enviado!"/.test(sec) && /o app mostra a mesma mensagem/.test(sec) && /Quem entra só com o Google não tem senha para redefinir/.test(sec), sec.slice(-700));
  check('manual: o texto antigo "Email enviado! Confira sua caixa de entrada" saiu da tabela', !/<em>Email enviado! Confira sua caixa de entrada/.test(manual));

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
