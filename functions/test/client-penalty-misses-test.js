// "Quem perdeu pênalti?" com os jogadores EMPRESTADOS (index.html + manual.html + ci.yml). Pedido do dono em 10/11/2026: na hora de indicar quem perdeu os pênaltis da final, a janela
// tem de mostrar também os emprestados. Cada lado mostra o elenco do time, os emprestados já marcados na final (gol ou "✓ Jogo") e a lista "+ Emprestado" (jogadores dos OUTROS
// times do campeonato, em ordem alfabética); quem é marcado guarda o LADO em que bateu (penaltyMissedSides) e é por esse lado que as conquistas Baggio e Salvo pelos companheiros
// e o ranking de pênaltis perdidos decidem se o time dele ganhou ou perdeu. Este teste extrai o código real do index.html e o executa num ambiente simulado, sem navegador.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const manual = read('manual.html');
const ci = read('.github', 'workflows', 'ci.yml');
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
function one(re) {
  const m = html.match(re);
  if (!m) throw new Error('trecho não encontrado no index.html: ' + re);
  return m[0];
}

const baseCode = [
  one(/^const esc = .*;$/m),
  slice('const T = {', 'function enabledColors()'),
  one(/^const activeChamp = .*;$/m),
  one(/^function ldoc\(path\) \{.*\}$/m),
  one(/^function defPlayers\(\) \{\n[\s\S]*?\n\}$/m),
].join('\n');
const penaltyCode = slice('async function setPenaltyWinner(', 'function mChampSummary()');           // setPenaltyWinner + helpers + a janela + marcar + gravar
const helperCode = slice('function penaltyMissTeam(', '// O que cada lado da janela oferece');         // só o time que o jogador defendeu
const rankingCode = slice('function computePenaltyMisses() {', '/* ── stats view');
const streakCode = slice('function goallessStreak(chron, name) {', 'function getPlayerRarestBadge(');                  // a conta de sequência sem gol, que o cálculo das conquistas usa
const badgeCode = slice('function computePlayerBadgeStats(name) {', 'function getBadgeCache()') + '\n' + slice('// Quantos jogos de um campeonato o jogador fez "emprestado"', 'function champPlayerGames(champ, name) {');

// ── o aplicativo falso ───────────────────────────────────────────────────────────────────────────
function makeEnv({ champs = [], modal = null } = {}) {
  const log = { updates: [], toasts: [], renders: 0 };
  const st = { leagueId: 'L', champs, modal, players: [], userRole: 'admin' };
  const byId = p => st.champs.find(c => c.id === p.split('/').pop());
  const DB = { doc: p => ({ update: async obj => { log.updates.push({ path: p, obj }); const c = byId(p); if (c) Object.assign(c, obj); } }) };
  const env = { st, DB, toast: m => log.toasts.push(m), render: () => { log.renders++; } };
  const names = Object.keys(env);
  const api = new Function(...names, baseCode + '\n' + penaltyCode + '\n' + rankingCode + '\nreturn { T, penaltyMissTeam, penaltyPickers, mPenaltyMisses, togglePenaltyMiss, submitPenaltyMisses, setPenaltyWinner, computePenaltyMisses };')(...names.map(n => env[n]));
  return { api, st, log };
}
function makeStats(players, champs) {
  const env = { st: { players, champs, ranks: [], finMens: {}, finCfg: {} }, getChampAwards: () => null, computeAwardStats: () => ({}), getPaid: () => false, getPaidDate: () => null, h2hFlags: () => ({}), rivalPublicStats: () => ({}), monthAwardStats: () => ({}) };
  const names = Object.keys(env);
  return new Function(...names, helperCode + '\n' + streakCode + '\n' + badgeCode + '\nreturn { computePlayerBadgeStats };')(...names.map(n => env[n]));
}

// ── os dados: final Laranja (mandante) x Verde (visitante), decidida nos pênaltis ─────────────────────
const FINAL = (o = {}) => ({ id: 'final', phase: 'final', home: 'laranja', away: 'verde', hs: 1, as: 1, played: true, goals: [], ...o });
const ROSTERS = () => ({ laranja: ['Beto', 'Carlos'], verde: ['Dudu', 'Eli'], roxo: ['Zeca', 'Ana'], amarelo: ['Bia'] });
const CH = (o = {}) => ({ id: 'c1', date: '2026-11-10', status: 'active', teams: ['laranja', 'verde', 'roxo', 'amarelo'], format: 5, matches: [FINAL(o.final)], teamRosters: ROSTERS(), ...(o.champ || {}) });
const mdl = (extra = {}) => ({ type: 'penaltyMisses', matchId: 'final', champId: null, home: 'laranja', away: 'verde', penaltyWinner: 'verde', misses: [], sides: {}, ...extra });
const MARCADOS = { goals: [{ player: 'Zeca', team: 'home' }, { player: 'Zeca', team: 'home' }, { player: 'Beto', team: 'home' }, { team: 'home' }], participants: [{ player: 'Ana', team: 'away' }], finalGoals: [{ player: 'Bia', team: 'home' }] };
const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const plain = s => dec(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// cada botão de jogador da janela: executa o onclick de verdade contra uma função de captura e devolve { player, side, label, selected, emp, inDetails }
function botoes(h) {
  const out = [];
  const re = /<button onclick="(togglePenaltyMiss\([^"]*)"([^>]*)>([\s\S]*?)<\/button>/g;
  let m, call;
  while ((m = re.exec(h))) {
    new Function('togglePenaltyMiss', dec(m[1]))((...a) => { call = a; });
    const antes = h.slice(0, m.index);
    out.push({ player: call[0], side: call[1], label: plain(m[3]), selected: /font-weight:700/.test(m[2]), emp: /emp\./.test(m[3]), inDetails: (antes.match(/<details/g) || []).length > (antes.match(/<\/details>/g) || []).length });
  }
  return out;
}
const por = (bs, side, filtro) => bs.filter(b => b.side === side && filtro(b)).map(b => b.player);

(async () => {
  const A = makeEnv().api;

  // ══ 1. O TIME QUE O JOGADOR DEFENDEU NA FINAL (penaltyMissTeam) ═══════════════════════════════════
  {
    const ch = CH();
    const antigo = FINAL({ penaltyWinner: 'verde', penaltyMissedBy: ['Beto', 'Dudu'] });
    check('registro antigo (sem o lado): vale o time do elenco (Beto = laranja, Dudu = verde)', A.penaltyMissTeam(ch, antigo, 'Beto') === 'laranja' && A.penaltyMissTeam(ch, antigo, 'Dudu') === 'verde');
    check('quem não está em nenhum elenco e não tem lado: nenhum time (null)', A.penaltyMissTeam(ch, antigo, 'Fulano') === null);
    check('campeonato sem elencos registrados e sem lado: null', A.penaltyMissTeam({ ...ch, teamRosters: undefined }, antigo, 'Beto') === null);
    const com = FINAL({ penaltyWinner: 'verde', penaltyMissedSides: [{ player: 'Zeca', side: 'away' }, { player: 'Ana', side: 'home' }, { player: 'Beto', side: 'away' }, { player: 'Eli', side: 'x' }] });
    check('o emprestado do roxo (Zeca) que bateu pelo visitante defendeu o VERDE, não o roxo', A.penaltyMissTeam(ch, com, 'Zeca') === 'verde');
    check('...e a emprestada do roxo (Ana) que bateu pelo mandante defendeu o LARANJA', A.penaltyMissTeam(ch, com, 'Ana') === 'laranja');
    check('o lado gravado vale mais que o elenco (Beto é do laranja, mas foi marcado no visitante: verde)', A.penaltyMissTeam(ch, com, 'Beto') === 'verde');
    check('lado gravado inválido ("x"): cai no elenco (Eli = verde)', A.penaltyMissTeam(ch, com, 'Eli') === 'verde');
    check('quem não está na lista de lados continua pelo elenco (Dudu = verde, Carlos = laranja)', A.penaltyMissTeam(ch, com, 'Dudu') === 'verde' && A.penaltyMissTeam(ch, com, 'Carlos') === 'laranja');
    check('final sem a lista de lados (undefined) ou com ela vazia: pelo elenco', A.penaltyMissTeam(ch, FINAL(), 'Beto') === 'laranja' && A.penaltyMissTeam(ch, FINAL({ penaltyMissedSides: [] }), 'Dudu') === 'verde');
  }

  // ══ 2. O QUE CADA LADO OFERECE (penaltyPickers) ═════════════════════════════════════════════════
  {
    const m = mdl();
    const pk = A.penaltyPickers(CH({ final: MARCADOS }), m);
    check('lado de casa (laranja): elenco Beto e Carlos; emprestados já marcados Bia e Zeca (em ordem alfabética, Zeca com 2 gols aparece UMA vez, Beto não é emprestado, gol sem jogador é ignorado); lista: só a Ana', JSON.stringify(pk.home) === JSON.stringify({ roster: ['Beto', 'Carlos'], emp: ['Bia', 'Zeca'], lend: ['Ana'] }), pk.home);
    check('lado de fora (verde): elenco Dudu e Eli; emprestada já marcada Ana (✓ Jogo); lista: Bia e Zeca (os marcados do outro lado continuam disponíveis, em ordem alfabética)', JSON.stringify(pk.away) === JSON.stringify({ roster: ['Dudu', 'Eli'], emp: ['Ana'], lend: ['Bia', 'Zeca'] }), pk.away);
    const sem = A.penaltyPickers(CH(), m);
    check('final sem nenhum emprestado marcado: ninguém em "emp." e a lista traz os jogadores dos outros times (roxo e amarelo), em ordem alfabética', sem.home.emp.length === 0 && sem.away.emp.length === 0 && sem.home.lend.join() === 'Ana,Bia,Zeca' && sem.away.lend.join() === 'Ana,Bia,Zeca', sem);
    check('os times da própria final nunca entram na lista de emprestados (Dudu e Eli não aparecem para o laranja; Beto e Carlos não aparecem para o verde)', !sem.home.lend.some(n => ['Dudu', 'Eli', 'Beto', 'Carlos'].includes(n)) && !sem.away.lend.some(n => ['Dudu', 'Eli', 'Beto', 'Carlos'].includes(n)), sem);
    const rep = A.penaltyPickers(CH({ champ: { teamRosters: { laranja: ['Beto'], verde: ['Dudu'], roxo: ['Beto', 'Zeca'] } } }), m);
    check('nome repetido em outro elenco: some da lista do próprio time e do adversário (Beto só aparece como elenco do laranja)', rep.home.lend.join() === 'Zeca' && rep.away.lend.join() === 'Zeca', rep);
    const dup = A.penaltyPickers(CH({ champ: { teamRosters: { laranja: ['Beto'], verde: ['Dudu'], roxo: ['Zeca'], amarelo: ['Zeca', 'Bia'] } } }), m);
    check('o mesmo nome em dois elencos de outros times aparece UMA vez na lista "+ Emprestado" (Bia, Zeca)', dup.home.lend.join() === 'Bia,Zeca' && dup.away.lend.join() === 'Bia,Zeca', dup);
    const acento = A.penaltyPickers(CH({ champ: { teamRosters: { laranja: ['Beto'], verde: ['Dudu'], roxo: ['Zé', 'Álvaro', 'Beatriz', 'ana'] } } }), m);
    check('a ordem é a do português (acento e maiúscula não contam): Álvaro, ana, Beatriz, Zé', acento.home.lend.join() === 'Álvaro,ana,Beatriz,Zé', acento.home.lend);
    const nada = A.penaltyPickers(undefined, m);
    check('campeonato que não existe: tudo vazio e sem erro', JSON.stringify(nada) === JSON.stringify({ home: { roster: [], emp: [], lend: [] }, away: { roster: [], emp: [], lend: [] } }), nada);
    const semElenco = A.penaltyPickers(CH({ champ: { teamRosters: undefined }, final: MARCADOS }), m);
    check('campeonato sem elencos registrados: sem elenco e sem lista; os emprestados marcados na final ainda aparecem', semElenco.home.roster.length === 0 && semElenco.home.lend.length === 0 && semElenco.home.emp.join() === 'Beto,Bia,Zeca' && semElenco.away.emp.join() === 'Ana', semElenco);
    const outraPartida = A.penaltyPickers(CH({ final: MARCADOS }), mdl({ matchId: 'nao-existe' }));
    check('partida que não está no campeonato: nenhum emprestado marcado, a lista continua', outraPartida.home.emp.length === 0 && outraPartida.home.lend.join() === 'Ana,Bia,Zeca', outraPartida);
    const soDoLado = A.penaltyPickers(CH({ final: { goals: [{ player: 'Zeca', team: 'away' }] } }), m);
    check('o emprestado marcado para o visitante não vira "emp." do mandante', soDoLado.home.emp.length === 0 && soDoLado.away.emp.join() === 'Zeca', soDoLado);
  }

  // ══ 3. A JANELA (mPenaltyMisses) ═════════════════════════════════════════════════════════════════
  {
    const E = makeEnv({ champs: [CH({ final: MARCADOS })], modal: mdl() });
    const h = E.api.mPenaltyMisses();
    const bs = botoes(h);
    check('lado de casa: elenco (Beto, Carlos), depois os emprestados já marcados (Bia, Zeca) e, na lista "+ Emprestado", Ana', por(bs, 'home', () => true).join() === 'Beto,Carlos,Bia,Zeca,Ana' && por(bs, 'home', b => b.emp).join() === 'Bia,Zeca' && por(bs, 'home', b => b.inDetails).join() === 'Ana', bs);
    check('lado de fora: elenco (Dudu, Eli), emprestada já marcada (Ana) e, na lista, Bia e Zeca', por(bs, 'away', () => true).join() === 'Dudu,Eli,Ana,Bia,Zeca' && por(bs, 'away', b => b.inDetails).join() === 'Bia,Zeca', bs);
    check('a tag "emp." vai só nos emprestados já marcados na final (Bia, Zeca do mandante; Ana do visitante): o elenco e a lista "+ Emprestado" (cujo título já diz isso) ficam sem a tag', por(bs, 'home', b => !b.emp).join() === 'Beto,Carlos,Ana' && por(bs, 'away', b => b.emp).join() === 'Ana' && por(bs, 'away', b => !b.emp).join() === 'Dudu,Eli,Bia,Zeca' && bs.filter(b => b.emp).every(b => /emp\.$/.test(b.label)) && bs.filter(b => !b.emp).every(b => !/emp\./.test(b.label)), bs.map(b => b.label));
    check('cada lado tem a sua lista "+ Emprestado" (duas) e o aviso de "nenhum elenco" não aparece', (h.match(/<details/g) || []).length === 2 && (h.match(/\+ Emprestado/g) || []).length === 2 && !h.includes('Nenhum elenco registrado'));
    check('nada vem marcado de saída e o botão diz "Pular" (passo opcional)', bs.every(b => !b.selected) && h.includes('>Pular<') && !h.includes('>Confirmar<'));
    check('o título da janela e o texto de passo opcional continuam', h.includes('Quem perdeu pênalti?') && h.includes('Opcional'));
  }
  {
    // marcado pela lista: passa a aparecer entre os emprestados já marcados, marcado, e some das duas listas
    const E = makeEnv({ champs: [CH()], modal: mdl({ misses: ['Zeca'], sides: { Zeca: 'home' } }) });
    const h = E.api.mPenaltyMisses();
    const bs = botoes(h);
    const z = bs.filter(b => b.player === 'Zeca');
    check('o Zeca, marcado pela lista do mandante, aparece UMA vez, como emprestado marcado do lado de casa, fora de qualquer lista', z.length === 1 && z[0].side === 'home' && z[0].selected && z[0].emp && !z[0].inDetails, z);
    check('as listas "+ Emprestado" ficam sem o Zeca (Ana e Bia nas duas)', por(bs, 'home', b => b.inDetails).join() === 'Ana,Bia' && por(bs, 'away', b => b.inDetails).join() === 'Ana,Bia', bs);
    check('o botão passa a dizer "Confirmar"', h.includes('>Confirmar<') && !h.includes('>Pular<'));
    // todos da lista marcados: a lista some
    const E2 = makeEnv({ champs: [CH({ champ: { teamRosters: { laranja: ['Beto'], verde: ['Dudu'], roxo: ['Zeca'] } } })], modal: mdl({ misses: ['Zeca'], sides: { Zeca: 'away' } }) });
    const h2 = E2.api.mPenaltyMisses();
    check('quando o último da lista é marcado, a lista "+ Emprestado" dos dois lados some', !h2.includes('<details') && botoes(h2).filter(b => b.player === 'Zeca').length === 1 && botoes(h2).find(b => b.player === 'Zeca').side === 'away');
  }
  {
    // um dos times sem elenco registrado, mas com jogadores de outros times: o lado aparece com a lista "+ Emprestado"
    const E = makeEnv({ champs: [CH({ champ: { teamRosters: { verde: ['Dudu'], roxo: ['Zeca'] } } })], modal: mdl() });
    const h = E.api.mPenaltyMisses();
    const bs = botoes(h);
    check('time sem elenco registrado (laranja), mas com jogadores de outros times: o lado aparece só com a lista "+ Emprestado" (Zeca)', por(bs, 'home', () => true).join() === 'Zeca' && por(bs, 'home', b => b.inDetails).join() === 'Zeca' && por(bs, 'away', () => true).join() === 'Dudu,Zeca' && !h.includes('Nenhum elenco registrado') && h.includes('>Laranja<'), bs);
  }
  {
    // emprestado já marcado na final (Bia, do amarelo, fez gol pelo mandante) e escolhido na janela: aparece UMA vez, marcado
    const E = makeEnv({ champs: [CH({ final: MARCADOS })], modal: mdl({ misses: ['Bia'], sides: { Bia: 'home' } }) });
    const b = botoes(E.api.mPenaltyMisses()).filter(x => x.player === 'Bia' && x.side === 'home');
    check('emprestado já marcado na final e escolhido na janela (Bia): aparece UMA vez no mandante, em destaque e com a tag emp.', b.length === 1 && b[0].selected && b[0].emp, b);
  }
  {
    // marcado do elenco
    const E = makeEnv({ champs: [CH()], modal: mdl({ misses: ['Dudu'], sides: { Dudu: 'away' } }) });
    const bs = botoes(E.api.mPenaltyMisses());
    check('jogador do elenco marcado fica em destaque; os outros não', bs.filter(b => b.selected).map(b => b.player).join() === 'Dudu' && bs.length > 3);
    // o mesmo nome marcado num lado não aparece marcado no outro
    const E3 = makeEnv({ champs: [CH({ champ: { teamRosters: { laranja: ['Beto'], verde: ['Dudu'], roxo: ['Zeca'] } } })], modal: mdl({ misses: ['Beto'], sides: { Beto: 'away' } }) });
    const b3 = botoes(E3.api.mPenaltyMisses());
    check('marca com o lado diferente do elenco (Beto gravado no visitante) não acende o botão do elenco dele', b3.filter(b => b.player === 'Beto' && b.side === 'home').every(b => !b.selected), b3);
  }
  {
    // nomes com aspas, apóstrofo e sinais: o botão chama a função com o nome certo e nada vira HTML
    const feio = ["D'Ávila", 'Zé "Bola"', 'Ana <b>x</b> & Cia', 'Beto\\Jr'];
    const E = makeEnv({ champs: [CH({ champ: { teamRosters: { laranja: feio, verde: ['Dudu'] } } })], modal: mdl() });
    const h = E.api.mPenaltyMisses();
    const bs = botoes(h);
    check('nomes com apóstrofo, aspas, sinais e barra invertida: cada botão chama togglePenaltyMiss com o nome exato e o lado certo', JSON.stringify(por(bs, 'home', () => true)) === JSON.stringify(feio), bs);
    check('...o texto do botão mostra o nome inteiro e nada do nome vira etiqueta HTML', bs.filter(b => b.side === 'home').every((b, i) => b.label === feio[i]) && !h.includes('<b>x</b>'), bs.map(b => b.label));
  }
  {
    // sem elenco registrado
    const E = makeEnv({ champs: [CH({ champ: { teamRosters: undefined } })], modal: mdl() });
    const h = E.api.mPenaltyMisses();
    check('campeonato sem elenco registrado: a janela diz "Nenhum elenco registrado" e não mostra botão de jogador nem lista', h.includes('Nenhum elenco registrado') && botoes(h).length === 0 && !h.includes('<details'));
    check('...e mesmo assim dá para pular (botão "Pular")', h.includes('>Pular<'));
    check('...e nenhum time aparece sem ninguém para escolher (nada de título "Laranja" ou "Verde" vazio)', !h.includes('>Laranja<') && !h.includes('>Verde<'), h.slice(0, 700));
    const um = makeEnv({ champs: [CH({ champ: { teamRosters: { laranja: ['Beto'] } } })], modal: mdl() }).api.mPenaltyMisses();
    check('só um dos dois times tem elenco: o aviso "Nenhum elenco registrado" não aparece e só o time com elenco é desenhado', !um.includes('Nenhum elenco registrado') && botoes(um).length === 1 && um.includes('>Laranja<') && !um.includes('>Verde<'), um.slice(0, 700));
    check('outra janela aberta: nada desenhado', makeEnv({ champs: [CH()], modal: { type: 'champion' } }).api.mPenaltyMisses() === '' && makeEnv({ champs: [CH()], modal: null }).api.mPenaltyMisses() === '');
  }
  {
    // campeonato do histórico: usa os elencos DELE, não os do ativo
    const hist = CH({ champ: { id: 'c2', status: 'completed', teamRosters: { laranja: ['Hugo'], verde: ['Igor'], roxo: ['Jonas'] } } });
    const E = makeEnv({ champs: [CH(), hist], modal: mdl({ champId: 'c2' }) });
    const bs = botoes(E.api.mPenaltyMisses());
    check('janela de um campeonato do histórico (champId): elenco e lista vêm DESSE campeonato (Hugo, Igor, Jonas)', por(bs, 'home', () => true).join() === 'Hugo,Jonas' && por(bs, 'away', () => true).join() === 'Igor,Jonas', bs);
  }

  // ══ 4. MARCAR E GRAVAR ═════════════════════════════════════════════════════════════════════════════
  {
    const E = makeEnv({ champs: [CH({ final: { ...MARCADOS, penaltyWinner: 'verde' } })], modal: mdl() });
    E.api.togglePenaltyMiss('Beto', 'home');
    check('tocar em um jogador marca o nome e o lado e redesenha', E.st.modal.misses.join() === 'Beto' && E.st.modal.sides.Beto === 'home' && E.log.renders === 1, E.st.modal);
    E.api.togglePenaltyMiss('Zeca', 'away');
    check('marcar outro: os dois ficam, cada um com o seu lado', E.st.modal.misses.join() === 'Beto,Zeca' && E.st.modal.sides.Zeca === 'away' && E.st.modal.sides.Beto === 'home');
    check('o resto da janela (time vencedor, partida) continua', E.st.modal.type === 'penaltyMisses' && E.st.modal.penaltyWinner === 'verde' && E.st.modal.matchId === 'final');
    E.api.togglePenaltyMiss('Beto', 'home');
    check('tocar de novo desmarca (tira o nome e o lado)', E.st.modal.misses.join() === 'Zeca' && !('Beto' in E.st.modal.sides) && E.st.modal.sides.Zeca === 'away');
    E.api.togglePenaltyMiss('Beto', 'home');
    E.api.togglePenaltyMiss('Ana', 'home');
    await E.api.submitPenaltyMisses();
    const u = E.log.updates[0].obj.matches.find(m => m.id === 'final');
    check('confirmar grava quem errou (a lista de sempre) e o LADO de cada um, na ordem em que foram marcados', JSON.stringify(u.penaltyMissedBy) === '["Zeca","Beto","Ana"]' && JSON.stringify(u.penaltyMissedSides) === '[{"player":"Zeca","side":"away"},{"player":"Beto","side":"home"},{"player":"Ana","side":"home"}]', { by: u.penaltyMissedBy, sides: u.penaltyMissedSides });
    check('...sem mexer no resto da final (placar, vencedor nos pênaltis, gols, participantes) e só no campo das partidas', u.hs === 1 && u.as === 1 && u.penaltyWinner === 'verde' && u.goals.length === 4 && u.participants.length === 1 && Object.keys(E.log.updates[0].obj).join() === 'matches' && E.log.updates[0].path === 'leagues/L/championships/c1');
    check('campeonato ativo: depois de gravar segue para a janela do campeão (o time que venceu nos pênaltis)', E.st.modal.type === 'champion' && E.st.modal.champion === 'verde', E.st.modal);
  }
  {
    // sem ninguém marcado: não grava nada e segue
    const E = makeEnv({ champs: [CH()], modal: mdl() });
    await E.api.submitPenaltyMisses();
    check('"Pular" (ninguém marcado): não grava nada e segue para a janela do campeão', E.log.updates.length === 0 && E.st.modal.type === 'champion' && E.st.modal.champion === 'verde');
    // janela sem o lado de um dos marcados (nunca grava um lado vazio)
    const L = makeEnv({ champs: [CH()], modal: mdl({ misses: ['Beto', 'Dudu'], sides: { Beto: 'home' } }) });
    await L.api.submitPenaltyMisses();
    const ul = L.log.updates[0].obj.matches.find(m => m.id === 'final');
    check('janela sem o lado de um dos marcados: grava os dois nomes e só o lado de quem tem (nunca um lado vazio)', ul.penaltyMissedBy.join() === 'Beto,Dudu' && JSON.stringify(ul.penaltyMissedSides) === '[{"player":"Beto","side":"home"}]', ul);
    // histórico: grava e fecha
    const hist = CH({ champ: { id: 'c2', status: 'completed' }, final: { penaltyWinner: 'verde' } });
    const H = makeEnv({ champs: [CH(), hist], modal: mdl({ champId: 'c2' }) });
    H.api.togglePenaltyMiss('Zeca', 'away');
    await H.api.submitPenaltyMisses();
    const uh = H.log.updates[0].obj.matches.find(m => m.id === 'final');
    check('campeonato do histórico: grava no campeonato certo (c2) e fecha a janela', H.log.updates[0].path === 'leagues/L/championships/c2' && uh.penaltyMissedBy.join() === 'Zeca' && uh.penaltyMissedSides[0].side === 'away' && H.st.modal === null, { path: H.log.updates[0].path, modal: H.st.modal });
    // outra janela: ignora
    const O = makeEnv({ champs: [CH()], modal: { type: 'champion' } });
    O.api.togglePenaltyMiss('Beto', 'home');
    await O.api.submitPenaltyMisses();
    check('com outra janela aberta, tocar em jogador e confirmar não fazem nada', O.log.renders === 0 && O.log.updates.length === 0 && O.st.modal.type === 'champion');
  }
  {
    // o passo anterior: o vencedor nos pênaltis abre a janela já com o lado vazio
    const E = makeEnv({ champs: [CH()], modal: { type: 'penaltyWinner', matchId: 'final', home: 'laranja', away: 'verde' } });
    await E.api.setPenaltyWinner('verde');
    check('escolher o vencedor nos pênaltis abre "Quem perdeu pênalti?" sem ninguém marcado e sem lados (misses [] e sides {})', E.st.modal.type === 'penaltyMisses' && E.st.modal.matchId === 'final' && E.st.modal.champId === null && E.st.modal.penaltyWinner === 'verde' && JSON.stringify(E.st.modal.misses) === '[]' && JSON.stringify(E.st.modal.sides) === '{}' && E.st.modal.home === 'laranja' && E.st.modal.away === 'verde', E.st.modal);
    check('...e grava o vencedor nos pênaltis na final', E.log.updates[0].obj.matches.find(m => m.id === 'final').penaltyWinner === 'verde');
  }

  // ══ 5. O RANKING E AS CONQUISTAS USAM O TIME QUE ELE DEFENDEU ═══════════════════════════════════════
  {
    const fin = { penaltyWinner: 'verde', penaltyMissedBy: ['Zeca', 'Beto', 'Dudu', 'Ana'], penaltyMissedSides: [{ player: 'Zeca', side: 'away' }, { player: 'Beto', side: 'home' }, { player: 'Dudu', side: 'away' }, { player: 'Ana', side: 'home' }] };
    const ch = CH({ champ: { status: 'completed', date: '2026-10-14' }, final: fin });
    const E = makeEnv({ champs: [ch] });
    const r = Object.fromEntries(E.api.computePenaltyMisses().map(x => [x.name, x]));
    check('ranking: o emprestado do roxo (Zeca) que bateu pelo VERDE, campeão nos pênaltis, conta como "salvo" (won), não como derrota', r.Zeca.total === 1 && r.Zeca.won === 1 && r.Zeca.lost === 0, r.Zeca);
    check('ranking: a emprestada do roxo (Ana) que bateu pelo LARANJA (perdeu nos pênaltis) conta como derrota', r.Ana.lost === 1 && r.Ana.won === 0, r.Ana);
    check('ranking: o do elenco do laranja (Beto) é derrota e o do elenco do verde (Dudu) é "salvo"', r.Beto.lost === 1 && r.Dudu.won === 1 && r.Beto.won === 0 && r.Dudu.lost === 0, r);
    const antigo = { ...fin, penaltyMissedSides: undefined };
    const Ea = makeEnv({ champs: [CH({ champ: { status: 'completed', date: '2026-10-14' }, final: antigo })] });
    const ra = Object.fromEntries(Ea.api.computePenaltyMisses().map(x => [x.name, x]));
    check('registro ANTIGO (sem lados): continua pelo elenco, como sempre (Zeca, do roxo, conta como derrota; Dudu, do verde, como "salvo")', ra.Zeca.lost === 1 && ra.Zeca.won === 0 && ra.Dudu.won === 1 && ra.Beto.lost === 1, ra);
    check('o total por jogador não muda com os lados (4 jogadores, 1 cada)', E.api.computePenaltyMisses().length === 4 && E.api.computePenaltyMisses().every(x => x.total === 1));
    // as conquistas (cálculo real de todos os jogadores)
    const players = ['Zeca', 'Beto', 'Dudu', 'Ana'].map(name => ({ name }));
    const S = makeStats(players, [ch]);
    const z = S.computePlayerBadgeStats('Zeca'), b = S.computePlayerBadgeStats('Beto'), d = S.computePlayerBadgeStats('Dudu'), a = S.computePlayerBadgeStats('Ana');
    check('conquistas: Zeca (emprestado do roxo que bateu pelo verde campeão) ganha "Salvo pelos companheiros" e NÃO o Baggio', z.hasSalvoCompanheiros === 1 && z.hasBaggio === 0, { s: z.hasSalvoCompanheiros, b: z.hasBaggio });
    check('conquistas: Ana (emprestada do roxo que bateu pelo laranja vice) ganha o Baggio; Beto (laranja) também; Dudu (verde campeão) ganha "Salvo"', a.hasBaggio === 1 && a.hasSalvoCompanheiros === 0 && b.hasBaggio === 1 && b.hasSalvoCompanheiros === 0 && d.hasSalvoCompanheiros === 1 && d.hasBaggio === 0, { a: [a.hasBaggio, a.hasSalvoCompanheiros], b: [b.hasBaggio, b.hasSalvoCompanheiros], d: [d.hasBaggio, d.hasSalvoCompanheiros] });
    const Sa = makeStats(players, [CH({ champ: { status: 'completed', date: '2026-10-14' }, final: antigo })]);
    check('conquistas, registro antigo (sem lados): pelo elenco (Zeca, do roxo, que não ganhou os pênaltis, fica com o Baggio)', Sa.computePlayerBadgeStats('Zeca').hasBaggio === 1 && Sa.computePlayerBadgeStats('Zeca').hasSalvoCompanheiros === 0);
    const Sn = makeStats(players, [CH({ champ: { status: 'completed', date: '2026-10-14', teamRosters: { laranja: ['Beto'], verde: ['Dudu'] } }, final: { penaltyWinner: 'verde', penaltyMissedBy: ['Fulano'] } })]);
    check('quem errou e não está em elenco nem tem lado (dado estranho) não ganha nenhuma das duas', Sn.computePlayerBadgeStats('Fulano').hasBaggio === 0 && Sn.computePlayerBadgeStats('Fulano').hasSalvoCompanheiros === 0);
  }

  // ══ 6. O RESTO DO APP, O MANUAL E O CI ═══════════════════════════════════════════════════════════════
  {
    check('a aba EU (Recordes Pessoais) usa o mesmo cálculo do time que ele defendeu (penaltyMissTeam) e não mais o elenco direto', html.includes('const pTeam = penaltyMissTeam(champ, fin, myName);'));
    const aba = html.slice(html.indexOf('let hasBaggio = 0, hasSalvoCompanheiros = 0;'), html.indexOf('const _isSomenteChurrasco'));
    check('...e essa conta continua: sem time, pula; time igual ao vencedor dos pênaltis = "salvo", senão Baggio', aba.includes('if (!pTeam) continue;') && aba.includes('if (pTeam === fin.penaltyWinner) hasSalvoCompanheiros++;') && aba.includes('else hasBaggio++;'), aba);
    const sec = manual.slice(manual.indexOf('<h3>Pênaltis na final'), manual.indexOf('<h3>Estatísticas de pênaltis perdidos em final</h3>'));
    check('manual: o passo "Quem perdeu pênalti?" explica o elenco, os emprestados já marcados (tag emp.), a lista + Emprestado em ordem alfabética e que dá para desmarcar', sec.includes('Quem perdeu pênalti?') && sec.includes('<strong>emprestados</strong> que já foram marcados na final') && sec.includes('<em>emp.</em>') && sec.includes('<strong>+ Emprestado</strong>') && sec.includes('ordem alfabética') && sec.includes('é só tocar de novo'), sec);
    check('manual: para o emprestado vale o time que ele defendeu na final, não o do elenco', sec.includes('Para um jogador <strong>emprestado</strong>, vale o time que ele <strong>defendeu na final</strong>') && sec.includes('não o time do elenco dele'));
    check('manual: continua dizendo que o passo é opcional', sec.includes('Este passo é opcional'));
    check('CI: o teste está nos passos do job test', /node test\/client-penalty-misses-test\.js/.test(ci));
  }

  console.log(fails ? `\n${fails} verificação(ões) FALHARAM` : '\nTodas as verificações passaram');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERRO no teste:', e && e.stack || e); process.exit(1); });
