import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://musicaldown.com"

// Token pada link unduhan adalah JWT yang memuat url cdn TikTok langsung.
function decodeToken(downloadUrl) {
    try {
        const token = new URL(downloadUrl).searchParams.get("token")
        if (!token) return {}
        const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
        return {
            directUrl: p.url || p.mp3 || null,
            filename: p.filename || null,
            mediaType: p.type || null,
            expiresAt: p.exp ? new Date(p.exp * 1000).toISOString() : null,
        }
    } catch {
        return {}
    }
}

function labelToQuality(label) {
    const l = label.toLowerCase()
    if (l.includes("mp3")) return { type: "audio", quality: "mp3" }
    if (l.includes("hd")) return { type: "video", quality: "HD (no watermark)" }
    if (l.includes("watermark")) return { type: "video", quality: "watermark" }
    return { type: "video", quality: "no watermark" }
}

async function musicaldown(tiktokUrl) {
    // 1) ambil form: cookie sesi + field bernama acak + token tersembunyi
    const { data: home, headers } = await axios.get(`${BASE}/id`, { headers: { "user-agent": UA } })
    const cookies = (headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ")
    const $h = cheerio.load(home)
    const fields = {}
    let urlField = null
    $h("#submit-form input").each((_, el) => {
        const name = $h(el).attr("name")
        if (!name) return
        if ($h(el).attr("id") === "link_url" || $h(el).attr("type") === "text") urlField = name
        fields[name] = $h(el).attr("value") ?? ""
    })
    if (!urlField) throw new Error("Gagal membaca form musicaldown")

    // 2) submit
    const body = new URLSearchParams({ ...fields, [urlField]: tiktokUrl, verify: "1" }).toString()
    const { data: out } = await axios.post(`${BASE}/id/download`, body, {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded",
            origin: BASE,
            referer: `${BASE}/id`,
            cookie: cookies,
        },
        maxRedirects: 5,
        validateStatus: () => true,
    })

    // 3) parse
    const $ = cheerio.load(out)
    // author = teks yang diawali '@' (h2 lain bisa banner/judul halaman)
    let author = null
    $("h2, h3, .video-author").each((_, e) => {
        const t = $(e).text().trim()
        if (!author && /^@/.test(t)) author = t
    })
    const title = $(".video-author, .video-desc, .row p").filter((_, e) => {
        const t = $(e).text().trim()
        return t && !t.includes("MusicallyDown") && !/^@/.test(t) && t.length > 8
    }).first().text().replace(/\s+/g, " ").trim() || null
    const thumbnail = $("img[src*='muscdn.app/a/images'], img[src*='tiktokcdn'], img[src*='p16-']").first().attr("src") || null

    const medias = []
    const seen = new Set()
    $("a[href*='muscdn.app']").each((_, a) => {
        const downloadUrl = $(a).attr("href")
        if (!downloadUrl || seen.has(downloadUrl)) return
        seen.add(downloadUrl)
        const label = $(a).text().replace(/arrow_downward/g, "").replace(/\s+/g, " ").trim()
        const meta = decodeToken(downloadUrl)
        const { type, quality } = labelToQuality(label)
        medias.push({
            type: meta.mediaType === "mp3" ? "audio" : type,
            quality,
            downloadUrl,
            directUrl: meta.directUrl || null,
            filename: meta.filename || null,
            expiresAt: meta.expiresAt || null,
        })
    })

    if (!medias.length) {
        const err = $(".alert, .red-text, [class*='error']").first().text().trim()
        throw new Error(err || "Media tidak ditemukan atau URL tidak valid")
    }
    return { author, title, thumbnail, total: medias.length, medias }
}

export default {
    route: {
        method: "get",
        path: "/downloader/musicaldown",
        auth: false,
        tags: ["Downloader"],
        summary: "Download TikTok via musicaldown",
        description: "Mengunduh video TikTok tanpa watermark (MP4, MP4 HD, versi watermark), audio MP3, serta foto/slideshow menggunakan musicaldown.com.",
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
                                        author: { type: "string" },
                                        title: { type: "string" },
                                        thumbnail: { type: "string" },
                                        total: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "audio", "image"] },
                                                    quality: { type: "string" },
                                                    downloadUrl: { type: "string" },
                                                    directUrl: { type: "string" },
                                                    filename: { type: "string" },
                                                    expiresAt: { type: "string" },
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
            const result = await musicaldown(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
