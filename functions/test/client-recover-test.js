// Recuperar os campeonatos do plano gratuito (index.html): o aviso e o botão no Histórico (só para o admin), a marca em cada
// campeonato que ainda não conta, o que a tela de assinatura diz que volta a contar, e os textos que antes diziam "nem depois, se
// a liga assinar". Extrai o código real e o roda num ambiente simulado, sem navegador.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

const code = [
  slice('function isLeagueFree() {', '// Campeonatos feitos no plano gratuito'),
  slice('// Campeonatos feitos no plano gratuito', 'function isBadgeImpossible'),
  slice('async function recoverFreeChamps() {', 'async function signOutUser()'),
  slice('function vHistory() {', '/* ── modals'),
  slice('// Valores mostrados na tela de assinatura', 'async function startSubscription(plan) {'),
].join('\n');

const DAY = 86400000;
const iso = d => new Date(Date.now() + d * DAY).toISOString();
const ch = (id, extra = {}) => ({ id, date: '2026-09-' + id.slice(1).padStart(2, '0'), status: 'completed', champion: 'azul', teams: ['azul', 'verde'], format: 2, ...extra });

function make({ role = 'admin', league = { trialEndsAt: iso(-20), subscriptionActiveUntil: iso(30) }, champs = [], recovering = false, callImpl, histId = null } = {}) {
  const calls = { callFn: [], toasts: [], renders: 0, subs: 0 };
  const st = { ready: true, userRole: role, leagueId: 'L', availableLeagues: [{ id: 'L', ...league }], champs, histId, _recovering: recovering, modal: null };
  const env = {
    st, T: { azul: { l: 'Azul', c: '#4DB8FF' }, verde: { l: 'Verde', c: '#00d67f' } }, tl: t => t, fdt: d => d.split('-').reverse().join('/'),
    renderChamp: () => '', isAdmin: () => st.userRole === 'admin', addMonthsISO: d => d,
    callFn: async (n, d) => { calls.callFn.push([n, d]); if (callImpl) return callImpl(n, d); return { ok: true, recovered: 2, remaining: 0 }; },
    toast: (m, t = 'err') => calls.toasts.push([m, t]),
    render: () => { calls.renders++; calls.last = st._recovering; },
    openSubscription: () => { calls.subs++; },
  };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { freeChamps, recoverFreeChamps, vHistory, mSubscription, isLeagueFree };')(...names.map(n => env[n]));
  return { api, st, calls };
}
const txt = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  // ── quais campeonatos são "do plano gratuito" ─────────────────────────────────────────────────
  let e = make({ champs: [ch('c1', { freeMode: true }), ch('c2'), ch('c3', { freeMode: true, status: 'active' }), ch('c4', { freeMode: false, recoveredFromFree: true })] });
  check('freeChamps: só os que ainda estão como plano gratuito (qualquer situação), nunca os já recuperados nem os normais', e.api.freeChamps().map(c => c.id).join() === 'c1,c3');
  check('…sem lista de campeonatos (ainda carregando) devolve vazio, sem erro', make({ champs: undefined }).api.freeChamps().length === 0 && make({ champs: null }).api.freeChamps().length === 0);

  // ── o botão Recuperar ─────────────────────────────────────────────────────────────────────────
  e = make();
  await e.api.recoverFreeChamps();
  check('toque: chama a função do servidor com a liga, mostra "Recuperando…" durante e libera depois, e avisa quantos voltaram', JSON.stringify(e.calls.callFn) === JSON.stringify([['recoverFreeChampionships', { liga: 'L' }]]) && e.calls.renders === 2 && e.st._recovering === false && /2 campeonatos recuperados: agora contam para títulos, ranking e conquistas/.test(e.calls.toasts[0][0]) && e.calls.toasts[0][1] === 'ok', { calls: e.calls });
  e = make({ callImpl: async () => ({ ok: true, recovered: 1, remaining: 0 }) });
  await e.api.recoverFreeChamps();
  check('um campeonato só: singular ("1 campeonato recuperado")', /^✅ 1 campeonato recuperado:/.test(e.calls.toasts[0][0]));
  e = make({ callImpl: async () => ({ ok: true, recovered: 5, remaining: 3 }) });
  await e.api.recoverFreeChamps();
  check('faltou tempo (sobraram 3): diz quantos foram, quantos faltam e que é para tocar de novo', /5 recuperados; faltam 3\. Toque de novo para continuar\./.test(e.calls.toasts[0][0]) && e.calls.toasts[0][1] === 'ok', e.calls.toasts);
  e = make({ callImpl: async () => ({ ok: true, recovered: 0, remaining: 0 }) });
  await e.api.recoverFreeChamps();
  check('nada para recuperar (já estava tudo contando): avisa assim', /Nada a recuperar/.test(e.calls.toasts[0][0]) && e.calls.toasts[0][1] === 'ok');
  e = make({ callImpl: async () => { throw new Error('Assine um plano para recuperar os campeonatos feitos no plano gratuito.'); } });
  await e.api.recoverFreeChamps();
  check('erro do servidor: mostra a mensagem, em vermelho, e destrava o botão', e.calls.toasts[0][0].startsWith('Assine um plano') && e.calls.toasts[0][1] === 'err' && e.st._recovering === false && e.calls.renders === 2);
  e = make({ callImpl: async () => { throw {}; } });
  await e.api.recoverFreeChamps();
  check('erro sem mensagem: texto padrão em português', /Não foi possível recuperar agora/.test(e.calls.toasts[0][0]) && e.st._recovering === false);
  e = make({ role: 'player' });
  await e.api.recoverFreeChamps();
  check('quem não é admin: não chama o servidor nem redesenha', e.calls.callFn.length === 0 && e.calls.renders === 0 && e.calls.toasts.length === 0);
  e = make({ recovering: true });
  await e.api.recoverFreeChamps();
  check('segundo toque enquanto recupera (duplo clique): ignorado', e.calls.callFn.length === 0 && e.calls.renders === 0);

  // ── Histórico ─────────────────────────────────────────────────────────────────────────────────
  const livre = { trialEndsAt: iso(-20) }, comPlano = { trialEndsAt: iso(-20), subscriptionActiveUntil: iso(30) };
  const lista = [ch('c1', { freeMode: true }), ch('c2'), ch('c3', { freeMode: true })];
  let h = make({ league: comPlano, champs: lista }).api.vHistory();
  check('admin, liga COM plano e 2 campeonatos do plano gratuito: avisa que ainda não contam, que dá para recuperar agora, que os gols não voltam, e tem o botão Recuperar', /🔓 2 campeonatos feitos no plano gratuito ainda não contam para títulos, ranking e conquistas\. Como a liga tem plano, dá para recuperar agora \(os gols desses jogos não foram registrados e não voltam\)\./.test(txt(h)) && /onclick="recoverFreeChamps\(\)"/.test(h) && />Recuperar<\/button>/.test(h) && !/Ver planos/.test(h), txt(h).slice(0, 300));
  h = make({ league: comPlano, champs: [ch('c1', { freeMode: true }), ch('c2')] }).api.vHistory();
  check('…um campeonato só: singular ("1 campeonato feito… ainda não conta")', /🔓 1 campeonato feito no plano gratuito ainda não conta para títulos/.test(txt(h)));
  h = make({ league: comPlano, champs: lista, recovering: true }).api.vHistory();
  check('…enquanto recupera: botão desabilitado, "Recuperando…"', /<button disabled onclick="recoverFreeChamps\(\)"[^>]*>Recuperando…<\/button>/.test(h));
  h = make({ league: livre, champs: lista }).api.vHistory();
  check('admin, liga SEM plano: o aviso diz que os campeonatos voltam a contar quando a liga assinar e leva a "Ver planos" (sem botão de recuperar)', /🔒 2 campeonatos feitos no plano gratuito\. Quando a liga assinar, eles voltam a contar para títulos, ranking e conquistas\./.test(txt(h)) && /onclick="openSubscription\(\)"[^>]*>Ver planos<\/button>/.test(h) && !/recoverFreeChamps/.test(h), txt(h).slice(0, 300));
  h = make({ league: livre, champs: [ch('c1', { freeMode: true }), ch('c2')] }).api.vHistory();
  check('…um campeonato só: "Quando a liga assinar, ele volta a contar"', /🔒 1 campeonato feito no plano gratuito\. Quando a liga assinar, ele volta a contar/.test(txt(h)));
  for (const [rot, lg] of [['com plano', comPlano], ['sem plano', livre]]) {
    h = make({ role: 'player', league: lg, champs: lista }).api.vHistory();
    check(`jogador comum (${rot}): NÃO vê aviso nem botão (só o admin decide), mas a marca em cada campeonato continua`, !/🔓|🔒|Recuperar|Ver planos/.test(h) && (h.match(/plano gratuito · ainda não conta para títulos/g) || []).length === 2);
  }
  h = make({ league: comPlano, champs: [ch('c1'), ch('c2', { freeMode: false, recoveredFromFree: true })] }).api.vHistory();
  check('nenhum campeonato do plano gratuito (ou todos já recuperados): sem aviso e sem marca', !/🔓|🔒|Recuperar|plano gratuito/.test(h));
  h = make({ league: comPlano, champs: lista }).api.vHistory();
  check('a marca aparece só nos campeonatos que não contam (2 de 3) e cada linha continua levando ao campeonato', (h.match(/plano gratuito · ainda não conta para títulos/g) || []).length === 2 && (h.match(/class="hist-row"/g) || []).length === 3 && /st\.histId='c1'/.test(h));
  h = make({ league: comPlano, champs: [ch('c1', { freeMode: true, status: 'active' })] }).api.vHistory();
  check('só campeonato em andamento do plano gratuito (nenhum concluído): o Histórico continua "Sem histórico" (o aviso fica para quando houver lista)', /Sem histórico/.test(h) && !/🔓/.test(h));
  h = make({ league: comPlano, champs: lista, histId: 'c2' }).api.vHistory();
  check('com um campeonato aberto no Histórico, o aviso não aparece em cima do detalhe', !/🔓|🔒/.test(h));

  // ── tela de assinatura ────────────────────────────────────────────────────────────────────────
  let m = make({ league: livre, champs: lista }); m.st.modal = { type: 'subscription' };
  let t = txt(m.api.mSubscription());
  check('assinatura, plano gratuito, 2 campeonatos: "Ao assinar, os 2 campeonatos feitos no plano gratuito voltam a contar para títulos, ranking e conquistas"', /🔓 Ao assinar, os 2 campeonatos feitos no plano gratuito voltam a contar para títulos, ranking e conquistas\./.test(t), t);
  m = make({ league: livre, champs: [ch('c1', { freeMode: true })] }); m.st.modal = { type: 'subscription' };
  check('…um só: "o campeonato feito… volta a contar"', /🔓 Ao assinar, o campeonato feito no plano gratuito volta a contar/.test(txt(m.api.mSubscription())));
  m = make({ league: livre, champs: [ch('c1')] }); m.st.modal = { type: 'subscription' };
  check('…nenhum campeonato do plano gratuito: não fala disso', !/🔓|voltam a contar/.test(txt(m.api.mSubscription())) && /Plano gratuito — sem registro de gols/.test(txt(m.api.mSubscription())));
  m = make({ league: { trialEndsAt: iso(3) }, champs: lista }); m.st.modal = { type: 'subscription' };
  check('em teste grátis ou com plano em vigor a linha não aparece (o assunto é só do plano gratuito)', !/🔓/.test(txt(m.api.mSubscription())));
  m = make({ league: comPlano, champs: lista }); m.st.modal = { type: 'subscription' };
  check('…plano em vigor: idem', !/🔓/.test(txt(m.api.mSubscription())));
  m = make({ league: { trialEndsAt: iso(-30), subscriptionActiveUntil: iso(-3) }, champs: lista }); m.st.modal = { type: 'subscription' };
  check('plano que venceu (voltou ao gratuito): a linha aparece de novo', /🔓 Ao assinar, os 2 campeonatos/.test(txt(m.api.mSubscription())));

  // ── textos: nada diz mais "nem depois" ───────────────────────────────────────────────────────
  check('o app não diz mais, em lugar nenhum, que o plano gratuito "não conta nem depois de assinar"', !/nem depois, se a liga assinar|nem depois de assinar/.test(html) && !/nem depois, se a liga assinar|nem depois de assinar/.test(server));
  check('o aviso de quem cria campeonato no plano gratuito diz que ele é recuperado quando a liga assinar', /campeonatos criados agora ficam guardados, mas só contam para títulos, ranking e conquistas quando a liga assinar: aí eles são recuperados\./.test(html));
  check('o e-mail de fim de teste diz o mesmo (e que os gols não voltam)', /só passam a contar para títulos, ranking e conquistas quando a liga assinar: aí eles são recuperados\*\* \(os gols deles não foram registrados e não voltam\)\./.test(server));
  check('o manual descreve a recuperação (seção 25) e não afirma mais que a marca "não muda depois"', /id="recuperar-gratuitos"/.test(manual) && !/essa marcação não muda depois, mesmo que a liga volte a ser paga/.test(manual) && !/não contam para títulos, ranking e conquistas, nem depois/.test(manual), manual.match(/.{40}(nem depois|não muda depois).{40}/)?.[0]);

  console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(err => { console.error('ERRO NO TESTE', err); process.exitCode = 1; });
