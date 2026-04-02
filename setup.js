/**
 * First-run setup script for Azizi Transport Report
 * Run: node scripts/setup.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ─── 1. Create required directories ──────────────────────────────
const dirs = [
  path.join(ROOT, 'data'),
  path.join(ROOT, 'data', 'uploads'),
  path.join(ROOT, 'public'),
  path.join(ROOT, 'admin'),
];
dirs.forEach(d => { if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); console.log('✓ Created:', d); } });

// ─── 2. Create .env if not present ───────────────────────────────
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(envPath, [
    `PORT=3000`,
    `NODE_ENV=production`,
    `ADMIN_USERNAME=admin`,
    `ADMIN_PASSWORD=Azizi@Transport2026!`,
    `SESSION_SECRET=${secret}`,
  ].join('\n'));
  console.log('✓ Created .env with default credentials');
  console.log('  ⚠ Change ADMIN_PASSWORD before sharing the URL!');
} else {
  console.log('✓ .env already exists');
}

// ─── 3. Create db.json if not present ────────────────────────────
const dbPath = path.join(ROOT, 'data', 'db.json');
if (!fs.existsSync(dbPath)) {
  const db = {
    content: {
      reportTitle:    'Heavy Rainfall Emergency Response Report',
      reportDate:     '24–28 March 2026',
      preparedBy:     'Naveed',
      managerName:    'Wasim Raza',
      totalEmployees: 122732,
      totalBuses:     446,
      totalCalls:     450,
      injuryCount:    0,
    },
    settings: {
      theme:        'gold',
      tickerSpeed:  'normal',
      flashEnabled: true,
    },
    audit_log: [
      { action: 'SETUP', detail: 'Initial database created', ts: new Date().toISOString() }
    ],
  };
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  console.log('✓ Database initialised at data/db.json');
} else {
  console.log('✓ Database already exists');
}

console.log('\n🚌 Setup complete. Run: node server.js\n');
