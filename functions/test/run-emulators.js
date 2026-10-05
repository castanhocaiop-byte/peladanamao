// Sobe os emuladores (Auth + Firestore + Functions) e roda test/emulator-test.js contra eles.
//
//   cd functions && npm run test:emulators
//
// Precisa de Java 21 no PATH (o emulador do Firestore é Java) e de "npm install" feito em functions/.
// Usa o projeto "demo-aceoma": nada aqui toca o Firebase de verdade, nem pede login.
// É também o que o CI roda (.github/workflows/ci.yml).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const slash = p => p.replace(/\\/g, '/');
const stubFile = path.join(os.tmpdir(), `pnm-mp-stub-${process.pid}.json`);
const secretsFile = path.join(root, 'functions', '.secret.local');

// As funções declaram segredos (Mercado Pago, Cloudinary, Resend). No emulador, valores de mentira
// num .secret.local evitam consultar o Secret Manager de verdade. Só criamos se não houver um.
// Os do Mercado Pago têm um valor próprio (e não "ainda não configurado"): sem ele o webhook responde
// 503 e não dá para testá-lo. O token vai para o Mercado Pago simulado, que o ignora.
const secretNames = ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'RESEND_API_KEY'];
const secretValues = { MERCADOPAGO_ACCESS_TOKEN: 'TEST-token-so-do-emulador', MERCADOPAGO_WEBHOOK_SECRET: 'segredo-so-do-emulador' };
const createdSecrets = !fs.existsSync(secretsFile);
if (createdSecrets) fs.writeFileSync(secretsFile, secretNames.map(n => `${n}=${secretValues[n] || 'PENDENTE_CONFIGURAR'}`).join('\n') + '\n');
fs.writeFileSync(stubFile, JSON.stringify({ preapprovals: [], updates: [] }));

const stub = slash(path.join(__dirname, 'mp-stub.js'));
const env = {
  ...process.env,
  // O emulador espera só 10 s para carregar o código das funções; numa máquina lenta (ou na primeira
  // execução, com o antivírus olhando cada arquivo) isso não basta e nenhuma função responde.
  FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '120',
  MP_STUB_FILE: stubFile,
  NODE_OPTIONS: [`--require "${stub}"`, process.env.NODE_OPTIONS].filter(Boolean).join(' '),
};

// FIREBASE_CMD permite apontar para outro firebase-tools (ex.: "firebase" já instalado).
const firebase = (process.env.FIREBASE_CMD || 'npx --yes firebase-tools@15.28.2').split(' ');
const isWin = process.platform === 'win32'; // no Windows, npx e firebase são .cmd: precisam de shell, que não protege espaços
const testCmd = `node ${slash(path.join('functions', 'test', 'emulator-test.js'))}`;
const result = spawnSync(firebase[0], [...firebase.slice(1), 'emulators:exec', '--only', 'auth,firestore,functions', '--project', 'demo-aceoma', isWin ? `"${testCmd}"` : testCmd], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: isWin,
});

try { fs.unlinkSync(stubFile); } catch { /* já não existe */ }
if (createdSecrets) { try { fs.unlinkSync(secretsFile); } catch { /* já não existe */ } }
process.exit(result.status === null ? 1 : result.status);
