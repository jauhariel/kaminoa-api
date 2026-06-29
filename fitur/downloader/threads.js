import axios from "axios"
import * as cheerio from "cheerio"

// Threads me-render og-meta + JSON (video_versions) hanya untuk UA crawler.
// UA Googlebot membuat server mengembalikan HTML berisi data lengkap (tanpa login).
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"

// Telusuri JSON kompleks Threads secara rekursif untuk url video pertama.
function findVideoUrl(data) {
    if (Array.isArray(data)) {
        for (const v of data) {
            const r = findVideoUrl(v)
            if (r) return r
        }
        return null
    }
    if (data && typeof data === "object") {
        const first = data.video_versions?.[0]?.url
        if (typeof first === "string" && first) return first
        for (const v of Object.values(data)) {
            const r = findVideoUrl(v)
            if (r) return r
        }
    }
    return null
}

// og:title Threads berformat "Nama (@username) on Threads".
function parseAuthor(ogTitle, url) {
    const fromUrl = (url.match(/threads\.(?:net|com)\/@([A-Za-z0-9_.]+)/) || [])[1] || null
    const m = (ogTitle || "").match(/^(.*?)\s*\(@([A-Za-z0-9_.]+)\)/)
    const username = m?.[2] || fromUrl
    return {
        name: m?.[1]?.trim() || null,
        username: username || null,
        url: username ? `https://www.threads.com/@${username}` : null,
    }
}

async function threads(postUrl) {
    const { data: html } = await axios.get(postUrl, {
        headers: {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
        },
        timeout: 25000,
    })
    const $ = cheerio.load(html)
    const og = (p) => $(`meta[property="og:${p}"]`).attr("content") || null

    // Video: utamakan og:video, fallback ke video_versions di blob JSON.
    let video = og("video") || og("video:secure_url")
    if (!video) {
        $('script[type="application/json"]').each((_, s) => {
            if (video) return
            const c = $(s).text()
            if (c && c.includes("video_versions")) {
                try {
                    const r = findVideoUrl(JSON.parse(c))
                    if (r) video = r
                } catch { /* skip blob yang bukan JSON valid */ }
            }
        })
    }

    if (!og("description") && !og("image") && !video) {
        throw new Error("Post tidak ditemukan, privat, atau dihapus")
    }

    const shortcode = (postUrl.match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1] || null
    return {
        shortcode,
        type: video ? "video" : "image",
        description: og("description"),
        author: parseAuthor(og("title"), postUrl),
        thumbnail: og("image"),
        video,
        url: og("url") || postUrl,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/threads",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video & info post Threads (scrape langsung)",
        description: "Mengambil caption, author, thumbnail, dan url video post Threads langsung dari halaman (tanpa pihak ketiga/login) via UA crawler. Mendukung link threads.com & threads.net. Untuk post foto, `video` bernilai null.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL post Threads",
                schema: { type: "string", example: "https://www.threads.com/@derahmatsyuhada/post/DaIUHnSjyIb" },
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
                                        shortcode: { type: "string", nullable: true },
                                        type: { type: "string", enum: ["video", "image"] },
                                        description: { type: "string", nullable: true },
                                        author: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string", nullable: true },
                                                username: { type: "string", nullable: true },
                                                url: { type: "string", nullable: true },
                                            },
                                        },
                                        thumbnail: { type: "string", nullable: true },
                                        video: { type: "string", nullable: true, description: "URL mp4 langsung (null bila post foto)" },
                                        url: { type: "string", nullable: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "URL tidak valid" },
            "500": { description: "Kesalahan server / post privat / dihapus" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/threads\.(?:net|com)\/@[^/]+\/post\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Threads tidak valid" })
        }
        try {
            const result = await threads(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
