// Database SQLite bersama — pakai node:sqlite (bawaan Node 22.5+, tanpa dependency eksternal).
// Satu file data.sqlite untuk semua: users, special_keys, payments.
// Mode WAL: aman untuk baca-tulis bersamaan & tahan crash.
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE = path.join(__dirname, "..", "data.sqlite")
const USERS_JSON = path.join(__dirname, "..", ".users.json")
const PAYMENTS_JSON = path.join(__dirname, "..", ".payments.json")

export const db = new DatabaseSync(DB_FILE)

db.exec("PRAGMA journal_mode = WAL")
db.exec("PRAGMA foreign_keys = ON")
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  provider        TEXT,
  email           TEXT,
  name            TEXT,
  avatar          TEXT,
  api_key         TEXT UNIQUE,
  plan            TEXT NOT NULL DEFAULT 'free',
  plan_expires_at TEXT,
  usage_day       TEXT,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT
);
CREATE TABLE IF NOT EXISTS special_keys (
  key        TEXT PRIMARY KEY,
  label      TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  ref_no       TEXT PRIMARY KEY,
  user_id      TEXT,
  email        TEXT,
  amount       INTEGER,
  status       TEXT,
  qr_url       TEXT,
  payment_link TEXT,
  created_at   TEXT,
  paid_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, status);
`)

// Kolom tambahan pasca-rilis (ALTER TABLE SQLite tidak support IF NOT EXISTS)
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
if (!userCols.includes("banned")) {
    db.exec("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0")
}

// ── Migrasi satu kali dari file JSON lama (kalau ada) ──
// Setelah berhasil, file lama di-rename jadi .bak (tidak dihapus, untuk cadangan).
function migrateUsersJson() {
    if (!fs.existsSync(USERS_JSON)) return
    try {
        const data = JSON.parse(fs.readFileSync(USERS_JSON, "utf8"))
        const insUser = db.prepare(`INSERT OR IGNORE INTO users
            (id, provider, email, name, avatar, api_key, plan, plan_expires_at, usage_day, usage_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        const insKey = db.prepare("INSERT OR IGNORE INTO special_keys (key, label, created_at) VALUES (?, ?, ?)")
        db.exec("BEGIN")
        let nUser = 0, nKey = 0
        for (const [id, u] of Object.entries(data.users || {})) {
            insUser.run(id, u.provider || null, u.email || null, u.name || null, u.avatar || null,
                u.apiKey || null, u.plan || "free", u.planExpiresAt || null,
                u.usage?.day || null, u.usage?.count || 0, u.createdAt || new Date().toISOString())
            nUser++
        }
        for (const [k, info] of Object.entries(data.specialKeys || {})) {
            insKey.run(k, info.label || null, info.createdAt || new Date().toISOString())
            nKey++
        }
        db.exec("COMMIT")
        fs.renameSync(USERS_JSON, USERS_JSON + ".bak")
        console.log(`[db] Migrasi .users.json → SQLite: ${nUser} user, ${nKey} admin key`)
    } catch (e) {
        try { db.exec("ROLLBACK") } catch { /* abaikan */ }
        console.error("[db] Gagal migrasi .users.json:", e.message)
    }
}

function migratePaymentsJson() {
    if (!fs.existsSync(PAYMENTS_JSON)) return
    try {
        const data = JSON.parse(fs.readFileSync(PAYMENTS_JSON, "utf8"))
        const ins = db.prepare(`INSERT OR IGNORE INTO payments
            (ref_no, user_id, email, amount, status, qr_url, payment_link, created_at, paid_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        db.exec("BEGIN")
        let n = 0
        for (const [ref, p] of Object.entries(data.payments || {})) {
            ins.run(ref, p.userId || null, p.email || null, p.amount || 0, p.status || "pending",
                p.qrUrl || null, p.paymentLink || null, p.createdAt || null, p.paidAt || null)
            n++
        }
        db.exec("COMMIT")
        fs.renameSync(PAYMENTS_JSON, PAYMENTS_JSON + ".bak")
        console.log(`[db] Migrasi .payments.json → SQLite: ${n} pembayaran`)
    } catch (e) {
        try { db.exec("ROLLBACK") } catch { /* abaikan */ }
        console.error("[db] Gagal migrasi .payments.json:", e.message)
    }
}

migrateUsersJson()
migratePaymentsJson()
