'use strict';
// Publica o ambiente de TESTE (staging): o projeto Firebase "seriebaceoma-staging", só com dados
// fictícios. Este script nunca toca a produção: o projeto vai escrito aqui dentro e todo comando leva
// --project e --config explícitos.
//
//   node scripts/staging.js deploy [alvos]   alvos separados por vírgula: site, rules, auth, functions
//                                            (sem alvos = todos); o site é montado antes de subir
//   node scripts/staging.js build-site       só monta a pasta .staging-site (cópia do site)
//   node scripts/staging.js secret NOME      grava um segredo do projeto de TESTE com o que está na área de
//                                            transferência (copie o valor antes): o valor não passa pelo chat,
//                                            não aparece na tela e a área de transferência é limpa no fim
//
// Detalhes e passo a passo: docs/staging.md
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT = 'seriebaceoma-staging';
const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, '.staging-site');
const TARGETS = { site: 'hosting', rules: 'firestore:rules', auth: 'auth', functions: 'functions' };

// Segredos do projeto de teste que podem ser gravados por aqui.
const SECRETS = ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'RESEND_API_KEY', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const MP_PREFIX = /^(APP_USR|TEST)-/; // hoje as credenciais de teste do Mercado Pago também começam com APP_USR-
const MP_PUBLIC_KEY = /^(APP_USR|TEST)-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i; // a chave PÚBLICA é um UUID

// Confere o que foi copiado antes de virar segredo. Devolve o valor limpo ou uma mensagem de erro, e a
// mensagem nunca contém o valor: o dono vê o que houve sem que nada sensível apareça na tela.
function checkSecretValue(name, raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return { error: 'A área de transferência está vazia. Copie o valor de novo e rode o comando outra vez.' };
  if (/\s/.test(value)) return { error: 'O que está copiado tem espaços ou várias linhas, então não é um segredo. Copie só o valor.' };
  if (!/^[\x21-\x7e]+$/.test(value)) return { error: 'O que está copiado tem caracteres estranhos, então não é um segredo.' };
  if (value.length < 16) return { error: `O que está copiado tem só ${value.length} caracteres, curto demais para ser um segredo.` };
  if (value.length > 512) return { error: 'O que está copiado é grande demais para ser um segredo.' };
  if (name === 'MERCADOPAGO_ACCESS_TOKEN') {
    if (MP_PUBLIC_KEY.test(value)) return { error: 'Isso é a Public Key (chave pública), não o Access Token. Copie o Access Token (o que fica escondido por pontinhos).' };
    if (!MP_PREFIX.test(value)) return { error: 'Um Access Token do Mercado Pago começa com APP_USR- (ou TEST-); o que está copiado é outra coisa.' };
    if (value.length < 40) return { error: `O que está copiado tem só ${value.length} caracteres, curto demais para um Access Token. Copie inteiro.` };
  }
  if (name === 'MERCADOPAGO_WEBHOOK_SECRET' && MP_PREFIX.test(value)) {
    return { error: 'Isso parece um Access Token, não a assinatura secreta dos Webhooks. Copie a "Assinatura secreta".' };
  }
  return { value };
}

// O site de teste serve exatamente os mesmos arquivos da produção: a lista de permitidos da Vercel
// (.vercelignore) é a fonte, então um arquivo novo só entra nos dois ao mesmo tempo.
function siteFiles() {
  return fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')
    .split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('!')).map(l => l.slice(1));
}

function buildSite() {
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });
  const files = siteFiles();
  if (!files.includes('index.html')) throw new Error('.vercelignore não libera o index.html — algo está errado');
  for (const f of files) {
    if (f.includes('/') || f.includes('\\') || f.includes('..')) throw new Error('arquivo fora da raiz no .vercelignore: ' + f);
    fs.copyFileSync(path.join(ROOT, f), path.join(SITE_DIR, f));
  }
  console.log(`Site de teste montado em .staging-site (${files.length} arquivos: ${files.join(', ')})`);
}

// Com "input", o valor segue direto para o comando (entrada padrão) e nunca aparece na tela.
function firebase(args, input) {
  const isWin = process.platform === 'win32'; // no Windows o firebase é um .cmd e precisa de shell
  const piped = input === undefined ? { stdio: 'inherit' } : { input, stdio: ['pipe', 'inherit', 'inherit'] };
  const r = spawnSync('firebase', args, { cwd: ROOT, shell: isWin, ...piped });
  if (r.status !== 0) process.exit(r.status || 1);
}

// Onde o dono copia cada valor. O comando espera um Enter antes de ler a área de transferência: assim ele
// pode ser iniciado antes de copiar (nada na tela do app sobrescreve o que foi copiado depois).
const HOW_TO_COPY = {
  MERCADOPAGO_ACCESS_TOKEN: 'No painel do Mercado Pago, em "Credenciais de teste", clique no ícone de copiar do Access Token',
  MERCADOPAGO_WEBHOOK_SECRET: 'No painel do Mercado Pago, em Webhooks, copie a "Assinatura secreta"',
};

function waitForEnter(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => { rl.close(); resolve(); });
  });
}

// Área de transferência: só Windows e Mac (o dono usa Windows).
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

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'build-site') {
    buildSite();
  } else if (cmd === 'deploy') {
    const wanted = arg ? arg.split(',').map(s => s.trim()) : Object.keys(TARGETS);
    const unknown = wanted.filter(t => !TARGETS[t]);
    if (unknown.length) { console.error(`Alvo desconhecido: ${unknown.join(', ')}. Use: ${Object.keys(TARGETS).join(', ')}`); process.exit(2); }
    if (wanted.includes('site')) buildSite();
    firebase(['deploy', '--project', PROJECT, '--config', 'firebase.staging.json', '--only', wanted.map(t => TARGETS[t]).join(',')]);
  } else if (cmd === 'secret') {
    if (!SECRETS.includes(arg)) { console.error(`Segredo desconhecido: ${arg || '(faltou o nome)'}. Use um destes: ${SECRETS.join(', ')}`); process.exit(2); }
    if (process.stdin.isTTY) await waitForEnter(`\n${HOW_TO_COPY[arg] || 'Copie o valor do segredo'}.\nQuando tiver copiado, volte para esta tela e aperte Enter... `);
    const copied = clipboard('read');
    if (copied.error) { console.error('✗ ' + copied.error); process.exit(1); }
    const checked = checkSecretValue(arg, copied.text);
    if (checked.error) { console.error('✗ ' + checked.error); process.exit(1); }
    const prefix = arg === 'MERCADOPAGO_ACCESS_TOKEN' ? ` (começa com ${checked.value.slice(0, checked.value.indexOf('-') + 1)})` : '';
    console.log(`Li da área de transferência: ${checked.value.length} caracteres${prefix}. Gravando ${arg} no projeto de TESTE (${PROJECT})...`);
    firebase(['functions:secrets:set', arg, '--data-file', '-', '--force', '--project', PROJECT], checked.value);
    clipboard('clear');
    // Com o valor vindo pela entrada padrão o firebase trata o comando como não interativo e NÃO republica
    // as funções (mesmo com --force): elas seguem com a versão antiga do segredo até o próximo deploy.
    console.log(`\nPronto: ${arg} gravado no projeto de teste e área de transferência limpa.`);
    console.log('Falta publicar as funções para o segredo valer: node scripts/staging.js deploy functions');
  } else {
    console.error('Uso: node scripts/staging.js deploy [site,rules,auth,functions]  |  build-site  |  secret NOME');
    process.exit(2);
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { checkSecretValue, SECRETS };
