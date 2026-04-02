'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const url    = require('url');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()])
      process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
  });
}

const PORT       = process.env.PORT           || 10000;
const ADMIN_USER = process.env.ADMIN_USERNAME  || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD  || 'Azizi@Transport2026!';
const NODE_ENV   = process.env.NODE_ENV        || 'production';

const PUBLIC_DIR  = path.join(__dirname, 'public');
const ADMIN_DIR   = path.join(__dirname, 'admin');
const DATA_DIR    = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH     = path.join(DATA_DIR, 'db.json');

[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ content: {}, settings: {}, audit_log: [] }, null, 2));

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.pdf':'application/pdf', '.mp4':'video/mp4', '.mp3':'audio/mpeg',
  '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf',
};

const sessions = new Map();
function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { exp: Date.now() + 8 * 3600 * 1000 });
  return id;
}
function isValidSession(id) {
  if (!id || !sessions.has(id)) return false;
  const s = sessions.get(id);
  if (Date.now() > s.exp) { sessions.delete(id); return false; }
  return true;
}
function getSessionId(req) {
  const m = (req.headers.cookie || '').match(/azizi_sid=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

function readDB() { try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { return {}; } }
function writeDB(d) { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); }

function auditLog(action, detail = '') {
  const db = readDB();
  if (!db.audit_log) db.audit_log = [];
  db.audit_log.unshift({ action, detail, ts: new Date().toISOString() });
  if (db.audit_log.length > 200) db.audit_log = db.audit_log.slice(0, 200);
  writeDB(db);
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public,max-age=86400' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const c = [];
    req.on('data', d => c.push(d));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonOK(res, data) {
  const b = JSON.stringify(data);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}
function jsonErr(res, status, msg) {
  const b = JSON.stringify({ error: msg });
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

async function router(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const method   = req.method.toUpperCase();

  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  if (pathname === '/api/login' && method === 'POST') {
    const raw = await readBody(req);
    let body; try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
    if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
      const sid = createSession();
      res.setHeader('Set-Cookie', `azizi_sid=${sid}; Path=/; HttpOnly; SameSite=Strict${NODE_ENV === 'production' ? '; Secure' : ''}`);
      auditLog('LOGIN', `User: ${body.username}`);
      return jsonOK(res, { ok: true });
    }
    return jsonErr(res, 401, 'Invalid credentials');
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const sid = getSessionId(req); if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', 'azizi_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    return jsonOK(res, { ok: true });
  }

  if (pathname === '/api/session' && method === 'GET') return jsonOK(res, { authenticated: isValidSession(getSessionId(req)) });

  if (pathname === '/api/content' && method === 'GET') {
    const db = readDB(); return jsonOK(res, { content: db.content || {}, settings: db.settings || {} });
  }

  if (pathname === '/api/content' && method === 'PUT') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const raw = await readBody(req); let body; try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
    const db = readDB(); db.content = { ...(db.content || {}), ...body }; writeDB(db);
    auditLog('UPDATE_CONTENT', 'Content updated'); return jsonOK(res, { ok: true });
  }

  if (pathname === '/api/settings') {
    if (method === 'GET') { const db = readDB(); return jsonOK(res, db.settings || {}); }
    if (method === 'PUT') {
      if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
      const raw = await readBody(req); let body; try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
      const db = readDB(); db.settings = { ...(db.settings || {}), ...body }; writeDB(db);
      auditLog('UPDATE_SETTINGS', 'Settings updated'); return jsonOK(res, { ok: true });
    }
  }

  if (pathname === '/api/media' && method === 'GET') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const files = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.')).map(f => ({
      name: f, url: `/uploads/${f}`, size: fs.statSync(path.join(UPLOADS_DIR, f)).size
    }));
    return jsonOK(res, { files });
  }

  if (pathname.startsWith('/api/media/') && method === 'DELETE') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const fname = path.basename(pathname.replace('/api/media/', ''));
    const fpath = path.join(UPLOADS_DIR, fname);
    if (fs.existsSync(fpath)) { fs.unlinkSync(fpath); auditLog('DELETE_MEDIA', fname); }
    return jsonOK(res, { ok: true });
  }

  if (pathname === '/api/upload' && method === 'POST') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const raw = await readBody(req); let body; try { body = JSON.parse(raw); } catch { return jsonErr(res, 400, 'Invalid JSON'); }
    if (!body.data || !body.name) return jsonErr(res, 400, 'Missing data or name');
    const safeName = `${Date.now()}_${path.basename(body.name).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, safeName), Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64'));
    auditLog('UPLOAD', safeName);
    return jsonOK(res, { ok: true, url: `/uploads/${safeName}`, name: safeName });
  }

  if (pathname === '/api/stats' && method === 'GET') {
    if (!isValidSession(getSessionId(req))) return jsonErr(res, 401, 'Unauthorised');
    const db = readDB();
    return jsonOK(res, {
      mediaFiles: fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.')).length,
      auditLog: (db.audit_log || []).slice(0, 50),
      activeSessions: sessions.size,
      serverTime: new Date().toISOString()
    });
  }

  if (pathname.startsWith('/uploads/')) {
    return serveStatic(res, path.join(UPLOADS_DIR, path.basename(pathname))) || (res.writeHead(404), res.end('Not found'));
  }

  if (pathname === '/admin' || pathname === '/admin/login') {
    return serveStatic(res, path.join(ADMIN_DIR, 'login.html')) || (res.writeHead(404), res.end('Not found'));
  }

  if (pathname === '/admin/dashboard') {
    if (!isValidSession(getSessionId(req))) { res.writeHead(302, { Location: '/admin/login' }); return res.end(); }
    return serveStatic(res, path.join(ADMIN_DIR, 'dashboard.html')) || (res.writeHead(404), res.end('Not found'));
  }

  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(PUBLIC_DIR, 'index.html')) || (res.writeHead(404), res.end('Not found'));
  }

  if (serveStatic(res, path.join(PUBLIC_DIR, pathname))) return;

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
}

const server = http.createServer(async (req, res) => {
  try { await router(req, res); }
  catch (err) {
    console.error('[ERROR]', err.message);
    if (!res.headersSent) { res.writeHead(500); res.end('Server Error'); }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   AZIZI TRANSPORT OPERATIONS REPORT — SERVER LIVE    ║
╠══════════════════════════════════════════════════════╣
║  Port:     ${PORT}                                     ║
║  Admin:    /admin/login                              ║
╚══════════════════════════════════════════════════════╝
`);
});
