// Atalho para gravar os segredos de PAGAMENTO na produção (node scripts/producao.js secret NOME). Com a chave de produção o app cobra
// de verdade, então confere: só roda num terminal interativo e com SIM digitado; grava só no projeto de produção; barra chave de
// conta de TESTE (a menos que se peça para voltar ao teste); o valor nunca aparece em mensagem nem em argumento de comando; a área
// de transferência é limpa depois de gravar. Nada aqui fala com o Mercado Pago nem com o Firebase de verdade (tudo simulado).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'producao.js');
const { run, inspectMpAccount, firebaseSetArgs, saidSIM, saidYes, looksLikeKey, SECRETS, PROJECT } = require(script);

let fails = 0, oks = 0, finished = false;
process.on('exit', () => { if (!finished) { console.error('ERRO NO TESTE: não chegou ao fim (algo ficou esperando para sempre)'); process.exitCode = 1; } });
const check = (label, cond, extra) => {
  if (cond) oks++; else fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

const TOKEN = 'APP_USR-1699581516483552-100512-0123456789abcdef0123456789abcdef-1234567890';
const PUBLIC_KEY = 'APP_USR-96abf4a7-63db-43f6-ad2c-24c64b75fa13';
const WEBHOOK_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const AT = 'MERCADOPAGO_ACCESS_TOKEN', WH = 'MERCADOPAGO_WEBHOOK_SECRET';
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new Error('sem corpo'); return body; } });

// ── o que existe ─────────────────────────────────────────────────────────────────────────────────────────────────
check('só os dois segredos do Mercado Pago podem ser gravados por este atalho (nada de e-mail, fotos…)', JSON.stringify(SECRETS) === JSON.stringify([AT, WH]), SECRETS);
check('o projeto é o de PRODUÇÃO, escrito dentro do script (não vem de argumento nem de variável de ambiente)', PROJECT === 'seriebaceoma');
const src = fs.readFileSync(script, 'utf8');
check('o script nunca cita o projeto de teste nem aceita outro projeto (--project só aparece com a constante)', !/staging/i.test(src.replace(/scripts\/staging\.js|\.\/staging\.js|par do scripts\/staging\.js|projeto de TESTE|\/\/ só a conferência[^\n]*/g, '')) && (src.match(/--project/g) || []).length >= 1 && !/process\.env/.test(src) && !/process\.argv\.slice\(2\)\.find|--projeto/.test(src), (src.match(/staging/gi) || []).length);
check('os argumentos do firebase: grava pelo nome, valor pela entrada padrão (-), no projeto de produção, e NUNCA com o valor na linha de comando', JSON.stringify(firebaseSetArgs(AT)) === JSON.stringify(['functions:secrets:set', AT, '--data-file', '-', '--force', '--project', 'seriebaceoma']) && !firebaseSetArgs(AT).some(a => a.includes('APP_USR')));
check('nenhuma mensagem do script imprime o valor lido (só o tamanho)', !/console\.(log|error)\([^)]*(checked\.value|copied\.text)(?!\.length)/.test(src) && !/io\.(out|err)\([^)]*(checked\.value|copied\.text)(?!\.length)/.test(src), src.match(/io\.(out|err)\([^)]*checked\.value[^)]*\)/g));

// ── respostas à pergunta de SIM e de S/N ─────────────────────────────────────────────────────────────────────────
check('"SIM" vale em qualquer caixa e com espaços; "S", "sim!", "não", vazio e nulo NÃO valem para o SIM de segurança', ['SIM', 'sim', ' Sim ', 'sIm\n'].every(saidSIM) && ['S', 's', 'sim!', 'não', 'nao', '', null, undefined, 'SIMM', 'si m'].every(a => !saidSIM(a)));
check('"S" ou "SIM" valem para a confirmação da conta; "N", "não", vazio, nulo e "talvez" não', ['s', 'S', 'sim', 'SIM', ' s '].every(saidYes) && ['n', 'N', 'não', '', null, 'talvez', 'sss'].every(a => !saidYes(a)));

// ── conferir de quem é a chave ───────────────────────────────────────────────────────────────────────────────────
async function inspectWith(status, body) { return inspectMpAccount(TOKEN, reply(status, body)); }
let r = await_(inspectWith(200, { id: 2702948457, nickname: 'TESTUSER2702948457827838830', site_id: 'MLB', email: 'segredo@x.com' }));
function await_(p) { return p; } // (os testes abaixo rodam dentro do bloco assíncrono)

(async () => {
  r = await r;
  check('conta de teste (nome começa com TEST): veredito "test", sem e-mail na resposta', r.verdict === 'test' && r.nickname === 'TESTUSER2702948457827838830' && !('email' in r) && !/segredo@/.test(JSON.stringify(r)), r);
  r = await inspectWith(200, { id: 55, nickname: 'test_user_123', site_id: 'MLB' });
  check('…também com o nome em minúsculas e "_" (test_user_…)', r.verdict === 'test', r);
  r = await inspectWith(200, { id: 777888, nickname: ' CAIO.VENDEDOR ', site_id: 'MLB', email: 'caio@x.com', first_name: 'Caio' });
  check('conta real: veredito "real" com o nome (sem espaços nas pontas), o id e o país; nada de e-mail nem nome da pessoa', r.verdict === 'real' && r.nickname === 'CAIO.VENDEDOR' && r.id === '777888' && r.site === 'MLB' && !/caio@|Caio$/.test(JSON.stringify({ ...r, nickname: '' })), r);
  r = await inspectWith(200, { nickname: 'LOJA123' });
  check('conta real sem id nem país: ainda "real"', r.verdict === 'real' && r.id === '' && r.site === '');
  for (const st of [401, 403]) { r = await inspectWith(st, {}); check(`chave que o Mercado Pago não reconhece (${st}): "invalid"`, r.verdict === 'invalid' && /não reconheceu/.test(r.why), r); }
  r = await inspectWith(500, {}); check('Mercado Pago com defeito (500): "unknown" dizendo o código', r.verdict === 'unknown' && /500/.test(r.why), r);
  r = await inspectWith(200, {}); check('resposta sem o nome da conta: "unknown"', r.verdict === 'unknown' && /sem o nome/.test(r.why), r);
  r = await inspectWith(200, undefined); check('resposta que não é JSON: "unknown"', r.verdict === 'unknown', r);
  r = await inspectMpAccount(TOKEN, async () => { throw new Error('sem rede'); }); check('sem rede: "unknown"', r.verdict === 'unknown' && /não consegui falar/.test(r.why), r);
  let seen = null;
  await inspectMpAccount(TOKEN, async (url, opts) => { seen = { url, opts }; return { status: 200, ok: true, json: async () => ({ nickname: 'X1' }) }; });
  check('a pergunta vai para users/me do Mercado Pago, com a chave no cabeçalho Authorization (Bearer) e com limite de tempo', seen.url === 'https://api.mercadopago.com/users/me' && seen.opts.headers.Authorization === 'Bearer ' + TOKEN && !!seen.opts.signal, seen);
  const t0 = Date.now();
  r = await inspectMpAccount(TOKEN, (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('abortado')))), 60);
  check('Mercado Pago que não responde: desiste no tempo limite (não trava o comando) e vira "unknown"', r.verdict === 'unknown' && Date.now() - t0 < 2000, [r, Date.now() - t0]);

  // ── o fluxo inteiro, com tudo simulado ────────────────────────────────────────────────────────────────────────
  const makeIo = ({ tty = true, answers = [], clip = { text: TOKEN }, fetchImpl, setCode = 0 } = {}) => {
    const calls = { asked: [], set: [], cleared: 0, reads: 0, out: [], err: [] };
    const queue = [...answers];
    const io = {
      isTTY: tty,
      ask: async q => { calls.asked.push(q); return queue.length ? queue.shift() : ''; },
      readClipboard: () => { calls.reads++; return clip; },
      clearClipboard: () => { calls.cleared++; },
      fetchImpl: fetchImpl || reply(200, { id: 777888, nickname: 'CAIO.VENDEDOR', site_id: 'MLB' }),
      setSecret: (n, v) => { calls.set.push([n, v]); return setCode; },
      out: s => calls.out.push(s), err: s => calls.err.push(s),
    };
    return { io, calls };
  };
  const leaked = calls => JSON.stringify([calls.out, calls.err, calls.asked]).includes(TOKEN) || JSON.stringify([calls.out, calls.err, calls.asked]).includes(WEBHOOK_SECRET);
  const SIM = 'SIM';

  let t = makeIo({ answers: [SIM, '', 's'] });
  let code = await run(['secret', AT], t.io);
  check('caminho feliz (chave real, SIM, copiou, "é a minha conta"): grava UMA vez, no nome certo, com o valor certo; limpa a área de transferência; manda publicar as funções', code === 0 && t.calls.set.length === 1 && t.calls.set[0][0] === AT && t.calls.set[0][1] === TOKEN && t.calls.cleared === 1 && /firebase deploy --only functions --project seriebaceoma/.test(t.calls.out.join('\n')), t.calls);
  check('…mostra o nome da conta do Mercado Pago para a pessoa conferir, e as três perguntas vêm na ordem (SIM → copiar → "é a sua conta?")', /CAIO\.VENDEDOR \(id 777888\), país MLB/.test(t.calls.out.join('\n')) && t.calls.asked.length === 3 && /digite SIM/.test(t.calls.asked[0]) && /Credenciais de produção/.test(t.calls.asked[1]) && /SUA conta/.test(t.calls.asked[2]), t.calls.asked);
  check('…e o valor da chave NÃO aparece em nenhuma mensagem nem pergunta', !leaked(t.calls), t.calls.out.concat(t.calls.err));
  check('…só diz o tamanho do que leu', t.calls.out.some(l => l === `Li da área de transferência: ${TOKEN.length} caracteres.`), t.calls.out);

  t = makeIo({ tty: false, answers: [SIM] });
  code = await run(['secret', AT], t.io);
  check('fora de um terminal interativo: recusa, não pergunta nada e não grava', code === 1 && t.calls.asked.length === 0 && t.calls.set.length === 0 && t.calls.reads === 0 && /terminal interativo/.test(t.calls.err.join(' ')), t.calls);
  for (const [rotulo, argv] of [['sem nome', ['secret']], ['sem comando', []], ['nome de outro segredo', ['secret', 'RESEND_API_KEY']], ['segredo do teste', ['secret', 'CLOUDINARY_API_KEY']], ['comando desconhecido', ['deploy', AT]], ['nome em minúsculas', ['secret', 'mercadopago_access_token']]]) {
    t = makeIo({ answers: [SIM] }); code = await run(argv, t.io);
    check(`uso errado (${rotulo}): código 2, explica o uso e não pergunta nem grava`, code === 2 && /Uso:/.test(t.calls.err.join(' ')) && t.calls.asked.length === 0 && t.calls.set.length === 0, t.calls);
  }
  for (const resposta of ['', 'sim, claro', 'S', 'n', 'não', 'SIMM']) {
    t = makeIo({ answers: [resposta] });
    code = await run(['secret', AT], t.io);
    check(`confirmação de segurança com "${resposta}" (só SIM vale): cancela, não lê a área de transferência e não grava`, code === 1 && t.calls.reads === 0 && t.calls.set.length === 0 && t.calls.cleared === 0 && /Cancelado/.test(t.calls.out.join(' ')), t.calls);
  }
  // ── chave colada onde não devia (aconteceu em 09/10/2026: a chave foi colada na pergunta do SIM e ficou na tela) ───
  const KEY_SAMPLES = [['chave do Mercado Pago (APP_USR-…)', TOKEN], ['chave de teste (TEST-…)', 'TEST-1234567890123456-100116-abcdef0123456789abcdef0123456789-195165835'], ['Public Key', PUBLIC_KEY], ['Client Secret (32 letras e números sem espaço)', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'], ['assinatura do webhook', WEBHOOK_SECRET], ['chave com espaços e quebra de linha nas pontas', '  ' + TOKEN + ' \r\n'], ['começo de chave cortado (APP_USR-…)', 'APP_USR-1699'], ['começo de chave de teste cortado (TEST-…)', 'TEST-1699']];
  for (const [rotulo, colado] of KEY_SAMPLES) {
    t = makeIo({ answers: [colado] });
    code = await run(['secret', AT], t.io);
    const tudo = JSON.stringify([t.calls.out, t.calls.err, t.calls.asked]);
    check(`${rotulo} colada na pergunta do SIM: recusa e manda renovar a chave, sem ler a área de transferência, sem gravar e sem repetir o que foi colado`, code === 1 && t.calls.reads === 0 && t.calls.set.length === 0 && t.calls.cleared === 0 && /parece uma CHAVE/.test(t.calls.err.join(' ')) && /Renovar/.test(t.calls.err.join(' ')) && !/Cancelado/.test(t.calls.out.join(' ')) && !tudo.includes(colado.trim()), t.calls);
  }
  for (const resposta of ['a'.repeat(31), 'sim claro pode continuar por favor sim sim sim', 'APP_USR', 'TEST', 'sim-pode', 'nao-sei']) {
    t = makeIo({ answers: [resposta] });
    code = await run(['secret', AT], t.io);
    check(`resposta comum "${resposta.slice(0, 20)}…" (não parece chave: curta ou com espaços): continua sendo só "Cancelado", sem o aviso de chave`, code === 1 && /Cancelado/.test(t.calls.out.join(' ')) && t.calls.err.length === 0, t.calls);
  }
  t = makeIo({ answers: [SIM, TOKEN] });
  code = await run(['secret', AT], t.io);
  check('chave colada no lugar do Enter (na hora de copiar): recusa, não lê a área de transferência, não grava e não repete o valor', code === 1 && t.calls.reads === 0 && t.calls.set.length === 0 && t.calls.cleared === 0 && /parece uma CHAVE/.test(t.calls.err.join(' ')) && !leaked(t.calls), t.calls);
  t = makeIo({ answers: [SIM, '', TOKEN] });
  code = await run(['secret', AT], t.io);
  check('chave colada na pergunta "é a sua conta?": recusa, não grava e LIMPA a área de transferência (a chave estava nela)', code === 1 && t.calls.set.length === 0 && t.calls.cleared === 1 && /parece uma CHAVE/.test(t.calls.err.join(' ')) && !leaked(t.calls), t.calls);
  t = makeIo({ answers: [SIM, '', TOKEN], fetchImpl: async () => { throw new Error('sem rede'); } });
  code = await run(['secret', AT], t.io);
  check('chave colada na pergunta "gravar mesmo assim?" (quando não deu para conferir a conta): recusa, não grava e limpa a área de transferência', code === 1 && t.calls.set.length === 0 && t.calls.cleared === 1 && /Gravar mesmo assim/.test(t.calls.asked[2]) && /parece uma CHAVE/.test(t.calls.err.join(' ')) && !leaked(t.calls), t.calls);
  t = makeIo({ answers: [SIM, '', 's'] });
  await run(['secret', AT], t.io);
  check('as perguntas avisam, em cada etapa, que a chave não é digitada nem colada no terminal (só SIM e Enter)', /só estas 3 letras/.test(t.calls.asked[0]) && /NÃO é digitada nem colada/.test(t.calls.asked[0]) && /só o Enter/.test(t.calls.asked[1]) && /sem colar nada/.test(t.calls.asked[1]), t.calls.asked);
  check('looksLikeKey: sim para APP_USR-…, TEST-… e textos de 32+ letras/números sem espaço; não para SIM, S, vazio, nulo, frases e textos de 31', KEY_SAMPLES.every(([, v]) => looksLikeKey(v)) && ['SIM', 's', '', null, undefined, 'sim, claro', 'a'.repeat(31), 'duas palavras ' + 'a'.repeat(40)].every(v => !looksLikeKey(v)));

  t = makeIo({ answers: [SIM, ''], clip: { error: 'Não consegui acessar a área de transferência deste computador.' } });
  code = await run(['secret', AT], t.io);
  check('área de transferência inacessível: erro claro, nada gravado', code === 1 && t.calls.set.length === 0 && /área de transferência/.test(t.calls.err.join(' ')), t.calls);
  for (const [rotulo, texto] of [['vazia', ''], ['só espaços', ' \r\n '], ['Public Key no lugar do token', PUBLIC_KEY], ['texto qualquer', 'País de operação Brasil'], ['token cortado', TOKEN.slice(0, 30)], ['várias linhas', TOKEN + '\n' + TOKEN]]) {
    t = makeIo({ answers: [SIM, ''], clip: { text: texto } });
    code = await run(['secret', AT], t.io);
    check(`área de transferência ${rotulo}: barrada com mensagem, sem perguntar ao Mercado Pago e sem gravar (e a mensagem não leva o valor)`, code === 1 && t.calls.set.length === 0 && t.calls.err.length === 1 && !(texto.length > 20 && t.calls.err.join(' ').includes(texto.trim())), t.calls);
  }
  let askedMp = 0;
  t = makeIo({ answers: [SIM, '', 's'], fetchImpl: async (...a) => { askedMp++; return reply(200, { id: 1, nickname: 'LOJA1', site_id: 'MLB' })(...a); } });
  await run(['secret', AT], t.io);
  check('a pergunta ao Mercado Pago só acontece depois de a chave passar na conferência do formato', askedMp === 1);

  // chave de teste
  const teste = reply(200, { id: 9, nickname: 'TESTUSER123456', site_id: 'MLB' });
  t = makeIo({ answers: [SIM, ''], fetchImpl: teste });
  code = await run(['secret', AT], t.io);
  check('chave de conta de TESTE: barrada, com o nome da conta e o que fazer; nada gravado e a área de transferência intacta (nada foi tentado)', code === 1 && t.calls.set.length === 0 && t.calls.cleared === 0 && /TESTE/.test(t.calls.err.join(' ')) && /TESTUSER123456/.test(t.calls.err.join(' ')) && /Credenciais de produção/.test(t.calls.err.join(' ')) && !leaked(t.calls), t.calls);
  t = makeIo({ answers: [SIM, ''], fetchImpl: teste });
  code = await run(['secret', AT, '--permitir-teste'], t.io);
  check('com --permitir-teste (para VOLTAR ao modo de teste): avisa em voz alta, não faz a pergunta da conta, e grava', code === 0 && t.calls.set.length === 1 && /voltará a funcionar só em modo de teste/.test(t.calls.out.join(' ')) && t.calls.asked.length === 2 && t.calls.cleared === 1, t.calls);
  t = makeIo({ answers: [SIM, '', 's'], fetchImpl: reply(200, { id: 5, nickname: 'LOJA7', site_id: 'MLB' }) });
  code = await run(['secret', AT, '--permitir-teste'], t.io);
  check('--permitir-teste NÃO dispensa a pergunta da conta quando a chave é de verdade', code === 0 && t.calls.asked.length === 3, t.calls.asked);

  // outras respostas do Mercado Pago
  t = makeIo({ answers: [SIM, ''], fetchImpl: reply(401, {}) });
  code = await run(['secret', AT], t.io);
  check('o Mercado Pago não reconhece a chave: barrada, nada gravado', code === 1 && t.calls.set.length === 0 && /não reconheceu/.test(t.calls.err.join(' ')), t.calls);
  for (const resposta of ['', 's', 'não']) {
    t = makeIo({ answers: [SIM, '', resposta], fetchImpl: reply(500, {}) });
    code = await run(['secret', AT], t.io);
    check(`não deu para conferir a conta (Mercado Pago com defeito) e a resposta foi "${resposta}" (só SIM vale): não grava`, code === 1 && t.calls.set.length === 0 && /Não consegui conferir/.test(t.calls.out.join(' ')), t.calls);
  }
  t = makeIo({ answers: [SIM, '', SIM], fetchImpl: async () => { throw new Error('sem rede'); } });
  code = await run(['secret', AT], t.io);
  check('sem rede para conferir: com SIM de novo, grava assim mesmo (e a pergunta diz o motivo)', code === 0 && t.calls.set.length === 1 && /não consegui falar/.test(t.calls.out.join(' ')) && t.calls.cleared === 1, t.calls);
  t = makeIo({ answers: [SIM, '', 'n'] });
  code = await run(['secret', AT], t.io);
  check('"não é a minha conta": cancela, nada gravado, área de transferência intacta', code === 1 && t.calls.set.length === 0 && t.calls.cleared === 0 && /Cancelado/.test(t.calls.out.join(' ')), t.calls);

  // assinatura secreta do webhook
  t = makeIo({ answers: [SIM, ''], clip: { text: WEBHOOK_SECRET }, fetchImpl: async () => { throw new Error('não era para chamar'); } });
  code = await run(['secret', WH], t.io);
  check('assinatura do webhook: grava sem perguntar ao Mercado Pago de quem é (não é uma chave de conta), com as mesmas confirmações', code === 0 && t.calls.set.length === 1 && t.calls.set[0][0] === WH && t.calls.set[0][1] === WEBHOOK_SECRET && t.calls.cleared === 1 && !leaked(t.calls) && /assinatura/i.test(t.calls.out.join(' ')), t.calls);
  t = makeIo({ answers: [SIM, ''], clip: { text: TOKEN } });
  code = await run(['secret', WH], t.io);
  check('…e um Access Token no lugar da assinatura é barrado', code === 1 && t.calls.set.length === 0 && t.calls.err.length === 1 && !leaked(t.calls), t.calls);

  // o firebase falhou
  t = makeIo({ answers: [SIM, '', 's'], setCode: 1 });
  code = await run(['secret', AT], t.io);
  check('o firebase não conseguiu gravar: devolve o código do erro, explica, limpa a área de transferência mesmo assim e NÃO manda publicar', code === 1 && t.calls.cleared === 1 && /não conseguiu gravar/.test(t.calls.err.join(' ')) && !/deploy --only functions/.test(t.calls.out.join(' ')) && !leaked(t.calls), t.calls);
  t = makeIo({ answers: [SIM, '', 's'], setCode: 7 });
  code = await run(['secret', AT], t.io);
  check('…com o código que o firebase deu', code === 7);

  // o programa de verdade (sem terminal interativo): nunca chega a perguntar nem gravar
  const child = (...args) => spawnSync('node', [script, ...args], { encoding: 'utf8', input: '', timeout: 20000 });
  let c = child('secret', AT);
  check('rodando o script de verdade sem terminal interativo: recusa com código 1, explica e não toca em nada', c.status === 1 && /terminal interativo/.test(c.stderr) && !/Pronto/.test(c.stdout), [c.status, c.stderr]);
  c = child('secret', 'RESEND_API_KEY');
  check('…segredo que não é de pagamento: código 2 e o uso', c.status === 2 && /Uso:/.test(c.stderr), [c.status, c.stderr]);
  c = child();
  check('…sem argumentos: código 2 e o uso', c.status === 2 && /Uso:/.test(c.stderr), [c.status, c.stderr]);

  finished = true;
  console.log(`\n${fails === 0 ? `Todos os testes passaram (${oks})` : fails + ' FALHA(S)'}`);
  if (fails) process.exitCode = 1;
})().catch(e => { console.error('ERRO NO TESTE', e); process.exitCode = 1; });
