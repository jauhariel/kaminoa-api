import axios from "axios"
import * as cheerio from "cheerio"

const PAGE_URL = "https://chat-deep.ai/deepseek-chat/"
const CHAT_URL = "https://chat-deep.ai/wp-json/dsc/v1/chat"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// Ambil WP-Nonce fresh tiap request (aman buat konkurensi)
async function getNonce() {
    const { data: html, status } = await axios.get(PAGE_URL, {
        headers: {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,id;q=0.8"
        },
        validateStatus: () => true
    })
    if (status !== 200) throw new Error(`Gagal nembus halaman utama (HTTP ${status})`)

    const $ = cheerio.load(html)
    const configStr = $("script.dsc-config").html()
    if (configStr) {
        try {
            const nonce = JSON.parse(configStr).nonce
            if (nonce) return nonce
        } catch {}
    }
    const m = String(html).match(/"nonce"\s*:\s*"([a-zA-Z0-9]+)"/i)
    if (m) return m[1]

    throw new Error("Gagal mengambil WP-Nonce (anti-bot atau struktur halaman berubah)")
}

async function chatDeep(prompt, { thinking = false } = {}) {
    const nonce = await getNonce()

    const { data, status } = await axios.post(CHAT_URL, {
        messages: [
            { role: "user", content: prompt },
            { role: "assistant", content: "" }
        ],
        model: "deepseek-v4-flash",
        thinking
    }, {
        headers: {
            "User-Agent": UA,
            "X-WP-Nonce": nonce,
            "Origin": "https://chat-deep.ai",
            "Referer": PAGE_URL,
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        },
        validateStatus: () => true
    })
    if (status !== 200) throw new Error(`Gagal menghubungi AI (HTTP ${status})`)

    let answer = ""
    let reasoning = ""
    for (const chunk of String(data).split("\n")) {
        const line = chunk.trim()
        if (!line.startsWith("data:") || line.includes("[DONE]")) continue
        try {
            const delta = JSON.parse(line.slice(5).trim())?.choices?.[0]?.delta
            if (delta?.content) answer += delta.content
            if (delta?.reasoning_content) reasoning += delta.reasoning_content
        } catch {}
    }

    return { answer: answer.trim(), reasoning: reasoning.trim() }
}

export default {
    route: {
        method: "get",
        path: "/ai/chatdeep",
        auth: false,
        tags: ["AI"],
        summary: "Chat dengan DeepSeek (chat-deep.ai)",
        description: "Kirim pesan ke model DeepSeek lewat chat-deep.ai tanpa login. Mengembalikan jawaban beserta proses berpikir (reasoning).",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Pesan atau pertanyaan yang dikirim ke DeepSeek",
                schema: { type: "string", example: "Apa itu lubang hitam?" }
            },
            {
                name: "thinking",
                in: "query",
                required: false,
                description: "Aktifkan mode berpikir mendalam",
                schema: { type: "boolean", default: false }
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
                                reasoning: { type: "string" }
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
        try {
            const { answer, reasoning } = await chatDeep(prompt.trim(), { thinking })
            res.json({ ok: true, answer, reasoning })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
