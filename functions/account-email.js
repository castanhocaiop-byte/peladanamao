"use strict";
// Cópias do e-mail da conta que o app guarda no banco.
//
// O e-mail do LOGIN mora no Firebase Auth (é a fonte da verdade) e a troca em si é do Firebase: a pessoa pede pelo app,
// recebe um link no e-mail NOVO e só depois de tocar nele o login muda. O que o app guarda no Firestore são CÓPIAS, que
// alimentam o painel do admin (lista de membros), os e-mails de cobrança, o aviso de liga abandonada e o pagador do
// Mercado Pago:
//   1) users/{uid}.email — gravado quando a conta nasce; as regras do Firestore NÃO deixam o app mexer nele;
//   2) leagues/{liga}/link_requests/{uid}.email — pedido de vínculo pendente (some quando o admin responde).
// Todo o resto (ligas, papéis, vínculo com o jogador, dono da liga, fotos, convites) é por uid e não muda com o e-mail.
//
// Quem usa: a função syncMyEmail (index.js), que o app chama na primeira entrada com o e-mail novo, e o atalho do dono
// (scripts/trocar-email.js), para quem perdeu o acesso ao e-mail antigo.

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

module.exports = { syncEmailCopies, LEAGUE_ID_RE };
