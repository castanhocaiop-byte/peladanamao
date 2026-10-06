"use strict";
// Recuperar os campeonatos feitos no plano gratuito.
//
// No plano gratuito cada campeonato nasce com freeMode:true: a tela não registra quem fez os gols, o campeão
// é salvo (champion_players) mas NÃO entra em player_titles (o ranking), e as estatísticas, as conquistas e os
// gráficos ignoram o campeonato. "Recuperar" um campeonato, quando a liga passa a ter plano, é:
//   1) somar os títulos dele em player_titles, do mesmo jeito que saveChampion (index.html) faz com os
//      campeonatos do plano pago (titles += peso, uma entrada {date, weight, team, champId} por jogador);
//   2) tirar o freeMode (e anotar recoveredFromFree/recoveredAt, para saber de onde veio).
// Os gols desses jogos não foram registrados no plano gratuito, então não voltam.
//
// Cada campeonato é recuperado numa transação própria: ou os títulos E a marca entram juntos, ou nada
// muda. Repetir a recuperação é seguro (idempotente): um campeonato que já perdeu o freeMode é pulado, e
// um título que já tem a entrada daquele campeonato não é somado de novo. Duas execuções ao mesmo tempo
// (ativação do plano + botão do admin) também não somam em dobro, porque as transações se serializam.

const COMBINING = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

// Mesma regra de nome → chave do index.html e do index.js das funções (o teste confere que os três batem).
const playerKey = name => name.trim().toLowerCase().normalize("NFD")
  .replace(COMBINING, "").replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 80);

// Liga "free" = teste vencido e sem plano pago em vigor. Mesma regra de isLeagueFree() do index.html: liga
// antiga, sem data de teste, nunca é free; teste em andamento também não.
function isLeagueFreeNow(league, now = Date.now()) {
  const l = league || {};
  if (!l.trialEndsAt || new Date(l.trialEndsAt).getTime() >= now) return false; // sem teste (liga antiga) ou teste em andamento
  return !l.subscriptionActiveUntil || new Date(l.subscriptionActiveUntil).getTime() < now;
}

// Quem leva título num campeonato concluído: um item por jogador (nome repetido conta uma vez só).
function champions(champ) {
  if (champ.status !== "completed" || !Array.isArray(champ.champion_players)) return [];
  const items = [], seen = new Set();
  for (const p of champ.champion_players) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    const key = name ? playerKey(name) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const w = Number(p.weight);
    items.push({ key, name, weight: Number.isFinite(w) && w > 0 ? w : 1 }); // sem peso válido vale 1, como o app (cp.weight||1)
  }
  return items;
}

async function recoverOne(db, liga, ref, now) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { state: "skipped" };
    const champ = snap.data();
    if (!champ.freeMode) return { state: "skipped" }; // outra execução já recuperou este
    const items = champions(champ);
    const refs = items.map(it => db.doc(`leagues/${liga}/player_titles/${it.key}`));
    const docs = await Promise.all(refs.map(r => tx.get(r))); // todas as leituras antes de qualquer gravação
    let added = 0;
    items.forEach((it, i) => {
      const d = docs[i].exists ? docs[i].data() : null;
      const entries = Array.isArray(d?.entries) ? d.entries : [];
      if (entries.some(e => e && e.champId === snap.id)) return; // título já somado (execução interrompida antes)
      const date = String(champ.date || "");
      const all = [...entries, { date, weight: it.weight, team: champ.champion ?? null, champId: snap.id }];
      const last_date = all.reduce((ld, e) => (String(e.date || "") > ld ? String(e.date) : ld), "");
      if (d) tx.update(refs[i], { name: it.name, titles: (Number(d.titles) || 0) + it.weight, last_date, entries: all });
      else tx.set(refs[i], { name: it.name, titles: it.weight, last_date, entries: all });
      added++;
    });
    tx.update(ref, { freeMode: false, recoveredFromFree: true, recoveredAt: new Date(now()).toISOString() });
    return { state: "recovered", added };
  });
}

/**
 * Recupera os campeonatos freeMode de uma liga, do mais antigo para o mais novo.
 * @param db        Firestore (Admin SDK)
 * @param liga      id da liga
 * @param budgetMs  depois deste tempo não começa campeonato novo (o resto fica em `remaining`)
 * @returns { found, recovered, skipped, remaining, titleEntries }
 */
async function recoverFreeChampionships({ db, liga, now = () => Date.now(), budgetMs = 8000 }) {
  const snap = await db.collection(`leagues/${liga}/championships`).where("freeMode", "==", true).get();
  const list = snap.docs
    .map(d => ({ ref: d.ref, id: d.id, date: String(d.data().date || "") }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const out = { found: list.length, recovered: 0, skipped: 0, remaining: 0, titleEntries: 0 };
  const started = now();
  for (let i = 0; i < list.length; i++) {
    if (now() - started > budgetMs) { out.remaining = list.length - i; break; }
    const r = await recoverOne(db, liga, list[i].ref, now);
    if (r.state === "recovered") { out.recovered++; out.titleEntries += r.added; } else out.skipped++;
  }
  return out;
}

module.exports = { recoverFreeChampionships, isLeagueFreeNow, playerKey, champions };
