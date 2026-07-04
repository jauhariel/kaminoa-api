import { upload } from "../../lib/uploader.js"

const VP_API = "https://ai-services.visual-paradigm.com/api/super-resolution/file"
const HEADERS = {
    origin: "https://online.visual-paradigm.com",
    referer: "https://online.visual-paradigm.com/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
}

export default {
    route: {
        method: "get",
        path: "/tools/visualparadigm",
        auth: false,
        tags: ["Tools"],
        summary: "Visual Paradigm — enhance & upscale foto pakai AI super-resolution (gratis, tanpa login)",
        description: "Tingkatkan resolusi foto via Visual Paradigm AI super-resolution. Hasil biasanya 10×-15× dari ukuran file asli. Kirim URL gambar publik, hasil dikembalikan sebagai URL.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar publik yang akan di-enhance",
                schema: { type: "string", example: "https://example.com/photo.jpg" },
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
                                result: { type: "string", description: "URL hasil enhance" },
                                provider: { type: "string", description: "File host yang dipakai" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak lengkap / URL tidak valid" },
            "500": { description: "Gagal memproses gambar" },
        },
    },

    handler: async (req, res) => {
        const imageUrl = req.query.url?.trim()
        if (!imageUrl) return res.status(400).json({ ok: false, error: "Parameter 'url' wajib diisi" })

        try {
            // Download gambar input
            const imgRes = await fetch(imageUrl)
            if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
            const mime = imgRes.headers.get("content-type") || ""
            if (mime && !/^image\//i.test(mime)) throw new Error(`URL bukan gambar (content-type: ${mime})`)
            const input = Buffer.from(await imgRes.arrayBuffer())

            // Kirim ke Visual Paradigm
            const form = new FormData()
            form.append("file", new Blob([input], { type: "image/jpeg" }), "image.jpg")

            const vpRes = await fetch(VP_API, {
                method: "POST",
                headers: HEADERS,
                body: form,
            })
            if (!vpRes.ok) {
                const txt = await vpRes.text().catch(() => "")
                throw new Error(`Visual Paradigm HTTP ${vpRes.status}: ${txt.slice(0, 200)}`)
            }
            const out = Buffer.from(await vpRes.arrayBuffer())

            // Upload hasil
            const { url, provider } = await upload(out, `visualparadigm_${Date.now()}.jpg`)

            res.json({ ok: true, result: url, provider })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
