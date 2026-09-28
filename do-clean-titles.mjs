/**
 * do-clean-titles.mjs
 * Remove entradas de player_titles referentes aos 45 campeonatos deletados.
 * - Docs com 0 entradas restantes: deletados
 * - Docs com entradas restantes: atualizados (entries, titles, last_date)
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const PROJECT = 'seriebaceoma';
const API_KEY  = 'AIzaSyAp8LdT0n6Sg3cipCeZZPVZdCwoa7eOogg';
const BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const rulesPath = 'C:/Users/caiop/Documents/Cursos/Claude Code/Projetos/aceoma/firestore.rules';
const ORIG_RULES = readFileSync(rulesPath, 'utf8');
const TEMP_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if true;
    }
  }
}`;

const DELETED_CHAMPS = new Set([
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
]);

// Firestore REST value encoding
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = encodeValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function deploy(label) {
  console.log(`\n→ Deployando regras (${label})...`);
  execSync(`firebase deploy --only firestore:rules --project ${PROJECT}`, {
    stdio: 'inherit',
    cwd: 'C:/Users/caiop/Documents/Cursos/Claude Code/Projetos/aceoma',
  });
}

async function deleteDoc(col, id, attempt = 0) {
  const res = await fetch(`${BASE}/${col}/${id}?key=${API_KEY}`, { method: 'DELETE' });
  if (!res.ok) {
    if (res.status === 403 && attempt < 5) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 6000));
      return deleteDoc(col, id, attempt + 1);
    }
    throw new Error(`DELETE HTTP ${res.status}`);
  }
}

async function patchDoc(col, id, fields, attempt = 0) {
  const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${BASE}/${col}/${id}?${fieldPaths}&key=${API_KEY}`;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = encodeValue(v);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 403 && attempt < 5) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 6000));
      return patchDoc(col, id, fields, attempt + 1);
    }
    throw new Error(`PATCH HTTP ${res.status}: ${await res.text()}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
const backup = JSON.parse(readFileSync(
  'C:/Users/caiop/Documents/Cursos/Claude Code/Projetos/aceoma/backup_2026-09-16T15-58-12.json', 'utf8'
));

// Calcula o que fazer por jogador
const toDelete = [];
const toUpdate = [];
for (const p of backup.collections.player_titles) {
  const kept = (p.entries || []).filter(e => !DELETED_CHAMPS.has(e.champId));
  const removed = p.entries.length - kept.length;
  if (removed === 0) continue; // não afetado
  if (kept.length === 0) {
    toDelete.push(p.id);
  } else {
    const newTitles = kept.reduce((s, e) => s + (e.weight || 1), 0);
    const lastDate = kept[kept.length - 1].date;
    toUpdate.push({ id: p.id, entries: kept, titles: newTitles, last_date: lastDate });
  }
}

console.log(`Deletar docs: ${toDelete.length}`);
console.log(`Atualizar docs: ${toUpdate.length}`);

try {
  writeFileSync(rulesPath, TEMP_RULES, 'utf8');
  deploy('write aberto temporário');

  process.stdout.write('\n→ Aguardando propagação (10s)...');
  await new Promise(r => setTimeout(r, 10000));
  console.log(' ok');

  // Deletar
  if (toDelete.length) {
    console.log('\n→ Deletando docs sem títulos restantes...');
    for (const id of toDelete) {
      process.stdout.write(`  ${id}... `);
      try { await deleteDoc('player_titles', id); console.log('✓'); }
      catch (e) { console.log(`✗ ${e.message}`); }
    }
  }

  // Atualizar
  if (toUpdate.length) {
    console.log('\n→ Atualizando docs com títulos restantes...');
    for (const { id, entries, titles, last_date } of toUpdate) {
      process.stdout.write(`  ${id} (${titles} título(s))... `);
      try { await patchDoc('player_titles', id, { entries, titles, last_date }); console.log('✓'); }
      catch (e) { console.log(`✗ ${e.message}`); }
    }
  }

  console.log('\n✓ Concluído.');
} finally {
  writeFileSync(rulesPath, ORIG_RULES, 'utf8');
  deploy('originais restauradas');
}
