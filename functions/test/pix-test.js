// PIX copia e cola (index.html): o gerador do código e a leitura da chave, conferidos contra o exemplo oficial do manual do
// Banco Central e contra códigos calculados por uma biblioteca pública independente (pix-utils; ver "códigos de ouro").
// Um erro aqui manda dinheiro para o lugar errado ou gera um código que o banco recusa, então o teste é bem detalhado.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marcador não encontrado no index.html: ' + from + ' … ' + to);
  return html.slice(a, b);
}
const code = slice('/* ── PIX copia e cola', '/* ── fim do PIX copia e cola');
const names = ['st', 'getPaid', 'esc', 'trackEvent', 'toast', 'render', 'document', 'navigator'];
const A = new Function(...names, code + '\nreturn { PIX_TIPOS, pixCrc16, pixField, pixText, pixCpfValid, pixCnpjValid, pixPhone, pixParseKey, pixAmount, pixBrCode, pixMaskKey };')();

let fails = 0;
const check = (label, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond ? '' : '\n     ' + JSON.stringify(extra)));
};

// leitor independente do formato (campo = número de 2 dígitos + tamanho de 2 dígitos + valor)
function tlv(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2), len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(s.slice(i + 2, i + 4)) || i + 4 + len > s.length) throw new Error('formato inválido em ' + i);
    out.push([id, s.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

// ── CRC e campos ────────────────────────────────────────────────────────────────────────────────
check('CRC-16/CCITT-FALSE: "123456789" = 29B1 (vetor de referência do algoritmo)', A.pixCrc16('123456789') === '29B1', A.pixCrc16('123456789'));
check('…texto vazio = FFFF (o valor inicial) e sempre 4 caracteres hexadecimais em maiúsculas', A.pixCrc16('') === 'FFFF' && /^[0-9A-F]{4}$/.test(A.pixCrc16('abc')));
check('campo: número + tamanho com 2 dígitos + valor', A.pixField('59', 'FUTQUARTA') === '5909FUTQUARTA' && A.pixField('58', 'BR') === '5802BR' && A.pixField('00', '') === '0000');
check('campo com mais de 99 caracteres NUNCA é gerado (seria um código inválido)', (() => { try { A.pixField('26', 'x'.repeat(100)); return false; } catch (e) { return true; } })() && A.pixField('26', 'x'.repeat(99)).startsWith('2699'));

// ── exemplo oficial do manual do Banco Central ──────────────────────────────────────────────────
const BCB = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
check('exemplo do manual do BC: o CRC calculado é o do manual (1D3D)', A.pixCrc16(BCB.slice(0, -4)) === '1D3D');
const meuBcb = A.pixBrCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Fulano de Tal', cidade: 'BRASILIA', valor: 0, info: '' });
check('…e o nosso gerador, com os mesmos dados, escreve o mesmo código (só o nome sai em MAIÚSCULAS, como recomendado)', meuBcb.slice(0, -4).replace('FULANO DE TAL', 'Fulano de Tal') === BCB.slice(0, -4) && meuBcb.endsWith(A.pixCrc16(meuBcb.slice(0, -4))), meuBcb);

// ── códigos de ouro: calculados pela biblioteca pública pix-utils (createStaticPix), com os mesmos dados ──
const OURO = [
  ['CPF, mensalidade', { chave: '52998224725', nome: 'FUTQUARTA', valor: 50, info: 'Mensalidade 10/2026 Rodrigo' }, '00020126640014br.gov.bcb.pix0111529982247250227Mensalidade 10/2026 Rodrigo520400005303986540550.005802BR5909FUTQUARTA6006BRASIL62070503***6304F2AC'],
  ['CPF, mensalidade + churrasco', { chave: '52998224725', nome: 'SERIE B ACEOMA', valor: 80, info: 'Mensalidade e Churrasco 10/2026 Marcelo Lima' }, '00020126810014br.gov.bcb.pix0111529982247250244Mensalidade e Churrasco 10/2026 Marcelo Lima520400005303986540580.005802BR5914SERIE B ACEOMA6006BRASIL62070503***6304E976'],
  ['CNPJ', { chave: '11222333000181', nome: 'PELADA DO BAIRRO', valor: 29.9, info: 'Mensalidade 11/2026 Zeca' }, '00020126640014br.gov.bcb.pix0114112223330001810224Mensalidade 11/2026 Zeca520400005303986540529.905802BR5916PELADA DO BAIRRO6006BRASIL62070503***6304F4A0'],
  ['CNPJ alfanumérico (letras)', { chave: '12ABC34501DE35', nome: 'LIGA DOS AMIGOS', valor: 120.5, info: 'Churrasco 12/2026 Beto' }, '00020126620014br.gov.bcb.pix011412ABC34501DE350222Churrasco 12/2026 Beto5204000053039865406120.505802BR5915LIGA DOS AMIGOS6006BRASIL62070503***6304C12F'],
  ['celular', { chave: '+5511912345678', nome: 'FUTQUARTA', valor: 45.75, info: 'Mensalidade 10/2026 Ana' }, '00020126630014br.gov.bcb.pix0114+55119123456780223Mensalidade 10/2026 Ana520400005303986540545.755802BR5909FUTQUARTA6006BRASIL62070503***63044195'],
  ['e-mail', { chave: 'tesouraria@futquarta.com.br', nome: 'FUTQUARTA', valor: 1234.5, info: 'Mensalidade 01/2027 Joao' }, '00020126770014br.gov.bcb.pix0127tesouraria@futquarta.com.br0224Mensalidade 01/2027 Joao52040000530398654071234.505802BR5909FUTQUARTA6006BRASIL62070503***6304EA1F'],
  ['chave aleatória, sem mensagem, R$ 0,01', { chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'FUTQUARTA', valor: 0.01, info: '' }, '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-42665544000052040000530398654040.015802BR5909FUTQUARTA6006BRASIL62070503***6304ECD8'],
  ['chave aleatória, com mensagem que cabe', { chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'LIGA', valor: 99.99, info: 'Mensalidade 10/2026 Pedro' }, '00020126870014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400000225Mensalidade 10/2026 Pedro520400005303986540599.995802BR5904LIGA6006BRASIL62070503***63045D3F'],
];
for (const [rot, d, esperado] of OURO) {
  const got = A.pixBrCode({ ...d, cidade: 'BRASIL' });
  check(`código de ouro (${rot}): idêntico ao calculado pela biblioteca de referência`, got === esperado, { got, esperado });
}

// ── estrutura de qualquer código gerado (casos aleatórios, sempre os mesmos) ────────────────────
let seed = 20261006;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ri = n => Math.floor(rnd() * n);
const chaves = ['52998224725', '11222333000181', '12ABC34501DE35', '+5565910340646', 'a@b.co', 'x'.repeat(62) + '@exemplo.com.br', '123e4567-e12b-12d1-a456-426655440000'];
const palavras = ['Mensalidade', 'Churrasco', 'e', '10/2026', 'Rodrigo', 'Albuquerque', 'Joao', 'da', 'Silva', 'Ze', 'do', 'Pao'];
let estruturaOk = 0, motivos = [];
for (let i = 0; i < 400; i++) {
  const chave = chaves[ri(chaves.length)];
  const info = Array.from({ length: ri(9) }, () => palavras[ri(palavras.length)]).join(' ');
  const valor = rnd() < 0.1 ? 0 : (1 + ri(500000)) / 100;
  const c = A.pixBrCode({ chave, nome: 'Liga ' + ri(1000) + ' dos Amigos do Bairro', cidade: 'Sao Paulo da Silva', valor, info });
  try {
    const t = tlv(c);
    const ids = t.map(x => x[0]).join(',');
    const esperadoIds = valor > 0 ? '00,26,52,53,54,58,59,60,62,63' : '00,26,52,53,58,59,60,62,63';
    const conta = tlv(t.find(x => x[0] === '26')[1]);
    const ok = ids === esperadoIds
      && t[0][1] === '01' && !t.some(x => x[0] === '01')
      && t.find(x => x[0] === '26')[1].length <= 99
      && conta[0][0] === '00' && conta[0][1] === 'br.gov.bcb.pix' && conta[1][0] === '01' && conta[1][1] === chave
      && (conta.length === 2 || (conta[2][0] === '02' && conta[2][1].length > 0))
      && t.find(x => x[0] === '52')[1] === '0000' && t.find(x => x[0] === '53')[1] === '986' && t.find(x => x[0] === '58')[1] === 'BR'
      && (valor > 0 ? /^\d{1,10}\.\d{2}$/.test(t.find(x => x[0] === '54')[1]) && Number(t.find(x => x[0] === '54')[1]) === Math.round(valor * 100) / 100 : true)
      && t.find(x => x[0] === '59')[1].length >= 1 && t.find(x => x[0] === '59')[1].length <= 25 && /^[A-Z0-9 ]+$/.test(t.find(x => x[0] === '59')[1])
      && t.find(x => x[0] === '60')[1].length >= 1 && t.find(x => x[0] === '60')[1].length <= 15
      && JSON.stringify(tlv(t.find(x => x[0] === '62')[1])) === JSON.stringify([['05', '***']])
      && t[t.length - 1][0] === '63' && t[t.length - 1][1].length === 4 && t[t.length - 1][1] === A.pixCrc16(c.slice(0, -4))
      && /^[\x20-\x7e]+$/.test(c);
    if (ok) estruturaOk++; else motivos.push({ c, ids });
  } catch (e) { motivos.push({ c, erro: e.message }); }
}
check('400 códigos aleatórios: campos na ordem certa, tamanhos de acordo, CRC conferido, só caracteres imprimíveis, campo 26 ≤ 99, nome ≤ 25 e cidade ≤ 15', estruturaOk === 400, motivos.slice(0, 2));

// ── valor ───────────────────────────────────────────────────────────────────────────────────────
const am = [[50, '50.00'], [29.9, '29.90'], [0.01, '0.01'], [1234.5, '1234.50'], [0.1 + 0.2, '0.30'], ['80', '80.00'], [99.999, '100.00'], [1.005, '1.01'], [12.345, '12.35'], [100000, '100000.00']];
check('valor com ponto e duas casas (50 → 50.00, 29,9 → 29.90, 0,1+0,2 → 0.30, "80" → 80.00, 99,999 → 100.00)', am.every(([v, e]) => A.pixAmount(v) === e), am.map(([v]) => [v, A.pixAmount(v)]));
check('valor zero, negativo, vazio, texto ou infinito: nenhum valor no código (o campo 54 some)', [0, -5, '', null, undefined, 'abc', NaN, Infinity, -Infinity, 0.004].every(v => A.pixAmount(v) === ''), [0, -5, '', null, undefined, 'abc', NaN, Infinity].map(v => A.pixAmount(v)));
check('valor gigante (acima do limite do campo) também é recusado, não vira lixo', A.pixAmount(1e12) === '' && A.pixAmount(999999999.99) === '999999999.99');
check('sem valor, o código não tem o campo 54; com valor, tem', !/5204000053039865[4]/.test(A.pixBrCode({ chave: 'a@b.co', nome: 'X', cidade: 'Y', valor: 0 })) && tlv(A.pixBrCode({ chave: 'a@b.co', nome: 'X', cidade: 'Y', valor: 5 })).some(x => x[0] === '54'));

// ── textos livres (nome, cidade, mensagem) ──────────────────────────────────────────────────────
const nomeDe = c => tlv(c).find(x => x[0] === '59')[1], cidadeDe = c => tlv(c).find(x => x[0] === '60')[1];
const gen = (o) => A.pixBrCode({ chave: '52998224725', nome: 'X', cidade: 'Y', valor: 10, info: '', ...o });
check('nome: sem acento, em maiúsculas ("Série B Aceoma" → SERIE B ACEOMA; "João Açaí" → JOAO ACAI)', nomeDe(gen({ nome: 'Série B Aceoma' })) === 'SERIE B ACEOMA' && nomeDe(gen({ nome: 'João Açaí' })) === 'JOAO ACAI');
check('nome: emoji, símbolos e espaços repetidos viram um espaço só ("⚽ Fut & Cia!!  Quarta" → FUT CIA QUARTA)', nomeDe(gen({ nome: '⚽ Fut & Cia!!  Quarta' })) === 'FUT CIA QUARTA', nomeDe(gen({ nome: '⚽ Fut & Cia!!  Quarta' })));
check('nome: no máximo 25 caracteres, sem espaço sobrando no fim (o corte cai logo depois de um espaço)', nomeDe(gen({ nome: 'A'.repeat(40) })).length === 25 && nomeDe(gen({ nome: 'ABCDEFGHIJKLMNOPQRSTUVWX YZZZ' })) === 'ABCDEFGHIJKLMNOPQRSTUVWX', nomeDe(gen({ nome: 'ABCDEFGHIJKLMNOPQRSTUVWX YZZZ' })));
check('texto livre com limite zero ou negativo: vazio (cortar com limite negativo devolveria o começo do texto, e não nada)', A.pixText('abcdef', 0) === '' && A.pixText('abcdef', -2) === '' && A.pixText('abcdef', NaN) === '' && A.pixText('abcdef', 3) === 'abc');
check('nome: vazio, só emoji ou só símbolos → "PELADA NA MAO" (o campo é obrigatório no formato)', ['', '   ', '⚽🏆', '!!!', null, undefined].every(n => nomeDe(gen({ nome: n })) === 'PELADA NA MAO'));
check('cidade: em maiúsculas, ≤ 15 caracteres; vazia → BRASIL', cidadeDe(gen({ cidade: 'São José dos Campos do Sul' })) === 'SAO JOSE DOS CAM' .slice(0, 15).trim() && cidadeDe(gen({ cidade: '' })) === 'BRASIL' && cidadeDe(gen({ cidade: 'Rio' })) === 'RIO', cidadeDe(gen({ cidade: 'São José dos Campos do Sul' })));
const infoDe = c => { const x = tlv(tlv(c).find(y => y[0] === '26')[1]).find(y => y[0] === '02'); return x ? x[1] : null; };
check('mensagem: mantém maiúsculas e minúsculas, tira acento e emoji ("Mensalidade 10/2026 Zé 😀" → "Mensalidade 10/2026 Ze")', infoDe(gen({ info: 'Mensalidade 10/2026 Zé 😀' })) === 'Mensalidade 10/2026 Ze', infoDe(gen({ info: 'Mensalidade 10/2026 Zé 😀' })));
check('mensagem vazia ou só de símbolos: o campo 02 não existe (nada de campo vazio)', infoDe(gen({ info: '' })) === null && infoDe(gen({ info: '😀😀' })) === null && infoDe(gen({ info: undefined })) === null);
// espaço para a mensagem no campo 26 (máx. 99): 18 do GUI + 4 + chave + 4 do cabeçalho do campo 02
const sobra = chave => 99 - (18 + 4 + chave.length) - 4;
check('mensagem: usa só o espaço que sobra no campo 26 (CPF: 62 caracteres; chave aleatória: 37), nunca mais', infoDe(gen({ chave: '52998224725', info: 'a'.repeat(100) })).length === sobra('52998224725') && sobra('52998224725') === 62 && infoDe(gen({ chave: '123e4567-e12b-12d1-a456-426655440000', info: 'a'.repeat(100) })).length === 37);
const emailMax = 'x'.repeat(77 - '@ab.co'.length) + '@ab.co';
check('e-mail de 77 caracteres (o máximo): campo 26 com exatamente 99 e sem mensagem, em vez de estourar', emailMax.length === 77 && tlv(gen({ chave: emailMax, info: 'Mensalidade' })).find(x => x[0] === '26')[1].length === 99 && infoDe(gen({ chave: emailMax, info: 'Mensalidade' })) === null);
check('e-mail de 74 caracteres: a mensagem entra cortada no que sobra (campo 26 fecha em 99 ou menos)', (() => { const e = 'x'.repeat(74 - '@ab.co'.length) + '@ab.co'; const c = gen({ chave: e, info: 'Mensalidade 10/2026' }); return tlv(c).find(x => x[0] === '26')[1].length <= 99; })());
check('chave vazia ou com mais de 77 caracteres: recusa em vez de gerar código', [() => gen({ chave: '' }), () => gen({ chave: undefined }), () => gen({ chave: 'x'.repeat(78) })].every(f => { try { f(); return false; } catch (e) { return true; } }));
check('a mesma entrada sempre gera o mesmo código', gen({ info: 'Teste' }) === gen({ info: 'Teste' }));

// ── CPF e CNPJ ──────────────────────────────────────────────────────────────────────────────────
check('CPF: válidos (529.982.247-25 e 123.456.789-09) e inválidos (dígito errado, todos iguais, tamanho errado, letras)', A.pixCpfValid('52998224725') && A.pixCpfValid('12345678909') && !A.pixCpfValid('52998224724') && !A.pixCpfValid('11111111111') && !A.pixCpfValid('00000000000') && !A.pixCpfValid('5299822472') && !A.pixCpfValid('529982247255') && !A.pixCpfValid('5299822472A'));
check('CNPJ numérico: válidos (11.222.333/0001-81 e 11.444.777/0001-61) e inválidos (dígito errado, todos iguais, tamanho errado)', A.pixCnpjValid('11222333000181') && A.pixCnpjValid('11444777000161') && !A.pixCnpjValid('11222333000182') && !A.pixCnpjValid('00000000000000') && !A.pixCnpjValid('1122233300018') && !A.pixCnpjValid('112223330001811'));
check('CNPJ alfanumérico (novo, com letras): o exemplo oficial da Receita 12.ABC.345/01DE-35 vale; com dígito trocado, não; letra minúscula não vale (a leitura da chave põe em maiúsculas antes)', A.pixCnpjValid('12ABC34501DE35') && !A.pixCnpjValid('12ABC34501DE36') && !A.pixCnpjValid('12abc34501de35'));
// referência independente, escrita do jeito clássico (só números, pesos em listas), para conferir os dois validadores
function cpfClassico(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base, peso0) => { const r = (base.split('').reduce((s, d, i) => s + Number(d) * (peso0 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(c.slice(0, 9), 10), d2 = dv(c.slice(0, 9) + d1, 11);
  return c.endsWith(`${d1}${d2}`);
}
function cnpjClassico(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base, pesos) => { const r = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), d2 = dv(c.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return c.endsWith(`${d1}${d2}`);
}
{
  let diverge = [], validosCpf = 0, validosCnpj = 0, cnpjDvZero = 0;
  for (let i = 0; i < 6000; i++) {
    const nums = n => Array.from({ length: n }, () => ri(10)).join('');
    const c = nums(11), n = nums(14);
    if (A.pixCpfValid(c) !== cpfClassico(c)) diverge.push(['cpf', c]);
    if (A.pixCnpjValid(n) !== cnpjClassico(n)) diverge.push(['cnpj', n]);
    // válidos de verdade (base aleatória + dígitos calculados pelo método clássico)
    const b9 = nums(9), d = (base, peso0) => { const r = (base.split('').reduce((s, x, k) => s + Number(x) * (peso0 - k), 0) * 10) % 11; return r === 10 ? 0 : r; };
    const v1 = d(b9, 10), v2 = d(b9 + v1, 11), cv = b9 + v1 + v2;
    if (!A.pixCpfValid(cv) && !/^(\d)\1{10}$/.test(cv)) diverge.push(['cpf válido recusado', cv]); else validosCpf++;
    const b12 = nums(12), dc = (base, pesos) => { const r = base.split('').reduce((s, x, k) => s + Number(x) * pesos[k], 0) % 11; return r < 2 ? 0 : 11 - r; };
    const w1 = dc(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), w2 = dc(b12 + w1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), nv = b12 + w1 + w2;
    if (!A.pixCnpjValid(nv) && !/^(\d)\1{13}$/.test(nv)) diverge.push(['cnpj válido recusado', nv]); else { validosCnpj++; if (w1 === 0 || w2 === 0) cnpjDvZero++; }
    const errado = nv.slice(0, 13) + String((Number(nv[13]) + 1 + ri(8)) % 10);
    if (errado !== nv && A.pixCnpjValid(errado)) diverge.push(['cnpj com dígito trocado aceito', errado]);
  }
  check('CPF e CNPJ: 6000 sorteios concordam com a conta clássica (válidos aceitos, dígito trocado recusado), incluindo os casos de dígito verificador 0', diverge.length === 0 && validosCpf > 5000 && validosCnpj > 5000 && cnpjDvZero > 500, { diverge: diverge.slice(0, 3), validosCpf, validosCnpj, cnpjDvZero });
}
check('CNPJs reais conhecidos (Banco do Brasil 00.000.000/0001-91, Caixa 00.360.305/0001-04, Petrobras 33.000.167/0001-01) são aceitos', ['00000000000191', '00360305000104', '33000167000101'].every(c => A.pixCnpjValid(c) && cnpjClassico(c)));
check('celular: aceita (11) 91234-5678, 11912345678, +55 11 91234-5678 e 5511912345678, tudo como +5511912345678', ['(11) 91234-5678', '11912345678', '+55 11 91234-5678', '5511912345678', '+5511912345678', '11 9 1234 5678'].every(p => A.pixPhone(p) === '+5511912345678'), ['(11) 91234-5678', '11912345678', '+55 11 91234-5678', '5511912345678'].map(A.pixPhone));
check('celular: recusa fixo (sem o 9), DDD 0X, número curto/longo, letras', ['1133334444', '(11) 3333-4444', '0191234567', '01912345678', '1191234567', '119123456789', '11a12345678', ''].every(p => A.pixPhone(p) === ''));
check('celular com DDD 55 (RS) e prefixo 55 convivem: 55912345678 e +5555912345678', A.pixPhone('55912345678') === '+5555912345678' && A.pixPhone('+5555912345678') === '+5555912345678' && A.pixPhone('5555912345678') === '+5555912345678');

// ── leitura da chave ────────────────────────────────────────────────────────────────────────────
const P = (raw, tipo) => A.pixParseKey(raw, tipo);
const tabela = [
  ['529.982.247-25', 'cpf', '52998224725'], ['  529.982.247-25  ', 'cpf', '52998224725'],
  ['(11) 91234-5678', 'celular', '+5511912345678'], ['+55 (11) 91234-5678', 'celular', '+5511912345678'], ['5511912345678', 'celular', '+5511912345678'], ['11912345678', 'celular', '+5511912345678'],
  ['+5511912345678', 'celular', '+5511912345678'], ['+55 11 91234-5678', 'celular', '+5511912345678'], ['+55.11.91234.5678', 'celular', '+5511912345678'],
  ['Jogador@Exemplo.COM', 'email', 'jogador@exemplo.com'], ['  tesouraria@futquarta.com.br ', 'email', 'tesouraria@futquarta.com.br'],
  ['123E4567-E12B-12D1-A456-426655440000', 'aleatoria', '123e4567-e12b-12d1-a456-426655440000'],
  ['11.222.333/0001-81', 'cnpj', '11222333000181'], ['11222333000181', 'cnpj', '11222333000181'],
  ['12.ABC.345/01DE-35', 'cnpj', '12ABC34501DE35'], ['12abc34501de35', 'cnpj', '12ABC34501DE35'],
];
for (const [raw, tipo, chave] of tabela) {
  const r = P(raw);
  check(`chave "${raw.trim()}" → ${tipo} (${chave})`, r.ok === true && r.tipo === tipo && r.chave === chave, r);
}
check('chave vazia: motivo "vazio"; só espaços e valores que não são texto também', ['', '   ', null, undefined].every(v => P(v).ok === false && P(v).motivo === 'vazio'));
check('número no lugar do texto (algum dado antigo salvo como número) é lido como texto', P(12345678909).ok === true && P(12345678909).tipo === 'cpf', P(12345678909));
check('chaves inválidas: CPF com dígito errado, e-mail sem domínio, UUID curto, número curto, texto livre', ['529.982.247-24', 'joao@', 'joao@exemplo', '123e4567-e12b-12d1-a456', '1234', 'minha chave é 11999998888', 'pix', '11 3333-4444', '00000000000000'].every(v => { const r = P(v); return r.ok === false && r.motivo === 'invalida'; }), ['529.982.247-24', 'joao@', 'minha chave é 11999998888'].map(v => P(v)));
check('e-mail de mais de 77 caracteres é recusado (limite do Pix)', P('x'.repeat(80) + '@a.co').ok === false && P('x'.repeat(71) + '@a.co').ok === true);
// ambíguo: 11 números que valem como CPF E como celular
let amb = null;
for (let n = 10000000000, k = 0; n < 99999999999 && !amb; n += 7919, k++) { const d = String(n); if (A.pixCpfValid(d) && A.pixPhone(d)) amb = d; }
check('11 números que valem como CPF e como celular: NÃO adivinha, pede a escolha (CPF ou celular)', amb !== null && JSON.stringify(P(amb)) === JSON.stringify({ ok: false, ambigua: true, opcoes: ['cpf', 'celular'] }), { amb, r: amb && P(amb) });
check('…e com a escolha feita, vira a chave certa de cada tipo (o mesmo número vira dois códigos diferentes)', P(amb, 'cpf').ok && P(amb, 'cpf').chave === amb && P(amb, 'celular').ok && P(amb, 'celular').chave === '+55' + amb && P(amb, 'cpf').chave !== P(amb, 'celular').chave);
check('…com a pontuação de CPF (000.000.000-00) ou de celular ((11) …), o formato já resolve sem perguntar', P(amb.slice(0, 3) + '.' + amb.slice(3, 6) + '.' + amb.slice(6, 9) + '-' + amb.slice(9)).tipo === 'cpf' && P('(' + amb.slice(0, 2) + ') ' + amb.slice(2, 7) + '-' + amb.slice(7)).tipo === 'celular');
check('11 números que só valem como CPF ou só como celular: o app decide sozinho', P('12345678909').tipo === 'cpf' && P('11912345678').tipo === 'celular', [P('12345678909'), P('11912345678')]);
check('o CPF de exemplo 529.982.247-25, digitado só com números, vale também como celular (DDD 52): o app pergunta em vez de adivinhar; com a pontuação do CPF já sabe', JSON.stringify(P('52998224725')) === JSON.stringify({ ok: false, ambigua: true, opcoes: ['cpf', 'celular'] }) && P('529.982.247-25').tipo === 'cpf', P('52998224725'));
check('escolha explícita que não combina com a chave é recusada (e-mail como CPF, CPF como e-mail, celular como CNPJ)', P('a@b.co', 'cpf').ok === false && P('52998224725', 'email').ok === false && P('11912345678', 'cnpj').ok === false && P('52998224725', 'aleatoria').ok === false);
check('escolha explícita aceita só os cinco tipos; texto estranho vindo do banco (__proto__, constructor…) não quebra nem libera nada', ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'x', 'CPF'].every(t => P('52998224725', t).ok === false) && ['cpf', 'cnpj', 'celular', 'email', 'aleatoria'].every(t => A.PIX_TIPOS[t]));
check('a leitura é a mesma para a mesma entrada e nunca devolve chave com espaço, pontuação ou maiúscula fora do padrão', tabela.every(([raw]) => { const r = P(raw); return !/[\s.\-\/()]/.test(r.tipo === 'aleatoria' ? r.chave.replace(/-/g, '') : r.chave.replace(/^\+/, '').replace(/@.*/, '')) && (r.tipo !== 'email' && r.tipo !== 'aleatoria' || r.chave === r.chave.toLowerCase()); }));

// ── chave escondida na tela ─────────────────────────────────────────────────────────────────────
check('chave com parte escondida: CPF ***.456.789-**, CNPJ **.***.333/0001-**, celular (11) *****-5678, e-mail j***@exemplo.com, aleatória só o começo',
  A.pixMaskKey('52998224725', 'cpf') === '***.982.247-**' && A.pixMaskKey('11222333000181', 'cnpj') === '**.***.333/0001-**' && A.pixMaskKey('+5511912345678', 'celular') === '(11) *****-5678' && A.pixMaskKey('jogador@exemplo.com', 'email') === 'j***@exemplo.com' && A.pixMaskKey('123e4567-e12b-12d1-a456-426655440000', 'aleatoria') === '123e4567…',
  ['cpf', 'cnpj', 'celular', 'email', 'aleatoria'].map((t, i) => A.pixMaskKey(['52998224725', '11222333000181', '+5511912345678', 'jogador@exemplo.com', '123e4567-e12b-12d1-a456-426655440000'][i], t)));
check('…e a chave inteira nunca aparece no texto escondido', !A.pixMaskKey('52998224725', 'cpf').includes('52998224725') && !A.pixMaskKey('+5511912345678', 'celular').includes('912345678') && !A.pixMaskKey('jogador@exemplo.com', 'email').includes('jogador'));

console.log(`\n${fails === 0 ? 'Todos os testes passaram' : fails + ' FALHA(S)'}`);
if (fails) process.exitCode = 1;
