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
- **Depende do dono (plano pago e segredos)** — as funções exigem o plano **Blaze** (pagar conforme o uso):
  1. Console do Firebase → projeto *Pelada na Mao - teste* → engrenagem → *Uso e faturamento* → *Detalhes e
     configurações* → **Modificar plano → Blaze**, escolhendo a mesma conta de faturamento da produção.
     Sugestão: criar também um alerta de orçamento baixo (ex.: R$ 10/mês) para o projeto de teste.
  2. Segredos do projeto de teste (os valores nunca passam pelo chat nem pelo código):
     ```bash
     firebase functions:secrets:set MERCADOPAGO_ACCESS_TOKEN  --project seriebaceoma-staging   # token de TESTE do Mercado Pago
     firebase functions:secrets:set MERCADOPAGO_WEBHOOK_SECRET --project seriebaceoma-staging  # "assinatura secreta" da aplicação no painel do Mercado Pago
     ```
     `RESEND_API_KEY`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` ficam com o marcador
     `PENDENTE_CONFIGURAR` (nenhum e-mail sai; fotos apagadas ficam no Cloudinary).
  3. Depois: `node scripts/staging.js deploy functions`.

## Testar pagamentos no teste
O teste usa sempre o Mercado Pago em modo de teste (compradores e cartões de teste), mesmo depois de a
produção passar a cobrar de verdade. Cada pagamento criado no teste já avisa o webhook do projeto de teste
(`https://us-east1-seriebaceoma-staging.cloudfunctions.net/mercadoPagoWebhook`).

## Apagar os dados de teste
Contas: Console → Authentication → Usuários. Banco inteiro (só no teste!):
`firebase firestore:delete --all-collections --force --project seriebaceoma-staging`.

## Observações
- Fotos enviadas no teste vão para a mesma conta do Cloudinary da produção (pasta/conta compartilhada).
- O site de teste é público (qualquer pessoa com o endereço pode criar uma conta de teste): por isso só
  dados fictícios.
