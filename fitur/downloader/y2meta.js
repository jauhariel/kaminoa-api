import axios from "axios"

// Scraper y2meta.nu → via iframe widget api.ytmp3.tube
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const WIDGET_URL = "https://api.ytmp3.tube/widgetplus/1"
const API_BASE = "https://api.ytmp3.tube"

const YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|live\/|shorts\/)|[?&]v=)([a-zA-Z0-9-_]{11})/

const MP3_BITRATES = ["320", "256", "192", "128"]
const MP4_QUALITIES = ["1080", "720", "480", "360", "240"]

function extractVideoId(url) {
    const m = String(url).match(YT_RE)
    return m ? m[1] : null
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms))
}

// Step 1: fetch widget, parse token/timestamp/encryptedVideoId
async function getWidgetData(videoId, title = "YouTube Media") {
    const { data } = await axios.get(WIDGET_URL, {
        params: { url: `https://www.youtube.com/watch?v=${videoId}`, title },
        headers: { "User-Agent": UA, Referer: "https://y2meta.nu/" },
        timeout: 15000,
    })
    const m = data.match(/<script[^>]*id="widget-data"[^>]*>([\s\S]*?)<\/script>/)
    if (!m) throw new Error("Gagal mengambil widget-data dari y2meta")
    const wd = JSON.parse(m[1])
    if (!wd.token || !wd.timestamp || !wd.encryptedVideoId) {
        throw new Error("Token y2meta tidak lengkap")
    }
    return { videoId: wd.videoId || videoId, token: wd.token, timestamp: wd.timestamp, secretToken: wd.encryptedVideoId }
}

// Step 2: POST convert, poll sampai link siap
async function convert(format, wd, quality) {
    const endpoint = format === "mp3" ? "/api/download/mp3" : "/api/download/mp4"
    const body =
        format === "mp3"
            ? { id: wd.videoId, audioBitrate: quality, token: wd.token, timestamp: wd.timestamp, secretToken: wd.secretToken }
            : { id: wd.videoId, videoQuality: quality, token: wd.token, timestamp: wd.timestamp, secretToken: wd.secretToken }

    const headers = {
        "User-Agent": UA,
        Referer: WIDGET_URL,
        "Content-Type": "application/json",
        Origin: API_BASE,
    }

    // MP4 biasanya instant; MP3 perlu poll
    for (let i = 0; i < 60; i++) {
        const { data } = await axios.post(`${API_BASE}${endpoint}`, body, { headers, timeout: 15000 })
        if (data.status === "fail") throw new Error(data.msg || "Konversi gagal di sisi y2meta")
        if (data.status === "ok" && data.link) {
            return {
                link: data.link,
                progress: typeof data.progress === "number" ? data.progress : 100,
            }
        }
        await sleep(1500)
    }
    throw new Error("Timeout: konversi y2meta tidak selesai")
}

async function y2meta(youtubeUrl, format = "mp3", quality = null) {
    const videoId = extractVideoId(youtubeUrl)
    if (!videoId) throw new Error("URL YouTube tidak valid")

    const valid = format === "mp3" ? MP3_BITRATES : MP4_QUALITIES
    const q = quality && valid.includes(String(quality)) ? String(quality) : valid[0]

    const wd = await getWidgetData(videoId)
    const result = await convert(format, wd, q)
    return {
        videoId,
        format,
        quality: format === "mp3" ? `${q}kbps` : `${q}p`,
        url: result.link,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        available: valid.map((v) => (format === "mp3" ? `${v}kbps` : `${v}p`)),
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/y2meta",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube via y2meta.nu",
        description:
            "Mengunduh video/audio YouTube menggunakan y2meta.nu (backend api.ytmp3.tube). Mendukung MP3 (320/256/192/128 kbps) dan MP4 (1080/720/480/360/240p). MP3 dipoll sampai konversi selesai, MP4 instan (googlevideo).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL YouTube (watch, youtu.be, shorts, live, atau embed)",
                schema: { type: "string", example: "https://youtu.be/dQw4w9WgXcQ" },
            },
            {
                name: "format",
                in: "query",
                required: false,
                description: "Format unduhan: mp3 (default) atau mp4",
                schema: { type: "string", enum: ["mp3", "mp4"], default: "mp3" },
            },
            {
                name: "quality",
                in: "query",
                required: false,
                description: "Kualitas. MP3: 320/256/192/128. MP4: 1080/720/480/360/240. Default: tertinggi.",
                schema: { type: "string", example: "320" },
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
                                        videoId: { type: "string", example: "dQw4w9WgXcQ" },
                                        format: { type: "string", example: "mp3" },
                                        quality: { type: "string", example: "320kbps" },
                                        url: { type: "string" },
                                        thumbnail: { type: "string" },
                                        available: { type: "array", items: { type: "string" } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": {
                description: "URL/format/kualitas tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
        },
    },

    handler: async (req, res) => {
        const { url, format = "mp3", quality } = req.query
        if (!url || !/^https?:\/\//i.test(url) || !extractVideoId(url)) {
            return res.status(400).json({ ok: false, error: "URL YouTube tidak valid" })
        }
        if (!["mp3", "mp4"].includes(format)) {
            return res.status(400).json({ ok: false, error: "Format harus mp3 atau mp4" })
        }
        const valid = format === "mp3" ? MP3_BITRATES : MP4_QUALITIES
        if (quality && !valid.includes(String(quality))) {
            return res.status(400).json({ ok: false, error: `Kualitas tidak valid. Pilih: ${valid.join(", ")}` })
        }
        try {
            const result = await y2meta(url, format, quality)
            res.json({ ok: true, result })
        } catch (e) {
            const status = e.response && e.response.status >= 400 && e.response.status < 500 ? 400 : 500
            const msg = e.response?.data?.msg || e.response?.data?.message || e.message
            res.status(status).json({ ok: false, error: msg })
        }
    },
}
