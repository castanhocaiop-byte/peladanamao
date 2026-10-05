'use strict';
// Publica o ambiente de TESTE (staging): o projeto Firebase "seriebaceoma-staging", só com dados
// fictícios. Este script nunca toca a produção: o projeto vai escrito aqui dentro e todo comando leva
// --project e --config explícitos.
//
//   node scripts/staging.js deploy [alvos]   alvos separados por vírgula: site, rules, auth, functions
//                                            (sem alvos = todos); o site é montado antes de subir
//   node scripts/staging.js build-site       só monta a pasta .staging-site (cópia do site)
//
// Detalhes e passo a passo: docs/staging.md
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT = 'seriebaceoma-staging';
const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, '.staging-site');
const TARGETS = { site: 'hosting', rules: 'firestore:rules', auth: 'auth', functions: 'functions' };

// O que vai para o site é a mesma lista de permitidos da Vercel (.vercelignore): o teste serve
// exatamente os mesmos arquivos da produção, e um arquivo novo só entra nos dois ao mesmo tempo.
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

function firebase(args) {
  const isWin = process.platform === 'win32'; // no Windows o firebase é um .cmd e precisa de shell
  const r = spawnSync('firebase', args, { cwd: ROOT, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) process.exit(r.status || 1);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'build-site') {
  buildSite();
} else if (cmd === 'deploy') {
  const wanted = arg ? arg.split(',').map(s => s.trim()) : Object.keys(TARGETS);
  const unknown = wanted.filter(t => !TARGETS[t]);
  if (unknown.length) { console.error(`Alvo desconhecido: ${unknown.join(', ')}. Use: ${Object.keys(TARGETS).join(', ')}`); process.exit(2); }
  if (wanted.includes('site')) buildSite();
  firebase(['deploy', '--project', PROJECT, '--config', 'firebase.staging.json', '--only', wanted.map(t => TARGETS[t]).join(',')]);
} else {
  console.error('Uso: node scripts/staging.js deploy [site,rules,auth,functions]  |  node scripts/staging.js build-site');
  process.exit(2);
}
