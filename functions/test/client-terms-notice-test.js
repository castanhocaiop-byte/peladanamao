// Termos de Uso 1.5 (termos.html) e o aviso de Termos novos dentro do app (index.html, cláusula 18): a cláusula 10 diz o direito de
// desistir em 7 dias (art. 49 do CDC) e como pedir; os avisos do app dizem o mesmo; quem já tinha conta antes da vigência vê uma
// faixa UMA vez por aparelho; quem criou a conta depois, não. Extrai o código real do index.html e o executa num ambiente simulado.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const termos = fs.readFileSync(path.join(root, 'termos.html'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};
const at = s => { const i = html.indexOf(s); if (i < 0) throw new Error('trecho não encontrado: ' + s); return i; };
function slice(from, to) { const a = at(from); const b = html.indexOf(to, a); if (b < 0) throw new Error('marcador não encontrado: ' + to); return html.slice(a, b); }
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(');
const clause = id => { const a = termos.indexOf(`id="${id}"`); const b = termos.indexOf('</section>', a); return a < 0 || b < 0 ? '' : termos.slice(a, b); };

// ── Termos de Uso 1.5 ───────────────────────────────────────────────────────────────────────────
check('Termos: versão 1.5, vigente desde 09/10/2026 (cabeçalho)', /<span>Versão: 1\.5<\/span>\s*<span>Vigente desde: 09\/10\/2026<\/span>/.test(termos));
const c10 = plain(clause('c10'));
check('cláusula 10: dá o direito de desistir em até 7 dias contados do pagamento, sem justificar, com o valor de volta (art. 49 do CDC)', /desistir em até 7 \(sete\) dias contados do pagamento/.test(c10) && /sem precisar justificar/.test(c10) && /receber de volta o valor pago/.test(c10) && /art\. 49 do Código de Defesa do Consumidor/.test(c10), c10.slice(-1400));
check('…diz como pedir (e-mail de contato, com o nome da Liga e o e-mail da conta), como é devolvido (mesmo meio de pagamento) e o que acontece com o plano (mensal cancelada, Liga volta ao gratuito, histórico preservado)', /escrever para contato@peladanamao\.com\.br/.test(c10) && /nome da Liga e o e-mail da conta/.test(c10) && /mesmo meio de pagamento/.test(c10) && /assinatura mensal é cancelada e a Liga volta ao plano gratuito, com o histórico preservado/.test(c10), c10.slice(-1400));
check('…e só DEPOIS desses 7 dias não há reembolso (nem proporcional), mantendo a ressalva dos direitos irrenunciáveis do consumidor', /Depois desses 7 dias, os valores pagos pelos planos pagos não são reembolsáveis, nem de forma proporcional/.test(c10) && /ressalvados os direitos que a lei brasileira considere irrenunciáveis em relações de consumo/.test(c10) && c10.indexOf('desistir em até 7') < c10.indexOf('não são reembolsáveis'), c10.slice(-900));
check('cláusula 10: o rótulo do quadro mudou de "Sem reembolso" para o direito de arrependimento', /Direito de arrependimento e reembolso/.test(termos) && !/<div class="lbl">Sem reembolso<\/div>/.test(termos));
const c17 = plain(clause('c17'));
check('cláusula 17: o encerramento da Liga continua sem reembolso, salvo o direito de desistir em até 7 dias (cláusula 10)', /sem direito a reembolso, salvo o direito de desistir em até 7 dias do pagamento \(cláusula 10\)/.test(c17), c17);
check('cláusula 18 continua prometendo avisar mudanças relevantes dentro do aplicativo (é o que a faixa cumpre)', /Mudanças relevantes serão avisadas dentro do aplicativo/.test(plain(clause('c18'))));
check('cláusula 20: o e-mail de contato é o mesmo em que o pedido de desistência é feito', /contato@peladanamao\.com\.br/.test(plain(clause('c20'))));
check('rodapé: conta a versão 1.5 (o direito de desistir) e continua dizendo que revisão por advogado é recomendável', /versão 1\.5, vigente desde 09\/10\/2026/.test(termos) && /desistir em até 7 dias do pagamento/.test(termos.slice(termos.indexOf('<footer'))) && /uma revisão por advogado continua recomendável/.test(termos));
check('não sobrou nenhuma versão antiga como "atual" nos Termos (a 1.4 só aparece na história do rodapé)', (termos.match(/vers[ãa]o 1\.4/gi) || []).length === 1 && /de 06\/10\/2026, trouxe a recuperação/.test(termos));

// ── os avisos do app dizem o mesmo ──────────────────────────────────────────────────────────────
check('apresentação: o aviso de pagamento diz o direito de desistir em 7 dias e linka a cláusula 10', /Você pode desistir em até 7 dias depois de pagar e receber o valor de volta; depois disso, não há reembolso\. Veja os <a href="\/termos\.html#c10">Termos de Uso<\/a>\./.test(html));
check('tela de assinatura: o aviso diz o direito, o e-mail para pedir e que depois não há reembolso', /Você pode desistir em até 7 dias depois de pagar e receber o valor de volta \(escreva para contato@peladanamao\.com\.br\); depois disso, não há reembolso\. Ao \$\{what\}, você concorda com os/.test(html));
check('cancelar a assinatura mensal e encerrar a liga: os avisos de "não há reembolso" ressalvam os 7 dias para desistir', /Não há reembolso do período já pago, exceto dentro dos 7 dias para desistir da compra\./.test(html) && /Não há reembolso do valor já pago, exceto dentro dos 7 dias para desistir da compra \(Termos de Uso, cláusula 10\)\./.test(html));
check('nenhum aviso do app diz mais "Não há reembolso" ou "não são reembolsáveis" sem a ressalva dos 7 dias', !/Não há reembolso\.(?! Ao)/.test(html) && !/não são reembolsáveis/.test(html) && !/Não há reembolso\. Ao/.test(html), (html.match(/.{40}[Nn]ão há reembolso.{60}/g) || []).slice(0, 4));
const manualPlain = plain(manual);
check('manual: explica o direito de desistir, o passo a passo para atender o pedido, a versão 1.5 dos Termos e o aviso dentro do app', /Direito de arrependimento \(7 dias\) e reembolso/.test(manualPlain) && /Como atender um pedido de desistência/.test(manualPlain) && /A versão atual é a 1\.5, vigente desde 09\/10\/2026/.test(manualPlain) && /Aviso de Termos novos dentro do app/.test(manualPlain) && !/versão 1\.4\)/.test(manualPlain), manualPlain.match(/.{30}versão 1\.4.{30}/g));

// ── o aviso de Termos novos (cláusula 18) ───────────────────────────────────────────────────────
const code = slice('const TERMS_VERSION', '/* ── Contadores de uso (anônimos)');
function makeEnv({ authUser = { metadata: { creationTime: 'Mon, 05 Oct 2026 12:00:00 GMT' } }, stored = null, storageThrows = false } = {}) {
  const store = stored === null ? {} : { aceoma_termos_visto: stored };
  const calls = { renders: 0 };
  const localStorage = storageThrows
    ? { getItem() { throw new Error('indisponível'); }, setItem() { throw new Error('indisponível'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const env = { st: { authUser }, localStorage, render: () => { calls.renders++; } };
  const names = Object.keys(env);
  const api = new Function(...names, code + '\nreturn { termsNoticeInfo, termsNotice, dismissTermsNotice, TERMS_VERSION, TERMS_EFFECTIVE_MS, TERMS_SEEN_KEY };')(...names.map(n => env[n]));
  return { api, store, calls };
}
let e = makeEnv();
let h = e.api.termsNotice();
check('conta antiga (criada antes da vigência): vê a faixa com a versão 1.5, o que mudou, o link dos Termos (abre em outra aba) e o botão Entendi', /Atualizamos os <a href="\/termos\.html" target="_blank" rel="noopener"[^>]*>Termos de Uso<\/a> \(versão 1\.5\)/.test(h) && /desistir da compra de um plano em até 7 dias depois de pagar e receber o valor de volta/.test(h) && /onclick="dismissTermsNotice\(\)"[^>]*>Entendi</.test(h), h);
check('…o texto da novidade diz o que mudou de verdade (o direito de desistir em 7 dias)', /direito de desistir/.test(h) && /7 dias/.test(h));
check('versão e data de vigência do aviso são as dos Termos 1.5 (09/10/2026, horário de Brasília)', e.api.TERMS_VERSION === '1.5' && e.api.TERMS_EFFECTIVE_MS === Date.parse('2026-10-09T03:00:00Z') && e.api.TERMS_SEEN_KEY === 'aceoma_termos_visto');
e = makeEnv({ authUser: null });
check('sem login: nenhuma faixa', e.api.termsNotice() === '');
for (const [rotulo, creationTime, esperaFaixa] of [
  ['criada no dia seguinte à vigência', 'Sat, 10 Oct 2026 15:00:00 GMT', false],
  ['criada exatamente na hora da vigência (meia-noite de Brasília)', '2026-10-09T03:00:00.000Z', false],
  ['criada um segundo antes da vigência', '2026-10-09T02:59:59.000Z', true],
  ['criada meses antes', 'Wed, 01 Jan 2025 10:00:00 GMT', true],
]) {
  e = makeEnv({ authUser: { metadata: { creationTime } } });
  check(`conta ${rotulo}: ${esperaFaixa ? 'vê' : 'NÃO vê'} a faixa (conta nova já aceitou o texto novo ao se cadastrar)`, (e.api.termsNotice() !== '') === esperaFaixa, creationTime);
}
for (const [rotulo, authUser] of [['sem a data de criação (dado ausente)', { metadata: {} }], ['sem o objeto de metadados', {}], ['com data inválida', { metadata: { creationTime: 'não é data' } }]]) {
  e = makeEnv({ authUser });
  check(`conta ${rotulo}: tratada como antiga, ou seja, vê a faixa (na dúvida, avisa)`, e.api.termsNotice() !== '');
}
e = makeEnv({ stored: '1.5' });
check('quem já viu a versão 1.5 neste aparelho: não vê de novo', e.api.termsNotice() === '');
e = makeEnv({ stored: '1.4' });
check('quem viu só uma versão ANTERIOR (1.4): vê a faixa da 1.5', e.api.termsNotice() !== '');
e = makeEnv({ stored: 'lixo' });
check('valor guardado qualquer (que não é a versão atual): vê a faixa', e.api.termsNotice() !== '');
e = makeEnv();
e.api.dismissTermsNotice();
check('Entendi: guarda a versão vista (1.5) neste aparelho, redesenha a tela uma vez e a faixa some', e.store.aceoma_termos_visto === '1.5' && e.calls.renders === 1 && e.api.termsNotice() === '', { store: e.store, renders: e.calls.renders });
e = makeEnv({ storageThrows: true });
check('sem acesso ao armazenamento do navegador (modo privado): a faixa aparece, sem quebrar', e.api.termsNotice() !== '');
let boom = false; try { e.api.dismissTermsNotice(); } catch (_) { boom = true; }
check('…e o Entendi não quebra e a faixa some nesta abertura do app (guarda só na memória)', !boom && e.calls.renders === 1 && e.api.termsNotice() === '');
check('termsNoticeInfo: devolve null para quem viu ou tem conta nova, e a versão e a novidade para os demais', (() => { const i = e.api.termsNoticeInfo; return i({ createdMs: Date.parse('2026-01-01'), seen: '1.5' }) === null && i({ createdMs: Date.parse('2026-10-10'), seen: null }) === null && i({ createdMs: Date.parse('2026-01-01'), seen: null })?.version === '1.5' && i({ createdMs: NaN, seen: null })?.version === '1.5'; })());

// ── como está ligado no app ─────────────────────────────────────────────────────────────────────
check('a faixa aparece no topo da liga (antes de todas as outras) e na escolha de liga, e NÃO na tela de login (instalar/avisar no meio de um convite atrapalha)', /main\.innerHTML=termsNotice\(\)\+planBanner\(\)/.test(html) && html.slice(html.indexOf('function vSelectLeague()'), html.indexOf('function vPending()')).includes('${termsNotice()}') && !html.slice(html.indexOf('function vLogin()'), html.indexOf('function slugify(')).includes('termsNotice'));
check('PRIVACIDADE: o aviso não chama banco, funções nem rede (só guarda a versão vista no aparelho)', !/\bfetch\(|callFn|XMLHttpRequest|\bDB\.|ldoc\(|\bcol\(|firebase\.|sendBeacon|trackEvent|\.set\(|\.add\(/.test(code), code.match(/.{15}(fetch\(|callFn|DB\.|firebase\.|trackEvent).{15}/)?.[0]);

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
