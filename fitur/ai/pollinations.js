import axios from "axios"

const API_URL = "https://text.pollinations.ai/openai"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// Tier gratis Pollinations efektif cuma expose GPT-OSS 20B; "openai" adalah alias yang masih jalan.
const MODELS = ["openai", "openai-fast"]

async function pollinations(prompt, { model = "openai", system } = {}) {
    const messages = []
    if (system) messages.push({ role: "system", content: system })
    messages.push({ role: "user", content: prompt })

    const { data, status } = await axios.post(API_URL, {
        model,
        messages,
        private: true,
        referrer: "kaminoa"
    }, {
        headers: {
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        timeout: 60000,
        validateStatus: () => true
    })

    if (status !== 200) {
        const msg = data?.error || (typeof data === "string" ? data.slice(0, 200) : `HTTP ${status}`)
        throw new Error(`Gagal menghubungi AI: ${msg}`)
    }

    const answer = data?.choices?.[0]?.message?.content
    if (!answer) throw new Error("AI mengembalikan respons kosong")
    return answer.trim()
}

export default {
    route: {
        method: "get",
        path: "/ai/pollinations",
        auth: false,
        tags: ["AI"],
        summary: "Chat AI gratis via Pollinations (GPT-OSS 20B)",
        description: "Kirim pesan ke model AI Pollinations tanpa login. Mendukung system prompt opsional.",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Pesan atau pertanyaan yang dikirim ke AI",
                schema: { type: "string", example: "Apa itu fotosintesis?" }
            },
            {
                name: "model",
                in: "query",
                required: false,
                description: "Model yang digunakan",
                schema: { type: "string", enum: MODELS, default: "openai" }
            },
            {
                name: "system",
                in: "query",
                required: false,
                description: "System prompt opsional untuk mengatur perilaku AI",
                schema: { type: "string", example: "Jawab dengan singkat dan santai." }
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
                                model: { type: "string" },
                                answer: { type: "string" }
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
        const { prompt, model = "openai", system } = req.query
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }
        if (!MODELS.includes(model)) {
            return res.status(400).json({ ok: false, error: `model tidak valid, pilih: ${MODELS.join(", ")}` })
        }
        try {
            const answer = await pollinations(prompt.trim(), { model, system: system?.trim() || undefined })
            res.json({ ok: true, model, answer })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
