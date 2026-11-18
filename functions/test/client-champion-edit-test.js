// Editar os campeões de um campeonato JÁ finalizado (item 49): o admin toca em "✏️ Editar campeões" no quadro do campeão (Histórico), muda a lista (tirar, pôr, 1 ou ½) e confirma; o app
// grava a lista nova E acerta os títulos de quem entrou, saiu ou mudou de peso (player_titles), numa TRANSAÇÃO. Confere: o botão (só admin, só campeonato finalizado), a conferência da lista
// (nome, repetido, vazio, grafia do cadastro), o que mudou (entra, sai, peso, nome), a pergunta antes de gravar, o acerto dos títulos (entrada nova, entrada que sai, registro antigo sem
// champId, documento que some, documento que nasce), a gravação tudo-ou-nada (leituras antes das gravações, conflito com outra pessoa, falha na gravação, plano gratuito), a janela
// (modo edição x modo registrar), o manual, o CI e as regras do Firestore. O código é o REAL do index.html (fatiado e executado com um aplicativo falso).
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), manual = read('manual.html'), ci = read('.github/workflows/ci.yml'), rules = read('firestore.rules');
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
const fdtCode = slice('const fdt = d =>', '\n');
const defCode = slice('function defPlayers() {', 'const playerKey =');
const blockCode = slice('/* ── Editar os campeões de um campeonato JÁ finalizado (item 49)', 'async function addRegisteredPlayer(');
const mChampCode = slice('function mChamp() {', 'const esc = s =>');
const upCode = slice('function upP(i,field,val) {', 'function nextPlayerInput(i) {'); // upP, addP e removeP
const saveCode = slice('async function saveChampion() {', 'async function swapMatchesInChamp(');

const J = JSON.stringify;
const clone = x => JSON.parse(J(x));
const PLAYERS = [
  { name: 'Ana', active: true }, { name: 'Beto', active: true }, { name: 'Carla', active: true }, { name: 'Edu', active: true }, { name: 'João Pé', active: true },
  { name: 'Fabi', active: false }, { name: 'Gil', active: true, goleiro: true },
];
const CHAMP = (o = {}) => ({
  id: 'c1', status: 'completed', date: '2026-11-10', champion: 'verde', teams: ['azul', 'verde', 'amarelo'],
  champion_players: [{ name: 'Ana', weight: 1 }, { name: 'Beto', weight: 1 }, { name: 'Carla', weight: 0.5 }], ...o,
});
const TITLES = () => ({
  'player_titles/ana': { name: 'Ana', titles: 2, last_date: '2026-11-10', entries: [{ date: '2026-10-27', weight: 1, team: 'azul', champId: 'c0' }, { date: '2026-11-10', weight: 1, team: 'verde', champId: 'c1' }] },
  'player_titles/beto': { name: 'Beto', titles: 1, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 1, team: 'verde', champId: 'c1' }] },
  'player_titles/carla': { name: 'Carla', titles: 0.5, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 0.5, team: 'verde' }] }, // registro antigo: sem champId
});

// Um banco de mentira com TRANSAÇÃO de verdade: as gravações só valem se a função termina e a gravação final não falha; ler depois de gravar é erro (como no Firestore).
function makeEnv({ champs, players = PLAYERS, admin = true, confirmAnswer = true, db = true, extra = {} } = {}) {
  const store = new Map(Object.entries({ 'leagues/L1/championships/c1': CHAMP(), ...Object.fromEntries(Object.entries(TITLES()).map(([k, v]) => ['leagues/L1/' + k, v])), ...extra }));
  const log = { reads: [], commits: [], tx: 0 };
  const ctl = { failCommit: false, modalDuring: null };
  const calls = { toasts: [], renders: 0, confirms: [] };
  const els = { 'modal-root': { innerHTML: '' }, inputs: [] };
  const snapOf = p => ({ exists: store.has(p), data: () => (store.has(p) ? clone(store.get(p)) : undefined) });
  const DB = {
    doc: p => ({ path: p }),
    async runTransaction(fn) {
      log.tx++;
      ctl.modalDuring = st.modal ? st.modal.type : null; // o que a tela mostra enquanto a transação roda
      const writes = []; let wrote = false;
      const tx = {
        get: async r => { if (wrote) throw new Error('leitura depois de gravar'); log.reads.push(r.path); return snapOf(r.path); },
        update: (r, d) => { wrote = true; writes.push(['update', r.path, clone(d)]); },
        set: (r, d) => { wrote = true; writes.push(['set', r.path, clone(d)]); },
        delete: r => { wrote = true; writes.push(['delete', r.path]); },
      };
      await fn(tx);
      if (ctl.failCommit) throw new Error('sem conexão');
      for (const [op, p, d] of writes) {
        if (op === 'update' && !store.has(p)) throw new Error('NOT_FOUND: update de um documento que não existe (como no Firestore de verdade)');
        if (op === 'delete') store.delete(p);
        else if (op === 'set') store.set(p, d);
        else store.set(p, { ...(store.get(p) || {}), ...d });
      }
      log.commits.push(writes);
    },
  };
  const st = { champs: champs || [CHAMP()], players, modal: null, leagueId: 'L1' };
  const env = {
    st, isAdmin: () => admin, DB: db ? DB : null, ldoc: p => DB.doc('leagues/L1/' + p),
    toast: (m, t) => { calls.toasts.push([m, t]); }, render: () => { calls.renders++; },
    confirm: msg => { calls.confirms.push(msg); return confirmAnswer; },
    mScore: () => '', activeChamp: () => ({ id: 'cA', date: '2026-11-18', status: 'active' }), today: () => '2026-11-18', votingSnapshotFor: () => null,
    document: { getElementById: id => els[id] || null, querySelectorAll: () => els.inputs },
  };
  const names = Object.keys(env);
  const body = [escCode, keyCode, teamCode, fdtCode, defCode, blockCode, mChampCode, upCode, saveCode].join('\n') + `
return { CHAMP_NAME_MAX, champW, championListSig, championEditCheck, championEditWhy, championEditDiff, championEditConfirmText, championTitleChange, championEditButton, openChampionEdit,
  saveChampionEdit, saveChampion, mChamp, upP, addP, removeP, defPlayers, playerKey };`;
  const api = new Function(...names, body)(...names.map(n => env[n]));
  return { api, st, store, log, ctl, calls, els };
}
const sets = (log) => log.commits.flat();
const at = (log, p) => sets(log).find(w => w[1] === p);

(async () => {
  const E0 = makeEnv(), A = E0.api;

  // ══ 1. O PESO E A ASSINATURA DA LISTA ═════════════════════════════════════════════════════════════════════════════════════
  check('o peso de um campeão é 1 (título inteiro) ou 0,5 (meio título): ½ fica ½, o resto vira 1, registro antigo sem peso vale 1', A.champW(0.5) === 0.5 && A.champW('0.5') === 0.5 && A.champW(1) === 1 && A.champW(undefined) === 1 && A.champW(null) === 1 && A.champW(2) === 1 && A.champW(0.25) === 1 && A.champW('x') === 1);
  const sigA = A.championListSig([{ name: 'Ana', weight: 1 }, { name: 'Beto', weight: 0.5 }]);
  check('a assinatura da lista não depende da ordem, mas muda se muda o peso, o nome ou quem está', sigA === A.championListSig([{ name: 'Beto', weight: 0.5 }, { name: 'Ana', weight: 1 }]) && sigA !== A.championListSig([{ name: 'Ana', weight: 1 }, { name: 'Beto', weight: 1 }]) && sigA !== A.championListSig([{ name: 'ana', weight: 1 }, { name: 'Beto', weight: 0.5 }]) && sigA !== A.championListSig([{ name: 'Ana', weight: 1 }]));
  check('a assinatura ignora linha em branco e lista vazia ou ausente é a mesma coisa', A.championListSig([{ name: 'Ana', weight: 1 }, { name: '  ' }, null]) === A.championListSig([{ name: 'Ana', weight: 1 }]) && A.championListSig(null) === '' && A.championListSig([]) === '' && A.championListSig(undefined) === '');

  // ══ 2. CONFERIR A LISTA DA JANELA ═════════════════════════════════════════════════════════════════════════════════════════
  const ck = rows => A.championEditCheck(rows);
  check('a lista boa volta na ordem, com a grafia do cadastro ("edu" vira "Edu", "joao   pe" vira "João Pé") e o peso 1 ou ½', J(ck([{ name: ' edu ', weight: 1 }, { name: 'joao   pe', weight: 0.5 }, { name: 'Zé Convidado', weight: 1 }])) === '{"ok":true,"list":[{"name":"Edu","weight":1},{"name":"João Pé","weight":0.5},{"name":"Zé Convidado","weight":1}]}', ck([{ name: ' edu ', weight: 1 }, { name: 'joao   pe', weight: 0.5 }]));
  check('linha em branco é ignorada (só espaços também) e o peso estranho vira 1', J(ck([{ name: 'Ana', weight: 7 }, { name: '' }, { name: '   ', weight: 0.5 }, { name: null }, undefined])) === '{"ok":true,"list":[{"name":"Ana","weight":1}]}', ck([{ name: 'Ana', weight: 7 }, { name: '' }]));
  check('lista sem ninguém (ou só linhas em branco) é recusada: "vazio"', ck([]).why === 'vazio' && ck([{ name: '' }, { name: '  ' }]).why === 'vazio' && ck(null).why === 'vazio' && ck(undefined).why === 'vazio');
  check('o mesmo jogador duas vezes é recusado, mesmo com acento, maiúscula ou espaço diferente ("João Pé" e "joao pe")', J(ck([{ name: 'João Pé' }, { name: 'joao  pe' }])) === '{"ok":false,"why":"repetido","name":"joao pe"}' && ck([{ name: 'Ana' }, { name: 'ANA' }]).why === 'repetido', ck([{ name: 'João Pé' }, { name: 'joao  pe' }]));
  check('nome só com símbolos é recusado ("###"); nome acima de 40 letras também (40 passa)', ck([{ name: '###' }]).why === 'nome-invalido' && ck([{ name: 'x'.repeat(41) }]).why === 'nome-grande' && ck([{ name: 'x'.repeat(40) }]).ok === true && A.CHAMP_NAME_MAX === 40);
  check('as mensagens de cada recusa, em português claro', A.championEditWhy({ why: 'vazio' }) === 'Deixe ao menos um jogador campeão.' && A.championEditWhy({ why: 'repetido', name: 'Ana' }) === 'Ana aparece duas vezes na lista.' && A.championEditWhy({ why: 'nome-grande', name: 'x' }) === 'O nome pode ter no máximo 40 letras: x' && A.championEditWhy({ why: 'nome-invalido', name: '###' }) === '"###" não é um nome válido.');
  check('quem não tem cadastro (convidado) entra com o nome digitado, só com os espaços arrumados', J(ck([{ name: '  Zé   Convidado ' }]).list) === '[{"name":"Zé Convidado","weight":1}]');

  // ══ 3. O QUE MUDOU ════════════════════════════════════════════════════════════════════════════════════════════════════════
  const old = [{ name: 'Ana', weight: 1 }, { name: 'Beto', weight: 1 }, { name: 'Carla', weight: 0.5 }];
  const d1 = A.championEditDiff(old, [{ name: 'Ana', weight: 1 }, { name: 'Carla', weight: 1 }, { name: 'Edu', weight: 0.5 }]);
  check('entra, sai e muda de peso: Edu entra (½), Beto sai e Carla passa de ½ para 1', J(d1.added) === '[{"name":"Edu","weight":0.5}]' && J(d1.removed) === '[{"name":"Beto","weight":1}]' && J(d1.weight) === '[{"name":"Carla","from":0.5,"to":1}]' && d1.renamed.length === 0 && d1.any === true, d1);
  check('lista igual (mesmo em outra ordem) não muda nada: any é falso', A.championEditDiff(old, [{ name: 'Carla', weight: 0.5 }, { name: 'Ana', weight: 1 }, { name: 'Beto', weight: 1 }]).any === false && A.championEditDiff(old, old).any === false);
  const d2 = A.championEditDiff([{ name: 'joão pé', weight: 1 }], [{ name: 'João Pé', weight: 1 }]);
  check('só a grafia do nome mudou ("joão pé" para "João Pé"): é um nome corrigido, não sai nem entra ninguém', d2.renamed.length === 1 && d2.renamed[0].from === 'joão pé' && d2.renamed[0].to === 'João Pé' && !d2.added.length && !d2.removed.length && !d2.weight.length && d2.any === true, d2);
  const d3 = A.championEditDiff(null, [{ name: 'Ana', weight: 1 }]);
  check('campeonato sem lista gravada (antigo): todo mundo é "entra"; registro antigo sem peso vale 1', d3.added.length === 1 && A.championEditDiff([{ name: 'Ana' }], [{ name: 'Ana', weight: 1 }]).any === false);

  // ══ 4. A PERGUNTA ANTES DE GRAVAR ═════════════════════════════════════════════════════════════════════════════════════════
  const full = A.championEditDiff(old, [{ name: 'Ana', weight: 0.5 }, { name: 'Carla', weight: 1 }, { name: 'Edu', weight: 1 }, { name: 'Dani', weight: 1 }, { name: 'joão', weight: 1 }]);
  const txt = A.championEditConfirmText(CHAMP(), full, ['Dani']);
  check('a pergunta diz a data e o time, quem entra, quem sai, quem passa a ½ e a título inteiro, e o aviso do Ranking', /^Salvar as mudanças nos campeões de 10\/11\/2026 \(Verde\)\?\n\n/.test(txt) && /\nEntram: Edu, Dani, joão\n/.test(txt) && /\nSaem: Beto\n/.test(txt) && /\nPassam a ½ título: Ana\n/.test(txt) && /\nPassam a título inteiro: Carla\n/.test(txt) && /\n\nOs títulos de cada um no Ranking mudam junto\.$/.test(txt), txt);
  check('quem não tem cadastro no elenco é avisado ("⚠️ Sem cadastro no elenco: Dani"), e sem ninguém assim o aviso não aparece', /\n\n⚠️ Sem cadastro no elenco: Dani\n\nOs títulos/.test(txt) && !/Sem cadastro/.test(A.championEditConfirmText(CHAMP(), full, [])));
  check('só as linhas que mudaram aparecem: um nome corrigido sozinho não traz "Entram", "Saem" nem "Passam a"', !/Entram|Saem|Passam a/.test(A.championEditConfirmText(CHAMP(), d2, [])) && /^Salvar as mudanças/.test(A.championEditConfirmText(CHAMP(), d2, [])));
  check('nome corrigido aparece com a seta, e campeonato do plano gratuito troca o aviso do Ranking', /Nome corrigido: joão pé → João Pé/.test(A.championEditConfirmText(CHAMP(), d2, [])) && /plano gratuito: só a lista muda, ele ainda não conta no Ranking\.$/.test(A.championEditConfirmText(CHAMP({ freeMode: true }), d1, [])) && !/mudam junto/.test(A.championEditConfirmText(CHAMP({ freeMode: true }), d1, [])));
  check('time sem cor conhecida aparece pelo nome do id; linhas que não mudam não aparecem', /\(zzz\)\?/.test(A.championEditConfirmText(CHAMP({ champion: 'zzz' }), d1, [])) && !/Passam a ½/.test(A.championEditConfirmText(CHAMP(), d1, [])) && /Passam a título inteiro: Carla/.test(A.championEditConfirmText(CHAMP(), d1, [])));

  // ══ 5. ACERTAR OS TÍTULOS DE UM JOGADOR ═══════════════════════════════════════════════════════════════════════════════════
  const C = CHAMP();
  const tc = (doc, o, n) => A.championTitleChange(C, doc, o, n);
  const ana = TITLES()['player_titles/ana'], beto = TITLES()['player_titles/beto'], carla = TITLES()['player_titles/carla'];
  check('quem SAI e só tinha este título: o documento é apagado (como em excluir campeonato)', J(tc(beto, { name: 'Beto', weight: 1 }, undefined)) === '{"op":"delete"}');
  const outAna = tc(ana, { name: 'Ana', weight: 1 }, undefined);
  check('quem SAI e tinha outros títulos: só a entrada DESTE campeonato (champId) sai; os títulos e a última data são refeitos', outAna.op === 'update' && outAna.data.titles === 1 && outAna.data.last_date === '2026-10-27' && J(outAna.data.entries) === '[{"date":"2026-10-27","weight":1,"team":"azul","champId":"c0"}]' && outAna.data.name === 'Ana', outAna);
  const inEdu = tc(null, undefined, { name: 'Edu', weight: 0.5 });
  check('quem ENTRA e não tem documento: nasce com a entrada deste campeonato (data, peso, time, champId), o nome e a soma', inEdu.op === 'set' && J(inEdu.data) === '{"name":"Edu","titles":0.5,"last_date":"2026-11-10","entries":[{"date":"2026-11-10","weight":0.5,"team":"verde","champId":"c1"}]}', inEdu);
  const anaAntes = { name: 'Ana', titles: 1, last_date: '2026-10-27', entries: [{ date: '2026-10-27', weight: 1, team: 'azul', champId: 'c0' }] };
  const inAna = tc(anaAntes, undefined, { name: 'Ana', weight: 1 });
  check('quem ENTRA e já tem documento (de outro campeonato): soma mais uma entrada (o champId mostra que é desta vez), título e última data refeitos', inAna.op === 'update' && inAna.data.titles === 2 && inAna.data.last_date === '2026-11-10' && inAna.data.entries.length === 2 && inAna.data.entries[1].champId === 'c1' && inAna.data.entries[0].champId === 'c0', inAna);
  const wAna = tc(ana, { name: 'Ana', weight: 1 }, { name: 'Ana', weight: 0.5 });
  check('quem MUDA de peso (1 para ½): a entrada deste campeonato é trocada, não somada (2 títulos viram 1,5)', wAna.op === 'update' && wAna.data.titles === 1.5 && wAna.data.entries.length === 2 && wAna.data.entries.filter(e => e.champId === 'c1').length === 1 && wAna.data.entries.find(e => e.champId === 'c1').weight === 0.5, wAna);
  const wCar = tc(carla, { name: 'Carla', weight: 0.5 }, { name: 'Carla', weight: 1 });
  check('registro ANTIGO sem champId (Carla): a entrada que bate em data, time e peso é a trocada', wCar.op === 'update' && wCar.data.titles === 1 && J(wCar.data.entries) === '[{"date":"2026-11-10","weight":1,"team":"verde","champId":"c1"}]', wCar);
  const noMatch = tc({ name: 'Carla', titles: 0.5, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 0.5, team: 'azul' }] }, { name: 'Carla', weight: 0.5 }, undefined);
  check('registro antigo que NÃO bate (outro time): nada é tirado por engano; fica a entrada e o documento continua', noMatch.op === 'update' && noMatch.data.entries.length === 1 && noMatch.data.titles === 0.5, noMatch);
  check('o registro antigo (sem champId) só é procurado entre as entradas SEM champId: uma entrada de OUTRO campeonato com a mesma data, time e peso não é tirada por engano', (() => { const r = tc({ name: 'X', titles: 0.5, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 0.5, team: 'verde', champId: 'c9' }] }, { name: 'X', weight: 0.5 }, undefined); return r.op === 'update' && r.data.entries.length === 1 && r.data.entries[0].champId === 'c9' && r.data.titles === 0.5; })());
  check('o registro antigo é achado pela DATA do campeonato: se o jogador tem outra entrada antiga com o mesmo time e peso, mas de outro dia, é a do dia certo que sai', (() => { const r = tc({ name: 'X', titles: 2, last_date: '2026-11-10', entries: [{ date: '2026-10-27', weight: 1, team: 'verde' }, { date: '2026-11-10', weight: 1, team: 'verde' }] }, { name: 'X', weight: 1 }, undefined); return r.op === 'update' && r.data.entries.length === 1 && r.data.entries[0].date === '2026-10-27' && r.data.titles === 1 && r.data.last_date === '2026-10-27'; })());
  check('o registro antigo só sai se o PESO também bate: uma entrada de ½ não é tirada quando a lista diz que ele valia 1', (() => { const r = tc({ name: 'X', titles: 0.5, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 0.5, team: 'verde' }] }, { name: 'X', weight: 1 }, undefined); return r.op === 'update' && r.data.entries.length === 1 && r.data.entries[0].weight === 0.5 && r.data.titles === 0.5; })());
  check('o registro antigo só tira UMA entrada, mesmo havendo duas iguais', (() => { const r = tc({ name: 'X', titles: 1, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 0.5, team: 'verde' }, { date: '2026-11-10', weight: 0.5, team: 'verde' }] }, { name: 'X', weight: 0.5 }, undefined); return r.op === 'update' && r.data.entries.length === 1 && r.data.titles === 0.5; })());
  check('sair sem ter documento (plano antigo, dado perdido) não faz nada e não dá erro; sair com documento sem entrada deste campeonato não apaga os outros', J(tc(null, { name: 'Zé', weight: 1 }, undefined)) === '{"op":"none"}' && tc(ana, { name: 'Ana', weight: 1 }, undefined).data.entries.every(e => e.champId !== 'c1'));
  check('o documento nunca é alterado no lugar (as entradas antigas continuam como estavam depois da conta)', (() => { const d = clone(ana); tc(d, { name: 'Ana', weight: 1 }, { name: 'Ana', weight: 0.5 }); return J(d) === J(ana); })());
  check('nome corrigido: o documento leva o nome novo; quem sai sem nome novo guarda o do documento', tc(ana, { name: 'Ana', weight: 1 }, { name: 'ANA', weight: 1 }).data.name === 'ANA' && tc(ana, { name: 'Ana', weight: 1 }, undefined).data.name === 'Ana');
  check('a soma dos títulos usa 1 e ½ ("registro sem peso" vale 1) e a última data é a maior', (() => { const r = tc({ name: 'Y', titles: 1.5, last_date: '2026-09-01', entries: [{ date: '2026-09-01', weight: 1, champId: 'a' }, { date: '2026-09-08', team: 'azul', champId: 'b' }] }, undefined, { name: 'Y', weight: 0.5 }); return r.data.titles === 2.5 && r.data.last_date === '2026-11-10'; })());

  // ══ 6. O BOTÃO NO QUADRO DO CAMPEÃO ═══════════════════════════════════════════════════════════════════════════════════════
  check('o admin vê "✏️ Editar campeões" no campeonato finalizado (abre pelo id)', /<button class="btn btn-ghost btn-sm btn-inline"[^>]*onclick="openChampionEdit\('c1'\)">✏️ Editar campeões<\/button>/.test(A.championEditButton(CHAMP())), A.championEditButton(CHAMP()));
  check('quem não é admin não vê o botão; campeonato em andamento, sem campeão ou ausente também não', makeEnv({ admin: false }).api.championEditButton(CHAMP()) === '' && A.championEditButton(CHAMP({ status: 'active' })) === '' && A.championEditButton(CHAMP({ champion: null })) === '' && A.championEditButton(null) === '' && A.championEditButton(undefined) === '');
  check('o botão aparece no quadro do campeão da tela (logo depois do artilheiro, dentro do champion-banner)', /\$\{artHtml\}\n      \$\{championEditButton\(champ\)\}\n    <\/div>`;\n  \}\n\n  html\+=`<div class="champ-bar">/.test(html));

  // ══ 7. ABRIR A JANELA ═════════════════════════════════════════════════════════════════════════════════════════════════════
  const e1 = makeEnv({ admin: false }); e1.api.openChampionEdit('c1');
  check('quem não é admin não abre a janela e é avisado', e1.st.modal === null && e1.calls.renders === 0 && /Apenas administradores/.test(e1.calls.toasts[0][0]), e1.calls);
  const e2 = makeEnv(); e2.api.openChampionEdit('c1');
  check('o admin abre a janela com a lista gravada (cópia: mexer nela não mexe no campeonato), o time, o id e a assinatura', e2.st.modal.type === 'champion' && e2.st.modal.edit === true && e2.st.modal.champId === 'c1' && e2.st.modal.champion === 'verde' && J(e2.st.modal.players) === '[{"name":"Ana","weight":1},{"name":"Beto","weight":1},{"name":"Carla","weight":0.5}]' && e2.st.modal.players !== e2.st.champs[0].champion_players && e2.st.modal.sig === e2.api.championListSig(e2.st.champs[0].champion_players) && e2.calls.renders === 1, e2.st.modal);
  e2.st.modal.players[0].name = 'Zé'; e2.st.modal.players.pop();
  check('mexer na janela não mexe no campeonato guardado', J(e2.st.champs[0].champion_players) === J(CHAMP().champion_players));
  const e3 = makeEnv({ champs: [CHAMP({ champion_players: null })] }); e3.api.openChampionEdit('c1');
  check('campeonato finalizado sem lista (registro antigo) abre com 5 linhas em branco, como o registrar', e3.st.modal.players.length === 5 && e3.st.modal.players.every(p => p.name === '' && p.weight === 1));
  check('peso estranho ou ausente na lista gravada abre como 1 e linha sem nome é ignorada', (() => { const e = makeEnv({ champs: [CHAMP({ champion_players: [{ name: 'Ana' }, { name: 'Beto', weight: 0.5 }, { name: '' }, null, { name: 'Carla', weight: 3 }] })] }); e.api.openChampionEdit('c1'); return J(e.st.modal.players) === '[{"name":"Ana","weight":1},{"name":"Beto","weight":0.5},{"name":"Carla","weight":1}]'; })());
  check('campeonato em andamento, sem campeão ou que não existe não abre', (() => { const a = makeEnv({ champs: [CHAMP({ status: 'active' })] }); a.api.openChampionEdit('c1'); const b = makeEnv({ champs: [CHAMP({ champion: null })] }); b.api.openChampionEdit('c1'); const c = makeEnv(); c.api.openChampionEdit('nada'); return a.st.modal === null && b.st.modal === null && c.st.modal === null && a.calls.renders + b.calls.renders + c.calls.renders === 0; })());

  // ══ 8. A JANELA: MODO EDIÇÃO x MODO REGISTRAR ═════════════════════════════════════════════════════════════════════════════
  const e4 = makeEnv(); e4.api.openChampionEdit('c1');
  const hE = e4.api.mChamp();
  check('modo edição: o título é o lápis, o nome e a cor do time, "Editar os jogadores campeões · 10/11/2026" e o aviso de que o Ranking muda junto e o time/placar não', /✏️/.test(hE) && !/🏆/.test(hE) && /Verde/.test(hE) && /Editar os jogadores campeões · 10\/11\/2026/.test(hE) && /Os títulos de cada um no Ranking mudam junto\. O time campeão e o placar não mudam aqui\./.test(hE) && !/Registre os jogadores/.test(hE), hE.slice(0, 600));
  check('modo edição: uma linha por campeão com o nome, o 1 e o ½ (o ½ aceso na Carla) e o ✕ de cada um, que tira pelo número da linha', (hE.match(/class="player-row"/g) || []).length === 3 && /value="Ana"/.test(hE) && /onclick="removeP\(0\)"/.test(hE) && /onclick="removeP\(2\)"[^>]*aria-label="Tirar Carla da lista"/.test(hE) && /<button class="wbtn on" onclick="upP\(2,'weight',0\.5\)">½<\/button>/.test(hE) && /<button class="wbtn on" onclick="upP\(0,'weight',1\)">1<\/button>/.test(hE), hE.slice(600, 1400));
  check('modo edição: os botões são "Salvar alterações" (que chama saveChampion) e "Cancelar"; não aparece "Salvar e Concluir" nem "Fechar (salvar depois)"', /onclick="saveChampion\(\)">Salvar alterações</.test(hE) && /onclick="closeModal\(\)">Cancelar</.test(hE) && !/Salvar e Concluir|Fechar \(salvar depois\)/.test(hE) && /onclick="addP\(\)">\+ Jogador</.test(hE));
  const ereg = makeEnv(); ereg.st.modal = { type: 'champion', champion: 'verde', players: ereg.api.defPlayers() };
  const hR = ereg.api.mChamp();
  check('modo REGISTRAR (campeonato que acabou de terminar): continua como era, com a taça, "Registre os jogadores do time campeão", "Salvar e Concluir", "Fechar (salvar depois)" e nenhum ✕ nem aviso de edição', /🏆/.test(hR) && /Registre os jogadores do time campeão/.test(hR) && /Salvar e Concluir/.test(hR) && /Fechar \(salvar depois\)/.test(hR) && !/removeP|p-del|✏️|Salvar alterações|Cancelar/.test(hR) && (hR.match(/class="player-row"/g) || []).length === 5, hR.slice(0, 500));
  const efree = makeEnv({ champs: [CHAMP({ freeMode: true })] }); efree.api.openChampionEdit('c1');
  check('plano gratuito: a janela avisa que só a lista muda e que o campeonato ainda não conta no Ranking', /Campeonato do plano gratuito: a lista muda, mas ele ainda não conta no Ranking\./.test(efree.api.mChamp()) && !/mudam junto/.test(efree.api.mChamp()));
  const exss = makeEnv({ champs: [CHAMP({ champion_players: [{ name: '<img src=x onerror=alert(1)>', weight: 1 }] })] }); exss.api.openChampionEdit('c1');
  const hX = exss.api.mChamp();
  check('nome com marcação vai escapado (no campo e no nome acessível do ✕)', !hX.includes('<img src=x') && hX.includes('value="&lt;img src=x') && hX.includes('aria-label="Tirar &lt;img src=x'), hX.slice(0, 500));
  check('o "salvando" continua igual nos dois modos', /Salvando\.\.\./.test((() => { const e = makeEnv(); e.st.modal = { type: 'saving' }; return e.api.mChamp(); })()) && E0.api.mChamp() === '');

  // ══ 9. TIRAR, PÔR E MUDAR NA JANELA ═══════════════════════════════════════════════════════════════════════════════════════
  const e5 = makeEnv(); e5.api.openChampionEdit('c1');
  e5.api.removeP(1);
  check('o ✕ tira a linha pelo número e redesenha só o miolo da janela (os outros jogadores ficam)', J(e5.st.modal.players.map(p => p.name)) === '["Ana","Carla"]' && /removeP\(1\)/.test(e5.els['modal-root'].innerHTML) && !/removeP\(2\)/.test(e5.els['modal-root'].innerHTML) && /value="Carla"/.test(e5.els['modal-root'].innerHTML) && !/<input[^>]*value="Beto"/.test(e5.els['modal-root'].innerHTML), e5.st.modal.players);
  e5.api.upP(1, 'weight', 1); e5.api.addP();
  check('trocar o ½ por 1 e "+ Jogador" continuam funcionando na janela de edição (linha nova em branco, peso 1)', e5.st.modal.players[1].weight === 1 && e5.st.modal.players.length === 3 && e5.st.modal.players[2].name === '' && e5.st.modal.players[2].weight === 1);
  e5.api.removeP(9); e5.api.removeP(-1);
  check('✕ de uma linha que não existe não faz nada', e5.st.modal.players.length === 3);
  const e6 = makeEnv(); e6.st.modal = { type: 'champion', champion: 'verde', players: [{ name: 'Ana', weight: 1 }] };
  e6.api.removeP(0);
  check('fora da edição (janela de REGISTRAR) o removeP é ignorado: a lista fica', e6.st.modal.players.length === 1);
  const e7 = makeEnv(); e7.api.removeP(0);
  check('sem janela aberta o removeP não quebra', e7.st.modal === null);

  // ══ 10. SALVAR: QUEM PODE, O QUE É CONFERIDO ══════════════════════════════════════════════════════════════════════════════
  const openEdit = (o = {}) => { const e = makeEnv(o); e.api.openChampionEdit('c1'); return e; };
  const eNo = makeEnv({ admin: false }); eNo.st.modal = { type: 'champion', edit: true, champId: 'c1', champion: 'verde', players: [{ name: 'Ana', weight: 1 }], sig: 'x' };
  await eNo.api.saveChampionEdit();
  check('quem não é admin não grava nem recebe pergunta', eNo.log.tx === 0 && eNo.calls.confirms.length === 0 && /Apenas administradores/.test(eNo.calls.toasts[0][0]));
  const eNone = openEdit();
  await eNone.api.saveChampionEdit();
  check('sem nenhuma mudança: "Nenhuma mudança para salvar." e não pergunta nem grava; a janela continua aberta', eNone.calls.toasts[0][0] === 'Nenhuma mudança para salvar.' && eNone.calls.confirms.length === 0 && eNone.log.tx === 0 && eNone.st.modal.edit === true);
  const eEmpty = openEdit(); eEmpty.st.modal.players = [{ name: '' }, { name: ' ' }];
  await eEmpty.api.saveChampionEdit();
  check('lista vazia é recusada com a mensagem certa, sem gravar nem perguntar', eEmpty.calls.toasts[0][0] === 'Deixe ao menos um jogador campeão.' && eEmpty.log.tx === 0 && eEmpty.calls.confirms.length === 0);
  const eDup = openEdit(); eDup.st.modal.players.push({ name: 'ana', weight: 1 });
  await eDup.api.saveChampionEdit();
  check('jogador repetido é recusado com o nome, sem gravar', eDup.calls.toasts[0][0] === 'ana aparece duas vezes na lista.' && eDup.log.tx === 0);
  const eGone = openEdit(); eGone.st.champs[0].status = 'active'; eGone.st.modal.players.pop();
  await eGone.api.saveChampionEdit();
  check('se o campeonato deixou de estar finalizado na tela, nada é gravado ("não está finalizado")', /não está finalizado/.test(eGone.calls.toasts[0][0]) && eGone.log.tx === 0);
  const eNoDb = openEdit({ db: false }); eNoDb.st.modal.players.pop();
  await eNoDb.api.saveChampionEdit();
  check('sem conexão com o banco (app ainda abrindo) nada acontece', eNoDb.calls.toasts.length === 0 && eNoDb.calls.confirms.length === 0);
  const eNoEdit = makeEnv(); eNoEdit.st.modal = { type: 'champion', champion: 'verde', players: [{ name: 'Ana', weight: 1 }] };
  await eNoEdit.api.saveChampionEdit();
  check('a janela de REGISTRAR (sem edit) não passa por aqui', eNoEdit.log.tx === 0 && eNoEdit.calls.toasts.length === 0);

  // ══ 11. SALVAR: A GRAVAÇÃO TUDO-OU-NADA ═══════════════════════════════════════════════════════════════════════════════════
  const eS = openEdit();
  eS.api.removeP(1);                              // Beto sai (o único título dele é este)
  eS.api.upP(1, 'weight', 1);                     // Carla (registro antigo, sem champId) passa de ½ para 1
  eS.api.addP(); eS.st.modal.players[2].name = 'edu';          // entra Edu, com a grafia do cadastro
  eS.api.addP(); eS.st.modal.players[3].name = 'joao  pe'; eS.st.modal.players[3].weight = 0.5; // entra João Pé como ½
  await eS.api.saveChampionEdit();
  const wr = sets(eS.log);
  check('uma ÚNICA transação com tudo: o campeonato e os títulos de quem entrou, saiu ou mudou (Ana não é tocada)', eS.log.tx === 1 && eS.log.commits.length === 1 && J(wr.map(w => w[1]).sort()) === J(['leagues/L1/championships/c1', 'leagues/L1/player_titles/beto', 'leagues/L1/player_titles/carla', 'leagues/L1/player_titles/edu', 'leagues/L1/player_titles/joao_pe'].sort()) && !wr.some(w => /ana$/.test(w[1])) && !eS.log.reads.some(r => /ana$/.test(r)), wr.map(w => w[0] + ' ' + w[1]));
  check('as leituras são o campeonato e os documentos de quem mudou, todas ANTES de gravar (o banco de mentira recusa ler depois de gravar)', eS.log.reads[0] === 'leagues/L1/championships/c1' && eS.log.reads.length === 5 && J(eS.log.reads.slice(1).sort()) === J(['leagues/L1/player_titles/beto', 'leagues/L1/player_titles/carla', 'leagues/L1/player_titles/edu', 'leagues/L1/player_titles/joao_pe'].sort()), eS.log.reads);
  check('o campeonato recebe SÓ champion_players (a lista nova, com a grafia do cadastro e os pesos); status, time, data e times ficam como estavam', J(at(eS.log, 'leagues/L1/championships/c1')) === '["update","leagues/L1/championships/c1",{"champion_players":[{"name":"Ana","weight":1},{"name":"Carla","weight":1},{"name":"Edu","weight":1},{"name":"João Pé","weight":0.5}]}]' && eS.store.get('leagues/L1/championships/c1').status === 'completed' && eS.store.get('leagues/L1/championships/c1').champion === 'verde' && eS.store.get('leagues/L1/championships/c1').date === '2026-11-10', at(eS.log, 'leagues/L1/championships/c1'));
  check('Beto saiu: o documento de títulos dele é apagado; Carla (registro antigo) agora tem 1 título com a entrada deste campeonato; Edu e João Pé ganham o documento', !eS.store.has('leagues/L1/player_titles/beto') && J(eS.store.get('leagues/L1/player_titles/carla')) === '{"name":"Carla","titles":1,"last_date":"2026-11-10","entries":[{"date":"2026-11-10","weight":1,"team":"verde","champId":"c1"}]}' && eS.store.get('leagues/L1/player_titles/edu').titles === 1 && eS.store.get('leagues/L1/player_titles/joao_pe').titles === 0.5 && eS.store.get('leagues/L1/player_titles/joao_pe').name === 'João Pé', [...eS.store.keys()]);
  check('Ana não mudou nada (os 2 títulos continuam, com os 2 champId)', J(eS.store.get('leagues/L1/player_titles/ana')) === J(TITLES()['player_titles/ana']));
  check('enquanto grava a tela mostra "Salvando..." (a janela de edição some e volta se der erro)', eS.ctl.modalDuring === 'saving');
  check('perguntou UMA vez, com o que muda; a janela fecha, o app redesenha e avisa "Campeões atualizados!" em verde', eS.calls.confirms.length === 1 && /Entram: Edu, João Pé/.test(eS.calls.confirms[0]) && /Saem: Beto/.test(eS.calls.confirms[0]) && /Passam a título inteiro: Carla/.test(eS.calls.confirms[0]) && eS.st.modal === null && eS.calls.toasts.some(([t, k]) => t === 'Campeões atualizados!' && k === 'ok'), eS.calls.confirms);
  check('Edu e João Pé são do elenco: a pergunta não traz o aviso de "sem cadastro"', !/Sem cadastro/.test(eS.calls.confirms[0]));

  const eU = openEdit(); eU.api.addP(); eU.st.modal.players[3].name = 'Dani Avulsa';
  await eU.api.saveChampionEdit();
  check('quem não tem cadastro no elenco entra mesmo assim, mas a pergunta avisa ("⚠️ Sem cadastro no elenco: Dani Avulsa")', /⚠️ Sem cadastro no elenco: Dani Avulsa/.test(eU.calls.confirms[0]) && eU.store.has('leagues/L1/player_titles/dani_avulsa') && eU.store.get('leagues/L1/player_titles/dani_avulsa').name === 'Dani Avulsa', eU.calls.confirms[0]);

  const eNo2 = openEdit({ confirmAnswer: false }); eNo2.api.removeP(0);
  await eNo2.api.saveChampionEdit();
  check('se o admin recusa na pergunta, NADA é gravado e a janela continua aberta com o que ele fez', eNo2.log.tx === 0 && eNo2.st.modal.edit === true && eNo2.st.modal.players.length === 2 && eNo2.calls.confirms.length === 1 && !eNo2.calls.toasts.some(([t]) => /atualizados/.test(t)));

  const eW = openEdit(); eW.api.upP(0, 'weight', 0.5);
  await eW.api.saveChampionEdit();
  check('só trocar o peso de quem tem outros títulos (Ana, 1 para ½): o total dela vai de 2 para 1,5 e só o documento dela e o campeonato são gravados', eW.store.get('leagues/L1/player_titles/ana').titles === 1.5 && eW.store.get('leagues/L1/player_titles/ana').entries.length === 2 && J(sets(eW.log).map(w => w[1]).sort()) === J(['leagues/L1/championships/c1', 'leagues/L1/player_titles/ana'].sort()), sets(eW.log).map(w => w[1]));

  const eR = openEdit({ champs: [CHAMP({ champion_players: [{ name: 'joão pé', weight: 1 }] })], extra: { 'leagues/L1/championships/c1': CHAMP({ champion_players: [{ name: 'joão pé', weight: 1 }] }), 'leagues/L1/player_titles/joao_pe': { name: 'joão pé', titles: 1, last_date: '2026-11-10', entries: [{ date: '2026-11-10', weight: 1, team: 'verde', champId: 'c1' }] } } });
  eR.st.modal.players[0].name = 'João Pé';
  await eR.api.saveChampionEdit();
  check('só a grafia do nome ("joão pé" para "João Pé"): a lista e o nome no Ranking são corrigidos, e o título continua UM', eR.store.get('leagues/L1/championships/c1').champion_players[0].name === 'João Pé' && eR.store.get('leagues/L1/player_titles/joao_pe').name === 'João Pé' && eR.store.get('leagues/L1/player_titles/joao_pe').titles === 1 && /Nome corrigido: joão pé → João Pé/.test(eR.calls.confirms[0]), eR.store.get('leagues/L1/player_titles/joao_pe'));

  // plano gratuito: só a lista
  const eF = openEdit({ champs: [CHAMP({ freeMode: true })], extra: { 'leagues/L1/championships/c1': CHAMP({ freeMode: true }) } });
  eF.api.removeP(0); eF.api.addP(); eF.st.modal.players[2].name = 'Edu';
  await eF.api.saveChampionEdit();
  check('campeonato do PLANO GRATUITO: só a lista é gravada; nenhum documento de títulos é lido nem escrito (ele não conta no Ranking)', eF.log.tx === 1 && J(sets(eF.log).map(w => w[1])) === '["leagues/L1/championships/c1"]' && eF.log.reads.length === 1 && J(eF.store.get('leagues/L1/championships/c1').champion_players.map(p => p.name)) === '["Beto","Carla","Edu"]' && J(eF.store.get('leagues/L1/player_titles/ana')) === J(TITLES()['player_titles/ana']) && /plano gratuito: só a lista muda/.test(eF.calls.confirms[0]), sets(eF.log));

  // conflito: outra pessoa mexeu na lista enquanto a janela estava aberta
  const eC = openEdit(); eC.api.removeP(0);
  eC.store.set('leagues/L1/championships/c1', CHAMP({ champion_players: [{ name: 'Ana', weight: 1 }, { name: 'Beto', weight: 1 }, { name: 'Carla', weight: 0.5 }, { name: 'Gil', weight: 1 }] }));
  const before = J([...eC.store.entries()]);
  await eC.api.saveChampionEdit();
  check('se OUTRA pessoa mudou a lista enquanto a janela estava aberta: nada é gravado, o admin é avisado e a janela volta como estava', eC.log.commits.length === 0 && J([...eC.store.entries()]) === before && /foi mudada por outra pessoa/.test(eC.calls.toasts.at(-1)[0]) && eC.st.modal.edit === true && eC.st.modal.players.length === 2, eC.calls.toasts);
  const eF2 = openEdit(); eF2.api.removeP(0);
  eF2.store.set('leagues/L1/championships/c1', CHAMP({ status: 'active' }));
  await eF2.api.saveChampionEdit();
  check('se o campeonato deixou de estar finalizado no banco, nada é gravado ("não está mais finalizado")', eF2.log.commits.length === 0 && /não está mais finalizado/.test(eF2.calls.toasts.at(-1)[0]) && eF2.st.modal.edit === true);
  const eD = openEdit(); eD.api.removeP(0); eD.store.delete('leagues/L1/championships/c1');
  await eD.api.saveChampionEdit();
  check('se o campeonato foi apagado enquanto isso, nada é gravado e o erro é dito', eD.log.commits.length === 0 && /não está mais finalizado/.test(eD.calls.toasts.at(-1)[0]));

  // falha na hora de gravar: tudo ou nada
  const eX = openEdit(); eX.api.removeP(1); eX.api.addP(); eX.st.modal.players[2].name = 'Edu'; eX.ctl.failCommit = true;
  const snapshot = J([...eX.store.entries()]);
  await eX.api.saveChampionEdit();
  check('se a gravação falha (sem conexão) NADA muda no banco: nem a lista nem os títulos; a janela volta com o que o admin fez e o erro aparece', J([...eX.store.entries()]) === snapshot && eX.st.modal.edit === true && eX.st.modal.players.length === 3 && /Erro ao salvar os campeões: sem conexão/.test(eX.calls.toasts.at(-1)[0]) && !eX.calls.toasts.some(([t]) => /atualizados/.test(t)), eX.calls.toasts);
  await (async () => { eX.ctl.failCommit = false; await eX.api.saveChampionEdit(); })();
  check('depois da falha dá para tentar de novo e funciona', eX.store.get('leagues/L1/championships/c1').champion_players.some(p => p.name === 'Edu') && eX.st.modal === null);

  // registro antigo de campeão sem documento de títulos
  const eM = openEdit({ champs: [CHAMP({ champion_players: [{ name: 'Ana', weight: 1 }, { name: 'Gil', weight: 1 }] })], extra: { 'leagues/L1/championships/c1': CHAMP({ champion_players: [{ name: 'Ana', weight: 1 }, { name: 'Gil', weight: 1 }] }) } });
  eM.api.removeP(1);
  await eM.api.saveChampionEdit();
  check('tirar quem nunca teve documento de títulos (dado antigo) não dá erro: só a lista muda', eM.log.commits.length === 1 && J(eM.store.get('leagues/L1/championships/c1').champion_players) === '[{"name":"Ana","weight":1}]' && !eM.store.has('leagues/L1/player_titles/gil'), eM.calls.toasts);

  // ══ 12. O SALVAR DA JANELA ENCAMINHA PARA A EDIÇÃO ════════════════════════════════════════════════════════════════════════
  const eD1 = openEdit(); eD1.els.inputs = [{ value: 'Ana' }, { value: 'Carla' }, { value: 'Zé Novo' }];
  eD1.st.modal.players = [{ name: 'x', weight: 1 }, { name: 'y', weight: 0.5 }, { name: 'z', weight: 1 }];
  await eD1.api.saveChampion();
  check('o "Salvar alterações" (saveChampion) copia o que está nos campos (preenchimento automático não passa pelo oninput) e segue pela edição: confirma, grava numa transação e NÃO conclui o campeonato de novo', eD1.log.tx === 1 && eD1.calls.confirms.length === 1 && J(eD1.store.get('leagues/L1/championships/c1').champion_players.map(p => p.name)) === '["Ana","Carla","Zé Novo"]' && eD1.store.get('leagues/L1/championships/c1').champion === 'verde', eD1.store.get('leagues/L1/championships/c1'));
  const eD2 = makeEnv(); eD2.st.modal = { type: 'champion', champion: 'verde', players: [{ name: '', weight: 1 }] };
  await eD2.api.saveChampion();
  check('o salvar do REGISTRAR segue o caminho de sempre (sem nenhum jogador: "Adicione ao menos um jogador.") e não toca na edição', eD2.log.tx === 0 && eD2.calls.confirms.length === 0 && eD2.calls.toasts[0][0] === 'Adicione ao menos um jogador.');
  check('no código, o encaminhamento da edição vem logo depois de copiar os campos e antes de qualquer gravação do registrar', /\.forEach\(\(inp,i\) => \{\n    if \(st\.modal\.players\[i\]\) st\.modal\.players\[i\]\.name = inp\.value;\n  \}\);\n  if \(st\.modal\.edit\) return saveChampionEdit\(\);[^\n]*\n\n  const snap = JSON\.parse/.test(html));

  // ══ 13. ESTILO, REGRAS, MANUAL E CI ═══════════════════════════════════════════════════════════════════════════════════════
  check('o ✕ da lista tem estilo próprio (.p-del), com o vermelho ao passar o mouse', /^\.p-del \{ background: none; border: none; color: var\(--text3\);/m.test(html) && /^\.p-del:hover \{ color: var\(--danger\); \}/m.test(html));
  check('o campo do nome pode encolher (min-width: 0): sem isso, em celular de 320 px o ✕ da linha saía da tela', /^\.player-input \{\n  flex: 1; min-width: 0; background: var\(--s2\);/m.test(html));
  check('as regras do Firestore deixam o admin gravar player_titles e a liga gravar o campeonato (o que a edição precisa), e ninguém além do admin grava títulos', /match \/leagues\/\{leagueId\}\/player_titles\/\{docId\} \{\n\s+allow read: if isLeagueActiveUser\(leagueId\);\n\s+allow write: if isLeagueAdmin\(leagueId\);/.test(rules) && /match \/leagues\/\{leagueId\}\/championships\/\{docId\} \{\n\s+allow read: if isLeagueActiveUser\(leagueId\);\n\s+allow write: if isLeagueActiveUser\(leagueId\);/.test(rules));
  const sec = (() => { const i = manual.indexOf('id="editar-campeoes"'); return i < 0 ? '' : manual.slice(i, manual.indexOf('<h3', i + 30)); })();
  const plain = s => s.replace(/<\/(?:td|th|tr|p|li|div|h3|h2|ul|table)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const ps = plain(sec);
  check('manual: a seção 03 (Títulos e ½ Título) tem "Corrigir os campeões depois de finalizado" (id editar-campeoes), depois de "Ranking geral" e antes da "Liga sem final"', /<h3 id="editar-campeoes">Corrigir os campeões depois de finalizado<\/h3>/.test(manual) && manual.indexOf('id="editar-campeoes"') > manual.indexOf('<h3>Ranking geral</h3>') && manual.indexOf('id="editar-campeoes"') < manual.indexOf('id="liga-sem-final"') && manual.indexOf('id="editar-campeoes"') < manual.indexOf('id="sequencias"'), manual.indexOf('id="editar-campeoes"'));
  check('manual: diz que só o admin faz, o caminho (Histórico, o campeonato, ✏️ Editar campeões), as ações (trocar 1 por ½, ✕, + Jogador), a pergunta antes de gravar e o aviso de quem não tem cadastro', /Só o admin/.test(ps) && /Histórico/.test(ps) && /✏️ Editar campeões/.test(ps) && /trocar 1 por ½/.test(ps) && /✕/.test(ps) && /\+ Jogador/.test(ps) && /Salvar alterações/.test(ps) && /mostra o que vai mudar/.test(ps) && /sem cadastro no elenco/.test(ps), ps.slice(0, 700));
  check('manual: explica o que muda junto (o Ranking de títulos acertado, as conquistas recalculadas), o que NÃO muda (time campeão e placar), o plano gratuito, o conflito com outra pessoa e a transação', /O Ranking de títulos muda junto\. Quem sai perde aquele título, quem entra ganha e quem troca 1 por ½ tem o total acertado\. As conquistas e os números que dependem dos títulos são recalculados sozinhos com a lista nova\./.test(ps) && /O time campeão e o placar não mudam aqui\. O time vem do resultado da final/.test(ps) && /Plano gratuito\. O campeonato feito no plano gratuito ainda não conta no Ranking: a lista muda, o Ranking não\./.test(ps) && /Duas pessoas ao mesmo tempo\. Se outra pessoa mudar a lista enquanto a janela está aberta, nada é gravado e o app avisa para abrir de novo\./.test(ps) && /champion_players/.test(ps) && /player_titles/.test(ps) && /numa só transação/.test(ps), ps.slice(600, 1800));
  check('manual: lembra que antes não havia como editar e que o jeito de mudar o vencedor de uma final empatada continua sendo o ✎ da final', /não havia como/.test(ps) && /✎/.test(ps), ps.slice(-500));
  check('CI: o teste da edição dos campeões roda (passo "Testes do app (editar os campeões …)" executando test/client-champion-edit-test.js, sem ": " no nome)', /- name: Testes do app \(editar os campeões[^\n]*\)\n\s+working-directory: functions\n\s+run: node test\/client-champion-edit-test\.js/.test(ci) && !/name: Testes do app \(editar os campeões[^\n]*: /.test(ci));

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
  process.exit(fails ? 1 : 0);
})().catch(err => { console.error('ERRO NO TESTE', err); process.exit(1); });
