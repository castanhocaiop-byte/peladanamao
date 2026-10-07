"use strict";
// Monitoramento de travamentos do navegador.
//
// O app (index.html, bloco "Monitor de travamentos" no <head>) manda um relato curto quando algo quebra: a mensagem do
// erro, o trecho do código, a versão do app, a tela e o navegador. NUNCA vai nome, e-mail, WhatsApp, liga, conta,
// endereço IP nem o que a pessoa digitou. O servidor não confia no app: valida de novo, limpa o texto de novo, agrupa
// relatos parecidos e só soma contadores.
//
// Este arquivo só tem regras e contas (sem banco, sem rede, sem relógio escondido) para poder ser testado a fundo;
// o index.js grava no Firestore, envia o resumo por e-mail e expõe a função HTTP.
const crypto = require("crypto");
const { dayKeySP, lastDayKeys } = require("./funnel-metrics");

const DAY = 86400000;
const KINDS = ["error", "rejection", "resource", "boot", "listener", "auth", "callable", "network"];
const KIND_LABEL = {
  error: "Erro no código",
  rejection: "Falha não tratada",
  resource: "Arquivo não carregou",
  boot: "App travado na abertura",
  listener: "Dados não carregaram",
  auth: "Falha ao entrar",
  callable: "Falha no servidor",
  network: "Rede",
};
const LIMIT = { message: 300, stack: 1200, stackLines: 8, line: 180, name: 60 };

// Quanto o servidor aceita (uma rajada ou um ataque nunca vira conta alta nem banco cheio)
const MAX_BODY_BYTES = 6144;
const MAX_REPORTS_PER_DAY = 3000;    // relatos de grupos que já existem; passou disso, só entram grupos NOVOS
const MAX_NEW_GROUPS_PER_DAY = 150;
const IP_MAX_PER_MINUTE = 10;
const KEEP_GROUP_DAYS = 45;          // grupo sem relato novo há mais que isso é apagado
const KEEP_META_DAYS = 60;

const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge", "Opera", "Samsung", "Instagram", "Facebook", "TikTok", "WhatsApp", "WebView", "Outro"];
const OSES = ["Android", "iOS", "Windows", "macOS", "Linux", "ChromeOS", "Outro"];

// Endereços do próprio site: numa pilha de erro viram "(página)" ou só o caminho
const SITE_HOSTS = new Set(["peladanamao.com.br", "www.peladanamao.com.br", "seriebaceoma-staging.web.app", "seriebaceoma-staging.firebaseapp.com", "localhost", "127.0.0.1"]);

// ── limpeza do texto: o que pode identificar alguém sai ANTES de guardar ──────────────────────────────────────────
const LS_PS = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
const CONTROL = new RegExp("[\\x00-\\x1f\\x7f-\\x9f" + LS_PS + "]+", "g");
const DATA_URI = /\bdata:[^\s)'"<>]{12,}/gi;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"<>\]]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const DOC_PATH = /\bdocuments\/[^\s)'"]+/gi;        // caminho de documento do Firestore (nome da liga, ids)
const PATH_IDS = /\b(leagues|users)\/[^/\s)'"]+/gi; // idem, quando vem sem o "documents/" na frente
const PROP_V8 = /\b(reading|setting) '([^']*)'/g;           // Chrome: "Cannot read properties of undefined (reading 'João')"
const PROP_FF = /\b(access|assign to|delete) property "([^"]*)"/g; // Firefox: 'can't access property "João", x is undefined'
const KEEP_KEY = /^(?:[a-z_$][A-Za-z0-9_$]{0,39}|\d{1,3})$/;       // só fica o que parece nome de código (campo em minúscula, ou índice curto): nome de gente sai
const QUOTED = [/'([^']{25,})'/g, /"([^"]{25,})"/g, /`([^`]{25,})`/g];
const ID_LIKE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g;
const NUMBER_LIKE = /\+?\d[\d\s().-]{7,}\d/g;

// Endereço sem o que vem depois de "?" ou "#" (convites, códigos de login e e-mail ficam aí) e sem usuário/senha.
function cleanUrl(raw) {
  const tail = (/(?::\d+){1,2}$/.exec(raw) || [""])[0];
  const base = (tail ? raw.slice(0, -tail.length) : raw).replace(/[?#].*$/, "");
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(base);
  if (!m) return "<url>" + tail;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(/^.*@/, "");
  const path = m[3] || "/";
  if (scheme !== "http" && scheme !== "https") return scheme + "://…" + tail;
  if (SITE_HOSTS.has(host.replace(/:\d+$/, ""))) return (path === "/" || path === "/index.html" ? "(página)" : path.slice(0, 80)) + tail;
  return host + path.slice(0, 100) + tail;
}

function sanitizeText(input, max = LIMIT.message) {
  let s = typeof input === "string" ? input : input == null ? "" : String(input);
  s = s.slice(0, max * 8); // nunca processa texto gigante
  s = s.replace(CONTROL, " ").replace(DATA_URI, "<data>").replace(URL_RE, cleanUrl).replace(EMAIL, "<email>").replace(DOC_PATH, "documents/<caminho>").replace(PATH_IDS, "$1/<id>");
  s = s.replace(PROP_V8, (m, verb, key) => `${verb} '${KEEP_KEY.test(key) ? key : "<prop>"}'`).replace(PROP_FF, (m, verb, key) => `${verb} property "${KEEP_KEY.test(key) ? key : "<prop>"}"`);
  for (const re of QUOTED) s = s.replace(re, m => m[0] + "<texto>" + m[0]);
  s = s.replace(ID_LIKE, "<id>").replace(NUMBER_LIKE, "<n>").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function sanitizeStack(raw) {
  if (typeof raw !== "string") return "";
  const lines = [];
  for (const l of raw.slice(0, 20000).split(/\r?\n/)) {
    if (/extension:\/\//i.test(l)) continue;
    const c = sanitizeText(l, LIMIT.line);
    if (c) lines.push(c);
    if (lines.length >= LIMIT.stackLines) break;
  }
  const out = lines.join("\n");
  return out.length > LIMIT.stack ? out.slice(0, LIMIT.stack - 1) + "…" : out;
}

// Primeira linha da pilha que é um trecho de código: { fn, loc } (loc = arquivo:linha). Chrome/Edge: "at fn (loc)";
// Firefox/Safari: "fn@loc".
function topFrame(stack) {
  const frame = (fn, loc) => ({
    fn: String(fn || "").replace(/^async\s+/, "").replace(/[^A-Za-z0-9_$.<> -]/g, "").trim().slice(0, LIMIT.name).replace(/^(?:anonymous|<anonymous>)$/, ""),
    loc: String(loc || "").replace(/:(\d+):\d+$/, ":$1").slice(0, 120),
  });
  for (const line of String(stack || "").split("\n")) {
    const t = line.trim();
    let m = /^at\s+(?:(.+?)\s+\()?(.+?)\)?$/.exec(t);
    if (m && /:\d+(?::\d+)?$/.test(m[2])) return frame(m[1], m[2]);
    m = /^(.*?)@(.+)$/.exec(t);
    if (m && /:\d+(?::\d+)?$/.test(m[2])) return frame(m[1], m[2]);
  }
  return { fn: "", loc: "" };
}

// ── validação do relato ─────────────────────────────────────────────────────────────────────────────────────────
const NOISE = [
  /ResizeObserver loop/i,                                   // aviso inofensivo do navegador
  /^script error\.?$/i,                                     // erro de outro endereço, sem detalhe nenhum (extensões, anúncios)
  /popup-closed-by-user|cancelled-popup-request|user-cancelled/i, // a pessoa fechou a janela de login
  /\bAbortError\b|The (?:user|operation) (?:aborted|was aborted)/i, // a pessoa cancelou (ex.: janela de compartilhar)
];
const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|network-request-failed|err_internet_disconnected|err_network|network connection was lost|fetch failed/i;
const NETWORK_CODES = new Set(["unavailable", "auth/network-request-failed"]);

// Erro que veio de extensão do navegador (nos primeiros trechos da pilha) não é do app
function fromExtension(rawStack) {
  const top = String(rawStack || "").split("\n").map(l => l.trim()).filter(Boolean).slice(0, 3);
  return top.some(l => /extension:\/\//i.test(l));
}

const cleanVersion = v => (typeof v === "string" && /^\d{8}\.\d{4}$/.test(v) ? v : "x");
const cleanView = w => (typeof w === "string" && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(w) ? w : "");
function nameAndMajor(raw, names, maxDigits) {
  const m = new RegExp("^([A-Za-z]{2,12})(?: (\\d{1," + maxDigits + "}))?$").exec(typeof raw === "string" ? raw : "");
  if (!m) return "Outro";
  return (names.includes(m[1]) ? m[1] : "Outro") + (m[2] ? " " + m[2] : "");
}
function cleanExtra(x) {
  const o = x && typeof x === "object" && !Array.isArray(x) ? x : {};
  const pick = (v, re) => (typeof v === "string" && re.test(v) ? v : "");
  return {
    code: pick(o.code, /^[A-Za-z0-9/_-]{1,40}$/),   // código do Firebase (permission-denied, auth/…)
    fn: pick(o.fn, /^[A-Za-z][A-Za-z0-9_]{0,39}$/),  // nome da função do servidor
    col: pick(o.col, /^[a-z][a-z0-9_]{0,39}$/),      // nome da coleção do Firestore
    step: pick(o.step, /^[a-z][a-z0-9-]{0,23}$/),    // até onde a abertura do app chegou
  };
}

// Parte do texto que muda de um relato para outro do MESMO erro (números, ids, <n>) sai da chave do grupo
const keyText = s => String(s).toLowerCase().replace(/<[a-z]+>/g, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
const fileOf = loc => String(loc || "").replace(/:\d+$/, "");

function fingerprintOf(r) {
  const where = r.kind === "error" || r.kind === "rejection" ? r.fn || fileOf(r.loc) : "";
  const key = [r.kind, keyText(r.message), r.x.code, r.x.fn, r.x.col, r.x.step, where].join("|");
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 20);
}

// raw = o que o navegador mandou. Devolve { ok: true, report } | { ok: false, reason: "invalid" | "ignored" }.
function parseReport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid" };
  if (typeof raw.k !== "string" || !KINDS.includes(raw.k)) return { ok: false, reason: "invalid" };
  const rawMsg = typeof raw.m === "string" ? raw.m : "";
  const message = sanitizeText(rawMsg, LIMIT.message);
  if (!message) return { ok: false, reason: "invalid" };
  const rawStack = typeof raw.s === "string" ? raw.s : "";
  if (NOISE.some(re => re.test(message)) || fromExtension(rawStack) || /extension:\/\//i.test(rawMsg)) return { ok: false, reason: "ignored" };
  const stack = sanitizeStack(rawStack);
  const top = topFrame(stack);
  const x = cleanExtra(raw.x);
  let kind = raw.k;
  if ((kind === "error" || kind === "rejection") && (NETWORK_MESSAGE.test(message) || NETWORK_CODES.has(x.code))) kind = "network";
  const report = {
    kind, message, stack, fn: top.fn, loc: top.loc,
    version: cleanVersion(raw.v), view: cleanView(raw.w),
    browser: nameAndMajor(raw.b, BROWSERS, 3), os: nameAndMajor(raw.o, OSES, 2),
    standalone: raw.a === true || raw.a === 1, inapp: raw.i === true || raw.i === 1,
    x,
  };
  report.fp = fingerprintOf(report);
  return { ok: true, report };
}

// ── o que se grava ──────────────────────────────────────────────────────────────────────────────────────────────
// Chaves de mapa do Firestore: só letras, números, espaço, "_" e "-" (nada de "." nem "/").
const mapKey = k => String(k).replace(/[^A-Za-z0-9 _-]/g, "_").slice(0, 40) || "_";
const dayField = dayKey => "d" + dayKey.replace(/-/g, "");
const versionField = v => "v" + String(v).replace(".", "_");
const versionOf = field => String(field).slice(1).replace("_", ".");

// Documento do grupo (client_errors/{fp}) para gravar com set(..., { merge: true }): os contadores usam `increment`
// (somam sem ler antes, então relatos simultâneos não se perdem). firstSeen só entra quando o grupo é novo.
function groupWrite(report, { now, exists, increment }) {
  const iso = new Date(now).toISOString();
  const doc = {
    kind: report.kind, message: report.message, stack: report.stack, fn: report.fn, loc: report.loc,
    extra: { fn: report.x.fn, col: report.x.col, step: report.x.step },
    lastSeen: iso, lastVersion: report.version,
    count: increment(1),
    days: { [dayField(dayKeySP(now))]: increment(1) },
    versions: { [versionField(report.version)]: increment(1) },
    browsers: { [mapKey(report.browser)]: increment(1) },
    oses: { [mapKey(report.os)]: increment(1) },
  };
  if (report.view) doc.views = { [mapKey(report.view)]: increment(1) };
  if (report.x.code) doc.codes = { [mapKey(report.x.code)]: increment(1) };
  if (report.standalone) doc.standalone = increment(1);
  if (report.inapp) doc.inapp = increment(1);
  if (!exists) { doc.firstSeen = iso; doc.firstVersion = report.version; }
  return doc;
}

// Limite de relatos por endereço (só na memória da instância: o endereço nunca é gravado nem registrado)
function makeLimiter({ max = IP_MAX_PER_MINUTE, windowMs = 60000, maxKeys = 5000 } = {}) {
  const hits = new Map();
  return {
    allow(key, now) {
      const cur = hits.get(key);
      if (cur && now - cur.start < windowMs) {
        if (cur.n >= max) return false;
        cur.n++;
        return true;
      }
      // endereço novo (ou janela vencida): garante lugar. Só aqui, para quem ainda está dentro da janela nunca apagar nada.
      if (!cur && hits.size >= maxKeys) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.clear();
      }
      hits.set(key, { start: now, n: 1 });
      return true;
    },
    size: () => hits.size,
  };
}

function clientIp(req) {
  const xff = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return (xff || req.ip || req.socket?.remoteAddress || "?").slice(0, 64);
}

// Corpo do pedido: objeto já lido pelo servidor, texto (text/plain do sendBeacon) ou bytes. null = ilegível.
function bodyOf(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  const text = typeof b === "string" ? b : Buffer.isBuffer(b) ? b.toString("utf8") : req.rawBody ? Buffer.from(req.rawBody).toString("utf8") : "";
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

// ── leitura (painel do dono e resumo por e-mail) ────────────────────────────────────────────────────────────────
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sumDays = (days, keys) => keys.reduce((n, k) => n + num(days?.[dayField(k)]), 0);
function topOf(map, n, rename) {
  return Object.entries(map || {})
    .filter(([, v]) => num(v) > 0)
    .sort((a, b) => num(b[1]) - num(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k, v]) => ({ name: rename ? rename(k) : k, count: num(v) }));
}

// groups = [{ id, ...documento }]; meta = { 'AAAA-MM-DD': { total, newGroups, dropped } }. Só números e textos já limpos.
function summarize(groups, meta, now, max = 25) {
  const keys = lastDayKeys(14, now);          // do mais novo para o mais antigo
  const week = keys.slice(0, 7);
  const rows = [];
  for (const g of groups) {
    const last14 = sumDays(g.days, keys);
    if (!last14) continue;
    const firstSeen = typeof g.firstSeen === "string" ? g.firstSeen : "";
    rows.push({
      fp: String(g.id || g.fp || ""), kind: KINDS.includes(g.kind) ? g.kind : "error", message: String(g.message || ""), fn: String(g.fn || ""), loc: String(g.loc || ""),
      stack: String(g.stack || "").slice(0, 700),
      count: num(g.count), last7: sumDays(g.days, week), today: sumDays(g.days, keys.slice(0, 1)), yesterday: sumDays(g.days, keys.slice(1, 2)),
      spark: keys.slice().reverse().map(k => sumDays(g.days, [k])),
      firstSeen, lastSeen: typeof g.lastSeen === "string" ? g.lastSeen : "",
      isNew: !!firstSeen && Date.parse(firstSeen) >= now - 2 * DAY,
      versions: topOf(g.versions, 3, versionOf), browsers: topOf(g.browsers, 3), oses: topOf(g.oses, 3), views: topOf(g.views, 3), codes: topOf(g.codes, 3),
      extra: { fn: String(g.extra?.fn || ""), col: String(g.extra?.col || ""), step: String(g.extra?.step || "") },
      standalone: num(g.standalone), inapp: num(g.inapp),
    });
  }
  rows.sort((a, b) => b.last7 - a.last7 || String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const real = rows.filter(r => r.kind !== "network");
  const days = keys.slice().reverse().map(k => ({ day: k, total: num(meta?.[k]?.total), dropped: num(meta?.[k]?.dropped) }));
  return {
    totals: {
      reports7d: rows.reduce((n, r) => n + r.last7, 0),
      crashes7d: real.reduce((n, r) => n + r.last7, 0),
      today: rows.reduce((n, r) => n + r.today, 0),
      groups7d: rows.filter(r => r.last7 > 0).length,
      newGroups48h: real.filter(r => r.isNew).length,
    },
    days,
    groups: rows.slice(0, max),
    omitted: Math.max(0, rows.length - max),
  };
}

// Quais grupos merecem um aviso por e-mail: grupo NOVO (primeiro relato nas últimas 36 h) ou alta repentina (ontem+hoje
// com 5 ou mais relatos e pelo menos 3 vezes a média diária dos 7 dias antes). Rede fica de fora (é conexão ruim, não defeito).
function digestPicks(groups, now) {
  const [today, yesterday, ...before] = lastDayKeys(9, now);
  const picks = [];
  for (const g of groups) {
    if (g.kind === "network") continue;
    const recent = sumDays(g.days, [today, yesterday]);
    if (!recent) continue;
    const isNew = Date.parse(g.firstSeen) >= now - 36 * 3600000;
    const base = sumDays(g.days, before) / 7;
    const spike = recent >= 5 && recent >= 3 * Math.max(1, base);
    if (isNew || spike) picks.push({ g, recent, isNew, spike });
  }
  picks.sort((a, b) => b.recent - a.recent || String(b.g.lastSeen).localeCompare(String(a.g.lastSeen)));
  return picks;
}

const fmtTops = (map, rename) => topOf(map, 3, rename).map(t => `${t.name} (${t.count})`).join(", ") || "—";
const dayBR = iso => (Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(iso)) : "?");

// E-mail do resumo diário: texto simples e HTML; tudo escapado (a mensagem veio de fora).
function digestEmail(picks, { appUrl, escape, now }) {
  const shown = picks.slice(0, 8);
  const fresh = shown.filter(p => p.isNew).length;
  const subject = fresh ? `${fresh} erro(s) novo(s) no app` : `Erro repetido no app (${shown[0].recent} relatos)`;
  const lines = shown.map((p, i) => {
    const g = p.g;
    const where = [g.fn ? `função ${g.fn}` : "", g.loc].filter(Boolean).join(" · ");
    return [
      `${i + 1}. [${KIND_LABEL[g.kind] || g.kind}] ${g.message}${p.isNew ? "  (NOVO)" : "  (em alta)"}`,
      `   ${p.recent} relato(s) em ontem e hoje · ${num(g.count)} no total · primeiro em ${dayBR(g.firstSeen)}`,
      `   Telas: ${fmtTops(g.views)} · Navegadores: ${fmtTops(g.browsers)} · Versões: ${fmtTops(g.versions, versionOf)}${g.codes ? ` · Códigos: ${fmtTops(g.codes)}` : ""}`,
      ...(where ? [`   Onde: ${where}`] : []),
    ].join("\n");
  });
  const intro = `Resumo dos relatos de erro do app (ontem e hoje até agora, ${dayKeySP(now)}). Mostro só o que é novo ou subiu de repente; todos os grupos ficam no painel 📊 do app.`;
  const outro = "Os relatos não têm nome, e-mail, WhatsApp, liga nem conta de ninguém. Para investigar, copie este e-mail (ou o botão 'Copiar relatório' do painel) e cole na conversa com o Claude.";
  const text = [intro, ...lines, outro, `Abrir o app: ${appUrl}`].join("\n\n");
  const esc = escape;
  const html = [
    `<p style="margin:0 0 14px;line-height:1.55">${esc(intro)}</p>`,
    ...shown.map((p, i) => {
      const g = p.g;
      const where = [g.fn ? `função ${g.fn}` : "", g.loc].filter(Boolean).join(" · ");
      return `<div style="margin:0 0 14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;line-height:1.5">
<div><strong>${i + 1}. ${esc(KIND_LABEL[g.kind] || g.kind)}</strong> ${p.isNew ? "🆕" : "📈"}</div>
<div style="font-family:monospace;font-size:13px;margin:4px 0;word-break:break-word">${esc(g.message)}</div>
<div style="color:#6b7280;font-size:12px">${p.recent} relato(s) em ontem e hoje · ${num(g.count)} no total · primeiro em ${esc(dayBR(g.firstSeen))}<br>Telas: ${esc(fmtTops(g.views))} · Navegadores: ${esc(fmtTops(g.browsers))} · Versões: ${esc(fmtTops(g.versions, versionOf))}${g.codes ? ` · Códigos: ${esc(fmtTops(g.codes))}` : ""}${where ? `<br>Onde: ${esc(where)}` : ""}</div></div>`;
    }),
    `<p style="margin:0 0 14px;color:#6b7280;font-size:12px;line-height:1.5">${esc(outro)}</p>`,
    `<p style="margin:18px 0"><a href="${esc(appUrl)}" style="background:#00d67f;color:#000;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;display:inline-block">Abrir o Pelada na Mão</a></p>`,
  ].join("");
  return { subject, html, text };
}

module.exports = {
  KINDS, KIND_LABEL, LIMIT, BROWSERS, OSES, SITE_HOSTS,
  MAX_BODY_BYTES, MAX_REPORTS_PER_DAY, MAX_NEW_GROUPS_PER_DAY, IP_MAX_PER_MINUTE, KEEP_GROUP_DAYS, KEEP_META_DAYS,
  sanitizeText, sanitizeStack, cleanUrl, topFrame, parseReport, fingerprintOf,
  groupWrite, dayField, versionField, mapKey, makeLimiter, clientIp, bodyOf,
  summarize, digestPicks, digestEmail,
};
