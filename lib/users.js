// Penyimpanan user, plan, kuota harian & admin keys — SQLite via lib/db.js.
// Interface sengaja sama persis dengan versi JSON dulu, jadi index.js tidak berubah.
import crypto from "node:crypto"
import { db } from "./db.js"

// Konfigurasi plan. Bisa dioverride via env (dibaca lazy supaya dotenv sempat load).
function getPlans() {
    const num = (v, dflt) => {
        const n = parseInt(v, 10)
        return Number.isFinite(n) && n > 0 ? n : dflt
    }
    return {
        free: { label: "Free", dailyLimit: num(process.env.FREE_DAILY_LIMIT, 100) },
        pro:  { label: "Pro",  dailyLimit: num(process.env.PRO_DAILY_LIMIT, 50000) }
    }
}

// Tanggal lokal server (untuk reset kuota harian jam 00:00 waktu server)
function todayStr() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Waktu reset kuota berikutnya (tengah malam waktu server)
function nextReset() {
    const d = new Date()
    d.setHours(24, 0, 0, 0)
    return d
}

// Baris DB (snake_case) → objek user (camelCase) yang dipakai index.js
function rowToUser(r) {
    if (!r) return null
    return {
        id: r.id,
        provider: r.provider,
        email: r.email,
        name: r.name,
        avatar: r.avatar,
        apiKey: r.api_key,
        plan: r.plan || "free",
        planExpiresAt: r.plan_expires_at,
        banned: !!r.banned,
        usage: { day: r.usage_day, count: r.usage_count ?? 0 },
        createdAt: r.created_at
    }
}

class UserStore {
    constructor() {
        this.q = {
            byId:         db.prepare("SELECT * FROM users WHERE id = ?"),
            byKey:        db.prepare("SELECT * FROM users WHERE api_key = ?"),
            byEmail:      db.prepare("SELECT * FROM users WHERE email = ?"),
            insUser:      db.prepare(`INSERT INTO users (id, provider, email, name, avatar, api_key, plan, plan_expires_at, usage_day, usage_count, created_at)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
            updProfile:   db.prepare("UPDATE users SET name = ?, email = ?, avatar = ? WHERE id = ?"),
            updKey:       db.prepare("UPDATE users SET api_key = ? WHERE id = ?"),
            updPlan:      db.prepare("UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?"),
            updBanned:    db.prepare("UPDATE users SET banned = ? WHERE id = ?"),
            updUsage:     db.prepare("UPDATE users SET usage_day = ?, usage_count = ? WHERE id = ?"),
            all:          db.prepare("SELECT * FROM users"),
            usageToday:   db.prepare("SELECT COALESCE(SUM(usage_count), 0) AS total FROM users WHERE usage_day = ?"),
            specialGet:   db.prepare("SELECT 1 AS x FROM special_keys WHERE key = ?"),
            specialAll:   db.prepare("SELECT key, label, created_at AS createdAt FROM special_keys ORDER BY created_at DESC"),
            specialIns:   db.prepare("INSERT INTO special_keys (key, label, created_at) VALUES (?, ?, ?)"),
            specialDel:   db.prepare("DELETE FROM special_keys WHERE key = ?")
        }
    }

    // Dipanggil saat login OAuth: cari user, kalau belum ada buat + generate API key.
    // profile = { googleId, name, email, avatar } (lihat googleVerify di index.js)
    findOrCreate(profile) {
        const id = `google:${profile.googleId}`
        const email = profile.email || null
        const name = profile.name || "user"
        const avatar = profile.avatar || null

        const existing = rowToUser(this.q.byId.get(id))
        if (existing) {
            this.q.updProfile.run(name, email, avatar, id)
            return rowToUser(this.q.byId.get(id))
        }
        const user = {
            id, provider: "google", email, name, avatar,
            apiKey: "kmn_" + crypto.randomBytes(24).toString("hex"),
            plan: "free",
            planExpiresAt: null,
            usage: { day: todayStr(), count: 0 },
            createdAt: new Date().toISOString()
        }
        this.q.insUser.run(user.id, user.provider, user.email, user.name, user.avatar,
            user.apiKey, user.plan, null, user.usage.day, 0, user.createdAt)
        return user
    }

    getById(id) {
        return rowToUser(this.q.byId.get(id))
    }

    getByApiKey(key) {
        return rowToUser(this.q.byKey.get(key))
    }

    regenerateApiKey(id) {
        const user = this.getById(id)
        if (!user) return null
        const key = "kmn_" + crypto.randomBytes(24).toString("hex")
        this.q.updKey.run(key, id)
        user.apiKey = key
        return key
    }

    // Ubah plan user berdasarkan email login (dipakai admin).
    // Plan dari admin tidak punya kedaluwarsa (berlaku terus).
    setPlanByEmail(email, plan) {
        if (!email || !getPlans()[plan]) return null
        const user = rowToUser(this.q.byEmail.get(email))
        if (!user) return null
        this.q.updPlan.run(plan, null, user.id)
        user.plan = plan
        user.planExpiresAt = null
        return user
    }

    // Ban/unban user berdasarkan email. User yang di-ban: API key-nya ditolak (403).
    setBannedByEmail(email, banned) {
        if (!email) return null
        const user = rowToUser(this.q.byEmail.get(email))
        if (!user) return null
        this.q.updBanned.run(banned ? 1 : 0, user.id)
        user.banned = !!banned
        return user
    }

    // Naikkan ke pro selama `days` hari. Kalau masih ada sisa, diperpanjang dari sisa.
    upgradeToPro(id, days = 30) {
        const user = this.getById(id)
        if (!user) return null
        const now = Date.now()
        const current = user.planExpiresAt ? Date.parse(user.planExpiresAt) : 0
        const base = Math.max(now, current)
        const expires = new Date(base + days * 864e5).toISOString()
        this.q.updPlan.run("pro", expires, id)
        user.plan = "pro"
        user.planExpiresAt = expires
        return user
    }

    // Plan yang berlaku sekarang — pro yang kedaluwarsa otomatis dianggap free.
    effectivePlan(user) {
        if (user.planExpiresAt && Date.parse(user.planExpiresAt) < Date.now()) return "free"
        return user.plan || "free"
    }

    dailyLimit(user) {
        return getPlans()[this.effectivePlan(user)]?.dailyLimit ?? 100
    }

    // Info kuota harian user
    usageInfo(user) {
        const today = todayStr()
        const count = user.usage?.day === today ? user.usage.count : 0
        const limit = this.dailyLimit(user)
        return {
            used: count,
            limit,
            remaining: Math.max(0, limit - count),
            day: today
        }
    }

    // Tambah pemakaian 1. Return { allowed, used, limit, remaining } —
    // allowed=false berarti kuota habis (request jangan diproses).
    consume(user) {
        const today = todayStr()
        let day = user.usage?.day
        let count = user.usage?.count ?? 0
        if (day !== today) { day = today; count = 0 } // reset harian

        const limit = this.dailyLimit(user)
        if (count >= limit) {
            return { allowed: false, used: count, limit, remaining: 0 }
        }

        count++
        this.q.updUsage.run(day, count, user.id)
        user.usage = { day, count }
        return { allowed: true, used: count, limit, remaining: Math.max(0, limit - count) }
    }

    // ── Admin keys: key khusus unlimited (bukan milik user, tidak kena kuota) ──
    isSpecialKey(key) {
        return !!this.q.specialGet.get(key)
    }

    listSpecialKeys() {
        return this.q.specialAll.all()
    }

    addSpecialKey(label) {
        const key = "kmn_adm_" + crypto.randomBytes(20).toString("hex")
        this.q.specialIns.run(key, label || "admin key", new Date().toISOString())
        return key
    }

    removeSpecialKey(key) {
        return this.q.specialDel.run(key).changes > 0
    }

    listUsers() {
        return this.q.all.all().map(rowToUser)
    }

    totalUsageToday() {
        return this.q.usageToday.get(todayStr()).total
    }
}

export const userStore = new UserStore()
export { getPlans, nextReset }
