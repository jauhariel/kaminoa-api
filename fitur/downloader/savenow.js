const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const API_KEY = "dfcb6d76f2f6a9894gjkege8a4ab232222"
const DOWNLOAD_BASE = "https://p.savenow.to/api/v2/download"
const PROGRESS_BASE = "https://p.savenow.to/api/progress"

async function submit(url, format) {
    const apiUrl = new URL(DOWNLOAD_BASE)
    apiUrl.searchParams.set("url", url)
    apiUrl.searchParams.set("format", format)
    apiUrl.searchParams.set("apikey", API_KEY)

    const r = await fetch(apiUrl.toString(), {
        headers: { "User-Agent": UA, "Origin": "https://y2mate.yt", "Referer": "https://y2mate.yt/en/" },
        cache: "no-store",
    })
    const json = await r.json()
    if (!json.success) throw new Error(json.message || "Gagal submit ke savenow")
    return json
}

async function pollProgress(id, maxRetries = 30) {
    const progressUrl = `${PROGRESS_BASE}?id=${encodeURIComponent(id)}`
    for (let i = 0; i < maxRetries; i++) {
        const r = await fetch(progressUrl, {
            headers: { "User-Agent": UA },
            cache: "no-store",
        })
        const json = await r.json()
        if (json.success === 1 && json.progress === 1000 && json.download_url) {
            return json
        }
        await new Promise(resolve => setTimeout(resolve, 3000))
    }
    throw new Error("Progress timeout: download tidak selesai dalam waktu yang ditentukan")
}

async function savenow(url, format) {
    const submitted = await submit(url, format)
    const result = await pollProgress(submitted.id)
    return {
        title: result.title || submitted.title || null,
        thumbnail: result.thumbnail_url || submitted.thumbnail_url || null,
        format: result.full_format || submitted.full_format || format,
        downloadUrl: result.download_url,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/savenow",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video via savenow.to",
        description: "Mengunduh video/audio dari berbagai platform menggunakan API savenow.to (y2mate.yt). Format video: 144, 240, 360, 480, 720, 1080, 1440, 4k. Format audio: mp3, m4a, webm, aac, flac, opus, ogg, wav.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL video yang ingin diunduh (YouTube, Instagram, dll)",
                schema: { type: "string", example: "https://youtu.be/dQw4w9WgXcQ" },
            },
            {
                name: "format",
                in: "query",
                required: false,
                description: "Format/kualitas unduhan. Video: 720 (default). Audio: mp3.",
                schema: { type: "string", default: "720", example: "720" },
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
                                        thumbnail: { type: "string" },
                                        format: { type: "string" },
                                        downloadUrl: { type: "string" },
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
        const { url, format = "720" } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        try {
            const result = await savenow(url, format)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
