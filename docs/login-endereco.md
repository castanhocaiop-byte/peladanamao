# Endereço que aparece na janela de login do Google

Ao tocar em **Entrar com o Google**, a janela do Google mostra o endereço do login. O padrão do Firebase seria `seriebaceoma.firebaseapp.com`, o nome interno do projeto (criado quando o sistema era só da liga "Série B Aceoma"; o Google não deixa renomear). Hoje a janela diz **"Prosseguir para peladanamao.com.br"**.

## Como está montado
- `vercel.json`: o site repassa, de forma transparente (não é redirecionamento), os pedidos de `/__/auth/` ao Firebase (`https://seriebaceoma.firebaseapp.com/__/auth/...`).
- `index.html` e `firebase-messaging-sw.js`: na produção, o `authDomain` do Firebase é `peladanamao.com.br`. O ambiente de teste continua com o endereço do projeto de teste.
- Google Cloud (feito pelo dono em 09/10/2026): o cliente OAuth **"Web client (auto created by Google Service)"** tem, em **URIs de redirecionamento autorizados**, `https://peladanamao.com.br/__/auth/handler` (e o `https://seriebaceoma.firebaseapp.com/__/auth/handler` que já existia). **Não remova**: sem eles o Google recusa o login (`redirect_uri_mismatch`).
- Testado ao vivo em 09/10/2026: a janela mostrou `peladanamao.com.br` e o login terminou normalmente.

## Saída de emergência
Se o login do Google der problema num aparelho, abra o site com `?login=google` no fim do endereço (por exemplo `https://peladanamao.com.br/?login=google`): aquele aparelho volta ao endereço antigo do Firebase e a escolha fica guardada. Para desfazer, abra `?login=proprio`. Quem entra por e-mail e senha não é afetado.

## Conferir se o Google ainda aceita o endereço
O Claude tem uma sonda pública que pergunta ao Firebase o endereço de login do Google para esse retorno e vê a resposta do Google (aceito, ou `redirect_uri_mismatch`). Se um dia o login quebrar para todos, o primeiro suspeito é alguém ter removido o URI do cliente OAuth.

## Nome que aparece em "continuar para…"
Vem do endereço de retorno (agora `peladanamao.com.br`). Não precisa mexer na tela de consentimento OAuth. Se algum dia quiser mostrar um **nome** (por exemplo "Pelada na Mão") em vez do endereço, ele é ajustado no Google Cloud (menu *Google Auth Platform → Identidade visual*, ou *APIs e serviços → Tela de permissão OAuth*); o Google pode pedir verificação para mudar nome ou logo.
