# Ligar o pagamento de verdade (produção)

Hoje a produção cobra em **modo de teste**: o Access Token gravado no projeto `seriebaceoma` é o de *Credenciais de teste* do Mercado Pago. Ligar o pagamento real é trocar esse segredo pelo de **produção**, avisar o Mercado Pago onde entregar as notificações e publicar as funções. Nenhum código do app muda: o app cobra o que o Mercado Pago deixar, com a chave que estiver gravada.

Nada disso passa pelo chat: a chave só trafega entre o painel do Mercado Pago, a área de transferência do seu computador e o Firebase.

## Antes de ligar (o que pesa)
- **Termos de Uso 1.4** vistos pelo advogado (cláusula 10: planos, sem reembolso, plano gratuito).
- **Contador:** os Termos dizem que o responsável opera como pessoa física, decisão tomada "antes de haver monetização". Com cobrança de verdade vale conversar com um contador sobre MEI/CNPJ e imposto de renda antes de começar a receber.
- **Apagar as ligas de teste** (MP2, MP3…): no app, com a conta dona do sistema, Painel Admin → Zona de perigo. As assinaturas de teste vivem no ambiente de teste do Mercado Pago; a produção não as enxerga.
- **Taxa:** o Mercado Pago cobra uma taxa por transação; confira o valor da sua conta no painel para saber quanto sobra de R$ 29,90 e de R$ 238,80.

## 1. No painel do Mercado Pago (você faz)
1. Entre em `mercadopago.com.br/developers/panel` → **Suas integrações** → a aplicação **Pelada na Mao**.
2. No **menu da esquerda** da aplicação, role até a seção **PRODUÇÃO** (fica abaixo de TESTES e NOTIFICAÇÕES) e abra **Credenciais de produção**. A tela "Informações gerais", com o cartão "Estado · Etapa 1 de 5" e as contas de teste, é só o roteiro de testes do Mercado Pago: não é ali. Preencha **Indústria** (a mais próxima, como serviços/software ou esportes), **Website** (`https://peladanamao.com.br`, obrigatório), aceite a Declaração de Privacidade e os Termos, resolva o reCAPTCHA e clique em **Ativar credenciais de produção** (segundo a [documentação do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials), não há etapa anterior obrigatória). A conta de vendedor precisa estar verificada (identidade e conta bancária para sacar); o Mercado Pago pode pedir mais uma validação e isso pode levar de horas a dias.
3. Copie o **Access Token** de produção (o campo que fica escondido por pontinhos). **Não** é a Public Key. Ainda não cole em lugar nenhum: o passo 2 pede para copiar na hora certa.
4. Em **Webhooks**, no **Modo produção**:
   - URL: `https://us-east1-seriebaceoma.cloudfunctions.net/mercadoPagoWebhook`
   - Eventos: **Pagamentos** e **Planos e assinaturas**.
   - A *Assinatura secreta* é a mesma que já está gravada (ela é da aplicação e vale para teste e produção). Só se você criar outra aplicação é que precisa regravá-la com `secret MERCADOPAGO_WEBHOOK_SECRET`.

## 2. Gravar a chave de produção (comando seguro)
No terminal (o do app abre na pasta `Projetos`, por isso o caminho completo):

```bash
node "C:\Users\caiop\Documents\Cursos\Claude Code\Projetos\aceoma\scripts\producao.js" secret MERCADOPAGO_ACCESS_TOKEN
```

**A chave nunca é digitada nem colada no terminal**: você só digita `SIM` (3 letras) e aperta Enter; o comando lê o que você copiou na hora certa. Se a chave for colada por engano numa das perguntas, o comando recusa, não grava e avisa. Como ela fica visível na tela (e em qualquer conversa onde apareça), **renove-a no painel do Mercado Pago** antes de usar (Credenciais de produção → os três pontinhos ao lado da credencial → **Renovar** → **Renovar agora**) e comece de novo com a chave nova.

O que o comando faz, em ordem:
1. Avisa que vai gravar na **produção** e só continua se você digitar `SIM`.
2. Pede para você copiar o Access Token de produção e apertar Enter (assim nada sobrescreve o que você copiou).
3. Confere o que foi copiado (Public Key no lugar do token, texto cortado ou com espaço são barrados com uma mensagem).
4. Pergunta ao Mercado Pago de quem é a chave e mostra o **nome da conta**: confirme com `S` se for a sua conta de vendedor. Chave de conta de **teste** (nome `TESTUSER…`) é barrada.
5. Grava só no projeto `seriebaceoma`, lendo o valor pela entrada padrão (ele não aparece na tela nem na linha de comando), e limpa a área de transferência.

Depois de gravar, **publique as funções** para o segredo valer (com o valor vindo pela entrada padrão o firebase não republica sozinho):

```bash
firebase deploy --only functions --project seriebaceoma
```

(Ou peça ao Claude: ele publica, confere as funções e o webhook por `curl` e atualiza a memória.)

## 3. A primeira cobrança real (com outra pessoa)
O Mercado Pago não deixa o vendedor pagar para si mesmo. Peça a alguém de confiança:
1. Entrar no app (conta própria dela), criar uma liga e tocar em **💳 Assinatura**.
2. Assinar o **mensal** (R$ 29,90) com o cartão dela. Ao voltar do pagamento, a liga deve mostrar **"Assinatura mensal ativa"** sozinha (sem nenhum clique).
3. Você confere: no painel do Mercado Pago (Atividade/Assinaturas), no painel 📊 do app ("Ligas que já pagaram") e em **Webhooks → histórico de notificações**, que deve mostrar entregas com resposta 200.
4. Cancelar a assinatura pelo próprio app e, se quiser, devolver o pagamento pelo painel do Mercado Pago (confira lá o prazo e o que acontece com a taxa).
5. O **anual** (R$ 238,80) e o **Estender plano** vale testar também, quando você se sentir à vontade com o valor.

## 4. Confirmar o parcelamento e as bandeiras
A página de apresentação, o manual e a tela 💳 dizem que o anual é **parcelável em até 12x**. Isso nunca foi confirmado com credenciais reais (no teste só apareceu 1x com o Visa de teste). No primeiro pagamento do **anual**, veja quantas parcelas o checkout oferece e quais bandeiras aceita. Se não for 12x, avise o Claude para trocar o texto nos três lugares.

## 5. Voltar atrás (se algo estranho acontecer)
Copie o Access Token de **Credenciais de teste**, rode o mesmo comando com a opção de voltar e publique as funções de novo:

```bash
node "C:\Users\caiop\Documents\Cursos\Claude Code\Projetos\aceoma\scripts\producao.js" secret MERCADOPAGO_ACCESS_TOKEN --permitir-teste
firebase deploy --only functions --project seriebaceoma
```

O app volta a só aceitar pagamento de teste. Assinaturas reais já criadas continuam existindo no Mercado Pago: cancele-as pelo app ou pelo painel.

## O que não muda
- O **ambiente de teste** (`seriebaceoma-staging`) continua com credenciais de teste, em outro projeto (`docs/staging.md`).
- As funções (`createMonthlySubscription`, `createAnnualPayment`, o webhook, a reconciliação de 6 em 6 horas) são as mesmas: só o segredo muda.
- Valores: mensal R$ 29,90 e anual R$ 238,80, em `MP_PLANS` (`functions/index.js`).
