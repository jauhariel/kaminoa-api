import axios from "axios"
import crypto from "crypto"
import { upload } from "../../lib/uploader.js"

// Image Upscaler via image-upscaling.net
// Hasil (gambar WebP) di-stream apa adanya langsung ke client.
const BASE_URL = "https://image-upscaling.net"

const SCALES = ["2", "4", "6"]
const MODELS = ["general", "anime", "digital", "plus"]

function generateClientId() {
    return crypto.randomBytes(16).toString("hex")
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms))
}

async function uploadImage(buffer, filename, clientId, scale, model, useFaceEnhance) {
    const form = new FormData()
    form.append("scale", String(scale))
    form.append("model", model)
    form.append("use_webp", "true")
    form.append("prompt", "")
    if (useFaceEnhance) form.append("fx", "")
    form.append("image", new Blob([buffer]), filename)

    const r = await fetch(`${BASE_URL}/upscaling_upload`, {
        method: "POST",
        headers: { Cookie: `client_id=${clientId}` },
        body: form,
    })
    if (!r.ok) throw new Error(`Upload gagal: HTTP ${r.status}`)
    const data = await r.text().catch(() => "")
    let filenameOut = data
    try {
        const j = JSON.parse(data)
        filenameOut = j.original_filename || j.filename || data
    } catch {}
    if (!filenameOut || typeof filenameOut !== "string") {
        throw new Error("Upload gagal: server tidak mengembalikan filename")
    }
    return filenameOut
}

async function getStatus(clientId) {
    const r = await fetch(`${BASE_URL}/upscaling_get_status_v2`, {
        headers: { Cookie: `client_id=${clientId}` },
    })
    if (!r.ok) throw new Error(`Get status gagal: HTTP ${r.status}`)
    return r.json()
}

async function pollResult(clientId, originalFilename, interval = 2000, timeout = 90000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
        const list = await getStatus(clientId)
        if (Array.isArray(list)) {
            const item =
                list.find((x) => x.original_filename === originalFilename || x.filename === originalFilename) ||
                (list.length === 1 ? list[0] : null)
            if (item && item.completed && item.image_url) {
                return `${item.image_url}?client_id=${clientId}&delete_after_download=`
            }
        }
        await sleep(interval)
    }
    throw new Error("Timeout: gambar belum selesai di-upscale")
}

async function upscaleImageFromUrl(imageUrl, options = {}) {
    const { scale = 4, model = "general", useFaceEnhance = false } = options
    const clientId = generateClientId()

    // download source image
    const r = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 })
    const buffer = Buffer.from(r.data)
    const ct = r.headers["content-type"] || ""
    const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg"
    const filename = `input${ext}`

    const originalFilename = await uploadImage(buffer, filename, clientId, scale, model, useFaceEnhance)
    const downloadUrl = await pollResult(clientId, originalFilename)

    // fetch raw result apa adanya
    const out = await fetch(downloadUrl)
    if (!out.ok) throw new Error(`Gagal mengunduh hasil: HTTP ${out.status}`)
    const outBuffer = Buffer.from(await out.arrayBuffer())
    return {
        buffer: outBuffer,
        contentType: out.headers.get("content-type") || "image/webp",
        originalFilename,
        clientId,
        downloadUrl,
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/imageupscaling",
        auth: false,
        tags: ["Tools"],
        summary: "Upscale gambar via image-upscaling.net",
        description:
            "Memperbesar resolusi gambar (upscale) menggunakan image-upscaling.net. Menerima URL gambar, mengembalikan hasil upscale apa adanya langsung sebagai gambar (default WebP). Mendukung skala 2/4/6 dan model general/anime/digital/plus (remini-like dengan face enhance).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar yang akan di-upscale",
                schema: { type: "string", example: "https://picsum.photos/200/200.jpg" },
            },
            {
                name: "scale",
                in: "query",
                required: false,
                description: "Faktor pembesaran: 2, 4 (default), atau 6",
                schema: { type: "string", enum: SCALES, default: "4" },
            },
            {
                name: "model",
                in: "query",
                required: false,
                description: "Model: general (default), anime, digital, atau plus (remini-like)",
                schema: { type: "string", enum: MODELS, default: "general" },
            },
            {
                name: "face_enhance",
                in: "query",
                required: false,
                description: "Aktifkan face enhancement (hanya untuk model plus/remini-like). Set 'true' untuk aktif.",
                schema: { type: "string", enum: ["true", "false"], default: "false" },
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
                                url: { type: "string" },
                                provider: { type: "string" },
                                scale: { type: "string", example: "4" },
                                model: { type: "string", example: "general" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal memproses gambar" },
        },
    },

    handler: async (req, res) => {
        const { url, scale = "4", model = "general", face_enhance } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL gambar tidak valid" })
        }
        if (!SCALES.includes(String(scale))) {
            return res.status(400).json({ ok: false, error: `scale tidak valid, pilih: ${SCALES.join(", ")}` })
        }
        if (!MODELS.includes(model)) {
            return res.status(400).json({ ok: false, error: `model tidak valid, pilih: ${MODELS.join(", ")}` })
        }
        const useFaceEnhance = face_enhance === "true" || face_enhance === "1"
        try {
            const result = await upscaleImageFromUrl(url, { scale: Number(scale), model, useFaceEnhance })
            const filename = (result.originalFilename || "upscaled").replace(/\.[^.]+$/, "") + ".webp"
            const { url: hostedUrl, provider } = await upload(result.buffer, filename)
            return res.json({ ok: true, url: hostedUrl, provider, scale: String(scale), model })
        } catch (e) {
            const status = e.response && e.response.status >= 400 && e.response.status < 500 ? 400 : 500
            return res.status(status).json({ ok: false, error: e.message })
        }
    },
}
