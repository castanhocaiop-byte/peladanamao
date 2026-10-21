"use strict";
// Cópias do e-mail da conta que o app guarda no banco.
//
// O e-mail do LOGIN mora no Firebase Auth (é a fonte da verdade) e a troca em si é do Firebase: a pessoa pede pelo app,
// o servidor manda um link ao e-mail NOVO (requestEmailChange, abaixo) e só depois de tocar nele o login muda. O que o app guarda no Firestore são CÓPIAS, que
// alimentam o painel do admin (lista de membros), os e-mails de cobrança, o aviso de liga abandonada e o pagador do
// Mercado Pago:
//   1) users/{uid}.email — gravado quando a conta nasce; as regras do Firestore NÃO deixam o app mexer nele;
//   2) leagues/{liga}/link_requests/{uid}.email — pedido de vínculo pendente (some quando o admin responde).
// Todo o resto (ligas, papéis, vínculo com o jogador, dono da liga, fotos, convites) é por uid e não muda com o e-mail.
//
// Quem usa: a função syncMyEmail (index.js), que o app chama na primeira entrada com o e-mail novo, e o atalho do dono
// (scripts/trocar-email.js), para quem perdeu o acesso ao e-mail antigo.

// ── O pedido de troca (função requestEmailChange, em index.js) ──────────────────────────────────────────────────────────
// O e-mail que o próprio Firebase manda para esse pedido (verifyBeforeUpdateEmail) NÃO serve: o link abre a página do Firebase, que não conhece esse
// tipo de link ("The selected page mode is invalid") e o remetente é noreply@<projeto>.firebaseapp.com. Então o servidor gera o código de troca do
// Firebase (generateVerifyAndChangeEmailLink) e manda, pelo Resend e com o remetente "Pelada na Mão", um link que abre o PRÓPRIO app; o app aplica o
// código (applyActionCode) e o Firebase troca o e-mail do login. O código nunca volta para o app: só chega por quem abre o e-mail novo.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;   // o mesmo teste do app (emailChangeProblem)
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// O e-mail novo digitado: sem espaços nas pontas, em minúsculas, com cara de e-mail e até 254 caracteres, e diferente do atual.
// Devolve { email } ou { problem: "empty" | "invalid" | "same" }.
function parseNewEmail(raw, currentEmail) {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { problem: "empty" };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { problem: "invalid" };
  if (email === String(currentEmail || "").trim().toLowerCase()) return { problem: "same" };
  return { email };
}

// O código de troca (oobCode) dentro do link que o Firebase gerou; "" se não houver.
function oobCodeOf(link) {
  try { return new URL(String(link)).searchParams.get("oobCode") || ""; } catch (_) { return ""; }
}

// O link que vai no e-mail: a página do app que aplica o código (appUrl termina em "/").
function changeEmailUrl(appUrl, code) {
  return `${appUrl}?mode=verifyAndChangeEmail&oobCode=${encodeURIComponent(code)}`;
}

// O e-mail da troca: assunto, HTML e texto simples. `url` é o link do app e `contactEmail` o e-mail de contato do suporte.
function changeEmailMessage({ url, contactEmail }) {
  const subject = "Confirme o seu novo e-mail no Pelada na Mão";
  const paragraphs = [
    "Você pediu para trocar o e-mail de login do Pelada na Mão para este endereço.",
    "Toque no botão para confirmar. Depois, entre de novo com este e-mail e a mesma senha de sempre: as suas ligas, o seu jogador e as suas conquistas continuam como estão.",
  ];
  const footer = `O link só pode ser usado uma vez e vale por tempo limitado. Não foi você que pediu? Ignore este e-mail: nada muda. Dúvidas: ${contactEmail}`;
  const html = [
    ...paragraphs.map(p => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`),
    `<p style="margin:18px 0"><a href="${escapeHtml(url)}" style="background:#00d67f;color:#000;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;display:inline-block">Confirmar o novo e-mail</a></p>`,
    `<p style="margin:0 0 14px;color:#6b7280;font-size:12px;line-height:1.5">Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(url)}</p>`,
    `<p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5">${escapeHtml(footer)}</p>`,
  ].join("");
  const text = [...paragraphs, `Confirmar o novo e-mail: ${url}`, footer].join("\n\n");
  return { subject, html, text };
}

const LEAGUE_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;   // o mesmo de index.js (aceita os ids antigos de liga)

// Põe `email` (o do login, já lido do Firebase Auth) no cadastro e nos pedidos de vínculo pendentes das ligas da conta.
// Só grava o que mudou, nunca guarda o e-mail antigo e pode ser repetida sem risco. `db` é o Firestore do Admin SDK.
// Devolve o que foi corrigido: { userDoc: o cadastro existe, changed: o cadastro mudou, linkRequests: quantos pedidos mudaram }.
async function syncEmailCopies(db, uid, email) {
  if (typeof uid !== "string" || !uid || uid.includes("/")) throw new Error("uid inválido");
  if (typeof email !== "string" || !email.trim()) throw new Error("e-mail vazio");
  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists) return { userDoc: false, changed: false, linkRequests: 0 };
  const user = snap.data() || {};

  let changed = false;
  if (user.email !== email) { await userRef.update({ email }); changed = true; }

  const ligas = user.leagues && typeof user.leagues === "object" ? Object.keys(user.leagues).filter(l => LEAGUE_ID_RE.test(l)) : [];
  let linkRequests = 0;
  for (const liga of ligas) {
    const reqRef = db.doc(`leagues/${liga}/link_requests/${uid}`);
    const req = await reqRef.get();
    if (req.exists && req.data()?.email !== email) { await reqRef.update({ email }); linkRequests++; }
  }
  return { userDoc: true, changed, linkRequests };
}

module.exports = { syncEmailCopies, LEAGUE_ID_RE, parseNewEmail, oobCodeOf, changeEmailUrl, changeEmailMessage };
