const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── mocks ────────────────────────────────────────────────────
const users = {
  ana:   { leagues: { L: { role: 'player', playerKey: 'ana' } }, fcmTokens: ['tA1', 'tA2'] },
  bia:   { playerKey: 'bia', leagues: { L: { role: 'admin' } }, fcmTokens: ['tB'] },              // vínculo só no topo
  caio:  { leagues: { L: { role: 'player', playerKey: 'caio' } }, fcmTokens: ['tC'] },
  edu:   { leagues: { L: { role: 'player', playerKey: 'edu' } }, fcmTokens: ['tE'] },             // não está no elenco
  pend:  { leagues: { L: { role: 'pending', playerKey: 'ana' } }, fcmTokens: ['tP'] },            // pendente
  semlink: { leagues: { L: { role: 'player' } }, fcmTokens: ['tS'] },                             // sem vínculo
  outra: { leagues: { OUTRA: { role: 'player', playerKey: 'ana' } }, fcmTokens: ['tO'] },         // outra liga
  dead:  { leagues: { L: { role: 'player', playerKey: 'duda' } }, fcmTokens: ['tDEAD', 'tD'] },
};
const updates = [];
const sent = [];
const deadTokens = new Set(['tDEAD']);

const docSnap = (id, data) => ({ id, data: () => data, ref: { update: async u => updates.push({ id, u }) } });
const userReads = []; // cada leitura de "users": { filters, ids } — para provar que nenhuma lê a coleção sem filtro
const valueAt = (obj, field) => (field instanceof FieldPathMock ? field.segments : [field]).reduce((o, s) => (o == null ? undefined : o[s]), obj);
class FieldPathMock { constructor(...segments) { this.segments = segments; } }
const matches = (d, field, op, val) => {
  const v = valueAt(d, field);
  if (op === '==') return v === val;
  if (op === '!=') return v !== undefined && v !== val;      // Firestore: exige o campo existir
  if (op === 'in') return v !== undefined && val.includes(v);
  if (op === 'array-contains') return Array.isArray(v) && v.includes(val);
  throw new Error('operador não simulado: ' + op);
};
const fakeDb = {
  collection: name => {
    const build = filters => ({
      where: (field, op, val) => build([...filters, [field, op, val]]),
      get: async () => {
        const docs = Object.entries(users).filter(([, d]) => filters.every(([f, op, v]) => matches(d, f, op, v))).map(([id, d]) => docSnap(id, d));
        if (name === 'users') userReads.push({ filters, ids: docs.map(d => d.id) });
        return { docs, forEach: fn => docs.forEach(fn) };
      },
    });
    return build([]);
  },
  doc: () => ({ get: async () => ({ data: () => ({ name: 'Aceoma' }) }) }),
};
const fakeMessaging = {
  sendEachForMulticast: async msg => {
    sent.push(msg);
    const responses = msg.tokens.map(t => deadTokens.has(t) ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true });
    return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length };
  },
};
const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue: { arrayRemove: t => ({ __arrayRemove: t }) } }),
  messaging: () => fakeMessaging,
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-functions') return { logger: { info() {}, warn() {}, error() {} } };
  if (request === 'firebase-admin/firestore') return { FieldValue: { arrayRemove: t => ({ __arrayRemove: t }), delete: () => ({ __delete: true }) }, FieldPath: FieldPathMock };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } };
  if (request === 'firebase-functions/params') return { defineSecret: name => ({ value: () => secretVals[name] || '' }) };
  return origLoad.call(this, request, ...rest);
};
const secretVals = { CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' }; // vazio = "não configurado ainda" (comportamento padrão)
let fetchCalls = [];
let fetchResponse = { result: 'ok' };
global.fetch = async (url, opts) => { fetchCalls.push({ url, body: opts.body }); return { json: async () => fetchResponse }; };
const fns = require(path);
Module._load = origLoad;

const evt = (before, after, params = { leagueId: 'L', champId: 'c1' }) => ({
  params,
  data: { before: { data: () => before }, after: { data: () => after } },
});
const reset = () => { sent.length = 0; updates.length = 0; userReads.length = 0; };

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

(async () => {
  const roster = { azul: ['Ana', 'Bia'], preto: ['Caio', 'Duda'] };
  const finalized = {
    status: 'completed', champion: 'azul', date: '2026-09-22', teamRosters: roster,
    voting: { pos: true, neg: true, openedAt: '2026-09-22T20:00:00.000Z' },
  };

  // 1) finalização com votação: resultado + votação
  reset();
  await fns.onChampionshipChange(evt({ status: 'active', teamRosters: roster }, finalized));
  const res = sent.find(m => m.notification.title.startsWith('🏆'));
  const vot = sent.find(m => m.notification.title.startsWith('🗳️'));
  check('finalização: 2 envios (resultado + votação)', sent.length === 2, sent.map(m => m.notification.title));
  check('resultado vai para toda a liga (sem pendente/outra liga)', res && ['tA1', 'tA2', 'tB', 'tC', 'tE', 'tS', 'tDEAD', 'tD'].every(t => res.tokens.includes(t)) && !res.tokens.includes('tP') && !res.tokens.includes('tO'), res && res.tokens);
  check('votação só para quem estava no elenco e tem vínculo', vot && JSON.stringify([...vot.tokens].sort()) === JSON.stringify(['tA1', 'tA2', 'tB', 'tC', 'tD', 'tDEAD'].sort()), vot && vot.tokens);
  check('votação não vai para fora do elenco / pendente / sem vínculo / outra liga', vot && !['tE', 'tP', 'tS', 'tO'].some(t => vot.tokens.includes(t)), vot && vot.tokens);
  check('texto da votação', vot && vot.notification.body === 'Campeonato de 22/09: vote na Bola Cheia e na Bola Murcha. Vale até 25/09.', vot && vot.notification.body);
  check('tags por evento', res.data.tag === 'resultado-c1' && vot.data.tag === 'votacao-c1' && vot.webpush.notification.tag === 'votacao-c1', { r: res.data, v: vot.data });
  check('votação leva o jogador para a aba EU', vot.data.view === 'eu' && vot.data.leagueId === 'L', vot.data);
  check('token morto é removido do usuário', updates.some(u => u.id === 'dead' && u.u.fcmTokens.__arrayRemove === 'tDEAD'), updates);
  check('token vivo não é removido', !updates.some(u => u.u.fcmTokens.__arrayRemove === 'tD'), updates);

  // 2) voto gravado (só muda votes) → nenhuma notificação
  reset();
  await fns.onChampionshipChange(evt(finalized, { ...finalized, votes: { ana: { pos: 'Bia', neg: 'Caio' } } }));
  check('voto gravado não notifica', sent.length === 0, sent);

  // 3) admin abre a votação depois (status já completed)
  reset();
  const { voting, ...semVotacao } = finalized;
  await fns.onChampionshipChange(evt(semVotacao, finalized));
  check('abrir depois: só a notificação de votação', sent.length === 1 && sent[0].notification.title.startsWith('🗳️'), sent.map(m => m.notification.title));

  // 4) só Bola Cheia ligada
  reset();
  await fns.onChampionshipChange(evt(semVotacao, { ...finalized, voting: { pos: true, neg: false, openedAt: finalized.voting.openedAt } }));
  check('só Bola Cheia', sent[0] && sent[0].notification.body === 'Campeonato de 22/09: vote na Bola Cheia. Vale até 25/09.', sent[0] && sent[0].notification.body);

  // 5) encerrar votação (voting.closedAt) não notifica
  reset();
  await fns.onChampionshipChange(evt(finalized, { ...finalized, voting: { ...finalized.voting, closedAt: '2026-09-23T10:00:00.000Z' } }));
  check('encerrar votação não notifica', sent.length === 0, sent);

  // 6) convocação continua igual, com tag
  reset();
  await fns.onChampionshipChange(evt(undefined, { status: 'preset', date: '2026-09-29', churrasco: true }));
  check('convocação: 1 envio com tag', sent.length === 1 && sent[0].data.tag === 'convocacao-c1' && sent[0].notification.title.startsWith('📋'), sent.map(m => m.data));

  // 7) roster vazio → votação sem destinatários não quebra
  reset();
  await fns.onChampionshipChange(evt({ status: 'active' }, { status: 'active', teamRosters: {}, voting: { pos: true, neg: false, openedAt: finalized.voting.openedAt } }));
  check('sem elenco: nada enviado, sem erro', sent.length === 0, sent);

  // 8) admin reenvia o aviso (voting.notifyAt muda) com a votação aberta
  const fresh = { ...finalized, voting: { pos: true, neg: true, openedAt: new Date().toISOString() } };
  reset();
  await fns.onChampionshipChange(evt(fresh, { ...fresh, voting: { ...fresh.voting, notifyAt: '2026-09-23T12:00:00.000Z' } }));
  check('reenvio: 1 envio só para o elenco', sent.length === 1 && !sent[0].tokens.includes('tE') && sent[0].tokens.includes('tA1'), sent.map(m => m.tokens));
  check('reenvio: texto de lembrete', sent[0] && sent[0].notification.body.startsWith('Lembrete: campeonato de 22/09 — vote na Bola Cheia e na Bola Murcha. Vale até '), sent[0] && sent[0].notification.body);
  check('reenvio: mesma tag da votação (substitui a anterior)', sent[0] && sent[0].data.tag === 'votacao-c1', sent[0] && sent[0].data);

  // 9) reenvio com prazo vencido ou votação encerrada não envia
  reset();
  const old = { ...finalized, voting: { pos: true, neg: true, openedAt: new Date(Date.now() - 10 * 86400000).toISOString() } };
  await fns.onChampionshipChange(evt(old, { ...old, voting: { ...old.voting, notifyAt: '2026-09-23T12:00:00.000Z' } }));
  check('reenvio após o prazo: nada enviado', sent.length === 0, sent);
  reset();
  await fns.onChampionshipChange(evt(fresh, { ...fresh, voting: { ...fresh.voting, closedAt: new Date().toISOString(), notifyAt: '2026-09-23T12:00:00.000Z' } }));
  check('reenvio com votação encerrada: nada enviado', sent.length === 0, sent);

  // 10) notifyAt igual ao anterior (outra escrita qualquer) não reenvia
  reset();
  const withNotify = { ...fresh, voting: { ...fresh.voting, notifyAt: '2026-09-23T12:00:00.000Z' } };
  await fns.onChampionshipChange(evt(withNotify, { ...withNotify, votes: { ana: { pos: 'Bia' } } }));
  check('notifyAt inalterado não reenvia', sent.length === 0, sent);

  // ───────── onPlayerPhotoDeleted (apaga o arquivo no Cloudinary) ─────────
  const photoEvt = (before, after) => ({ params: { leagueId: 'L', photoKey: 'pl1' }, data: { before: { data: () => before }, after: { exists: !!after, data: () => after } } });
  const resetFetch = () => { fetchCalls = []; fetchResponse = { result: 'ok' }; };

  resetFetch();
  await fns.onPlayerPhotoDeleted(photoEvt({ url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/x.jpg', uid: 'ana', updatedAt: 'x' }, undefined));
  check('foto criada, depois apagada: sem chave do Cloudinary configurada, não chama nada (a foto já foi apagada do Firestore)', fetchCalls.length === 0, fetchCalls);

  resetFetch();
  await fns.onPlayerPhotoDeleted(photoEvt(undefined, { url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/x.jpg', uid: 'ana', updatedAt: 'x' }));
  check('foto CRIADA (não apagada): não chama o Cloudinary', fetchCalls.length === 0, fetchCalls);

  resetFetch();
  await fns.onPlayerPhotoDeleted(photoEvt({ url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/a.jpg', uid: 'ana', updatedAt: 'x' }, { url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/b.jpg', uid: 'ana', updatedAt: 'y' }));
  check('foto TROCADA (não apagada): não chama o Cloudinary', fetchCalls.length === 0, fetchCalls);

  // com a chave configurada: a assinatura precisa seguir a fórmula documentada pelo Cloudinary
  // (SHA-1 hex de "public_id=<id>&timestamp=<ts>" + api_secret colado no fim, sem separador).
  // Conferida à parte contra o exemplo OFICIAL de 3 parâmetros do Cloudinary
  // (timestamp=1315060510, public_id=sample_image, eager=..., secret=abcd -> sha1
  // "bfd09f95f331f558cbd1320e67aa8d488770583e"); aqui só uso 2 parâmetros (sem "eager"),
  // então o hash esperado abaixo é o da MESMA fórmula aplicada só a public_id+timestamp.
  const crypto = require('crypto');
  check('a fórmula (SHA-1 hex, parâmetros em ordem alfabética, segredo colado no fim) bate com o exemplo OFICIAL do Cloudinary (3 parâmetros, documentação deles)',
    crypto.createHash('sha1').update('eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510' + 'abcd').digest('hex') === 'bfd09f95f331f558cbd1320e67aa8d488770583e');
  const expectedSig = crypto.createHash('sha1').update('public_id=sample_image&timestamp=1315060510abcd').digest('hex');
  secretVals.CLOUDINARY_API_KEY = '123456789012345';
  secretVals.CLOUDINARY_API_SECRET = 'abcd';
  const realNow = Date.now;
  Date.now = () => 1315060510 * 1000;
  resetFetch();
  await fns.onPlayerPhotoDeleted(photoEvt({ url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/sample_image.jpg', uid: 'ana', updatedAt: 'x' }, undefined));
  Date.now = realNow;
  check('chama o Cloudinary quando a chave está configurada', fetchCalls.length === 1, fetchCalls);
  const call1 = fetchCalls[0];
  check('endereço certo (cloud name do projeto, recurso "image")', call1?.url === 'https://api.cloudinary.com/v1_1/fwtyio7l/image/destroy', call1?.url);
  check('public_id extraído certo da URL (sem a versão, sem a extensão)', call1?.body.get('public_id') === 'sample_image', call1?.body.get('public_id'));
  check('assinatura segue a fórmula do Cloudinary (SHA-1 dos parâmetros + segredo)', call1?.body.get('signature') === expectedSig, call1?.body.get('signature'));
  check('api_key vai no pedido (fora da assinatura)', call1?.body.get('api_key') === '123456789012345');

  resetFetch();
  await fns.onPlayerPhotoDeleted(photoEvt({ url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/aceoma/pasta/foto123.png', uid: 'ana', updatedAt: 'x' }, undefined));
  check('public_id com pasta (mantém o caminho, tira só a extensão)', fetchCalls[0]?.body.get('public_id') === 'aceoma/pasta/foto123', fetchCalls[0]?.body.get('public_id'));

  resetFetch();
  await fns.onPlayerPhotoDeleted(photoEvt({ uid: 'ana' }, undefined)); // documento antigo sem "url"
  check('sem endereço salvo: não quebra, não chama nada', fetchCalls.length === 0, fetchCalls);

  resetFetch(); fetchResponse = { result: 'error', error: { message: 'not found' } };
  await fns.onPlayerPhotoDeleted(photoEvt({ url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/x.jpg', uid: 'ana' }, undefined));
  check('resposta de erro do Cloudinary não derruba a função (o documento já estava apagado)', fetchCalls.length === 1, fetchCalls);
  fetchResponse = { result: 'ok' };

  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('rede fora do ar'); };
  let threw = false;
  try { await fns.onPlayerPhotoDeleted(photoEvt({ url: 'https://res.cloudinary.com/fwtyio7l/image/upload/v1/x.jpg', uid: 'ana' }, undefined)); } catch (e) { threw = true; }
  global.fetch = realFetch;
  check('falha de rede ao chamar o Cloudinary não derruba a função', !threw);

  secretVals.CLOUDINARY_API_KEY = ''; secretVals.CLOUDINARY_API_SECRET = '';

  // ───────── escala: as notificações não podem mais ler a coleção "users" inteira ─────────
  // Cada leitura de "users" fica registrada em userReads com seus filtros e os ids que
  // voltaram. Nenhuma pode: (a) vir sem nenhum filtro (leitura da coleção inteira), (b) trazer
  // "outra" (só está na liga OUTRA, nunca em L) ou "pend" (pendente, nunca deveria voltar em
  // nenhuma consulta de notificação), (c) trazer mais gente do que a própria liga L tem.
  console.log('── escala: consultas por liga, não a coleção inteira');
  const semFiltro = reads => reads.some(r => r.filters.length === 0);
  const vazouDeOutraLigaOuPendente = reads => reads.some(r => r.ids.includes('outra') || r.ids.includes('pend'));
  const maiorQueALiga = reads => reads.some(r => r.ids.length > 6); // liga L tem no máx. 6 usuários não-pendentes neste teste

  reset();
  await fns.onChampionshipChange(evt({ status: 'active', teamRosters: roster }, finalized));
  check('finalização (resultado + votação): nenhuma leitura sem filtro', !semFiltro(userReads), userReads);
  check('finalização: nenhuma leitura vaza "outra liga" nem "pendente"', !vazouDeOutraLigaOuPendente(userReads), userReads);
  check('finalização: nenhuma leitura traz mais gente do que a própria liga L tem', !maiorQueALiga(userReads), userReads.map(r => r.ids));

  reset();
  await fns.onAvulsoCreated({ params: { leagueId: 'L', docId: 'av1' }, data: { before: { data: () => undefined }, after: { data: () => ({ nome: 'Zé Ninguém', valor: 20 }) } } });
  check('cobrança avulsa: consulta pela liga mesmo sem achar destinatário (sem filtro nem vazamento)', userReads.length > 0 && !semFiltro(userReads) && !vazouDeOutraLigaOuPendente(userReads), userReads);
  check('cobrança avulsa: nome sem jogador vinculado não envia nada', sent.length === 0, sent);

  // ───────── correção: "nova cobrança avulsa" nunca enviava (comparava com um campo que não existe) ─────────
  console.log('── correção: notificação de cobrança avulsa agora encontra o jogador certo');
  reset();
  await fns.onAvulsoCreated({ params: { leagueId: 'L', docId: 'av2' }, data: { before: { data: () => undefined }, after: { data: () => ({ nome: 'Ana', valor: 30 }) } } });
  check('avulso no nome de um jogador vinculado (chave por liga): agora envia', sent.length === 1 && [...sent[0].tokens].sort().join() === ['tA1', 'tA2'].sort().join(), sent);
  check('texto e tag da notificação', sent[0]?.notification.title === '💰 Aceoma' && sent[0]?.notification.body === 'Cobrança de R$30,00 gerada.' && sent[0]?.data.tag === 'avulso-av2', sent[0]);

  reset();
  await fns.onAvulsoCreated({ params: { leagueId: 'L', docId: 'av3' }, data: { before: { data: () => undefined }, after: { data: () => ({ nome: 'Bia', valor: 10 }) } } });
  check('avulso no nome de um jogador vinculado só no topo (sem playerKey na liga): também envia', sent.length === 1 && sent[0].tokens.includes('tB'), sent);

  reset();
  await fns.onAvulsoCreated({ params: { leagueId: 'L', docId: 'av4' }, data: { before: { data: () => undefined }, after: { data: () => ({ nome: 'Duda', valor: 15 }) } } }); // "Duda" -> chave "duda", conta "dead" tem 1 token vivo e 1 morto
  check('avulso no nome de jogador com token morto: manda para os dois e depois limpa o morto', sent.length === 1 && [...sent[0].tokens].sort().join() === ['tD', 'tDEAD'].sort().join() && updates.some(u => u.id === 'dead' && u.u.fcmTokens.__arrayRemove === 'tDEAD'), { sent, updates });

  reset();
  await fns.onAvulsoCreated({ params: { leagueId: 'OUTRA', docId: 'av5' }, data: { before: { data: () => undefined }, after: { data: () => ({ nome: 'Ana', valor: 30 }) } } });
  check('mesmo nome "Ana", mas em OUTRA liga: notifica quem tem playerKey "ana" NAQUELA liga (não a Ana da liga L)', sent.length === 1 && sent[0].tokens.includes('tO') && !sent[0].tokens.includes('tA1'), sent);

  reset();
  await fns.onMensalidadeLembrete({ params: { leagueId: 'L', docId: 'lb1' }, data: { before: { data: () => undefined }, after: { data: () => ({ players: ['Ana', 'Caio'], mesLabel: 'Set/26', valor: 50 }), ref: { delete: async () => {} } } } });
  check('lembrete: 1 leitura da liga para todos os jogadores da lista (não 1 por jogador)', userReads.filter(r => r.filters.some(([f]) => f instanceof FieldPathMock)).length === 1, userReads);
  check('lembrete: sem filtro nem vazamento de outra liga/pendente', !semFiltro(userReads) && !vazouDeOutraLigaOuPendente(userReads), userReads);

  // usuário de OUTRA liga nunca é candidato, mesmo compartilhando a mesma chave de jogador ("ana")
  reset();
  await fns.onChampionshipChange(evt({ status: 'active', teamRosters: roster }, finalized));
  check('usuário de outra liga (mesma chave "ana") nunca recebe notificação', !sent.some(m => [...(m.tokens || [])].includes('tO')), sent);

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
