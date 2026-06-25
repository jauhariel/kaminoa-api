const BASE = "https://chat.sakana.ai"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const AGENT_ID = "namazu"

// Auto-session: chat.sakana.ai memakai Firebase Auth (tenant anonim). Session
// `sakana-chat` dibuat otomatis tanpa login/cookie browser dengan: Firebase
// anonymous signUp (WAJIB sertakan tenantId) → POST /api/auth/login (idToken)
// → server set cookie sakana-chat. Cookie di-cache & di-refresh bila 401.
// Override manual tetap bisa lewat ?session= atau env SAKANA_SESSION.
//
// Nilai Firebase di bawah adalah nilai PUBLIK dari bundle web Sakana (bukan
// rahasia). Dipakai sbg default cepat; bila suatu saat Sakana merotasinya
// sehingga mint session gagal, nilai baru di-scrape otomatis dari bundle
// (discoverFirebaseConfig) sekali per proses lalu dipakai.
let FIREBASE_KEY = "AIzaSyBIJuyUokxGiETY0Nu3hQNC1dMadHyf_I4"
let FIREBASE_TENANT = "sakana-talk-prd-pvl72"
let configDiscovered = false

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

// Scrape Firebase apiKey & tenantId dari bundle web Sakana (homepage → app.js →
// chunks). Dipakai sbg fallback bila nilai default sudah dirotasi. Sekali jalan.
async function discoverFirebaseConfig() {
    const html = await (await fetch(`${BASE}/`, { headers: { "User-Agent": UA } })).text()
    const entry = html.match(/\/_app\/immutable\/entry\/app\.[A-Za-z0-9_-]+\.js/)?.[0]
    if (!entry) throw new Error("entry bundle tidak ditemukan")
    const appjs = await (await fetch(`${BASE}${entry}`, { headers: { "User-Agent": UA } })).text()
    const chunks = [...new Set([...appjs.matchAll(/chunks\/[A-Za-z0-9._-]+\.js/g)].map(m => m[0]))]

    const KEY_RE = /AIzaSy[0-9A-Za-z_-]{20,}/
    const TEN_RE = /sakana-talk-[a-z]+-[a-z0-9]+/
    let key = null, tenant = null, i = 0
    const worker = async () => {
        while (i < chunks.length && !(key && tenant)) {
            const c = chunks[i++]
            let js
            try { js = await (await fetch(`${BASE}/_app/immutable/${c}`, { headers: { "User-Agent": UA } })).text() } catch { continue }
            key = key || js.match(KEY_RE)?.[0]
            tenant = tenant || js.match(TEN_RE)?.[0]
        }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    if (!key || !tenant) throw new Error("config Firebase tidak ditemukan di bundle")
    return { key, tenant }
}

// Satu kali registrasi+login pakai key/tenant tertentu → balikannya cookie value.
async function mintSessionWith(key, tenant) {
    const fb = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": BASE, "Referer": `${BASE}/` },
        body: JSON.stringify({ returnSecureToken: true, tenantId: tenant })
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

// Buat session anonim. Coba key/tenant default dulu; bila gagal & belum pernah,
// scrape config terbaru dari bundle (self-healing) lalu coba sekali lagi.
async function mintSession() {
    try {
        return await mintSessionWith(FIREBASE_KEY, FIREBASE_TENANT)
    } catch (e) {
        if (configDiscovered) throw e
        configDiscovered = true
        let cfg
        try { cfg = await discoverFirebaseConfig() } catch { throw e }
        FIREBASE_KEY = cfg.key
        FIREBASE_TENANT = cfg.tenant
        return await mintSessionWith(FIREBASE_KEY, FIREBASE_TENANT)
    }
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
async function streamMessage(conversationId, prompt, { thinking, search, session, parentId, files }) {
    const data = JSON.stringify({
        inputs: prompt,
        id: parentId,
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
    let messageId = null

    for (const line of (await res.text()).split("\n")) {
        const t = line.trim()
        if (!t) continue
        let ev
        try { ev = JSON.parse(t) } catch { continue }
        switch (ev.type) {
            case "createdMessage":
                messageId = ev.messageId
                break
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
    return { answer: parsed.answer, reasoning: reasoning.trim() || parsed.reasoning, sources: parsed.sources, interrupted, messageId }
}

// Ambil id pesan terakhir di sebuah conversation (parent untuk turn berikutnya).
async function lastMessageId(conversationId, session) {
    const res = await fetch(`${BASE}/api/conversation/${conversationId}`, { headers: baseHeaders(session) })
    if (!res.ok) throw httpError(`Conversation tidak ditemukan (HTTP ${res.status})`, res.status)
    const data = await res.json().catch(() => ({}))
    return (data.messages || []).at(-1)?.id || null
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

async function runOnce(prompt, { thinking, search, session, files, conversationId, keep }) {
    let cid = conversationId
    let pid
    let created = false
    if (cid) {
        // Lanjutan percakapan: parent = pesan terakhir di conversation.
        pid = await lastMessageId(cid, session)
        if (!pid) throw httpError("Tidak bisa menentukan pesan induk untuk dilanjutkan", 400)
    } else {
        const c = await createConversation(prompt, { thinking, search, session })
        cid = c.conversationId
        pid = c.systemMessageId
        created = true
    }
    try {
        const out = await streamMessage(cid, prompt, { thinking, search, session, parentId: pid, files })
        return { ...out, conversationId: cid, session }
    } finally {
        // Hapus hanya bila one-shot (bikin baru & tak diminta disimpan).
        if (created && !keep) cleanup(cid, session)
    }
}

async function askSakana(prompt, { thinking = false, search = false, sessionOverride = null, fileUrls = [], conversationId = null, keep = false } = {}) {
    const files = await fetchFiles(fileUrls)
    const explicit = !!(sessionOverride || process.env.SAKANA_SESSION)
    let session = await getSession(sessionOverride)
    try {
        return await runOnce(prompt, { thinking, search, session, files, conversationId, keep })
    } catch (e) {
        // Session auto kedaluwarsa → buang cache, mint ulang, coba lagi (hanya utk percakapan baru).
        if (e.status === 401 && !explicit && !conversationId) {
            cachedSession = null
            session = await getSession()
            return await runOnce(prompt, { thinking, search, session, files, keep })
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
        description: "Kirim pesan ke model Namazu lewat chat.sakana.ai tanpa login. Session anonim dibuat otomatis. Mendukung mode berpikir (thinking), pencarian web, dan lampiran file lewat URL (fileUrl). " +
            "MULTI-TURN: mulai dengan keep=true, mis. `/ai/sakana?prompt=Halo&keep=true` → respons memberi conversationId. Lanjutkan dengan `/ai/sakana?prompt=lanjutannya&conversationId=<id-tadi>`. " +
            "Catatan: thinking & search tidak bisa aktif bersamaan; lampiran file diekstrak sebagai teks/dokumen (bukan analisa gambar).",
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
                schema: { type: "boolean", enum: [false, true], default: false }
            },
            {
                name: "search",
                in: "query",
                required: false,
                description: "Aktifkan pencarian web. Tidak bisa digabung dengan thinking.",
                schema: { type: "boolean", enum: [false, true], default: false }
            },
            {
                name: "fileUrl",
                in: "query",
                required: false,
                description: "URL file yang dilampirkan (teks/dokumen). Bisa lebih dari satu, pisahkan dengan koma.",
                schema: { type: "string", example: "https://example.com/dokumen.txt" }
            },
            {
                name: "keep",
                in: "query",
                required: false,
                description: "Set `true` untuk percakapan multi-turn: percakapan disimpan & respons menyertakan `conversationId` (+ `messageId`, `session`). Lanjutkan dengan mengirim `conversationId` di permintaan berikutnya. Default `false` = sekali jawab lalu dihapus.",
                schema: { type: "boolean", enum: [false, true], default: false, example: true }
            },
            {
                name: "conversationId",
                in: "query",
                required: false,
                description: "Lanjutkan percakapan yang sudah ada. Isi dengan `conversationId` dari respons `keep=true` sebelumnya (cukup ini saja; `session` opsional).",
                schema: { type: "string", example: "019efbef-1ca3-750f-9000-000000000000" }
            },
            {
                name: "session",
                in: "query",
                required: false,
                description: "Cookie session `sakana-chat`. Default dibuat otomatis. Untuk melanjutkan percakapan biasanya cukup `conversationId`; sertakan `session` (dari respons sebelumnya) hanya bila ingin tahan terhadap restart server.",
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
        const conversationId = (req.query.conversationId && req.query.conversationId.trim()) || null
        const keep = req.query.keep === "true" || req.query.keep === "1"
        try {
            const out = await askSakana(prompt.trim(), { thinking, search, sessionOverride, fileUrls, conversationId, keep })
            const body = { ok: true, answer: out.answer, reasoning: out.reasoning, sources: out.sources, interrupted: out.interrupted }
            if (keep || conversationId) {
                body.conversationId = out.conversationId
                body.messageId = out.messageId
                body.session = out.session
            }
            res.json(body)
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
