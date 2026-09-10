import { writeFileSync } from 'fs';

const PROJECT = 'seriebaceoma';
const API_KEY  = 'AIzaSyAp8LdT0n6Sg3cipCeZZPVZdCwoa7eOogg';
const BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const COLLECTIONS = [
  'player_registry',
  'player_titles',
  'championships',
  'financeiro_config',
  'financeiro_mensalidades',
  'financeiro_despesas',
  'financeiro_avulsos',
];

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
  for (const [k, v] of Object.entries(fields)) obj[k] = parseValue(v);
  return obj;
}

async function fetchCollection(col) {
  const docs = [];
  let pageToken = null;
  do {
    const url = `${BASE}/${col}?key=${API_KEY}&pageSize=300${pageToken?`&pageToken=${pageToken}`:''}`;
    const res  = await fetch(url);
    if (!res.ok) { console.warn(`  ⚠ ${col}: HTTP ${res.status}`); break; }
    const data = await res.json();
    if (data.documents) {
      for (const doc of data.documents) {
        const id = doc.name.split('/').pop();
        docs.push({ id, ...parseFields(doc.fields||{}) });
      }
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return docs;
}

const backup = { exportedAt: new Date().toISOString(), collections: {} };

for (const col of COLLECTIONS) {
  process.stdout.write(`  Lendo ${col}... `);
  const docs = await fetchCollection(col);
  backup.collections[col] = docs;
  console.log(`${docs.length} docs`);
}

const filename = `backup_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
writeFileSync(filename, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\n✓ Backup salvo: ${filename}`);
