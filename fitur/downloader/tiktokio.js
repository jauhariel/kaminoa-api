import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const API = "https://tiktokio.com/api/v1/tk/html"

// Token pada link dl.tiktokio.com = prefix tetap + base64 (tanpa "aHR0") dari url cdn TikTok.
function decodeDirect(downloadUrl) {
    try {
        const token = new URL(downloadUrl).searchParams.get("token")
        if (!token) return null
        const rest = token.slice(9) // buang prefix "atHsRx0cc"
        const url = Buffer.from("aHR0" + rest, "base64").toString("utf8")
        return /^https?:\/\//.test(url) ? url : null
    } catch {
        return null
    }
}

function classify(label) {
    const l = label.toLowerCase()
    if (l.includes("mp3") || l.includes("audio")) return { type: "audio", quality: "mp3" }
    if (l.includes("image") || l.includes("photo") || l.includes("gambar")) return { type: "image", quality: label.replace(/download/i, "").trim() }
    if (l.includes("watermark") && !l.includes("without") && !l.includes("tanpa")) return { type: "video", quality: "watermark" }
    return { type: "video", quality: "no watermark" }
}

async function tiktokio(tiktokUrl) {
    const { data: out, status } = await axios.post(API, { vid: tiktokUrl, prefix: "tiktokio.com" }, {
        headers: { "user-agent": UA, "content-type": "application/json", origin: "https://tiktokio.com", referer: "https://tiktokio.com/id/", accept: "*/*" },
        validateStatus: () => true,
        responseType: "text",
    })
    if (status !== 200 || !out || /error|invalid|tidak valid/i.test(out.slice(0, 60))) {
        throw new Error("Media tidak ditemukan atau URL tidak valid")
    }

    const $ = cheerio.load(out)
    const thumbnail = $("img[src*='tiktokcdn'], img[src*='p16'], .video-info img").first().attr("src") || null
    const title = $(".video-info h2, .video-info .desc, .tk-title").first().text().trim() || null

    const medias = []
    const seen = new Set()
    $("a[href]").each((_, a) => {
        const downloadUrl = $(a).attr("href")
        if (!downloadUrl || !/dl\.tiktokio\.com|tiktokcdn/i.test(downloadUrl) || seen.has(downloadUrl)) return
        seen.add(downloadUrl)
        const label = $(a).text().replace(/\s+/g, " ").trim()
        const { type, quality } = classify(label)
        medias.push({ type, quality, downloadUrl, directUrl: decodeDirect(downloadUrl) })
    })

    if (!medias.length) throw new Error("Tidak ada media yang dapat diunduh")
    return {
        title,
        thumbnail,
        total: medias.length,
        videos: medias.filter(m => m.type === "video").length,
        images: medias.filter(m => m.type === "image").length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/tiktokio",
        auth: false,
        tags: ["Downloader"],
        summary: "Download TikTok via tiktokio",
        description: "Mengunduh video TikTok tanpa watermark (+ versi watermark), audio MP3, dan foto/slideshow menggunakan tiktokio.com. Cepat, tanpa watermark.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL TikTok (video, photo/slideshow, atau short link vm.tiktok.com)",
                schema: { type: "string", example: "https://vm.tiktok.com/ZSQbmkw89/" },
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
                                        total: { type: "integer" },
                                        videos: { type: "integer" },
                                        images: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "audio", "image"] },
                                                    quality: { type: "string" },
                                                    downloadUrl: { type: "string" },
                                                    directUrl: { type: "string" },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "URL tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        try {
            const result = await tiktokio(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
