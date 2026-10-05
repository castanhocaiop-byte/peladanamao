// Atalho para gravar segredos do ambiente de teste a partir da área de transferência
// (node scripts/staging.js secret NOME). Confere a validação do que foi copiado: o dono não vê o valor
// na tela, então um erro de cópia (chave pública no lugar do token, texto com espaços, valor cortado)
// tem de ser barrado com uma mensagem clara, e a mensagem nunca pode conter o valor copiado.
const path = require('path');
const { checkSecretValue, SECRETS } = require(path.join(__dirname, '..', '..', 'scripts', 'staging.js'));

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

const TOKEN = 'APP_USR-1699581516483552-100512-0123456789abcdef0123456789abcdef-1234567890';
const PUBLIC_KEY = 'APP_USR-96abf4a7-63db-43f6-ad2c-24c64b75fa13';
const WEBHOOK_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const AT = 'MERCADOPAGO_ACCESS_TOKEN';
const WH = 'MERCADOPAGO_WEBHOOK_SECRET';

// ── o que vale ─────────────────────────────────────────────────────────────────────────────────
check('os cinco segredos do projeto de teste estão na lista', ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'RESEND_API_KEY', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].every(n => SECRETS.includes(n)) && SECRETS.length === 5, SECRETS);
check('Access Token de teste do Mercado Pago (APP_USR-) é aceito como veio', checkSecretValue(AT, TOKEN).value === TOKEN, checkSecretValue(AT, TOKEN));
check('Access Token no formato antigo (TEST-) também é aceito', checkSecretValue(AT, 'TEST-' + TOKEN.slice(8)).value === 'TEST-' + TOKEN.slice(8));
check('quebra de linha e espaços nas pontas (o que a área de transferência traz) são tirados', checkSecretValue(AT, `  ${TOKEN}\r\n`).value === TOKEN);
check('assinatura secreta do webhook (64 caracteres hexadecimais) é aceita', checkSecretValue(WH, WEBHOOK_SECRET).value === WEBHOOK_SECRET);
check('segredos de outros serviços (e-mail, fotos) seguem só as regras gerais', checkSecretValue('RESEND_API_KEY', 're_1234567890abcdefghijklmnop').value === 're_1234567890abcdefghijklmnop');

// ── o que é barrado, com mensagem e sem vazar o valor ──────────────────────────────────────────
const barrados = [
  ['área de transferência vazia', AT, ''],
  ['só espaços e quebra de linha', AT, '  \r\n '],
  ['nada copiado (null)', AT, null],
  ['Public Key no lugar do Access Token', AT, PUBLIC_KEY],
  ['Public Key com quebra de linha', AT, PUBLIC_KEY + '\n'],
  ['texto qualquer no lugar do token', AT, 'País de operação Brasil'],
  ['valor sem o prefixo do Mercado Pago', AT, 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
  ['Access Token cortado (curto demais)', AT, TOKEN.slice(0, 30)],
  ['várias linhas', AT, TOKEN + '\n' + TOKEN],
  ['espaço no meio', AT, TOKEN.slice(0, 20) + ' ' + TOKEN.slice(20)],
  ['caractere fora do padrão (acento)', 'RESEND_API_KEY', 're_1234567890abcdefghijklmnopç'],
  ['curto demais', 'RESEND_API_KEY', 'abc123'],
  ['grande demais', 'RESEND_API_KEY', 'a'.repeat(513)],
  ['Access Token colado no lugar da assinatura secreta', WH, TOKEN],
];
for (const [label, name, value] of barrados) {
  const r = checkSecretValue(name, value);
  const trecho = String(value == null ? '' : value).trim();
  const vazou = trecho.length >= 6 && r.error && r.error.includes(trecho.slice(0, Math.min(trecho.length, 12)));
  check(`barra: ${label}`, !!r.error && r.value === undefined && !vazou, r);
}
check('a mensagem da Public Key diz que é a chave pública', /Public Key/.test(checkSecretValue(AT, PUBLIC_KEY).error));
check('a mensagem do valor vazio manda copiar de novo', /Copie/.test(checkSecretValue(AT, '').error));
check('texto com espaços ou várias linhas recebe a mensagem dos espaços', /espaços ou várias linhas/.test(checkSecretValue(AT, TOKEN + '\n' + TOKEN).error) && /espaços ou várias linhas/.test(checkSecretValue(AT, 'País de operação Brasil').error));
check('valor com caractere estranho (sem espaços) recebe a mensagem dos caracteres estranhos', /caracteres estranhos/.test(checkSecretValue('RESEND_API_KEY', 're_1234567890abcdefghijklmnopç').error));
check('o que vale para o token não vale para a assinatura: ela aceita qualquer valor longo sem espaços', checkSecretValue(WH, 'x'.repeat(40)).value === 'x'.repeat(40));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
