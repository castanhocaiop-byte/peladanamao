// Migração para arquitetura multi-tenant: copia tudo para /leagues/aceoma/
// Rodar: node migrate-multitenant.js
// Requer: serviceAccountKey.json na pasta (já existente no projeto)
// Os dados originais NÃO são deletados — dá pra reverter até o app novo ser verificado.

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LEAGUE_ID = 'aceoma';
const LEAGUE_NAME = 'Série B Aceoma';
const BACKUP_DIR = path.join(__dirname, `backup_multitenant_${new Date().toISOString().replace(/[:.]/g,'-')}`);

const LEAGUE_COLLECTIONS = [
  'championships',
  'player_titles',
  'player_registry',
  'financeiro_config',
  'financeiro_mensalidades',
  'financeiro_despesas',
  'financeiro_avulsos',
  'app_config',
  'link_requests',
  'invite_tokens',
];

async function backup() {
  console.log('📦 Fazendo backup...');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  for (const colName of LEAGUE_COLLECTIONS) {
    const snap = await db.collection(colName).get();
    const docs = {};
    snap.forEach(d => { docs[d.id] = d.data(); });
    fs.writeFileSync(path.join(BACKUP_DIR, `${colName}.json`), JSON.stringify(docs, null, 2));
    console.log(`  ✓ ${colName}: ${snap.size} doc(s)`);
  }

  const usersSnap = await db.collection('users').get();
  const users = {};
  usersSnap.forEach(d => { users[d.id] = d.data(); });
  fs.writeFileSync(path.join(BACKUP_DIR, 'users.json'), JSON.stringify(users, null, 2));
  console.log(`  ✓ users: ${usersSnap.size} doc(s)`);

  console.log(`\n✅ Backup salvo em: ${BACKUP_DIR}\n`);
}

async function writeBatched(refs, dataFn) {
  let batch = db.batch();
  let count = 0;
  let total = 0;
  for (const item of refs) {
    batch.set(item.ref, item.data, item.opts || {});
    count++; total++;
    if (count === 499) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  return total;
}

async function updateBatched(updates) {
  let batch = db.batch();
  let count = 0;
  let total = 0;
  for (const { ref, data } of updates) {
    batch.update(ref, data);
    count++; total++;
    if (count === 499) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  return total;
}

async function migrate() {
  console.log(`🚀 Migrando para /leagues/${LEAGUE_ID}/...\n`);

  // 1. Cria documento da liga
  const adminSnap = await db.collection('users').where('role', '==', 'admin').limit(1).get();
  const ownerId = adminSnap.empty ? '' : adminSnap.docs[0].id;

  await db.doc(`leagues/${LEAGUE_ID}`).set({
    name: LEAGUE_NAME,
    slug: LEAGUE_ID,
    ownerId,
    plan: 'starter',
    createdAt: new Date().toISOString(),
    settings: {},
  }, { merge: true });
  console.log(`  ✓ Documento /leagues/${LEAGUE_ID} criado (ownerId: ${ownerId || 'não encontrado'})`);

  // 2. Copia cada coleção para a subcoleção da liga
  for (const colName of LEAGUE_COLLECTIONS) {
    const snap = await db.collection(colName).get();
    if (snap.empty) { console.log(`  - ${colName}: vazio`); continue; }

    const items = snap.docs.map(d => ({
      ref: db.doc(`leagues/${LEAGUE_ID}/${colName}/${d.id}`),
      data: d.data(),
    }));
    const total = await writeBatched(items);
    console.log(`  ✓ ${colName}: ${total} doc(s) copiados`);
  }

  // 3. Adiciona leagues.aceoma a cada usuário
  const usersSnap = await db.collection('users').get();
  const userUpdates = [];

  for (const userDoc of usersSnap.docs) {
    const d = userDoc.data();
    const role = d.role || 'pending';
    if (!['admin', 'player', 'pending'].includes(role)) continue;

    const entry = {
      role,
      joinedAt: d.createdAt || new Date().toISOString(),
    };
    if (d.playerKey) entry.playerKey = d.playerKey;

    userUpdates.push({
      ref: userDoc.ref,
      data: { [`leagues.${LEAGUE_ID}`]: entry },
    });
  }

  const updated = await updateBatched(userUpdates);
  console.log(`  ✓ users: ${updated} usuário(s) atualizados com leagues.${LEAGUE_ID}`);

  console.log(`
✅ Migração concluída!
   Os dados ORIGINAIS nas coleções raiz ainda existem — não foram alterados.
   Após verificar que o novo app funciona, você pode deletá-los.

Próximos passos:
  1. firebase deploy --only firestore:rules
  2. Faça o deploy do index.html atualizado no Vercel
  3. Teste o app
  4. (Depois, quando tudo estiver OK) Delete as coleções raiz antigas
`);
}

async function main() {
  try {
    await backup();
    await migrate();
  } catch (err) {
    console.error('\n❌ Erro:', err.message || err);
    process.exit(1);
  }
}

main();
