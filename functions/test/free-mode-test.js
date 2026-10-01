const Module = require('module');
const path = require('path').join(__dirname, '..', 'index.js');

// ── mocks mínimos ───────────────────────────────────────────────
const docs = {}; // path -> data (undefined = não existe)
const setDoc = (p, data) => { docs[p] = data; };
const rateLimitStore = {};

class FieldPathMock { constructor(...segments) { this.segments = segments; } }
const FieldValueMock = {
  increment: n => ({ __increment: n }),
  delete: () => ({ __delete: true }),
};

function applyUpdate(current, patch) {
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.__increment !== undefined) next[k] = (current?.[k] || 0) + v.__increment;
    else next[k] = v;
  }
  return next;
}

const fakeDb = {
  doc: (p) => ({
    get: async () => ({ exists: docs[p] !== undefined, data: () => docs[p] }),
    set: async (data) => { docs[p] = data; },
    update: async (patch) => { docs[p] = applyUpdate(docs[p], patch); },
  }),
};

const admin = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, {}),
  messaging: () => ({}),
  storage: () => ({ bucket: () => ({ name: 'seriebaceoma.firebasestorage.app' }) }),
};

let scheduledHandlers = {};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (p, h) => { scheduledHandlers[JSON.stringify(p)] = h; return h; } };
  if (request === 'firebase-admin') return admin;
  if (request === 'firebase-functions') return { logger: { info() {}, warn() {}, error() {} } };
  if (request === 'firebase-admin/firestore') return { FieldValue: FieldValueMock, FieldPath: FieldPathMock };
  if (request === 'firebase-functions/v2/https') return { onCall: (opts, h) => h, onRequest: (opts, h) => h, HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; this.name = 'HttpsError'; } } };
  if (request === 'firebase-functions/params') return { defineSecret: name => ({ value: () => '' }) };
  if (request === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class { databasePath(p, d) { return `projects/${p}/databases/${d}`; } async exportDocuments() { return [{ name: 'op-fake' }]; } } } };
  // Mínimo para o módulo carregar: este arquivo não exercita o fluxo de pagamento.
  if (request === 'mercadopago') return {
    MercadoPagoConfig: class { constructor() {} },
    PreApproval: class { async create() { return {}; } async get() { return {}; } },
    Preference: class { async create() { return {}; } },
    Payment: class { async get() { return {}; } },
    WebhookSignatureValidator: class { static validate() {} },
  };
  return origLoad.call(this, request, ...rest);
};
const fns = require(path);
Module._load = origLoad;

const results = [];
const check = (label, cond) => results.push({ label, ok: !!cond });

// ── 1) enforceFreeModeNoGoals: campeonato freeMode com gols deve ser limpo ──
(async () => {
  const champPath = 'leagues/L/championships/c1';
  const dataWithGoals = {
    freeMode: true,
    matches: [
      { id: 'm1', hs: 2, as: 1, goals: [{ player: 'Fulano', team: 'home' }], participants: [] },
      { id: 'm2', hs: 0, as: 0 }, // sem gols, não deve mexer
    ],
  };
  setDoc(champPath, dataWithGoals);
  const event = {
    params: { leagueId: 'L', champId: 'c1' },
    data: { after: { exists: true, data: () => dataWithGoals, ref: { update: async (patch) => { docs[champPath] = { ...docs[champPath], ...patch }; } } } },
  };
  await fns.enforceFreeModeNoGoals(event);
  const after = docs[champPath];
  check('freeMode: goals removidos da partida m1', !after.matches[0].goals && !after.matches[0].participants);
  check('freeMode: m2 sem gols não foi alterada (mantém hs/as)', after.matches[1].hs === 0 && after.matches[1].as === 0);

  // ── 2) campeonato NÃO freeMode: não deve mexer em nada ──
  const champPath2 = 'leagues/L/championships/c2';
  const dataNormal = { freeMode: false, matches: [{ id: 'm1', hs: 2, as: 1, goals: [{ player: 'Fulano', team: 'home' }] }] };
  setDoc(champPath2, dataNormal);
  let updateCalled = false;
  const event2 = {
    params: { leagueId: 'L', champId: 'c2' },
    data: { after: { exists: true, data: () => dataNormal, ref: { update: async () => { updateCalled = true; } } } },
  };
  await fns.enforceFreeModeNoGoals(event2);
  check('não-freeMode: não mexe nos gols', !updateCalled && docs[champPath2].matches[0].goals.length === 1);

  // ── 3) documento deletado (after não existe): não deve quebrar ──
  const event3 = { params: { leagueId: 'L', champId: 'c3' }, data: { after: { exists: false } } };
  let threw = false;
  try { await fns.enforceFreeModeNoGoals(event3); } catch (e) { threw = true; }
  check('documento deletado: não lança erro', !threw);

  // ── 4) checkRateLimit via joinLeague: 11ª chamada no mesmo minuto deve falhar ──
  // joinLeague real também valida token/liga; usamos um cenário que falharia depois
  // do rate limit de qualquer forma, só para confirmar que o rate limit dispara ANTES.
  const request = { auth: { uid: 'uid-spam', token: {} }, data: { liga: 'L', token: 'x'.repeat(10) } };
  let lastErr = null;
  for (let i = 0; i < 11; i++) {
    try { await fns.joinLeague(request); } catch (e) { lastErr = e; }
  }
  check('rate limit: 11ª chamada de joinLeague é bloqueada por resource-exhausted', lastErr && lastErr.code === 'resource-exhausted');

  // ── 5) scheduledFirestoreBackup: função carregada e chamável sem lançar ──
  let backupThrew = false, backupMsg = '';
  try { await fns.scheduledFirestoreBackup(); } catch (e) { backupThrew = true; backupMsg = e.message; }
  check('scheduledFirestoreBackup roda sem lançar (mock de exportDocuments)', !backupThrew, backupMsg);

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram.`);
  if (failed.length) { console.log('FALHAS:', failed.map(f => f.label)); process.exitCode = 1; }
})();
