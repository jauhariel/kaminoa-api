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

async function createConversation() {
    const { data } = await axios.post(
        "https://copilot.microsoft.com/c/api/conversations",
        null,
        { headers: HEADERS }
    )
    return data.id
}

function chat(message, conversationId, model = "default") {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(
            "wss://copilot.microsoft.com/c/api/chat?api-version=2&features=-,ncedge,edgepagecontext&setflight=-,ncedge,edgepagecontext&ncedge=1",
            { headers: HEADERS }
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
                                conversationId: { type: "string" }
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
        const { prompt, model = "default" } = req.query
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }
        if (!MODELS[model]) {
            return res.status(400).json({ ok: false, error: `model tidak valid, pilih: ${Object.keys(MODELS).join(", ")}` })
        }
        try {
            const conversationId = await createConversation()
            const result = await chat(prompt.trim(), conversationId, model)
            res.json({ ok: true, text: result.text, citations: result.citations, model, conversationId })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
