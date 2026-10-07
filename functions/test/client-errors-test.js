// Monitoramento de travamentos: as regras puras (client-errors.js). Limpeza do texto (nada de pessoa), validação do
// relato, grupo do erro, o que se grava, limites, resumo do painel e e-mail diário. Sem banco e sem rede.
const path = require('path');
const ce = require(path.join(__dirname, '..', 'client-errors.js'));
const funnel = require(path.join(__dirname, '..', 'funnel-metrics.js'));

let fails = 0, oks = 0;
const check = (label, cond, extra) => {
  if (cond) oks++; else fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const S = ce.sanitizeText;
const DAY = 86400000;
const hasUndefined = o => o === undefined || (o && typeof o === 'object' && Object.values(o).some(hasUndefined));

// ═══ limpeza do texto: o que pode identificar alguém sai ═════════════════════════════════════════════════════════
check('e-mail vira <email>', S('Falhou para ana.souza@gmail.com agora') === 'Falhou para <email> agora', S('Falhou para ana.souza@gmail.com agora'));
const tel = S('ligar +55 (11) 99999-8888 ou 11999998888 ou 123.456.789-09 ou 192.168.0.10');
check('telefone, CPF e IP somem (qualquer número comprido, com ou sem pontuação)', !/\d{5}/.test(tel) && !/192\.168/.test(tel) && (tel.match(/<n>/g) || []).length === 4, tel);
check('número curto (linha, coluna, versão) continua', S('erro na linha 1234 coluna 56 do firebase 10.14.1') === 'erro na linha 1234 coluna 56 do firebase 10.14.1', S('erro na linha 1234 coluna 56 do firebase 10.14.1'));
const ids = S('uid Xk9fPq2LmN7vB4tZ8cD1wE5yH3aG e token SEGREDO-abc123-DEF456-ghi789-JKL');
check('identificador comprido (id de conta, token) vira <id>', !/Xk9f|SEGREDO/.test(ids) && (ids.match(/<id>/g) || []).length === 2, ids);
check('nome de função comprido SEM número não é apagado (a pilha continua útil)', S('at checkLeagueStillMineAndReloadEverything (x)') === 'at checkLeagueStillMineAndReloadEverything (x)', S('at checkLeagueStillMineAndReloadEverything (x)'));
const fsPath = S('No document to update: projects/seriebaceoma/databases/(default)/documents/leagues/pelada-do-ze/championships/AbCdEfGhIjKlMnOpQrSt');
check('caminho de documento do Firestore (nome da liga, ids) some inteiro', /documents\/<caminho>/.test(fsPath) && !/pelada-do-ze|AbCdEf|championships/.test(fsPath), fsPath);
const pathNoDocs = S('Erro em leagues/pelada-do-ze e users/UidDaPessoa123 aqui');
check('"leagues/<nome>" e "users/<id>" soltos também somem', pathNoDocs === 'Erro em leagues/<id> e users/<id> aqui', pathNoDocs);
const url1 = S('Falha em https://peladanamao.com.br/?invite=SEGREDO123&liga=pelada-do-ze#x e mais');
check('endereço do site perde tudo depois de "?" (convite) e "#"', url1 === 'Falha em (página) e mais', url1);
const url2 = S('at https://peladanamao.com.br/?invite=ABC&oobCode=XYZ:1234:56');
check('…mas linha e coluna da pilha ficam', url2 === 'at (página):1234:56', url2);
const url3 = S('script https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js?v=1#a não carregou');
check('endereço de fora fica só com site e caminho (sem consulta)', url3 === 'script www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js não carregou', url3);
check('endereço do próprio site COM PORTA (localhost:3000, 127.0.0.1:8798) também é reconhecido; de fora, a porta fica', S('at http://127.0.0.1:8798/lab:218:33') === 'at /lab:218:33' && S('em https://localhost:3000/ falhou') === 'em (página) falhou' && S('em https://peladanamao.com.br:443/x?y=1 falhou') === 'em /x falhou' && S('em https://exemplo.com:8443/a?x=1 falhou') === 'em exemplo.com:8443/a falhou', [S('at http://127.0.0.1:8798/lab:218:33'), S('em https://exemplo.com:8443/a?x=1 falhou')]);
const url4 = S('login https://usuario:senha@exemplo.com/a/b?token=1');
check('usuário e senha dentro do endereço somem', url4 === 'login exemplo.com/a/b' && !/senha|usuario/.test(url4), url4);
check('endereço de outro tipo (extensão, blob) não vaza o caminho', S('x chrome-extension://abcdefgh/p.js:1:2') === 'x chrome-extension://…:1:2' && S('y ftp://h/seg').includes('ftp://…'), [S('x chrome-extension://abcdefgh/p.js:1:2'), S('y ftp://h/seg')]);
check('imagem embutida (data:) vira <data>', S('img data:image/png;base64,iVBORw0KGgoAAAANSUhEUg fim') === 'img <data> fim', S('img data:image/png;base64,iVBORw0KGgoAAAANSUhEUg fim'));
const quoted = S("Cannot read properties of undefined (reading 'Jogador Muito Comprido Da Silva Pereira') e 'x' e \"Fulano de Tal da Silva Sauro Junior\"");
check('texto comprido entre aspas (pode ser nome digitado) some; aspas curtas ficam', quoted === "Cannot read properties of undefined (reading '<prop>') e 'x' e \"<texto>\"" && S("disse 'um texto comprido demais para ficar na mensagem' e foi") === "disse '<texto>' e foi", quoted);
check('quebras de linha e caracteres de controle viram espaço, espaços repetidos viram um', S('a\n\tb\u0007\u0000  c\r\nd') === 'a b c d', JSON.stringify(S('a\n\tb\u0007\u0000  c\r\nd')));
const longMsg = S('a'.repeat(1000));
check('texto passa de 300 caracteres: corta e põe reticências (e nunca passa do limite)', longMsg.length === 300 && longMsg.endsWith('…'), longMsg.length);
check('entrada que não é texto: nulo vira vazio, número vira texto', S(null) === '' && S(undefined) === '' && S(42) === '42' && S({}) === '[object Object]');
const t0 = Date.now(); const big = S('1 '.repeat(500000) + 'x'.repeat(5000));
check('texto gigante não trava (processa só o começo, em milissegundos)', Date.now() - t0 < 500 && big.length <= 300, Date.now() - t0);
const corpus = ['Falhou para ana@x.com', 'at https://peladanamao.com.br/?invite=A:1:2', "reading 'Jogador Muito Comprido Da Silva Pereira'", 'uid Xk9fPq2LmN7vB4tZ8cD1wE5yH3aG', 'a'.repeat(900), '+55 (11) 99999-8888', 'x\ny', 'documents/leagues/L/championships/AbCdEfGhIjKlMnOpQrSt'];
check('limpar duas vezes dá o mesmo que limpar uma (o servidor limpa de novo o que o app já limpou)', corpus.every(c => S(S(c)) === S(c)), corpus.filter(c => S(S(c)) !== S(c)));

// ═══ pilha de erro ═══════════════════════════════════════════════════════════════════════════════════════════════
const chromeStack = 'TypeError: x is undefined\n    at renderChamp (https://peladanamao.com.br/?invite=ABC123:1234:56)\n    at render (https://peladanamao.com.br/:99:5)\n    at HTMLButtonElement.onclick (https://peladanamao.com.br/:1:1)';
const st1 = ce.sanitizeStack(chromeStack);
check('pilha: convite some, linha e coluna ficam, uma linha por trecho', st1 === 'TypeError: x is undefined\nat renderChamp ((página):1234:56)\nat render ((página):99:5)\nat HTMLButtonElement.onclick ((página):1:1)', st1);
const manyLines = Array.from({ length: 30 }, (_, i) => `    at f${i} (https://peladanamao.com.br/:${i + 10}:1)`).join('\n');
check('pilha: no máximo 8 linhas e 1200 caracteres', ce.sanitizeStack(manyLines).split('\n').length === 8 && ce.sanitizeStack('x'.repeat(5000)).length <= 180, ce.sanitizeStack(manyLines).split('\n').length);
check('pilha: trechos de extensão do navegador saem da pilha', !/extension/.test(ce.sanitizeStack('at a (chrome-extension://abc/c.js:1:1)\nat b (https://peladanamao.com.br/:5:5)')) && /at b/.test(ce.sanitizeStack('at a (chrome-extension://abc/c.js:1:1)\nat b (https://peladanamao.com.br/:5:5)')));
check('pilha: não é texto → vazio', ce.sanitizeStack(undefined) === '' && ce.sanitizeStack(12) === '' && ce.sanitizeStack(null) === '');
const tf = ce.topFrame;
check('primeiro trecho do código: Chrome ("at função (arquivo:linha:coluna)")', JSON.stringify(tf('TypeError: x\nat renderChamp ((página):1234:56)\nat render ((página):9:9)')) === '{"fn":"renderChamp","loc":"(página):1234"}', tf('TypeError: x\nat renderChamp ((página):1234:56)'));
check('…Firefox/Safari ("função@arquivo:linha:coluna")', JSON.stringify(tf('renderChamp@(página):1234:56\nrender@(página):9:9')) === '{"fn":"renderChamp","loc":"(página):1234"}', tf('renderChamp@(página):1234:56'));
check('…trecho sem nome de função (anônimo) fica só com o lugar', JSON.stringify(tf('at (página):77:3')) === '{"fn":"","loc":"(página):77"}' && JSON.stringify(tf('@(página):77:3')) === '{"fn":"","loc":"(página):77"}' && tf('at async fnAsync ((página):5:5)').fn === 'fnAsync', [tf('at (página):77:3'), tf('@(página):77:3'), tf('at async fnAsync ((página):5:5)')]);
check('…sem nenhum trecho reconhecível: vazio', JSON.stringify(tf('')) === '{"fn":"","loc":""}' && JSON.stringify(tf('TypeError: x\nsó texto')) === '{"fn":"","loc":""}' && JSON.stringify(tf(undefined)) === '{"fn":"","loc":""}');

// ═══ validação do relato ═════════════════════════════════════════════════════════════════════════════════════════
const base = { k: 'error', m: "TypeError: Cannot read properties of undefined (reading 'x')", s: "TypeError: Cannot read properties of undefined (reading 'x')\n    at renderChamp (https://peladanamao.com.br/:1234:56)\n    at render (https://peladanamao.com.br/:99:5)", v: '20261006.2150', w: 'ranking', b: 'Chrome 118', o: 'Android 13', a: false, i: false };
const P = o => ce.parseReport({ ...base, ...o });
const ok1 = P({});
check('relato bom: aceito, com tipo, mensagem, trecho do código, versão, tela, navegador e sistema', ok1.ok && ok1.report.kind === 'error' && ok1.report.fn === 'renderChamp' && ok1.report.loc === '(página):1234' && ok1.report.version === '20261006.2150' && ok1.report.view === 'ranking' && ok1.report.browser === 'Chrome 118' && ok1.report.os === 'Android 13' && /^[0-9a-f]{20}$/.test(ok1.report.fp), ok1);
for (const [rotulo, raw] of [['nulo', null], ['texto', 'oi'], ['lista', [1]], ['número', 5], ['sem tipo', { m: 'a' }], ['tipo desconhecido', { k: 'hack', m: 'a' }], ['tipo que não é texto', { k: 7, m: 'a' }], ['sem mensagem', { k: 'error' }], ['mensagem vazia', { k: 'error', m: '' }], ['mensagem só de espaços', { k: 'error', m: '  \n ' }], ['mensagem que não é texto', { k: 'error', m: { a: 1 } }]]) {
  const r = ce.parseReport(raw);
  check(`relato inválido (${rotulo}) → recusado como "invalid"`, !r.ok && r.reason === 'invalid', r);
}
check('todos os tipos conhecidos passam', ce.KINDS.every(k => ce.parseReport({ k, m: 'algo deu errado' }).ok || k === 'network'), ce.KINDS.map(k => [k, ce.parseReport({ k, m: 'algo deu errado' }).ok]));
check('campos que não existem no formato (uid, e-mail, liga, ip, ua) são ignorados e nunca chegam ao relato', (() => { const r = P({ uid: 'u1', email: 'a@b.com', liga: 'pelada', ip: '1.2.3.4', ua: 'Mozilla/5.0', nome: 'Ana' }); return r.ok && !/u1|a@b|pelada|1\.2\.3|Mozilla|Ana/.test(JSON.stringify(r.report)); })());
check('versão fora do formato vira "x"; tela fora do formato vira vazio', P({ v: '2026-10-06' }).report.version === 'x' && P({ v: 7 }).report.version === 'x' && P({ w: 'tela com espaço' }).report.view === '' && P({ w: '1abc' }).report.view === '' && P({ w: 'a'.repeat(30) }).report.view === '' && P({ w: 'financeiro' }).report.view === 'financeiro');
check('navegador: só nomes conhecidos + versão; o resto vira "Outro" (o campo é uma chave de contador: não pode crescer sem limite)', P({ b: 'Brave 12' }).report.browser === 'Outro 12' && P({ b: 'Safari 17' }).report.browser === 'Safari 17' && P({ b: 'Instagram 300' }).report.browser === 'Instagram 300' && P({ b: '<script>' }).report.browser === 'Outro' && P({ b: 'Chrome 1234' }).report.browser === 'Outro' && P({ b: 99 }).report.browser === 'Outro' && P({ b: 'Chrome' }).report.browser === 'Chrome', ['Brave 12', 'Chrome 1234'].map(b => P({ b }).report.browser));
check('sistema: só nomes conhecidos + versão; o resto vira "Outro"', P({ o: 'iOS 17' }).report.os === 'iOS 17' && P({ o: 'Fuchsia 1' }).report.os === 'Outro 1' && P({ o: 'Plan9 1' }).report.os === 'Outro' && P({ o: 'Windows' }).report.os === 'Windows' && P({ o: 'Android 130' }).report.os === 'Outro' && P({ o: '../x' }).report.os === 'Outro');
check('instalado (a) e navegador embutido (i): só verdadeiro de verdade', P({ a: true }).report.standalone === true && P({ a: 1 }).report.standalone === true && P({ a: 'sim' }).report.standalone === false && P({ i: true }).report.inapp === true && P({ i: 'x' }).report.inapp === false);
const xr = P({ x: { code: 'auth/network-request-failed', fn: 'trackEvent', col: 'championships', step: 'auth', lixo: 'x' } }).report.x;
check('detalhes extras: só código, função, coleção e etapa, no formato certo', xr.code === 'auth/network-request-failed' && xr.fn === 'trackEvent' && xr.col === 'championships' && xr.step === 'auth' && Object.keys(xr).length === 4, xr);
const xbad = P({ x: { code: 'tem espaço!', fn: '1abc', col: 'Maiuscula', step: 'COM_MAIUSCULA' } }).report.x;
check('…valores fora do formato viram vazio (nada de texto livre entra por aqui)', Object.values(xbad).every(v => v === ''), xbad);
check('…"x" que não é objeto é ignorado', P({ x: 'abc' }).report.x.code === '' && P({ x: [1] }).report.x.fn === '' && P({ x: null }).report.x.col === '');
// o que não é defeito do app
for (const [rotulo, raw] of [
  ['ResizeObserver', { m: 'ResizeObserver loop limit exceeded' }],
  ['ResizeObserver (outra frase)', { m: 'ResizeObserver loop completed with undelivered notifications.' }],
  ['"Script error." sem detalhe', { m: 'Script error.' }],
  ['janela de login fechada', { m: 'Firebase: Error (auth/popup-closed-by-user).' }],
  ['janela de login cancelada', { m: 'auth/cancelled-popup-request' }],
  ['a pessoa cancelou (AbortError)', { m: 'AbortError: Share canceled' }],
  ['pilha de extensão', { m: 'boom', s: 'Error: boom\n    at x (chrome-extension://abcdef/content.js:1:1)' }],
  ['extensão do Firefox', { m: 'boom', s: 'x@moz-extension://abcdef/c.js:1:1' }],
  ['mensagem cita extensão', { m: 'falhou em safari-web-extension://abc/x.js' }],
]) {
  const r = P(raw);
  check(`ruído ignorado: ${rotulo}`, !r.ok && r.reason === 'ignored', r);
}
check('erro do app com extensão só no fundo da pilha NÃO é ignorado (só os primeiros trechos contam)', P({ s: 'at a (https://peladanamao.com.br/:1:1)\nat b (https://peladanamao.com.br/:2:2)\nat c (https://peladanamao.com.br/:3:3)\nat d (chrome-extension://x/y.js:1:1)' }).ok);
check('falha de rede: "error" e "rejection" viram o tipo "network" (e ficam fora das contas de defeito)', ['TypeError: Failed to fetch', 'TypeError: Load failed', 'NetworkError when attempting to fetch resource.', 'Firebase: Error (auth/network-request-failed).'].every(m => P({ m, s: '' }).report.kind === 'network') && P({ k: 'rejection', m: 'TypeError: Failed to fetch' }).report.kind === 'network' && P({ m: 'x', x: { code: 'unavailable' } }).report.kind === 'network');
check('…mas arquivo que não carregou, travamento da abertura e falha de função não viram "rede"', P({ k: 'resource', m: 'Failed to fetch script' }).report.kind === 'resource' && P({ k: 'boot', m: 'não terminou: failed to fetch' }).report.kind === 'boot' && P({ k: 'callable', m: 'failed to fetch' }).report.kind === 'callable');

// ═══ o grupo do erro (impressão digital) ═════════════════════════════════════════════════════════════════════════
const fp = o => P(o).report.fp;
const same = (label, a, b) => check(label, fp(a) === fp(b), [fp(a), fp(b)]);
const diff = (label, a, b) => check(label, fp(a) !== fp(b), [fp(a), fp(b)]);
same('mesmo erro com outra linha, outra versão, outro navegador, outra tela: mesmo grupo', {}, { s: base.s.replace(':1234:56', ':2000:9'), v: '20261008.1000', b: 'Safari 17', o: 'iOS 17', w: 'home', a: true });
same('…e com números e ids diferentes na mensagem: mesmo grupo', { m: 'Cannot read properties of undefined (reading 0) em 12' }, { m: 'Cannot read properties of undefined (reading 7) em 999' });
same('…e com e-mail diferente na mensagem (some na limpeza): mesmo grupo', { m: 'falhou para ana@x.com' }, { m: 'falhou para beto@y.org' });
same('…e com marcadores diferentes no mesmo lugar (e-mail num relato, identificador no outro): mesmo grupo', { m: 'falhou para ana@x.com' }, { m: 'falhou para Xk9fPq2LmN7vB4tZ8cD1wE5yH3aG' });
diff('mensagem diferente: outro grupo', {}, { m: 'ReferenceError: foo is not defined' });
diff('tipo diferente: outro grupo', {}, { k: 'rejection' });
diff('função do código diferente: outro grupo', {}, { s: base.s.replace('renderChamp', 'renderOutra') });
diff('código do Firebase diferente: outro grupo', { k: 'listener', m: 'x', x: { code: 'unavailable' } }, { k: 'listener', m: 'x', x: { code: 'internal' } });
diff('coleção diferente: outro grupo (cada lista de dados tem o seu)', { k: 'listener', m: 'x', x: { col: 'championships' } }, { k: 'listener', m: 'x', x: { col: 'player_titles' } });
diff('função do servidor diferente: outro grupo', { k: 'callable', m: 'x', x: { fn: 'trackEvent' } }, { k: 'callable', m: 'x', x: { fn: 'joinLeague' } });
diff('etapa da abertura diferente: outro grupo (travou em lugares diferentes)', { k: 'boot', m: 'x', x: { step: 'init' } }, { k: 'boot', m: 'x', x: { step: 'auth' } });
same('em "listener"/"boot"/"callable" o trecho do código NÃO entra na chave (a função que chamou muda)', { k: 'listener', m: 'x', x: { col: 'a' }, s: 'at a ((página):1:1)' }, { k: 'listener', m: 'x', x: { col: 'a' }, s: 'at b ((página):2:2)' });
check('o grupo tem sempre 20 caracteres hexadecimais e é o mesmo a cada cálculo', fp({}) === fp({}) && /^[0-9a-f]{20}$/.test(fp({})));

// ═══ o que se grava ═════════════════════════════════════════════════════════════════════════════════════════════
const inc = n => ({ __inc: n });
const NOW = Date.UTC(2026, 9, 6, 15, 30); // 06/10/2026 12:30 em São Paulo
const today = funnel.dayKeySP(NOW);
const rep = o => P(o).report;
const w1 = ce.groupWrite(rep({ x: { code: 'permission-denied', fn: 'trackEvent', col: 'championships', step: 'auth' }, a: true, i: true }), { now: NOW, exists: false, increment: inc });
check('grupo novo: tem firstSeen e firstVersion', w1.firstSeen === new Date(NOW).toISOString() && w1.firstVersion === '20261006.2150' && w1.lastSeen === w1.firstSeen, w1);
check('…contadores do dia, da versão, do navegador, do sistema, da tela, do código, de instalado e de embutido, todos "somar 1"', JSON.stringify(w1.days) === JSON.stringify({ ['d' + today.replace(/-/g, '')]: inc(1) }) && JSON.stringify(w1.versions) === JSON.stringify({ v20261006_2150: inc(1) }) && JSON.stringify(w1.browsers) === JSON.stringify({ 'Chrome 118': inc(1) }) && JSON.stringify(w1.oses) === JSON.stringify({ 'Android 13': inc(1) }) && JSON.stringify(w1.views) === JSON.stringify({ ranking: inc(1) }) && JSON.stringify(w1.codes) === JSON.stringify({ 'permission-denied': inc(1) }) && w1.count.__inc === 1 && w1.standalone.__inc === 1 && w1.inapp.__inc === 1, w1);
check('…os detalhes fixos (função, coleção, etapa), a mensagem e o trecho do código vão junto', JSON.stringify(w1.extra) === '{"fn":"trackEvent","col":"championships","step":"auth"}' && w1.message === base.m && w1.fn === 'renderChamp' && w1.kind === 'error' && /renderChamp/.test(w1.stack), w1);
const w2 = ce.groupWrite(rep({ w: '' }), { now: NOW, exists: true, increment: inc });
check('grupo que já existe: NÃO regrava firstSeen/firstVersion; sem tela, sem código, sem instalado nem embutido: esses contadores nem aparecem', !('firstSeen' in w2) && !('firstVersion' in w2) && !('views' in w2) && !('codes' in w2) && !('standalone' in w2) && !('inapp' in w2) && w2.count.__inc === 1, Object.keys(w2));
check('nada indefinido no que vai para o banco (o Firestore recusa)', !hasUndefined(w1) && !hasUndefined(w2) && !hasUndefined(ce.groupWrite(rep({ s: '', v: 'zz', b: undefined, o: undefined }), { now: NOW, exists: false, increment: inc })));
const wk = ce.groupWrite(rep({ x: { code: 'auth/network-request-failed' }, b: 'Chrome 118' }), { now: NOW, exists: false, increment: inc });
check('chaves dos contadores nunca têm "." nem "/" (caminho de campo do Firestore)', Object.keys(wk.codes).every(k => !/[./]/.test(k)) && Object.keys(wk.versions).every(k => !/[./]/.test(k)) && Object.keys(wk.days).every(k => !/[./]/.test(k)), [wk.codes, wk.versions]);
check('a versão desconhecida ("x") também vira chave válida', Object.keys(ce.groupWrite(rep({ v: 'zz' }), { now: NOW, exists: true, increment: inc }).versions)[0] === 'vx');
check('o dia do contador é o de São Paulo, não o do servidor (23h de SP ainda é o mesmo dia)', Object.keys(ce.groupWrite(rep({}), { now: Date.UTC(2026, 9, 7, 2, 30), exists: true, increment: inc }).days)[0] === 'd20261006', Object.keys(ce.groupWrite(rep({}), { now: Date.UTC(2026, 9, 7, 2, 30), exists: true, increment: inc }).days));
check('mapKey: troca o que não é letra, número, espaço, "_" e "-"; nunca devolve vazio nem passa de 40', ce.mapKey('a.b/c') === 'a_b_c' && ce.mapKey('') === '_' && ce.mapKey('x'.repeat(100)).length === 40 && ce.mapKey('Chrome 118') === 'Chrome 118');

// ═══ limite por endereço, endereço e corpo do pedido ═════════════════════════════════════════════════════════════
{
  const lim = ce.makeLimiter({ max: 3, windowMs: 1000, maxKeys: 4 });
  const r = [0, 1, 2, 3, 4].map(() => lim.allow('a', 100));
  check('limitador: deixa passar até o máximo na janela e corta o resto', JSON.stringify(r) === '[true,true,true,false,false]', r);
  check('…outro endereço tem a própria conta', lim.allow('b', 100) === true);
  check('…depois da janela, recomeça', lim.allow('a', 1100) === true && lim.allow('a', 1101) === true && lim.allow('a', 1102) === true && lim.allow('a', 1103) === false);
  const l2 = ce.makeLimiter({ max: 1, windowMs: 1000, maxKeys: 3 });
  l2.allow('1', 0); l2.allow('2', 0); l2.allow('3', 0);
  check('limitador: com a memória cheia, esquece os que já passaram da janela', l2.size() === 3 && l2.allow('4', 5000) === true && l2.size() <= 3, l2.size());
  const l3 = ce.makeLimiter({ max: 1, windowMs: 100000, maxKeys: 3 });
  l3.allow('1', 0); l3.allow('2', 0); l3.allow('3', 0);
  check('…e se todos ainda valem, zera tudo (nunca cresce sem limite)', l3.allow('4', 1) === true && l3.size() === 1, l3.size());
  check('limitador padrão: 10 por minuto', (() => { const d = ce.makeLimiter(); let n = 0; for (let i = 0; i < 20; i++) if (d.allow('x', 0)) n++; return n === 10 && ce.IP_MAX_PER_MINUTE === 10; })());
}
check('endereço: o primeiro do x-forwarded-for; senão req.ip; senão o do soquete; senão "?"', ce.clientIp({ headers: { 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' }, ip: '1.1.1.1' }) === '203.0.113.9' && ce.clientIp({ headers: {}, ip: '1.1.1.1' }) === '1.1.1.1' && ce.clientIp({ headers: {}, socket: { remoteAddress: '2.2.2.2' } }) === '2.2.2.2' && ce.clientIp({ headers: {} }) === '?' && ce.clientIp({}) === '?');
check('endereço: nunca passa de 64 caracteres', ce.clientIp({ headers: { 'x-forwarded-for': 'a'.repeat(500) } }).length === 64);
const body = ce.bodyOf;
check('corpo do pedido: objeto já lido, texto (sendBeacon), bytes e rawBody', body({ body: { k: 'x' } }).k === 'x' && body({ body: '{"k":"y"}' }).k === 'y' && body({ body: Buffer.from('{"k":"z"}') }).k === 'z' && body({ rawBody: Buffer.from('{"k":"w"}') }).k === 'w');
check('…ilegível, vazio ou grande demais → null', body({ body: 'isso não é json' }) === null && body({ body: '' }) === null && body({}) === null && body({ body: '{"m":"' + 'a'.repeat(7000) + '"}' }) === null && body({ body: Buffer.alloc(7000, 97) }) === null);

// ═══ resumo para o painel do dono ═══════════════════════════════════════════════════════════════════════════════
const dk = i => funnel.dayKeySP(NOW - i * DAY);
const df = i => ce.dayField(dk(i));
const grp = (id, o) => ({ id, kind: 'error', message: 'msg ' + id, stack: 's', fn: 'f', loc: 'l', count: 1, firstSeen: new Date(NOW - 20 * DAY).toISOString(), lastSeen: new Date(NOW).toISOString(), days: {}, versions: {}, browsers: {}, oses: {}, views: {}, codes: {}, ...o });
const groups = [
  grp('a', { count: 50, days: { [df(0)]: 4, [df(1)]: 3, [df(6)]: 2, [df(7)]: 40, [df(13)]: 1 }, versions: { v20261006_2150: 5, v20261001_1000: 4, vx: 2, v20260101_0000: 1 }, browsers: { 'Chrome 118': 6, 'Safari 17': 3, 'Firefox 120': 1, 'Edge 118': 1 }, views: { ranking: 7, home: 2 }, codes: { 'permission-denied': 3 }, extra: { fn: 'trackEvent', col: '', step: '' }, standalone: 2, inapp: 1 }),
  grp('b', { kind: 'boot', count: 3, days: { [df(0)]: 3 }, firstSeen: new Date(NOW - 3600000).toISOString() }),
  grp('rede', { kind: 'network', count: 30, days: { [df(0)]: 30 } }),
  grp('velho', { count: 9, days: { [df(14)]: 9, [df(30)]: 2 }, lastSeen: new Date(NOW - 14 * DAY).toISOString() }),
  grp('c', { count: 7, days: { [df(2)]: 7 } }),
];
const sm = ce.summarize(groups, { [dk(0)]: { total: 37, dropped: 2 }, [dk(1)]: { total: 3 } }, NOW);
check('resumo: ordena pelo que mais apareceu nos últimos 7 dias (e só entra grupo com relato nos últimos 14)', sm.groups.map(g => g.fp).join() === 'rede,c,a,b'.split(',').sort((x, y) => ({ rede: 30, c: 7, a: 9, b: 3 }[y] - { rede: 30, c: 7, a: 9, b: 3 }[x])).join() && !sm.groups.some(g => g.fp === 'velho'), sm.groups.map(g => g.fp));
const ga = sm.groups.find(g => g.fp === 'a');
check('resumo: 7 dias, hoje e ontem de cada grupo (relatos de 7 dias atrás ficam de fora dos 7 dias)', ga.last7 === 9 && ga.today === 4 && ga.yesterday === 3 && ga.count === 50, ga);
check('resumo: gráfico de 14 dias, do mais antigo para o mais novo', ga.spark.length === 14 && ga.spark[13] === 4 && ga.spark[12] === 3 && ga.spark[7] === 2 && ga.spark[6] === 40 && ga.spark[0] === 1, ga.spark);
check('resumo: versões (com o nome de volta ao normal), navegadores, telas e códigos: os 3 mais comuns', JSON.stringify(ga.versions) === '[{"name":"20261006.2150","count":5},{"name":"20261001.1000","count":4},{"name":"x","count":2}]' && ga.browsers.length === 3 && ga.browsers[0].name === 'Chrome 118' && ga.views[0].name === 'ranking' && ga.codes[0].name === 'permission-denied' && ga.standalone === 2 && ga.inapp === 1 && ga.extra.fn === 'trackEvent', ga);
check('resumo: "novo" = primeiro relato nas últimas 48 h', sm.groups.find(g => g.fp === 'b').isNew === true && ga.isNew === false);
check('resumo: totais (rede entra nos relatos, mas não nos "defeitos")', sm.totals.reports7d === 9 + 3 + 30 + 7 && sm.totals.crashes7d === 9 + 3 + 7 && sm.totals.today === 4 + 3 + 30 && sm.totals.groups7d === 4 && sm.totals.newGroups48h === 1, sm.totals);
check('resumo: 14 dias de totais por dia (do mais antigo ao mais novo), com o que foi descartado', sm.days.length === 14 && sm.days[13].total === 37 && sm.days[13].dropped === 2 && sm.days[12].total === 3 && sm.days[0].total === 0 && sm.days[13].day === dk(0), sm.days.slice(-3));
const many = Array.from({ length: 40 }, (_, i) => grp('g' + i, { days: { [df(0)]: i + 1 } }));
const smMany = ce.summarize(many, {}, NOW, 25);
check('resumo: mostra no máximo 25 grupos e diz quantos ficaram de fora', smMany.groups.length === 25 && smMany.omitted === 15 && smMany.groups[0].fp === 'g39', [smMany.groups.length, smMany.omitted]);
const sw = ce.summarize([grp('lixo', { kind: 'zzz', count: '12', days: { [df(0)]: '3' }, versions: { vx: 'a' }, firstSeen: undefined, stack: undefined, message: undefined, extra: null })], null, NOW);
check('resumo: aguenta dados estranhos (tipo desconhecido, números em texto, campos faltando) sem estourar', sw.groups.length === 1 && sw.groups[0].kind === 'error' && sw.groups[0].count === 12 && sw.groups[0].today === 3 && sw.groups[0].message === '' && sw.groups[0].isNew === false, sw.groups[0]);
check('resumo: nada de grupos → tudo zerado, 14 dias', (() => { const e = ce.summarize([], {}, NOW); return e.groups.length === 0 && e.totals.reports7d === 0 && e.days.length === 14 && e.omitted === 0; })());
check('resumo: a pilha do painel tem no máximo 700 caracteres', ce.summarize([grp('s', { stack: 'x'.repeat(2000), days: { [df(0)]: 1 } })], {}, NOW).groups[0].stack.length === 700);

// ═══ quais grupos merecem e-mail ═════════════════════════════════════════════════════════════════════════════════
const H = 3600000;
const dg = (id, o) => grp(id, { firstSeen: new Date(NOW - 30 * DAY).toISOString(), ...o });
const pickIds = gs => ce.digestPicks(gs, NOW).map(p => p.g.id);
check('e-mail: grupo NOVO (primeiro relato há menos de 36 h) entra, mesmo com 1 relato só', pickIds([dg('n', { firstSeen: new Date(NOW - 35 * H).toISOString(), days: { [df(0)]: 1 } })]).join() === 'n');
check('…com 37 h já não é novo', pickIds([dg('n', { firstSeen: new Date(NOW - 37 * H).toISOString(), days: { [df(0)]: 1 } })]).length === 0);
check('e-mail: alta repentina = 5 ou mais relatos entre ontem e hoje E pelo menos 3 vezes a média diária dos 7 dias antes', pickIds([dg('s', { days: { [df(1)]: 3, [df(0)]: 2, [df(2)]: 7, [df(3)]: 0 } })]).join() === 's', 'média 1/dia (7÷7), recente 5');
check('…5 relatos mas a média já é alta (crônico): não entra', pickIds([dg('c', { days: { [df(0)]: 3, [df(1)]: 2, [df(2)]: 14, [df(3)]: 14, [df(4)]: 14 } })]).length === 0);
check('…4 relatos (abaixo de 5): não entra', pickIds([dg('q', { days: { [df(0)]: 2, [df(1)]: 2 } })]).length === 0);
check('…sem relato em ontem nem hoje: não entra, mesmo sendo novo no papel', pickIds([dg('o', { firstSeen: new Date(NOW - 35 * H).toISOString(), days: { [df(2)]: 9 } })]).length === 0);
check('e-mail: falha de rede nunca entra (conexão ruim não é defeito do app)', pickIds([dg('r', { kind: 'network', firstSeen: new Date(NOW - H).toISOString(), days: { [df(0)]: 50 } })]).length === 0);
check('e-mail: do que mais apareceu para o que menos', pickIds([dg('x1', { days: { [df(0)]: 6 } }), dg('x2', { days: { [df(0)]: 20 } }), dg('x3', { days: { [df(0)]: 9 } })]).join() === 'x2,x3,x1');
check('e-mail: marca se é novo, se é alta, e conta ontem+hoje', (() => { const p = ce.digestPicks([dg('m', { firstSeen: new Date(NOW - H).toISOString(), days: { [df(0)]: 2, [df(1)]: 4 } })], NOW)[0]; return p.isNew === true && p.spike === true && p.recent === 6; })());
const evil = '<img src=x onerror=alert(1)> & "aspas"';
const picks = ce.digestPicks([dg('e', { kind: 'callable', message: evil, fn: '<b>f</b>', loc: '(página):12', firstSeen: new Date(NOW - H).toISOString(), count: 8, days: { [df(0)]: 5, [df(1)]: 2 }, views: { ranking: 5 }, browsers: { 'Chrome 118': 6, 'Safari 17': 1 }, versions: { v20261006_2150: 7 }, codes: { internal: 7 } })], NOW);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mail = ce.digestEmail(picks, { appUrl: 'https://peladanamao.com.br/', escape: esc, now: NOW });
check('e-mail: assunto conta os erros novos', mail.subject === '1 erro(s) novo(s) no app', mail.subject);
check('e-mail: a mensagem, a função e o resto que vieram de fora saem ESCAPADOS no HTML (nada executa)', !/<img|<b>f/.test(mail.html) && /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;aspas&quot;/.test(mail.html) && /&lt;b&gt;f&lt;\/b&gt;/.test(mail.html), mail.html.slice(0, 600));
check('e-mail: o texto simples tem tipo, mensagem, contagens, telas, navegadores, versões, códigos e onde, e o endereço do app', /\[Falha no servidor\] <img src=x onerror=alert\(1\)>/.test(mail.text) && /7 relato\(s\) em ontem e hoje · 8 no total/.test(mail.text) && /Telas: ranking \(5\)/.test(mail.text) && /Chrome 118 \(6\), Safari 17 \(1\)/.test(mail.text) && /Versões: 20261006\.2150 \(7\)/.test(mail.text) && /Códigos: internal \(7\)/.test(mail.text) && /Onde: função <b>f<\/b> · \(página\):12/.test(mail.text) && /https:\/\/peladanamao\.com\.br\//.test(mail.text) && !/<(p|div|a) /.test(mail.text), mail.text);
check('e-mail: avisa que os relatos não têm dado de ninguém e como passar para o Claude', /não têm nome, e-mail, WhatsApp, liga nem conta/.test(mail.text) && /Claude/.test(mail.text));
const alta = ce.digestEmail(ce.digestPicks([dg('h', { days: { [df(0)]: 7 } })], NOW), { appUrl: 'https://x/', escape: esc, now: NOW });
const evilPick = ce.digestPicks([dg('v', { kind: 'callable', message: 'm', fn: 'f', loc: '', firstSeen: new Date(NOW - H).toISOString(), count: 1, days: { [df(0)]: 1 }, views: { [evil]: 1 }, browsers: { [evil]: 1 }, versions: { ['v' + evil]: 1 }, codes: { [evil]: 1 } })], NOW);
const evilMail = ce.digestEmail(evilPick, { appUrl: 'https://x/"onmouseover="alert(1)', escape: esc, now: NOW });
check('e-mail: telas, navegadores, versões, códigos e o endereço do app também saem escapados no HTML (nenhum atributo nem tag nova)', !/<img/.test(evilMail.html) && !/"onmouseover="alert/.test(evilMail.html) && (evilMail.html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 4 && /href="https:\/\/x\/&quot;onmouseover=&quot;alert\(1\)"/.test(evilMail.html), evilMail.html.slice(-700));
check('e-mail: sem nenhum erro novo, o assunto fala do erro repetido e do número de relatos', alta.subject === 'Erro repetido no app (7 relatos)' && /\(em alta\)/.test(alta.text) && !/\(NOVO\)/.test(alta.text), alta.subject);
const manyPicks = ce.digestPicks(Array.from({ length: 12 }, (_, i) => dg('p' + i, { firstSeen: new Date(NOW - H).toISOString(), days: { [df(0)]: i + 1 } })), NOW);
const mailMany = ce.digestEmail(manyPicks, { appUrl: 'https://x/', escape: esc, now: NOW });
check('e-mail: no máximo 8 grupos', (mailMany.text.match(/^\d+\. \[/gm) || []).length === 8 && mailMany.subject === '8 erro(s) novo(s) no app', mailMany.subject);

// ═══ constantes que protegem o custo ═════════════════════════════════════════════════════════════════════════════
// ═══ chave de propriedade na mensagem do erro: nome de gente sai ═════════════════════════════════════════════════
const reading = k => "Cannot read properties of undefined (reading '" + k + "')";
check("Chrome: 'reading <nome de gente>' vira <prop>; campo do código (minúsculo, snake_case, índice curto) fica", S(reading('João Silva')) === reading('<prop>') && S(reading('champion_players')) === reading('champion_players') && S(reading('url')) === reading('url') && S(reading('0')) === reading('0') && S("Cannot set properties of null (setting 'freeMode')") === "Cannot set properties of null (setting 'freeMode')", [S(reading('João Silva')), S(reading('champion_players'))]);
check('…nome com maiúscula no começo, com espaço, hífen, acento, número comprido, vazio ou comprido demais também sai', ['Caio', 'Ana Maria', 'ana-maria', 'João', '1234567', '', 'x'.repeat(41), '<id>'].every(k => S(reading(k)) === reading('<prop>')), ['Caio', 'Ana Maria', 'ana-maria', 'João', '1234567', '', 'x'.repeat(41)].map(k => S(reading(k))));
check('Firefox: \'can\'t access property "Maria"\' vira <prop>; "length" fica; assign to e delete também', S('can\'t access property "Maria", x is undefined') === 'can\'t access property "<prop>", x is undefined' && S('can\'t access property "length", x is undefined') === 'can\'t access property "length", x is undefined' && S('can\'t assign to property "Zé" on 5: not an object') === 'can\'t assign to property "<prop>" on 5: not an object' && S('can\'t delete property "Zé" of x') === 'can\'t delete property "<prop>" of x', [S('can\'t access property "Maria", x is undefined'), S('can\'t assign to property "Zé" on 5: not an object')]);
check('…e limpar de novo não muda nada', [reading('João Silva'), reading('url'), 'can\'t access property "Maria", x is undefined'].every(c => S(S(c)) === S(c)));
check('o relato inteiro com esse tipo de mensagem: a mensagem e o grupo não carregam o nome', (() => { const r = P({ m: "TypeError: Cannot read properties of undefined (reading 'Neymar Jr')", s: '' }); return r.ok && !/Neymar/.test(JSON.stringify(r.report)) && r.report.message === "TypeError: Cannot read properties of undefined (reading '<prop>')"; })());
// ═══ lacunas apontadas pelas mutações ═══════════════════════════════════════════════════════════════════════════
{
  const longStack = ce.sanitizeStack(Array(8).fill('a'.repeat(300)).join('\n'));
  check('pilha: 8 linhas compridas passam de 1200 caracteres: corta em exatamente 1200 e põe reticências', longStack.length === 1200 && longStack.endsWith('…'), longStack.length);
  check('navegador com nome comprido demais (mais de 12 letras) vira só "Outro", sem a versão', P({ b: 'Navegadorcomprido 12' }).report.browser === 'Outro' && P({ b: 'Navegador 12' }).report.browser === 'Outro 12');
  const lm = ce.makeLimiter({ max: 1, windowMs: 1000, maxKeys: 3 });
  lm.allow('velho', 0); lm.allow('b', 900); lm.allow('c', 900);
  check('limitador: com a memória cheia, esquece SÓ os que passaram da janela (quem ainda vale continua contado)', lm.allow('novo', 1000) === true && lm.allow('b', 1000) === false && lm.allow('c', 1000) === false && lm.size() === 3, lm.size());
  const tie = ce.summarize([grp('t', { days: { [df(0)]: 1 }, versions: { vx: 2, v20261006_2150: 2, v20260101_0000: 2, v20261001_1000: 2 } })], {}, NOW).groups[0].versions.map(v => v.name).join();
  check('resumo: empate nos contadores desempata pelo nome (sempre a mesma ordem, qualquer que seja a ordem em que vieram)', tie === '20260101.0000,20261001.1000,20261006.2150', tie);
}
check('limites: pedido de até 6 KB, 3000 relatos e 150 grupos novos por dia, 10 por minuto por endereço, grupos guardados 45 dias', ce.MAX_BODY_BYTES === 6144 && ce.MAX_REPORTS_PER_DAY === 3000 && ce.MAX_NEW_GROUPS_PER_DAY === 150 && ce.IP_MAX_PER_MINUTE === 10 && ce.KEEP_GROUP_DAYS === 45 && ce.KEEP_META_DAYS === 60);
check('todo tipo de erro tem um nome em português para o painel', ce.KINDS.every(k => typeof ce.KIND_LABEL[k] === 'string' && ce.KIND_LABEL[k].length > 3));

console.log(`\n${fails === 0 ? `Todos os testes passaram (${oks})` : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
