"use strict";
// Estrelas pela média do grupo (item 35). Parte PURA: sem Firestore e sem relógio. Valida as notas que uma pessoa manda,
// conta os votos e diz o que publicar no cadastro de cada jogador. O index.js cuida do banco (ratePlayers, syncStarVotes).
//
// Como fica guardado:
//   leagues/{liga}/star_votes/{uid} = { voterKey, ratings: { [chave do jogador votado]: 1..5 }, updatedAt }
//     uma pessoa (conta) = um documento; só o servidor lê e grava, e cada conta lê apenas o PRÓPRIO (as notas são anônimas:
//     nem o admin da liga consegue ler as dos outros). A chave do documento é o uid, e não a chave do jogador, justamente
//     para o admin não poder vincular a própria conta ao jogador de outra pessoa e ler as notas dela.
//   leagues/{liga}/player_registry/{chave} ganha dois campos, escritos só pelo servidor:
//     starsVotes = quantas pessoas deram nota a este jogador
//     starsAvg   = a média (2 casas), só a partir de MIN_VOTES votos: com menos, a média entregaria a nota de cada um
// Quem decide se a média já VALE para o sorteio é o app (metade do elenco que joga, no mínimo MIN_VOTES): ver neededVotes.

const MIN_VOTES = 3;      // piso de anonimato: com 1 ou 2 votos quem vê a média descobre a nota de cada um
const MAX_KEYS = 200;     // jogadores por chamada
const KEY_RE = /^[\p{L}\p{N}_-]{1,100}$/u; // mesma regra do PLAYER_KEY_RE do index.js

const isStar = n => Number.isInteger(n) && n >= 1 && n <= 5;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Quantos votos um jogador precisa ter para a média valer no sorteio: metade de quem joga (ativo e fora do "só churrasco"), nunca
// menos que MIN_VOTES. O app tem a mesma conta (neededVotes no index.html); o teste confere que as duas batem.
const neededVotes = playingCount => Math.max(MIN_VOTES, Math.ceil((Number(playingCount) || 0) / 2));

// Valida o que a pessoa mandou: { chave do jogador: 1..5 } para dar ou trocar a nota, { chave: null } para tirar a nota.
// Qualquer valor fora disso recusa a chamada inteira. Voto em si mesmo e em jogador que não está no elenco são ignorados (listados em
// `ignored`); tirar a nota de um jogador que já saiu do elenco é permitido (limpa nota velha).
function parseRatings(input, { voterKey, registryKeys }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "shape" };
  const entries = Object.entries(input);
  if (!entries.length) return { ok: false, reason: "empty" };
  if (entries.length > MAX_KEYS) return { ok: false, reason: "too-many" };
  const set = {}, remove = [], ignored = [];
  for (const [key, value] of entries) {
    if (!KEY_RE.test(key)) return { ok: false, reason: "key" };
    if (value !== null && !isStar(value)) return { ok: false, reason: "value" };
    if (key === voterKey) { ignored.push(key); continue; }
    if (value === null) { remove.push(key); continue; }
    if (!registryKeys.has(key)) { ignored.push(key); continue; }
    set[key] = value;
  }
  return { ok: true, set, remove, ignored };
}

// As notas que a pessoa tinha + o que ela mandou agora. Nota de jogador que saiu do elenco, a própria nota dela e valores
// estranhos que tenham ficado no documento somem aqui.
function applyRatings(current, parsed, { voterKey, registryKeys }) {
  const out = {};
  for (const [key, value] of Object.entries(current && typeof current === "object" ? current : {})) {
    if (key !== voterKey && registryKeys.has(key) && isStar(value)) out[key] = value;
  }
  for (const key of parsed.remove) delete out[key];
  for (const [key, value] of Object.entries(parsed.set)) out[key] = value;
  return out;
}

// Soma e contagem de votos por jogador. `voterDocs` = [{ uid, voterKey, ratings, updatedAt }]. Duas contas ligadas ao mesmo jogador
// valem UM voto só (fica a mais recente). Voto de quem saiu do elenco, em si mesmo, em jogador que saiu ou com nota fora de 1 a 5
// não conta.
function tally(voterDocs, registryKeys) {
  const latest = new Map();
  for (const doc of voterDocs) {
    if (!doc || typeof doc.voterKey !== "string" || !registryKeys.has(doc.voterKey)) continue;
    const prev = latest.get(doc.voterKey);
    const when = String(doc.updatedAt || ""), prevWhen = prev ? String(prev.updatedAt || "") : "";
    if (!prev || when > prevWhen || (when === prevWhen && String(doc.uid) > String(prev.uid))) latest.set(doc.voterKey, doc);
  }
  const totals = new Map();
  for (const doc of latest.values()) {
    const ratings = doc.ratings && typeof doc.ratings === "object" ? doc.ratings : {};
    for (const [key, value] of Object.entries(ratings)) {
      if (key === doc.voterKey || !registryKeys.has(key) || !isStar(value)) continue;
      const t = totals.get(key) || { sum: 0, count: 0 };
      t.sum += value;
      t.count++;
      totals.set(key, t);
    }
  }
  return totals;
}

// O que cada cadastro deve mostrar: starsVotes (se há voto) e starsAvg (a partir de MIN_VOTES). null = apagar o campo.
const desired = totals => ({
  starsVotes: totals && totals.count > 0 ? totals.count : null,
  starsAvg: totals && totals.count >= MIN_VOTES ? Math.round((totals.sum / totals.count) * 100) / 100 : null,
});

// Só o que PRECISA mudar: { chave: { starsVotes?, starsAvg? } }, comparando com o que o cadastro já tem. `registry` = Map chave → dados.
function publishPatches(registry, voterDocs) {
  const totals = tally(voterDocs, new Set(registry.keys()));
  const patches = new Map();
  for (const [key, data] of registry) {
    const want = desired(totals.get(key));
    const patch = {};
    for (const field of ["starsVotes", "starsAvg"]) {
      const now = data && data[field] !== undefined ? data[field] : null;
      if (now !== want[field]) patch[field] = want[field];
    }
    if (Object.keys(patch).length) patches.set(key, patch);
  }
  return patches;
}

// O jogador mudou de chave (renomear no elenco, anonimizar): as notas dadas POR ele e as notas dadas A ele passam para a chave nova.
// `voters` = Map uid → documento. Devolve { uid: documento novo } só dos que mudaram.
function renameKey(voters, from, to) {
  const out = {};
  for (const [uid, doc] of voters) {
    if (!doc || typeof doc !== "object") continue;
    const ratings = doc.ratings && typeof doc.ratings === "object" ? { ...doc.ratings } : {};
    let changed = false;
    const voterKey = doc.voterKey === from ? to : doc.voterKey;
    if (voterKey !== doc.voterKey) changed = true;
    if (has(ratings, from)) {
      const value = ratings[from];
      delete ratings[from];
      if (voterKey !== to && !has(ratings, to)) ratings[to] = value; // ninguém dá nota a si mesmo
      changed = true;
    }
    if (changed) out[uid] = { ...doc, voterKey, ratings };
  }
  return out;
}

module.exports = { MIN_VOTES, MAX_KEYS, neededVotes, parseRatings, applyRatings, tally, publishPatches, renameKey, isStar };
