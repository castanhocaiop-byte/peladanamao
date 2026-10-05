# Ambiente de teste (staging)

Um segundo ambiente, **completo e separado da produção**, para testar mudanças antes de elas irem ao ar.
Tem projeto Firebase próprio (login, banco, funções e site), então nada feito ali encosta nos dados dos
jogadores de verdade.

| | Produção | Teste (staging) |
|---|---|---|
| Endereço | https://peladanamao.com.br | https://seriebaceoma-staging.web.app |
| Projeto Firebase | `seriebaceoma` | `seriebaceoma-staging` |
| Site | Vercel (`vercel deploy --prod --yes`) | Firebase Hosting (`node scripts/staging.js deploy site`) |
| Banco / funções | `us-east1` | `us-east1` (mesmo código, mesmas regras) |
| Mercado Pago | credenciais de produção (quando forem configuradas) | **sempre credenciais de TESTE**, webhook próprio |
| E-mails (Resend) | reais | desligados (chave marcador `PENDENTE_CONFIGURAR`); se ligar, o assunto sai com `[TESTE]` |
| Backup diário | sim | não (só há dados fictícios) |
| Notificações push, App Check | sim | desligados |
| Faixa na tela | — | "🧪 TESTE — dados fictícios" e título `[TESTE] …` |
| Indexação | normal | `noindex` (buscadores ignoram) |

## Regras de ouro
1. **Nunca copiar dados reais para o teste** (LGPD): lá só entram contas e ligas inventadas.
2. Todo comando do teste leva o projeto escrito: `--project seriebaceoma-staging`. O script
   `scripts/staging.js` já faz isso e **não tem como** publicar na produção.
3. A produção continua sendo o padrão em qualquer lugar que não seja o site de teste (localhost, prévias da
   Vercel, emuladores): o app e as funções só viram "teste" quando o endereço/projeto é o do teste.

## Como o código sabe em que ambiente está
- **Funções** (`functions/index.js`, tabela `ENVIRONMENTS`): pelo projeto em que rodam
  (`GCLOUD_PROJECT`). Define o endereço do webhook do Mercado Pago, a volta do checkout, os links dos
  e-mails e das notificações, a marca `[TESTE]` nos e-mails e se o backup roda.
- **App** (`index.html`, tabela `APP_ENVS`) e **service worker** (`firebase-messaging-sw.js`): pelo endereço
  do site. Escolhem a configuração do Firebase certa.
- `functions/test/environments-test.js` confere que as três tabelas batem e que nenhum endereço de ambiente
  ficou fixo fora delas.

## Publicar no teste
```bash
node scripts/staging.js deploy              # tudo: site, regras, login e funções
node scripts/staging.js deploy site         # só o site (copia os mesmos arquivos liberados no .vercelignore)
node scripts/staging.js deploy rules,auth   # alvos separados por vírgula: site, rules, auth, functions
```
Fluxo recomendado para uma mudança: ajustar o código → `node scripts/staging.js deploy` → testar em
https://seriebaceoma-staging.web.app → só então publicar na produção, nesta ordem:
`firebase deploy --only functions --project seriebaceoma`, depois `vercel deploy --prod --yes` (site),
depois `firebase deploy --only firestore:rules --project seriebaceoma` (antes com `--dry-run`).

## Montagem inicial (feita em 05/10/2026)
- Projeto `seriebaceoma-staging` criado (`firebase projects:create`), com um app web.
- Banco Firestore em `us-east1` (o padrão do Google nasce em `nam5`; foi recriado na região da produção).
- Login por e-mail/senha ativado pelo `firebase.staging.json` (`auth.providers.emailPassword`).
- Site no Firebase Hosting (`firebase.staging.json` → `hosting`, pasta `.staging-site`, ignorada pelo git).
- Plano **Blaze** ativado pelo dono (as funções exigem o plano pago, cobrado pelo uso). Sugestão: alerta de
  orçamento baixo (ex.: R$ 10/mês) no projeto de teste.
- Segredos criados com o marcador `PENDENTE_CONFIGURAR` (nenhum e-mail sai; fotos apagadas ficam no
  Cloudinary; o webhook responde 503 enquanto o segredo dele for provisório).
- 26 funções publicadas com `node scripts/staging.js deploy functions` e política de limpeza de imagens de
  1 dia (`firebase functions:artifacts:setpolicy --location us-east1 --force --project seriebaceoma-staging`;
  sem ela o CLI termina com erro mesmo com tudo publicado).
- **Primeira publicação de funções num projeto novo:** o Google costuma recusar parte delas ("Eventarc
  Service Agent", "Could not create bucket", "Build failed… unexpected error"): são permissões e pastas
  internas ainda sendo criadas. **Não basta rodar de novo:** a segunda rodada só *atualiza* as funções que
  ficaram pela metade, e elas ficam sem o acesso público (respondem 403 em vez de 401 a quem não está
  logado, e o app e o Mercado Pago não conseguem chamá-las). O caminho certo é apagar as que falharam
  (`firebase functions:delete <nomes> --region us-east1 --force --project seriebaceoma-staging`) e publicar
  de novo, para que sejam *criadas* do zero. Conferência (esperado: 401 nas funções chamáveis; 503 no
  webhook enquanto o segredo for provisório):
  `curl -s -o /dev/null -w "%{http_code}" -X POST https://us-east1-seriebaceoma-staging.cloudfunctions.net/<função>
  -H "Content-Type: application/json" -d '{"data":{}}'`
- Segredos do Mercado Pago de TESTE (gravados pelo dono em 05/10/2026; para trocar, é o mesmo
  procedimento; os valores nunca passam pelo chat nem
  pelo código). Copie o valor no painel do Mercado Pago (ícone de copiar) e rode o comando do segredo: ele lê
  a área de transferência, confere (Public Key no lugar do token, texto cortado ou com espaços são barrados com
  uma mensagem), grava só no projeto de teste e limpa a área de transferência. Não aparece nada sensível na
  tela. (Colar no campo escondido do `firebase functions:secrets:set` falhou no terminal do app: "Secret
  Payload cannot be empty".) **Depois de gravar, publique as funções** (`node scripts/staging.js deploy
  functions`): com o valor vindo pela entrada padrão o firebase trata o comando como não interativo e
  não republica sozinho, nem com `--force`; as funções seguem com a versão antiga do segredo até o deploy.
  ```bash
  node scripts/staging.js secret MERCADOPAGO_ACCESS_TOKEN
  node scripts/staging.js secret MERCADOPAGO_WEBHOOK_SECRET
  node scripts/staging.js deploy functions
  ```
  O primeiro é o *Access Token* da tela "Credenciais de teste" (menu TESTES) do painel do Mercado Pago. Atenção:
  hoje essas credenciais também começam com `APP_USR-`, então o prefixo não distingue teste de produção; o que
  vale é copiar da tela de teste. O segundo é a "assinatura secreta" em Webhooks, no mesmo painel.

## Testar pagamentos no teste
O teste usa sempre o Mercado Pago em modo de teste (compradores e cartões de teste), mesmo depois de a
produção passar a cobrar de verdade. Cada pagamento criado no teste já avisa o webhook do projeto de teste
(`https://us-east1-seriebaceoma-staging.cloudfunctions.net/mercadoPagoWebhook`).

**O e-mail da conta importa só para pagar.** Para criar conta e liga qualquer e-mail serve, até inventado (o
app não pede confirmação nem manda e-mail no cadastro). Mas o e-mail da conta que é admin da liga vai ao
Mercado Pago como pagador, e em modo de teste ele só aceita o e-mail de uma conta compradora de teste
(painel → Contas de teste → Comprador).

**O e-mail do comprador de teste NÃO é o nome de usuário + `@testuser.com`.** É `test_user_` + os números do
usuário, tudo em minúsculas: a conta `TESTUSER2702948457827838830` tem o e-mail
`test_user_2702948457827838830@testuser.com`. Quem digita o nome de usuário como e-mail (ex.:
`TESTUSER2702948457827838830@testuser.com`, que não existe no Mercado Pago) leva "Payer is associated with a
different site" (confirmado em 05/10/2026: o mesmo comprador, com o e-mail certo, pagou normalmente); com um
e-mail real, o Mercado Pago recusa com "Both payer and collector must be real or test users". Se o painel
mostrar outro e-mail para a conta, vale o do painel. Para o teste completo, crie a conta do app já com esse
e-mail (o e-mail de uma conta existente não troca) e, de preferência, numa janela anônima, sem a conta real do
Mercado Pago logada. Esse e-mail não recebe mensagens: anote a senha, porque o "Esqueci minha senha" não
chegaria.

## Apagar os dados de teste
Contas: Console → Authentication → Usuários. Banco inteiro (só no teste!):
`firebase firestore:delete --all-collections --force --project seriebaceoma-staging`.

## Observações
- Fotos enviadas no teste vão para a mesma conta do Cloudinary da produção (pasta/conta compartilhada).
- O site de teste é público (qualquer pessoa com o endereço pode criar uma conta de teste): por isso só
  dados fictícios.
