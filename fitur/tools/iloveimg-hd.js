import axios from "axios"
import { upload } from "../../lib/uploader.js"

const SCALES = ["2", "4"]

const HEADERS = {
    Origin: "https://www.iloveimg.com",
    Referer: "https://www.iloveimg.com/",
}

async function getToken() {
    const html = await fetch("https://www.iloveimg.com/upscale-image").then(r => r.text())
    const token = html.match(/"token":"(eyJ[^"]+)"/)?.[1]
    const task = html.match(/ilovepdfConfig\.taskId\s*=\s*'([^']+)'/)?.[1]
    if (!token || !task) throw new Error("Gagal mengambil token/task dari iloveimg")
    return { token, task }
}

async function uploadImage(buffer, token, task) {
    const form = new FormData()
    form.append("name", "image.jpg")
    form.append("chunk", "0")
    form.append("chunks", "1")
    form.append("task", task)
    form.append("preview", "1")
    form.append("v", "web.0")
    form.append("file", new Blob([buffer], { type: "image/jpeg" }), "image.jpg")

    const r = await fetch("https://api29g.iloveimg.com/v1/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...HEADERS },
        body: form,
    })
    const json = await r.json().catch(() => ({}))
    if (!json.server_filename) throw new Error("Upload gagal: server_filename kosong")
    return json.server_filename
}

async function doUpscale(serverFilename, token, task, scale) {
    const form = new FormData()
    form.append("task", task)
    form.append("server_filename", serverFilename)
    form.append("scale", scale)

    const r = await fetch("https://api29g.iloveimg.com/v1/upscale", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...HEADERS },
        body: form,
    })
    const buffer = Buffer.from(await r.arrayBuffer())
    // Respon sukses adalah gambar (JPEG). Kalau bukan, anggap error JSON/teks.
    if (buffer.subarray(0, 3).toString("hex") !== "ffd8ff") {
        throw new Error("Upscale gagal: " + buffer.toString("utf8").slice(0, 200))
    }
    return buffer
}

async function upscale(buffer, scale) {
    const { token, task } = await getToken()
    const serverFilename = await uploadImage(buffer, token, task)
    return doUpscale(serverFilename, token, task, scale)
}

export default {
    route: {
        method: "get",
        path: "/tools/hd",
        auth: false,
        tags: ["Tools"],
        summary: "iLoveIMG Image Upscaler (HD)",
        description: "Memperbesar resolusi gambar (upscale) menggunakan iloveimg.com. Mendukung skala 2x dan 4x.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar yang akan diperbesar",
                schema: { type: "string", example: "https://picsum.photos/200/200.jpg" },
            },
            {
                name: "scale",
                in: "query",
                required: false,
                description: "Faktor pembesaran: 2x atau 4x (default 4)",
                schema: { type: "string", enum: SCALES, default: "4" },
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
                                scale: { type: "string" },
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
        const { url, scale = "4" } = req.query
        if (!url?.trim()) return res.status(400).json({ ok: false, error: "url wajib diisi" })
        if (!SCALES.includes(String(scale))) {
            return res.status(400).json({ ok: false, error: `scale tidak valid, pilih: ${SCALES.join(", ")}` })
        }
        try {
            const r = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 })
            const out = await upscale(Buffer.from(r.data), String(scale))
            const { url: hostedUrl, provider } = await upload(out)
            res.json({ ok: true, url: hostedUrl, provider, scale: String(scale) })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
