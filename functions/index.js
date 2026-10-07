const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const admin = require("firebase-admin");
const { v1: firestoreAdminV1 } = require("@google-cloud/firestore");
const { MercadoPagoConfig, PreApproval, Preference, Payment, WebhookSignatureValidator } = require("mercadopago");
const { describeMpError } = require("./mp-errors");
const funnel = require("./funnel-metrics");
const clientErrors = require("./client-errors");
const { recoverFreeChampionships: recoverFree, isLeagueFreeNow } = require("./recover-free");
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

// ── Ambientes ──────────────────────────────────────────────────────────────────────────
// A produção é o padrão: qualquer projeto fora desta lista (os emuladores, os testes) usa os
// endereços de produção, exatamente como sempre foi. O ambiente de TESTE (staging) é um projeto
// Firebase à parte, só com dados fictícios: aponta para o próprio site, marca os e-mails com
// "[TESTE]" e não faz backup. O app (index.html) e o firebase-messaging-sw.js têm a mesma tabela
// do lado do navegador; functions/test/environments-test.js confere que as três batem.
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID || "";
const PRODUCTION_ENV = {
  name: "production",
  appUrl: "https://peladanamao.com.br/", // links dos e-mails e a volta do checkout do Mercado Pago
  pushUrl: "https://peladanamao.com.br/", // ícone e link das notificações push (o mesmo endereço do site, onde a pessoa está logada)
  webhookUrl: "https://us-east1-seriebaceoma.cloudfunctions.net/mercadoPagoWebhook",
  emailSubjectPrefix: "",
  backups: true,
  siteOrigins: ["https://peladanamao.com.br", "https://www.peladanamao.com.br"], // de onde o app pode mandar relatos de erro (reportClientError)
};
const ENVIRONMENTS = {
  "seriebaceoma-staging": {
    name: "staging",
    appUrl: "https://seriebaceoma-staging.web.app/",
    pushUrl: "https://seriebaceoma-staging.web.app/",
    webhookUrl: "https://us-east1-seriebaceoma-staging.cloudfunctions.net/mercadoPagoWebhook",
    emailSubjectPrefix: "[TESTE] ",
    backups: false,
    siteOrigins: ["https://seriebaceoma-staging.web.app", "https://seriebaceoma-staging.firebaseapp.com"],
  },
};
const ENV = ENVIRONMENTS[PROJECT_ID] || PRODUCTION_ENV;

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
          icon: `${ENV.pushUrl}icon-192.png`,
          badge: `${ENV.pushUrl}icon-192.png`,
          ...(tag ? { tag } : {})
        },
        fcmOptions: { link: ENV.pushUrl }
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
// Marcador de "chave ainda não configurada" (o ambiente de teste nasce assim, para nunca mandar
// e-mail de verdade): nesse caso o envio é pulado, sem chamar o Resend.
const RESEND_NOT_CONFIGURED = "PENDENTE_CONFIGURAR";
const resendConfigured = () => {
  const key = RESEND_API_KEY.value();
  return !!key && key !== RESEND_NOT_CONFIGURED;
};

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
const MERCADOPAGO_WEBHOOK_URL = ENV.webhookUrl;
const MERCADOPAGO_WEBHOOK_NOT_CONFIGURED = "PENDENTE_CONFIGURAR";
const MP_PLANS = {
  monthly: { amount: 29.9, label: "Assinatura mensal" },
  annual: { amount: 238.8, label: "Assinatura anual" },
};
// Tolerância técnica a atraso de notificação/processamento do Mercado Pago — nunca
// mostrada ao usuário (a UI exibe a data real da próxima cobrança, sem este acréscimo).
const SUBSCRIPTION_GRACE_DAYS = 1;

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
    logger.warn("Falha ao pedir ao Cloudinary para apagar o arquivo", { erro: e?.message });
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
const TRIAL_DAYS = 8; // só vale para ligas criadas daqui para frente; as existentes mantêm o prazo que já tinham

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

// Admin mais antigo da liga que não seja `excludeUid` (quem está saindo); null se não houver outro.
async function oldestOtherAdmin(liga, excludeUid) {
  const admins = await db.collection("users").where(new FieldPath("leagues", liga, "role"), "==", "admin").get();
  const joined = d => String(d.data().leagues?.[liga]?.joinedAt || "");
  const others = admins.docs.filter(d => d.id !== excludeUid).sort((a, b) => joined(a).localeCompare(joined(b)));
  return others.length ? others[0].id : null;
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
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();

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

// Sair de uma liga (o usuário só mexe no próprio vínculo). O único admin não sai: a liga ficaria
// sem ninguém para administrá-la — ele promove outro admin ou encerra a liga (deleteLeague).
// Se quem sai é o criador da liga, a liga passa para o admin mais antigo que ficar.
exports.leaveLeague = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const userRef = db.doc(`users/${auth.uid}`);
  const entry = (await userRef.get()).data()?.leagues?.[liga];
  if (!entry) return { ok: true };

  const leagueRef = db.doc(`leagues/${liga}`);
  const leagueSnap = await leagueRef.get();
  // Liga que já não existe (vínculo que sobrou): não há o que administrar, a pessoa só sai.
  if (entry.role === "admin" && leagueSnap.exists) {
    const league = leagueSnap.data();
    const next = await oldestOtherAdmin(liga, auth.uid);
    if (!next) {
      const name = league.name || liga;
      throw new HttpsError("failed-precondition",
        `Você é o único admin de ${name}. Promova outro admin ou encerre a liga antes de sair.`,
        { reason: "last-admin", ligas: [name] });
    }
    if (league.ownerId === auth.uid) await leagueRef.update({ ownerId: next });
  }

  await userRef.update(new FieldPath("leagues", liga), FieldValue.delete());
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
    const next = await oldestOtherAdmin(liga, uid); // admin mais antigo que ficaria no lugar
    if (!next) orphaned.push((await db.doc(`leagues/${liga}`).get()).data()?.name || liga);
    else nextOwner[liga] = next;
  }
  if (orphaned.length) {
    throw new HttpsError("failed-precondition",
      `Você é o único admin de ${orphaned.join(", ")}. Promova outro admin ou encerre a liga antes de excluir a conta.`,
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
    if (!ENV.backups) { logger.info("Backup agendado desligado neste ambiente", { ambiente: ENV.name }); return; }
    const client = new firestoreAdminV1.FirestoreAdminClient();
    const projectId = PROJECT_ID;
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

// Recuperar os campeonatos feitos no plano gratuito (ver recover-free.js). Acontece sozinho quando o plano é
// ativado; esta função existe para o que sobrou (ligas que já tinham plano antes dela, ou uma recuperação
// interrompida). Só admin da liga, só com plano em vigor, e pode ser repetida sem somar nada em dobro.
exports.recoverFreeChampionships = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async request => {
  const auth = requireAuth(request);
  await checkRateLimit(auth.uid, "recoverFree", 6);
  const liga = leagueIdOf(request.data);
  await requireLeagueAdmin(auth, liga);
  const leagueSnap = await db.doc(`leagues/${liga}`).get();
  if (!leagueSnap.exists) throw fail("not-found", "Liga não encontrada.");
  if (isLeagueFreeNow(leagueSnap.data())) throw fail("failed-precondition", "Assine um plano para recuperar os campeonatos feitos no plano gratuito.");
  const r = await recoverFree({ db, liga, budgetMs: 90000 });
  logger.info("Campeonatos do plano gratuito recuperados pelo admin", { liga, ...r });
  return { ok: true, recovered: r.recovered, remaining: r.remaining };
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
    if (!resendConfigured()) { logger.info("Resend não configurado neste ambiente: aviso de abandono não enviado", { leagueId }); return; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM,
        to,
        subject: `${ENV.emailSubjectPrefix}Sua liga "${leagueId}" está inativa há quase um ano`,
        html: `<p>Ninguém da liga <strong>${leagueId}</strong> no Pelada na Mão abre o aplicativo há quase um ano.</p>`
          + `<p>Para manter o histórico, os títulos e os dados dos jogadores como estão hoje, basta entrar no aplicativo normalmente — não precisa fazer mais nada.</p>`
          + `<p>Se ninguém entrar nos próximos 30 dias, o nome, a foto e o WhatsApp de cada jogador dessa liga serão trocados por um identificador anônimo, por padrão de proteção de dados pessoais. O histórico esportivo (resultados, títulos, estatísticas) continua existindo normalmente, só sem os nomes.</p>`
          + `<p>peladanamao.com.br</p>`,
      }),
    });
    if (!res.ok) logger.warn("Resend não confirmou o envio do aviso de abandono", { status: res.status, leagueId });
  } catch (e) {
    logger.warn("Falha ao chamar a API do Resend para aviso de abandono", { erro: e?.message, leagueId });
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
//
// "Estender plano": quem já tem plano pago paga o anual de novo e cada pagamento aprovado SOMA
// 12 meses ao vencimento atual (applyAnnualPayment). Se o plano era o mensal, a assinatura
// recorrente é cancelada sozinha, para não cobrar em dobro. O mensal também se cancela pelo app
// (cancelSubscription): a liga segue com o plano até o fim do período já pago.
function mpClient() {
  return new MercadoPagoConfig({ accessToken: MERCADOPAGO_ACCESS_TOKEN.value() });
}

async function requireLeagueAdminWithEmail(auth, liga) {
  const user = (await db.doc(`users/${auth.uid}`).get()).data() || {};
  if (user.leagues?.[liga]?.role !== "admin") throw fail("permission-denied", "Só o admin da liga pode assinar.");
  if (!user.email) throw fail("failed-precondition", "Sua conta precisa de um e-mail para assinar.");
  return user.email;
}

// O SDK do Mercado Pago lança exceções próprias (MPBadRequestError etc.) que, sem
// tratamento, o Firebase Functions converte num "internal" genérico sem detalhe nenhum
// para quem chamou — o app ficava parecendo travado, sem nenhuma mensagem visível.
// Envolver a chamada aqui devolve sempre um erro que o app consegue mostrar. A mensagem vai em
// português (mp-errors.js traduz o que o Mercado Pago responde em inglês e diz o que a pessoa pode
// fazer); o texto original fica no log, no campo "erro" — um campo chamado "message" seria apagado
// pelo texto do próprio log, e foi assim que a causa de uma recusa já se perdeu.
async function callMp(action, factory) {
  try {
    return await factory();
  } catch (e) {
    const info = describeMpError(e, { contact: CONTACT_EMAIL, testHint: ENV !== PRODUCTION_ENV });
    logger[info.severity](`Mercado Pago recusou ${action}`, { tipo: info.kind, status: info.status, erro: info.raw });
    throw fail("failed-precondition", info.text);
  }
}

// Liga com plano pago em vigor (dentro da validade, incluindo a tolerância técnica).
const hasActivePlan = league => Date.parse(league?.subscriptionActiveUntil) > Date.now();

exports.createMonthlySubscription = onCall({ ...CALLABLE, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const payerEmail = await requireLeagueAdminWithEmail(auth, liga);

  // Uma segunda assinatura mensal por cima de um plano em vigor seria cobrança em duplicidade
  // sem ganho nenhum. Quem quer ampliar o plano usa "Estender plano" (createAnnualPayment).
  if (hasActivePlan((await db.doc(`leagues/${liga}`).get()).data())) {
    throw fail("failed-precondition", "Esta liga já tem um plano ativo. Para ampliá-lo, use \"Estender plano\".");
  }

  // payer_email é obrigatório para este tipo de assinatura (o SDK marca como opcional,
  // mas a API recusa sem ele: "payer_email is required"). Em teste, se o Access Token for
  // de uma conta de teste, o Mercado Pago exige que este e-mail também seja de uma conta
  // de teste ("Both payer and collector must be real or test users") — isso nunca ocorre
  // em produção, onde as duas pontas já são contas reais.
  const result = await callMp("a criação da assinatura mensal", () => new PreApproval(mpClient()).create({
    body: {
      reason: `Pelada na Mão — ${MP_PLANS.monthly.label}`,
      external_reference: liga,
      payer_email: payerEmail,
      back_url: `${ENV.appUrl}?mpReturn=${encodeURIComponent(liga)}`,
      notification_url: MERCADOPAGO_WEBHOOK_URL,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: MP_PLANS.monthly.amount,
        currency_id: "BRL",
      },
    },
  }));
  await recordCheckoutStart(liga, "monthly");
  return { initPoint: result.init_point };
});

exports.createAnnualPayment = onCall({ ...CALLABLE, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  const payerEmail = await requireLeagueAdminWithEmail(auth, liga);

  // Liga com plano em vigor: o pagamento estende o plano (soma 12 meses ao vencimento). O título
  // aparece na tela de pagamento do Mercado Pago e no extrato de quem paga.
  const extending = hasActivePlan((await db.doc(`leagues/${liga}`).get()).data());

  const result = await callMp("a criação da cobrança anual", () => new Preference(mpClient()).create({
    body: {
      items: [{
        id: `annual-${liga}`,
        title: extending ? "Pelada na Mão — Estender plano (+12 meses)" : `Pelada na Mão — ${MP_PLANS.annual.label}`,
        quantity: 1,
        unit_price: MP_PLANS.annual.amount,
        currency_id: "BRL",
      }],
      external_reference: liga,
      payer: { email: payerEmail },
      back_urls: {
        success: `${ENV.appUrl}?mpReturn=${encodeURIComponent(liga)}`,
        pending: `${ENV.appUrl}?mpReturn=${encodeURIComponent(liga)}`,
        failure: `${ENV.appUrl}?mpReturn=${encodeURIComponent(liga)}`,
      },
      auto_return: "approved",
      notification_url: MERCADOPAGO_WEBHOOK_URL,
    },
  }));
  await recordCheckoutStart(liga, "annual");
  return { initPoint: result.init_point };
});

const DAY_MS = 86400000;

// Data real da próxima cobrança de uma assinatura mensal (ISO). Sem a data, assume um ciclo
// de 30 dias: assinatura autorizada sempre tem cobrança prevista.
function monthlyRenewsAt(pre) {
  const d = pre?.next_payment_date ? new Date(pre.next_payment_date) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date(Date.now() + 30 * DAY_MS).toISOString();
}

// Pagamento aprovado do plano anual? O valor é o que distingue das cobranças mensais da
// assinatura (R$ 29,90): sem isso, uma cobrança mensal notificada como "payment"
// concederia um ano inteiro de acesso.
function isApprovedAnnualPayment(p) {
  return p?.status === "approved"
    && p.operation_type !== "recurring_payment"
    && Math.abs(Number(p.transaction_amount) - MP_PLANS.annual.amount) < 0.005;
}

const approvedAtOf = p => new Date(p.date_approved || p.date_created || Date.now());

// Soma meses de calendário a uma data ISO, sem estourar o fim do mês (29/02 + 12 meses = 28/02).
function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}

// Pagamentos anuais aprovados a partir desta data SOMAM 12 meses ao vencimento da liga e ficam
// registrados em billing_payments (applyAnnualPayment). Os anteriores — só de teste — seguem a
// regra antiga, "um ano a partir da aprovação" (annualRenewsAt): sem registro, somá-los de novo
// dobraria um período que já foi concedido.
const ANNUAL_STACKING_FROM = "2026-10-05T12:00:00.000Z";

// Regra antiga do plano anual: um ano a partir da APROVAÇÃO, não de "agora" — assim repetir a
// consulta ou a notificação meses depois não renova de graça o mesmo pagamento.
function annualRenewsAt(p) {
  return new Date(approvedAtOf(p).getTime() + 365 * DAY_MS).toISOString();
}

// Plano ativado: os campeonatos feitos no plano gratuito voltam a contar (títulos, ranking e conquistas): ver
// recover-free.js. Roda DEPOIS da ativação e nunca a derruba: se falhar ou o tempo acabar, o que sobrou fica para o
// botão "Recuperar" da aba Histórico (o app mostra quantos faltam) ou para a próxima ativação.
const RECOVER_ON_ACTIVATION_MS = 8000;
async function recoverAfterActivation(liga) {
  try {
    const r = await recoverFree({ db, liga, budgetMs: RECOVER_ON_ACTIVATION_MS });
    if (r.found) logger.info("Campeonatos do plano gratuito recuperados ao ativar o plano", { liga, ...r });
  } catch (e) {
    logger.warn("Não foi possível recuperar agora os campeonatos do plano gratuito (o plano foi ativado)", { liga, erro: String(e?.message || e) });
  }
}

// Marca a liga como paga a partir da data real da próxima cobrança (renewsAt — é o que a
// UI mostra ao usuário). subscriptionActiveUntil soma a margem técnica de tolerância e é
// só o que controla acesso (isLeagueFree), nunca exibido. Chamado pelo webhook, pelo
// fallback e pela reconciliação, sempre depois de confirmar a cobrança diretamente com a
// API do Mercado Pago (nunca a partir de dados que vêm só na notificação, que podem ser
// forjados). Devolve true só quando gravou algo novo.
async function activateSubscription(liga, plan, renewsAt) {
  if (!LEAGUE_ID_RE.test(String(liga || ""))) return false; // sem external_reference válido: nada a fazer
  const activeUntil = new Date(new Date(renewsAt).getTime() + SUBSCRIPTION_GRACE_DAYS * DAY_MS).toISOString();
  if (new Date(activeUntil).getTime() <= Date.now()) return false; // pagamento antigo: já venceu
  const ref = db.doc(`leagues/${liga}`);
  const snap = await ref.get();
  if (!snap.exists) { logger.warn("Assinatura de liga inexistente ignorada", { liga }); return false; }
  const cur = snap.data();
  if (cur.subscriptionPlan === plan && cur.subscriptionRenewsAt === renewsAt && cur.subscriptionActiveUntil === activeUntil) return false;
  // Plano diferente com validade maior já vigente (ex.: anual em dia e uma assinatura mensal
  // esquecida): não rebaixa o que a liga já pagou.
  if (cur.subscriptionPlan && cur.subscriptionPlan !== plan && cur.subscriptionActiveUntil > activeUntil) return false;
  // Uma assinatura autorizada, ou um pagamento aprovado, desfaz o "cancelada" de uma assinatura mensal anterior.
  await ref.update({ subscriptionActiveUntil: activeUntil, subscriptionRenewsAt: renewsAt, subscriptionPlan: plan, subscriptionCancelledAt: FieldValue.delete() });
  logger.info("Assinatura ativada", { liga, plan, renewsAt, activeUntil });
  await recoverAfterActivation(liga);
  return true;
}

// Pagamento anual aprovado → SOMA 12 meses ao vencimento atual da liga ("Estender plano"). Quem
// ainda tem plano em vigor continua de onde parou; quem não tem (ou já venceu) conta a partir
// da aprovação do pagamento. Cada pagamento do Mercado Pago só é somado uma vez: o registro em
// billing_payments/{id} é gravado na mesma transação que a data nova, então repetir a
// notificação, a consulta ou a reconciliação não soma de novo. Devolve true só quando somou.
async function applyAnnualPayment(liga, payment) {
  if (!LEAGUE_ID_RE.test(String(liga || ""))) return false; // sem external_reference válido: nada a fazer
  const paymentId = String(payment?.id ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) { logger.warn("Pagamento anual sem identificador válido ignorado", { liga }); return false; }
  const approvedAt = approvedAtOf(payment).toISOString();
  const ref = db.doc(`leagues/${liga}`);
  const recordRef = ref.collection("billing_payments").doc(paymentId);

  const applied = await db.runTransaction(async tx => {
    const [leagueSnap, recordSnap] = await Promise.all([tx.get(ref), tx.get(recordRef)]);
    if (!leagueSnap.exists) { logger.warn("Pagamento de liga inexistente ignorado", { liga }); return null; }
    if (recordSnap.exists) return null; // este pagamento já foi somado
    const cur = leagueSnap.data();
    const stillValid = Date.parse(cur.subscriptionRenewsAt) > Date.parse(approvedAt);
    const renewsAt = addMonths(stillValid ? cur.subscriptionRenewsAt : approvedAt, 12);
    const activeUntil = new Date(Date.parse(renewsAt) + SUBSCRIPTION_GRACE_DAYS * DAY_MS).toISOString();
    if (Date.parse(activeUntil) <= Date.now()) return null; // pagamento muito antigo: o período dele já acabou
    tx.set(recordRef, {
      paymentId, approvedAt, amount: Number(payment.transaction_amount), appliedAt: new Date().toISOString(),
      renewsAtBefore: stillValid ? cur.subscriptionRenewsAt : null, renewsAtAfter: renewsAt,
    });
    tx.update(ref, { subscriptionPlan: "annual", subscriptionRenewsAt: renewsAt, subscriptionActiveUntil: activeUntil, subscriptionCancelledAt: FieldValue.delete() });
    return { renewsAt, extended: stillValid };
  });
  if (!applied) return false;
  logger.info("Pagamento anual somado ao plano", { liga, paymentId, renewsAt: applied.renewsAt, estendeu: applied.extended });
  await recoverAfterActivation(liga);
  return true;
}

// Credita à liga um pagamento anual aprovado, conferido na API do Mercado Pago. Devolve true só
// quando gravou algo novo.
async function creditAnnualPayment(payment) {
  const liga = String(payment?.external_reference || "");
  if (approvedAtOf(payment).getTime() < Date.parse(ANNUAL_STACKING_FROM)) {
    return activateSubscription(liga, "annual", annualRenewsAt(payment)); // regra antiga (ver ANNUAL_STACKING_FROM)
  }
  return applyAnnualPayment(liga, payment);
}

// Assinaturas (mensais) da liga no Mercado Pago, em qualquer estado menos "cancelada". A busca é
// paginada e confere external_reference de cada resultado: o filtro da API não é confiável o
// bastante para cancelar com base só nele a assinatura de outra liga.
async function searchOpenPreapprovals(client, liga) {
  const open = [];
  for (let page = 0; page < 20; page++) {
    const res = await new PreApproval(client).search({
      options: { external_reference: liga, sort: "date_created:desc", limit: 50, offset: page * 50 },
    });
    const items = res?.results || [];
    open.push(...items.filter(r => String(r.external_reference) === liga && r.status !== "cancelled"));
    if (items.length < 50) break;
  }
  return open;
}

const mpStepError = (step, message) => Object.assign(new Error(message), { step });

// Traz para a liga o que o Mercado Pago sabe agora das assinaturas mensais autorizadas dela: a data da
// próxima cobrança, que a liga só aprendia na reconciliação (a cada 6 horas). Importa antes de somar
// um pagamento anual e antes de cancelar a mensal: se o Mercado Pago acabou de cobrar mais um mês,
// esse mês já pago não pode se perder. Devolve as assinaturas autorizadas encontradas.
async function syncMonthly(client, liga) {
  if (!LEAGUE_ID_RE.test(String(liga || ""))) return [];
  const res = await new PreApproval(client).search({
    options: { external_reference: liga, status: "authorized", sort: "date_created:desc", limit: 10 },
  });
  const authorized = (res?.results || []).filter(r => String(r.external_reference) === liga && r.status === "authorized");
  if (authorized.length) await activateSubscription(liga, "monthly", authorized.map(monthlyRenewsAt).sort().pop());
  return authorized;
}

// Cancela toda assinatura mensal da liga que ainda não esteja cancelada. Devolve quantas eram. Se
// o Mercado Pago falhar, lança um erro com `step`: "search" (não deu para conferir as assinaturas)
// ou "cancel" (não deu para cancelar uma delas) — cada chamador diz a mensagem certa. Com
// `keepPaidPeriod`, antes de cancelar grava na liga a data da próxima cobrança que o Mercado Pago
// informa (a "validade" que a pessoa já pagou): depois de cancelada ela deixa de existir.
async function cancelOpenPreapprovals(liga, { keepPaidPeriod = false } = {}) {
  const client = mpClient();
  let open;
  try {
    open = await searchOpenPreapprovals(client, liga);
  } catch (e) {
    logger.warn("Falha ao consultar as assinaturas da liga no Mercado Pago", { liga, erro: e?.message });
    throw mpStepError("search", "Não foi possível consultar as assinaturas no Mercado Pago.");
  }
  if (keepPaidPeriod) {
    const authorized = open.filter(p => p.status === "authorized");
    if (authorized.length) await activateSubscription(liga, "monthly", authorized.map(monthlyRenewsAt).sort().pop());
  }
  for (const pre of open) {
    try {
      await new PreApproval(client).update({ id: pre.id, body: { status: "cancelled" } });
    } catch (e) {
      logger.warn("O Mercado Pago não cancelou uma assinatura da liga", { liga, status: pre.status, erro: e?.message });
      // Assinatura ainda "pending" (checkout aberto e nunca concluído) não cobra nada; qualquer outra, sim.
      if (pre.status !== "pending") throw mpStepError("cancel", "Não foi possível cancelar a assinatura no Mercado Pago.");
    }
  }
  return open.length;
}

// Liga com plano anual em vigor e uma assinatura mensal que ainda cobraria = cobrança em dobro.
// Cancela as mensais autorizadas. É seguro cancelar todas porque quem chama já passou pela
// assinatura mensal (activateSubscription, que fica com a de validade mais longa): se alguma
// durasse mais que o anual, a liga estaria no plano mensal e esta função não faria nada. `pres` são
// as assinaturas autorizadas da liga, quando quem chama já as buscou. Nunca lança: o que não der
// agora a reconciliação tenta de novo. Devolve quantas cancelou.
async function cancelCoveredMonthlies(liga, pres) {
  try {
    if (!LEAGUE_ID_RE.test(String(liga || ""))) return 0;
    const league = (await db.doc(`leagues/${liga}`).get()).data();
    if (league?.subscriptionPlan !== "annual" || !hasActivePlan(league)) return 0;
    const client = mpClient();
    let authorized = pres;
    if (!authorized) {
      const res = await new PreApproval(client).search({
        options: { external_reference: liga, status: "authorized", sort: "date_created:desc", limit: 10 },
      });
      authorized = (res?.results || []).filter(r => String(r.external_reference) === liga && r.status === "authorized");
    }
    let canceled = 0;
    for (const pre of authorized) {
      try {
        await new PreApproval(client).update({ id: pre.id, body: { status: "cancelled" } });
        canceled++;
        logger.info("Assinatura mensal cancelada: o plano anual da liga já cobre o período", { liga, assinatura: pre.id });
      } catch (e) {
        logger.error("Não foi possível cancelar a assinatura mensal que o plano anual substituiu; a reconciliação tenta de novo", { liga, assinatura: pre.id, erro: e?.message });
      }
    }
    return canceled;
  } catch (e) {
    logger.error("Não foi possível conferir se há assinatura mensal a cancelar; a reconciliação tenta de novo", { liga, erro: e?.message });
    return 0;
  }
}

// Fallback do webhook: o app chama isto quando o admin volta do checkout do Mercado
// Pago (ver back_url/back_urls acima), caso a notificação ainda não tenha chegado ou
// tenha se perdido. Consulta a API do Mercado Pago diretamente (nunca confia em nada que
// o navegador do admin possa ter enviado) e ativa a liga se encontrar uma assinatura ou
// pagamento confirmado — idempotente, seguro para repetir.
exports.checkSubscriptionStatus = onCall({ ...CALLABLE, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  const liga = leagueIdOf(request.data);
  await requireLeagueAdminWithEmail(auth, liga);

  const client = mpClient();

  // A busca de assinaturas espera o campo e a direção combinados numa única string
  // ("date_created:desc") — diferente da busca de pagamentos abaixo, que usa sort/criteria
  // separados. Confirmado em teste real: "date_created" sozinho dá "Invalid sorting value".
  const preResult = await callMp("a consulta de assinaturas", () => new PreApproval(client).search({
    options: { external_reference: liga, status: "authorized", sort: "date_created:desc", limit: 10 },
  }));
  const authorized = (preResult?.results || []).filter(r => String(r.external_reference) === liga);

  const paymentResult = await callMp("a consulta de pagamentos", () => new Payment(client).search({
    options: { external_reference: liga, sort: "date_created", criteria: "desc", limit: 20 },
  }));
  const annualPayments = (paymentResult?.results || []).filter(r => r.external_reference === liga && isApprovedAnnualPayment(r));

  // A assinatura mensal primeiro: o pagamento anual soma 12 meses ao vencimento que ela já deu.
  // Havendo mensal e anual, vale a de validade mais longa (activateSubscription não rebaixa).
  if (authorized.length) await activateSubscription(liga, "monthly", authorized.map(monthlyRenewsAt).sort().pop());
  // Cada pagamento anual soma uma vez; do mais antigo ao mais novo, para o resultado não depender da ordem da busca.
  for (const p of annualPayments.sort((a, b) => approvedAtOf(a) - approvedAtOf(b))) await creditAnnualPayment(p);
  await cancelCoveredMonthlies(liga, authorized);

  // Responde com o plano que a liga tem agora; o app compara a data com a de antes do pagamento
  // (numa liga que já tinha plano, "ativo" sozinho não diz se o pagamento novo já entrou).
  const league = (await db.doc(`leagues/${liga}`).get()).data();
  if (!hasActivePlan(league)) return { status: "pending" };
  return { status: "active", plan: league.subscriptionPlan, renewsAt: league.subscriptionRenewsAt };
});

// Cancela a assinatura mensal pelo app: a pessoa não precisa ir à conta do Mercado Pago. A liga
// segue com o plano até o fim do período já pago (subscriptionRenewsAt) e depois volta ao plano
// gratuito; o app mostra "cancelada" por causa de subscriptionCancelledAt. O plano anual não
// renova sozinho, então não há o que cancelar nele. Se o Mercado Pago não confirmar, nada é
// marcado como cancelado.
exports.cancelSubscription = onCall({ ...CALLABLE, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  await checkRateLimit(auth.uid, "cancelSubscription", 5);
  const liga = leagueIdOf(request.data);
  await requireLeagueAdmin(auth, liga);

  const ref = db.doc(`leagues/${liga}`);
  const league = (await ref.get()).data();
  if (!league) throw fail("not-found", "Liga não encontrada.");

  let canceled;
  try {
    canceled = await cancelOpenPreapprovals(liga, { keepPaidPeriod: true });
  } catch (e) {
    if (e?.step === "search") throw fail("failed-precondition", "Não foi possível conferir a assinatura no Mercado Pago agora. Tente de novo em alguns minutos.");
    if (e?.step === "cancel") throw fail("failed-precondition", "Não foi possível cancelar a assinatura no Mercado Pago agora. Tente de novo em alguns minutos.");
    throw e;
  }

  if (league.subscriptionPlan === "monthly" && !league.subscriptionCancelledAt) {
    await ref.update({ subscriptionCancelledAt: new Date().toISOString() });
  }
  logger.info("Assinatura mensal cancelada pelo app", { liga, assinaturas: canceled });
  return { ok: true, canceled };
});

// Rede de segurança do servidor: não depende do webhook nem de o admin voltar ao site.
// Mantém em dia a data da próxima cobrança das assinaturas mensais (é isso que renova a
// liga a cada mês — o webhook só avisa de mudanças de status) e ativa pagamentos cuja
// notificação se perdeu. Idempotente: só grava quando algo mudou.
exports.reconcileSubscriptions = onSchedule(
  { schedule: "every 6 hours", timeZone: "America/Sao_Paulo", region: "us-east1", secrets: [MERCADOPAGO_ACCESS_TOKEN], timeoutSeconds: 300 },
  async () => {
    const client = mpClient();
    let monthly = 0, annual = 0, canceled = 0;

    // Uma liga pode ter mais de uma assinatura autorizada (assinou duas vezes): vale a de
    // validade mais longa, gravada uma única vez — sem ficar alternando entre as duas.
    const byLeague = new Map(); // liga -> assinaturas autorizadas
    for (let page = 0; page < 20; page++) {
      const res = await new PreApproval(client).search({
        options: { status: "authorized", sort: "date_created:desc", limit: 50, offset: page * 50 },
      });
      const items = res?.results || [];
      for (const pre of items) {
        const liga = String(pre.external_reference || "");
        if (!byLeague.has(liga)) byLeague.set(liga, []);
        byLeague.get(liga).push(pre);
      }
      if (items.length < 50) break;
    }
    // Assinaturas antes dos pagamentos anuais: o pagamento soma 12 meses ao vencimento que a mensal já deu.
    for (const [liga, pres] of byLeague) {
      if (await activateSubscription(liga, "monthly", pres.map(monthlyRenewsAt).sort().pop())) monthly++;
    }

    const paid = await new Payment(client).search({
      options: {
        status: "approved", sort: "date_approved", criteria: "desc", range: "date_approved", limit: 50,
        begin_date: new Date(Date.now() - 3 * DAY_MS).toISOString(), end_date: new Date().toISOString(),
      },
    });
    const annualPayments = (paid?.results || []).filter(isApprovedAnnualPayment).sort((a, b) => approvedAtOf(a) - approvedAtOf(b));
    for (const p of annualPayments) {
      if (await creditAnnualPayment(p)) annual++;
    }

    // Rede de segurança do cancelamento automático: mensal que o plano anual já cobre e que ainda cobraria.
    for (const [liga, pres] of byLeague) canceled += await cancelCoveredMonthlies(liga, pres);

    logger.info("Reconciliação de assinaturas concluída", { monthly, annual, mensaisCanceladas: canceled });
  }
);

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
      // Notificações de assinatura (preapproval) do Mercado Pago às vezes chegam sem o
      // cabeçalho x-signature (comportamento observado do provedor, fora do nosso controle).
      // Não tratamos isso como inseguro: abaixo nunca confiamos no corpo da notificação, o
      // status é sempre reconfirmado direto na API do Mercado Pago com nosso Access Token
      // secreto antes de ativar qualquer coisa — a notificação só diz "vá conferir". Já uma
      // assinatura presente e incorreta (possível adulteração ou segredo errado) continua
      // sendo recusada.
      if (e?.reason !== "MissingSignatureHeader") {
        logger.warn("Webhook do Mercado Pago com assinatura inválida", { erro: e?.message, reason: e?.reason });
        res.status(401).send("invalid signature");
        return;
      }
      logger.warn("Webhook do Mercado Pago sem cabeçalho de assinatura: prosseguindo, status será reconfirmado na API", { erro: e?.message });
    }

    const topic = req.query.type || req.query.topic;
    const id = req.query["data.id"] || req.body?.data?.id;
    try {
      const client = mpClient();
      if (topic === "subscription_preapproval" || topic === "preapproval") {
        const result = await new PreApproval(client).get({ id });
        if (result.status === "authorized") {
          await activateSubscription(result.external_reference, "monthly", monthlyRenewsAt(result));
        }
      } else if (topic === "payment") {
        // Só o pagamento do plano anual ativa por aqui; cobranças mensais da assinatura
        // também chegam como "payment" e são tratadas pela assinatura e pela reconciliação.
        const result = await new Payment(client).get({ id });
        if (isApprovedAnnualPayment(result)) {
          const liga = String(result.external_reference || "");
          // A assinatura mensal primeiro, com o que o Mercado Pago sabe agora (como na consulta do app): o
          // anual soma 12 meses ao vencimento que ela já deu, mesmo que a liga ainda não tenha aprendido
          // da última cobrança mensal.
          const authorized = await syncMonthly(client, liga);
          await creditAnnualPayment(result);
          // Quem pagava o mensal e estendeu o plano não pode ser cobrado de novo (nunca lança).
          await cancelCoveredMonthlies(liga, authorized);
        }
      }
      res.status(200).send("ok");
    } catch (e) {
      logger.error("Falha ao processar webhook do Mercado Pago", { erro: e?.message, topic, id });
      res.status(500).send("error");
    }
  }
);

// ── Encerrar liga ────────────────────────────────────────────────────────────────────────
//
// Apaga a liga e tudo o que há dentro dela (elenco, campeonatos, financeiro, contatos, fotos,
// convites…) e tira o vínculo de todos os membros. É o "um Admin pode encerrar sua própria
// Liga a qualquer momento" dos Termos de Uso. Quem pode: o criador da liga (ownerId); se ele
// já não é admin dela, ou a liga é antiga e não guarda o criador, qualquer admin; e o dono do
// sistema.
//
// A ordem foi pensada para ninguém continuar pagando por uma liga que já não existe e para a
// função poder ser repetida se algo falhar no meio:
//  1) cancela, no Mercado Pago, toda assinatura ligada à liga — se não conseguir, para aqui,
//     sem ter apagado nada;
//  2) marca a liga como "em encerramento" (closingBy): só quem iniciou pode repetir, mesmo
//     depois de perder o vínculo no passo seguinte;
//  3) tira o vínculo de todos os membros: perdem o acesso na hora e nada mais é gravado na liga
//     enquanto ela é apagada;
//  4) apaga a liga com tudo o que há dentro. O documento da liga é o último a sair, então
//     "a liga ainda existe" quer dizer "o encerramento não terminou" e pode ser retomado.
// As fotos vão embora do Cloudinary pelo gatilho onPlayerPhotoDeleted, como em qualquer outra
// exclusão de foto; os gatilhos de campeonato, cobrança e lembrete ignoram exclusões, então
// ninguém recebe notificação por causa disto.

async function requireCanCloseLeague(auth, liga, league) {
  if (isOwner(auth)) return;
  if (league.closingBy === auth.uid) return; // retomando um encerramento que ele mesmo começou
  const me = (await db.doc(`users/${auth.uid}`).get()).data();
  if (me?.leagues?.[liga]?.role !== "admin") {
    throw fail("permission-denied", "Somente administradores da liga podem encerrá-la.");
  }
  const ownerId = league.ownerId;
  if (!ownerId || ownerId === auth.uid) return;
  const owner = (await db.doc(`users/${ownerId}`).get()).data();
  if (owner?.leagues?.[liga]?.role === "admin") {
    throw fail("permission-denied", "Só quem criou a liga pode encerrá-la.");
  }
}

// Cancela as assinaturas da liga no Mercado Pago (ver cancelOpenPreapprovals) e traduz uma falha
// para o erro que o app mostra ao encerrar a liga. Devolve quantas eram.
async function cancelLeagueSubscriptions(liga) {
  try {
    return await cancelOpenPreapprovals(liga);
  } catch (e) {
    if (e?.step === "search") throw fail("failed-precondition", "Não foi possível conferir a assinatura da liga no Mercado Pago agora. Nada foi apagado — tente de novo em alguns minutos.");
    if (e?.step === "cancel") throw fail("failed-precondition", "Não foi possível cancelar a assinatura da liga no Mercado Pago agora. Nada foi apagado — tente de novo em alguns minutos.");
    throw e;
  }
}

exports.deleteLeague = onCall({ ...CALLABLE, timeoutSeconds: 300, secrets: [MERCADOPAGO_ACCESS_TOKEN] }, async request => {
  const auth = requireAuth(request);
  await checkRateLimit(auth.uid, "deleteLeague", 5);
  const liga = leagueIdOf(request.data);
  if (request.data?.confirm !== true) throw fail("invalid-argument", "Confirmação ausente.");

  const leagueRef = db.doc(`leagues/${liga}`);
  const leagueSnap = await leagueRef.get();
  if (!leagueSnap.exists) throw fail("not-found", "Liga não encontrada.");
  await requireCanCloseLeague(auth, liga, leagueSnap.data());

  const subscriptions = await cancelLeagueSubscriptions(liga);

  await leagueRef.update({ closingBy: auth.uid, closingAt: new Date().toISOString() });

  const members = await db.collection("users").where(new FieldPath("leagues", liga, "role"), "in", MEMBER_ROLES).get();
  for (const chunk of chunksOf(members.docs, 400)) {
    const batch = db.batch();
    chunk.forEach(d => batch.update(d.ref, new FieldPath("leagues", liga), FieldValue.delete()));
    await batch.commit();
  }

  await db.recursiveDelete(leagueRef);
  logger.info("deleteLeague concluída", { liga, membros: members.size, assinaturasCanceladas: subscriptions });
  return { ok: true };
});

// ── Avisos de cobrança por e-mail ────────────────────────────────────────────────────────
//
// Uma vez por dia confere as ligas com plano pago e avisa os admins por e-mail (Resend):
//  • plano anual, que não renova sozinho: lembrete 30 e 7 dias antes de vencer;
//  • plano que acabou (anual vencido, ou mensal que não renovou — por exemplo, cobrança
//    recusada): a liga voltou ao plano gratuito. Avisa uma vez, até 7 dias depois do fim; o que
//    acabou há mais tempo não gera aviso (evita avisar de coisa velha na 1ª execução ou depois
//    de uma pane).
// O que já foi avisado fica em leagues/{liga}.billingNotices, amarrado ao ciclo
// (subscriptionActiveUntil): um novo pagamento muda o ciclo e libera avisos novos. Só o
// servidor grava esse campo (as regras só deixam o admin alterar o nome da liga).
const APP_URL = ENV.appUrl;
const CONTACT_EMAIL = "contato@peladanamao.com.br";
const BILLING_REMINDER_DAYS = [7, 30]; // do menor para o maior
const BILLING_ENDED_WINDOW_DAYS = 7;

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBR = iso => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Que aviso (se algum) esta liga deve receber agora. Função pura: só olha os dados da liga.
function billingNoticeFor(league, nowMs) {
  const plan = league?.subscriptionPlan;
  if (plan !== "monthly" && plan !== "annual") return null;
  const cycle = league.subscriptionActiveUntil;
  const activeUntilMs = Date.parse(cycle);
  if (!cycle || Number.isNaN(activeUntilMs)) return null;
  const renewsAt = league.subscriptionRenewsAt || cycle; // a data que a tela mostra (sem a tolerância de 1 dia)
  const sent = league.billingNotices || {};

  if (activeUntilMs <= nowMs) { // o plano acabou
    if (nowMs - activeUntilMs > BILLING_ENDED_WINDOW_DAYS * DAY_MS) return null;
    if (Date.parse(league.trialEndsAt) > nowMs) return null; // ainda no teste grátis: a liga segue completa
    if (league.subscriptionCancelledAt) return null; // a assinatura foi cancelada de propósito, no app: não há o que avisar
    if (sent.ended === cycle) return null;
    return { kind: "ended", plan, field: "ended", cycle, renewsAt };
  }

  if (plan !== "annual") return null; // o mensal renova sozinho: só avisa quando falha
  const daysLeft = Math.ceil((Date.parse(renewsAt) - nowMs) / DAY_MS);
  if (!(daysLeft >= 1)) return null; // vencendo hoje (dentro da tolerância): o aviso de "venceu" vem em seguida
  const stage = BILLING_REMINDER_DAYS.find(d => daysLeft <= d);
  if (!stage) return null;
  const field = `annual${stage}`;
  if (sent[field] === cycle) return null;
  return { kind: "reminder", plan, stage, field, cycle, renewsAt, daysLeft };
}

// Avisos do TESTE GRÁTIS (só para liga sem plano pago em vigor): um lembrete faltando até 3 dias e,
// se o teste acabar sem assinatura, um aviso de que a liga está no plano gratuito (até 7 dias
// depois do fim; o que acabou há mais tempo não gera aviso). Amarrados à data do teste
// (trialEndsAt), do mesmo jeito que os avisos do plano pago são amarrados ao ciclo.
const TRIAL_REMINDER_DAYS = 3;
const TRIAL_ENDED_WINDOW_DAYS = 7;

function trialNoticeFor(league, nowMs) {
  const trialEndsMs = Date.parse(league?.trialEndsAt);
  if (Number.isNaN(trialEndsMs)) return null; // liga antiga, sem data de teste: nunca "acaba"
  if (Date.parse(league.subscriptionActiveUntil) > nowMs) return null; // já tem plano pago em vigor
  const cycle = league.trialEndsAt;
  const sent = league.billingNotices || {};
  if (trialEndsMs > nowMs) { // teste em andamento
    const daysLeft = Math.ceil((trialEndsMs - nowMs) / DAY_MS);
    if (daysLeft > TRIAL_REMINDER_DAYS || sent.trialSoon === cycle) return null;
    return { kind: "trialSoon", plan: null, field: "trialSoon", cycle, renewsAt: cycle, daysLeft };
  }
  if (nowMs - trialEndsMs > TRIAL_ENDED_WINDOW_DAYS * DAY_MS || sent.trialEnded === cycle) return null;
  return { kind: "trialEnded", plan: null, field: "trialEnded", cycle, renewsAt: cycle };
}

// Monta assunto, HTML e texto simples. Os valores variáveis ({nome}, {data}) entram DEPOIS de o
// texto fixo ser escapado e de o **negrito** virar marcação, então nada que venha de uma liga
// (como o nome) consegue criar marcação no e-mail.
function billingEmailContent(notice, leagueName) {
  const vars = { nome: leagueName, data: fmtBR(notice.renewsAt) };
  const how = "Para continuar com todos os recursos, abra o aplicativo, toque em 💳 Assinatura e escolha o plano.";
  const history = "O histórico de campeonatos, títulos e estatísticas continua guardado.";
  const money = n => `R$ ${n.toFixed(2).replace(".", ",")}`;
  const plans = `Para manter tudo liberado, abra o aplicativo, toque em 💳 Assinatura e escolha o plano: **${money(MP_PLANS.monthly.amount)} por mês** (sem fidelidade: dá para cancelar pelo próprio aplicativo) ou **${money(MP_PLANS.annual.amount)} por ano** (equivale a ${money(MP_PLANS.annual.amount / 12)} por mês, uma economia de ${money(MP_PLANS.monthly.amount * 12 - MP_PLANS.annual.amount)} por ano).`;
  const freePlan = "dá para criar campeonatos, convocar, sortear os times e registrar o placar, e o histórico, o ranking e as conquistas de antes continuam lá. Ficam pausados o registro de quem fez os gols, o ranking e as conquistas novas — e **os campeonatos criados no plano gratuito só passam a contar para títulos, ranking e conquistas quando a liga assinar: aí eles são recuperados** (os gols deles não foram registrados e não voltam).";
  let subject, paragraphs;
  if (notice.kind === "trialSoon") {
    const falta = notice.daysLeft === 1 ? "falta 1 dia" : `faltam ${notice.daysLeft} dias`;
    subject = `O teste grátis da liga "${leagueName}" acaba em ${vars.data}`;
    paragraphs = [
      `O teste grátis da liga **{nome}** no Pelada na Mão acaba em **{data}** (${falta}).`,
      plans,
      `Se o teste acabar sem assinatura, a liga continua funcionando no plano gratuito: ${freePlan}`,
    ];
  } else if (notice.kind === "trialEnded") {
    subject = `O teste grátis da liga "${leagueName}" acabou`;
    paragraphs = [
      `O teste grátis da liga **{nome}** no Pelada na Mão acabou em **{data}**, e a liga agora está no plano gratuito.`,
      `No plano gratuito a liga continua funcionando: ${freePlan}`,
      plans,
    ];
  } else if (notice.kind === "reminder") {
    const falta = notice.daysLeft === 1 ? "falta 1 dia" : `faltam ${notice.daysLeft} dias`;
    subject = `A assinatura anual da liga "${leagueName}" vence em ${vars.data}`;
    paragraphs = [
      `A assinatura anual da liga **{nome}** no Pelada na Mão vale até **{data}** (${falta}).`,
      "A assinatura anual **não renova sozinha**. Para continuar com todos os recursos, abra o aplicativo, toque em 💳 Assinatura e depois em **Estender plano**: o novo pagamento soma 12 meses à data de vencimento atual, então você não perde nenhum dia já pago.",
      `Se não estender, a liga volta ao plano gratuito, só com os itens básicos. ${history}`,
    ];
  } else if (notice.plan === "annual") {
    subject = `A assinatura anual da liga "${leagueName}" venceu`;
    paragraphs = [
      `A assinatura anual da liga **{nome}** venceu em **{data}**, e a liga voltou ao plano gratuito, só com os itens básicos. ${history}`,
      how,
    ];
  } else {
    subject = `Não conseguimos renovar a assinatura da liga "${leagueName}"`;
    paragraphs = [
      `Não recebemos a confirmação da renovação da assinatura mensal da liga **{nome}** (a cobrança prevista era para **{data}**), e a liga voltou ao plano gratuito, só com os itens básicos. ${history}`,
      "Isso costuma acontecer quando a cobrança é recusada (cartão vencido, sem limite…) ou quando a assinatura foi cancelada no Mercado Pago. O Mercado Pago pode tentar cobrar de novo por alguns dias: se a cobrança for aprovada, a liga volta ao plano pago sozinha.",
      `Para resolver agora, confira a forma de pagamento da assinatura no Mercado Pago ou assine de novo pelo aplicativo. ${how}`,
    ];
  }
  const footer = `Você recebe este aviso por ser admin da liga {nome} no Pelada na Mão. Dúvidas: ${CONTACT_EMAIL}`;
  const fill = (s, f) => s.replace(/\{(\w+)\}/g, (_, k) => f(vars[k] ?? ""));
  const html = [
    ...paragraphs.map(p => `<p style="margin:0 0 14px;line-height:1.55">${fill(escapeHtml(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"), escapeHtml)}</p>`),
    `<p style="margin:18px 0"><a href="${APP_URL}" style="background:#00d67f;color:#000;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;display:inline-block">Abrir o Pelada na Mão</a></p>`,
    `<p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5">${fill(escapeHtml(footer), escapeHtml)}</p>`,
  ].join("");
  const text = [...paragraphs, `Abrir o Pelada na Mão: ${APP_URL}`, footer].map(p => fill(p.replace(/\*\*/g, ""), x => x)).join("\n\n");
  return { subject, html, text };
}

async function sendResendEmail({ to, subject, html, text }) {
  try {
    if (!resendConfigured()) { logger.info("Resend não configurado neste ambiente: e-mail não enviado"); return false; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to, subject: `${ENV.emailSubjectPrefix}${subject}`, html, text, reply_to: CONTACT_EMAIL }),
    });
    if (!res.ok) { logger.warn("Resend não confirmou o envio", { status: res.status }); return false; }
    return true;
  } catch (e) {
    logger.warn("Falha ao chamar a API do Resend", { erro: e?.message });
    return false;
  }
}

async function sendBillingNotices() {
  const nowMs = Date.now();
  let sent = 0;

  // Manda o aviso a todos os admins da liga. Só marca como avisado se ao menos um e-mail saiu; se
  // todos falharam, tenta de novo amanhã. Um defeito numa liga nunca impede as outras.
  const deliver = async (leagueDoc, noticeOf) => {
    try {
      const league = leagueDoc.data();
      const notice = noticeOf(league, nowMs);
      if (!notice) return;
      const admins = await db.collection("users").where(new FieldPath("leagues", leagueDoc.id, "role"), "==", "admin").get();
      const emails = [...new Set(admins.docs.map(d => d.data().email).filter(Boolean))];
      if (!emails.length) { logger.warn("Aviso de cobrança sem nenhum admin com e-mail", { liga: leagueDoc.id }); return; }
      const { subject, html, text } = billingEmailContent(notice, league.name || leagueDoc.id);
      let delivered = 0;
      for (const to of emails) if (await sendResendEmail({ to: [to], subject, html, text })) delivered++;
      if (delivered) {
        await leagueDoc.ref.update(new FieldPath("billingNotices", notice.field), notice.cycle);
        sent++;
      }
    } catch (e) {
      logger.error("Falha ao avisar sobre a cobrança de uma liga", { liga: leagueDoc.id, erro: e?.message });
    }
  };

  const paid = await db.collection("leagues").where("subscriptionPlan", "in", ["monthly", "annual"]).get();
  for (const leagueDoc of paid.docs) await deliver(leagueDoc, billingNoticeFor);

  // Teste grátis: só olha as ligas cujo teste acaba nos próximos dias ou acabou há pouco.
  const from = new Date(nowMs - TRIAL_ENDED_WINDOW_DAYS * DAY_MS).toISOString();
  const to = new Date(nowMs + TRIAL_REMINDER_DAYS * DAY_MS).toISOString();
  const trials = await db.collection("leagues").where("trialEndsAt", ">=", from).where("trialEndsAt", "<=", to).get();
  for (const leagueDoc of trials.docs) await deliver(leagueDoc, trialNoticeFor);

  logger.info("notifyBillingEmails concluída", { ligasComPlano: paid.size, ligasEmTeste: trials.size, avisosEnviados: sent });
}

exports.notifyBillingEmails = onSchedule(
  { schedule: "0 9 * * *", timeZone: "America/Sao_Paulo", region: "us-east1", secrets: [RESEND_API_KEY], timeoutSeconds: 300 },
  async () => { await sendBillingNotices(); }
);

// ── Métricas do funil (painel só do dono) ───────────────────────────────────────────────────────
// Contadores anônimos de uso (sem dado pessoal: só "quantas vezes", por dia) e um retrato diário do
// funil. As contas ficam em funnel-metrics.js; aqui só se lê e grava no banco. As coleções metrics_*
// e a subcoleção billing_meta são fechadas ao navegador (firestore.rules): só o servidor lê e escreve.

// Soma 1 a um contador do dia (horário de São Paulo). Nunca derruba quem chamou: métrica não pode
// quebrar um pagamento.
async function bumpEvent(name) {
  try {
    await db.doc(`metrics_events/${funnel.dayKeySP(Date.now())}`).set({ [name]: FieldValue.increment(1) }, { merge: true });
  } catch (e) {
    logger.warn("Falha ao contar um evento de uso", { evento: name, erro: e?.message });
  }
}

// A liga abriu o checkout (mensal ou anual): contador do dia e marca na própria liga (numa subcoleção
// fechada, que some junto com a liga em deleteLeague), para contar ligas distintas e não só cliques.
async function recordCheckoutStart(liga, kind) {
  await bumpEvent(kind === "annual" ? "checkoutAnnual" : "checkoutMonthly");
  try {
    await db.doc(`leagues/${liga}/billing_meta/checkout`).set({ starts: FieldValue.increment(1), lastAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    logger.warn("Falha ao marcar o checkout na liga", { liga, erro: e?.message });
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// Lê do banco o que o cálculo do funil precisa: as ligas (só os campos do plano e da atividade), quantos
// campeonatos cada uma tem (contagem agregada, sem baixar os campeonatos) e as contas por data.
async function gatherFunnelInputs(now) {
  const snap = await db.collection("leagues")
    .select("ownerId", "createdAt", "trialEndsAt", "subscriptionPlan", "subscriptionActiveUntil", "subscriptionCancelledAt", "lastActivityAt").get();
  const leagues = await mapLimit(snap.docs, 10, async d => {
    const [champs, meta] = await Promise.all([
      db.collection(`leagues/${d.id}/championships`).count().get(),
      db.doc(`leagues/${d.id}/billing_meta/checkout`).get(),
    ]);
    return { ...d.data(), id: d.id, championships: champs.data().count, checkoutStarts: meta.exists ? meta.data().starts : 0 };
  });
  const users = db.collection("users");
  const since = days => new Date(now - days * 86400000).toISOString();
  const count = async q => (await q.count().get()).data().count;
  const [total, last7d, last30d] = await Promise.all([
    count(users), count(users.where("createdAt", ">=", since(7))), count(users.where("createdAt", ">=", since(30))),
  ]);
  return { leagues, accounts: { total, last7d, last30d } };
}

const funnelPrices = () => ({ monthly: MP_PLANS.monthly.amount, annual: MP_PLANS.annual.amount });

// Contadores dos últimos `days` dias: { 'AAAA-MM-DD': { nome: n } } (só os dias que existem).
async function readEventsByDay(days, now) {
  const keys = funnel.lastDayKeys(days, now);
  const docs = await Promise.all(keys.map(k => db.doc(`metrics_events/${k}`).get()));
  return Object.fromEntries(keys.map((k, i) => [k, docs[i].exists ? docs[i].data() : null]).filter(([, v]) => v));
}

// Retratos diários dos últimos `days` dias, do mais antigo para o mais novo (para o painel desenhar a evolução).
async function readDailyHistory(days, now) {
  const keys = funnel.lastDayKeys(days, now).reverse();
  const docs = await Promise.all(keys.map(k => db.doc(`metrics_daily/${k}`).get()));
  return keys.map((k, i) => (docs[i].exists ? { date: k, ...docs[i].data() } : null)).filter(Boolean);
}

// O app avisa que uma pessoa viu/tocou em algo (faixa do plano, botão Instalar…). Só aceita os nomes da
// lista, só soma 1 ao contador do dia e não guarda quem foi.
exports.trackEvent = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  const name = idText(request.data?.name, 40);
  if (!funnel.EVENT_NAMES_CLIENT.includes(name)) throw fail("invalid-argument", "Evento desconhecido.");
  await checkRateLimit(auth.uid, "trackEvent", 120);
  await bumpEvent(name);
  return { ok: true };
});

// Painel do dono: o funil de agora, os contadores de uso (7 e 30 dias) e o histórico diário. Só o dono do
// sistema (e-mail verificado) vê; a resposta tem apenas contagens e valores em reais, nada pessoal.
exports.getFunnelMetrics = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  if (!isOwner(auth)) throw fail("permission-denied", "Só o dono do sistema vê as métricas.");
  await checkRateLimit(auth.uid, "getFunnelMetrics", 20);
  const now = Date.now();
  const current = funnel.computeFunnel({ ...(await gatherFunnelInputs(now)), now, prices: funnelPrices() });
  const byDay = await readEventsByDay(30, now);
  return {
    funnel: current,
    events: { last7d: funnel.sumEvents(byDay, 7, now), last30d: funnel.sumEvents(byDay, 30, now) },
    history: await readDailyHistory(60, now),
  };
});

// Todo dia de madrugada guarda um retrato do funil, para o painel mostrar a evolução (o estado de ontem não
// dá para recalcular depois: um plano que venceu hoje já não diz que estava ativo ontem).
exports.snapshotFunnelMetrics = onSchedule(
  { schedule: "30 3 * * *", timeZone: "America/Sao_Paulo", region: "us-east1", timeoutSeconds: 300 },
  async () => {
    const now = Date.now();
    const current = funnel.computeFunnel({ ...(await gatherFunnelInputs(now)), now, prices: funnelPrices() });
    const day = funnel.dayKeySP(now);
    await db.doc(`metrics_daily/${day}`).set({ ...funnel.snapshotOf(current), savedAt: new Date(now).toISOString() });
    logger.info("Retrato diário do funil gravado", { dia: day, ligas: current.leagues.total, contas: current.accounts.total });
  }
);

// ── Monitoramento de travamentos do navegador ───────────────────────────────────────────────────────────────────
// O app manda um relato curto quando algo quebra (client-errors.js tem as regras: limpeza do texto, agrupamento e
// limites). A função HTTP fica aberta à internet porque a pessoa pode estar na tela de entrada, sem login; por isso só
// aceita o endereço do próprio site, só POST pequeno, limita por endereço (só na memória da instância: o IP nunca é
// gravado nem registrado) e por dia, e qualquer problema vira resposta vazia: relatar erro nunca pode gerar mais erro.
// As coleções client_errors e client_errors_meta são fechadas ao navegador (firestore.rules): só o servidor lê e grava.
const errorLimiter = clientErrors.makeLimiter();

// Grava um relato: soma nos contadores do grupo (sem ler o grupo inteiro, então relatos simultâneos não se perdem) e
// nos do dia. Passou de 3000 relatos no dia, só entram grupos NOVOS (até 150 por dia): um defeito que se repete não
// esconde outro. Devolve "created", "updated" ou "dropped".
async function recordClientError(report, now) {
  const metaRef = db.doc(`client_errors_meta/${funnel.dayKeySP(now)}`);
  const groupRef = db.doc(`client_errors/${report.fp}`);
  const [metaSnap, groupSnap] = await db.getAll(metaRef, groupRef);
  const meta = metaSnap.exists ? metaSnap.data() : {};
  const exists = groupSnap.exists;
  const full = exists ? (meta.total || 0) >= clientErrors.MAX_REPORTS_PER_DAY : (meta.newGroups || 0) >= clientErrors.MAX_NEW_GROUPS_PER_DAY;
  if (full) { await metaRef.set({ dropped: FieldValue.increment(1) }, { merge: true }); return "dropped"; }
  await groupRef.set(clientErrors.groupWrite(report, { now, exists, increment: n => FieldValue.increment(n) }), { merge: true });
  await metaRef.set({ total: FieldValue.increment(1), ...(exists ? {} : { newGroups: FieldValue.increment(1) }) }, { merge: true });
  return exists ? "updated" : "created";
}

exports.reportClientError = onRequest(
  { region: "us-east1", maxInstances: 5, memory: "256MiB", timeoutSeconds: 15 },
  async (req, res) => {
    const origin = String(req.headers?.origin || "");
    const originOk = ENV.siteOrigins.includes(origin);
    if (originOk) { res.set("Access-Control-Allow-Origin", origin); res.set("Vary", "Origin"); }
    if (req.method === "OPTIONS") {
      if (!originOk) { res.status(403).end(); return; }
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "86400");
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") { res.set("Allow", "POST, OPTIONS"); res.status(405).end(); return; }
    if (!originOk) { res.status(403).end(); return; }
    if (Number(req.headers["content-length"] || 0) > clientErrors.MAX_BODY_BYTES) { res.status(413).end(); return; }
    const now = Date.now();
    if (!errorLimiter.allow(clientErrors.clientIp(req), now)) { res.status(429).end(); return; }
    const parsed = clientErrors.parseReport(clientErrors.bodyOf(req));
    if (!parsed.ok) { res.status(parsed.reason === "ignored" ? 204 : 400).end(); return; }
    try {
      const result = await recordClientError(parsed.report, now);
      if (result === "created") {
        logger.warn("Novo tipo de erro no navegador", { fp: parsed.report.fp, tipo: parsed.report.kind, mensagem: parsed.report.message, tela: parsed.report.view, versao: parsed.report.version });
      }
    } catch (e) {
      logger.warn("Não foi possível registrar um relato de erro do navegador", { erro: e?.message });
    }
    res.status(204).end();
  }
);

// Painel do dono: os erros do app nos últimos 14 dias (grupos, contagens por dia, versões, navegadores, telas). Só o
// dono do sistema (e-mail verificado) vê. A resposta só tem texto já limpo e números: nada de pessoa.
exports.getClientErrors = onCall(CALLABLE, async request => {
  const auth = requireAuth(request);
  if (!isOwner(auth)) throw fail("permission-denied", "Só o dono do sistema vê os erros do app.");
  await checkRateLimit(auth.uid, "getClientErrors", 20);
  const now = Date.now();
  const since = new Date(now - 14 * DAY_MS).toISOString();
  const keys = funnel.lastDayKeys(14, now);
  const [groups, metaDocs] = await Promise.all([
    db.collection("client_errors").where("lastSeen", ">=", since).orderBy("lastSeen", "desc").limit(300).get(),
    Promise.all(keys.map(k => db.doc(`client_errors_meta/${k}`).get())),
  ]);
  const meta = Object.fromEntries(keys.map((k, i) => [k, metaDocs[i].exists ? metaDocs[i].data() : null]).filter(([, v]) => v));
  return { ok: true, generatedAt: new Date(now).toISOString(), ...clientErrors.summarize(groups.docs.map(d => ({ id: d.id, ...d.data() })), meta, now) };
});

// Apaga o que ficou velho: grupos sem relato novo há 45 dias e os contadores diários de mais de 60 dias.
async function pruneClientErrors(now) {
  const cutoff = new Date(now - clientErrors.KEEP_GROUP_DAYS * DAY_MS).toISOString();
  const old = await db.collection("client_errors").where("lastSeen", "<", cutoff).limit(400).get();
  await Promise.all(old.docs.map(d => d.ref.delete()));
  const metaCutoff = funnel.dayKeySP(now - clientErrors.KEEP_META_DAYS * DAY_MS);
  const oldMeta = await db.collection("client_errors_meta").where(FieldPath.documentId(), "<", metaCutoff).limit(400).get();
  await Promise.all(oldMeta.docs.map(d => d.ref.delete()));
  return { gruposApagados: old.size, diasApagados: oldMeta.size };
}

// Resumo diário por e-mail para o dono: só quando há erro NOVO ou uma alta repentina (nada de e-mail em dia calmo).
async function sendClientErrorDigest(now = Date.now()) {
  const since = new Date(now - 3 * DAY_MS).toISOString();
  const snap = await db.collection("client_errors").where("lastSeen", ">=", since).get();
  const groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const picks = clientErrors.digestPicks(groups, now);
  let sent = false;
  if (picks.length) {
    const { subject, html, text } = clientErrors.digestEmail(picks, { appUrl: APP_URL, escape: escapeHtml, now });
    sent = await sendResendEmail({ to: [OWNER_EMAIL], subject, html, text });
  }
  const pruned = await pruneClientErrors(now);
  logger.info("notifyClientErrors concluída", { grupos: groups.length, avisados: picks.length, emailEnviado: sent, ...pruned });
}

exports.notifyClientErrors = onSchedule(
  { schedule: "20 9 * * *", timeZone: "America/Sao_Paulo", region: "us-east1", secrets: [RESEND_API_KEY], timeoutSeconds: 300 },
  async () => { await sendClientErrorDigest(); }
);
