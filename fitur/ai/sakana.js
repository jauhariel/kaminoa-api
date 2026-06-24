const BASE = "https://chat.sakana.ai"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const AGENT_ID = "namazu"

// Auto-session: chat.sakana.ai memakai Firebase Auth (tenant anonim). Session
// `sakana-chat` dibuat otomatis tanpa login/cookie browser dengan: Firebase
// anonymous signUp (WAJIB sertakan tenantId) → POST /api/auth/login (idToken)
// → server set cookie sakana-chat. Cookie di-cache & di-refresh bila 401.
// Override manual tetap bisa lewat ?session= atau env SAKANA_SESSION.
const FIREBASE_KEY = "AIzaSyBIJuyUokxGiETY0Nu3hQNC1dMadHyf_I4"
const FIREBASE_TENANT = "sakana-talk-prd-pvl72"

const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_FILES = 4

let cachedSession = null

function baseHeaders(session) {
    return {
        "User-Agent": UA,
        "Origin": BASE,
        "Referer": `${BASE}/`,
        "Cookie": `sakana-chat=${session}`
    }
}

function httpError(message, status) {
    const e = new Error(message)
    e.status = status
    return e
}

// Buat session anonim baru via Firebase → /api/auth/login, balikannya cookie value.
async function mintSession() {
    const fb = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": BASE, "Referer": `${BASE}/` },
        body: JSON.stringify({ returnSecureToken: true, tenantId: FIREBASE_TENANT })
    })
    const fbData = await fb.json().catch(() => ({}))
    if (!fb.ok || !fbData.idToken) throw new Error("Gagal registrasi sesi anonim (Firebase)")

    const login = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { ...baseHeaders(""), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ idToken: fbData.idToken })
    })
    const cookies = login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")].filter(Boolean)
    const session = cookies.map(c => c.match(/sakana-chat=([^;]+)/)?.[1]).filter(Boolean)[0]
    if (!login.ok || !session) throw new Error("Gagal membuat sesi (login ditolak)")
    return session
}

async function getSession(override) {
    if (override) return override
    if (process.env.SAKANA_SESSION) return process.env.SAKANA_SESSION
    if (cachedSession) return cachedSession
    cachedSession = await mintSession()
    return cachedSession
}

// Ambil file dari URL → { name, mime, b64 } untuk dilampirkan ke pesan.
async function fetchFiles(urls) {
    const out = []
    for (const url of urls) {
        const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" })
        if (!res.ok) throw new Error(`Gagal mengambil file (HTTP ${res.status}): ${url}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > MAX_FILE_BYTES) throw new Error(`File terlalu besar (maks ${MAX_FILE_BYTES / 1024 / 1024}MB): ${url}`)
        const mime = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim()
        let name = "file"
        try { name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "file") } catch {}
        out.push({ name, mime, b64: buf.toString("base64") })
    }
    return out
}

// Buat percakapan baru, balikannya { conversationId, systemMessageId }
async function createConversation(prompt, { thinking, search, session }) {
    const res = await fetch(`${BASE}/conversation`, {
        method: "POST",
        headers: { ...baseHeaders(session), "Content-Type": "application/json" },
        body: JSON.stringify({
            inputs: prompt,
            enableThinking: thinking,
            toneMode: "default",
            webSearchEnabled: search,
            agentId: AGENT_ID
        })
    })
    if (!res.ok) {
        const msg = await res.json().then(d => d.message).catch(() => null)
        throw httpError(msg || `Gagal membuat percakapan (HTTP ${res.status})`, res.status)
    }
    return res.json()
}

// Kirim pesan (+ file opsional) & baca stream NDJSON. Tiap baris = satu JSON event.
async function streamMessage(conversationId, prompt, { thinking, search, session, systemMessageId, files }) {
    const data = JSON.stringify({
        inputs: prompt,
        id: systemMessageId,
        is_retry: false,
        is_continue: false,
        enableThinking: thinking,
        toneMode: "default",
        webSearchEnabled: search,
        userMessageId: crypto.randomUUID()
    })
    const form = new FormData()
    form.append("data", data)
    // Lampiran: field `files`, body = string base64, filename = `base64;<nama>`, mime asli.
    for (const f of files) form.append("files", new Blob([f.b64], { type: f.mime }), `base64;${f.name}`)

    const res = await fetch(`${BASE}/conversation/${conversationId}`, {
        method: "POST",
        headers: { ...baseHeaders(session), "Referer": `${BASE}/c/${conversationId}` },
        body: form
    })
    if (!res.ok) {
        const msg = await res.json().then(d => d.message).catch(() => null)
        if (res.status === 403) throw httpError(msg || "Input ditolak (dianggap tidak aman)", 403)
        throw httpError(msg || `Gagal mengirim pesan (HTTP ${res.status})`, res.status)
    }

    let answer = ""
    let stream = ""
    let reasoning = ""
    let interrupted = false
    let error = null

    for (const line of (await res.text()).split("\n")) {
        const t = line.trim()
        if (!t) continue
        let ev
        try { ev = JSON.parse(t) } catch { continue }
        switch (ev.type) {
            case "stream":
                stream += String(ev.token || "").replaceAll("\0", "")
                break
            case "finalAnswer":
                answer = ev.redactionReason ? ev.text : (answer + ev.text)
                interrupted = !!ev.interrupted
                break
            case "reasoning":
                if (ev.subtype === "stream") reasoning += String(ev.token || "").replaceAll("\0", "")
                break
            case "status":
                if (ev.status === "error") error = ev.message || "Terjadi kesalahan pada server"
                break
        }
    }

    if (error) throw new Error(error)
    const parsed = parseSakana((answer || stream).trim())
    return { answer: parsed.answer, reasoning: reasoning.trim() || parsed.reasoning, sources: parsed.sources, interrupted }
}

// Namazu menyisipkan proses & jawaban inline sebagai section:
//   <think>…</think> / <plan>…</plan> (proses), <answer>…</answer> (jawaban final).
// Pisahkan jadi reasoning + answer bersih. Bila tak ada <answer>, buang tag yg
// tersisa dan pakai seluruh teks (kasus jawaban langsung tanpa section).
const STRIP_TAGS = /<\/?(think|plan|answer)>/g
// Sitasi inline dirender sbg chip di frontend: <source-chip title="…" url="…" />
const SOURCE_CHIP = /<source-chip\s+title="((?:[^"\\]|\\.)*)"\s+url="([^"]*)"\s*\/>/g

function extractSection(text, tag) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")
    const out = []
    let m
    while ((m = re.exec(text))) out.push(m[1].replace(STRIP_TAGS, "").trim())
    return out.filter(Boolean).join("\n\n").trim()
}

function parseSakana(text) {
    const sources = []
    let m
    SOURCE_CHIP.lastIndex = 0
    while ((m = SOURCE_CHIP.exec(text))) sources.push({ title: m[1].replace(/\\"/g, '"'), url: m[2] })

    const reasoning = [extractSection(text, "think"), extractSection(text, "plan")].filter(Boolean).join("\n\n").trim()
    const answer = (extractSection(text, "answer") || text.replace(STRIP_TAGS, ""))
        .replace(SOURCE_CHIP, "").replace(/[ \t]+\n/g, "\n").trim()
    return { reasoning, answer, sources }
}

async function cleanup(conversationId, session) {
    try {
        await fetch(`${BASE}/conversation/${conversationId}`, { method: "DELETE", headers: baseHeaders(session) })
    } catch {}
}

async function runOnce(prompt, { thinking, search, session, files }) {
    const { conversationId, systemMessageId } = await createConversation(prompt, { thinking, search, session })
    try {
        const out = await streamMessage(conversationId, prompt, { thinking, search, session, systemMessageId, files })
        return { ...out, conversationId }
    } finally {
        cleanup(conversationId, session)
    }
}

async function askSakana(prompt, { thinking = false, search = false, sessionOverride = null, fileUrls = [] } = {}) {
    const files = await fetchFiles(fileUrls)
    const explicit = !!(sessionOverride || process.env.SAKANA_SESSION)
    let session = await getSession(sessionOverride)
    try {
        return await runOnce(prompt, { thinking, search, session, files })
    } catch (e) {
        // Session auto kedaluwarsa → buang cache, mint ulang, coba sekali lagi.
        if (e.status === 401 && !explicit) {
            cachedSession = null
            session = await getSession()
            return await runOnce(prompt, { thinking, search, session, files })
        }
        throw e
    }
}

export default {
    route: {
        method: "get",
        path: "/ai/sakana",
        auth: false,
        tags: ["AI"],
        summary: "Chat dengan Sakana AI (Namazu)",
        description: "Kirim pesan ke model Namazu lewat chat.sakana.ai tanpa login. Mendukung mode berpikir (thinking), pencarian web, dan lampiran file lewat URL (`fileUrl`). Session anonim dibuat otomatis — opsional override lewat `session` atau env `SAKANA_SESSION`. Catatan: thinking & search tidak bisa aktif bersamaan; lampiran file diekstrak sebagai teks/dokumen (bukan analisa gambar).",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Pesan atau pertanyaan yang dikirim ke Sakana AI",
                schema: { type: "string", example: "Apa itu lubang hitam?" }
            },
            {
                name: "thinking",
                in: "query",
                required: false,
                description: "Aktifkan mode berpikir mendalam (reasoning). Tidak bisa digabung dengan search.",
                schema: { type: "boolean", default: false }
            },
            {
                name: "search",
                in: "query",
                required: false,
                description: "Aktifkan pencarian web. Tidak bisa digabung dengan thinking.",
                schema: { type: "boolean", default: false }
            },
            {
                name: "fileUrl",
                in: "query",
                required: false,
                description: "URL file yang dilampirkan (teks/dokumen). Bisa lebih dari satu, pisahkan dengan koma.",
                schema: { type: "string", example: "https://example.com/dokumen.txt" }
            },
            {
                name: "session",
                in: "query",
                required: false,
                description: "Override cookie session `sakana-chat` (opsional; default dibuat otomatis)",
                schema: { type: "string" }
            }
        ],
        responses: {
            "200": {
                description: "Respons berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                answer: { type: "string" },
                                reasoning: { type: "string" },
                                sources: {
                                    type: "array",
                                    items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } }
                                },
                                interrupted: { type: "boolean" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { prompt } = req.query
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }
        const thinking = req.query.thinking === "true" || req.query.thinking === "1"
        const search = req.query.search === "true" || req.query.search === "1"
        if (thinking && search) {
            return res.status(400).json({ ok: false, error: "Mode thinking dan web search tidak bisa dipakai bersamaan, pilih salah satu" })
        }
        const fileUrls = (req.query.fileUrl || "").split(",").map(s => s.trim()).filter(Boolean)
        if (fileUrls.length > MAX_FILES) {
            return res.status(400).json({ ok: false, error: `Maksimal ${MAX_FILES} file per permintaan` })
        }
        const sessionOverride = (req.query.session && req.query.session.trim()) || null
        try {
            const { answer, reasoning, sources, interrupted } = await askSakana(prompt.trim(), { thinking, search, sessionOverride, fileUrls })
            res.json({ ok: true, answer, reasoning, sources, interrupted })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
