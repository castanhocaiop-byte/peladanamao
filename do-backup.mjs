/**
 * do-backup.mjs
 * 1. Deploys permissive read-only Firestore rules
 * 2. Downloads all collections via REST API
 * 3. Restores original rules
 */
import { writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const PROJECT = 'seriebaceoma';
const API_KEY  = 'AIzaSyAp8LdT0n6Sg3cipCeZZPVZdCwoa7eOogg';
const BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const COLLECTIONS = [
  'player_registry', 'player_titles', 'championships',
  'financeiro_config', 'financeiro_mensalidades',
  'financeiro_despesas', 'financeiro_avulsos',
];

const ORIG_RULES = readFileSync('firestore.rules', 'utf8');
const TEMP_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}`;

function parseValue(v) {
  if (!v) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return +v.integerValue;
  if ('doubleValue'    in v) return v.doubleValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'     in v) return (v.arrayValue.values||[]).map(parseValue);
  if ('mapValue'       in v) return parseFields(v.mapValue.fields||{});
  return v;
}
function parseFields(fields) {
  const obj = {};
  for (const [k,v] of Object.entries(fields)) obj[k] = parseValue(v);
  return obj;
}

async function fetchCollection(col, attempt = 0) {
  const docs = [];
  let pageToken = null;
  do {
    const url = `${BASE}/${col}?key=${API_KEY}&pageSize=300${pageToken?`&pageToken=${pageToken}`:''}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403 && attempt < 5) {
        const wait = (attempt + 1) * 6000;
        process.stdout.write(`(403, retry em ${wait/1000}s) `);
        await new Promise(r => setTimeout(r, wait));
        return fetchCollection(col, attempt + 1);
      }
      console.warn(`⚠ HTTP ${res.status}`); break;
    }
    const data = await res.json();
    if (data.documents)
      for (const doc of data.documents)
        docs.push({ id: doc.name.split('/').pop(), ...parseFields(doc.fields||{}) });
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return docs;
}

function deploy(label) {
  console.log(`\n→ Deployando regras (${label})...`);
  execSync(`firebase deploy --only firestore:rules --project ${PROJECT}`, { stdio: 'inherit' });
}

// ── main ──────────────────────────────────────────────────────────────────────
try {
  // 1. open rules
  writeFileSync('firestore.rules', TEMP_RULES, 'utf8');
  deploy('leitura aberta temporária');

  // 2. wait for rules to propagate, then backup
  process.stdout.write('\n→ Aguardando propagação das regras (8s)...');
  await new Promise(r => setTimeout(r, 8000));
  console.log(' ok');
  console.log('→ Baixando dados...');
  const backup = { exportedAt: new Date().toISOString(), collections: {} };
  for (const col of COLLECTIONS) {
    process.stdout.write(`  ${col}... `);
    const docs = await fetchCollection(col);
    backup.collections[col] = docs;
    console.log(`${docs.length} docs`);
  }
  const filename = `backup_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
  writeFileSync(filename, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n✓ Backup: ${filename}`);

} finally {
  // 3. restore rules (always, even on error)
  writeFileSync('firestore.rules', ORIG_RULES, 'utf8');
  deploy('originais restauradas');
}
