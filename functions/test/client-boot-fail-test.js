// Aviso "Não consegui abrir o app" (index.html): quando os arquivos do Firebase não carregam, o app mostra por cima de tudo
// uma tela em português com o botão Recarregar, em vez de uma tela de entrada que não entra e do aviso técnico
// ("firebase is not defined"). Extrai as funções reais e as executa num navegador simulado, sem navegador de verdade.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const showCode = slice('function showBootFailure(err) {', 'function initFirebase() {');
const initCode = slice('function initFirebase() {', '// ── Push notifications');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// navegador simulado: só o que a função usa (document, toast)
function makeDom({ createThrows = false, appendThrows = false, toastThrows = false } = {}) {
  const layers = [], toasts = [];
  const doc = {
    getElementById: id => layers.find(l => l.id === id) || null,
    createElement: () => {
      if (createThrows) throw new Error('sem DOM');
      return { id: '', style: {}, attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; } };
    },
    body: { appendChild: el => { if (appendThrows) throw new Error('sem corpo'); layers.push(el); } },
  };
  const toast = (m, t) => { if (toastThrows) throw new Error('toast quebrado'); toasts.push([m, t]); };
  return { doc, layers, toasts, toast };
}
function makeShow(opts) {
  const dom = makeDom(opts);
  const show = new Function('document', 'toast', showCode + '\nreturn showBootFailure;')(dom.doc, dom.toast);
  return { ...dom, show };
}

// ── a tela ──────────────────────────────────────────────────────────────────────────────────
let t = makeShow();
t.show(new ReferenceError('firebase is not defined'));
const layer = t.layers[0];
const h = layer?.innerHTML || '';
check('mostra uma camada solta no corpo da página', t.layers.length === 1 && layer.id === 'boot-fail', t.layers.length);
check('…que é um alerta para leitor de tela (role="alert")', layer.attrs.role === 'alert', layer.attrs);
check('…cobre a tela inteira, por cima de tudo (fixa, 4 cantos em 0, camada altíssima)', /position:fixed/.test(layer.style.cssText) && /top:0;right:0;bottom:0;left:0/.test(layer.style.cssText) && Number((/z-index:(\d+)/.exec(layer.style.cssText) || [])[1]) >= 1000000000, layer.style.cssText);
check('…com fundo e cores próprios (não depende do CSS do app, que pode nem ter carregado)', /background:#0d1117/.test(layer.style.cssText) && /color:#e6edf3/.test(layer.style.cssText) && !/var\(--/.test(layer.style.cssText + h), layer.style.cssText);
check('…e rola se a tela for pequena (celular deitado), para o botão nunca ficar escondido', /overflow:auto/.test(layer.style.cssText), layer.style.cssText);
check('título e explicação em português, dizendo as causas comuns', />Não consegui abrir o app</.test(h) && /Um arquivo de que o app precisa não carregou/.test(h) && /conexão com a internet/.test(h) && /bloqueador de conteúdo/.test(h), h);
check('o botão Recarregar recarrega a página', /<button onclick="location\.reload\(\)"[^>]*>Recarregar<\/button>/.test(h), h);
check('dá o caminho se continuar assim (outra rede, desligar o bloqueador)', /outra rede/.test(h) && /desligue o bloqueador/.test(h), h);
check('mostra o detalhe técnico em letra pequena (a pessoa pode mandar uma captura de tela)', /Detalhe técnico: firebase is not defined</.test(h), h);
check('não solta o aviso técnico antigo (toast) quando a tela aparece', t.toasts.length === 0, t.toasts);
check('não pede nada à pessoa (nenhum campo de texto) e só tem um botão', !/<input|<textarea|<select/i.test(h) && (h.match(/<button/g) || []).length === 1, h);

// ── o detalhe técnico é só texto ────────────────────────────────────────────────────────────
const detailOf = err => { const x = makeShow(); x.show(err); const m = /Detalhe técnico: ([^<]*)</.exec(x.layers[0].innerHTML); return m ? m[1] : null; };
let d = detailOf(new Error('<img src=x onerror=alert(1)> "aspas" \'simples\' `crase` & comercial'));
check('mensagem com marcação, aspas, crase e &: o detalhe sai só como texto (nada vira HTML)', d !== null && !/[<>&"'`]/.test(d), d);
t = makeShow(); t.show(new Error('<script>alert(1)</script>'));
check('…e a camada inteira nunca ganha uma tag da mensagem', !/<script/i.test(t.layers[0].innerHTML) && !/<img/i.test(t.layers[0].innerHTML));
d = detailOf(new Error('x'.repeat(500)));
check('mensagem enorme: o detalhe é cortado em 140 caracteres', d !== null && d.length === 140, d && d.length);
d = detailOf(new Error('  muitos \n\n  espaços\t aqui  '));
check('espaços e quebras de linha viram um espaço só, sem sobra nas pontas', d === 'muitos espaços aqui', d);
check('erro em forma de texto também aparece', detailOf('falhou feio') === 'falhou feio');
for (const [rotulo, err] of [['undefined', undefined], ['null', null], ['texto vazio', ''], ['objeto sem mensagem', {}], ['número', 42], ['mensagem que não é texto', { message: 7 }], ['mensagem só de espaços', new Error('   ')]]) {
  const x = makeShow();
  let ok = true; try { x.show(err); } catch (_) { ok = false; }
  check(`erro ${rotulo}: a tela aparece, sem linha de detalhe e sem "[object Object]"`, ok && x.layers.length === 1 && !/Detalhe técnico/.test(x.layers[0].innerHTML) && !/object Object|undefined|null/.test(x.layers[0].innerHTML), x.layers[0] && x.layers[0].innerHTML);
}

// ── uma camada só ───────────────────────────────────────────────────────────────────────────
t = makeShow();
t.show(new Error('primeira')); t.show(new Error('segunda'));
check('chamar duas vezes não duplica a camada (e fica a primeira)', t.layers.length === 1 && /Detalhe técnico: primeira</.test(t.layers[0].innerHTML), t.layers.length);

// ── último recurso ──────────────────────────────────────────────────────────────────────────
for (const [rotulo, opts] of [['criar a camada falha', { createThrows: true }], ['pôr a camada na página falha', { appendThrows: true }]]) {
  const x = makeShow(opts);
  let threw = false; try { x.show(new Error('sem tela')); } catch (_) { threw = true; }
  check(`${rotulo}: não estoura e cai no aviso antigo (toast "Erro ao conectar: …")`, !threw && x.toasts.length === 1 && x.toasts[0][0] === 'Erro ao conectar: sem tela', x.toasts);
}
{
  const x = makeShow({ createThrows: true, toastThrows: true });
  let threw = false; try { x.show(new Error('tudo falha')); } catch (_) { threw = true; }
  check('se até o aviso antigo falhar: continua sem estourar (o app já está quebrado, não piora)', !threw);
  const y = makeShow({ createThrows: true });
  y.show('texto puro');
  check('…o aviso antigo também aceita erro em forma de texto', y.toasts[0] && y.toasts[0][0] === 'Erro ao conectar: texto puro', y.toasts);
}

// ── a abertura de verdade (initFirebase) ────────────────────────────────────────────────────
function makeInit({ firebase, renderThrows = false } = {}) {
  const dom = makeDom();
  const reported = [], win = {}, st = { ready: false };
  let renders = 0;
  const env = {
    window: win, st, document: dom.doc, toast: dom.toast,
    pnmErr: (k, e, x) => reported.push([k, e, x]),
    render: () => { renders++; if (renderThrows) throw new Error('render quebrou'); },
    showBootFailure: new Function('document', 'toast', showCode + '\nreturn showBootFailure;')(dom.doc, dom.toast),
    APP_ENV: {}, firebaseConfig: {},
  };
  if (firebase) env.firebase = firebase;
  const names = Object.keys(env);
  const initFirebase = new Function(...names, initCode + '\nreturn initFirebase;')(...names.map(n => env[n]));
  return { initFirebase, reported, win, st, dom, renders: () => renders };
}
let i = makeInit();
i.initFirebase();
check('sem o Firebase (o arquivo nem carregou): marca a etapa "init", relata "boot" na etapa "init" e mostra o aviso', i.win.__pnmStage === 'init' && i.reported.length === 1 && i.reported[0][0] === 'boot' && i.reported[0][1] instanceof ReferenceError && /firebase is not defined/.test(i.reported[0][1].message) && i.reported[0][2].step === 'init' && i.dom.layers.length === 1 && /Detalhe técnico: firebase is not defined/.test(i.dom.layers[0].innerHTML), { reported: i.reported.length, layers: i.dom.layers.length });
check('…e a tela é liberada (st.ready) e desenhada uma vez, sem o toast técnico de antes', i.st.ready === true && i.renders() === 1 && i.dom.toasts.length === 0, { ready: i.st.ready, renders: i.renders(), toasts: i.dom.toasts });
i = makeInit({ firebase: { initializeApp() {} } });
i.initFirebase();
check('Firebase carregou pela metade (falta o Firestore): o mesmo aviso, com o detalhe do que faltou', i.dom.layers.length === 1 && /Detalhe técnico: firebase\.firestore is not a function/.test(i.dom.layers[0].innerHTML) && i.reported.length === 1 && i.reported[0][2].step === 'init', i.dom.layers[0] && i.dom.layers[0].innerHTML);
i = makeInit({ renderThrows: true });
let threw = false; try { i.initFirebase(); } catch (_) { threw = true; }
check('se o render() também quebrar logo depois, o aviso já está na tela (por isso vem antes dele)', i.dom.layers.length === 1 && threw === true, { layers: i.dom.layers.length, threw });

// ── como está escrito no código ─────────────────────────────────────────────────────────────
check('o catch da abertura relata, mostra o aviso e só então libera a tela (nessa ordem)', /pnmErr\('boot', e, \{ step: 'init' \}\);\s*showBootFailure\(e\);[^\n]*\s*st\.ready = true; render\(\);\s*\}/.test(html));
check('o aviso é chamado só ali (definição + 1 chamada) e o toast técnico antigo só existe como último recurso dentro da própria função', (html.match(/showBootFailure\(/g) || []).length === 2 && (html.match(/Erro ao conectar: /g) || []).length === 1 && /function showBootFailure[\s\S]*?toast\('Erro ao conectar: '/.test(html));
check('a camada vai para o <body>, fora da área que o render() redesenha', /document\.body\.appendChild\(root\)/.test(showCode));
check('a função é declarada (e não uma constante), então já existe quando initFirebase() roda no fim do script', /^function showBootFailure\(err\) \{/m.test(html) && /\ninitFirebase\(\);\s*\n/.test(html));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
