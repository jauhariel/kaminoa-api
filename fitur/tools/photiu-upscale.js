import { upload } from "../../lib/uploader.js"

const PHOTIU_API = "https://www.photiu.ai/api/tools/img_improve"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

/**
 * Upscale / enhance gambar via photiu.ai
 * @param {string} imageUrl - URL gambar publik
 * @param {"upscale"|"enhance"} [mode="upscale"] - mode pemrosesan
 * @param {"default"|"medium"|"high"} [level="default"] - level kualitas
 * @returns {Promise<Buffer>} buffer hasil proses
 */
async function imgImprove(imageUrl, mode = "upscale", level = "default") {
    // 1. Download input image
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Gagal mengunduh gambar (HTTP ${imgRes.status})`)
    const mime = imgRes.headers.get("content-type") || "image/jpeg"
    if (!/^image\//i.test(mime)) throw new Error(`URL bukan gambar (content-type: ${mime})`)

    const input = Buffer.from(await imgRes.arrayBuffer())
    const ext = mime.split("/")[1] || "jpg"
    const filename = `image.${ext}`

    // 2. Kirim ke photiu.ai
    const form = new FormData()
    form.append("upfile", new Blob([input], { type: mime }), filename)

    const res = await fetch(PHOTIU_API, {
        method: "POST",
        headers: {
            "origin": "https://www.photiu.ai",
            "referer": "https://www.photiu.ai/image-upscaler",
            "user-agent": UA,
            "x-paramsjs": JSON.stringify({ mode, level }),
        },
        body: form,
    })

    if (!res.ok) throw new Error(`photiu.ai error (HTTP ${res.status})`)
    return Buffer.from(await res.arrayBuffer())
}

export default {
    route: {
        method: "get",
        path: "/tools/photiu/upscale",
        auth: false,
        tags: ["Tools"],
        summary: "Photiu AI Image Upscaler — perbesar/pertajam gambar",
        description: "Perbesar dan pertajam gambar menggunakan Photiu AI. Mode: upscale (perbesar), enhance (pertajam).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar publik yang akan diproses",
                schema: { type: "string", example: "https://example.com/photo.jpg" },
            },
            {
                name: "mode",
                in: "query",
                required: false,
                description: "Mode pemrosesan",
                schema: { type: "string", enum: ["upscale", "enhance"], default: "upscale" },
            },
            {
                name: "level",
                in: "query",
                required: false,
                description: "Level kualitas hasil",
                schema: { type: "string", enum: ["default", "medium", "high"], default: "default" },
            },
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
                                url: { type: "string", description: "URL hasil upscale" },
                                provider: { type: "string", description: "Provider upload file" },
                                mode: { type: "string" },
                                level: { type: "string" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal memproses gambar" },
        },
    },

    handler: async (req, res) => {
        const imageUrl = req.query.url?.trim()
        if (!imageUrl) return res.status(400).json({ ok: false, error: "Parameter 'url' wajib diisi" })

        const mode = ["upscale", "enhance"].includes(req.query.mode) ? req.query.mode : "upscale"
        const level = ["default", "medium", "high"].includes(req.query.level) ? req.query.level : "default"

        try {
            const result = await imgImprove(imageUrl, mode, level)
            const { url, provider } = await upload(result, `photiu_${Date.now()}.jpg`)
            res.json({ ok: true, url, provider, mode, level })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
