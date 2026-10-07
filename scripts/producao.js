'use strict';
// Grava no projeto de PRODUÇÃO ("seriebaceoma") os segredos de pagamento do Mercado Pago, a partir da área de transferência:
// o valor nunca passa pelo chat nem aparece na tela. É o par do scripts/staging.js, que só mexe no projeto de TESTE.
// Com a chave de produção o app COBRA DE VERDADE; por isso este atalho:
//   - só roda num terminal interativo e pede para digitar SIM;
//   - confere o que foi copiado (Public Key no lugar do token, texto cortado…) e pergunta ao Mercado Pago de quem é a chave
//     (users/me): chave de conta de TESTE é barrada (a menos que se use --permitir-teste, para VOLTAR ao modo de teste);
//   - grava só no projeto seriebaceoma e limpa a área de transferência.
//
//   node scripts/producao.js secret MERCADOPAGO_ACCESS_TOKEN [--permitir-teste]
//   node scripts/producao.js secret MERCADOPAGO_WEBHOOK_SECRET
//
// Depois de gravar, publique as funções (o segredo só vale depois): firebase deploy --only functions --project seriebaceoma
// Guia completo: docs/producao.md
const { spawnSync } = require('child_process');
const path = require('path');
const { checkSecretValue } = require('./staging.js'); // só a conferência do valor copiado (nada de projeto de teste)

const PROJECT = 'seriebaceoma';
const ROOT = path.join(__dirname, '..');
const SECRETS = ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'];
const MP_ME = 'https://api.mercadopago.com/users/me';

const HOW_TO_COPY = {
  MERCADOPAGO_ACCESS_TOKEN: 'No painel do Mercado Pago, em "Credenciais de produção", clique no ícone de copiar do Access Token (o que fica escondido por pontinhos; NÃO a Public Key)',
  MERCADOPAGO_WEBHOOK_SECRET: 'No painel do Mercado Pago, em Webhooks, copie a "Assinatura secreta"',
};

// Pergunta ao Mercado Pago de quem é a chave. verdict: "real" | "test" | "invalid" | "unknown". Só devolve nome da conta, id e país
// (nunca o e-mail nem o valor da chave).
async function inspectMpAccount(token, fetchImpl = fetch, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(MP_ME, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ctl.signal });
  } catch (e) {
    return { verdict: 'unknown', why: 'não consegui falar com o Mercado Pago agora' };
  } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) return { verdict: 'invalid', why: 'o Mercado Pago não reconheceu esta chave (copiada errada, ou de outra aplicação)' };
  if (!res.ok) return { verdict: 'unknown', why: `o Mercado Pago respondeu ${res.status}` };
  let j = null;
  try { j = await res.json(); } catch (_) { /* resposta ilegível */ }
  const nickname = typeof j?.nickname === 'string' ? j.nickname.trim() : '';
  if (!nickname) return { verdict: 'unknown', why: 'a resposta do Mercado Pago veio sem o nome da conta' };
  return { verdict: /^TEST/i.test(nickname) ? 'test' : 'real', nickname, id: j.id != null ? String(j.id) : '', site: typeof j.site_id === 'string' ? j.site_id : '' };
}

const saidSIM = a => String(a == null ? '' : a).trim().toUpperCase() === 'SIM';
const saidYes = a => /^(s|sim)$/i.test(String(a == null ? '' : a).trim());
const firebaseSetArgs = name => ['functions:secrets:set', name, '--data-file', '-', '--force', '--project', PROJECT]; // o valor vai pela entrada padrão, nunca por aqui

// Roda o atalho. `io` traz tudo que toca o mundo de fora (para o teste poder simular): isTTY, ask, readClipboard, clearClipboard,
// fetchImpl, setSecret(name, value) → código de saída do firebase, out, err. Devolve o código de saída.
async function run(argv, io) {
  const allowTest = argv.includes('--permitir-teste');
  const [cmd, name] = argv.filter(a => !a.startsWith('--'));
  if (cmd !== 'secret' || !SECRETS.includes(name)) {
    io.err(`Uso: node scripts/producao.js secret NOME [--permitir-teste]   (NOME: ${SECRETS.join(' ou ')})`);
    return 2;
  }
  if (!io.isTTY) { io.err('✗ Este atalho só roda num terminal interativo (ele pede confirmações). Abra o terminal e rode o comando na mão.'); return 1; }

  io.out('');
  io.out('ATENÇÃO: isto grava um segredo de PAGAMENTO no projeto de PRODUÇÃO (' + PROJECT + ').');
  io.out(name === 'MERCADOPAGO_ACCESS_TOKEN'
    ? 'Com a chave de produção, o app passa a COBRAR DE VERDADE (depois de você publicar as funções).'
    : 'Esta assinatura confere os avisos que o Mercado Pago manda ao app: se estiver errada, os pagamentos deixam de ser confirmados.');
  if (!saidSIM(await io.ask('\nPara continuar, digite SIM: '))) { io.out('Cancelado. Nada foi gravado.'); return 1; }

  await io.ask(`\n${HOW_TO_COPY[name]}.\nQuando tiver copiado, volte para esta tela e aperte Enter... `);
  const copied = io.readClipboard();
  if (copied.error) { io.err('✗ ' + copied.error); return 1; }
  const checked = checkSecretValue(name, copied.text);
  if (checked.error) { io.err('✗ ' + checked.error); return 1; }
  io.out(`Li da área de transferência: ${checked.value.length} caracteres.`);

  if (name === 'MERCADOPAGO_ACCESS_TOKEN') {
    io.out('Conferindo no Mercado Pago de quem é esta chave...');
    const who = await inspectMpAccount(checked.value, io.fetchImpl);
    if (who.verdict === 'invalid') { io.err('✗ ' + who.why + '. Nada foi gravado.'); return 1; }
    if (who.verdict === 'test') {
      if (!allowTest) {
        io.err(`✗ Esta chave é de uma conta de TESTE (nome da conta: ${who.nickname}). Copie o Access Token de "Credenciais de produção". Nada foi gravado.`);
        return 1;
      }
      io.out(`⚠️  Chave de TESTE (${who.nickname}): o app voltará a funcionar só em modo de teste (ninguém é cobrado de verdade).`);
    } else if (who.verdict === 'real') {
      io.out(`Conta do Mercado Pago dona desta chave: ${who.nickname}${who.id ? ` (id ${who.id})` : ''}${who.site ? `, país ${who.site}` : ''}.`);
      if (!saidYes(await io.ask('É a SUA conta de vendedor? (S/N) '))) { io.out('Cancelado. Nada foi gravado.'); return 1; }
    } else {
      io.out(`⚠️  Não consegui conferir de quem é a chave: ${who.why}.`);
      if (!saidSIM(await io.ask('Gravar mesmo assim? Digite SIM: '))) { io.out('Cancelado. Nada foi gravado.'); return 1; }
    }
  }

  io.out(`Gravando ${name} no projeto de PRODUÇÃO (${PROJECT})...`);
  const code = io.setSecret(name, checked.value);
  io.clearClipboard();
  if (code !== 0) { io.err(`✗ O firebase não conseguiu gravar (código ${code}). A área de transferência foi limpa; copie de novo para tentar outra vez.`); return code || 1; }
  io.out(`\nPronto: ${name} gravado na produção e área de transferência limpa.`);
  io.out('Falta publicar as funções para o segredo valer (com o valor vindo pela entrada padrão o firebase não republica sozinho):');
  io.out(`  firebase deploy --only functions --project ${PROJECT}`);
  return 0;
}

// ── o que toca o mundo de fora (só no uso de verdade) ──────────────────────────────────────────────────────────────────
function ask(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}
function clipboard(action) {
  const win = process.platform === 'win32';
  if (!win && process.platform !== 'darwin') return { error: `Este atalho só funciona no Windows e no Mac; em outro sistema use: firebase functions:secrets:set NOME --project ${PROJECT}` };
  const [cmd, args] = win
    ? ['powershell', ['-NoProfile', '-NonInteractive', '-Command', action === 'read' ? 'Get-Clipboard -Raw' : "Set-Clipboard -Value ' '"]]
    : action === 'read' ? ['pbpaste', []] : ['pbcopy', []];
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: action === 'clear' && !win ? ' ' : undefined });
  if (r.error || r.status !== 0) return { error: 'Não consegui acessar a área de transferência deste computador.' };
  return { text: r.stdout };
}
function setSecret(name, value) {
  const isWin = process.platform === 'win32'; // no Windows o firebase é um .cmd e precisa de shell
  const r = spawnSync('firebase', firebaseSetArgs(name), { cwd: ROOT, shell: isWin, input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  return r.status === null ? 1 : r.status;
}

async function main() {
  const code = await run(process.argv.slice(2), {
    isTTY: !!process.stdin.isTTY, ask, readClipboard: () => clipboard('read'), clearClipboard: () => clipboard('clear'),
    fetchImpl: fetch, setSecret, out: s => console.log(s), err: s => console.error(s),
  });
  process.exitCode = code;
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { run, inspectMpAccount, firebaseSetArgs, saidSIM, saidYes, SECRETS, PROJECT };
