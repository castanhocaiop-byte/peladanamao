'use strict';
// Atalho DO DONO para trocar o e-mail do login de uma conta cuja pessoa PERDEU O ACESSO ao e-mail antigo. Quem ainda tem o e-mail antigo
// troca sozinha, em "Minha conta", no app (o Firebase manda um link ao e-mail novo). É o par do scripts/producao.js: roda no terminal do dono,
// pede confirmações digitadas e não existe nenhuma função na internet capaz de trocar o e-mail de outra pessoa.
//
//   node scripts/trocar-email.js <e-mail antigo> <e-mail novo> --projeto seriebaceoma [--chave arquivo.json] [--aplicar]
//                                [--desvincular-google] [--apagar-conta-vazia]
//
// Sem --aplicar só SIMULA: mostra a conta, as ligas dela e o que seria feito, sem mudar nada. Com --aplicar:
//   1) troca o e-mail do login (Firebase Auth) e tira as sessões abertas (a pessoa entra de novo com o e-mail novo);
//   2) corrige as cópias do e-mail no banco (cadastro e pedidos de vínculo pendentes: functions/account-email.js);
//   3) liga, papel, vínculo com o jogador, dono da liga, foto e convites NÃO mudam: são por uid, e a conta é a mesma.
// Quando o e-mail novo JÁ tem uma conta:
//   - se ela tem liga como jogador ou admin, o atalho recusa (juntar contas é trabalho manual);
//   - se ela está vazia (só pedidos pendentes: a pessoa criou outra conta e ficou esperando), --apagar-conta-vazia a apaga antes.
// Conta que entra SÓ com o Google: o e-mail do Google não é nosso, então o login Google é desvinculado (--desvincular-google) e a pessoa
// passa a entrar com e-mail e senha: "Esqueci minha senha" no app manda o link de senha ao e-mail novo.
//
// PRECISA da chave de administrador do projeto (Console do Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave
// privada), no arquivo --chave, na variável GOOGLE_APPLICATION_CREDENTIALS ou em serviceAccountKey.json na pasta do app (esse nome é
// ignorado pelo Git). Apague o arquivo da chave (e a chave no Console) quando terminar. Guia: manual, seção 26 (atendimento do dono).
const path = require('path');
const { syncEmailCopies } = require('../functions/account-email.js');

const ROOT = path.join(__dirname, '..');
const OWNER_EMAIL = 'castanho.caiop@gmail.com';
const PROJECTS = { seriebaceoma: 'PRODUÇÃO', 'seriebaceoma-staging': 'TESTE' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDER_LABEL = { password: 'e-mail e senha (ou link por e-mail)', 'google.com': 'Google' };
const ACTIVE_ROLES = ['player', 'admin'];
const USAGE = 'Uso: node scripts/trocar-email.js <e-mail antigo> <e-mail novo> --projeto <seriebaceoma|seriebaceoma-staging> [--chave arquivo.json] [--aplicar] [--desvincular-google] [--apagar-conta-vazia]';

const norm = e => String(e == null ? '' : e).trim().toLowerCase();
const saidYes = a => /^(s|sim)$/i.test(String(a == null ? '' : a).trim());

function parseArgs(argv) {
  const out = { emails: [], projeto: '', chave: '', aplicar: false, desvincularGoogle: false, apagarVazia: false, bad: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--projeto' || a === '--chave') {
      const v = argv[i + 1];
      if (v == null || String(v).startsWith('--')) { out.bad = `${a} precisa de um valor`; return out; }
      out[a === '--projeto' ? 'projeto' : 'chave'] = String(v); i++;
    }
    else if (a === '--aplicar') out.aplicar = true;
    else if (a === '--desvincular-google') out.desvincularGoogle = true;
    else if (a === '--apagar-conta-vazia') out.apagarVazia = true;
    else if (a.startsWith('--')) { out.bad = `opção desconhecida: ${a}`; return out; }
    else out.emails.push(a);
  }
  return out;
}

const leaguesOf = doc => Object.entries(doc && doc.leagues && typeof doc.leagues === 'object' ? doc.leagues : {}).map(([id, v]) => ({ id, role: (v && v.role) || '?' }));
const providersOf = u => (u.providerData || []).map(p => p.providerId);
const describeProviders = u => (providersOf(u).map(p => PROVIDER_LABEL[p] || p).join(' + ') || 'nenhum');
const describeLeagues = ls => (ls.length ? ls.map(l => `${l.id} (${l.role})`).join(', ') : 'nenhuma');

// Roda o atalho. `io` traz tudo que toca o mundo de fora (para o teste poder simular): isTTY, ask, connect(projeto, arquivoDaChave)
// → { auth, db }, out, err. Devolve o código de saída.
async function run(argv, io) {
  const a = parseArgs(argv);
  if (a.bad || a.emails.length !== 2 || !PROJECTS[a.projeto]) { io.err((a.bad ? `✗ ${a.bad}\n` : '') + USAGE); return 2; }
  const oldMail = norm(a.emails[0]), newMail = norm(a.emails[1]);
  if (!EMAIL_RE.test(oldMail) || !EMAIL_RE.test(newMail)) { io.err('✗ Um dos dois não parece um e-mail.\n' + USAGE); return 2; }
  if (oldMail === newMail) { io.err('✗ O e-mail antigo e o novo são iguais.'); return 2; }
  if (oldMail === OWNER_EMAIL || newMail === OWNER_EMAIL) {
    io.err('✗ O e-mail do dono do sistema está fixo no código (app, regras e funções): não dá para trocá-lo por aqui.');
    return 1;
  }

  let auth, db;
  try { ({ auth, db } = await io.connect(a.projeto, a.chave)); }
  catch (e) { io.err('✗ ' + (e && e.message ? e.message : 'Não consegui entrar no projeto.')); return 1; }

  io.out('');
  io.out(`Projeto: ${a.projeto} (${PROJECTS[a.projeto]})${a.aplicar ? '' : '   [SIMULAÇÃO: nada será alterado]'}`);

  // 1) a conta de quem perdeu o acesso
  let user;
  try { user = await auth.getUserByEmail(oldMail); }
  catch (e) {
    if (e && e.code === 'auth/user-not-found') { io.err(`✗ Não existe conta com o e-mail antigo ${oldMail}. Confira como a pessoa escreve.`); return 1; }
    io.err('✗ Não consegui consultar a conta: ' + (e && (e.code || e.message))); return 1;
  }
  const userDoc = (await db.doc(`users/${user.uid}`).get()).data() || {};
  const ligas = leaguesOf(userDoc);
  const providers = providersOf(user);
  const googleOnly = providers.length > 0 && providers.every(p => p === 'google.com');
  io.out(`Conta de ${oldMail}: uid ${user.uid}, entra com ${describeProviders(user)}, criada em ${user.metadata && user.metadata.creationTime ? user.metadata.creationTime : '?'}.`);
  io.out(`  Ligas: ${describeLeagues(ligas)}`);

  if (googleOnly && !a.desvincularGoogle) {
    io.err('✗ Esta conta entra SÓ com o Google, e o e-mail do Google não é nosso. Para trocar, o login Google precisa ser desvinculado e a pessoa passa a entrar com e-mail e senha (ela pede a senha em "Esqueci minha senha"). Se é isso que você quer, repita o comando com --desvincular-google.');
    return 1;
  }

  // 2) o e-mail novo já tem conta?
  let dup = null, dupLigas = [];
  try {
    dup = await auth.getUserByEmail(newMail);
  } catch (e) {
    if (!(e && e.code === 'auth/user-not-found')) { io.err('✗ Não consegui consultar o e-mail novo: ' + (e && (e.code || e.message))); return 1; }
  }
  if (dup) {
    const dupDoc = (await db.doc(`users/${dup.uid}`).get()).data() || {};
    dupLigas = leaguesOf(dupDoc);
    io.out(`O e-mail novo ${newMail} JÁ tem uma conta: uid ${dup.uid}, entra com ${describeProviders(dup)}. Ligas dela: ${describeLeagues(dupLigas)}.`);
    const ativas = dupLigas.filter(l => ACTIVE_ROLES.includes(l.role));
    if (ativas.length) {
      io.err(`✗ Essa conta já participa de ${ativas.map(l => l.id).join(', ')}. Juntar duas contas com dados é trabalho manual: nada foi alterado.`);
      return 1;
    }
    if (dup.uid === user.uid) { io.err('✗ O e-mail novo já é o desta mesma conta.'); return 1; }
    if (!a.apagarVazia) {
      io.err('✗ Essa conta está vazia (só tem pedidos pendentes), mas ela ocupa o e-mail novo. Para apagá-la antes da troca, repita o comando com --apagar-conta-vazia.');
      return 1;
    }
  }

  // 3) o plano
  io.out('');
  io.out('O que será feito:');
  if (dup) io.out(`  - APAGAR a conta vazia que ocupa ${newMail} (uid ${dup.uid}) e os pedidos pendentes dela`);
  io.out(`  - trocar o e-mail do login ${oldMail} -> ${newMail}${googleOnly || (a.desvincularGoogle && providers.includes('google.com')) ? ', desvinculando o login Google' : ''}`);
  io.out('  - encerrar as sessões abertas dessa conta (a pessoa entra de novo com o e-mail novo)');
  io.out('  - corrigir o e-mail copiado no cadastro e nos pedidos de vínculo pendentes');
  io.out('  - ligas, papéis, vínculo com o jogador e convites continuam como estão (a conta é a mesma)');
  if (!a.aplicar) {
    io.out('\nIsto foi só uma simulação: nada foi alterado. Para aplicar, repita o comando com --aplicar.');
    return 0;
  }

  // 4) confirmações
  if (!io.isTTY) { io.err('✗ Para aplicar, rode o comando num terminal interativo (ele pede confirmações).'); return 1; }
  const again = norm(await io.ask(`\nDigite o e-mail NOVO outra vez para confirmar (${newMail}): `));
  if (again !== newMail) { io.out('Não bateu. Cancelado. Nada foi alterado.'); return 1; }
  if (PROJECTS[a.projeto] === 'PRODUÇÃO') {
    const sure = await io.ask('Você confirmou com a pessoa, por OUTRO canal (WhatsApp, pessoalmente), que este e-mail novo é dela? (S/N) ');
    if (!saidYes(sure)) { io.out('Cancelado. Nada foi alterado.'); return 1; }
  }
  const typed = String(await io.ask('Digite TROCAR para aplicar: ')).trim().toUpperCase();
  if (typed !== 'TROCAR') { io.out('Cancelado. Nada foi alterado.'); return 1; }

  // 5) aplica (na ordem em que uma falha no meio deixa tudo seguro para repetir)
  try {
    if (dup) {
      for (const l of dupLigas) await db.doc(`leagues/${l.id}/link_requests/${dup.uid}`).delete();
      await db.recursiveDelete(db.doc(`users/${dup.uid}`));
      await auth.deleteUser(dup.uid);
      io.out('  ok: conta vazia apagada');
    }
    const change = { email: newMail, emailVerified: false };
    if (providers.includes('google.com') && a.desvincularGoogle) change.providersToUnlink = ['google.com'];
    await auth.updateUser(user.uid, change);
    io.out('  ok: e-mail do login trocado');
    await auth.revokeRefreshTokens(user.uid);
    io.out('  ok: sessões abertas encerradas');
    const r = await syncEmailCopies(db, user.uid, newMail);
    io.out(`  ok: cópias do e-mail corrigidas (cadastro ${r.changed ? 'sim' : 'já estava certo'}, ${r.linkRequests} pedido(s) de vínculo)`);
  } catch (e) {
    io.err('✗ Parou no meio: ' + (e && (e.code || e.message)) + '. Confira a conta no Console do Firebase; repetir o comando é seguro.');
    return 1;
  }

  io.out('');
  io.out(`Pronto. Avise a pessoa: entre no app com ${newMail}. Se ela não lembra a senha (ou entrava só com o Google), toque em "Esqueci minha senha": o link de senha vai para o e-mail novo.`);
  io.out('Confira com ela se o e-mail novo estava escrito certo: quem for dono dele consegue pedir a senha.');
  io.out('Apague o arquivo da chave de administrador (e a chave no Console do Firebase) se ela foi criada só para isto.');
  return 0;
}

// ── o que toca o mundo de fora (só no uso de verdade) ─────────────────────────────────────────────────�
function ask(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

// Entra no projeto com a chave de administrador. A chave tem de ser do MESMO projeto pedido em --projeto (erro clássico: usar a de teste na
// produção ou o contrário). Nada da chave é impresso.
function connect(project, keyFile) {
  const fs = require('fs');
  const file = keyFile || process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(ROOT, 'serviceAccountKey.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Não achei a chave de administrador (${file}). Baixe no Console do Firebase (Configurações do projeto > Contas de serviço > Gerar nova chave privada) e aponte com --chave.`);
  }
  let key;
  try { key = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { throw new Error(`O arquivo da chave (${file}) não é um JSON válido.`); }
  if (!key || key.type !== 'service_account') throw new Error(`O arquivo (${file}) não é uma chave de conta de serviço.`);
  if (key.project_id !== project) throw new Error(`A chave é do projeto "${key.project_id}", mas você pediu "${project}". Use a chave do projeto certo.`);
  const admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: project }, 'trocar-email');
  return { auth: app.auth(), db: app.firestore() };
}

async function main() {
  const code = await run(process.argv.slice(2), {
    isTTY: !!process.stdin.isTTY, ask, connect, out: s => console.log(s), err: s => console.error(s),
  });
  process.exitCode = code;
}

if (require.main === module) main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
module.exports = { run, parseArgs, leaguesOf, connect, PROJECTS, OWNER_EMAIL };
