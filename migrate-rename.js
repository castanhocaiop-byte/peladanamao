// Migração pontual: Henrique N → João Henrique
// Rodar: node migrate-rename.js
// Requer: npm install firebase-admin  +  serviceAccountKey.json na pasta

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const OLD_NAME = 'Henrique N';
const NEW_NAME = 'João Henrique';

async function migrate() {
  const snap = await db.collection('championships').get();
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const patch = {};

    // champion_players
    if (data.champion_players?.some(p => p.name === OLD_NAME)) {
      patch.champion_players = data.champion_players.map(p =>
        p.name === OLD_NAME ? { ...p, name: NEW_NAME } : p
      );
    }

    // teamRosters
    if (data.teamRosters) {
      let changed = false;
      const newRosters = {};
      for (const [team, roster] of Object.entries(data.teamRosters)) {
        if (roster.includes(OLD_NAME)) {
          newRosters[team] = roster.map(n => n === OLD_NAME ? NEW_NAME : n);
          changed = true;
        } else {
          newRosters[team] = roster;
        }
      }
      if (changed) patch.teamRosters = newRosters;
    }

    // matches: goals e finalGoals
    if (data.matches?.length) {
      let matchChanged = false;
      const newMatches = data.matches.map(m => {
        let changed = false;
        const mPatch = {};
        if (m.goals?.some(g => g.player === OLD_NAME)) {
          mPatch.goals = m.goals.map(g => g.player === OLD_NAME ? { ...g, player: NEW_NAME } : g);
          changed = true;
        }
        if (m.finalGoals?.some(g => g.player === OLD_NAME)) {
          mPatch.finalGoals = m.finalGoals.map(g => g.player === OLD_NAME ? { ...g, player: NEW_NAME } : g);
          changed = true;
        }
        if (changed) { matchChanged = true; return { ...m, ...mPatch }; }
        return m;
      });
      if (matchChanged) patch.matches = newMatches;
    }

    if (Object.keys(patch).length) {
      await doc.ref.update(patch);
      console.log(`✅ Atualizado: ${doc.id}`);
      updated++;
    }
  }

  console.log(`\nMigração concluída. ${updated} campeonato(s) atualizado(s).`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
