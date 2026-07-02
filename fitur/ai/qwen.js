import * as qwen from "../../lib/qwen.js"

const MODELS_DESC = "qwen3.7-plus (default), qwen3.7-max, qwen3.6-plus, qwen3-vl-plus, qwen3-coder-plus, qwen3.5-plus, qwen3.5-omni-plus, dll."

export default {
    route: {
        method: "get",
        path: "/ai/qwen",
        auth: false,
        tags: ["AI"],
        summary: "Chat dengan Qwen Studio (Alibaba)",
        description:
            "Kirim pesan ke Qwen model lewat API Android Qwen Chat (chat.qwen.ai). " +
            "Mendukung: chat teks, vision (lampirkan gambar/video via URL), web search, thinking/reasoning, text-to-image, image-to-image, text-to-video. " +
            `Model: ${MODELS_DESC}`,
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Pesan atau pertanyaan dalam bahasa apa pun. Untuk t2i/t2v: deskripsi gambar/video yang diinginkan.",
                schema: { type: "string", example: "Jelaskan teori relativitas secara singkat" }
            },
            {
                name: "mode",
                in: "query",
                required: false,
                description: "Mode: `chat` (default, teks), `t2i` (text-to-image), `t2v` (text-to-video). t2i dengan fileUrl jadi image-to-image.",
                schema: { type: "string", enum: ["chat", "t2i", "t2v"], default: "chat" }
            },
            {
                name: "model",
                in: "query",
                required: false,
                description: `Model yang dipakai. ${MODELS_DESC}`,
                schema: { type: "string", default: "qwen3.7-plus", example: "qwen3.7-plus" }
            },
            {
                name: "thinking",
                in: "query",
                required: false,
                description: "Mode berpikir: `auto` (default, model decide), `fast` (tanpa thinking, respons cepat), `think` (thinking mendalam). Khusus mode chat.",
                schema: { type: "string", enum: ["auto", "fast", "think"], default: "auto" }
            },
            {
                name: "search",
                in: "query",
                required: false,
                description: "Aktifkan web search. Default true untuk chat.",
                schema: { type: "boolean", default: true }
            },
            {
                name: "stream",
                in: "query",
                required: false,
                description: "Streaming respons via SSE (Server-Sent Events). Default true.",
                schema: { type: "boolean", default: true }
            },
            {
                name: "size",
                in: "query",
                required: false,
                description: "Rasio aspek untuk t2i/t2v: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`. Default: t2i=1:1, t2v=16:9.",
                schema: { type: "string", default: "1:1", example: "16:9" }
            },
            {
                name: "fileUrl",
                in: "query",
                required: false,
                description: "URL file (gambar/video/dokumen) untuk analisis vision (mode chat) atau referensi (mode t2i image-to-image).",
                schema: { type: "string", example: "https://example.com/foto.jpg" }
            }
        ],
        responses: {
            "200": {
                description: "Respons berhasil (JSON untuk non-stream, SSE untuk stream)",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                answer: { type: "string", description: "Jawaban (mode chat)" },
                                thinking: { type: "string", description: "Hasil reasoning" },
                                searchResults: { type: "array", items: { type: "object" } },
                                url: { type: "string", description: "URL gambar/video (mode t2i/t2v)" },
                                width: { type: "number" },
                                height: { type: "number" },
                                model: { type: "string" },
                                type: { type: "string" }
                            }
                        }
                    },
                    "text/event-stream": {
                        schema: { type: "string", description: "SSE stream dengan phase: thinking_start, thinking, search_start, search_results, answer, done" }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server atau API upstream",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { prompt, model, size, fileUrl } = req.query

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }

        const mode = req.query.mode || "chat"
        const thinkingMode = ["fast", "auto", "think"].includes(req.query.thinking) ? req.query.thinking : "auto"
        const search = req.query.search !== "false" && req.query.search !== "0"
        const stream = req.query.stream !== "false" && req.query.stream !== "0"

        if (!["chat", "t2i", "t2v"].includes(mode)) {
            return res.status(400).json({ ok: false, error: "mode harus chat, t2i, atau t2v" })
        }

        const fileUrls = (fileUrl || "").split(",").map(s => s.trim()).filter(Boolean)

        try {
            const opts = {
                mode,
                model: model || "qwen3.7-plus",
                thinking: thinkingMode,
                search: mode === "chat" ? search : false,
                size: size || (mode === "t2v" ? "16:9" : "1:1"),
                fileUrls: mode !== "t2v" ? fileUrls : [],
                stream: stream && mode === "chat",
                res: stream && mode === "chat" ? res : undefined
            }

            const result = await qwen.ask(prompt.trim(), opts)

            if (result.type === "stream_done") {
                // SSE stream sudah ditangani — res sudah di-write
                return
            }

            const body = { ok: true }

            if (result.type === "chat") {
                body.answer = result.answer
                body.thinking = result.thinking || undefined
                body.searchResults = result.searchResults?.length > 0 ? result.searchResults : undefined
            } else if (result.type === "image") {
                body.type = "image"
                body.url = result.url
                body.width = result.width
                body.height = result.height
            } else if (result.type === "video") {
                body.type = "video"
                body.url = result.url
                body.task_id = result.task_id
            }

            body.model = opts.model
            res.json(body)

        } catch (e) {
            // Auto relogin + retry once on auth error
            if (e.message?.includes("401") || e.message?.includes("Unauthorized") || e.message?.includes("token")) {
                try {
                    qwen.expireToken()
                    const opts = {
                        mode, model: model || "qwen3.7-plus",
                        thinking: thinkingMode,
                        search: mode === "chat" ? search : false,
                        size: size || (mode === "t2v" ? "16:9" : "1:1"),
                        fileUrls: mode !== "t2v" ? fileUrls : [],
                        stream: false,
                        res: undefined
                    }
                    const retry = await qwen.ask(prompt.trim(), opts)
                    const body = { ok: true, model: opts.model }

                    if (retry.type === "chat") {
                        body.answer = retry.answer
                        body.thinking = retry.thinking || undefined
                        body.searchResults = retry.searchResults?.length > 0 ? retry.searchResults : undefined
                    } else if (retry.type === "image") {
                        body.type = "image"; body.url = retry.url; body.width = retry.width; body.height = retry.height
                    } else if (retry.type === "video") {
                        body.type = "video"; body.url = retry.url; body.task_id = retry.task_id
                    }
                    return res.json(body)
                } catch (retryErr) {
                    return res.status(500).json({ ok: false, error: retryErr.message })
                }
            }
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
