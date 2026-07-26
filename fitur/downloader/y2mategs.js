import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const BASE_HEADERS = {
    "User-Agent": UA,
    "Referer": "https://y2mate.gs/",
    "Origin": "https://y2mate.gs",
}
const AUTH_URL = "https://eta.etacloud.org/api/v1/auth"
const INIT_URL = "https://eta.etacloud.org/api/v1/init"

function extractVideoId(url) {
    const regex = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|live\/|shorts\/)|[?&]v=)([a-zA-Z0-9-_]{11})/
    const match = String(url).match(regex)
    return match ? match[1] : null
}

async function authenticate() {
    const { data } = await axios.get(AUTH_URL, { headers: BASE_HEADERS, timeout: 10000 })
    if (data.err && data.err !== 0) throw new Error("Authentication failed with y2mate.gs")
    return { key: data.key, geo: data.geo }
}

async function initialize(key) {
    const ts = Date.now()
    const { data } = await axios.get(`${INIT_URL}?_=${ts}`, {
        headers: { ...BASE_HEADERS, Authorization: `Bearer ${key}` },
        timeout: 10000,
    })
    if (data.error && data.error !== "0") throw new Error("Initialization failed with y2mate.gs")
    return data.convertURL
}

async function doConvert(convertURL, videoId, format) {
    const ts = Date.now()
    const url = `${convertURL}&v=${videoId}&f=${format}&_=${ts}`
    const { data } = await axios.get(url, { headers: BASE_HEADERS, timeout: 15000 })
    if (data.error && data.error !== 0) throw new Error(`Conversion error code: ${data.error}`)
    if (data.redirect === 1 && data.redirectURL) return doConvert(data.redirectURL, videoId, format)
    return { progressURL: data.progressURL, downloadURL: data.downloadURL, title: data.title }
}

async function pollProgress(progressURL, downloadURL, maxRetries = 60) {
    if (!progressURL) return downloadURL
    for (let i = 0; i < maxRetries; i++) {
        try {
            const ts = Date.now()
            const { data } = await axios.get(`${progressURL}&_=${ts}`, { headers: BASE_HEADERS, timeout: 10000 })
            if (data.error && data.error !== 0) throw new Error(`Progress error code: ${data.error}`)
            if (data.progress === 3) return downloadURL
            await new Promise((r) => setTimeout(r, 3000))
        } catch (err) {
            if (err.response && err.response.status >= 400 && err.response.status < 500) throw err
            await new Promise((r) => setTimeout(r, 3000))
        }
    }
    throw new Error("Progress polling timeout from y2mate.gs")
}

async function y2mategs(youtubeUrl, format = "mp3") {
    const videoId = extractVideoId(youtubeUrl)
    if (!videoId) throw new Error("Invalid YouTube URL")
    const { key } = await authenticate()
    const convertURL = await initialize(key)
    const result = await doConvert(convertURL, videoId, format)
    const finalURL = await pollProgress(result.progressURL, result.downloadURL)
    const downloadUrl = `${finalURL}&v=${videoId}&f=${format}&r=y2mate.gs`
    return {
        videoId,
        title: result.title || null,
        url: downloadUrl,
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        quality: format.toUpperCase(),
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/y2mategs",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube via y2mate.gs",
        description: "Mengunduh video/audio YouTube menggunakan y2mate.gs (etacloud). Mendukung format mp4 (video) atau mp3 (audio).",
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
                                        title: { type: "string", example: "Rick Astley - Never Gonna Give You Up" },
                                        url: { type: "string" },
                                        thumbnail: { type: "string" },
                                        quality: { type: "string", example: "MP3" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": {
                description: "URL atau format tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
        },
    },

    handler: async (req, res) => {
        const { url, format = "mp3" } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        if (!["mp3", "mp4"].includes(format)) {
            return res.status(400).json({ ok: false, error: "Format harus mp3 atau mp4" })
        }
        try {
            const result = await y2mategs(url, format)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
