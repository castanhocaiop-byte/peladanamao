"use strict";

// Rival (item 36): as contas puras do servidor, sem tocar no banco (quem grava é functions/index.js: setRival, saveRivalProgress,
// syncRivals e os ganchos de sair da liga, ser recusado, ligar a outro jogador, apagar a conta e anonimizar o nome).
//
// A escolha do rival fica em leagues/{liga}/rivals/{uid}, que só a própria conta lê e só o servidor grava:
//   { ownKey, rivalKey, since, mutual, lead, duels: { "2026-09": { r, res, m, t } } }
//   - ownKey / rivalKey: chaves do jogador da conta e do rival ("" = sem rival);
//   - since: quando o rival atual foi escolhido (hora do SERVIDOR; é ela que vale para o tempo de rivalidade e para a regra do duelo);
//   - mutual: o servidor marca quando o rival também escolheu esta conta (as duas pessoas ficam sabendo);
//   - lead: quem estava na frente no número de conquistas na última vez ("mine" | "theirs" | "");
//   - duels: o resultado de cada mês já fechado (res: trator, mao, aluno, fora, empate ou none; m = números que a conta levou, t = os que o
//     rival levou). Quem confere o mês é o app (ele tem os campeonatos); o servidor só confere se o formato e as contas fazem sentido.
// O que a liga toda vê fica em leagues/{liga}/rival_public/{chave do jogador}: { awards, alvo, publico, declarada }.
//   - awards: quantas vezes cada badge do rival foi conquistada (AWARD_IDS);
//   - alvo / publico / declarada: calculadas SÓ aqui (computeFlags): "Alvo da Galera" (3 ou mais jogadores escolheram este), "Inimigo
//     Público" (7 ou mais) e "Rivalidade Declarada" (os dois se escolheram). Ninguém vê quem escolheu quem.

// As badges do rival que viram contagem em rival_public/{chave}.awards.
const AWARD_IDS = [
  "duelo_aluno", "duelo_fora_liga", "duelo_mao", "duelo_trator", "duelo_dono", "duelo_sombra",
  "rival_passou", "rival_ultrapassada", "rival_3m", "rival_6m", "rival_12m",
];
// Resultado do duelo do mês -> badge que ele dá.
const RESULT_AWARD = { trator: "duelo_trator", mao: "duelo_mao", aluno: "duelo_aluno", fora: "duelo_fora_liga" };
const WIN = new Set(["mao", "trator"]);   // eu fui melhor que o rival
const LOSE = new Set(["aluno", "fora"]);  // o rival foi melhor que eu
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DUELS_PER_CALL = 12;            // meses que o app manda de uma vez
const KEEP_MONTHS = 24;                   // meses de histórico que o servidor guarda
const STREAK_LENGTH = 3;                  // duelos do mês seguidos (contra o mesmo rival) para Dono do Rival e Sombra do Rival
const ALVO_MIN = 3;                       // jogadores que escolheram o mesmo para ser "Alvo da Galera"
const PUBLICO_MIN = 7;                    // ... para ser "Inimigo Público" (tem de ser pelo menos ALVO_MIN: quem é Inimigo Público também é Alvo da Galera)
const TENURE = [[3, "rival_3m"], [6, "rival_6m"], [12, "rival_12m"]]; // meses com o mesmo rival
const MAX_NUMBERS = 20;                   // teto de números por duelo (o app compara no máximo 10)

const isInt = n => Number.isInteger(n) && n >= 0 && n <= MAX_NUMBERS;
const monthOf = iso => String(iso || "").slice(0, 7);

// O resultado bate com as contas? m = números que levei, t = os que o rival levou (só os que tiveram vencedor). "Todos" = o outro não
// levou nenhum e houve 4 ou mais números decididos; "maioria" = levei mais números que ele (com 3 ou mais decididos); empate = o mesmo tanto
// (com 4 ou mais decididos, já que com menos de 3 o duelo nem vale).
function resultFits(res, m, t) {
  const decided = m + t;
  switch (res) {
    case "none": return m === 0 && t === 0;
    case "trator": return t === 0 && m >= 4;
    case "mao": return m > t && decided >= 3 && !(t === 0 && m >= 4);
    case "aluno": return t > m && decided >= 3 && !(m === 0 && t >= 4);
    case "fora": return m === 0 && t >= 4;
    case "empate": return m === t && decided >= 4;
    default: return false;
  }
}

// Confere o que o app manda: até 12 meses, cada um { month, res, m, t }. Só vale mês JÁ FECHADO (antes do mês de hoje), a partir do
// mês em que o rival atual foi escolhido (`sinceMonth`) e que ainda não esteja no histórico (`known`). O que não serve é ignorado e
// contado em `skipped`; formato errado no todo recusa tudo (ok: false).
function parseDuels(list, { sinceMonth, currentMonth, known }) {
  if (list === undefined || list === null) return { ok: true, accepted: [], skipped: 0 };
  if (!Array.isArray(list)) return { ok: false, reason: "shape" };
  if (list.length > MAX_DUELS_PER_CALL) return { ok: false, reason: "too-many" };
  const accepted = [], seen = new Set();
  let skipped = 0;
  for (const d of list) {
    if (!d || typeof d !== "object" || !MONTH_RE.test(d.month)) return { ok: false, reason: "shape" };
    const none = d.res === "none";
    const m = none ? 0 : d.m, t = none ? 0 : d.t;
    if (!isInt(m) || !isInt(t) || !resultFits(d.res, m, t)) return { ok: false, reason: "result" };
    if (seen.has(d.month) || d.month < sinceMonth || d.month >= currentMonth || (known && Object.prototype.hasOwnProperty.call(known, d.month))) { skipped++; continue; }
    seen.add(d.month);
    accepted.push({ month: d.month, res: d.res, m, t });
  }
  accepted.sort((a, b) => (a.month < b.month ? -1 : 1));
  return { ok: true, accepted, skipped };
}

// Quantos duelos seguidos, terminando em `month`, o mesmo lado (ganhou ou perdeu) contra o mesmo rival, só dentro do rival atual (meses a
// partir de `sinceMonth`). Mês sem duelo válido (none) não conta nem quebra; empate quebra.
function runLength(history, month, sinceMonth) {
  const last = history[month];
  if (!last) return 0;
  const side = WIN.has(last.res) ? WIN : LOSE.has(last.res) ? LOSE : null;
  if (!side) return 0;
  const months = Object.keys(history).filter(k => k <= month && k >= sinceMonth).sort().reverse();
  let run = 0;
  for (const k of months) {
    const e = history[k];
    if (e.res === "none") continue;
    if (e.r !== last.r || !side.has(e.res)) break;
    run++;
  }
  return run;
}

// Junta os meses novos ao histórico (em ordem) e diz o que ganharam: a badge de cada resultado e, a cada 3 duelos seguidos, Dono do Rival
// (vitórias) ou Sombra do Rival (derrotas). Devolve o histórico novo (com no máximo KEEP_MONTHS meses) e os ganhos { idDaBadge: vezes }.
function applyDuels(history, accepted, { rivalKey, sinceMonth }) {
  const next = { ...history };
  const gains = {};
  const add = (id) => { gains[id] = (gains[id] || 0) + 1; };
  for (const d of accepted) {
    next[d.month] = { r: rivalKey, res: d.res, m: d.m, t: d.t };
    if (RESULT_AWARD[d.res]) add(RESULT_AWARD[d.res]);
    const run = runLength(next, d.month, sinceMonth);
    if (run > 0 && run % STREAK_LENGTH === 0) add(WIN.has(d.res) ? "duelo_dono" : "duelo_sombra");
  }
  const kept = Object.keys(next).sort().slice(-KEEP_MONTHS);
  const trimmed = {};
  for (const k of kept) trimmed[k] = next[k];
  return { history: trimmed, gains };
}

// A virada no número de conquistas. `prev` é quem estava na frente da última vez ("" na primeira) e `next` o que o app vê agora
// ("mine", "theirs" ou "tie"). Empate não muda quem estava na frente; só vale virada entre "mine" e "theirs" (a primeira vez só guarda).
function applyLead(prev, next) {
  const before = prev === "mine" || prev === "theirs" ? prev : "";
  if (next !== "mine" && next !== "theirs") return { lead: before, gain: null };
  if (!before) return { lead: next, gain: null };
  if (before === next) return { lead: before, gain: null };
  return { lead: next, gain: next === "mine" ? "rival_passou" : "rival_ultrapassada" };
}

// Meses inteiros entre duas datas (ISO), contados no calendário: de 20/07 a 20/10 são 3.
function monthsBetween(fromIso, toIso) {
  const a = new Date(fromIso), b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  return Math.max(0, months);
}

// As badges do tempo com o mesmo rival (3, 6 e 12 meses) que o `since` já dá.
function tenureAwards(sinceIso, nowIso) {
  if (!sinceIso) return [];
  const months = monthsBetween(sinceIso, nowIso);
  return TENURE.filter(([n]) => months >= n).map(([, id]) => id);
}

// Soma os ganhos às contagens que já existem (as badges de tempo valem uma vez só: `once`).
function mergeAwards(awards, gains, once = []) {
  const out = { ...(awards || {}) };
  for (const [id, n] of Object.entries(gains || {})) if (AWARD_IDS.includes(id)) out[id] = (Number(out[id]) || 0) + n;
  for (const id of once) if (AWARD_IDS.includes(id)) out[id] = Math.max(Number(out[id]) || 0, 1);
  return out;
}

// "Alvo da Galera", "Inimigo Público" e "Rivalidade Declarada", a partir de quem escolheu quem. `rivals`: [{ uid, ownKey, rivalKey }]; `active`: chaves dos
// jogadores ativos do elenco (quem saiu do elenco ou ficou inativo não conta, nem como quem escolhe nem como escolhido). Vários cadastros
// ligados ao mesmo jogador contam como UM jogador.
//   alvo: chaves escolhidas por ALVO_MIN jogadores diferentes ou mais;
//   publico: chaves escolhidas por PUBLICO_MIN jogadores diferentes ou mais (sempre também estão em alvo);
//   declarada: chaves dos dois lados de cada par que se escolheu um ao outro;
//   mutualUids: contas cuja escolha é correspondida (o servidor grava mutual: true nelas).
function computeFlags(rivals, active) {
  const live = rivals.filter(r => r && r.ownKey && r.rivalKey && r.ownKey !== r.rivalKey && active.has(r.ownKey) && active.has(r.rivalKey));
  const choosers = new Map();
  for (const r of live) {
    if (!choosers.has(r.rivalKey)) choosers.set(r.rivalKey, new Set());
    choosers.get(r.rivalKey).add(r.ownKey);
  }
  const alvo = new Set([...choosers].filter(([, who]) => who.size >= ALVO_MIN).map(([key]) => key));
  const publico = new Set([...choosers].filter(([, who]) => who.size >= PUBLICO_MIN).map(([key]) => key));
  const picks = new Set(live.map(r => `${r.ownKey}>${r.rivalKey}`));
  const declarada = new Set(), mutualUids = new Set();
  for (const r of live) {
    if (picks.has(`${r.rivalKey}>${r.ownKey}`)) { declarada.add(r.ownKey); mutualUids.add(r.uid); } // o par espelhado marca o outro lado na sua vez
  }
  return { alvo, publico, declarada, mutualUids };
}

// O jogador mudou de chave (renomear no elenco, anonimizar o nome): as escolhas feitas por ele e as que apontam para ele passam para a
// chave nova, e o histórico de duelos também. Devolve { [uid]: documento novo } só dos que mudaram.
function renameKeys(rivals, from, to) {
  const out = {};
  for (const [uid, d] of rivals) {
    if (!d) continue;
    const hit = d.ownKey === from || d.rivalKey === from || Object.values(d.duels || {}).some(e => e && e.r === from);
    if (!hit) continue;
    const duels = {};
    for (const [k, e] of Object.entries(d.duels || {})) duels[k] = e && e.r === from ? { ...e, r: to } : e;
    out[uid] = { ...d, ownKey: d.ownKey === from ? to : d.ownKey, rivalKey: d.rivalKey === from ? to : d.rivalKey, duels };
  }
  return out;
}

// O cadastro público de um jogador depois da conta: mantém as contagens e põe as marcas (alvo, publico e declarada). `null` = nada a gravar.
// Cadastro antigo, sem o campo publico, vale como "não é Inimigo Público" (nada a reescrever).
function publicDoc(existing, flags) {
  const alvo = flags.alvo === true, publico = flags.publico === true, declarada = flags.declarada === true;
  if (!existing && !alvo && !publico && !declarada) return null;
  if (existing && (existing.alvo === true) === alvo && (existing.publico === true) === publico && (existing.declarada === true) === declarada) return null;
  return { awards: { ...(existing?.awards || {}) }, alvo, publico, declarada };
}

module.exports = {
  AWARD_IDS, RESULT_AWARD, WIN, LOSE, MAX_DUELS_PER_CALL, KEEP_MONTHS, STREAK_LENGTH, ALVO_MIN, PUBLICO_MIN, TENURE,
  monthOf, resultFits, parseDuels, runLength, applyDuels, applyLead, monthsBetween, tenureAwards, mergeAwards, computeFlags, renameKeys, publicDoc,
};
