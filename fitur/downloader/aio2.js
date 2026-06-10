import axios from "axios"

const API_URL = "https://api.vidssave.com/api/contentsite_api/media/parse"
const WEBSITE_URL = "https://vidssave.com"
const DOMAIN = "api-ak.vidssave.com"

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
]

const AUTH_PATTERNS = [
    /auth['":\s]+['"](\d{8}[a-z]{7})['"]/i,
    /auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
    /['"]auth['"]\s*:\s*['"](\d{8}[a-z]{7})['"]/i,
    /data-auth=['"](\d{8}[a-z]{7})['"]/i,
    /var\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
    /let\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
    /const\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i
]

let cachedAuth = null

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i]
}

async function extractAuth(ua) {
    const res = await axios.get(WEBSITE_URL, {
        headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        timeout: 30000
    })
    const html = res.data

    for (const pattern of AUTH_PATTERNS) {
        const match = html.match(pattern)
        if (match?.[1]) return match[1]
    }

    const jsFiles = html.match(/src=['"]([^'"]*\.js[^'"]*)['"]/gi) || []
    for (const jsFile of jsFiles) {
        const jsUrl = jsFile.match(/src=['"]([^'"]+)['"]/i)?.[1]
        if (!jsUrl) continue
        try {
            const fullUrl = jsUrl.startsWith("http") ? jsUrl : `${WEBSITE_URL}${jsUrl}`
            const jsRes = await axios.get(fullUrl, { headers: { "User-Agent": ua }, timeout: 15000 })
            for (const pattern of AUTH_PATTERNS) {
                const match = jsRes.data.match(pattern)
                if (match?.[1]) return match[1]
            }
        } catch {}
    }

    return null
}

async function parseMedia(url) {
    const ua = randomUA()

    if (!cachedAuth) {
        cachedAuth = await extractAuth(ua)
        if (!cachedAuth) throw new Error("Gagal mengambil auth key dari vidssave.com")
    }

    const params = new URLSearchParams()
    params.append("auth", cachedAuth)
    params.append("domain", DOMAIN)
    params.append("origin", "source")
    params.append("link", url)

    const res = await axios.post(API_URL, params.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": ua,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": WEBSITE_URL,
            "Referer": `${WEBSITE_URL}/`
        },
        timeout: 60000,
        maxRedirects: 5
    })

    if (!res.data || res.data.status !== 1) {
        cachedAuth = null
        throw new Error(res.data?.msg || res.data?.message || "Unknown error dari API")
    }

    return res.data.data
}

function formatOutput(data) {
    const videos = []
    const audios = []

    if (data.media && Array.isArray(data.media)) {
        for (const m of data.media) {
            if (!m.resources) continue
            for (const r of m.resources) {
                if (!r.download_url) continue
                const item = {
                    quality: r.quality || "unknown",
                    format: r.format || (m.type === "video" ? "MP4" : "MP3"),
                    size: r.size || 0,
                    size_human: formatSize(r.size),
                    download_url: r.download_url
                }
                if (m.type === "video") videos.push(item)
                else if (m.type === "audio") audios.push(item)
            }
        }
    }

    videos.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))

    return {
        id: data.id,
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        publish_ts: data.publish_ts,
        like_count: data.like_count || 0,
        comment_count: data.comment_count || 0,
        videos,
        audios
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/aio2",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media all-in-one (vidssave)",
        description: "Mengunduh media dari berbagai platform (TikTok, Instagram, YouTube, dll) menggunakan vidssave.com.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL media yang ingin diunduh",
                schema: { type: "string", example: "https://www.tiktok.com/@tiktok/video/7106594312292453675" }
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
                                result: { type: "object" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "URL tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        try {
            const data = await parseMedia(url)
            res.json({ ok: true, result: formatOutput(data) })
        } catch (e) {
            res.status(e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
