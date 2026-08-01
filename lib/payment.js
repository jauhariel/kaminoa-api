// Integrasi pembayaran MustikaPay (https://mustikapayment.com) — QRIS.
// Alur: create QRIS → user bayar → status dicek via polling (dashboard) / webhook → plan jadi pro.
// Tagihan disimpan di SQLite via lib/db.js.
import { db } from "./db.js"

const MP_BASE = "https://mustikapayment.com/api/v1"

// Konfigurasi dari env (dibaca lazy supaya dotenv sempat load)
function payConfig() {
    const num = (v, dflt) => {
        const n = parseInt(v, 10)
        return Number.isFinite(n) && n > 0 ? n : dflt
    }
    return {
        apiKey: (process.env.MUSTIKA_API_KEY || "").trim(),
        price: num(process.env.PRO_PRICE, 10000),
        durationDays: num(process.env.PRO_DURATION_DAYS, 30),
        expiryMin: num(process.env.PAYMENT_EXPIRY_MIN, 30)
    }
}

function payEnabled() {
    return payConfig().apiKey.length > 0
}

async function mpFetch(path, { method = "GET", body } = {}) {
    const { apiKey } = payConfig()
    const opts = { method, headers: { "X-Api-Key": apiKey } }
    if (body) {
        opts.headers["Content-Type"] = "application/x-www-form-urlencoded"
        opts.body = new URLSearchParams(body).toString()
    }
    const res = await fetch(MP_BASE + path, opts)
    const data = await res.json().catch(() => ({}))
    return { http: res.status, data }
}

// Buat QRIS dinamis. Return: { ok, refNo, qrUrl, paymentLink, error? }
export async function createQris({ amount, productName, customerName, expiryMinutes, redirectUrl }) {
    try {
        const { http, data } = await mpFetch("/create/qris", {
            method: "POST",
            body: {
                amount,
                product_name: productName,
                customer_name: customerName,
                expiry: expiryMinutes,
                redirect_url: redirectUrl
            }
        })
        if (http === 200 && data.status === "success" && data.ref_no) {
            return { ok: true, refNo: data.ref_no, qrUrl: data.qr_url, paymentLink: data.payment_link }
        }
        return { ok: false, error: data?.message || `MustikaPay error (HTTP ${http})` }
    } catch (e) {
        return { ok: false, error: "Gateway tidak bisa dihubungi" }
    }
}

// Cek status pembayaran. Return: { ok, status, paidAt, amount, raw }
export async function checkQrisStatus(refNo) {
    try {
        const { http, data } = await mpFetch("/check/qris?ref_no=" + encodeURIComponent(refNo))
        if (http === 200 && data.status === "success") {
            return { ok: true, status: data.payment_status || "pending", paidAt: data.paid_at || null, amount: data.amount ?? null, raw: data }
        }
        return { ok: false, status: "unknown", error: data?.message || `MustikaPay error (HTTP ${http})` }
    } catch (e) {
        return { ok: false, status: "unknown", error: "Gateway tidak bisa dihubungi" }
    }
}

// ── Store tagihan lokal (SQLite) ──
// QRIS MustikaPay tidak mengirim order_id di webhook, jadi mapping ref_no → user
// wajib disimpan di sini saat tagihan dibuat.

function rowToPay(r) {
    if (!r) return null
    return {
        refNo: r.ref_no,
        userId: r.user_id,
        email: r.email,
        amount: r.amount,
        status: r.status,
        qrUrl: r.qr_url,
        paymentLink: r.payment_link,
        createdAt: r.created_at,
        paidAt: r.paid_at
    }
}

class PaymentStore {
    constructor() {
        this.q = {
            ins: db.prepare(`INSERT INTO payments (ref_no, user_id, email, amount, status, qr_url, payment_link, created_at, paid_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
            get: db.prepare("SELECT * FROM payments WHERE ref_no = ?"),
            pending: db.prepare(`SELECT * FROM payments WHERE user_id = ? AND status = 'pending' AND created_at > ?
                                 ORDER BY created_at DESC LIMIT 1`),
            forUser: db.prepare("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC"),
            updStatus: db.prepare("UPDATE payments SET status = ?, paid_at = ? WHERE ref_no = ?")
        }
    }

    add({ refNo, userId, email, amount, qrUrl, paymentLink }) {
        const createdAt = new Date().toISOString()
        this.q.ins.run(refNo, userId, email, amount, "pending", qrUrl, paymentLink, createdAt, null)
        return { refNo, userId, email, amount, status: "pending", qrUrl, paymentLink, createdAt, paidAt: null }
    }

    get(refNo) {
        return rowToPay(this.q.get.get(refNo))
    }

    // Tagihan pending milik user yang dibuat dalam rentang withinMs terakhir (untuk reuse)
    pendingForUser(userId, withinMs) {
        const since = new Date(Date.now() - withinMs).toISOString()
        return rowToPay(this.q.pending.get(userId, since))
    }

    listForUser(userId) {
        return this.q.forUser.all(userId).map(rowToPay)
    }

    setStatus(refNo, status) {
        const p = this.get(refNo)
        if (!p) return null
        const paidAt = status === "success" ? new Date().toISOString() : p.paidAt
        this.q.updStatus.run(status, paidAt, refNo)
        p.status = status
        p.paidAt = paidAt
        return p
    }
}

export const paymentStore = new PaymentStore()
export { payConfig, payEnabled }
