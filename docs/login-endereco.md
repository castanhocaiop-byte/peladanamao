# Endereço que aparece na janela de login do Google

Ao tocar em **Entrar com o Google**, a janela do Google mostra o endereço do login. Hoje é `seriebaceoma.firebaseapp.com`, o nome interno do projeto no Firebase (criado quando o sistema era só da liga "Série B Aceoma"; o Google não deixa renomear). O objetivo é mostrar **peladanamao.com.br**.

## O que já está pronto no código
- `vercel.json`: o site repassa, de forma transparente, os pedidos de `/__/auth/` ao Firebase (não é redirecionamento).
- `index.html`: na produção, o login pode usar `peladanamao.com.br` como `authDomain`. **Por enquanto é opcional**: abrir o site com `?login=proprio` liga neste aparelho (fica guardado) e `?login=google` volta ao padrão. Para todo mundo, o padrão continua o antigo até o teste abaixo dar certo.

## O que só você pode fazer (Google Cloud Console)
Sem isto o Google recusa o login com o endereço novo (erro **redirect_uri_mismatch**). Os nomes dos menus mudam um pouco com o tempo.

1. Abra `https://console.cloud.google.com/apis/credentials?project=seriebaceoma` (o projeto de ID `seriebaceoma`).
2. Em **IDs do cliente OAuth 2.0**, abra o cliente **"Web client (auto created by Google Service)"** (é o que o login do Firebase usa; no menu novo pode aparecer em *Google Auth Platform → Clientes*).
3. Em **URIs de redirecionamento autorizados**, clique em **Adicionar URI** e cole:
   `https://peladanamao.com.br/__/auth/handler`
   Mantenha o que já existe (`https://seriebaceoma.firebaseapp.com/__/auth/handler`).
4. Salve. O Google avisa que pode levar de alguns minutos a algumas horas para valer.

## Testar (numa janela anônima, para não usar o login que já está guardado)
1. Abra `https://peladanamao.com.br/?login=proprio`.
2. Toque em **Entrar com o Google**. A janela que abre deve mostrar **peladanamao.com.br** na barra de endereço, e o login deve terminar normalmente.
3. Se aparecer **Erro 400: redirect_uri_mismatch**, o endereço do passo 3 ainda não foi salvo ou foi digitado diferente.
4. Para voltar ao padrão naquele aparelho: abra `https://peladanamao.com.br/?login=google`.

Quando o teste der certo, avise o Claude ("ligar o login novo para todos"): ele troca o padrão e publica.

## Nome que aparece em "continuar para…"
Esse texto **não vem do código**: vem do nome do aplicativo na tela de consentimento OAuth do Google Cloud (menu *Google Auth Platform → Identidade visual*, ou *APIs e serviços → Tela de permissão OAuth*). Se quiser "Pelada na Mão" ali, ajuste **Nome do app**, o e-mail de suporte e, se quiser, o logo e os links de privacidade e termos (`https://peladanamao.com.br/termos.html`). O Google pode pedir uma verificação para mudar o nome ou o logo, e isso pode levar dias.
