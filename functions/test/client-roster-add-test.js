// Jogador que chegou depois do sorteio (item 43): o admin põe no elenco de um time, no card "Elencos", com o campeonato em andamento ou já concluído. Confere quem pode entrar (a lista e a
// busca), as regras de nome e de time, o modal (lista, times, aviso de jogos já feitos, convidado), a gravação (só aquele time, sem sobrescrever o resto), quem NÃO pode mexer, e a conta de
// "emprestado" das conquistas Fominha e Jogo Todas (quem já foi marcado como emprestado no próprio time e entra no elenco deixa de contar como emprestado). O código é o REAL do index.html
// (fatiado e executado com um aplicativo falso).
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const manual = fs.readFileSync(path.join(__dirname, '..', '..', 'manual.html'), 'utf8').replace(/\r\n/g, '\n');
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
const escCode = slice('const esc = s =>', 'function toast(');
const keyCode = slice('const playerKey =', '\n\n');
const teamCode = slice('const T = {', 'function enabledColors()');
const rosterCode = slice('/* ── Jogador que chegou depois do sorteio (item 43)', 'function editMatchGoals(champId, matchId) {');
const borrowedCode = slice('// Quantos jogos de um campeonato o jogador fez "emprestado"', 'function champPlayerGames(champ, name) {');

const PLAYERS = [
  { name: 'Ana', active: true }, { name: 'Bruno', active: true, goleiro: true }, { name: 'Carla', active: false }, { name: 'Davi', active: true, somenteChurrasco: true },
  { name: 'Edu', active: true }, { name: 'Fabi', active: true }, { name: 'João Pé', active: true }, { name: 'Gil', active: true, goleiro: true },
];
const mt = (home, away, hs, as, extra = {}) => ({ phase: 'regular', home, away, hs, as, played: true, goals: [], ...extra });
const CHAMP = (o = {}) => ({ id: 'c1', status: 'active', teams: ['azul', 'verde', 'amarelo'], teamRosters: { azul: ['Ana', 'Gil'], verde: ['Bruno'], amarelo: [] }, matches: [], ...o });

function makeEnv({ players = PLAYERS, champs = [CHAMP()], admin = true, db = true } = {}) {
  const calls = { updates: [], toasts: [], renders: 0 };
  const els = { 'ar-list': { innerHTML: '' }, 'ar-teams': { innerHTML: '' }, 'ar-foot': { innerHTML: '' } };
  const ctl = { fail: false, hold: null };
  const st = { players, champs, modal: null };
  const env = {
    st, isAdmin: () => admin, DB: db ? {} : null,
    ldoc: p => ({ update: async arg => { calls.updates.push([p, arg]); if (ctl.hold) await ctl.hold; if (ctl.fail) throw new Error('sem conexão'); } }),
    firebase: { firestore: { FieldValue: { arrayUnion: (...a) => ({ arrayUnion: a }) } } },
    toast: (m, t) => { calls.toasts.push([m, t]); }, render: () => { calls.renders++; },
    playerAvatar: (n, s) => `<i class="av${s}"></i>`, document: { getElementById: id => els[id] || null },
  };
  const names = Object.keys(env);
  const body = [escCode, keyCode, teamCode, rosterCode, borrowedCode].join('\n') + `
return { ROSTER_NAME_MAX, rosterNorm, champRosterNames, rosterCandidates, rosterAddCheck, ROSTER_WHY, rosterTeamGames, openAddRoster, refreshAddRoster, rosterSearch, pickRosterIdx, pickRosterGuest,
  pickRosterTeam, confirmAddRoster, rosterListHtml, rosterTeamsHtml, rosterFootHtml, mAddRoster, champBorrowedCount };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, st, calls, els, ctl };
}
const J = JSON.stringify;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ══ 1. QUEM PODE ENTRAR ═════════════════════════════════════════════════════════════════════════════════════════════════
  const A = makeEnv().api;
  const champ = CHAMP();
  check('a lista de quem pode entrar: sem quem já está em um time (Ana, Gil, Bruno) e sem o "só churrasco" (Davi); os ativos primeiro, em ordem de nome, e o inativo (Carla) por último', J(A.rosterCandidates(champ).map(p => p.name)) === '["Edu","Fabi","João Pé","Carla"]', A.rosterCandidates(champ));
  check('cada um vem com ativo/inativo e goleiro', (() => { const c = A.rosterCandidates(champ); return c.find(p => p.name === 'Carla').active === false && c.find(p => p.name === 'Edu').active === true && A.rosterCandidates(CHAMP({ teamRosters: { azul: ['Ana'] } })).find(p => p.name === 'Gil').goleiro === true; })());
  check('a busca ignora acento e maiúscula e acha pelo meio do nome: "joao" acha o João Pé, "ÉD" acha o Edu, "zzz" não acha ninguém', J(A.rosterCandidates(champ, 'joao').map(p => p.name)) === '["João Pé"]' && J(A.rosterCandidates(champ, 'ÉD').map(p => p.name)) === '["Edu"]' && A.rosterCandidates(champ, 'zzz').length === 0 && J(A.rosterCandidates(champ, 'pé').map(p => p.name)) === '["João Pé"]');
  check('quem já está em um time sai da lista mesmo escrito diferente (o elenco tem "joao pe" sem acento e o cadastro "João Pé")', !A.rosterCandidates(CHAMP({ teamRosters: { azul: ['joao pe'], verde: ['Bruno'] } })).some(p => p.name === 'João Pé'));
  check('sem campeonato ou sem elenco a lista é só dos cadastrados que jogam (nada quebra)', A.rosterCandidates(null).length === 7 && A.rosterCandidates(CHAMP({ teamRosters: undefined })).length === 7);

  // ══ 2. AS REGRAS DO NOME E DO TIME ══════════════════════════════════════════════════════════════════════════════════════
  const ck = (team, name, c = champ) => A.rosterAddCheck(c, team, name);
  check('jogador cadastrado entra com a grafia do cadastro ("edu" vira "Edu", "joao  pe" vira "João Pé") e não é convidado', J(ck('azul', 'edu')) === '{"ok":true,"name":"Edu","guest":false}' && J(ck('verde', ' joao   pe ')) === '{"ok":true,"name":"João Pé","guest":false}', [ck('azul', 'edu'), ck('verde', ' joao   pe ')]);
  check('quem não tem cadastro entra como convidado, com os espaços arrumados', J(ck('amarelo', '  Zé   Convidado ')) === '{"ok":true,"name":"Zé Convidado","guest":true}', ck('amarelo', '  Zé   Convidado '));
  check('quem já está em um time não entra de novo, nem em outro time, mesmo com acento ou maiúscula diferente; diz em qual time está', J(ck('verde', 'ana')) === '{"ok":false,"why":"ja-esta","team":"azul"}' && J(ck('azul', 'BRUNO')) === '{"ok":false,"why":"ja-esta","team":"verde"}' && J(ck('amarelo', 'Ana')) === '{"ok":false,"why":"ja-esta","team":"azul"}', [ck('verde', 'ana'), ck('azul', 'BRUNO')]);
  check('time que não é do campeonato, vazio, ou com ponto no nome é recusado', ck('rosa', 'Edu').why === 'sem-time' && ck('', 'Edu').why === 'sem-time' && ck('a.b', 'Edu', CHAMP({ teams: ['a.b'] })).why === 'sem-time' && ck(undefined, 'Edu').why === 'sem-time');
  check('nome vazio, só espaços ou só símbolos é recusado', ck('azul', '').why === 'sem-nome' && ck('azul', '   ').why === 'sem-nome' && ck('azul', '###').why === 'sem-nome' && ck('azul', null).why === 'sem-nome');
  check('o nome vai até 40 letras (41 é recusado)', ck('azul', 'x'.repeat(40)).ok === true && ck('azul', 'x'.repeat(41)).why === 'nome-grande' && A.ROSTER_NAME_MAX === 40);
  check('campeonato sem elenco registrado (antigo ou criado sem times montados) não aceita ninguém: o elenco só existe se o sorteio o criou', ck('azul', 'Edu', CHAMP({ teamRosters: undefined })).why === 'sem-elenco' && ck('azul', 'Edu', CHAMP({ teamRosters: {} })).why === 'sem-elenco' && ck('azul', 'Edu', null).why === 'sem-elenco');
  check('um time que está sem ninguém ainda aceita (o elenco dele passa a ter o 1º jogador)', ck('amarelo', 'Edu').ok === true);

  // ══ 3. ABRIR O MODAL: SÓ O ADMIN ════════════════════════════════════════════════════════════════════════════════════════
  const e1 = makeEnv({ admin: false });
  e1.api.openAddRoster('c1', 'azul');
  check('quem não é admin não abre o modal', e1.st.modal === null && e1.calls.renders === 0);
  const e2 = makeEnv();
  e2.api.openAddRoster('c1', 'verde');
  check('o admin abre o modal com o time já escolhido quando vem do "+" do time, e pede para redesenhar', e2.st.modal.type === 'addRoster' && e2.st.modal.champId === 'c1' && e2.st.modal.teamId === 'verde' && e2.st.modal.name === '' && e2.st.modal.guest === false && e2.calls.renders === 1, e2.st.modal);
  const e3 = makeEnv(); e3.api.openAddRoster('c1');
  check('pelo botão geral abre sem time escolhido; time que não é do campeonato também fica sem escolha', e3.st.modal.teamId === '' && (() => { const e = makeEnv(); e.api.openAddRoster('c1', 'rosa'); return e.st.modal.teamId === ''; })());
  check('campeonato que não existe ou sem elenco não abre', (() => { const a = makeEnv(); a.api.openAddRoster('nada', 'azul'); const b = makeEnv({ champs: [CHAMP({ teamRosters: undefined })] }); b.api.openAddRoster('c1', 'azul'); const c = makeEnv({ champs: [CHAMP({ teamRosters: {} })] }); c.api.openAddRoster('c1', 'azul'); return a.st.modal === null && b.st.modal === null && c.st.modal === null; })());

  // ══ 4. O MODAL: LISTA, TIMES, AVISO E BOTÃO ═════════════════════════════════════════════════════════════════════════════
  const m0 = makeEnv(); m0.api.openAddRoster('c1');
  const body0 = m0.api.mAddRoster();
  check('o modal mostra o título, a explicação, a busca, a lista de quem pode entrar (1 botão por jogador, escolhido pelo número), os times com o tamanho do elenco e o botão desligado', /➕ Adicionar ao elenco/.test(body0) && /Para quem chegou depois do sorteio/.test(body0) && /oninput="rosterSearch\(this\.value\)"/.test(body0) && /onclick="pickRosterIdx\(0\)"[\s\S]*?Edu/.test(body0) && /onclick="pickRosterIdx\(3\)"[\s\S]*?Carla[\s\S]*?inativo/.test(body0) && /onclick="pickRosterTeam\('azul'\)"[^>]*>Azul <span[^>]*>2<\/span>/.test(body0) && /onclick="pickRosterTeam\('amarelo'\)"[^>]*>Amarelo <span[^>]*>0<\/span>/.test(body0) && /<button onclick="confirmAddRoster\(\)" disabled[^>]*>Escolha o jogador e o time</.test(body0), body0.slice(0, 500));
  check('o modal guarda a lista mostrada (o toque escolhe pelo número) e o goleiro leva a luva', J(m0.st.modal.cands) === '["Edu","Fabi","João Pé","Carla"]' && (() => { const e = makeEnv({ champs: [CHAMP({ teamRosters: { azul: ['Ana'] } })] }); e.api.openAddRoster('c1'); const h = e.api.mAddRoster(); return /Gil 🧤/.test(h) && !/Edu 🧤/.test(h); })());
  m0.api.pickRosterIdx(0);
  check('escolher o jogador marca a linha (✓), troca o texto do botão e atualiza a lista e o rodapé no lugar, sem redesenhar o modal', m0.st.modal.name === 'Edu' && m0.st.modal.guest === false && /✓/.test(m0.els['ar-list'].innerHTML) && /Escolha o jogador e o time/.test(m0.els['ar-foot'].innerHTML) && m0.calls.renders === 1, [m0.st.modal.name, m0.els['ar-foot'].innerHTML.slice(0, 200)]);
  m0.api.pickRosterTeam('azul');
  check('com o jogador e o time escolhidos o botão liga e diz o que vai acontecer ("Adicionar Edu ao time Azul"); o chip do time fica na cor dele', !/disabled/.test(m0.els['ar-foot'].innerHTML) && /Adicionar Edu ao time Azul/.test(m0.els['ar-foot'].innerHTML) && /border:1\.5px solid #4DB8FF/.test(m0.els['ar-teams'].innerHTML), [m0.els['ar-foot'].innerHTML.slice(0, 300), m0.els['ar-teams'].innerHTML.slice(0, 200)]);
  check('time que ainda não jogou: sem aviso', !/⚠️/.test(m0.els['ar-foot'].innerHTML));
  const played = (n, team) => Array.from({ length: n }, () => mt(team, 'verde', 1, 0));
  const w3 = makeEnv({ champs: [CHAMP({ matches: [...played(3, 'azul'), mt('verde', 'amarelo', 1, 1), mt('azul', 'amarelo', 0, 0, { played: false })] })] }); w3.api.openAddRoster('c1', 'azul'); w3.api.pickRosterIdx(0);
  check('time que já jogou 3 partidas: avisa que elas também contam (o jogo não disputado e o de outro time não entram na conta) e diz o que fazer se ele só jogou alguns', /⚠️ O time Azul já jogou <strong>3 partidas<\/strong>\. Como o elenco vale o campeonato inteiro, elas também contam para Edu\. Se ele só jogou alguns jogos, deixe-o como emprestado nesses jogos\./.test(w3.els['ar-foot'].innerHTML) && w3.api.rosterTeamGames(w3.st.champs[0], 'azul') === 3 && w3.api.rosterTeamGames(w3.st.champs[0], 'verde') === 4 && w3.api.rosterTeamGames(w3.st.champs[0], 'amarelo') === 1, w3.els['ar-foot'].innerHTML.slice(0, 400));
  const w1 = makeEnv({ champs: [CHAMP({ matches: played(1, 'azul') })] }); w1.api.openAddRoster('c1', 'azul'); w1.api.pickRosterIdx(1);
  check('com 1 partida o aviso fala no singular ("1 partida", "ela também conta")', /<strong>1 partida<\/strong>[\s\S]*ela também conta para Fabi/.test(w1.els['ar-foot'].innerHTML), w1.els['ar-foot'].innerHTML.slice(0, 300));
  check('o aviso só aparece com o jogador E o time escolhidos', (() => { const e = makeEnv({ champs: [CHAMP({ matches: played(2, 'azul') })] }); e.api.openAddRoster('c1', 'azul'); return !/⚠️/.test(e.api.rosterFootHtml()); })());

  // ══ 5. A BUSCA E O CONVIDADO ════════════════════════════════════════════════════════════════════════════════════════════
  const s1 = makeEnv(); s1.api.openAddRoster('c1', 'verde');
  s1.api.rosterSearch('Zé Novo');
  check('digitar um nome que ninguém tem mostra a opção de convidado (sem cadastro) e nenhum cadastrado', /Convidado: “Zé Novo” <span[^>]*>\(sem cadastro\)/.test(s1.els['ar-list'].innerHTML) && /onclick="pickRosterGuest\(\)"/.test(s1.els['ar-list'].innerHTML) && !/pickRosterIdx/.test(s1.els['ar-list'].innerHTML) && s1.st.modal.query === 'Zé Novo', s1.els['ar-list'].innerHTML.slice(0, 300));
  s1.api.pickRosterGuest();
  check('escolher o convidado guarda o nome digitado, marca como convidado e o rodapé explica que ele não tem cadastro e fica só neste campeonato', s1.st.modal.name === 'Zé Novo' && s1.st.modal.guest === true && /Convidado: não tem cadastro e fica só neste campeonato/.test(s1.els['ar-foot'].innerHTML) && /Adicionar Zé Novo ao time Verde/.test(s1.els['ar-foot'].innerHTML), s1.els['ar-foot'].innerHTML.slice(0, 300));
  s1.api.rosterSearch('Zé Novo 2');
  check('mudar o texto depois de escolher o convidado desfaz a escolha (o nome antigo não vale mais)', s1.st.modal.name === '' && s1.st.modal.guest === false && /Escolha o jogador e o time/.test(s1.els['ar-foot'].innerHTML));
  const s2 = makeEnv(); s2.api.openAddRoster('c1'); s2.api.rosterSearch('edu');
  check('digitar o nome de um cadastrado mostra só ele, sem a opção de convidado', J(s2.st.modal.cands) === '["Edu"]' && !/Convidado/.test(s2.els['ar-list'].innerHTML));
  s2.api.rosterSearch('ana');
  check('digitar o nome de quem já está em um time avisa e não oferece convidado nem cadastrado', /Esse jogador já está em um time deste campeonato/.test(s2.els['ar-list'].innerHTML) && !/Convidado/.test(s2.els['ar-list'].innerHTML) && s2.st.modal.cands.length === 0, s2.els['ar-list'].innerHTML.slice(0, 200));
  const sg = makeEnv({ champs: [CHAMP({ teamRosters: { azul: ['Ana', 'Zé Convidado'], verde: ['Bruno'] } })] }); sg.api.openAddRoster('c1', 'verde'); sg.api.rosterSearch('ze convidado');
  check('digitar o nome de um CONVIDADO que já entrou em um time (sem cadastro) também avisa e não oferece convidado de novo', /Esse jogador já está em um time deste campeonato/.test(sg.els['ar-list'].innerHTML) && !/Convidado/.test(sg.els['ar-list'].innerHTML) && !/pickRosterGuest/.test(sg.els['ar-list'].innerHTML), sg.els['ar-list'].innerHTML.slice(0, 200));
  s2.api.rosterSearch('davi');
  check('digitar o nome de quem é "só churrasco" explica que ele não joga (e não oferece convidado com o mesmo nome)', /está como "só churrasco" no cadastro: ele não joga/.test(s2.els['ar-list'].innerHTML) && !/Convidado/.test(s2.els['ar-list'].innerHTML), s2.els['ar-list'].innerHTML.slice(0, 200));
  s2.api.rosterSearch('');
  check('apagar a busca volta a lista inteira', J(s2.st.modal.cands) === '["Edu","Fabi","João Pé","Carla"]');
  const s3 = makeEnv({ champs: [CHAMP({ teamRosters: { azul: PLAYERS.map(p => p.name) } })] }); s3.api.openAddRoster('c1', 'azul');
  check('quando todos os cadastrados já estão em um time a lista diz isso', /Ninguém para escolher: todos os jogadores já estão em um time/.test(s3.api.rosterListHtml()));
  check('o botão do convidado e os nomes passam pelo escape (nenhuma etiqueta solta)', (() => { const e = makeEnv({ players: [...PLAYERS, { name: '<b>Hack</b>', active: true }] }); e.api.openAddRoster('c1', 'azul'); const a = e.api.mAddRoster(); e.api.rosterSearch('<i>x</i>'); const b = e.els['ar-list'].innerHTML; return /&lt;b>Hack&lt;\/b>/.test(a) && !/<b>Hack<\/b>/.test(a) && /&lt;i>x&lt;\/i>/.test(b) && !/<i>x<\/i>/.test(b) && /value="&lt;i>x&lt;\/i>"/.test(e.api.mAddRoster()); })());

  // ══ 6. GRAVAR ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
  const g1 = makeEnv(); g1.api.openAddRoster('c1', 'azul'); g1.api.pickRosterIdx(0);
  await g1.api.confirmAddRoster();
  check('confirmar grava só aquele time com arrayUnion (não sobrescreve o resto do elenco), fecha o modal e avisa', g1.calls.updates.length === 1 && g1.calls.updates[0][0] === 'championships/c1' && J(Object.keys(g1.calls.updates[0][1])) === '["teamRosters.azul"]' && J(g1.calls.updates[0][1]['teamRosters.azul']) === '{"arrayUnion":["Edu"]}' && g1.st.modal === null && g1.calls.toasts.at(-1)[0] === 'Edu entrou no elenco do time Azul.' && g1.calls.toasts.at(-1)[1] === 'ok', [g1.calls.updates, g1.calls.toasts]);
  const g2 = makeEnv(); g2.api.openAddRoster('c1', 'amarelo'); g2.api.rosterSearch('Zé Novo'); g2.api.pickRosterGuest(); await g2.api.confirmAddRoster();
  check('o convidado entra pelo nome digitado, no time vazio', J(g2.calls.updates[0][1]) === '{"teamRosters.amarelo":{"arrayUnion":["Zé Novo"]}}', g2.calls.updates);
  const g3 = makeEnv(); g3.api.openAddRoster('c1'); g3.api.rosterSearch('joao pe'); g3.api.pickRosterIdx(0); g3.api.pickRosterTeam('verde'); await g3.api.confirmAddRoster();
  check('o cadastrado entra com a grafia do cadastro mesmo achado pela busca sem acento', J(g3.calls.updates[0][1]) === '{"teamRosters.verde":{"arrayUnion":["João Pé"]}}', g3.calls.updates);
  const g4 = makeEnv(); g4.api.openAddRoster('c1', 'azul'); await g4.api.confirmAddRoster();
  const g4b = makeEnv(); g4b.api.openAddRoster('c1'); g4b.api.pickRosterIdx(0); await g4b.api.confirmAddRoster();
  check('sem escolher o jogador: avisa e não grava; sem escolher o time: avisa e não grava (o modal continua aberto)', g4.calls.updates.length === 0 && g4.calls.toasts.at(-1)[0] === 'Escolha o jogador.' && g4b.calls.updates.length === 0 && g4b.calls.toasts.at(-1)[0] === 'Escolha o time.' && g4b.st.modal !== null && g4.st.modal !== null);
  const g5 = makeEnv(); g5.api.openAddRoster('c1', 'azul'); g5.api.pickRosterIdx(0);
  g5.st.champs[0].teamRosters.verde.push('Edu'); // alguém pôs o Edu no verde enquanto o modal estava aberto
  await g5.api.confirmAddRoster();
  check('se o jogador entrou em outro time enquanto o modal estava aberto: avisa em qual time está e não grava', g5.calls.updates.length === 0 && g5.calls.toasts.at(-1)[0] === 'Edu já está no elenco do time Verde.', g5.calls.toasts);
  const g6 = makeEnv(); g6.ctl.fail = true; g6.api.openAddRoster('c1', 'azul'); g6.api.pickRosterIdx(0); await g6.api.confirmAddRoster();
  check('se a gravação falha (sem internet): o modal continua aberto, o botão volta a funcionar e o erro aparece', g6.st.modal !== null && g6.st.modal.busy === false && /^Erro: sem conexão/.test(g6.calls.toasts.at(-1)[0]) && g6.calls.toasts.at(-1)[1] === undefined, g6.calls.toasts);
  const g7 = makeEnv(); let solta; g7.ctl.hold = new Promise(r => { solta = r; }); g7.api.openAddRoster('c1', 'azul'); g7.api.pickRosterIdx(0);
  const p1 = g7.api.confirmAddRoster(); const p2 = g7.api.confirmAddRoster(); await wait(5); solta(); await Promise.all([p1, p2]);
  check('dois toques seguidos no botão gravam uma vez só', g7.calls.updates.length === 1, g7.calls.updates);
  const g8 = makeEnv({ admin: false }); g8.st.modal = { type: 'addRoster', champId: 'c1', teamId: 'azul', name: 'Edu', guest: false, query: '', cands: [] }; await g8.api.confirmAddRoster();
  const g9 = makeEnv({ db: false }); g9.st.modal = { type: 'addRoster', champId: 'c1', teamId: 'azul', name: 'Edu', guest: false, query: '', cands: [] }; await g9.api.confirmAddRoster();
  check('quem não é admin (ou sem banco conectado) não grava, mesmo com o modal montado à mão', g8.calls.updates.length === 0 && g9.calls.updates.length === 0);
  const g10 = makeEnv(); g10.st.modal = null; await g10.api.confirmAddRoster(); g10.api.pickRosterIdx(0); g10.api.pickRosterTeam('azul'); g10.api.pickRosterGuest(); g10.api.rosterSearch('x');
  check('sem o modal aberto nenhuma das ações faz nada (nem quebra)', g10.calls.updates.length === 0 && g10.st.modal === null);
  const g11 = makeEnv({ champs: [CHAMP({ status: 'completed', champion: 'azul' })] }); g11.api.openAddRoster('c1', 'azul'); g11.api.pickRosterIdx(0); await g11.api.confirmAddRoster();
  check('campeonato já concluído também aceita (o admin corrige quem ficou de fora do elenco)', g11.calls.updates.length === 1 && g11.st.modal === null);

  // ══ 7. A CONTA DE "EMPRESTADO" ══════════════════════════════════════════════════════════════════════════════════════════
  const B = makeEnv().api;
  const part = (home, away, who, side, extra = {}) => mt(home, away, 1, 0, { participants: [{ player: who, team: side }], ...extra });
  const own6 = Array.from({ length: 6 }, (_, i) => part('azul', i % 2 ? 'verde' : 'amarelo', 'Edu', 'home'));
  check('o caso real: jogador marcado como emprestado nos 6 jogos do PRÓPRIO time e depois posto no elenco desse time não conta nenhum jogo como emprestado (antes contava 6: Fominha e Jogo Todas indevidos)', B.champBorrowedCount({ matches: own6 }, 'Edu', 'azul') === 0, B.champBorrowedCount({ matches: own6 }, 'Edu', 'azul'));
  check('o mesmo jogador, sem estar em elenco nenhum (como era antes de entrar), tem os 6 jogos como emprestado', B.champBorrowedCount({ matches: own6 }, 'Edu', null) === 6);
  check('participante do time de visitante: o lado "away" também conta como o próprio time', B.champBorrowedCount({ matches: [part('verde', 'azul', 'Edu', 'away')] }, 'Edu', 'azul') === 0);
  check('emprestado ao ADVERSÁRIO num jogo do próprio time conta (ele é do azul e jogou pelo verde contra o azul)', B.champBorrowedCount({ matches: [part('verde', 'azul', 'Edu', 'home')] }, 'Edu', 'azul') === 1 && B.champBorrowedCount({ matches: [part('azul', 'verde', 'Edu', 'away')] }, 'Edu', 'azul') === 1);
  check('emprestado a outro time (jogo em que o time dele nem joga) conta, por participação ou por gol; participação e gol no mesmo jogo contam uma vez só', B.champBorrowedCount({ matches: [part('verde', 'amarelo', 'Edu', 'home'), mt('verde', 'amarelo', 2, 0, { goals: [{ player: 'Edu', team: 'home' }, { player: 'Edu', team: 'home' }] }), part('verde', 'amarelo', 'Edu', 'away', { goals: [{ player: 'Edu', team: 'away' }] })] }, 'Edu', 'azul') === 3);
  check('gol no jogo do próprio time não é emprestado; gol em jogo de outros times de quem não está em elenco nenhum também não (como sempre foi)', B.champBorrowedCount({ matches: [mt('azul', 'verde', 1, 0, { goals: [{ player: 'Edu', team: 'home' }] })] }, 'Edu', 'azul') === 0 && B.champBorrowedCount({ matches: [mt('verde', 'amarelo', 1, 0, { goals: [{ player: 'Edu', team: 'home' }] })] }, 'Edu', null) === 0);
  check('jogo não disputado não conta; a final com gols da prorrogação (finalGoals) vale pelos gols da prorrogação', B.champBorrowedCount({ matches: [part('verde', 'amarelo', 'Edu', 'home', { played: false })] }, 'Edu', 'azul') === 0 && B.champBorrowedCount({ matches: [mt('verde', 'amarelo', 1, 1, { phase: 'final', goals: [{ player: 'Zé', team: 'home' }], finalGoals: [{ player: 'Edu', team: 'home' }] })] }, 'Edu', 'azul') === 1);
  check('campeonato sem jogos ou sem a lista de jogos não quebra', B.champBorrowedCount({}, 'Edu', 'azul') === 0 && B.champBorrowedCount({ matches: [] }, 'Edu', null) === 0);
  check('participante sem o lado registrado (dado antigo) continua contando como emprestado, como antes', B.champBorrowedCount({ matches: [mt('azul', 'verde', 1, 0, { participants: [{ player: 'Edu' }] })] }, 'Edu', 'azul') === 1);

  // ══ 8. AS LIGAÇÕES NO APP ═══════════════════════════════════════════════════════════════════════════════════════════════
  check('o modal entra no desenho dos modais, antes do Avulso do financeiro', /\+mRenamePlayer\(\)\+mAddRoster\(\)\+mFinAvulso\(\)\+/.test(html));
  check('o card Elencos tem o "+" em cada time e o botão geral, só para o admin (canRemove = isAdmin()), com a explicação', /const canRemove = isAdmin\(\);/.test(html) && /\$\{canRemove\?`<button onclick="event\.stopPropagation\(\);openAddRoster\('\$\{champ\.id\}','\$\{tid\}'\)" title="Adicionar jogador a este time"/.test(html) && /\$\{canRemove\?`<div style="padding:10px 14px;border-top:1px solid var\(--border2\)"><button onclick="openAddRoster\('\$\{champ\.id\}'\)"[^`]*➕ Adicionar jogador ao elenco<\/button><div[^>]*>Para quem chegou depois do sorteio\.<\/div><\/div>`:''\}/.test(html));
  check('o botão de tirar do elenco (✕) continua como era', /removeFromRoster\('\$\{champ\.id\}','\$\{tid\}','\$\{n\.replace\(\/'\/g,"\\\\'"\)\}'\)/.test(html) && /async function removeFromRoster\(champId, teamId, playerName\) \{\s*if\(!isAdmin\(\)\|\|!DB\) return;/.test(html));
  check('as DUAS contas das conquistas (a aba Meu Craque e o cache de todos os jogadores) usam champBorrowedCount e a conta velha de emprestado saiu', /const borrowed = champBorrowedCount\(champ, myName, myTeam2\);/.test(html) && /const bor=champBorrowedCount\(champ,name,myTeam2\);/.test(html) && !/bor\+\+|borrowed\+\+/.test(html));
  check('o bloco do elenco não chama função do servidor nem grava nada além do time (um único update, com o caminho do time)', !/callFn\(|httpsCallable|\.add\(|\.set\(|\.delete\(/.test(rosterCode) && (rosterCode.match(/\.update\(/g) || []).length === 1 && /update\(\{ \[`teamRosters\.\$\{m\.teamId\}`\]: firebase\.firestore\.FieldValue\.arrayUnion\(chk\.name\) \}\)/.test(rosterCode));
  check('as regras do Firestore já deixam quem está ativo na liga gravar no campeonato (a regra "só admin" é do app, como no ✕); nenhuma regra nova foi preciso', /match \/leagues\/\{leagueId\}\/championships\/\{docId\} \{\s*allow read: if isLeagueActiveUser\(leagueId\);\s*allow write: if isLeagueActiveUser\(leagueId\);/.test(rules));

  // ══ 9. O MANUAL ═════════════════════════════════════════════════════════════════════════════════════════════════════════
  const ini = manual.indexOf('id="elenco-tardio"');
  const sec = ini < 0 ? '' : manual.slice(ini, manual.indexOf('<h3', ini + 20) < 0 ? ini + 4000 : manual.indexOf('<h3', ini + 20)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('o manual tem a subseção "Jogador que chegou depois do sorteio" com o caminho (card Elencos, + ou botão geral), quem pode (só o admin), campeonato em andamento ou concluído e o convidado', /Jogador que chegou depois do sorteio/.test(sec) && /card 👥 Elencos/.test(sec) && /só o admin/i.test(sec) && /em andamento ou já concluído/.test(sec) && /entra como convidado/.test(sec), sec.slice(0, 400));
  check('o manual explica que o jogador conta no campeonato inteiro (os jogos que o time já fez também), o que fazer se ele só jogou alguns jogos (emprestado) e que Fominha e Jogo Todas deixam de contar o próprio time', /campeonato inteiro/.test(sec) && /jogos que o time já tinha feito/.test(sec) && /emprestado/.test(sec) && /Fominha/.test(sec) && /Jogo Todas/.test(sec), sec.slice(0, 900));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERRO NO TESTE: ' + (e && e.stack || e)); process.exit(1); });
