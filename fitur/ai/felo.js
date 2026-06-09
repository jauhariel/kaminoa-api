import https from "https"
import crypto from "crypto"

const BASE_URL = "https://felo.ai"
const ACCOUNT_URL = "https://account.felo.ai"

function sseRequest(urlPath, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body)
        const url = new URL(urlPath, BASE_URL)
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "Content-Length": Buffer.byteLength(data),
                "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137.0.0.0 Mobile Safari/537.36",
                "Referer": `${BASE_URL}/`,
                "Origin": BASE_URL,
                ...extraHeaders,
            },
            timeout: 60000,
        }, res => {
            if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`))
            resolve(res)
        })
        req.on("error", reject)
        req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")) })
        req.write(data)
        req.end()
    })
}

async function feloSearch(query, { lang = "id", mode = "concise" } = {}) {
    const visitor = crypto.randomUUID()
    const stream = await sseRequest("/api/search/threads", {
        query,
        search_uuid: crypto.randomUUID(),
        visitor,
        lang: "",
        agent_lang: lang,
        search_options: { langcode: lang },
        search_video: true,
        mode,
    }, { Cookie: `visitor=${visitor}` })

    return new Promise((resolve, reject) => {
        let buf = "", answer = "", prev = ""
        let sources = []

        function processLine(line) {
            if (!line.startsWith("data:")) return
            const raw = line.slice(5).trim()
            if (!raw || raw === "[DONE]") return
            try {
                const ev = JSON.parse(raw)
                if (ev?.type === "answer" && ev?.data?.text) {
                    answer = ev.data.text
                    prev = answer
                }
                if (ev?.type === "search_result" && Array.isArray(ev?.data?.results)) {
                    sources = ev.data.results.map(r => ({ title: r.title, url: r.url }))
                }
            } catch {}
        }

        stream.on("data", chunk => {
            buf += chunk.toString("utf8")
            const lines = buf.split("\n")
            buf = lines.pop()
            for (const line of lines) processLine(line.trim())
        })
        stream.on("end", () => {
            if (buf.trim()) processLine(buf.trim())
            resolve({ answer, sources })
        })
        stream.on("error", reject)
    })
}

const LANGS = ["id", "en", "ja", "zh", "ko", "fr", "de", "es"]
const MODES = ["concise", "detail"]

export default {
    route: {
        method: "get",
        path: "/ai/felo",
        auth: false,
        tags: ["AI"],
        summary: "Felo AI Search",
        description: "Cari dan tanya jawab menggunakan Felo AI.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: true,
                description: "Pertanyaan atau query pencarian",
                schema: { type: "string", example: "siapa presiden indonesia sekarang?" }
            },
            {
                name: "lang",
                in: "query",
                required: false,
                description: "Bahasa jawaban",
                schema: { type: "string", enum: LANGS, default: "id" }
            },
            {
                name: "mode",
                in: "query",
                required: false,
                description: "Mode jawaban",
                schema: { type: "string", enum: MODES, default: "concise" }
            }
        ],
        responses: {
            "200": {
                description: "Berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                answer: { type: "string" },
                                sources: { type: "array" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal memproses permintaan" }
        }
    },

    handler: async (req, res) => {
        const { query, lang = "id", mode = "concise" } = req.query
        if (!query?.trim()) return res.status(400).json({ ok: false, error: "query wajib diisi" })
        if (!LANGS.includes(lang)) return res.status(400).json({ ok: false, error: `lang tidak valid, pilih: ${LANGS.join(", ")}` })
        if (!MODES.includes(mode)) return res.status(400).json({ ok: false, error: `mode tidak valid, pilih: ${MODES.join(", ")}` })
        try {
            const result = await feloSearch(query.trim(), { lang, mode })
            res.json({ ok: true, ...result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
