import axios from "axios"
import { upload } from "../../lib/uploader.js"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

// Generate QR: text/URL -> gambar PNG -> upload, balik URL
async function generateQR(text, size) {
    const px = Math.min(Math.max(parseInt(size, 10) || 300, 100), 1000)
    const { data } = await axios.get("https://api.qrserver.com/v1/create-qr-code/", {
        params: { size: `${px}x${px}`, data: text, margin: 10 },
        responseType: "arraybuffer",
        headers: { "User-Agent": UA },
        timeout: 15000
    })
    const buffer = Buffer.from(data)
    // pastikan PNG (magic bytes), bukan halaman error
    if (buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error("Gagal membuat QR (respons bukan gambar)")
    }
    const { url, provider } = await upload(buffer, `qr_${Date.now()}.png`)
    return { type: "generate", text, size: `${px}x${px}`, url, provider }
}

// Read QR: fetch gambar dari URL user, POST ke goqr read API, parse isinya
async function readQR(imageUrl) {
    let img
    try {
        const { data } = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            headers: { "User-Agent": UA },
            timeout: 15000,
            maxContentLength: 10 * 1024 * 1024
        })
        img = Buffer.from(data)
    } catch {
        const err = new Error("Gagal mengambil gambar dari URL")
        err.status = 400
        throw err
    }

    const form = new FormData()
    form.append("file", new Blob([img]), "qr.png")
    const { data } = await axios.post("https://api.qrserver.com/v1/read-qr-code/", form, {
        headers: { "User-Agent": UA },
        timeout: 15000
    })

    const content = data?.[0]?.symbol?.[0]?.data
    const error = data?.[0]?.symbol?.[0]?.error
    if (!content) {
        const err = new Error(error && error !== "null" ? `QR tidak terbaca: ${error}` : "Tidak ada QR code yang terdeteksi pada gambar")
        err.status = 404
        throw err
    }
    return { type: "read", url: imageUrl, content }
}

export default {
    route: {
        method: "get",
        path: "/tools/qrcode",
        auth: false,
        tags: ["Tools"],
        summary: "Generate & baca QR code",
        description: "Membuat QR code dari teks/URL (parameter 'text'), atau membaca isi QR code dari gambar (parameter 'url'). Generate menghasilkan URL gambar PNG.",
        parameters: [
            {
                name: "text",
                in: "query",
                required: false,
                description: "Teks/URL untuk dijadikan QR code (mode generate)",
                schema: { type: "string", example: "https://kaminoa.eu.cc" }
            },
            {
                name: "size",
                in: "query",
                required: false,
                description: "Ukuran QR dalam piksel (100-1000, default 300). Hanya untuk generate.",
                schema: { type: "integer", example: 300 }
            },
            {
                name: "url",
                in: "query",
                required: false,
                description: "URL gambar QR code untuk dibaca isinya (mode read)",
                schema: { type: "string", example: "https://example.com/qr.png" }
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
                                result: {
                                    type: "object",
                                    properties: {
                                        type: { type: "string", enum: ["generate", "read"] },
                                        text: { type: "string", example: "https://kaminoa.eu.cc" },
                                        size: { type: "string", example: "300x300" },
                                        url: { type: "string", example: "https://files.catbox.moe/abc123.png" },
                                        content: { type: "string", example: "https://kaminoa.eu.cc" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Parameter tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "QR tidak terbaca",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { text, size, url } = req.query

        if (!text?.trim() && !url?.trim()) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'text' untuk membuat QR, atau 'url' untuk membaca QR dari gambar" })
        }

        try {
            const result = url?.trim()
                ? await readQR(url.trim())
                : await generateQR(text.trim(), size)
            return res.json({ ok: true, result })
        } catch (e) {
            return res.status(e.status || e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
