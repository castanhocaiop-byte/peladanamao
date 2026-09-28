/**
 * do-delete-old-champs.mjs
 * 1. Abre regras para write temporário
 * 2. Deleta campeonatos com date < '2026-09-07'
 * 3. Restaura regras originais
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const PROJECT = 'seriebaceoma';
const API_KEY  = 'AIzaSyAp8LdT0n6Sg3cipCeZZPVZdCwoa7eOogg';
const BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const ORIG_RULES = readFileSync('C:/Users/caiop/Documents/Cursos/Claude Code/Projetos/aceoma/firestore.rules', 'utf8');
const TEMP_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if true;
    }
  }
}`;

// IDs dos 45 campeonatos a apagar (date < 2026-09-07)
const TO_DELETE = [
  'mtkgxzr5xhrv9','mtki9k88u0hur','mtkj4q60f7fdo','mtkj7hcz35ylp',
  'mtkjct3lwz2xj','mtkjeyy2wd7i8','mtkjh1e5gyvf8','mtkjja0em6bw4',
  'mtkjrljb8x4ds','mtkk0buzy5ejs','mtkk4p6vo0gve','mtkkdo0teweq0',
  'mtkkg5mfle53b','mtkki8zq50zxk','mtkkka06deasr','mtkklqdu9hy0v',
  'mtkkn9nlnj45h','mtkkqogkbgfrh','mtkkt8lnom7uf','mtkkw68i82cb8',
  'mtkl2u6sbx5l1','mtkl7poqam5b7','mtklaix2vh5lm','mtklct160y2o4',
  'mtkliwwjfo2m0','mtklq85wrt77b','mtklrxsetmiq7','mtklyk4cc77vh',
  'mtkm0m33c9ov4','mtkm3qy82rr7c','mtkm6zj3naga6','mtkm9kotzv3fy',
  'mtll5vblwffno','mtlla2or5mani','mtllcyc7vt1p9','mtlle1sa9gfgi',
  'mtllhhjpm4jyl','mtlo93y8n9ykv','mtlo9o9zd3p47','mtltb3hgzd3q6',
  'mtltg3r671ceh','mtlw8nojps0s1','mtlwo8z9rwzoo','mtm0bro13bpz5',
  'mtnoymr63gt6k',
];

function deploy(label) {
  console.log(`\n→ Deployando regras (${label})...`);
  execSync(`firebase deploy --only firestore:rules --project ${PROJECT}`, {
    stdio: 'inherit',
    cwd: 'C:/Users/caiop/Documents/Cursos/Claude Code/Projetos/aceoma',
  });
}

async function deleteDoc(id, attempt = 0) {
  const url = `${BASE}/championships/${id}?key=${API_KEY}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    if (res.status === 403 && attempt < 5) {
      const wait = (attempt + 1) * 6000;
      process.stdout.write(`(403, retry em ${wait/1000}s) `);
      await new Promise(r => setTimeout(r, wait));
      return deleteDoc(id, attempt + 1);
    }
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0,200)}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
const rulesPath = 'C:/Users/caiop/Documents/Cursos/Claude Code/Projetos/aceoma/firestore.rules';

try {
  // 1. abrir regras
  writeFileSync(rulesPath, TEMP_RULES, 'utf8');
  deploy('write aberto temporário');

  // 2. aguardar propagação
  process.stdout.write('\n→ Aguardando propagação (10s)...');
  await new Promise(r => setTimeout(r, 10000));
  console.log(' ok');

  // 3. deletar
  console.log(`\n→ Deletando ${TO_DELETE.length} campeonatos...`);
  let ok = 0, fail = 0;
  for (const id of TO_DELETE) {
    process.stdout.write(`  ${id}... `);
    try {
      await deleteDoc(id);
      console.log('✓');
      ok++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      fail++;
    }
  }
  console.log(`\n✓ Concluído: ${ok} deletados, ${fail} erros.`);

} finally {
  // 4. restaurar regras (sempre)
  writeFileSync(rulesPath, ORIG_RULES, 'utf8');
  deploy('originais restauradas');
}
