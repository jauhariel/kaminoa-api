import axios from "axios"
import https from "https"

const HEADERS = {
    Origin: "https://zonerai.com",
    Referer: "https://zonerai.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "X-Client-Platform": "web",
}

const agent = new https.Agent({ rejectUnauthorized: false })

async function img2txt(buffer) {
    const form = new FormData()
    form.append("Image", new File([new Blob([buffer], { type: "image/jpeg" })], "image.jpg", { type: "image/jpeg" }))
    form.append("Language", "eng_Latn")

    const { data } = await axios.post("https://api.zonerai.com/zoner-ai/img2txt", form, {
        headers: HEADERS,
        httpsAgent: agent,
    })
    return data
}

export default {
    route: {
        method: "get",
        path: "/tools/zoneai/img2txt",
        auth: false,
        tags: ["Tools"],
        summary: "ZoneAI Image to Text",
        description: "Ekstrak atau deskripsikan teks dari gambar menggunakan ZoneAI.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar yang akan diproses",
                schema: { type: "string", example: "https://example.com/image.jpg" }
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
                                result: { type: "string" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal memproses gambar" }
        }
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url?.trim()) return res.status(400).json({ ok: false, error: "url wajib diisi" })
        try {
            const r = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 })
            const result = await img2txt(Buffer.from(r.data))
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
