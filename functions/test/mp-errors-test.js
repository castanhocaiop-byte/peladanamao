// Tradução das recusas do Mercado Pago (functions/mp-errors.js): cada tipo de recusa vira uma mensagem em
// português que diz o que fazer, o texto original nunca some (vai no campo "raw", que o servidor grava no
// log), e o que é problema nosso (credenciais, token) não vira instrução para a pessoa.
const path = require('path');
const { describeMpError } = require(path.join(__dirname, '..', 'mp-errors.js'));

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

const err = (message, status, extra = {}) => Object.assign(new Error(message), status ? { status } : {}, extra);
const CONTACT = 'ajuda@exemplo.com.br';
const d = (e, opts) => describeMpError(e, { contact: CONTACT, ...opts });

// ── cada tipo de recusa ────────────────────────────────────────────────────────────────────────
let r = d(err('Payer is associated with a different site', 400));
check('outro país: tipo e mensagem', r.kind === 'outroPais' && /outro país/.test(r.text) && r.text.includes(CONTACT) && r.known === true, r);
check('outro país: sem a dica de teste quando não é o ambiente de teste', !/testuser/.test(r.text), r.text);
check('outro país: com a dica do comprador de teste no ambiente de teste', /test_user_NÚMEROS@testuser\.com/.test(d(err('Payer is associated with a different site', 400), { testHint: true }).text));
check('"Cannot operate between different countries" é o mesmo caso', d(err('Cannot operate between different countries', 400)).kind === 'outroPais');

r = d(err('Both payer and collector must be real or test users', 400));
check('conta de teste misturada com real: tipo e mensagem', r.kind === 'contaTeste' && /misturar conta de teste com conta real/.test(r.text) && /test_user_NÚMEROS@testuser\.com/.test(r.text), r);

r = d(err('payer and collector cannot be the same user', 400));
check('mesma conta: tipo e mensagem', r.kind === 'mesmaConta' && /não pode pagar para si mesma/.test(r.text), r);
check('mesma conta: outra forma de dizer', d(err('Cannot pay to the same account', 400)).kind === 'mesmaConta');

for (const m of ['payer_email is required', 'Invalid value for field payer_email', 'The payer email is not valid']) {
  check(`e-mail do pagador: "${m}"`, d(err(m, 400)).kind === 'email', d(err(m, 400)));
}

r = d(err('Unauthorized use of live credentials', 403));
check('credenciais de produção não liberadas: tipo, gravidade e mensagem', r.kind === 'liberacao' && r.severity === 'error' && /ainda não está liberado/.test(r.text) && r.text.includes(CONTACT), r);
check('…e vale antes da regra geral de "não autorizado"', r.kind !== 'configuracao');

for (const [m, s] of [['invalid access token', 401], ['The access token is invalid', 400], ['Unauthorized', 401], ['forbidden', 403], ['anything', 401]]) {
  r = d(err(m, s));
  check(`token/permissão (${s} "${m}"): problema nosso, gravidade ERRO, sem instrução para a pessoa`, r.kind === 'configuracao' && r.severity === 'error' && /problema do nosso lado/.test(r.text) && !/token|credencia/i.test(r.text), r);
}

for (const [label, e] of [['503', err('Service Unavailable', 503)], ['500', err('Internal', 500)], ['429', err('Too many requests', 429)], ['sem rede (fetch failed)', new TypeError('fetch failed')],
  ['ETIMEDOUT', err('request failed', 0, { code: 'ETIMEDOUT' })], ['causa de rede', err('boom', 0, { cause: { code: 'ECONNRESET' } })], ['AbortError', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })]]) {
  r = d(e);
  check(`instabilidade (${label}): tente de novo, gravidade aviso`, r.kind === 'instavel' && r.severity === 'warn' && /Tente de novo em alguns minutos/.test(r.text), r);
}

// ── o desconhecido: genérico, com o texto original para a pessoa nos informar ───────────────────
r = d(err('Algo que nunca vimos: erro 12345', 400));
check('desconhecido: mensagem genérica em português com o texto original entre aspas', r.kind === 'desconhecido' && r.known === false && /não aceitou a solicitação/.test(r.text) && r.text.includes('"Algo que nunca vimos: erro 12345"') && r.text.includes(CONTACT), r);
check('desconhecido: texto muito longo é cortado com reticências', d(err('x'.repeat(500), 400)).text.length < 400 && /…"/.test(d(err('x'.repeat(500), 400)).text));
r = d(err('', 400));
check('sem nenhum texto: mensagem útil, sem "undefined", sem aspas vazias', /não aceitou a solicitação/.test(r.text) && !/undefined|null|""/.test(r.text), r.text);
for (const odd of [undefined, null, 'erro como texto puro', 42, {}, { status: 400 }]) {
  r = d(odd);
  check(`valor estranho (${JSON.stringify(odd)}): não quebra e devolve português`, typeof r.text === 'string' && r.text.length > 20 && !/undefined|\[object/.test(r.text), r);
}
check('erro como texto puro mantém o texto original em raw', d('Payer is associated with a different site').raw === 'Payer is associated with a different site');

// ── o texto original nunca se perde ────────────────────────────────────────────────────────────
r = d(err('Payer is associated with a different site', 400, { error: 'bad_request', cause: [{ code: 123, description: 'detalhe extra' }] }));
check('raw guarda a mensagem, o código de erro e as causas do Mercado Pago', ['Payer is associated with a different site', 'bad_request', 'detalhe extra'].every(t => r.raw.includes(t)), r.raw);
check('status é devolvido (para o log)', r.status === 400);
check('contato padrão quando não é informado', /escreva para o suporte/.test(describeMpError(err('algo desconhecido', 400)).text));

// ── o inglês nunca vai para a tela nas recusas conhecidas ──────────────────────────────────────
for (const m of ['Payer is associated with a different site', 'Both payer and collector must be real or test users', 'payer and collector cannot be the same user', 'payer_email is required', 'Unauthorized use of live credentials', 'invalid access token']) {
  const t = d(err(m, 400)).text;
  check(`conhecida, sem despejar inglês na tela: "${m}"`, !t.toLowerCase().includes(m.toLowerCase()), t);
}

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
