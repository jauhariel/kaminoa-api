import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://pindown.io"

// Sebagian link unduhan dibungkus JWT (dl.pincdn.app/v2?token=...) yang memuat url pinimg langsung.
function decodeToken(downloadUrl) {
    try {
        const token = new URL(downloadUrl).searchParams.get("token")
        if (!token) return {}
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
        return {
            directUrl: payload.url ? decodeURIComponent(payload.url) : null,
            filename: payload.filename || null,
            expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        }
    } catch {
        return {}
    }
}

async function pindown(pinUrl) {
    // 1) ambil halaman: cookie sesi + field CSRF tersembunyi (nama field acak per-load)
    const home = await axios.get(`${BASE}/en1`, { headers: { "user-agent": UA } })
    const cookies = (home.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ")
    const hidden = {}
    const $home = cheerio.load(home.data)
    $home("form[name='formurl'] input[type='hidden']").each((_, el) => {
        const name = $home(el).attr("name")
        if (name) hidden[name] = $home(el).attr("value") || ""
    })

    // 2) kirim ke endpoint /action
    const body = new URLSearchParams({ url: pinUrl, ...hidden, lang: hidden.lang || "en" })
    const { data: j } = await axios.post(`${BASE}/action`, body.toString(), {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest",
            origin: BASE,
            referer: `${BASE}/en1`,
            cookie: cookies,
        },
    })
    if (!j || j.error || !j.html) throw new Error(j?.message || "Media tidak ditemukan atau URL tidak valid")

    // 3) parse hasil
    const $ = cheerio.load(j.html)
    const title = $("strong").first().text().trim() || null
    const thumbnail = $(".media-left img, .media .image img").first().attr("src") || null

    const medias = []
    const seen = new Set()
    $("table tbody tr").each((_, tr) => {
        const quality = $(tr).find(".video-quality").first().text().trim()
        const downloadUrl = ($(tr).find("a[href]").first().attr("href") || "").replace(/&amp;/g, "&")
        if (!downloadUrl || seen.has(downloadUrl)) return
        seen.add(downloadUrl)
        const meta = decodeToken(downloadUrl)
        medias.push({
            quality: quality || null,
            downloadUrl,
            directUrl: meta.directUrl || null,
            filename: meta.filename || null,
            expiresAt: meta.expiresAt || null,
        })
    })

    if (!medias.length) throw new Error("Tidak ada media yang ditemukan")
    return { title, thumbnail, total: medias.length, medias }
}

export default {
    route: {
        method: "get",
        path: "/downloader/pindown",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Pinterest via pindown",
        description: "Mengunduh video/GIF/gambar Pinterest menggunakan pindown.io. Mendukung link pinterest.com maupun pin.it.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Pinterest (pin.it atau pinterest.com)",
                schema: { type: "string", example: "https://pin.it/uWysLLKpr" },
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
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
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
            const result = await pindown(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
