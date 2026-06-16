import https from "https"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://id-y2mate.com/y2dl"

// Profil format yang didukung backend y2dl (audio HQ termasuk FLAC/WAV/ALAC).
const AUDIO = {
    mp3: { format: "mp3", audioBitrate: "320", kind: "mp3" },
    "mp3-320": { format: "mp3", audioBitrate: "320", kind: "mp3" },
    "mp3-192": { format: "mp3", audioBitrate: "192", kind: "mp3" },
    "mp3-128": { format: "mp3", audioBitrate: "128", kind: "mp3" },
    "mp3-64": { format: "mp3", audioBitrate: "64", kind: "mp3" },
    m4a: { format: "m4a", audioBitrate: "best", kind: "m4a" },
    wav: { format: "wav", audioBitrate: "best", kind: "wav" },
    flac: { format: "flac", audioBitrate: "best", kind: "flac" },
    alac: { format: "alac", audioBitrate: "best", kind: "alac" },
    aac: { format: "aac", audioBitrate: "192", kind: "aac" },
    ogg: { format: "ogg", audioBitrate: "192", kind: "ogg" },
    opus: { format: "opus", audioBitrate: "192", kind: "opus" },
}
const VIDEO_QUALITIES = ["2160", "1440", "1080", "720", "480", "360"]

const sleep = ms => new Promise(r => setTimeout(r, ms))

function postJson(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data)
        const parsed = new URL(BASE + path)
        const req = https.request({
            hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "POST",
            headers: {
                "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
                "User-Agent": UA, Referer: "https://id-y2mate.com/", Origin: "https://id-y2mate.com", Accept: "application/json",
            },
        }, res => {
            let raw = ""
            res.on("data", c => raw += c)
            res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) } catch { resolve({ status: res.statusCode, body: raw }) } })
        })
        req.on("error", reject); req.write(body); req.end()
    })
}

function getJson(path) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(BASE + path)
        const req = https.request({
            hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "GET",
            headers: { "User-Agent": UA, Referer: "https://id-y2mate.com/", Accept: "application/json" },
        }, res => {
            let raw = ""
            res.on("data", c => raw += c)
            res.on("end", () => { try { resolve(JSON.parse(raw)) } catch { resolve(raw) } })
        })
        req.on("error", reject); req.end()
    })
}

async function y2hq(url, downloadMode, profile, videoQuality) {
    const payload = downloadMode === "video"
        ? { url, downloadMode: "video", format: "mp4", audioBitrate: "best", profile: { kind: "mp4" }, videoQuality }
        : { url, downloadMode: "audio", format: profile.format, audioBitrate: profile.audioBitrate, profile: { kind: profile.kind } }

    const { status, body } = await postJson("/download", payload)
    if (body?.error) {
        const err = new Error(body.detail || body.error)
        err.code = 400
        throw err
    }
    // hasil langsung
    if (body?.url) return body
    // antrian async -> poll progress
    const id = body?.jobId
    if (!id) throw new Error("Respon tidak terduga dari y2mate")
    for (let i = 0; i < 24; i++) {
        const p = await getJson(`/progress/${id}?wait=10&_=${Date.now()}`)
        if (p?.url) return p
        if (p?.status === "error" || p?.status === "failed") throw new Error(p.error || "Konversi gagal di server")
        await sleep(1500)
    }
    throw new Error("Timeout: konversi belum selesai")
}

export default {
    route: {
        method: "get",
        path: "/downloader/y2mate-hq",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube HQ (FLAC/WAV/ALAC/MP3-320 + video) via y2mate",
        description: "Mengunduh audio berkualitas tinggi (FLAC, WAV, ALAC, MP3 320kbps, M4A, AAC, OGG, Opus) atau video (hingga 4K) dari YouTube menggunakan backend y2dl id-y2mate.com.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL YouTube / YouTube Music",
                schema: { type: "string", example: "https://music.youtube.com/watch?v=qypYii_GXtk" },
            },
            {
                name: "format",
                in: "query",
                required: false,
                description: "Format audio: flac, wav, alac, mp3 (=320), mp3-192, mp3-128, mp3-64, m4a, aac, ogg, opus. Gunakan 'mp4' untuk video.",
                schema: { type: "string", default: "mp3", example: "flac" },
            },
            {
                name: "quality",
                in: "query",
                required: false,
                description: "Khusus video (format=mp4): 2160, 1440, 1080, 720, 480, 360. Default 1080.",
                schema: { type: "string", enum: VIDEO_QUALITIES, default: "1080" },
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
                                        format: { type: "string" },
                                        mode: { type: "string" },
                                        downloadUrl: { type: "string" },
                                        expiresAt: { type: "string" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter / URL tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url, format = "mp3", quality = "1080" } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        const fmt = String(format).toLowerCase()
        const isVideo = fmt === "mp4" || fmt === "video"
        if (!isVideo && !AUDIO[fmt]) {
            return res.status(400).json({ ok: false, error: `Format tidak valid. Pilihan audio: ${Object.keys(AUDIO).join(", ")}, atau mp4 untuk video` })
        }
        if (isVideo && !VIDEO_QUALITIES.includes(String(quality))) {
            return res.status(400).json({ ok: false, error: `Kualitas video tidak valid: ${VIDEO_QUALITIES.join(", ")}` })
        }
        try {
            const data = await y2hq(url, isVideo ? "video" : "audio", AUDIO[fmt], String(quality))
            res.json({
                ok: true,
                result: {
                    format: isVideo ? "mp4" : fmt,
                    mode: isVideo ? "video" : "audio",
                    downloadUrl: data.url,
                    expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
                },
            })
        } catch (e) {
            res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: e.message })
        }
    },
}
