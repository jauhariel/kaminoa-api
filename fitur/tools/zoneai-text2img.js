import axios from "axios"
import https from "https"
import { upload } from "../../lib/uploader.js"

const SIZES = ["1216x832","1152x896","1344x768","1563x640","832x1216","896x1152","768x1344","640x1536","1024x1024"]

const HEADERS = {
    Origin: "https://zonerai.com",
    Referer: "https://zonerai.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "X-Client-Platform": "web",
}

const agent = new https.Agent({ rejectUnauthorized: false })

async function text2img(prompt, imageBuffer = null, size = "1024x1024", upscale = 0) {
    const form = new FormData()
    if (imageBuffer) {
        form.append("Image", new File([new Blob([imageBuffer], { type: "image/jpeg" })], "image.jpg", { type: "image/jpeg" }))
    }
    form.append("Prompt", prompt)
    form.append("Size", size)
    form.append("Upscale", upscale)
    form.append("Language", "eng_Latn")
    form.append("Batch_Index", 0)

    const { data } = await axios.post("https://api.zonerai.com/zoner-ai/txt2img", form, {
        headers: HEADERS,
        responseType: "arraybuffer",
        httpsAgent: agent,
    })
    return Buffer.from(data)
}

export default {
    route: {
        method: "get",
        path: "/tools/zoneai/text2img",
        auth: false,
        tags: ["Tools"],
        summary: "ZoneAI Text to Image",
        description: "Generate gambar dari teks menggunakan ZoneAI.",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Teks deskripsi gambar",
                schema: { type: "string", example: "anime maid girl with red hair glasses" }
            },
            {
                name: "size",
                in: "query",
                required: false,
                description: "Ukuran gambar output",
                schema: { type: "string", enum: SIZES, default: "1024x1024" }
            },
            {
                name: "upscale",
                in: "query",
                required: false,
                description: "Level upscale (0-2)",
                schema: { type: "integer", minimum: 0, maximum: 2, default: 0 }
            },
            {
                name: "image_url",
                in: "query",
                required: false,
                description: "URL gambar referensi untuk img2img (opsional)",
                schema: { type: "string" }
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
                                url: { type: "string" },
                                provider: { type: "string" },
                                size: { type: "string" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal generate gambar" }
        }
    },

    handler: async (req, res) => {
        const { prompt, size = "1024x1024", upscale = "0", image_url } = req.query
        if (!prompt?.trim()) return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        if (!SIZES.includes(size)) return res.status(400).json({ ok: false, error: `size tidak valid, pilih: ${SIZES.join(", ")}` })
        const upscaleNum = parseInt(upscale)
        if (isNaN(upscaleNum) || upscaleNum < 0 || upscaleNum > 2) return res.status(400).json({ ok: false, error: "upscale harus 0-2" })

        try {
            let refBuf = null
            if (image_url) {
                const r = await axios.get(image_url, { responseType: "arraybuffer", timeout: 30000 })
                refBuf = Buffer.from(r.data)
            }

            const imgBuf = await text2img(prompt.trim(), refBuf, size, upscaleNum)
            const { url, provider } = await upload(imgBuf)
            res.json({ ok: true, url, provider, size })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
