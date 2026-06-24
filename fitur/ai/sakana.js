const BASE = "https://chat.sakana.ai"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const AGENT_ID = "namazu"

// Session anonim diambil dari cookie `sakana-chat` browser (chat tanpa login).
// chat.sakana.ai memakai Firebase App Check (reCAPTCHA Enterprise) untuk
// mengesahkan session baru, jadi session TIDAK bisa dibuat headless — wajib
// pakai cookie dari browser. Urutan sumber: query ?session= → env → default.
const DEFAULT_SESSION = process.env.SAKANA_SESSION || "306cdee7-bf95-42f0-b07b-6f9509436c37"

function baseHeaders(session) {
    return {
        "User-Agent": UA,
        "Origin": BASE,
        "Referer": `${BASE}/`,
        "Cookie": `sakana-chat=${session}`
    }
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
        if (res.status === 401) throw new Error("Session tidak valid / kedaluwarsa — perbarui cookie sakana-chat dari browser")
        throw new Error(msg || `Gagal membuat percakapan (HTTP ${res.status})`)
    }
    return res.json()
}

// Kirim pesan & baca stream NDJSON. Tiap baris = satu JSON message-update.
async function streamMessage(conversationId, prompt, { thinking, search, session, systemMessageId }) {
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

    const res = await fetch(`${BASE}/conversation/${conversationId}`, {
        method: "POST",
        headers: { ...baseHeaders(session), "Referer": `${BASE}/c/${conversationId}` },
        body: form
    })
    if (!res.ok) {
        const msg = await res.json().then(d => d.message).catch(() => null)
        if (res.status === 403) throw new Error(msg || "Input ditolak (dianggap tidak aman)")
        throw new Error(msg || `Gagal mengirim pesan (HTTP ${res.status})`)
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

async function askSakana(prompt, { thinking = false, search = false, session = DEFAULT_SESSION } = {}) {
    const { conversationId, systemMessageId } = await createConversation(prompt, { thinking, search, session })
    try {
        const out = await streamMessage(conversationId, prompt, { thinking, search, session, systemMessageId })
        return { ...out, conversationId }
    } finally {
        cleanup(conversationId, session)
    }
}

export default {
    route: {
        method: "get",
        path: "/ai/sakana",
        auth: false,
        tags: ["AI"],
        summary: "Chat dengan Sakana AI (Namazu)",
        description: "Kirim pesan ke model Namazu lewat chat.sakana.ai tanpa login. Mendukung mode berpikir (thinking) dan pencarian web. Membutuhkan cookie session `sakana-chat` dari browser — bisa diatur lewat parameter `session`, env `SAKANA_SESSION`, atau memakai default bawaan.",
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
                description: "Aktifkan mode berpikir mendalam (reasoning)",
                schema: { type: "boolean", default: false }
            },
            {
                name: "search",
                in: "query",
                required: false,
                description: "Aktifkan pencarian web",
                schema: { type: "boolean", default: false }
            },
            {
                name: "session",
                in: "query",
                required: false,
                description: "Override cookie session `sakana-chat` dari browser (opsional)",
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
        const session = (req.query.session && req.query.session.trim()) || DEFAULT_SESSION
        try {
            const { answer, reasoning, sources, interrupted } = await askSakana(prompt.trim(), { thinking, search, session })
            res.json({ ok: true, answer, reasoning, sources, interrupted })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
