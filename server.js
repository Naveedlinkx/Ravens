/**
 * ═══════════════════════════════════════════════════════════════
 *  AZIZI DEVELOPMENTS — TRANSPORT OPERATIONS REPORT
 *  Node.js Server (zero npm dependencies)
 *  Prepared by: Naveed | Manager: Wasim Raza
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const url     = require('url');

// ─── ENV ─────────────────────────────────────────────────────────
// Load .env if present (for local dev)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

const PORT           = process.env.PORT           || 3000;
const ADMIN_USER     = process.env.ADMIN_USERNAME  || 'admin';
const ADMIN_PASS     = process.env.ADMIN_PASSWORD  || 'Azizi@Transport2026!';
const SESSION_SECRET = process.env.SESSION_SECRET  || crypto.randomBytes(32).toString('hex');
const NODE_ENV       = process.env.NODE_ENV        || 'development';

// ─── PATHS ───────────────────────────────────────────────────────
const PUBLIC_DIR  = path.join(__dirname, 'public');
const ADMIN_DIR   = path.join(__dirname, 'admin');
const DATA_DIR    = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH     = path.join(DATA_DIR, 'db.json');

// ─── MIME TYPES ───────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
  '.mp4':  'video/mp4',
  '.mp3':  'audio/mpeg',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

// ─── SESSION STORE ────────────────────────────────────────────────
const sessions = new Map();
function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + 8 * 3600 * 1000; // 8h
  sessions.set(id, { exp });
  return id;
}
function isValidSession(id) {
  if (!id || !sessions.has(id)) return false;
  const s = sessions.get(id);
  if (Date.now() > s.exp) { sessions.delete(id); return false; }
  return true;
}
function getSessionId(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/azizi_sid=([a-f0-9]{64})/);
  return match ? match[1] : null;
}
// Clean expired sessions every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now > v.exp) sessions.delete(k);
}, 30 * 60 * 1000);

// ─── DB HELPERS ───────────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return {}; }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── STATIC FILE HELPER ───────────────────────────────────────────
function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return false;
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type':  mime,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ─── BODY PARSER ─────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ─── MULTIPART PARSER (for file uploads) ─────────────────────────
function parseMultipart(req, body) {
  const ct = req.headers['content-type'] || '';
  const bm = ct.match(/boundary=(.+)/);
  if (!bm) return null;
  const boundary = '--' + bm[1];
  const parts = body.split(boundary).slice(1, -1);
  const result = {};
  parts.forEach(part => {
    const [rawHeaders, ...rest] = part.split('\r\n\r\n');
    const content = rest.join('\r\n\r\n').replace(/\r\n$/, '');
    const nameMatch = rawHeaders.match(/name="([^"]+)"/);
    if (nameMatch) result[nameMatch[1]] = content;
  });
  return result;
}

// ─── JSON RESPONSE HELPERS ────────────────────────────────────────
function jsonOK(res, data) {
  const body = JSON.stringify(data);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function jsonErr(res, status, msg) {
  const body = JSON.stringify({ error: msg });
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// ─── AUDIT LOG ────────────────────────────────────────────────────
function auditLog(action, detail = '') {
  const db = readDB();
  if (!db.audit_log) db.audit_log = [];
  db.audit_log.unshift({ action, detail, ts: new Date().toISOString() });
  if (db.audit_log.length > 200) db.audit_log = db.audit_log.slice(0, 200);
  writeDB(db);
}

// ─── ROUTER ───────────────────────────────────────────────────────
async function router(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const method   = req.method.toUpperCase();

  // CORS headers for API
  if (pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  // Security headers
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // ── API: Login ──
  if (pathname === '/api/login' && method === 'POST') {
    const raw  = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
    if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
      const sid = createSession();
      res.setHeader('Set-Cookie', `azizi_sid=${sid}; Path=/; HttpOnly; SameSite=Strict${NODE_ENV==='production'?'; Secure':''}`);
      auditLog('LOGIN', `User: ${body.username}`);
      return jsonOK(res, { ok: true, message: 'Logged in' });
    }
    return jsonErr(res, 401, 'Invalid credentials');
  }

  // ── API: Logout ──
  if (pathname === '/api/logout' && method === 'POST') {
    const sid = getSessionId(req);
    if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', 'azizi_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    return jsonOK(res, { ok: true });
  }

  // ── API: Check session ──
  if (pathname === '/api/session' && method === 'GET') {
    return jsonOK(res, { authenticated: isValidSession(getSessionId(req)) });
  }

  // ── API: Get content (public) ──
  if (pathname === '/api/content' && method === 'GET') {
    const db = readDB();
    return jsonOK(res, { content: db.content || {}, settings: db.settings || {} });
  }

  // ── API: Update content (auth required) ──
  if (pathname === '/api/content' && method === 'PUT') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
    const db = readDB();
    db.content = { ...(db.content || {}), ...body };
    writeDB(db);
    auditLog('UPDATE_CONTENT', 'Content updated via admin panel');
    return jsonOK(res, { ok: true });
  }

  // ── API: Get/Set settings ──
  if (pathname === '/api/settings') {
    if (method === 'GET') {
      const db = readDB();
      return jsonOK(res, db.settings || {});
    }
    if (method === 'PUT') {
      if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
      const db = readDB();
      db.settings = { ...(db.settings || {}), ...body };
      writeDB(db);
      auditLog('UPDATE_SETTINGS', 'Settings updated');
      return jsonOK(res, { ok: true });
    }
  }

  // ── API: Media list ──
  if (pathname === '/api/media' && method === 'GET') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const files = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.')).map(f => ({
      name: f,
      url:  `/uploads/${f}`,
      size: fs.statSync(path.join(UPLOADS_DIR, f)).size,
    }));
    return jsonOK(res, { files });
  }

  // ── API: Delete media ──
  if (pathname.startsWith('/api/media/') && method === 'DELETE') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const fname = path.basename(pathname.replace('/api/media/', ''));
    const fpath = path.join(UPLOADS_DIR, fname);
    if (fs.existsSync(fpath)) { fs.unlinkSync(fpath); auditLog('DELETE_MEDIA', fname); }
    return jsonOK(res, { ok: true });
  }

  // ── API: Upload media (base64 JSON body — no multipart needed) ──
  if (pathname === '/api/upload' && method === 'POST') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
    if (!body.data || !body.name) return jsonErr(res, 400, 'Missing data or name');
    const safeName = `${Date.now()}_${path.basename(body.name).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    const base64   = body.data.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    auditLog('UPLOAD', safeName);
    return jsonOK(res, { ok: true, url: `/uploads/${safeName}`, name: safeName });
  }

  // ── API: Stats (auth required) ──
  if (pathname === '/api/stats' && method === 'GET') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const db = readDB();
    const mediaCount = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.')).length;
    return jsonOK(res, {
      mediaFiles:  mediaCount,
      auditLog:    (db.audit_log || []).slice(0, 50),
      activeSessions: sessions.size,
      serverTime:  new Date().toISOString(),
    });
  }

  // ── Serve uploads ──
  if (pathname.startsWith('/uploads/')) {
    const fname = path.basename(pathname);
    return serveStatic(res, path.join(UPLOADS_DIR, fname)) || (res.writeHead(404), res.end('Not found'));
  }

  // ── Serve admin panel pages ──
  if (pathname === '/admin' || pathname === '/admin/login') {
    return serveStatic(res, path.join(ADMIN_DIR, 'login.html')) || (res.writeHead(404), res.end('Not found'));
  }
  if (pathname === '/admin/dashboard') {
    if (!isValidSession(getSessionId(req))) {
      res.writeHead(302, { Location: '/admin/login' });
      return res.end();
    }
    return serveStatic(res, path.join(ADMIN_DIR, 'dashboard.html')) || (res.writeHead(404), res.end('Not found'));
  }

  // ── Root → index.html ──
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(PUBLIC_DIR, 'index.html')) || (res.writeHead(404), res.end('Not found'));
  }

  // ── Other public static files ──
  const tryPublic = path.join(PUBLIC_DIR, pathname);
  if (serveStatic(res, tryPublic)) return;

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 — Page not found');
}

// ─── SERVER START ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    console.error('[ERROR]', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   AZIZI TRANSPORT OPERATIONS REPORT — SERVER LIVE    ║
╠══════════════════════════════════════════════════════╣
║  Site:     http://localhost:${PORT}                    ║
║  Admin:    http://localhost:${PORT}/admin/login         ║
║  API:      http://localhost:${PORT}/api/content         ║
╚══════════════════════════════════════════════════════╝
`);
});
