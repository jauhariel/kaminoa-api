import crypto from "crypto"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const HEADERS = { "user-agent": UA, "content-type": "application/json", origin: "https://y2mate.net.co", referer: "https://y2mate.net.co/" }
// Key AES-128-CBC milik savetube.vip (di-deobfuscate dari bundle frontend)
const KEY = Buffer.from("C5D58EF67A7584E4A29F6C35BBC4EB12", "hex")

function decryptInfo(b64) {
    const raw = Buffer.from(b64, "base64")
    const iv = raw.subarray(0, 16)
    const data = raw.subarray(16)
    const decipher = crypto.createDecipheriv("aes-128-cbc", KEY, iv)
    const out = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(out.toString("utf8"))
}

async function getRandomCdn() {
    const r = await fetch("https://media.savetube.vip/api/random-cdn", { headers: { "user-agent": UA } })
    if (!r.ok) throw new Error("Gagal mengambil CDN savetube")
    const j = await r.json()
    return j.cdn
}

async function getInfo(cdn, url) {
    const r = await fetch(`https://${cdn}/v2/info`, { method: "POST", headers: HEADERS, body: JSON.stringify({ url }) })
    const j = await r.json().catch(() => ({}))
    if (!j.status || typeof j.data !== "string") {
        throw new Error(j.message || "Gagal mengambil info video")
    }
    return decryptInfo(j.data)
}

async function getDownloadUrl(cdn, key, quality, downloadType) {
    const r = await fetch(`https://${cdn}/download`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ downloadType, quality, key }),
    })
    const j = await r.json().catch(() => ({}))
    if (!j.status || !j.data?.downloadUrl) throw new Error(j.message || "Gagal membuat link unduhan")
    return j.data.downloadUrl
}

async function savetube(url, type, quality) {
    const cdn = await getRandomCdn()
    const info = await getInfo(cdn, url)
    const videoFormats = (info.video_formats || []).map(f => String(f.height)).filter(Boolean)
    const audioFormats = (info.audio_formats || []).map(f => String(f.quality || f.abr || "128")).filter(Boolean)

    let downloadUrl, finalQuality
    if (type === "audio") {
        finalQuality = quality || audioFormats[0] || "128"
        downloadUrl = await getDownloadUrl(cdn, info.key, finalQuality, "audio")
    } else {
        const fmts = info.video_formats || []
        let chosen = quality ? fmts.find(f => String(f.height) === String(quality)) : null
        if (quality && !chosen) {
            const err = new Error(`Kualitas ${quality} tidak tersedia. Pilihan: ${videoFormats.join(", ")}`)
            err.code = 400
            throw err
        }
        // default: 720p -> kualitas bawaan situs -> format pertama
        chosen = chosen || fmts.find(f => String(f.height) === "720") || fmts.find(f => f.default_selected) || fmts[0]
        if (!chosen) throw new Error("Tidak ada format video tersedia")
        finalQuality = String(chosen.height)
        downloadUrl = await getDownloadUrl(cdn, info.key, finalQuality, "video")
    }

    return {
        title: info.title || null,
        duration: info.durationLabel || info.duration || null,
        thumbnail: info.thumbnail || null,
        type,
        quality: finalQuality,
        downloadUrl,
        availableFormats: { video: videoFormats, audio: audioFormats },
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/savetube",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube via savetube",
        description: "Mengunduh video/audio YouTube menggunakan API savetube.vip. Mendukung format video (mp4) berbagai resolusi dan audio (mp3 128kbps).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL YouTube yang ingin diunduh",
                schema: { type: "string", example: "https://youtu.be/dQw4w9WgXcQ" },
            },
            {
                name: "type",
                in: "query",
                required: false,
                description: "Jenis unduhan: video (default) atau audio",
                schema: { type: "string", enum: ["video", "audio"], default: "video" },
            },
            {
                name: "quality",
                in: "query",
                required: false,
                description: "Kualitas. Video: 144, 240, 360, 480, 720, 1080, dst. Audio: 128. Default: kualitas video bawaan / 128 untuk audio.",
                schema: { type: "string", example: "720" },
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
                                result: {
                                    type: "object",
                                    properties: {
                                        title: { type: "string" },
                                        duration: { type: "string" },
                                        thumbnail: { type: "string" },
                                        type: { type: "string" },
                                        quality: { type: "string" },
                                        downloadUrl: { type: "string" },
                                        availableFormats: { type: "object" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url, type = "video", quality = null } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        if (!["video", "audio"].includes(type)) {
            return res.status(400).json({ ok: false, error: "type harus video atau audio" })
        }
        try {
            const result = await savetube(url, type, quality || null)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: e.message })
        }
    },
}
