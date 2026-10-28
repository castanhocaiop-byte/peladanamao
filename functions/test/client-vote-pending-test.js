// Testa o código do app (index.html) de duas coisas que só o ADMIN vê, isolado: extrai os trechos reais do arquivo e os executa num ambiente simulado,
// sem navegador.
//  1) Notificações: no Elenco (e na lista abaixo) cada jogador aparece com 🔔 notificações ativas, 🔕 sem notificações ou 👤 sem conta vinculada. O dado vem
//     da função listMembers com `push: true`, que devolve só QUANTOS aparelhos a conta tem (loadPushInfo busca no máximo a cada 5 minutos).
//  2) Votação de destaques aberta: o card do admin lista QUEM AINDA NÃO VOTOU ("Faltam votar (N de M)"), com 🔔/🔕/👤 e o botão 💬 de WhatsApp com a mensagem
//     pronta. Em quem cada um votou continua em segredo, e o jogador comum continua vendo só a contagem.
// Caso real de 28/10/2026 (campeonato de 27/10 da liga Série B Aceoma): 11 jogaram, 6 votaram, 5 faltavam, e 6 jogadores nunca tinham ativado notificações.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8').replace(/\r\n/g, '\n');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const keyCode = slice('const playerKey = name =>', '\n\n');
const escCode = slice('const esc = s =>', 'function toast(');
const avatarCode = slice('function playerAvatar(', 'function resizeImageToBlob(');
const waCode = slice('function waOf(p) {', 'function waOfAvulso(');
const leagueNameCode = slice('const pixLeagueName = ', '\n');
const votingCode = [slice('const VOTE_DAYS = 3;', 'function votingSnapshotFor('), slice('function votingDeadline(', 'function votingUsed('), slice('function getChampAwards(', 'function computeAwardTotals(')].join('\n');
const voteMeCode = slice('function myVotePlayer() {', 'function openVoteModal(');
const blockCode = slice('const PUSH_INFO_TTL', '/* ── fim de quem tem notificação e quem ainda não votou');
const cardCode = slice('function renderVotingCard(champ) {', 'function mVote() {');
const elencoCode = [slice('/* ── Estrelas: o que vale', 'async function setPlayerStars('), slice('function renderStars(', 'function renderDrawCard('), slice('function vPlayers() {', 'function vRanking() {')].join('\n');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

const T0 = Date.UTC(2026, 9, 28, 13, 0, 0); // 28/10/2026, a votação de 27/10 ainda está aberta (vai até 31/10)
const NOMES = ['Nicolas', 'Pedro', 'Davi', 'Will', 'Patrick', 'Gustavo', 'Caio', 'Marcelo', 'Diego', 'Renan', 'Luiz'];
const keyOf = n => n.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 80);
const PLAYERS = NOMES.map(n => ({ id: keyOf(n), name: n, stars: 3 }));
const NOITE = () => ({
  id: 'mvrbwdjigsheg', date: '2026-10-27', status: 'completed',
  teamRosters: { roxo: ['Nicolas', 'Pedro', 'Davi', 'Will'], vermelho: ['Patrick', 'Gustavo', 'Caio'], amarelo: ['Marcelo', 'Diego', 'Renan', 'Luiz'] },
  voting: { pos: true, neg: true, openedAt: '2026-10-28T01:32:32.000Z' },
  votes: Object.fromEntries(['renan', 'diego', 'gustavo', 'patrick', 'pedro', 'caio'].map(k => [k, { at: '2026-10-28T02:00:00.000Z', pos: 'Marcelo', neg: 'Luiz' }])),
}); // 6 de 11 votaram (como na noite real); faltam Davi, Luiz, Marcelo, Nicolas e Will
// aparelhos por conta na noite real: Will 1, Marcelo 1, Diego 1, Gustavo 3, Caio 2; os outros 6 nunca ativaram
const MEMBROS = [['will', 1], ['marcelo', 1], ['diego', 1], ['gustavo', 3], ['caio', 2], ['nicolas', 0], ['pedro', 0], ['davi', 0], ['renan', 0], ['luiz', 0], ['patrick', 0]].map(([playerKey, devices]) => ({ uid: 'u_' + playerKey, email: playerKey + '@x.com', displayName: playerKey, role: 'player', playerKey, joinedAt: '2026-09-01', devices }));

function makeEnv({ admin = true, players = PLAYERS, contacts = {}, champs = [NOITE()], leagueName = 'Série B Aceoma', members = MEMBROS, callFails = false, onCall = null, pushInfo, noDB = false, me = 'caio', elenco = false } = {}) {
  const calls = { fn: [], renders: 0, warns: [] };
  let clock = T0;
  class FakeDate extends Date { static now() { return clock; } constructor(...a) { if (a.length) super(...a); else super(clock); } }
  const env = {
    st: { leagueId: 'aceoma', availableLeagues: [{ id: 'aceoma', name: leagueName }], players: players.map(p => ({ ...p })), contacts: { ...contacts }, photos: {}, champs, userDoc: { playerKey: me }, appCfg: {}, ranks: [], ready: true, pushInfo },
    DB: noDB ? null : {}, isAdmin: () => admin,
    callFn: async (name, data) => { calls.fn.push([name, data]); if (onCall) onCall(env); if (callFails) throw new Error('sem conexão'); return { members }; },
    render: () => { calls.renders++; },
    location: { origin: 'https://peladanamao.com.br' }, console: { warn: (...a) => calls.warns.push(a.join(' ')), log() {} }, Date: FakeDate,
    importPlayersFromRanking: () => {},
  };
  const names = Object.keys(env);
  const body = [escCode, keyCode, avatarCode, waCode, leagueNameCode, votingCode, voteMeCode, blockCode, cardCode, elenco ? elencoCode : ''].join('\n') +
    '\nreturn { loadPushInfo, pushStatus, pushLabel, waVotacaoLink, votePendingList, renderVotingCard, votingRoster, votingDeadline, ' + (elenco ? 'vPlayers, ' : '') + 'playerKey };';
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, env, st: env.st, calls, tick: ms => { clock += ms; } };
}
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const msgDe = link => decodeURIComponent(link.split('?text=')[1]);

(async () => {
  // ── 1. buscar quantos aparelhos cada conta tem ────────────────────────────────────────────────────────────────────────────────────────────────────
  let e = makeEnv();
  await e.api.loadPushInfo();
  check('o admin pede à função listMembers (só admin e jogador, com push: true) uma vez', e.calls.fn.length === 1 && e.calls.fn[0][0] === 'listMembers' && JSON.stringify(e.calls.fn[0][1]) === '{"liga":"aceoma","roles":["admin","player"],"push":true}', e.calls.fn);
  check('guarda os aparelhos por jogador (chave do nome) e redesenha a tela uma vez', e.st.pushInfo && e.st.pushInfo.liga === 'aceoma' && e.st.pushInfo.byKey.gustavo.devices === 3 && e.st.pushInfo.byKey.caio.devices === 2 && e.st.pushInfo.byKey.nicolas.devices === 0 && Object.keys(e.st.pushInfo.byKey).length === 11 && e.calls.renders === 1, { info: e.st.pushInfo, renders: e.calls.renders });
  await e.api.loadPushInfo();
  check('dentro de 5 minutos não pergunta de novo ao servidor', e.calls.fn.length === 1);
  e.tick(4 * 60 * 1000 + 59 * 1000);
  await e.api.loadPushInfo();
  check('com 4 min 59 s ainda não pergunta de novo', e.calls.fn.length === 1);
  e.tick(2000);
  await e.api.loadPushInfo();
  check('passados os 5 minutos pergunta de novo', e.calls.fn.length === 2);
  await e.api.loadPushInfo(true);
  check('com force pergunta de novo mesmo dentro do prazo', e.calls.fn.length === 3);
  e.st.leagueId = 'outra';
  await e.api.loadPushInfo();
  check('trocou de liga: o dado guardado é da outra liga, então pergunta de novo (e agora com a liga nova)', e.calls.fn.length === 4 && e.calls.fn[3][1].liga === 'outra' && e.st.pushInfo.liga === 'outra', e.calls.fn.map(c => c[1].liga));

  e = makeEnv({ admin: false });
  await e.api.loadPushInfo();
  check('quem não é admin nunca pergunta (a função recusaria e o dado não é dele)', e.calls.fn.length === 0 && !e.st.pushInfo);
  e = makeEnv({ noDB: true });
  await e.api.loadPushInfo();
  check('sem conexão com o banco não pergunta', e.calls.fn.length === 0);

  e = makeEnv();
  await Promise.all([e.api.loadPushInfo(), e.api.loadPushInfo(), e.api.loadPushInfo()]);
  check('três pedidos ao mesmo tempo viram um só (não repete a consulta enquanto uma está a caminho)', e.calls.fn.length === 1, e.calls.fn.length);

  e = makeEnv({ members: [...MEMBROS, { uid: 'u2', playerKey: 'caio', devices: 1 }, { uid: 'u3', playerKey: '', devices: 5 }, { uid: 'u4', devices: 2 }, { uid: 'u5', playerKey: 'zeca' }] });
  await e.api.loadPushInfo();
  check('duas contas no mesmo jogador somam os aparelhos; conta sem jogador vinculado é ignorada; "devices" ausente conta 0', e.st.pushInfo.byKey.caio.devices === 3 && !('' in e.st.pushInfo.byKey) && e.st.pushInfo.byKey.zeca.devices === 0 && Object.keys(e.st.pushInfo.byKey).length === 12, e.st.pushInfo.byKey);

  e = makeEnv({ members: MEMBROS.map(({ devices, ...m }) => m) });
  await e.api.loadPushInfo();
  check('servidor antigo (a resposta não traz "devices"): a tela não mostra nada, em vez de acusar todo mundo de estar sem notificação', e.st.pushInfo.byKey === null && e.api.pushLabel('Will') === '' && e.api.pushStatus('Nicolas') === '' && e.calls.renders === 0, e.st.pushInfo);
  e = makeEnv({ members: [] });
  await e.api.loadPushInfo();
  check('liga sem nenhuma conta ativa: o dado vale (ninguém tem conta, todos "sem conta vinculada")', e.st.pushInfo.byKey && Object.keys(e.st.pushInfo.byKey).length === 0 && e.api.pushStatus('Will') === 'none', e.st.pushInfo);

  e = makeEnv({ callFails: true });
  await e.api.loadPushInfo();
  check('se o servidor falha, não derruba a tela nem redesenha: guarda "sem dado" e segue (os rótulos somem)', e.st.pushInfo && e.st.pushInfo.byKey === null && e.calls.renders === 0 && e.calls.warns.length === 1 && e.api.pushLabel('Will') === '', { info: e.st.pushInfo, renders: e.calls.renders });
  await e.api.loadPushInfo();
  check('...e só tenta de novo depois do prazo (a falha também respeita os 5 minutos)', e.calls.fn.length === 1);
  e.tick(5 * 60 * 1000 + 1);
  await e.api.loadPushInfo();
  check('...passado o prazo tenta de novo', e.calls.fn.length === 2);

  e = makeEnv({ onCall: env => { env.st.leagueId = 'outra'; } });
  await e.api.loadPushInfo();
  check('se o admin troca de liga durante a consulta, a resposta é descartada (não mistura as ligas)', !e.st.pushInfo && e.calls.renders === 0, e.st.pushInfo);
  e.st.leagueId = 'aceoma';
  e.env.callFn = async () => { throw new Error('x'); };
  const e2 = makeEnv();
  await e2.api.loadPushInfo();
  check('depois de uma consulta (com ou sem erro) o "ocupado" é liberado e uma nova consulta pode sair', e2.api.pushStatus('Will') === 'on');

  // ── 2. os rótulos ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  e = makeEnv();
  await e.api.loadPushInfo();
  check('estado de cada jogador: com aparelho = on, conta sem aparelho = off, nenhuma conta = none', e.api.pushStatus('Will') === 'on' && e.api.pushStatus('Gustavo') === 'on' && e.api.pushStatus('Nicolas') === 'off' && e.api.pushStatus('Zeca Sem Conta') === 'none');
  check('o nome vira a chave do jogador (acento, espaço e maiúscula não atrapalham)', (() => { const x = makeEnv({ members: [{ uid: 'a', playerKey: 'gui_paredao', devices: 1 }] }); return x.api.loadPushInfo().then(() => x.api.pushStatus('Gui Paredão') === 'on' && x.api.pushStatus(' GUI  paredao ') === 'on'); })() instanceof Promise);
  const gp = makeEnv({ members: [{ uid: 'a', playerKey: 'gui_paredao', devices: 1 }] });
  await gp.api.loadPushInfo();
  check('"Gui Paredão" e " GUI  paredao " são o mesmo jogador (gui_paredao)', gp.api.pushStatus('Gui Paredão') === 'on' && gp.api.pushStatus(' GUI  paredao ') === 'on', gp.st.pushInfo);
  check('rótulo com aparelho: 🔔 notificações ativas, na cor de destaque', /🔔 notificações ativas/.test(e.api.pushLabel('Will')) && /var\(--accent\)/.test(e.api.pushLabel('Will')), e.api.pushLabel('Will'));
  check('rótulo sem aparelho: 🔕 sem notificações, em cinza', /🔕 sem notificações/.test(e.api.pushLabel('Nicolas')) && /var\(--text3\)/.test(e.api.pushLabel('Nicolas')) && !/var\(--accent\)/.test(e.api.pushLabel('Nicolas')), e.api.pushLabel('Nicolas'));
  check('rótulo sem conta: 👤 sem conta vinculada, em cinza', /👤 sem conta vinculada/.test(e.api.pushLabel('Zeca Sem Conta')) && /var\(--text3\)/.test(e.api.pushLabel('Zeca Sem Conta')), e.api.pushLabel('Zeca Sem Conta'));
  check('cada rótulo explica o que significa ao passar o dedo (title)', /title="[^"]*recebe os avisos no celular/.test(e.api.pushLabel('Will')) && /title="[^"]*não recebe os avisos no celular/.test(e.api.pushLabel('Nicolas')) && /title="[^"]*não recebe avisos nem vota pelo app/.test(e.api.pushLabel('Zeca Sem Conta')));
  const naoAdmin = makeEnv({ admin: false, pushInfo: e.st.pushInfo });
  check('para quem não é admin os rótulos nunca aparecem, mesmo que o dado estivesse na memória', naoAdmin.api.pushStatus('Will') === '' && naoAdmin.api.pushLabel('Will') === '');
  const antes = makeEnv();
  check('antes de o dado chegar (ou com falha) não aparece rótulo nenhum', antes.api.pushStatus('Will') === '' && antes.api.pushLabel('Will') === '');
  const outraLiga = makeEnv({ pushInfo: { liga: 'outra', at: T0, byKey: { will: { devices: 1 } } } });
  check('dado de OUTRA liga não vale para esta', outraLiga.api.pushStatus('Will') === '');

  // ── 3. a mensagem de WhatsApp ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const champ = NOITE();
  const ate = (() => { const d = new Date(Date.parse('2026-10-28T01:32:32.000Z') + 3 * 86400000); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); })();
  let link = e.api.waVotacaoLink('(11) 99999-0001', 'Davi', champ);
  check('o link vai para o número com 55 na frente e só dígitos', link.startsWith('https://wa.me/5511999990001?text='), link.slice(0, 50));
  check('número que já vem com 55 não ganha outro 55', e.api.waVotacaoLink('5511988887777', 'Davi', champ).startsWith('https://wa.me/5511988887777?text='));
  let msg = msgDe(link);
  check('a mensagem chama pelo nome e diz a liga, o campeonato, os dois prêmios e o prazo', msg.startsWith('⚽ Olá, Davi!') && /liga \*Série B Aceoma\*/.test(msg) && /campeonato de 27\/10 /.test(msg) && /vote na Bola Cheia e na Bola Murcha\./.test(msg) && msg.includes('Vale até ' + ate + '.'), msg);
  check('e leva o endereço do app e o passo (toque em "Votar")', /Entre no app e toque em "Votar": https:\/\/peladanamao\.com\.br$/.test(msg), msg);
  check('com só a Bola Cheia ligada, só ela entra na mensagem', /vote na Bola Cheia\./.test(msgDe(e.api.waVotacaoLink('11999990001', 'Davi', { ...champ, voting: { ...champ.voting, neg: false } }))) && !/Murcha/.test(msgDe(e.api.waVotacaoLink('11999990001', 'Davi', { ...champ, voting: { ...champ.voting, neg: false } }))));
  check('com só a Bola Murcha ligada, só ela entra na mensagem', /vote na Bola Murcha\./.test(msgDe(e.api.waVotacaoLink('11999990001', 'Davi', { ...champ, voting: { ...champ.voting, pos: false } }))) && !/Cheia/.test(msgDe(e.api.waVotacaoLink('11999990001', 'Davi', { ...champ, voting: { ...champ.voting, pos: false } }))));
  check('o horário do prazo sai no formato dd/mm às hh:mm', /Vale até \d{2}\/\d{2} às \d{2}:\d{2}\./.test(msg), msg);
  check('sem nome de liga conhecido usa "Pelada na Mão"', /liga \*Pelada na Mão\*/.test(msgDe(makeEnv({ leagueName: '' }).api.waVotacaoLink('11999990001', 'Davi', champ))));
  check('a mensagem não leva voto, nem quem já votou, nem e-mail', !/Marcelo|Luiz|renan|diego|@/.test(msg.replace('Davi', '')), msg);

  // ── 4. a lista de quem ainda não votou ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  e = makeEnv({ contacts: { davi: '(11) 99999-0003', marcelo: '11988880001' }, pushInfo: undefined });
  await e.api.loadPushInfo();
  let lista = e.api.votePendingList(e.st.champs[0]);
  const txt = plain(lista);
  check('mostra "Faltam votar (5 de 11)"', /Faltam votar \(5 de 11\)/.test(txt), txt.slice(0, 200));
  const ordem = ['Davi', 'Luiz', 'Marcelo', 'Nicolas', 'Will'].map(n => txt.indexOf(n));
  check('lista exatamente quem falta (Davi, Luiz, Marcelo, Nicolas, Will), em ordem alfabética', ordem.every(i => i > 0) && ordem.join() === [...ordem].sort((a, b) => a - b).join(), { ordem, txt });
  check('NÃO lista quem já votou (Renan, Diego, Gustavo, Patrick, Pedro e Caio)', !/Renan|Diego|Gustavo|Patrick|Pedro|Caio/.test(txt), txt);
  const linhas = lista.split('<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border2)">').slice(1);
  const linhaDe = n => linhas.find(l => plain(l).replace(/^\S+ /, '').startsWith(n)) || ''; // o texto da linha começa com a inicial do avatar: tira antes de comparar
  check('a notificação de cada um bate com o caso real: Will e Marcelo 🔔; Nicolas, Davi e Luiz 🔕', /🔔/.test(linhaDe('Will')) && /🔔/.test(linhaDe('Marcelo')) && /🔕/.test(linhaDe('Nicolas')) && /🔕/.test(linhaDe('Davi')) && /🔕/.test(linhaDe('Luiz')), linhas.map(plain));
  check('botão 💬 só para quem tem WhatsApp cadastrado (Davi e Marcelo), com o número de cada um', /wa\.me\/5511999990003\?text=/.test(linhaDe('Davi')) && /wa\.me\/5511988880001\?text=/.test(linhaDe('Marcelo')) && !/wa\.me/.test(linhaDe('Luiz')) && !/wa\.me/.test(linhaDe('Will')) && !/wa\.me/.test(linhaDe('Nicolas')), linhas.map(l => (l.match(/wa\.me\/\d+/) || [''])[0]));
  check('o 💬 abre em outra aba e a mensagem leva o nome de quem vai receber', /target="_blank" rel="noopener"/.test(linhaDe('Davi')) && /Ol%C3%A1%2C%20Davi!/.test(linhaDe('Davi')) && /Ol%C3%A1%2C%20Marcelo!/.test(linhaDe('Marcelo')), linhaDe('Davi').slice(0, 400));
  check('avisa que são só os nomes e que o voto continua em segredo', /Só os nomes: em quem cada um votou continua em segredo/.test(txt), txt);
  // sigilo: ninguém que votou aparece, e os alvos dos votos (Marcelo e Luiz, que também faltam) só aparecem como nomes de quem falta
  const sigilo = makeEnv();
  sigilo.st.champs = [{ ...NOITE(), votes: { ana: { pos: 'Zeca' }, bia: { neg: 'Zeca' } }, teamRosters: { a: ['Ana', 'Bia', 'Caco', 'Dudu'] } }];
  sigilo.st.players = [];
  const ls = sigilo.api.votePendingList(sigilo.st.champs[0]);
  check('com votos de Ana e Bia em alguém de fora do elenco, mostra só Caco e Dudu (quem falta) e nada dos votos', /Faltam votar \(2 de 4\)/.test(plain(ls)) && /Caco/.test(ls) && /Dudu/.test(ls) && !/Ana|Bia|Zeca/.test(plain(ls)), plain(ls));
  const tudo = makeEnv();
  tudo.st.champs = [{ ...NOITE(), votes: Object.fromEntries(NOMES.map(n => [keyOf(n), { pos: 'x' }])) }];
  check('quando todos votaram, diz "✅ Todo o elenco já votou." e não lista ninguém', /✅ Todo o elenco já votou\./.test(plain(tudo.api.votePendingList(tudo.st.champs[0]))) && !/Faltam votar/.test(tudo.api.votePendingList(tudo.st.champs[0])));
  const acento = makeEnv({ players: [{ id: 'joao', name: 'João Pedro' }, { id: 'ana', name: 'Ana' }] });
  acento.st.champs = [{ ...NOITE(), teamRosters: { a: ['João Pedro', 'Ana'] }, votes: { joao_pedro: { pos: 'Ana' } } }];
  check('o voto de quem tem acento ou espaço no nome ("João Pedro" → joao_pedro) conta como voto', /Faltam votar \(1 de 2\)/.test(plain(acento.api.votePendingList(acento.st.champs[0]))) && /Ana/.test(plain(acento.api.votePendingList(acento.st.champs[0]))) && !/João/.test(plain(acento.api.votePendingList(acento.st.champs[0]))));
  const html5 = makeEnv({ players: [{ id: 'x', name: '<b>Zé</b>' }] });
  html5.st.champs = [{ ...NOITE(), teamRosters: { a: ['<b>Zé</b>', 'Ana'] }, votes: {} }];
  check('nome com HTML é escapado (nenhuma etiqueta solta)', !/<b>Zé<\/b>/.test(html5.api.votePendingList(html5.st.champs[0])) && /&lt;b>Zé&lt;\/b>/.test(html5.api.votePendingList(html5.st.champs[0])));
  check('quem não é admin não recebe a lista nem se a função for chamada por engano (segunda trava)', makeEnv({ admin: false }).api.votePendingList(NOITE()) === '');
  const semConta = makeEnv();
  await semConta.api.loadPushInfo();
  semConta.st.champs = [{ ...NOITE(), teamRosters: { a: ['Zeca Sem Conta', 'Will'] }, votes: {} }];
  semConta.st.players = [...semConta.st.players, { id: 'zeca', name: 'Zeca Sem Conta' }];
  check('jogador do elenco sem conta vinculada aparece como "👤 sem conta vinculada" (ele não consegue votar pelo app)', /👤 sem conta vinculada/.test(plain(semConta.api.votePendingList(semConta.st.champs[0]))), plain(semConta.api.votePendingList(semConta.st.champs[0])));
  const semDado = makeEnv();
  check('antes de o dado das notificações chegar a lista já mostra os nomes, só sem os 🔔/🔕', /Faltam votar \(5 de 11\)/.test(plain(semDado.api.votePendingList(semDado.st.champs[0]))) && !/🔔|🔕|👤/.test(semDado.api.votePendingList(semDado.st.champs[0])));

  // ── 5. o card da votação ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  e = makeEnv();
  await e.api.loadPushInfo();
  let card = e.api.renderVotingCard(e.st.champs[0]);
  check('admin, votação aberta: o card mostra a contagem de sempre, os botões de sempre e a lista de quem falta', /6 jogadores já votaram/.test(plain(card)) && /Avisar jogadores/.test(card) && /Encerrar agora/.test(card) && /Faltam votar \(5 de 11\)/.test(plain(card)), plain(card).slice(0, 300));
  check('o card continua bem fechado (mesmo número de <div> abertas e fechadas)', (card.match(/<div/g) || []).length === (card.match(/<\/div>/g) || []).length, [(card.match(/<div/g) || []).length, (card.match(/<\/div>/g) || []).length]);
  check('Caio (do elenco) continua vendo o botão de votar no card', /openVoteModal/.test(card) && /Alterar meu voto/.test(card), plain(card).slice(0, 300));
  const jog = makeEnv({ admin: false });
  card = jog.api.renderVotingCard(jog.st.champs[0]);
  check('jogador comum, votação aberta: só a contagem (6 jogadores já votaram), nada de lista nem de nomes de quem falta', /6 jogadores já votaram/.test(plain(card)) && !/Faltam votar/.test(card) && !/Davi|Luiz|Nicolas|Will/.test(plain(card)) && !/wa\.me/.test(card), plain(card));
  const fechada = makeEnv();
  fechada.st.champs[0].voting.closedAt = '2026-10-29T01:00:00.000Z';
  check('votação encerrada: sem lista de quem falta (aparece o resultado)', !/Faltam votar/.test(fechada.api.renderVotingCard(fechada.st.champs[0])));
  const naoAberta = makeEnv();
  delete naoAberta.st.champs[0].voting;
  check('votação ainda não aberta: sem lista (só o botão Abrir votação)', !/Faltam votar/.test(naoAberta.api.renderVotingCard(naoAberta.st.champs[0])) && /Abrir votação/.test(naoAberta.api.renderVotingCard(naoAberta.st.champs[0])));

  // ── 6. o Elenco ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  e = makeEnv({ elenco: true });
  await e.api.loadPushInfo();
  let elenco = e.api.vPlayers();
  const rows = elenco.split('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--border2);opacity:').slice(1);
  const rowDe = n => rows.find(r => r.includes('>' + n + '<')) || '';
  check('Elenco do admin: cada jogador mostra embaixo do nome o rótulo das notificações (Will 🔔, Nicolas 🔕)', rows.length === 11 && /🔔 notificações ativas/.test(rowDe('Will')) && /🔕 sem notificações/.test(rowDe('Nicolas')), rows.length);
  check('o rótulo fica dentro do bloco do nome (antes das estrelas e dos botões), sem mexer no resto da linha', rowDe('Will').indexOf('🔔 notificações ativas') < rowDe('Will').indexOf('class="star-btn"'), rowDe('Will').slice(0, 300));
  const semInfo = makeEnv({ elenco: true });
  check('Elenco sem o dado carregado: nenhum rótulo e a linha continua igual', !/🔔|🔕|👤/.test(semInfo.api.vPlayers()));
  const elencoJog = makeEnv({ elenco: true, admin: false, pushInfo: e.st.pushInfo });
  check('Elenco do jogador comum: nenhum rótulo, mesmo com o dado na memória', !/🔔|🔕|👤/.test(elencoJog.api.vPlayers()));

  // ── 7. ligações com o app, o servidor, o texto de privacidade e o manual ──────────────────────────────────────────────────────────────────────────
  check('a tela pede o dado ao abrir o Elenco ou o Histórico, só para o admin', html.includes("if(isAdmin()&&(st.view==='players'||st.view==='history')) loadPushInfo();"));
  check('o card da votação só monta a lista para o admin', html.includes('${isAdmin()?votePendingList(champ):\'\'}'));
  check('o rótulo do Elenco só é montado para o admin', html.includes('${isAdmin()&&pushLabel(p.name)?`<div style="font-size:11px;margin-top:1px">${pushLabel(p.name)}</div>`:\'\'}'));
  const lm = server.slice(server.indexOf('exports.listMembers'), server.indexOf('exports.listMembers') + 2200);
  check('servidor: o pedido com push só vale com `push === true` e devolve apenas a CONTAGEM (nunca os aparelhos)', /request\.data\?\.push === true/.test(lm) && /devices: Array\.isArray\(user\.fcmTokens\) \? user\.fcmTokens\.length : 0/.test(lm) && !/fcmTokens\s*[,}:]\s*user\.fcmTokens/.test(lm) && !/tokens\b/.test(lm.slice(lm.indexOf('return {'))), lm.slice(lm.indexOf('const withPush'), lm.indexOf('const withPush') + 300));
  check('texto de privacidade do app: o admin vê se você tem notificações ativas (sim ou não, nunca o aparelho) e quem ainda não votou, e ninguém vê em quem você votou', /Notificações: o admin da sua liga vê se você tem notificações ativas \(sim ou não, nunca o aparelho\)/.test(html) && /vê também o nome de quem ainda não votou, para cobrar; em quem você votou, ninguém vê pelo app/.test(html));
  const sec18 = manual.slice(manual.indexOf('id="votacao"'), manual.indexOf('id="foto"'));
  check('manual (seção 18): explica a lista "Faltam votar" e que o voto continua em segredo', sec18.includes('<h3 id="quem-falta-votar">Quem ainda não votou <span class="tag">Admin</span></h3>') && /Faltam votar \(N de M\)/.test(sec18) && /continua em segredo/.test(sec18) && /só os nomes/.test(sec18), sec18.length);
  check('manual (seção 18): cada rótulo e o 💬 têm a sua linha', ['<tr><td>🔔 notificações ativas</td>', '<tr><td>🔕 sem notificações</td>', '<tr><td>👤 sem conta vinculada</td>', '<tr><td>💬</td>'].every(t => sec18.includes(t)));
  check('manual (seção 18): o sigilo agora diz que o admin vê quem ainda NÃO votou', /o admin vê apenas o nome de quem <strong>ainda não votou<\/strong>, para cobrar/.test(sec18));
  check('manual: a seção das notificações explica o 🔔/🔕/👤 do Elenco (só sim ou não, nunca o aparelho)', /Quem tem notificação ativa/.test(manual) && /No <strong>Elenco<\/strong>, o admin vê embaixo do nome de cada jogador se ele recebe avisos no celular/.test(manual) && /o admin nunca vê o aparelho em si/.test(manual));
  check('manual (LGPD): a promessa antiga "sem aparelhos de notificação" foi corrigida (agora diz que acrescenta só o número de aparelhos)', !manual.includes('sem aparelhos de notificação e sem dados de outras ligas') && !manual.includes('nunca os aparelhos de notificação nem dados de outras ligas') && /acrescenta só quantos aparelhos de aviso cada conta tem \(um número\), nunca os aparelhos em si/.test(manual) && /acrescenta apenas quantos aparelhos de aviso cada conta tem \(um número\)/.test(manual));
  check('manual (LGPD): as duas linhas novas da tabela "quem consegue ler" existem e os tokens continuam só da própria conta', manual.includes('<tr><td>Se a conta tem notificações ativas (sim ou não)</td>') && manual.includes('<tr><td>Quem ainda não votou na votação de destaques</td>') && manual.includes('<tr><td>Aparelhos de notificação (tokens)</td><td>Só a própria conta e o servidor que envia os avisos. Não aparecem no Painel Admin.</td></tr>'));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(1); });
