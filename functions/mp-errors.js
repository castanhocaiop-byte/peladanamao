"use strict";
// Traduz as recusas do Mercado Pago (em inglês, num formato próprio do SDK) para uma mensagem em
// português que diz o que aconteceu e o que a pessoa pode fazer. O texto original NUNCA se perde: quem
// chama o guarda no log (campo "erro"), porque é ele que permite diagnosticar um caso novo.
//
// Regras, da mais específica para a mais geral (a primeira que bater vale):
//   liberacao    credenciais de produção ainda não liberadas pelo Mercado Pago (problema nosso)
//   configuracao token inválido/sem permissão (problema nosso)
//   outroPais    o e-mail do pagador pertence a uma conta de outro país
//   contaTeste   conta de teste misturada com conta real
//   mesmaConta   quem recebe e quem paga são a mesma conta
//   email        e-mail do pagador ausente ou inválido
//   instavel     Mercado Pago fora do ar, lento ou sem rede (tentar de novo resolve)
//   desconhecido qualquer outra coisa: mensagem genérica + o texto original, para a pessoa poder nos informar

const MAX_DETAIL = 160;

// Texto que o SDK devolve: `message`, mais as descrições das causas (cause[]) quando existirem.
function rawTextOf(e) {
  if (e == null) return "";
  if (typeof e === "string") return e.trim();
  const parts = [e.message, e.error];
  if (Array.isArray(e.cause)) for (const c of e.cause) parts.push(c?.description, c?.code);
  return [...new Set(parts.filter(p => typeof p === "string" && p.trim()).map(p => p.trim()))].join(" | ");
}

function isNetworkFailure(e, raw) {
  const code = String(e?.code || e?.cause?.code || "");
  return /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR/i.test(code)
    || e?.name === "AbortError" || e?.name === "TimeoutError"
    || /fetch failed|network|timeout|timed out|socket hang up|getaddrinfo/i.test(raw);
}

// `contact`: e-mail de suporte citado nas mensagens que a pessoa não resolve sozinha.
// `testHint`: true fora da produção — acrescenta a dica do comprador de teste.
function describeMpError(e, { contact = "o suporte", testHint = false } = {}) {
  const raw = rawTextOf(e);
  const status = Number(e?.status ?? e?.statusCode) || 0;
  const hint = testHint
    ? " Ambiente de teste: o e-mail da conta precisa ser o de um comprador de teste, no formato test_user_NÚMEROS@testuser.com (não é o nome de usuário + @testuser.com)."
    : "";
  const out = (kind, text, severity = "warn", known = true) => ({ kind, text, severity, known, status, raw });

  if (/unauthorized use of live credentials/i.test(raw)) {
    return out("liberacao", `O pagamento ainda não está liberado pelo Mercado Pago. Tente de novo mais tarde ou escreva para ${contact}.`, "error");
  }
  if (status === 401 || status === 403 || /invalid[_ ]?(access[_ ]?)?token|token (is |was )?(invalid|expired)|unauthorized|forbidden/i.test(raw)) {
    return out("configuracao", `O pagamento está indisponível por um problema do nosso lado. Tente de novo mais tarde ou escreva para ${contact}.`, "error");
  }
  if (/different (site|countr)/i.test(raw)) {
    return out("outroPais", `O e-mail da sua conta está ligado a uma conta do Mercado Pago de outro país, e só contas do Brasil podem assinar. Use, no app, um e-mail de conta do Mercado Pago do Brasil ou escreva para ${contact}.${hint}`);
  }
  if (/real or test users/i.test(raw)) {
    return out("contaTeste", `O Mercado Pago não aceita misturar conta de teste com conta real. Para pagar de verdade, use o e-mail de uma conta real do Mercado Pago; no ambiente de teste, use o e-mail de um comprador de teste (test_user_NÚMEROS@testuser.com).`);
  }
  if (/same (user|account)|payer.*collector.*same|collector.*payer.*same|cannot (be|pay).*same/i.test(raw)) {
    return out("mesmaConta", "A conta que recebe os pagamentos não pode pagar para si mesma. Use outro e-mail para assinar.");
  }
  if (/payer[_ ]?email/i.test(raw) || /invalid.*e-?mail|e-?mail.*(invalid|not valid)/i.test(raw)) {
    return out("email", "O Mercado Pago não aceitou o e-mail da sua conta. Confira se ele está correto ou entre com outro e-mail.");
  }
  if (isNetworkFailure(e, raw) || status === 429 || status >= 500) {
    return out("instavel", "O Mercado Pago não respondeu agora. Tente de novo em alguns minutos.");
  }
  const detail = raw.length > MAX_DETAIL ? raw.slice(0, MAX_DETAIL - 1) + "…" : raw;
  return out("desconhecido",
    `O Mercado Pago não aceitou a solicitação agora. Tente de novo; se continuar, escreva para ${contact}${detail ? ` informando: "${detail}"` : ""}.`,
    "warn", false);
}

module.exports = { describeMpError };
