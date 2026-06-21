import WebSocket from "ws"
import axios from "axios"

const HEADERS = {
    origin: "https://copilot.microsoft.com",
    "user-agent": "Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36"
}

const MODELS = {
    default: "chat",
    "think-deeper": "reasoning",
    "gpt-5": "smart"
}

// Copilot mengikat history percakapan ke cookies sesi (bukan ke conversationId saja),
// jadi keduanya harus dibawa bareng untuk melanjutkan chat sebelumnya.
function encodeSession(conversationId, cookies) {
    return Buffer.from(JSON.stringify({ c: conversationId, k: cookies })).toString("base64url")
}

function decodeSession(session) {
    try {
        const { c, k } = JSON.parse(Buffer.from(session, "base64url").toString("utf8"))
        if (c && typeof c === "string") return { conversationId: c, cookies: typeof k === "string" ? k : "" }
    } catch {}
    return null
}

async function createConversation() {
    const res = await axios.post(
        "https://copilot.microsoft.com/c/api/conversations",
        null,
        { headers: HEADERS }
    )
    const cookies = (res.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ")
    return { conversationId: res.data.id, cookies }
}

function chat(message, conversationId, model = "default", cookies = "") {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(
            "wss://copilot.microsoft.com/c/api/chat?api-version=2&features=-,ncedge,edgepagecontext&setflight=-,ncedge,edgepagecontext&ncedge=1",
            { headers: cookies ? { ...HEADERS, cookie: cookies } : HEADERS }
        )

        const response = { text: "", citations: [] }

        ws.on("open", () => {
            ws.send(JSON.stringify({
                event: "setOptions",
                supportedFeatures: ["partial-generated-images"],
                supportedCards: ["weather", "local", "image", "sports", "video", "ads", "safetyHelpline", "quiz", "finance", "recipe"],
                ads: { supportedTypes: ["text", "product", "multimedia", "tourActivity", "propertyPromotion"] }
            }))

            ws.send(JSON.stringify({
                event: "send",
                mode: MODELS[model],
                conversationId,
                content: [{ type: "text", text: message }],
                context: {}
            }))
        })

        ws.on("message", (chunk) => {
            try {
                const parsed = JSON.parse(chunk.toString())
                switch (parsed.event) {
                    case "appendText":
                        response.text += parsed.text || ""
                        break
                    case "citation":
                        response.citations.push({
                            title: parsed.title,
                            icon: parsed.iconUrl,
                            url: parsed.url
                        })
                        break
                    case "done":
                        resolve(response)
                        ws.close()
                        break
                    case "error":
                        reject(new Error(parsed.message))
                        ws.close()
                        break
                }
            } catch (e) {
                reject(e)
            }
        })

        ws.on("error", reject)
    })
}

export default {
    route: {
        method: "get",
        path: "/ai/copilot",
        auth: false,
        tags: ["AI"],
        summary: "Chat dengan Microsoft Copilot",
        description: "Kirim pesan ke Microsoft Copilot dan dapatkan respons teks beserta sumber referensi.",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Pesan atau pertanyaan yang dikirim ke Copilot",
                schema: { type: "string", example: "Siapa itu Elon Musk?" }
            },
            {
                name: "model",
                in: "query",
                required: false,
                description: "Model Copilot yang digunakan",
                schema: { type: "string", enum: ["default", "think-deeper", "gpt-5"], default: "default" }
            },
            {
                name: "session",
                in: "query",
                required: false,
                description: "Token sesi dari respons sebelumnya untuk melanjutkan percakapan. Kosongkan untuk memulai chat baru.",
                schema: { type: "string" }
            },
            {
                name: "system",
                in: "query",
                required: false,
                description: "Instruksi sistem / persona untuk mengatur peran AI (mis. 'kamu adalah bajak laut'). Copilot tidak punya role system asli, jadi instruksi di-prepend ke pesan. Cukup dikirim di turn pertama; persona menempel di percakapan saat memakai session.",
                schema: { type: "string", example: "Kamu adalah asisten yang ramah dan selalu menjawab singkat." }
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
                                text: { type: "string" },
                                citations: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            title: { type: "string" },
                                            icon: { type: "string" },
                                            url: { type: "string" }
                                        }
                                    }
                                },
                                model: { type: "string" },
                                conversationId: { type: "string" },
                                session: { type: "string", description: "Kirim balik nilai ini di parameter 'session' untuk melanjutkan percakapan" }
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
        const { prompt, model = "default", session, system } = req.query
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }
        if (!MODELS[model]) {
            return res.status(400).json({ ok: false, error: `model tidak valid, pilih: ${Object.keys(MODELS).join(", ")}` })
        }

        let conversationId, cookies
        if (session) {
            const decoded = decodeSession(session)
            if (!decoded) {
                return res.status(400).json({ ok: false, error: "session tidak valid atau rusak" })
            }
            ({ conversationId, cookies } = decoded)
        } else {
            try {
                ({ conversationId, cookies } = await createConversation())
            } catch (e) {
                return res.status(500).json({ ok: false, error: `gagal membuat percakapan: ${e.message}` })
            }
        }

        const message = system?.trim()
            ? `### Instruksi sistem (patuhi sepanjang percakapan):\n${system.trim()}\n\n### Pesan user:\n${prompt.trim()}`
            : prompt.trim()

        try {
            const result = await chat(message, conversationId, model, cookies)
            res.json({
                ok: true,
                text: result.text,
                citations: result.citations,
                model,
                conversationId,
                session: encodeSession(conversationId, cookies)
            })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
