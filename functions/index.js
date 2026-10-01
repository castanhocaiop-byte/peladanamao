const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { v1: firestoreAdminV1 } = require("@google-cloud/firestore");
const { MercadoPagoConfig, PreApproval, Preference, Payment, WebhookSignatureValidator } = require("mercadopago");
// FieldValue e FieldPath vêm do módulo moderno: no emulador, "admin.firestore" perde as propriedades estáticas.
const { FieldValue, FieldPath } = require("firebase-admin/firestore");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

// Prazo da votação de destaques, em dias. Manter igual ao VOTE_DAYS do index.html.
const VOTE_DAYS = 3;

// ── helpers ──────────────────────────────────────────────────────────────────

const playerKey = name => name.trim().toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 80);

// Usuários ATIVOS (papel diferente de "pending") de UMA liga — filtrado já na consulta pelo
// campo `leagues.<liga>.role`, que o Firestore indexa sozinho (mesma técnica de listMembers).
// Sem isso, cada notificação leria a coleção "users" inteira — de TODAS as ligas — só para
// achar os poucos usuários da liga que disparou o evento; o custo cresceria com o tamanho do
// sistema inteiro, não desta liga, ficando cada vez mais lento e caro a cada liga nova.
async function activeLeagueUserDocs(leagueId) {
  return (await db.collection("users").where(new FieldPath("leagues", leagueId, "role"), "!=", "pending").get()).docs;
}

async function getLeagueTokens(leagueId, excludeUids = []) {
  const docs = await activeLeagueUserDocs(leagueId);
  const tokens = [];
  docs.forEach(doc => {
    if (excludeUids.includes(doc.id)) return;
    tokens.push(...(doc.data().fcmTokens || []));
  });
  return [...new Set(tokens)]; // deduplicate
}

// Quem tem vínculo com algum dos jogadores (por playerKey) e participa da liga
async function getPlayerTokens(leagueId, playerNames) {
  const keys = new Set(playerNames.map(playerKey));
  const snap = await db.collection("users").where(new FieldPath("leagues", leagueId, "role"), "in", ["admin", "player"]).get();
  const tokens = [];
  snap.forEach(doc => {
    const data = doc.data();
    const linked = [data?.leagues?.[leagueId]?.playerKey, data?.playerKey];
    if (linked.some(k => k && keys.has(k))) tokens.push(...(data.fcmTokens || []));
  });
  return [...new Set(tokens)];
}

// Remove dos usuários os tokens que o FCM informou estar mortos
async function pruneTokens(tokens) {
  for (const token of tokens) {
    try {
      const snap = await db.collection("users").where("fcmTokens", "array-contains", token).get();
      await Promise.all(snap.docs.map(d =>
        d.ref.update({ fcmTokens: FieldValue.arrayRemove(token) })
      ));
    } catch (e) { console.warn("prune token falhou:", e.message); }
  }
}

// `tag` identifica o evento: envios repetidos do mesmo evento (mais de um token
// no mesmo aparelho, reentrega do gatilho) substituem a notificação anterior
// em vez de empilhar.
async function sendToTokens(tokens, notification, data = {}, tag = "") {
  if (!tokens.length) return;
  const invalid = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification,
      data: tag ? { ...data, tag } : data,
      webpush: {
        notification: {
          icon: "https://aceoma.vercel.app/icon-192.png",
          badge: "https://aceoma.vercel.app/icon-192.png",
          ...(tag ? { tag } : {})
        },
        fcmOptions: { link: "https://aceoma.vercel.app/" }
      }
    });
    res.responses.forEach((r, idx) => {
      const code = r.error?.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        invalid.push(chunk[idx]);
      }
    });
    console.log(`push "${notification.title}": ${res.successCount} enviadas, ${res.failureCount} falhas`);
  }
  if (invalid.length) await pruneTokens(invalid);
}

// ── 1. Convocação e resultado do campeonato ───────────────────────────────────

exports.onChampionshipChange = onDocumentWritten(
  "leagues/{leagueId}/championships/{champId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return; // deletado

    const { leagueId, champId } = event.params;
    const statusBefore = before?.status;
    const statusAfter  = after.status;
    console.log(`championship ${champId} in ${leagueId}: ${statusBefore} → ${statusAfter}`);

    // Convocação aberta
    if (statusBefore !== "preset" && statusAfter === "preset") {
      const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
      const leagueName = leagueSnap.data()?.name || "Aceoma";
      const dateStr = after.date
        ? new Date(after.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
        : "";
      const hasChurrasco = after.churrasco;
      const body = dateStr
        ? `${dateStr}${hasChurrasco ? " 🍖 com churrasco" : ""}. Confirme sua presença!`
        : "Confirme sua presença!";

      const tokens = await getLeagueTokens(leagueId);
      await sendToTokens(tokens, { title: `📋 Convocação — ${leagueName}`, body }, { leagueId, view: "eu" }, `convocacao-${champId}`);
      return;
    }

    // Campeonato finalizado
    if (statusBefore !== "completed" && statusAfter === "completed") {
      const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
      const leagueName = leagueSnap.data()?.name || "Aceoma";
      const champion = after.champion || "";
      const teamColors = { azul: "Azul", amarelo: "Amarelo", vermelho: "Vermelho", verde: "Verde", laranja: "Laranja", preto: "Preto", roxo: "Roxo", cinza: "Cinza", rosa: "Rosa", branco: "Branco" };
      const champName = teamColors[champion] || champion;
      const body = champName ? `Time ${champName} é campeão! 🏆` : "Campeonato encerrado!";

      const tokens = await getLeagueTokens(leagueId);
      await sendToTokens(tokens, { title: `🏆 Resultado — ${leagueName}`, body }, { leagueId, view: "history" }, `resultado-${champId}`);
    }

    // Votação de destaques aberta (ao finalizar, ou quando o admin abre depois), ou
    // aviso reenviado pelo admin (voting.notifyAt mudou). Só quem estava no elenco
    // pode votar, então só eles são avisados.
    const votingOpened = !before?.voting && !!after.voting;
    const votingResend = !!after.voting?.notifyAt && after.voting.notifyAt !== before?.voting?.notifyAt;
    if (votingOpened || votingResend) {
      const openedMs = Date.parse(after.voting.openedAt);
      const deadlineMs = (Number.isNaN(openedMs) ? Date.now() : openedMs) + VOTE_DAYS * 86400000;
      // reenvio não faz sentido com a votação já encerrada
      if (!votingOpened && (after.voting.closedAt || Date.now() > deadlineMs)) return;

      const roster = [...new Set(Object.values(after.teamRosters || {}).flat())];
      const tokens = await getPlayerTokens(leagueId, roster);
      if (!tokens.length) return;

      const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
      const leagueName = leagueSnap.data()?.name || "Aceoma";
      const cats = [after.voting.pos ? "na Bola Cheia" : "", after.voting.neg ? "na Bola Murcha" : ""]
        .filter(Boolean).join(" e ");
      const deadline = new Date(deadlineMs).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
      const dateStr = after.date ? `${after.date.slice(8, 10)}/${after.date.slice(5, 7)}` : "";
      const body = votingOpened
        ? `${dateStr ? `Campeonato de ${dateStr}: ` : ""}vote ${cats}. Vale até ${deadline}.`
        : `Lembrete: ${dateStr ? `campeonato de ${dateStr} — ` : ""}vote ${cats}. Vale até ${deadline}.`;

      await sendToTokens(tokens, { title: `🗳️ Votação aberta — ${leagueName}`, body }, { leagueId, view: "eu" }, `votacao-${champId}`);
    }
  }
);

// ── 1b. Impõe o plano free: campeonatos freeMode não podem ter dados de gol ────
// Rede de segurança do lado do servidor. A tela já esconde o campo de gols para
// campeonatos freeMode, mas isso sozinho não impede alguém de escrever esses
// campos direto no Firestore (ex.: pelo DevTools). Roda depois de qualquer
// escrita em um campeonato freeMode e apaga goals/finalGoals/participants de
// qualquer partida que os tenha; se nada mudar, não reescreve (evita loop).
exports.enforceFreeModeNoGoals = onDocumentWritten(
  "leagues/{leagueId}/championships/{champId}",
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data();
    if (!data.freeMode || !Array.isArray(data.matches)) return;

    let changed = false;
    const cleaned = data.matches.map(m => {
      const hasGoalData = m.goals?.length || m.finalGoals?.length || m.participants?.length;
      if (!hasGoalData) return m;
      changed = true;
      const { goals, finalGoals, participants, ...rest } = m;
      return rest;
    });
    if (changed) {
      await after.ref.update({ matches: cleaned });
      logger.warn(`Removidos dados de gol de campeonato freeMode ${event.params.champId} na liga ${event.params.leagueId}`);
    }
  }
);

// ── 2. Nova cobrança avulsa ───────────────────────────────────────────────────
// Dispara quando uma nova cobrança é adicionada em financeiro_avulsos

exports.onAvulsoCreated = onDocumentWritten(
  "leagues/{leagueId}/financeiro_avulsos/{docId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (before || !after) return; // só na criação

    const { leagueId, docId } = event.params;
    const playerName = after.nome || "";
    const valor = after.valor != null ? `R$${Number(after.valor).toFixed(2).replace(".", ",")}` : "";

    // Comparava com "data?.name", campo que não existe em nenhum documento de usuário (o app
    // grava "displayName", não "name") — a notificação nunca era enviada a ninguém. A
    // identificação certa é pela chave do jogador vinculado, igual ao lembrete de mensalidade.
    const targetKey = playerKey(playerName);
    const docs = await activeLeagueUserDocs(leagueId);
    const tokens = [];
    docs.forEach(doc => {
      const data = doc.data();
      const docKey = data?.playerKey || data?.leagues?.[leagueId]?.playerKey;
      if (docKey === targetKey) tokens.push(...(data.fcmTokens || []));
    });

    if (!tokens.length) return;
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    const leagueName = leagueSnap.data()?.name || "Aceoma";
    const body = valor ? `Cobrança de ${valor} gerada.` : "Nova cobrança gerada.";

    await sendToTokens([...new Set(tokens)], { title: `💰 ${leagueName}`, body }, { leagueId, view: "financeiro" }, `avulso-${docId}`);
  }
);

// ── 3. Lembrete de mensalidade em atraso ─────────────────────────────────────
// Admin dispara pelo app; o doc em mensalidade_lembretes/{docId} contém
// { players: string[], month: 'YYYY-MM', mesLabel: string, valor: number }

exports.onMensalidadeLembrete = onDocumentWritten(
  "leagues/{leagueId}/mensalidade_lembretes/{docId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (before || !after) return; // só na criação

    const { leagueId, docId } = event.params;
    const { players = [], mesLabel = "", valor, pixKey = "" } = after;
    if (!players.length) return;

    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    const leagueName = leagueSnap.data()?.name || "Aceoma";
    const valFmt = valor ? `R$${Number(valor).toFixed(2).replace(".", ",")}` : "";
    const pixLine = pixKey ? `\n🔑 Chave PIX: ${pixKey}` : "";

    const docs = await activeLeagueUserDocs(leagueId);
    const notified = new Set();

    for (const playerName of players) {
      const key = playerKey(playerName);
      const tokens = [];
      docs.forEach(doc => {
        const data = doc.data();
        const docKey = data?.playerKey || data?.leagues?.[leagueId]?.playerKey;
        if (docKey === key) (data.fcmTokens || []).forEach(t => tokens.push(t));
      });
      const unique = tokens.filter(t => !notified.has(t));
      if (!unique.length) continue;
      unique.forEach(t => notified.add(t));
      const body = `Sua mensalidade do Futebol ${leagueName} de ${mesLabel} está em atraso.${valFmt ? `\n\n💰 Valor: ${valFmt}` : ""}${pixLine}`;
      await sendToTokens(unique, { title: `⚽ Olá, ${playerName}!`, body }, { leagueId, view: "financeiro" }, `lembrete-${docId}-${key}`);
    }

    // Remove o doc de requisição após processar
    await event.data.after.ref.delete();
  }
);

// ── 4. Nova badge conquistada ─────────────────────────────────────────────────
// O app grava { leagueId, newBadges: [...] } em users/{uid}/badgeNotifs/{push}

exports.onBadgeEarned = onDocumentWritten(
  "users/{uid}/badgeNotifs/{pushId}",
  async (event) => {
    if (!event.data?.after?.exists) return; // deletado

    const { uid } = event.params;
    const data = event.data.after.data();
    const { leagueId, newBadges } = data || {};
    if (!leagueId || !newBadges?.length) return;

    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data();
    const tokens = userData?.fcmTokens || [];
    if (!tokens.length) return;

    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    const leagueName = leagueSnap.data()?.name || "Aceoma";

    const label = newBadges.length === 1
      ? `"${newBadges[0].label}"`
      : `${newBadges.length} novas conquistas`;
    const body = `Você desbloqueou ${label}!`;

    await sendToTokens([...new Set(tokens)], { title: `🏅 ${leagueName}`, body }, { leagueId, view: "eu" }, `badge-${event.params.pushId}`);

    // Remove o doc de notificação após processar
    await event.data.after.ref.delete();
  }
);

// ── 5. Apagar a foto no Cloudinary quando o documento é removido ─────────────
//
// player_photos/{photoKey} guarda só o endereço da imagem; o arquivo em si mora no
// Cloudinary. Sempre que o documento é apagado — pelo admin, pelo próprio jogador,
// pela anonimização de nome ou pela exclusão de conta — este gatilho tenta apagar
// também o arquivo, para que a foto não continue guardada sem necessidade.
//
// Exige as chaves do Cloudinary (Configurações → Security, no painel do Cloudinary),
// configuradas com:
//   firebase functions:secrets:set CLOUDINARY_API_KEY
//   firebase functions:secrets:set CLOUDINARY_API_SECRET
// Os valores nunca passam pelo código nem pelo chat: o comando pede a chave por um
// campo escondido. Enquanto não forem configuradas, o documento é apagado
// normalmente e só o arquivo continua no Cloudinary (comportamento atual).
const CLOUDINARY_CLOUD = "fwtyio7l"; // mesmo "cloud name" já usado nas regras de player_photos
const CLOUDINARY_API_KEY = defineSecret("CLOUDINARY_API_KEY");
const CLOUDINARY_API_SECRET = defineSecret("CLOUDINARY_API_SECRET");

// E-mails transacionais (aviso de liga abandonada) via Resend, com o domínio
// notificacoes.peladanamao.com.br verificado lá. Configurada com:
//   firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM = "Pelada na Mão <avisos@notificacoes.peladanamao.com.br>";

// Pagamento via Mercado Pago (pessoa física). MERCADOPAGO_ACCESS_TOKEN autentica as
// chamadas à API; MERCADOPAGO_WEBHOOK_SECRET confere a assinatura das notificações (só
// existe depois de cadastrar a URL do webhook em Suas integrações → Notificações →
// Webhooks no painel do Mercado Pago, que só existe depois do primeiro deploy — por isso
// nasce com o valor-marcador abaixo, igual às chaves do Cloudinary). Configuradas com:
//   firebase functions:secrets:set MERCADOPAGO_ACCESS_TOKEN
//   firebase functions:secrets:set MERCADOPAGO_WEBHOOK_SECRET
const MERCADOPAGO_ACCESS_TOKEN = defineSecret("MERCADOPAGO_ACCESS_TOKEN");
const MERCADOPAGO_WEBHOOK_SECRET = defineSecret("MERCADOPAGO_WEBHOOK_SECRET");
// A URL configurada em Suas integrações → Notificações não cobre pagamentos criados via
// Preference (confirmado em teste: o pagamento veio com notification_url null e o Mercado
// Pago nunca tentou entregar nada) — por isso cada criação informa a URL explicitamente.
const MERCADOPAGO_WEBHOOK_URL = "https://us-east1-seriebaceoma.cloudfunctions.net/mercadoPagoWebhook";
const MERCADOPAGO_WEBHOOK_NOT_CONFIGURED = "PENDENTE_CONFIGURAR";
const MP_PLANS = {
  monthly: { amount: 29.9, label: "Assinatura mensal" },
  annual: { amount: 238.8, label: "Assinatura anual" },
};

// Extrai o public_id (com eventual pasta, sem extensão) de uma URL de entrega do
// Cloudinary. Ex.: ".../image/upload/v123/aceoma/abc123.jpg" → "aceoma/abc123".
function cloudinaryPublicId(url) {
  const m = String(url || "").match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  return m ? m[1] : "";
}

// O Firebase exige que um secret já EXISTA no Secret Manager no momento do deploy da função
// que o usa. Por isso os dois segredos nascem com este valor-marcador (nunca uma chave de
// verdade) só para o deploy não travar antes de o admin configurar as chaves reais com
// "firebase functions:secrets:set". Enquanto o valor for este marcador, a exclusão do
// arquivo é pulada (mesmo comportamento de "ainda não configurado").
const CLOUDINARY_NOT_CONFIGURED = "PENDENTE_CONFIGURAR";

async function deleteCloudinaryAsset(url) {
  const publicId = cloudinaryPublicId(url);
  if (!publicId) return;
  let apiKey = "", apiSecret = "";
  try { apiKey = CLOUDINARY_API_KEY.value(); apiSecret = CLOUDINARY_API_SECRET.value(); } catch (_) { /* não configuradas ainda */ }
  if (!apiKey || !apiSecret || apiKey === CLOUDINARY_NOT_CONFIGURED || apiSecret === CLOUDINARY_NOT_CONFIGURED) return;

  const timestamp = Math.floor(Date.now() / 1000);
  // Assinatura do Cloudinary: SHA-1 hex de "param=valor&param=valor" (ordem alfabética,
  // sem api_key) com o api_secret colado no fim, sem separador.
  const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest("hex");
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: apiKey, signature });
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/destroy`, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (json.result !== "ok" && json.result !== "not found") {
      logger.warn("Cloudinary destroy não confirmou a exclusão do arquivo", { result: json.result });
    }
  } catch (e) {
    logger.warn("Falha ao pedir ao Cloudinary para apagar o arquivo", { message: e?.message });
  }
}

exports.onPlayerPhotoDeleted = onDocumentWritten(
  { document: "leagues/{leagueId}/player_photos/{photoKey}", secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET] },
  async (event) => {
    const before = event.data?.before?.data();
    if (event.data?.after?.exists || !before?.url) return; // só quando o documento é apagado
    await deleteCloudinaryAsset(before.url);
  }
);

// ── Operações de membros (chamadas pelo app) ─────────────────────────────────
//
// Tudo que muda o vínculo de alguém com uma liga (papel, jogador vinculado,
// entrada por convite, criação e saída de liga) passa por aqui. As regras do
// Firestore não deixam mais o app gravar esses campos direto: o usuário só edita
// os campos de notificação do próprio documento. Assim ninguém consegue se
// promover a admin nem "gastar" convites que não são dele.

const OWNER_EMAIL = "castanho.caiop@gmail.com";
const CALLABLE = { region: "us-east1", maxInstances: 10 };
const MAX_OWNED_LEAGUES = 10;

const LEAGUE_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;   // ligas existentes (aceita ids antigos)
const NEW_SLUG_RE = /^[a-z0-9-]{2,50}$/;        // ligas novas
const TOKEN_RE = /^[A-Za-z0-9_-]{6,100}$/;
const PLAYER_KEY_RE = /^[\p{L}\p{N}_-]{1,100}$/u;  // id do jogador no elenco (aceita ids antigos, sem "/" nem espaço)

const fail = (code, message) => new HttpsError(code, message);

function requireAuth(request) {
  if (!request.auth) throw fail("unauthenticated", "Entre na sua conta para continuar.");
  return request.auth;
}

// Limite simples de chamadas por usuário numa janela de tempo, para funções
// mais expostas a abuso (tentativas repetidas de adivinhar token, spam de
// ações administrativas). Não usa transação — uma pequena imprecisão na
// contagem é aceitável, o objetivo é só cortar rajadas óbvias.
async function checkRateLimit(uid, action, maxCalls, windowMs = 60000) {
  const ref = db.doc(`rate_limits/${uid}_${action}`);
  const snap = await ref.get();
  const now = Date.now();
  const data = snap.exists ? snap.data() : null;
  if (!data || now - data.windowStart > windowMs) {
    await ref.set({ count: 1, windowStart: now });
    return;
  }
  if (data.count >= maxCalls) {
    throw fail("resource-exhausted", "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.");
  }
  await ref.update({ count: FieldValue.increment(1) });
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Identificadores nunca são cortados em silêncio: passou do limite, vira vazio (e é recusado).
const idText = (v, max) => (typeof v === "string" && v.trim().length <= max ? v.trim() : "");

function leagueIdOf(data) {
  const id = idText(data?.liga, 60);
  if (!LEAGUE_ID_RE.test(id)) throw fail("invalid-argument", "Liga inválida.");
  return id;
}

// O dono do sistema precisa ter e-mail verificado (conta Google); um cadastro
// por e-mail e senha com o mesmo endereço não vale.
const isOwner = auth => auth.token?.email === OWNER_EMAIL && auth.token?.email_verified === true;

async function requireLeagueAdmin(auth, liga) {
  if (isOwner(auth)) return;
  const snap = await db.doc(`users/${auth.uid}`).get();
  if (snap.data()?.leagues?.[liga]?.role !== "admin") {
    throw fail("permission-denied", "Somente administradores da liga podem fazer isso.");
  }
}

const newUserDoc = (auth, now, leagues = {}) => ({
  email: auth.token?.email || "",
  displayName: auth.token?.name || "",
  role: "pending",
  createdAt: now,
  leagues,
});

// Entrar numa liga com um convite. Só o servidor lê e consome o convite.
exports.joinLeague = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  await checkRateLimit(auth.uid, "joinLeague", 10);
  const liga = leagueIdOf(request.data);
  const token = idText(request.data?.token, 100);
  if (!TOKEN_RE.test(token)) throw fail("invalid-argument", "Link de convite inválido.");

  const userRef = db.doc(`users/${auth.uid}`);
  const tokenRef = db.doc(`leagues/${liga}/invite_tokens/${token}`);
  const now = new Date().toISOString();

  const role = await db.runTransaction(async tx => {
    const [userSnap, tokenSnap] = await Promise.all([tx.get(userRef), tx.get(tokenRef)]);
    const current = userSnap.data()?.leagues?.[liga];
    if (current) return current.role || "player"; // já participa: não gasta o convite
    const invite = tokenSnap.data();
    if (!tokenSnap.exists || invite.used) throw fail("failed-precondition", "Convite inválido ou já utilizado.");
    const entryRole = ["player", "pending", "admin"].includes(invite.role) ? invite.role : "player";
    const entry = { role: entryRole, joinedAt: now };
    tx.update(tokenRef, { used: true, usedBy: auth.uid, usedAt: now });
    if (userSnap.exists) tx.update(userRef, new FieldPath("leagues", liga), entry);
    else tx.set(userRef, newUserDoc(auth, now, { [liga]: entry }));
    return entryRole;
  });
  return { role };
});

// Criar uma liga nova; quem cria vira admin dela.
exports.createLeague = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const name = text(request.data?.name, 80);
  const slug = idText(request.data?.slug, 60);
  if (!name) throw fail("invalid-argument", "Informe o nome da liga.");
  if (!NEW_SLUG_RE.test(slug)) {
    throw fail("invalid-argument", "ID inválido: use apenas letras minúsculas, números e hífens (2 a 50 caracteres).");
  }

  if (!isOwner(auth)) {
    const owned = await db.collection("leagues").where("ownerId", "==", auth.uid).limit(MAX_OWNED_LEAGUES).get();
    if (owned.size >= MAX_OWNED_LEAGUES) {
      throw fail("resource-exhausted", `Você já criou ${MAX_OWNED_LEAGUES} ligas. Fale com o suporte para criar mais.`);
    }
  }

  const leagueRef = db.doc(`leagues/${slug}`);
  const userRef = db.doc(`users/${auth.uid}`);
  const now = new Date().toISOString();
  const trialEndsAt = new Date(Date.now() + 30 * 86400000).toISOString();

  await db.runTransaction(async tx => {
    const [leagueSnap, userSnap] = await Promise.all([tx.get(leagueRef), tx.get(userRef)]);
    if (leagueSnap.exists) throw fail("already-exists", "Esse ID já está em uso.");
    const entry = { role: "admin", joinedAt: now };
    tx.set(leagueRef, { name, slug, ownerId: auth.uid, plan: "trial", trialEndsAt, createdAt: now, settings: {} });
    if (userSnap.exists) tx.update(userRef, new FieldPath("leagues", slug), entry);
    else tx.set(userRef, newUserDoc(auth, now, { [slug]: entry }));
  });
  return { slug };
});

// Sair de uma liga (o usuário só mexe no próprio vínculo).
exports.leaveLeague = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const userRef = db.doc(`users/${auth.uid}`);
  const snap = await userRef.get();
  if (snap.data()?.leagues?.[liga]) await userRef.update(new FieldPath("leagues", liga), FieldValue.delete());
  return { ok: true };
});

// Ações do admin sobre os membros da liga: aprovar, rejeitar, promover,
// vincular a um jogador e responder pedidos de vínculo.
exports.manageMember = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  await checkRateLimit(auth.uid, "manageMember", 60);
  const liga = leagueIdOf(request.data);
  const action = text(request.data?.action, 20);
  const targetUid = idText(request.data?.uid, 128);
  if (!targetUid || targetUid.includes("/")) throw fail("invalid-argument", "Usuário inválido.");

  const key = idText(request.data?.playerKey, 100);
  if (typeof request.data?.playerKey === "string" && request.data.playerKey.trim() && !key) {
    throw fail("invalid-argument", "Jogador inválido.");
  }
  if (key && !PLAYER_KEY_RE.test(key)) throw fail("invalid-argument", "Jogador inválido.");

  await requireLeagueAdmin(auth, liga);

  const targetRef = db.doc(`users/${targetUid}`);
  const target = await targetRef.get();
  if (!target.exists) throw fail("not-found", "Usuário não encontrado.");

  const leagueField = field => new FieldPath("leagues", liga, field);
  const linkFields = k => [new FieldPath("playerKey"), k, leagueField("playerKey"), k];

  switch (action) {
    case "approve":
      await targetRef.update(leagueField("role"), "player", ...(key ? linkFields(key) : []));
      break;

    case "reject": {
      const league = await db.doc(`leagues/${liga}`).get();
      if (league.data()?.ownerId === targetUid) throw fail("failed-precondition", "O criador da liga não pode ser removido.");
      await targetRef.update(leagueField("role"), "rejected");
      break;
    }

    case "promote":
      await targetRef.update(leagueField("role"), "admin");
      break;

    case "link":
      await targetRef.update(...linkFields(key || FieldValue.delete()));
      break;

    case "linkRequest": {
      const approve = request.data?.approve === true && !!key;
      const reqRef = db.doc(`leagues/${liga}/link_requests/${targetUid}`);
      if (approve) {
        const reqSnap = await reqRef.get();
        const whatsapp = reqSnap.data()?.whatsapp;
        if (whatsapp) await db.doc(`leagues/${liga}/contacts/${key}`).set({ whatsapp });
      }
      await targetRef.update(...(approve ? linkFields(key) : []), new FieldPath("linkRequestSent"), false);
      await reqRef.delete();
      break;
    }

    default:
      throw fail("invalid-argument", "Ação inválida.");
  }
  return { ok: true };
});

// Lista quem participa da liga para o Painel Admin. É o único caminho pelo qual o app lê dados
// de outros usuários (as regras do Firestore só deixam cada conta ler o próprio cadastro).
// Devolve só o que o painel usa e só da liga pedida: nada de tokens de notificação nem de
// vínculos com outras ligas.
const MEMBER_ROLES = ["pending", "player", "admin", "rejected"];

exports.listMembers = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  await requireLeagueAdmin(auth, liga);

  const roles = request.data?.roles === undefined ? MEMBER_ROLES : request.data.roles;
  if (!Array.isArray(roles) || !roles.length || roles.some(r => !MEMBER_ROLES.includes(r))) {
    throw fail("invalid-argument", "Filtro inválido.");
  }

  const snap = await db.collection("users").where(new FieldPath("leagues", liga, "role"), "in", [...new Set(roles)]).get();
  const members = snap.docs.map(doc => {
    const user = doc.data();
    const entry = user.leagues?.[liga] || {};
    return {
      uid: doc.id,
      email: user.email || "",
      displayName: user.displayName || "",
      role: entry.role,
      playerKey: entry.playerKey || user.playerKey || "",
      joinedAt: entry.joinedAt || "",
    };
  });
  members.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, "pt"));
  return { members };
});

// ── Contatos (WhatsApp) só do admin ──────────────────────────────────────────
//
// O WhatsApp de jogadores e avulsos fica em leagues/{liga}/contacts/{id}, área que só o admin
// da liga lê. Jogador: id do cadastro (playerKey do nome). Avulso: "avulso_" + playerKey do nome.
// migrateContacts move os números que ainda estão em áreas legíveis por todos os membros
// (player_registry, financeiro_avulsos e o campo avulsos dos campeonatos). O campo original só
// é apagado depois de o contato ser gravado, contato já existente nunca é sobrescrito e a
// função pode ser repetida sem risco.
const chunksOf = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// Caminhos onde existe um campo "whatsapp", em qualquer nível (só os caminhos, nunca o valor).
const findWhatsapp = (value, path = "") => {
  if (Array.isArray(value)) return value.flatMap((v, i) => findWhatsapp(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (k === "whatsapp" ? [`${path}.${k}`] : findWhatsapp(v, `${path}.${k}`)));
  }
  return [];
};

exports.migrateContacts = onCall({ ...CALLABLE, timeoutSeconds: 120, memory: "512MiB" }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  await requireLeagueAdmin(auth, liga);

  const leagueRef = db.doc(`leagues/${liga}`);
  const league = await leagueRef.get();
  if (!league.exists) throw fail("not-found", "Liga não encontrada.");
  if (league.data().contactsMigratedAt) return { skipped: true, moved: 0 };

  const base = `leagues/${liga}`;
  const digits = v => String(v ?? "").replace(/\D/g, "");
  const avulsoId = name => `avulso_${playerKey(String(name || ""))}`;
  const found = []; // { id, wa, date }: o mais recente vence quando o mesmo avulso aparece várias vezes
  const registryRefs = [];
  const avulsoRefs = [];
  const champRefs = [];
  const residual = []; // "whatsapp" em lugar que esta migração não conhece (só o caminho, nunca o número)
  const scan = (label, obj) => findWhatsapp(obj).forEach(p => residual.push(label + p));

  const registry = await db.collection(`${base}/player_registry`).get();
  registry.forEach(doc => {
    const { whatsapp, ...rest } = doc.data();
    scan(`player_registry/${doc.id}`, rest);
    if (whatsapp === undefined) return;
    registryRefs.push(doc.ref);
    if (digits(whatsapp)) found.push({ id: doc.id, wa: digits(whatsapp), date: "" });
  });

  const avulsos = await db.collection(`${base}/financeiro_avulsos`).get();
  avulsos.forEach(doc => {
    const { whatsapp, ...rest } = doc.data();
    scan(`financeiro_avulsos/${doc.id}`, rest);
    if (whatsapp === undefined) return;
    avulsoRefs.push(doc.ref);
    if (digits(whatsapp) && playerKey(String(rest.nome || ""))) {
      found.push({ id: avulsoId(rest.nome), wa: digits(whatsapp), date: String(rest.data || "") });
    }
  });

  const champs = await db.collection(`${base}/championships`).get();
  champs.forEach(doc => {
    const { avulsos: list, ...rest } = doc.data();
    scan(`championships/${doc.id}`, rest);
    if (!Array.isArray(list)) { scan(`championships/${doc.id}.avulsos`, list); return; }
    list.forEach((a, i) => {
      if (a && typeof a === "object") scan(`championships/${doc.id}.avulsos[${i}]`, (({ whatsapp, ...r }) => r)(a));
      else scan(`championships/${doc.id}.avulsos[${i}]`, a);
    });
    if (!list.some(a => a && typeof a === "object" && "whatsapp" in a)) return;
    champRefs.push(doc.ref);
    for (const a of list) {
      if (a && digits(a.whatsapp) && playerKey(String(a.name || ""))) {
        found.push({ id: avulsoId(a.name), wa: digits(a.whatsapp), date: String(rest.date || "") });
      }
    }
  });

  // as demais áreas que os membros leem não deveriam ter WhatsApp: só confere e avisa
  for (const name of ["player_titles", "financeiro_mensalidades", "financeiro_despesas", "player_photos", "app_config", "financeiro_config"]) {
    (await db.collection(`${base}/${name}`).get()).forEach(doc => scan(`${name}/${doc.id}`, doc.data()));
  }

  const wanted = new Map();
  for (const f of found.sort((a, b) => a.date.localeCompare(b.date))) wanted.set(f.id, f.wa);

  // 1) grava os contatos que ainda não existem (o que o admin já ajustou vale mais que o número antigo)
  const existing = new Set((await db.collection(`${base}/contacts`).select().get()).docs.map(d => d.id));
  const toWrite = [...wanted].filter(([id]) => !existing.has(id));
  for (const chunk of chunksOf(toWrite, 400)) {
    const batch = db.batch();
    chunk.forEach(([id, wa]) => batch.set(db.doc(`${base}/contacts/${id}`), { whatsapp: wa }));
    await batch.commit();
  }

  // 2) só então apaga o número das áreas abertas
  for (const chunk of chunksOf([...registryRefs, ...avulsoRefs], 400)) {
    const batch = db.batch();
    chunk.forEach(ref => batch.update(ref, { whatsapp: FieldValue.delete() }));
    await batch.commit();
  }
  for (const ref of champRefs) {
    await db.runTransaction(async tx => {
      const list = (await tx.get(ref)).data()?.avulsos;
      if (!Array.isArray(list) || !list.some(a => a && typeof a === "object" && "whatsapp" in a)) return;
      tx.update(ref, { avulsos: list.map(a => {
        if (!a || typeof a !== "object") return a;
        const { whatsapp, ...rest } = a; // eslint-disable-line no-unused-vars
        return rest;
      }) });
    });
  }

  const summary = { liga, contatos: wanted.size, criados: toWrite.length, cadastros: registryRefs.length, cobrancas: avulsoRefs.length, campeonatos: champRefs.length, residual: residual.length };
  if (residual.length) {
    // não marca a liga como concluída: a próxima abertura do app repete a conferência
    logger.warn("migrateContacts: sobrou WhatsApp em formato desconhecido (não foi movido nem apagado)", { ...summary, onde: residual.slice(0, 50) });
    return { skipped: false, moved: wanted.size, created: toWrite.length, residual: residual.length };
  }
  await leagueRef.update({ contactsMigratedAt: new Date().toISOString() });
  logger.info("migrateContacts concluída", summary);
  return { skipped: false, moved: wanted.size, created: toWrite.length, residual: 0 };
});

// Guarda a lista de badges que o jogador já viu (evita avisar duas vezes).
exports.saveEarnedBadges = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const ids = request.data?.ids;
  if (!Array.isArray(ids) || ids.length > 300 || ids.some(i => typeof i !== "string" || i.length > 80)) {
    throw fail("invalid-argument", "Lista de badges inválida.");
  }
  const userRef = db.doc(`users/${auth.uid}`);
  const role = (await userRef.get()).data()?.leagues?.[liga]?.role;
  if (role !== "admin" && role !== "player") throw fail("permission-denied", "Você não participa desta liga.");
  await userRef.update(new FieldPath("leagues", liga, "earnedBadges"), ids);
  return { ok: true };
});

// ── Excluir a própria conta (direito de eliminação, LGPD) ────────────────────
//
// Apaga o login e os dados pessoais ligados à conta: cadastro (e-mail, nome, aparelhos de
// notificação, ligas e papéis), pedidos de vinculação e, do jogador vinculado à conta, a foto e
// o WhatsApp. O nome do jogador nas partidas já disputadas é registro esportivo da liga e fica.
// Só afeta quem chama, exige login recente e não deixa uma liga sem admin.
const RECENT_LOGIN_SECONDS = 300;

exports.deleteMyAccount = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async request => {
  const auth = requireAuth(request);
  if (request.data?.confirm !== true) throw fail("invalid-argument", "Confirmação ausente.");
  const uid = auth.uid;

  const authTime = Number(auth.token?.auth_time) || 0;
  if (Date.now() / 1000 - authTime > RECENT_LOGIN_SECONDS) {
    throw new HttpsError("failed-precondition", "Por segurança, confirme sua identidade entrando de novo e tente em seguida.", { reason: "recent-login" });
  }

  const userRef = db.doc(`users/${uid}`);
  const user = (await userRef.get()).data() || {};
  const leagues = user.leagues && typeof user.leagues === "object" ? user.leagues : {};
  const ligas = Object.keys(leagues).filter(l => LEAGUE_ID_RE.test(l));

  // 1) nenhuma liga pode ficar sem admin por causa desta exclusão
  const orphaned = [];
  const nextOwner = {};
  for (const liga of ligas) {
    if (leagues[liga]?.role !== "admin") continue;
    const admins = await db.collection("users").where(new FieldPath("leagues", liga, "role"), "==", "admin").get();
    const others = admins.docs.filter(d => d.id !== uid);
    if (!others.length) {
      orphaned.push((await db.doc(`leagues/${liga}`).get()).data()?.name || liga);
    } else {
      const joined = d => String(d.data().leagues?.[liga]?.joinedAt || "");
      nextOwner[liga] = others.sort((a, b) => joined(a).localeCompare(joined(b)))[0].id; // admin mais antigo
    }
  }
  if (orphaned.length) {
    throw new HttpsError("failed-precondition",
      `Você é o único admin de ${orphaned.join(", ")}. Promova outro admin ou saia da liga antes de excluir a conta.`,
      { reason: "last-admin", ligas: orphaned });
  }

  // 2) limpa o que é pessoal em cada liga
  for (const liga of ligas) {
    const base = `leagues/${liga}`;
    await db.doc(`${base}/link_requests/${uid}`).delete();

    const key = String(leagues[liga]?.playerKey || user.playerKey || "");
    if (PLAYER_KEY_RE.test(key)) {
      // foto e WhatsApp são do jogador; se outra conta estiver vinculada ao mesmo jogador, ficam
      const sharers = await db.collection("users").where(new FieldPath("leagues", liga, "playerKey"), "==", key).get();
      if (!sharers.docs.some(d => d.id !== uid)) {
        await db.doc(`${base}/contacts/${key}`).delete();
        await db.doc(`${base}/player_photos/${key}`).delete();
      }
    }

    // convites: tira o identificador desta conta (quem usou e quem criou)
    for (const field of ["usedBy", "createdBy"]) {
      const snap = await db.collection(`${base}/invite_tokens`).where(field, "==", uid).get();
      for (const chunk of chunksOf(snap.docs, 400)) {
        const batch = db.batch();
        chunk.forEach(d => batch.update(d.ref, { [field]: FieldValue.delete() }));
        await batch.commit();
      }
    }

    // a liga não pode ficar com um dono que deixou de existir
    if (nextOwner[liga]) {
      const leagueRef = db.doc(base);
      if ((await leagueRef.get()).data()?.ownerId === uid) await leagueRef.update({ ownerId: nextOwner[liga] });
    }
  }

  // 3) cadastro (com as notificações pendentes) e, por último, o login. Se o servidor não
  // conseguir apagar o login (ex.: falta de permissão), devolve authDeleted:false e o próprio
  // app conclui com user.delete(); os dados pessoais já foram apagados de qualquer forma.
  await db.recursiveDelete(userRef);
  let authDeleted = true;
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    if (e?.code !== "auth/user-not-found") {
      authDeleted = false;
      logger.error("deleteMyAccount: o servidor não conseguiu apagar o login (o app conclui)", { code: e?.code });
    }
  }
  logger.info("deleteMyAccount concluída", { ligas: ligas.length, loginApagadoNoServidor: authDeleted });
  return { ok: true, authDeleted };
});

// ── Anonimizar meu nome no histórico (direito de anonimização, LGPD) ─────────
//
// O jogador troca o próprio nome, em TODO o histórico da liga (elenco, títulos,
// campeonatos, gols, votos e mensalidades), por um identificador anônimo gerado pelo
// servidor — sem apagar a conta nem sair da liga. A foto é removida (photo identifica
// a pessoa); o WhatsApp muda de dono só de endereço, para o admin continuar
// conseguindo chamar para o próximo jogo.
//
// A troca de identidade (elenco + o próprio vínculo) é uma transação: ou as duas
// coisas mudam juntas, ou nenhuma muda. A limpeza do histórico (campeonatos e
// mensalidades) vem depois, feita a partir do nome antigo guardado no novo cadastro
// — por isso pode ser refeita com segurança se a função for repetida.
const ANON_PREFIX = "jogador_anonimo_";

// Troca a identidade de um jogador do elenco por um identificador anônimo, dentro de uma
// liga, e aponta para o novo registro qualquer conta vinculada a ele (normalmente uma só).
// Extraído de anonymizeMyName para ser reaproveitado pela limpeza de ligas abandonadas, que
// faz o mesmo para o elenco inteiro de uma vez, sem uma conta chamando. Devolve null se o
// jogador não existir mais no elenco (nada a fazer).
async function renamePlayerToAnon(liga, oldKey) {
  const base = `leagues/${liga}`;
  const oldRegRef = db.doc(`${base}/player_registry/${oldKey}`);
  const oldReg = await oldRegRef.get();
  if (!oldReg.exists) return null;
  const oldName = oldReg.data().name;
  const newKey = ANON_PREFIX + crypto.randomBytes(4).toString("hex");
  const newName = `Jogador Anônimo #${newKey.slice(-4).toUpperCase()}`;
  const linkedQuery = db.collection("users").where(new FieldPath("leagues", liga, "playerKey"), "==", oldKey);

  // Troca de identidade: cadastro novo + apagar o antigo + apontar toda conta vinculada
  // para o novo, tudo ou nada. formerName fica gravado para a limpeza do histórico (abaixo)
  // conseguir encontrar o nome antigo mesmo que a função seja chamada de novo depois.
  await db.runTransaction(async tx => {
    const [freshOldReg, linkedSnap] = await Promise.all([tx.get(oldRegRef), tx.get(linkedQuery)]);
    if (!freshOldReg.exists) return; // outra chamada já fez a troca
    const d = freshOldReg.data();
    tx.set(db.doc(`${base}/player_registry/${newKey}`), {
      name: newName, formerName: oldName,
      added: d.added || new Date().toISOString().slice(0, 10), active: d.active !== false,
      ...(d.stars != null ? { stars: d.stars } : {}),
    });
    tx.delete(oldRegRef);
    linkedSnap.docs.forEach(doc => {
      const fields = [new FieldPath("leagues", liga, "playerKey"), newKey];
      if ((doc.data().playerKey || "") === oldKey) fields.push("playerKey", newKey);
      tx.update(doc.ref, ...fields);
    });
  });

  return { oldKey, oldName, newKey, newName };
}

// Limpeza do histórico de uma liga (títulos, foto, contato, financeiro, campeonatos) depois
// de renamePlayerToAnon. Idêntica em espírito ao que o admin já faz ao renomear um jogador
// (renamePlayer, no index.html), só que restrita ao jogador trocado. Cada passo confere o
// nome antigo, então repetir a função não duplica nada.
async function cleanPlayerHistory(liga, { oldKey, oldName, newKey, newName }) {
  const base = `leagues/${liga}`;
  const titlesOld = await db.doc(`${base}/player_titles/${oldKey}`).get();
  if (titlesOld.exists) {
    await db.doc(`${base}/player_titles/${newKey}`).set({ ...titlesOld.data(), name: newName });
    await titlesOld.ref.delete();
  }
  await db.doc(`${base}/player_photos/${oldKey}`).delete().catch(() => {}); // a foto identifica a pessoa: não é levada adiante
  const contactOld = await db.doc(`${base}/contacts/${oldKey}`).get();
  if (contactOld.exists) {
    await db.doc(`${base}/contacts/${newKey}`).set(contactOld.data());
    await contactOld.ref.delete();
  }

  const mensalidades = await db.collection(`${base}/financeiro_mensalidades`).get();
  for (const doc of mensalidades.docs) {
    const pags = doc.data().pagamentos || {};
    if (!Object.prototype.hasOwnProperty.call(pags, oldName)) continue;
    const novo = { ...pags, [newName]: pags[oldName] };
    delete novo[oldName];
    await doc.ref.update({ pagamentos: novo });
  }

  const champs = await db.collection(`${base}/championships`).get();
  for (const doc of champs.docs) {
    const c = doc.data();
    const patch = {};
    if (c.champion_players?.some(p => p.name === oldName)) {
      patch.champion_players = c.champion_players.map(p => (p.name === oldName ? { ...p, name: newName } : p));
    }
    if (c.teamRosters) {
      let changed = false;
      const rosters = {};
      for (const [team, roster] of Object.entries(c.teamRosters)) {
        if (roster.includes(oldName)) { rosters[team] = roster.map(n => (n === oldName ? newName : n)); changed = true; }
        else rosters[team] = roster;
      }
      if (changed) patch.teamRosters = rosters;
    }
    let matchChanged = false;
    const matches = (c.matches || []).map(m => {
      const mp = {}; let changed = false;
      if (m.goals?.some(g => g.player === oldName)) { mp.goals = m.goals.map(g => (g.player === oldName ? { ...g, player: newName } : g)); changed = true; }
      if (m.finalGoals?.some(g => g.player === oldName)) { mp.finalGoals = m.finalGoals.map(g => (g.player === oldName ? { ...g, player: newName } : g)); changed = true; }
      if (changed) { matchChanged = true; return { ...m, ...mp }; }
      return m;
    });
    if (matchChanged) patch.matches = matches;
    if (c.votes) {
      let changed = false;
      const votes = {};
      for (const [voterKey, v] of Object.entries(c.votes)) {
        const isVoter = voterKey === oldKey;
        if (isVoter) changed = true;
        const nk = isVoter ? newKey : voterKey;
        const nv = { ...v };
        for (const cat of ["pos", "neg"]) if (nv[cat] === oldName) { nv[cat] = newName; changed = true; }
        votes[nk] = nv;
      }
      if (changed) patch.votes = votes;
    }
    if (Object.keys(patch).length) await doc.ref.update(patch);
  }
}

exports.anonymizeMyName = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const userRef = db.doc(`users/${auth.uid}`);
  const user = (await userRef.get()).data() || {};
  const role = user.leagues?.[liga]?.role;
  if (role !== "player" && role !== "admin") throw fail("permission-denied", "Você não participa desta liga.");

  const currentKey = user.leagues[liga]?.playerKey || user.playerKey || "";
  if (!PLAYER_KEY_RE.test(currentKey)) throw fail("failed-precondition", "Sua conta não está vinculada a um jogador nesta liga.");

  let result;
  if (currentKey.startsWith(ANON_PREFIX)) {
    // Identidade já trocada (nesta chamada ou numa anterior): só confere se sobrou
    // histórico com o nome antigo e termina de limpar.
    const reg = await db.doc(`leagues/${liga}/player_registry/${currentKey}`).get();
    if (!reg.exists || !reg.data().formerName) return { ok: true, alreadyAnonymized: true };
    result = { newKey: currentKey, newName: reg.data().name, oldName: reg.data().formerName, oldKey: playerKey(reg.data().formerName) };
  } else {
    result = await renamePlayerToAnon(liga, currentKey);
    if (!result) throw fail("not-found", "Jogador não encontrado no elenco.");
  }

  await cleanPlayerHistory(liga, result);
  logger.info("anonymizeMyName concluída", { liga });
  return { ok: true, newKey: result.newKey, newName: result.newName };
});

// ── Backup agendado do Firestore ────────────────────────────────────────────
// Roda todo dia de madrugada e exporta o banco inteiro para o bucket padrão do
// projeto, em uma pasta separada por data. Exige que a service account das
// Cloud Functions tenha o papel "Cloud Datastore Import Export Admin" no
// projeto (IAM do Google Cloud) — sem isso, o export falha com permissão negada.
exports.scheduledFirestoreBackup = onSchedule(
  { schedule: "0 5 * * *", timeZone: "America/Sao_Paulo", region: "us-east1" },
  async () => {
    const client = new firestoreAdminV1.FirestoreAdminClient();
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID;
    const databaseName = client.databasePath(projectId, "(default)");
    const bucketName = admin.storage().bucket().name;
    const dateFolder = new Date().toISOString().slice(0, 10);
    const outputUriPrefix = `gs://${bucketName}/firestore-backups/${dateFolder}`;

    const [operation] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix,
      collectionIds: [], // vazio = todas as coleções, de todas as ligas
    });
    logger.info(`Backup do Firestore iniciado em ${outputUriPrefix}`, { operationName: operation.name });
  }
);

// Marca que alguém abriu a liga agora — chamada pelo app toda vez que a liga é carregada
// (startListeners, no index.html). É o sinal que a varredura mensal de ligas abandonadas usa
// para saber se ainda há gente usando. Não precisa ser admin: qualquer membro conta como "a
// liga está viva". Sem rate limit: na pior hipótese grava o mesmo valor várias vezes por
// sessão, o que é inofensivo e muito barato.
exports.touchLeagueActivity = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const user = (await db.doc(`users/${auth.uid}`).get()).data() || {};
  if (!user.leagues?.[liga]?.role) throw fail("permission-denied", "Você não participa desta liga.");
  await db.doc(`leagues/${liga}`).update({ lastActivityAt: new Date().toISOString() });
  return { ok: true };
});

// ── Ligas abandonadas: aviso e anonimização automática ──────────────────────────────────
// `lastActivityAt` (gravado por touchLeagueActivity) diz quando alguém abriu a liga pela
// última vez. Esta varredura roda uma vez por mês:
//  1. liga sem nenhuma abertura há ~11 meses e ainda sem aviso → manda e-mail aos admins e
//     grava `abandonmentWarnedAt`;
//  2. liga avisada há mais de 30 dias cujo `lastActivityAt` não mudou desde o aviso (ninguém
//     reagiu) → anonimiza o elenco inteiro, jogador por jogador, com a mesma limpeza de
//     anonymizeMyName, e grava `abandonmentAnonymizedAt`. Não exclui a liga nem o histórico
//     esportivo (campeonatos, títulos, estatísticas) — só os dados pessoais (nome, foto,
//     WhatsApp) deixam de ficar associados a ele, pela mesma razão de não guardar dado
//     pessoal por tempo indefinido sem necessidade (LGPD).
//  3. liga avisada que voltou a ter atividade → o aviso é descartado, permitindo um novo
//     ciclo completo se ela ficar inativa de novo no futuro. Uma liga já anonimizada nunca
//     entra de novo no ciclo (não há mais nome real para proteger).
const ABANDON_WARN_AFTER_DAYS = 335; // ~11 meses
const ABANDON_ACT_AFTER_DAYS = 30;   // prazo de reação depois do aviso

async function sendAbandonWarningEmail(to, leagueId) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM,
        to,
        subject: `Sua liga "${leagueId}" está inativa há quase um ano`,
        html: `<p>Ninguém da liga <strong>${leagueId}</strong> no Pelada na Mão abre o aplicativo há quase um ano.</p>`
          + `<p>Para manter o histórico, os títulos e os dados dos jogadores como estão hoje, basta entrar no aplicativo normalmente — não precisa fazer mais nada.</p>`
          + `<p>Se ninguém entrar nos próximos 30 dias, o nome, a foto e o WhatsApp de cada jogador dessa liga serão trocados por um identificador anônimo, por padrão de proteção de dados pessoais. O histórico esportivo (resultados, títulos, estatísticas) continua existindo normalmente, só sem os nomes.</p>`
          + `<p>peladanamao.com.br</p>`,
      }),
    });
    if (!res.ok) logger.warn("Resend não confirmou o envio do aviso de abandono", { status: res.status, leagueId });
  } catch (e) {
    logger.warn("Falha ao chamar a API do Resend para aviso de abandono", { message: e?.message, leagueId });
  }
}

exports.checkAbandonedLeagues = onSchedule(
  { schedule: "0 6 1 * *", timeZone: "America/Sao_Paulo", region: "us-east1", secrets: [RESEND_API_KEY], timeoutSeconds: 540 },
  async () => {
    const now = Date.now();
    const warnCutoff = new Date(now - ABANDON_WARN_AFTER_DAYS * 86400000).toISOString();
    const actCutoff = new Date(now - ABANDON_ACT_AFTER_DAYS * 86400000).toISOString();
    let warned = 0, anonymized = 0;

    const leaguesSnap = await db.collection("leagues").get();
    for (const leagueDoc of leaguesSnap.docs) {
      const liga = leagueDoc.id;
      const data = leagueDoc.data();
      if (data.abandonmentAnonymizedAt) continue; // já processada: o ciclo não se repete
      const lastActivityAt = data.lastActivityAt;
      if (!lastActivityAt) continue; // liga que ninguém abriu desde que o campo existe

      if (data.abandonmentWarnedAt) {
        if (lastActivityAt > data.abandonmentWarnedAt) {
          // Reaberta depois do aviso: cancela e permite um novo ciclo no futuro.
          await leagueDoc.ref.update({ abandonmentWarnedAt: FieldValue.delete() });
          continue;
        }
        if (data.abandonmentWarnedAt < actCutoff) {
          const registrySnap = await db.collection(`leagues/${liga}/player_registry`).get();
          for (const playerDoc of registrySnap.docs) {
            const key = playerDoc.id;
            if (key.startsWith(ANON_PREFIX)) continue;
            const result = await renamePlayerToAnon(liga, key);
            if (result) await cleanPlayerHistory(liga, result);
          }
          await leagueDoc.ref.update({ abandonmentAnonymizedAt: new Date().toISOString() });
          anonymized++;
        }
        continue;
      }

      if (lastActivityAt < warnCutoff) {
        const adminsSnap = await db.collection("users").where(new FieldPath("leagues", liga, "role"), "==", "admin").get();
        const emails = adminsSnap.docs.map(d => d.data().email).filter(Boolean);
        if (emails.length) await sendAbandonWarningEmail(emails, liga);
        await leagueDoc.ref.update({ abandonmentWarnedAt: new Date().toISOString() });
        warned++;
      }
    }

    logger.info("checkAbandonedLeagues concluída", { ligasAvisadas: warned, ligasAnonimizadas: anonymized });
  }
);

// ── Pagamento via Mercado Pago ───────────────────────────────────────────────────────────
// Dois produtos: assinatura mensal recorrente (Preapproval, cobrada automaticamente todo
// mês) e cobrança anual única (Preference/Checkout Pro, parcelável em até 12x — o Mercado
// Pago repassa o valor integral de uma vez, mesmo parcelado, então não exige renovação
// automática). Nenhuma das duas telas aparece dentro do app empacotado nas lojas; só no
// site, e por e-mail. A liga só é marcada como paga quando o webhook confirma a cobrança —
// os dois onCall abaixo só abrem o link de pagamento, nunca marcam nada como pago.
function mpClient() {
  return new MercadoPagoConfig({ accessToken: MERCADOPAGO_ACCESS_TOKEN.value() });
}

async function requireLeagueAdminWithEmail(auth, liga) {
  const user = (await db.doc(`users/${auth.uid}`).get()).data() || {};
  if (user.leagues?.[liga]?.role !== "admin") throw fail("permission-denied", "Só o admin da liga pode assinar.");
  if (!user.email) throw fail("failed-precondition", "Sua conta precisa de um e-mail para assinar.");
  return user.email;
}

exports.createMonthlySubscription = onCall({ ...CALLABLE, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const payerEmail = await requireLeagueAdminWithEmail(auth, liga);

  // payer_email é obrigatório para este tipo de assinatura (o SDK marca como opcional,
  // mas a API recusa sem ele: "payer_email is required"). Em teste, se o Access Token for
  // de uma conta de teste, o Mercado Pago exige que este e-mail também seja de uma conta
  // de teste ("Both payer and collector must be real or test users") — isso nunca ocorre
  // em produção, onde as duas pontas já são contas reais.
  const result = await new PreApproval(mpClient()).create({
    body: {
      reason: `Pelada na Mão — ${MP_PLANS.monthly.label}`,
      external_reference: liga,
      payer_email: payerEmail,
      back_url: "https://peladanamao.com.br",
      notification_url: MERCADOPAGO_WEBHOOK_URL,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: MP_PLANS.monthly.amount,
        currency_id: "BRL",
      },
    },
  });
  return { initPoint: result.init_point };
});

exports.createAnnualPayment = onCall({ ...CALLABLE, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const payerEmail = await requireLeagueAdminWithEmail(auth, liga);

  const result = await new Preference(mpClient()).create({
    body: {
      items: [{
        id: `annual-${liga}`,
        title: `Pelada na Mão — ${MP_PLANS.annual.label}`,
        quantity: 1,
        unit_price: MP_PLANS.annual.amount,
        currency_id: "BRL",
      }],
      external_reference: liga,
      payer: { email: payerEmail },
      back_urls: {
        success: "https://peladanamao.com.br",
        pending: "https://peladanamao.com.br",
        failure: "https://peladanamao.com.br",
      },
      auto_return: "approved",
      notification_url: MERCADOPAGO_WEBHOOK_URL,
    },
  });
  return { initPoint: result.init_point };
});

// Marca a liga como paga até a data informada. Chamado só pelo webhook, depois de
// confirmar a cobrança diretamente com a API do Mercado Pago (nunca a partir de dados que
// vêm só na notificação, que podem ser forjados).
async function activateSubscription(liga, plan, activeUntil) {
  if (!liga) return; // notificação sem external_reference: nada a fazer
  await db.doc(`leagues/${liga}`).update({ subscriptionActiveUntil: activeUntil, subscriptionPlan: plan });
  logger.info("Assinatura ativada", { liga, plan, activeUntil });
}

// Endpoint HTTP puro (não onCall) exposto publicamente para o Mercado Pago chamar. Por
// estar na internet aberta, a assinatura da notificação é sempre conferida antes de
// confiar em qualquer dado — inclusive recusando quando o segredo ainda não foi
// configurado (falha fechada), nunca aceitando sem validar.
exports.mercadoPagoWebhook = onRequest(
  { secrets: [MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET], region: "us-east1" },
  async (req, res) => {
    const webhookSecret = MERCADOPAGO_WEBHOOK_SECRET.value();
    if (!webhookSecret || webhookSecret === MERCADOPAGO_WEBHOOK_NOT_CONFIGURED) {
      logger.error("MERCADOPAGO_WEBHOOK_SECRET ainda não configurado: recusando notificação");
      res.status(503).send("webhook not configured");
      return;
    }
    try {
      WebhookSignatureValidator.validate({
        xSignature: req.headers["x-signature"],
        xRequestId: req.headers["x-request-id"],
        dataId: req.query["data.id"],
        secret: webhookSecret,
        toleranceSeconds: 300,
      });
    } catch (e) {
      logger.warn("Webhook do Mercado Pago com assinatura inválida", { message: e?.message, reason: e?.reason });
      res.status(401).send("invalid signature");
      return;
    }

    const topic = req.query.type || req.query.topic;
    const id = req.query["data.id"] || req.body?.data?.id;
    try {
      const client = mpClient();
      if (topic === "subscription_preapproval" || topic === "preapproval") {
        const result = await new PreApproval(client).get({ id });
        if (result.status === "authorized") {
          // Margem de alguns dias sobre a próxima cobrança, tolerando um pequeno atraso do
          // próprio Mercado Pago sem derrubar o acesso da liga antes da hora.
          const base = result.next_payment_date ? new Date(result.next_payment_date) : new Date();
          await activateSubscription(result.external_reference, "monthly", new Date(base.getTime() + 5 * 86400000).toISOString());
        }
      } else if (topic === "payment") {
        const result = await new Payment(client).get({ id });
        if (result.status === "approved") {
          await activateSubscription(result.external_reference, "annual", new Date(Date.now() + 365 * 86400000).toISOString());
        }
      }
      res.status(200).send("ok");
    } catch (e) {
      logger.error("Falha ao processar webhook do Mercado Pago", { message: e?.message, topic, id });
      res.status(500).send("error");
    }
  }
);
