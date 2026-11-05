'use strict';
// Serveur du classement : Node 18+, aucune dépendance.
// Lancer : ORGA_PIN=1234 node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const PIN = process.env.ORGA_PIN || '';
// Code administrateur : saisie comme un organisateur + remise à zéro (sans lui, le code organisateur suffit)
const ADMIN = process.env.ADMIN_PIN || '';
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const PUB = path.join(__dirname, 'public');
// Titre affiché (onglet du navigateur et bandeau jaune), une valeur par instance
// JEUX=1 : ajoute les jeux du matin (victoire / nul / défaite, sans score ni phase finale)
const JEUX = process.env.JEUX === '1';
const TITRE = (process.env.TITRE || 'Classement').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

if (!PIN) { console.error('Définis ORGA_PIN (le code des organisateurs).'); process.exit(1); }

let state = { scores: {} };
try { state = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch {}

function persist() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA);
}

const clients = new Set();
function broadcast() {
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const c of clients) c.write(msg);
}

// Code organisateur : comparaison à temps constant + blocage après 20 échecs en 2 min.
// Blocage court : le jour J, tous les téléphones du wifi de la salle partagent la même IP.
const MAX_FAILS = 20, WINDOW = 120000;
const fails = new Map();
// Sans proxy, l'IP vient de la connexion ; X-Forwarded-For (falsifiable) seulement si TRUST_PROXY=1.
const ipOf = req => process.env.TRUST_PROXY === '1'
  ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress
  : req.socket.remoteAddress;
const same = (a, b) => b !== '' && a.length === Buffer.byteLength(b) && crypto.timingSafeEqual(a, Buffer.from(b));
// Renvoie 200 (bon code), 401 (mauvais code), 403 (code organisateur là où il faut l'admin) ou 429 (trop d'essais)
function pinCheck(req, adminOnly) {
  const ip = ipOf(req), now = Date.now(), f = fails.get(ip);
  if (f && f.n >= MAX_FAILS && now - f.t < WINDOW) return 429;
  const a = Buffer.from(String(req.headers['x-pin'] || ''));
  const admin = same(a, ADMIN), ok = admin || same(a, PIN);
  if (!ok) { fails.set(ip, { n: (f && now - f.t < WINDOW ? f.n : 0) + 1, t: now }); return 401; }
  fails.delete(ip);
  return adminOnly && ADMIN && !admin ? 403 : 200;
}
const isAdmin = req => !ADMIN || same(Buffer.from(String(req.headers['x-pin'] || '')), ADMIN);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 2000) { reject(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') return json(200, state);

    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/auth' && req.method === 'POST') {
      const c = pinCheck(req);
      return json(c, c === 200 ? { admin: isAdmin(req) } : {});
    }

    if (url.pathname === '/api/score' && req.method === 'POST') {
      { const c = pinCheck(req); if (c !== 200) return json(c, { error: 'code' }); }
      const b = await readBody(req);
      if (!/^(m([1-9]|[12]\d|30)|sf1|sf2|fin)$/.test(String(b.id))) return json(400, { error: 'id' });
      if (!b.id.startsWith('m') && !state.semis) return json(400, { error: 'demi-finalistes non confirmés' });
      if (b.a === null && b.b === null) {
        delete state.scores[b.id];
      } else {
        const ok = v => Number.isInteger(v) && v >= 0 && v <= 99;
        if (!ok(b.a) || !ok(b.b)) return json(400, { error: 'score' });
        const s = { a: b.a, b: b.b };
        if (b.a === b.b && (b.w === 'a' || b.w === 'b') && !b.id.startsWith('m')) s.w = b.w;
        state.scores[b.id] = s;
      }
      persist(); broadcast();
      return json(200, state);
    }

    // Confirmation des 4 demi-finalistes (ordre 1er..4e), ou annulation avec seeds = null
    if (url.pathname === '/api/semis' && req.method === 'POST') {
      { const c = pinCheck(req); if (c !== 200) return json(c, { error: 'code' }); }
      const b = await readBody(req);
      if (b.seeds === null) delete state.semis;
      else {
        const s = b.seeds;
        const ok = Array.isArray(s) && s.length === 4 && new Set(s).size === 4 && s.every(n => Number.isInteger(n) && n >= 1 && n <= 12);
        if (!ok) return json(400, { error: 'seeds' });
        state.semis = s;
      }
      delete state.scores.sf1; delete state.scores.sf2; delete state.scores.fin;
      persist(); broadcast();
      return json(200, state);
    }

    // Jeux du matin : id j1 à j36, r = 'a' (A gagne), 'n' (nul), 'b' (B gagne) ou null pour effacer
    if (url.pathname === '/api/jeu' && req.method === 'POST' && JEUX) {
      { const c = pinCheck(req); if (c !== 200) return json(c, { error: 'code' }); }
      const b = await readBody(req);
      if (!/^j([1-9]|[12]\d|3[0-6])$/.test(String(b.id))) return json(400, { error: 'id' });
      state.jeux = state.jeux || {};
      if (b.r === null) delete state.jeux[b.id];
      else if (b.r === 'a' || b.r === 'n' || b.r === 'b') state.jeux[b.id] = b.r;
      else return json(400, { error: 'résultat' });
      persist(); broadcast();
      return json(200, state);
    }

    // part = 'jeux' ou 'tournoi' pour n'effacer qu'une partie ; sans part, tout est effacé
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      { const c = pinCheck(req, true); if (c !== 200) return json(c, { error: 'code' }); }
      const { part } = await readBody(req);
      if (part === 'jeux') delete state.jeux;
      else if (part === 'tournoi') state = state.jeux ? { scores: {}, jeux: state.jeux } : { scores: {} };
      else state = { scores: {} };
      persist(); broadcast();
      return json(200, state);
    }

    if (req.method !== 'GET') return json(404, {});
    const file = path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUB + path.sep)) return json(403, {});
    fs.readFile(file, (err, data) => {
      if (err) return json(404, { error: 'introuvable' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(file.endsWith('index.html') ? data.toString().replaceAll('__TITRE__', TITRE).replace('__JEUX__', JEUX ? '1' : '') : data);
    });
  } catch {
    if (!res.headersSent) json(400, { error: 'requête invalide' });
  }
});

setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log('Classement sur le port ' + PORT));
