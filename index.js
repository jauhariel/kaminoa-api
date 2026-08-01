import "dotenv/config"
import express from "express"
import session from "express-session"
import passport from "passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import { userStore, getPlans, nextReset } from "./lib/users.js"
import { createQris, checkQrisStatus, paymentStore, payConfig, payEnabled } from "./lib/payment.js"
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set("trust proxy", 1) // penting kalau di-deploy di balik reverse proxy (https)
app.use(express.json())

const API_KEY = process.env.API_KEY
if (!API_KEY) {
    console.warn("[auth] Peringatan: API_KEY belum di-set. Endpoint dengan auth: true akan menolak semua request.")
}

// ── Session store sederhana (persist ke file, biar tidak logout saat restart) ──
class JSONFileStore extends session.Store {
    constructor(file) {
        super()
        this.file = file
        this.sessions = new Map()
        this._timer = null
        try {
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, "utf8"))
                for (const [sid, sess] of Object.entries(data)) {
                    if (sess?.cookie?.expires && new Date(sess.cookie.expires) < new Date()) continue
                    this.sessions.set(sid, sess)
                }
            }
        } catch { /* abaikan file corrupt */ }
        // Sweeper: buang sesi expired tiap jam biar RAM & file tidak menumpuk.
        this._sweeper = setInterval(() => this._sweep(), 60 * 60 * 1000)
        this._sweeper.unref?.()
    }
    _sweep() {
        const now = Date.now()
        let n = 0
        for (const [sid, sess] of this.sessions) {
            const exp = sess?.cookie?.expires
            if (exp && new Date(exp).getTime() < now) { this.sessions.delete(sid); n++ }
        }
        if (n) { this._save(); console.log(`[auth] Sweeper: ${n} sesi expired dibersihkan`) }
    }
    get(sid, cb) {
        const sess = this.sessions.get(sid)
        if (!sess) return cb(null, null)
        if (sess.cookie?.expires && new Date(sess.cookie.expires) < new Date()) {
            this.sessions.delete(sid)
            return cb(null, null)
        }
        cb(null, sess)
    }
    set(sid, sess, cb) {
        this.sessions.set(sid, sess)
        this._save()
        cb?.(null)
    }
    destroy(sid, cb) {
        this.sessions.delete(sid)
        this._save()
        cb?.(null)
    }
    _save() {
        clearTimeout(this._timer)
        this._timer = setTimeout(() => {
            try {
                fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.sessions)))
            } catch { /* abaikan error tulis */ }
        }, 300)
    }
}

const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET) {
    console.warn("[auth] SESSION_SECRET belum di-set — pakai secret acak, semua sesi hangus saat restart.")
}
app.use(session({
    name: "kaminoa.sid",
    secret: SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    store: new JSONFileStore(path.join(__dirname, "data", "sessions.json")),
    cookie: { httpOnly: true, secure: "auto", maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 hari
}))
app.use(passport.initialize())
app.use(passport.session())

// ── OAuth (Google) ──
// Daftar akun yang boleh login (opsional). Format: email atau google:ID
const ALLOWED_USERS = new Set(
    (process.env.ALLOWED_USERS || "")
        .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
)
// Daftar email admin (akses halaman /admin & manajemen user/keys)
const ADMIN_USERS = new Set(
    (process.env.ADMIN_USERS || "")
        .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
)

function googleVerify(accessToken, refreshToken, profile, done) {
    if (ALLOWED_USERS.size > 0) {
        const keys = [
            profile.emails?.[0]?.value?.toLowerCase(),
            `google:${profile.id}`
        ].filter(Boolean)
        if (!keys.some(k => ALLOWED_USERS.has(k))) {
            return done(null, false, { message: "Akun tidak diizinkan" })
        }
    }
    // Buat user baru (otomatis dapat plan free + API key pribadi) atau segarkan profilnya.
    const user = userStore.findOrCreate({
        googleId: profile.id,
        name: profile.displayName || "user",
        email: profile.emails?.[0]?.value || null,
        avatar: profile.photos?.[0]?.value || null
    })
    done(null, user)
}

const providers = []
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback"
    }, googleVerify))
    providers.push("google")
}

const LOGIN_ENABLED = providers.length > 0
if (!LOGIN_ENABLED) {
    console.warn("[auth] OAuth belum dikonfigurasi — server berjalan TANPA proteksi login.")
    console.warn("[auth] Isi GOOGLE_CLIENT_ID/SECRET di .env untuk mengaktifkan.")
}

// Simpan cuma user.id di sesi; data segar (plan, kuota) diambil dari store tiap request.
passport.serializeUser((user, done) => done(null, user.id))
passport.deserializeUser((id, done) => {
    if (typeof id !== "string") return done(null, false) // sesi format lama → login ulang
    done(null, userStore.getById(id) || false)
})

// ── Guard ──
// Halaman (docs, dashboard): wajib login session Google.
function requireLogin(req, res, next) {
    if (!LOGIN_ENABLED || req.isAuthenticated()) return next()
    const accept = req.get("accept") || ""
    if (req.method === "GET" && accept.includes("text/html")) {
        return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl))
    }
    res.status(401).json({ ok: false, error: "Unauthorized — login dulu via Google" })
}

// Endpoint API: WAJIB x-api-key (key pribadi user / master key admin).
// Session login TIDAK berlaku di sini. Kuota harian dipotong sesuai plan.
function requireApiKey(req, res, next) {
    const key = req.headers["x-api-key"]
    if (!key) {
        return res.status(401).json({ ok: false, error: "Butuh API key — kirim header x-api-key. Ambil key kamu di /dashboard" })
    }
    if (API_KEY && key === API_KEY) return next() // master key: tanpa limit
    if (userStore.isSpecialKey(key)) return next() // admin key khusus: tanpa limit
    const user = userStore.getByApiKey(key)
    if (!user) return res.status(401).json({ ok: false, error: "API key tidak valid" })
    if (user.banned) {
        return res.status(403).json({ ok: false, error: "API key ini diblokir (banned). Hubungi admin." })
    }
    const quota = userStore.consume(user)
    res.set({
        "X-RateLimit-Limit": quota.limit,
        "X-RateLimit-Remaining": quota.remaining,
        "X-RateLimit-Reset": Math.floor(nextReset().getTime() / 1000)
    })
    if (!quota.allowed) {
        const saran = user.plan === "free" ? " atau upgrade ke pro" : ""
        return res.status(429).json({
            ok: false,
            error: `Kuota plan ${user.plan} habis (${quota.limit} req/hari). Reset jam 00:00${saran}.`,
            plan: user.plan,
            limit: quota.limit
        })
    }
    req.apiUser = user
    next()
}

// Fallback untuk mode tanpa login (endpoint auth: true pakai master key).
function authGuard(req, res, next) {
    if (req.isAuthenticated?.()) return next()
    const key = req.headers["x-api-key"]
    if (!API_KEY || key !== API_KEY) {
        return res.status(401).json({ ok: false, error: "API key tidak valid" })
    }
    next()
}

// Admin: master API key ATAU login Google dengan email di ADMIN_USERS.
function isAdminReq(req) {
    const key = req.headers["x-api-key"]
    if (API_KEY && key === API_KEY) return true
    if (req.isAuthenticated?.() && req.user?.email && ADMIN_USERS.has(req.user.email.toLowerCase())) return true
    return false
}
function requireAdmin(req, res, next) {
    if (isAdminReq(req)) return next()
    const accept = req.get("accept") || ""
    if (req.method === "GET" && accept.includes("text/html")) {
        if (!req.isAuthenticated?.()) {
            return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl))
        }
        return res.status(403).send("Forbidden — akun kamu bukan admin.")
    }
    res.status(403).json({ ok: false, error: "Forbidden — butuh akses admin" })
}

// ── Auth routes (public, tidak kena guard) ──
app.get("/login", (req, res) => {
    if (!LOGIN_ENABLED || req.isAuthenticated()) return res.redirect("/")
    res.sendFile(path.join(__dirname, "public/login.html"))
})
app.get("/auth/providers", (req, res) => {
    res.json({ ok: true, loginEnabled: LOGIN_ENABLED, providers })
})
app.get("/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ ok: false, error: "Belum login" })
    const u = req.user
    const plan = userStore.effectivePlan(u)
    res.json({
        ok: true,
        user: {
            name: u.name,
            email: u.email,
            avatar: u.avatar,
            provider: "google",
            plan,
            planLabel: getPlans()[plan]?.label || plan,
            planExpiresAt: u.planExpiresAt || null,
            isAdmin: ADMIN_USERS.has((u.email || "").toLowerCase()),
            banned: !!u.banned,
            apiKey: u.apiKey,
            usage: userStore.usageInfo(u)
        },
        plans: getPlans(),
        payment: { enabled: payEnabled(), price: payConfig().price, durationDays: payConfig().durationDays }
    })
})
// Generate ulang API key pribadi (key lama langsung hangus).
app.post("/auth/apikey/regenerate", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ ok: false, error: "Belum login" })
    const user = userStore.regenerateApiKey(req.user.id)
    res.json({ ok: true, apiKey: user.apiKey })
})

// ── Pembayaran (MustikaPay QRIS → upgrade Pro otomatis) ──
// Verifikasi + upgrade (idempoten). Dipanggil dari polling dashboard & webhook.
async function settleIfPaid(refNo) {
    const pay = paymentStore.get(refNo)
    if (!pay) return { found: false }
    if (pay.status === "success") return { found: true, pay }
    let st
    try {
        st = await checkQrisStatus(refNo)
    } catch {
        return { found: true, pay } // gagal konek → coba lagi nanti
    }
    const s = String(st.status || "").toLowerCase() // initiated/pending/success/expired
    if (s === "expired" || s === "failed") {
        paymentStore.setStatus(refNo, "expired")
    } else if (s === "success" && Number(st.amount) >= pay.amount) {
        paymentStore.setStatus(refNo, "success")
        userStore.upgradeToPro(pay.userId, payConfig().durationDays)
    }
    return { found: true, pay: paymentStore.get(refNo) }
}

// Buat tagihan QRIS upgrade Pro. Tagihan pending yang masih berlaku di-reuse.
app.post("/pay/create", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ ok: false, error: "Belum login" })
    if (!payEnabled()) return res.status(503).json({ ok: false, error: "Pembayaran belum dikonfigurasi admin" })
    const u = req.user
    const cfg = payConfig()
    const existing = paymentStore.pendingForUser(u.id, cfg.expiryMin * 60 * 1000)
    if (existing && existing.amount === cfg.price) {
        return res.json({ ok: true, reused: true, refNo: existing.refNo, qrUrl: existing.qrUrl, paymentLink: existing.paymentLink, amount: existing.amount })
    }
    try {
        const base = `${req.protocol}://${req.get("host")}`
        const q = await createQris({
            amount: cfg.price,
            productName: `Kaminoa API — Pro ${cfg.durationDays} hari`,
            customerName: u.name || "Pelanggan",
            expiry: cfg.expiryMin,
            redirectUrl: `${base}/dashboard`
        })
        paymentStore.add({
            refNo: q.ref_no,
            userId: u.id,
            email: u.email,
            amount: Number(q.amount) || cfg.price,
            qrUrl: q.qr_url,
            paymentLink: q.payment_link
        })
        res.json({ ok: true, refNo: q.ref_no, qrUrl: q.qr_url, paymentLink: q.payment_link, amount: Number(q.amount) || cfg.price })
    } catch (e) {
        res.status(502).json({ ok: false, error: "Gagal membuat tagihan: " + e.message })
    }
})

// Cek status tagihan (dipoll dari dashboard). Hanya pemilik tagihan.
app.get("/pay/status/:ref", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ ok: false, error: "Belum login" })
    const r = await settleIfPaid(req.params.ref)
    if (!r.found || r.pay.userId !== req.user.id) {
        return res.status(404).json({ ok: false, error: "Tagihan tidak ditemukan" })
    }
    res.json({ ok: true, status: r.pay.status, paidAt: r.pay.paidAt, plan: userStore.effectivePlan(req.user), planExpiresAt: req.user.planExpiresAt || null })
})

// Webhook MustikaPay (set URL ini di dashboard MustikaPay → Profile → Webhook).
// Selalu respons 200 supaya tidak di-retry; verifikasi ulang ke server MustikaPay.
app.post("/pay/webhook", async (req, res) => {
    res.json({ status: "received" })
    try {
        const { status, reference } = req.body || {}
        if (String(status || "").toLowerCase() !== "success" || !reference) return
        await settleIfPaid(reference)
    } catch { /* abaikan */ }
})
app.get("/auth/logout", (req, res, next) => {
    req.logout(err => err ? next(err) : res.redirect("/login"))
})

function oauthEntry(provider, scope) {
    return (req, res, next) => {
        if (typeof req.query.next === "string" && req.query.next.startsWith("/")) {
            req.session.returnTo = req.query.next
        }
        passport.authenticate(provider, { scope })(req, res, next)
    }
}
function oauthCallback(provider) {
    return [
        passport.authenticate(provider, { failureRedirect: "/login?error=denied" }),
        (req, res) => {
            const dest = req.session.returnTo
            delete req.session.returnTo
            res.redirect(dest || "/dashboard")
        }
    ]
}
if (providers.includes("google")) {
    app.get("/auth/google", oauthEntry("google", ["profile", "email"]))
    app.get("/auth/google/callback", ...oauthCallback("google"))
}

function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...walkDir(full))
        else if (entry.name.endsWith(".js")) files.push(full)
    }
    return files
}

const features = []
for (const file of walkDir(path.join(__dirname, "fitur"))) {
    try {
        const { default: feature } = await import(pathToFileURL(file).href)
        if (feature?.route && typeof feature.handler === "function") {
            const { method, path: routePath, auth } = feature.route
            if (LOGIN_ENABLED) {
                // Mode login: SEMUA endpoint API wajib API key pribadi (+ kuota plan)
                app[method](routePath, requireApiKey, feature.handler)
            } else if (auth) {
                app[method](routePath, authGuard, feature.handler)
            } else {
                app[method](routePath, feature.handler)
            }
            features.push(feature)
        }
    } catch (e) {
        console.warn(`[warn] Gagal load ${file}:`, e.message)
    }
}
console.log(`[routes] ${features.length} endpoint loaded`)

function buildOpenAPI(req) {
    const paths = {}
    for (const { route } of features) {
        const { method, path: routePath, tags, summary, description, parameters, requestBody, responses, auth } = route
        if (!paths[routePath]) paths[routePath] = {}
        paths[routePath][method] = {
            tags, summary, description,
            ...(parameters && { parameters }),
            ...(requestBody && { requestBody }),
            responses,
            ...((LOGIN_ENABLED || auth) && { security: [{ ApiKeyAuth: [] }] })
        }
    }
    return {
        openapi: "3.0.0",
        info: { title: "Kaminoa API", version: "1.0.0", description: "REST API collection by kamino" },
        servers: [{ url: `${req.protocol}://${req.get("host")}` }],
        components: {
            securitySchemes: {
                ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" }
            }
        },
        paths
    }
}

// Statistik publik untuk landing page (tanpa auth, tanpa kuota)
app.get("/api/stats", (req, res) => {
    const cats = {}
    for (const { route } of features) {
        for (const t of route.tags?.length ? route.tags : ["Other"]) {
            cats[t] = (cats[t] || 0) + 1
        }
    }
    res.json({
        ok: true,
        endpoints: features.length,
        categories: Object.entries(cats)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
        plans: getPlans(),
        proPrice: payConfig().price,
        proDurationDays: payConfig().durationDays
    })
})
app.get("/openapi.json", requireLogin, (req, res) => res.json(buildOpenAPI(req)))
app.get("/docs", requireLogin, (req, res) => res.sendFile(path.join(__dirname, "public/docs.html")))
app.get("/dashboard", requireLogin, (req, res) => res.sendFile(path.join(__dirname, "public/dashboard.html")))
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/landing.html")))

// ── Admin (login Google admin / master API key) ──
app.get("/admin", requireAdmin, (req, res) => res.sendFile(path.join(__dirname, "public/admin.html")))

app.get("/admin/overview", requireAdmin, (req, res) => {
    const users = userStore.listUsers()
    res.json({
        ok: true,
        totalUsers: users.length,
        proUsers: users.filter(u => userStore.effectivePlan(u) !== "free").length,
        requestsToday: userStore.totalUsageToday(),
        specialKeys: userStore.listSpecialKeys().length
    })
})

app.get("/admin/users", requireAdmin, (req, res) => {
    res.json({
        ok: true,
        users: userStore.listUsers().map(u => ({
            name: u.name,
            email: u.email,
            avatar: u.avatar,
            plan: userStore.effectivePlan(u),
            planExpiresAt: u.planExpiresAt || null,
            banned: !!u.banned,
            apiKey: u.apiKey,
            usage: userStore.usageInfo(u),
            createdAt: u.createdAt
        })).sort((a, b) => b.usage.used - a.usage.used)
    })
})

// Ubah plan user:  POST /admin/plan  {"email":"user@gmail.com","plan":"pro"}
// Pro yang di-set admin = tanpa kedaluwarsa.
app.post("/admin/plan", requireAdmin, (req, res) => {
    const { email, plan } = req.body || {}
    if (!getPlans()[plan]) {
        return res.status(400).json({ ok: false, error: `Plan tidak dikenal. Pilihan: ${Object.keys(getPlans()).join(", ")}` })
    }
    const user = userStore.setPlanByEmail(email, plan)
    if (!user) return res.status(404).json({ ok: false, error: `User ${email} belum pernah login` })
    res.json({ ok: true, user: { email: user.email, plan: user.plan } })
})

// Ban/unban user:  POST /admin/ban  {"email":"user@gmail.com","banned":true}
app.post("/admin/ban", requireAdmin, (req, res) => {
    const { email, banned } = req.body || {}
    const user = userStore.setBannedByEmail(email, !!banned)
    if (!user) return res.status(404).json({ ok: false, error: `User ${email} belum pernah login` })
    res.json({ ok: true, user: { email: user.email, banned: user.banned } })
})

// Admin keys khusus (unlimited, tidak kena kuota)
app.get("/admin/keys", requireAdmin, (req, res) => {
    res.json({ ok: true, keys: userStore.listSpecialKeys() })
})
app.post("/admin/keys", requireAdmin, (req, res) => {
    const label = String(req.body?.label || "").slice(0, 60).trim()
    const key = userStore.addSpecialKey(label)
    res.json({ ok: true, key })
})
app.delete("/admin/keys/:key", requireAdmin, (req, res) => {
    if (!userStore.removeSpecialKey(req.params.key)) {
        return res.status(404).json({ ok: false, error: "Key tidak ditemukan" })
    }
    res.json({ ok: true })
})

const PORT = process.env.PORT || 47291
app.listen(PORT, () => {
    const planInfo = Object.entries(getPlans()).map(([k, p]) => `${k}: ${p.dailyLimit}/hari`).join(" · ")
    console.log(`\nKaminoa API  →  http://localhost:${PORT}`)
    console.log(`Docs         →  http://localhost:${PORT}/docs`)
    console.log(`Dashboard    →  http://localhost:${PORT}/dashboard`)
    console.log(`Login OAuth  →  ${LOGIN_ENABLED ? "aktif (google)" : "nonaktif"}`)
    if (LOGIN_ENABLED) console.log(`Plan limits  →  ${planInfo}`)
    console.log()
})
