// Atalho do dono para trocar o e-mail do login de quem perdeu o acesso ao e-mail antigo (scripts/trocar-email.js).
// Roda o código real com um Firebase Auth e um Firestore de mentira, em memória: confere as recusas (argumentos, e-mail do dono,
// conta que não existe, e-mail novo já usado), que a simulação não muda nada, as confirmações digitadas, o que a troca faz
// (login, sessões, cópias do e-mail) e o que ela NÃO toca (ligas, papéis, vínculos), e a leitura da chave de administrador.
const fs = require('fs');
const os = require('os');
const path = require('path');
const tool = require('../../scripts/trocar-email.js');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

// ── mundo de mentira: login (Firebase Auth) + banco (Firestore) ──────────────────────────────────
function makeWorld() {
  const users = new Map();    // uid -> registro do login
  const store = new Map();    // caminho -> documento
  const calls = [];           // o que foi pedido ao login: [nome, ...argumentos]
  const codeErr = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  const auth = {
    getUserByEmail: async email => {
      calls.push(['getUserByEmail', email]);
      const u = [...users.values()].find(x => String(x.email || '').toLowerCase() === String(email).toLowerCase());
      if (!u) throw codeErr('auth/user-not-found');
      return clone(u);
    },
    updateUser: async (uid, change) => {
      calls.push(['updateUser', uid, clone(change)]);
      if (world.failUpdate) throw codeErr(world.failUpdate);
      const u = users.get(uid);
      if (!u) throw codeErr('auth/user-not-found');
      if (change.email && [...users.values()].some(x => x.uid !== uid && String(x.email).toLowerCase() === change.email.toLowerCase())) throw codeErr('auth/email-already-exists');
      if (change.email) u.email = change.email;
      if (change.emailVerified !== undefined) u.emailVerified = change.emailVerified;
      if (change.providersToUnlink) u.providerData = u.providerData.filter(p => !change.providersToUnlink.includes(p.providerId));
    },
    deleteUser: async uid => { calls.push(['deleteUser', uid]); users.delete(uid); },
    revokeRefreshTokens: async uid => { calls.push(['revokeRefreshTokens', uid]); users.get(uid).tokensRevokedAt = 'agora'; },
  };
  const db = {
    doc: p => ({
      path: p,
      get: async () => ({ exists: store.has(p), data: () => (store.has(p) ? clone(store.get(p)) : undefined) }),
      update: async obj => { if (!store.has(p)) throw new Error('NOT_FOUND ' + p); store.set(p, { ...store.get(p), ...clone(obj) }); },
      delete: async () => { store.delete(p); },
    }),
    recursiveDelete: async ref => { for (const k of [...store.keys()]) if (k === ref.path || k.startsWith(ref.path + '/')) store.delete(k); },
  };
  const world = { users, store, calls, auth, db, failUpdate: null };
  return world;
}
const login = (uid, email, providers = ['password']) => ({ uid, email, emailVerified: false, providerData: providers.map(providerId => ({ providerId })), metadata: { creationTime: 'Mon, 01 Sep 2026 10:00:00 GMT' } });

// Cenário padrão: Ana (e-mail e senha, jogadora na liga L e com pedido pendente na liga B) perdeu o acesso ao e-mail antigo.
function seed() {
  const w = makeWorld();
  w.users.set('ana', login('ana', 'ana.velha@x.com'));
  w.store.set('users/ana', { email: 'ana.velha@x.com', role: 'pending', displayName: 'Ana', fcmTokens: ['tk1'], playerKey: 'ana', leagues: { L: { role: 'player', playerKey: 'ana', joinedAt: '2026-09-01' }, B: { role: 'pending' } } });
  w.store.set('leagues/B/link_requests/ana', { uid: 'ana', email: 'ana.velha@x.com', status: 'pending', whatsapp: '11999990000' });
  w.store.set('leagues/L', { name: 'Liga L', ownerId: 'ana' });
  w.store.set('leagues/L/invite_tokens/tok1', { role: 'player', used: true, usedBy: 'ana' });
  w.users.set('bia', login('bia', 'bia@x.com'));
  w.store.set('users/bia', { email: 'bia@x.com', role: 'pending', leagues: { L: { role: 'admin' } } });
  return w;
}

// Roda o atalho com respostas prontas. `answers` é a fila das respostas digitadas (uma por pergunta).
async function go(world, argv, { answers = [], isTTY = true, connectError = null } = {}) {
  const out = [], err = [], asked = [];
  const queue = [...answers];
  const io = {
    isTTY,
    ask: async q => { asked.push(q); return queue.length ? queue.shift() : ''; },
    connect: async (project, keyFile) => { io.connected = { project, keyFile }; if (connectError) throw new Error(connectError); return { auth: world.auth, db: world.db }; },
    out: s => out.push(s), err: s => err.push(s),
  };
  const code = await tool.run(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n'), asked, io };
}
const PROD = ['ana.velha@x.com', 'ana.nova@x.com', '--projeto', 'seriebaceoma'];
const TESTE = ['ana.velha@x.com', 'ana.nova@x.com', '--projeto', 'seriebaceoma-staging'];
const snap = w => JSON.stringify([[...w.users.entries()], [...w.store.entries()]]);
const mutating = w => w.calls.filter(c => c[0] !== 'getUserByEmail');

(async () => {
  // ══ 1. ARGUMENTOS ═══════════════════════════════════════════════════════════════════════════════
  let w = seed(), r;
  r = await go(w, []);
  check('sem argumentos: mostra como usar e sai com 2', r.code === 2 && /Uso: node scripts\/trocar-email\.js/.test(r.err), r);
  r = await go(w, ['a@x.com', 'b@x.com']);
  check('sem --projeto: recusa (nunca escolhe o projeto sozinho)', r.code === 2 && /Uso:/.test(r.err) && !r.io.connected, r);
  r = await go(w, ['a@x.com', 'b@x.com', '--projeto', 'outro-projeto']);
  check('projeto desconhecido: recusa', r.code === 2 && !r.io.connected, r);
  r = await go(w, ['a@x.com', '--projeto', 'seriebaceoma']);
  check('só um e-mail: recusa', r.code === 2 && !r.io.connected, r);
  r = await go(w, ['a@x.com', 'b@x.com', 'c@x.com', '--projeto', 'seriebaceoma']);
  check('três e-mails: recusa', r.code === 2 && !r.io.connected, r);
  r = await go(w, ['a@x.com', 'b@x.com', '--projeto']);
  check('--projeto sem valor: recusa', r.code === 2 && /precisa de um valor/.test(r.err), r);
  r = await go(w, ['a@x.com', 'b@x.com', '--projeto', 'seriebaceoma', '--chave', '--aplicar']);
  check('--chave sem valor (o próximo é outra opção): recusa', r.code === 2 && /precisa de um valor/.test(r.err), r);
  r = await go(w, ['a@x.com', 'b@x.com', '--projeto', 'seriebaceoma', '--apagar-tudo']);
  check('opção desconhecida: recusa', r.code === 2 && /opção desconhecida/.test(r.err), r);
  r = await go(w, ['isso-nao-e-email', 'b@x.com', '--projeto', 'seriebaceoma']);
  check('texto que não é e-mail: recusa', r.code === 2 && /não parece um e-mail/.test(r.err) && !r.io.connected, r);
  r = await go(w, ['a@x.com', 'A@X.com ', '--projeto', 'seriebaceoma']);
  check('os dois e-mails iguais (mesmo mudando maiúsculas e espaços): recusa', r.code === 2 && /iguais/.test(r.err) && !r.io.connected, r);
  r = await go(w, ['castanho.caiop@gmail.com', 'b@x.com', '--projeto', 'seriebaceoma']);
  check('e-mail do dono do sistema como ANTIGO: recusa (fixo no código)', r.code === 1 && /dono do sistema/.test(r.err) && !r.io.connected, r);
  r = await go(w, ['a@x.com', 'Castanho.Caiop@Gmail.com', '--projeto', 'seriebaceoma']);
  check('e-mail do dono do sistema como NOVO (até com maiúsculas): recusa', r.code === 1 && /dono do sistema/.test(r.err) && !r.io.connected, r);

  // ══ 2. CONEXÃO E CONTA ═════════════════════════════════════════════════════════════════════════
  w = seed();
  r = await go(w, PROD, { connectError: 'A chave é do projeto "outro"' });
  check('falha ao entrar no projeto: mostra o motivo e não mexe em nada', r.code === 1 && /A chave é do projeto/.test(r.err) && mutating(w).length === 0, r);
  r = await go(w, [...PROD, '--chave', 'C:/x/chave.json']);
  check('passa o projeto e o arquivo da chave para a conexão', r.io.connected.project === 'seriebaceoma' && r.io.connected.keyFile === 'C:/x/chave.json', r.io.connected);
  w = seed();
  r = await go(w, ['ninguem@x.com', 'novo@x.com', '--projeto', 'seriebaceoma']);
  check('e-mail antigo sem conta: recusa e não mexe em nada', r.code === 1 && /Não existe conta com o e-mail antigo ninguem@x\.com/.test(r.err) && mutating(w).length === 0, r);

  // ══ 3. SIMULAÇÃO (sem --aplicar) ═══════════════════════════════════════════════════════════════
  w = seed();
  const fotoAntes = snap(w);
  r = await go(w, PROD, { isTTY: false });
  check('simulação: sai com 0, avisa que nada foi alterado e mostra como aplicar', r.code === 0 && /SIMULAÇÃO/.test(r.out) && /só uma simulação: nada foi alterado/.test(r.out) && /--aplicar/.test(r.out), r.out);
  check('simulação: mostra o projeto, o uid, como a conta entra e as ligas com o papel', /seriebaceoma \(PRODUÇÃO\)/.test(r.out) && /uid ana/.test(r.out) && /e-mail e senha/.test(r.out) && /L \(player\), B \(pending\)/.test(r.out), r.out);
  check('simulação: descreve o que seria feito', /trocar o e-mail do login ana\.velha@x\.com -> ana\.nova@x\.com/.test(r.out) && /encerrar as sessões/.test(r.out) && /corrigir o e-mail copiado/.test(r.out), r.out);
  check('simulação: não muda NADA (login, banco) e não pergunta nada', snap(w) === fotoAntes && mutating(w).length === 0 && r.asked.length === 0, mutating(w));
  check('simulação: funciona sem terminal interativo (não precisa de confirmação)', r.code === 0);
  r = await go(w, ['  ANA.Velha@X.com ', ' Ana.Nova@X.COM', '--projeto', 'seriebaceoma']);
  check('os e-mails são lidos sem diferenciar maiúsculas nem espaços', r.code === 0 && /ana\.velha@x\.com -> ana\.nova@x\.com/.test(r.out), r.out);

  // ══ 4. APLICAR: CONFIRMAÇÕES ═══════════════════════════════════════════════════════════════════
  w = seed();
  r = await go(w, [...PROD, '--aplicar'], { isTTY: false });
  check('aplicar sem terminal interativo: recusa e não muda nada', r.code === 1 && /terminal interativo/.test(r.err) && mutating(w).length === 0, r);
  w = seed();
  r = await go(w, [...PROD, '--aplicar'], { answers: ['outro@x.com'] });
  check('aplicar: e-mail novo digitado errado cancela e não muda nada', r.code === 1 && /Cancelado/.test(r.out) && mutating(w).length === 0 && r.asked.length === 1, r);
  w = seed();
  r = await go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'N', 'TROCAR'] });
  check('aplicar na PRODUÇÃO: sem confirmar por outro canal cancela', r.code === 1 && /Cancelado/.test(r.out) && mutating(w).length === 0, r);
  w = seed();
  r = await go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'talvez'] });
  check('aplicar: palavra final diferente de TROCAR cancela e não muda nada', r.code === 1 && /Cancelado/.test(r.out) && mutating(w).length === 0, r);
  w = seed();
  r = await go(w, [...PROD, '--aplicar'], { answers: ['  ANA.NOVA@x.com ', 'sim', ' trocar '] });
  check('aplicar: o e-mail novo digitado outra vez, S/SIM e TROCAR valem sem diferenciar maiúsculas nem espaços', r.code === 0, r);
  w = seed();
  r = await go(w, [...TESTE, '--aplicar'], { answers: ['ana.nova@x.com', 'TROCAR'] });
  check('aplicar no projeto de TESTE: não pergunta pelo outro canal (só PRODUÇÃO pergunta)', r.code === 0 && r.asked.length === 2 && !/OUTRO canal/.test(r.asked.join('|')), r.asked);
  check('aplicar na PRODUÇÃO: as perguntas são e-mail novo, outro canal e TROCAR', (await go(seed(), [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] })).asked.length === 3);

  // ══ 5. APLICAR: O QUE A TROCA FAZ ══════════════════════════════════════════════════════════════
  w = seed();
  const ligasAntes = JSON.stringify([w.store.get('leagues/L'), w.store.get('leagues/L/invite_tokens/tok1'), w.users.get('bia'), w.store.get('users/bia')]);
  r = await go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('troca: sai com 0 e conta o que fez', r.code === 0 && /ok: e-mail do login trocado/.test(r.out) && /ok: sessões abertas encerradas/.test(r.out) && /ok: cópias do e-mail corrigidas/.test(r.out), r);
  check('troca: o login passa a ter o e-mail novo, ainda NÃO verificado', w.users.get('ana').email === 'ana.nova@x.com' && w.users.get('ana').emailVerified === false, w.users.get('ana'));
  check('troca: as sessões abertas dessa conta são encerradas', w.users.get('ana').tokensRevokedAt === 'agora' && w.calls.some(c => c[0] === 'revokeRefreshTokens' && c[1] === 'ana'));
  check('troca: a cópia do e-mail no cadastro e no pedido de vínculo pendente é corrigida', w.store.get('users/ana').email === 'ana.nova@x.com' && w.store.get('leagues/B/link_requests/ana').email === 'ana.nova@x.com', [w.store.get('users/ana'), w.store.get('leagues/B/link_requests/ana')]);
  check('troca: o e-mail antigo não sobra em lugar nenhum desta conta', !JSON.stringify([w.users.get('ana'), w.store.get('users/ana'), w.store.get('leagues/B/link_requests/ana')]).includes('ana.velha'));
  check('troca: papéis, ligas, vínculo com o jogador, nome e notificações da conta ficam como estavam', (() => { const u = w.store.get('users/ana'); return u.role === 'pending' && u.displayName === 'Ana' && u.playerKey === 'ana' && u.fcmTokens[0] === 'tk1' && u.leagues.L.role === 'player' && u.leagues.L.playerKey === 'ana' && u.leagues.B.role === 'pending'; })(), w.store.get('users/ana'));
  check('troca: a liga, o convite e as outras contas não são tocados', ligasAntes === JSON.stringify([w.store.get('leagues/L'), w.store.get('leagues/L/invite_tokens/tok1'), w.users.get('bia'), w.store.get('users/bia')]));
  check('troca: só pede ao login a troca de e-mail desta conta (sem apagar nem desvincular nada)', mutating(w).filter(c => c[0] === 'updateUser').length === 1 && !mutating(w).some(c => c[0] === 'deleteUser') && !w.calls.some(c => c[0] === 'updateUser' && c[2].providersToUnlink), mutating(w));
  check('troca: manda o e-mail em minúsculas e emailVerified=false', (c => c && c[2].email === 'ana.nova@x.com' && c[2].emailVerified === false)(w.calls.find(c => c[0] === 'updateUser')));
  check('troca: diz à pessoa o que fazer (entrar com o e-mail novo, "Esqueci minha senha") e lembra de conferir o e-mail e apagar a chave', /entre no app com ana\.nova@x\.com/.test(r.out) && /Esqueci minha senha/.test(r.out) && /escrito certo/.test(r.out) && /Apague o arquivo da chave/.test(r.out), r.out);

  // ══ 6. CONTA QUE ENTRA SÓ COM O GOOGLE ═════════════════════════════════════════════════════════
  w = seed(); w.users.set('ana', login('ana', 'ana.velha@x.com', ['google.com']));
  r = await go(w, PROD);
  check('só Google, sem --desvincular-google: recusa e explica (e não muda nada)', r.code === 1 && /SÓ com o Google/.test(r.err) && /--desvincular-google/.test(r.err) && mutating(w).length === 0, r);
  r = await go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('só Google, mesmo com --aplicar, sem a opção: recusa antes de perguntar qualquer coisa', r.code === 1 && r.asked.length === 0 && mutating(w).length === 0, r);
  r = await go(w, [...PROD, '--desvincular-google']);
  check('só Google, simulação com a opção: o plano diz que desvincula o login Google', r.code === 0 && /desvinculando o login Google/.test(r.out) && mutating(w).length === 0, r.out);
  r = await go(w, [...PROD, '--desvincular-google', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('só Google com --desvincular-google: troca o e-mail E tira o login Google da conta', r.code === 0 && w.users.get('ana').email === 'ana.nova@x.com' && !w.users.get('ana').providerData.some(p => p.providerId === 'google.com'), w.users.get('ana'));
  w = seed(); w.users.set('ana', login('ana', 'ana.velha@x.com', ['password', 'google.com']));
  r = await go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('conta com senha E Google, sem a opção: troca o e-mail e deixa o Google vinculado', r.code === 0 && w.users.get('ana').providerData.length === 2, w.users.get('ana'));
  w = seed(); w.users.set('ana', login('ana', 'ana.velha@x.com', ['password', 'google.com']));
  r = await go(w, [...PROD, '--desvincular-google', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('conta com senha E Google, com a opção: tira só o Google e mantém a senha', r.code === 0 && w.users.get('ana').providerData.length === 1 && w.users.get('ana').providerData[0].providerId === 'password', w.users.get('ana'));
  w = seed();
  r = await go(w, [...PROD, '--desvincular-google', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('a opção --desvincular-google numa conta sem Google não faz nada de extra', r.code === 0 && !w.calls.some(c => c[0] === 'updateUser' && c[2].providersToUnlink), mutating(w));

  // ══ 7. O E-MAIL NOVO JÁ TEM CONTA ══════════════════════════════════════════════════════════════
  w = seed();
  w.users.set('ana2', login('ana2', 'ana.nova@x.com'));
  w.store.set('users/ana2', { email: 'ana.nova@x.com', role: 'pending', leagues: { L: { role: 'player' } } });
  r = await go(w, [...PROD, '--apagar-conta-vazia', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('e-mail novo com conta que já é jogadora/admin de uma liga: recusa, mesmo com --apagar-conta-vazia, e não muda nada', r.code === 1 && /já participa de L/.test(r.err) && mutating(w).length === 0 && r.asked.length === 0, r);
  w = seed();
  w.users.set('ana2', login('ana2', 'ana.nova@x.com'));
  w.store.set('users/ana2', { email: 'ana.nova@x.com', role: 'pending', leagues: { B: { role: 'admin' } } });
  r = await go(w, [...PROD, '--apagar-conta-vazia']);
  check('e-mail novo com conta admin: também recusa', r.code === 1 && /já participa de B/.test(r.err), r);

  w = seed();
  w.users.set('ana2', login('ana2', 'ana.nova@x.com'));
  w.store.set('users/ana2', { email: 'ana.nova@x.com', role: 'pending', leagues: { B: { role: 'pending' } } });
  w.store.set('leagues/B/link_requests/ana2', { uid: 'ana2', email: 'ana.nova@x.com', status: 'pending' });
  r = await go(w, PROD);
  check('e-mail novo com conta vazia (só pedidos pendentes), sem --apagar-conta-vazia: recusa e explica a opção', r.code === 1 && /está vazia/.test(r.err) && /--apagar-conta-vazia/.test(r.err) && mutating(w).length === 0, r);
  const antesVazia = snap(w);
  r = await go(w, [...PROD, '--apagar-conta-vazia']);
  check('conta vazia, simulação: mostra o que seria apagado e não muda nada', r.code === 0 && /APAGAR a conta vazia que ocupa ana\.nova@x\.com \(uid ana2\)/.test(r.out) && snap(w) === antesVazia && mutating(w).length === 0, r.out);
  r = await go(w, [...PROD, '--apagar-conta-vazia', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('conta vazia, aplicando: apaga o login, o cadastro e os pedidos dela ANTES de trocar', r.code === 0 && !w.users.has('ana2') && !w.store.has('users/ana2') && !w.store.has('leagues/B/link_requests/ana2'), [...w.users.keys()]);
  check('conta vazia, aplicando: a conta da pessoa ganha o e-mail novo e o pedido pendente dela é mantido e corrigido', w.users.get('ana').email === 'ana.nova@x.com' && w.store.get('leagues/B/link_requests/ana').email === 'ana.nova@x.com' && w.store.get('users/ana').leagues.L.role === 'player', [w.users.get('ana'), w.store.get('leagues/B/link_requests/ana')]);
  check('conta vazia, aplicando: apagou a conta vazia antes de trocar o e-mail (ordem das chamadas)', (() => { const names = mutating(w).map(c => c[0] + ':' + c[1]); return names.indexOf('deleteUser:ana2') >= 0 && names.indexOf('deleteUser:ana2') < names.indexOf('updateUser:ana'); })(), mutating(w));
  check('conta vazia, aplicando: a conta da própria pessoa e a outra conta (bia) não foram apagadas', w.users.has('ana') && w.users.has('bia') && w.store.has('users/ana') && w.store.has('users/bia'));
  w = seed();
  w.users.set('ana2', login('ana2', 'ana.nova@x.com'));      // login sem cadastro no banco (nunca entrou numa liga)
  r = await go(w, [...PROD, '--apagar-conta-vazia', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('conta nova sem cadastro no banco também conta como vazia e é apagada', r.code === 0 && !w.users.has('ana2') && w.users.get('ana').email === 'ana.nova@x.com', r);

  // ══ 8. FALHA NO MEIO ═══════════════════════════════════════════════════════════════════════════
  w = seed(); w.failUpdate = 'auth/internal-error';
  r = await go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  check('falha ao trocar o login: avisa que parou no meio, diz que repetir é seguro e não deixa a cópia do e-mail adiantada', r.code === 1 && /Parou no meio/.test(r.err) && /repetir o comando é seguro/.test(r.err) && w.store.get('users/ana').email === 'ana.velha@x.com' && w.users.get('ana').email === 'ana.velha@x.com', r);
  w = seed(); w.users.set('ana2', login('ana2', 'ana.nova@x.com')); w.store.set('users/ana2', { email: 'ana.nova@x.com', leagues: {} }); w.failUpdate = 'auth/internal-error';
  r = await go(w, [...PROD, '--apagar-conta-vazia', '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] });
  const rr = await (async () => { w.failUpdate = null; return go(w, [...PROD, '--aplicar'], { answers: ['ana.nova@x.com', 'S', 'TROCAR'] }); })();
  check('falha depois de apagar a conta vazia: repetir o comando (sem a opção, pois a conta vazia já saiu) conclui a troca', r.code === 1 && rr.code === 0 && w.users.get('ana').email === 'ana.nova@x.com', [r.err, rr.out]);

  // ══ 9. A CHAVE DE ADMINISTRADOR (connect) ══════════════════════════════════════════════════════
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trocar-email-'));
  const keyFile = (name, obj) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
  const tryConnect = (project, file) => { try { tool.connect(project, file); return 'ok'; } catch (e) { return e.message; } };
  check('chave: arquivo que não existe → diz onde baixar', /Não achei a chave de administrador/.test(tryConnect('seriebaceoma', path.join(tmp, 'nao-existe.json'))) && /Contas de serviço/.test(tryConnect('seriebaceoma', path.join(tmp, 'nao-existe.json'))));
  check('chave: arquivo que não é JSON → recusa sem mostrar o conteúdo', (m => /não é um JSON válido/.test(m) && !m.includes('segredo-aqui'))(tryConnect('seriebaceoma', keyFile('ruim.json', 'segredo-aqui {{'))));
  check('chave: JSON que não é chave de conta de serviço → recusa', /não é uma chave de conta de serviço/.test(tryConnect('seriebaceoma', keyFile('outro.json', { type: 'authorized_user', project_id: 'seriebaceoma' }))));
  check('chave: chave de OUTRO projeto (teste na produção ou o contrário) → recusa e diz os dois nomes', (m => /"seriebaceoma-staging"/.test(m) && /"seriebaceoma"/.test(m))(tryConnect('seriebaceoma', keyFile('teste.json', { type: 'service_account', project_id: 'seriebaceoma-staging', private_key: 'x', client_email: 'x@y' }))));
  check('chave: nenhuma mensagem de erro repete a chave privada', ![tryConnect('seriebaceoma', keyFile('t2.json', { type: 'service_account', project_id: 'zzz', private_key: 'CHAVE-PRIVADA-123', client_email: 'x@y' }))].some(m => m.includes('CHAVE-PRIVADA-123')));
  fs.rmSync(tmp, { recursive: true, force: true });

  // ══ 10. O ARQUIVO ══════════════════════════════════════════════════════════════════════════════
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'trocar-email.js'), 'utf8');
  check('o código nunca imprime a chave nem o conteúdo do arquivo dela (só o caminho)', !/console\.(log|error)\([^)]*key\b/.test(src) && !/io\.(out|err)\([^)]*key\./.test(src));
  check('nenhuma chave privada escrita no código do atalho', !/BEGIN PRIVATE KEY/.test(src) && !/"private_key"/.test(src));
  check('a simulação é o padrão: só --aplicar muda alguma coisa (o código de gravar vem depois do retorno da simulação)', src.indexOf('if (!a.aplicar)') > 0 && src.indexOf('if (!a.aplicar)') < src.indexOf('auth.updateUser('));
  check('o arquivo da chave está no .gitignore', /^serviceAccountKey\.json$/m.test(fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8')));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
