import axios from "axios"
import * as cheerio from "cheerio"

// facebookexternalhit mengembalikan JSON paling lengkap, Googlebot/bingbot sebagai fallback.
const UAS = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHtml(url) {
    let last
    for (let i = 0; i < UAS.length; i++) {
        const { status, data } = await axios.get(url, {
            headers: {
                "user-agent": UAS[i],
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.9",
            },
            timeout: 25000,
            validateStatus: () => true,
        })
        if (status === 200) return data
        last = status
        if (status === 429 || status >= 500) {
            if (i < UAS.length - 1) await sleep(800 * (i + 1))
            continue
        }
        break
    }
    throw new Error(last === 429
        ? "Rate limit Threads (429) — coba lagi beberapa saat"
        : `Threads mengembalikan status ${last}`)
}

function getThreadId(url) {
    let cleanUrl = url.split("?")[0].split("&")[0]
    if (cleanUrl.includes("/t/")) cleanUrl = cleanUrl.split("/t/")[1]
    else if (cleanUrl.includes("/post/")) cleanUrl = cleanUrl.split("/post/")[1]
    if (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1)
    return cleanUrl.split("/").pop()
}

function findPostObject(obj, targetCode) {
    if (!obj || typeof obj !== "object") return null
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = findPostObject(item, targetCode)
            if (found) return found
        }
    } else {
        if (obj.code === targetCode) return obj
        for (const key in obj) {
            const found = findPostObject(obj[key], targetCode)
            if (found) return found
        }
    }
    return null
}

function getDurationFromUrl(videoUrl) {
    try {
        const urlObj = new URL(videoUrl)
        const efg = urlObj.searchParams.get("efg")
        if (efg) {
            const decoded = Buffer.from(efg, "base64").toString("utf-8")
            const data = JSON.parse(decoded)
            if (data?.duration_s) return Math.round(data.duration_s) + "s"
        }
    } catch {}
    return null
}

function parseMedia(obj, list = [], seenUrls = new Set()) {
    if (!obj || typeof obj !== "object") return list
    if (Array.isArray(obj)) {
        for (const item of obj) parseMedia(item, list, seenUrls)
    } else {
        if (obj.video_versions && Array.isArray(obj.video_versions)) {
            const bestVideo = obj.video_versions[0]
            if (bestVideo?.url) {
                const url = bestVideo.url.replace(/\\/g, "").replace(/&amp;/g, "&")
                if (!seenUrls.has(url)) {
                    seenUrls.add(url)
                    let duration = obj.video_duration ? Math.round(obj.video_duration) + "s"
                        : obj.duration ? Math.round(obj.duration) + "s"
                        : null
                    if (!duration) duration = getDurationFromUrl(url)
                    list.push({
                        type: "video",
                        width: obj.original_width || null,
                        height: obj.original_height || null,
                        resolution: obj.original_width && obj.original_height
                            ? `${obj.original_width}x${obj.original_height}` : "Best Quality",
                        duration,
                        url,
                    })
                }
            }
        } else if (obj.image_versions2?.candidates && Array.isArray(obj.image_versions2.candidates)) {
            if (!obj.video_versions) {
                const bestImage = obj.image_versions2.candidates[0]
                if (bestImage?.url) {
                    const url = bestImage.url.replace(/\\/g, "").replace(/&amp;/g, "&")
                    if (!seenUrls.has(url)) {
                        seenUrls.add(url)
                        list.push({
                            type: "image",
                            width: obj.original_width || bestImage.width || null,
                            height: obj.original_height || bestImage.height || null,
                            resolution: obj.original_width && obj.original_height
                                ? `${obj.original_width}x${obj.original_height}`
                                : bestImage.width && bestImage.height
                                    ? `${bestImage.width}x${bestImage.height}` : "Best Quality",
                            url,
                        })
                    }
                }
            }
        }
        for (const key in obj) {
            if (key !== "video_versions" && key !== "image_versions2" && key !== "image_versions")
                parseMedia(obj[key], list, seenUrls)
        }
    }
    return list
}

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
    const targetUrl = postUrl.replace("threads.com", "threads.net")
    const shortcode = getThreadId(targetUrl)
    const html = await fetchHtml(targetUrl)
    const $ = cheerio.load(html)
    const og = (p) => $(`meta[property="og:${p}"]`).attr("content") || null

    let postObj = null
    $('script[type="application/json"]').each((_, el) => {
        if (postObj) return
        try {
            const jsonText = $(el).text().trim()
            if (jsonText) postObj = findPostObject(JSON.parse(jsonText), shortcode)
        } catch {}
    })

    const mediaList = []
    const seenUrls = new Set()
    if (postObj) {
        parseMedia(postObj, mediaList, seenUrls)
    } else {
        $('script[type="application/json"]').each((_, el) => {
            try {
                const jsonText = $(el).text().trim()
                if (jsonText) parseMedia(JSON.parse(jsonText), mediaList, seenUrls)
            } catch {}
        })
    }

    if (mediaList.length === 0 && !og("description") && !og("image")) {
        throw new Error("Post tidak ditemukan, privat, atau dihapus")
    }

    const types = [...new Set(mediaList.map((m) => m.type))]
    return {
        shortcode,
        type: types.length === 1 ? types[0] : types.length > 1 ? "carousel" : "unknown",
        description: og("description"),
        author: parseAuthor(og("title"), targetUrl),
        thumbnail: og("image"),
        medias: mediaList,
        url: og("url") || targetUrl,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/threads",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media post Threads (scrape langsung)",
        description: "Mengambil semua media (gambar/video), caption, dan author dari post Threads langsung via UA crawler. Mendukung carousel, thumbnail, resolusi & durasi video. UA utama facebookexternalhit dengan fallback Googlebot/bingbot.",
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
                                        type: { type: "string", enum: ["image", "video", "carousel", "unknown"] },
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
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["image", "video"] },
                                                    width: { type: "number", nullable: true },
                                                    height: { type: "number", nullable: true },
                                                    resolution: { type: "string" },
                                                    duration: { type: "string", nullable: true },
                                                    url: { type: "string" },
                                                },
                                            },
                                        },
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
