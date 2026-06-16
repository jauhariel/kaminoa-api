import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://fbdown.to"

function getVar(html, name) {
    return (html.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || [])[1]
}

// Token pada link unduhan adalah JWT yang memuat url fbcdn langsung + nama file.
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

async function fbdown(fbUrl) {
    // 1) ambil token bootstrap dari halaman
    const { data: home } = await axios.get(`${BASE}/id`, { headers: { "user-agent": UA } })
    const k_token = getVar(home, "k_token")
    const k_exp = getVar(home, "k_exp")
    const k_page = getVar(home, "k_page") || "home"
    if (!k_token || !k_exp) throw new Error("Gagal mengambil token dari fbdown.to")

    // 2) panggil API pencarian
    const body = new URLSearchParams({ k_exp, k_token, p: k_page, q: fbUrl, html: "", lang: "id", v: "v2", w: "" })
    const { data: j } = await axios.post(`${BASE}/api/ajaxSearch`, body.toString(), {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest",
            origin: BASE,
            referer: `${BASE}/id`,
        },
    })
    if (!j || j.status !== "ok" || !j.data) throw new Error(j?.mess || "Video tidak ditemukan atau URL tidak valid")

    // 3) parse hasil
    const $ = cheerio.load(j.data)
    const title = $(".content h3").first().text().trim() || "Facebook Video"
    const thumbnail = $(".image-fb img").first().attr("src") || null

    const medias = []
    const seen = new Set()
    $("table tbody tr").each((_, tr) => {
        const quality = $(tr).find(".video-quality").first().text().trim()
        const anchor = $(tr).find("a[href^='http']").first()
        const downloadUrl = anchor.attr("href")
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

    if (!medias.length) throw new Error("Tidak ada format unduhan yang ditemukan")
    return { title, thumbnail, total: medias.length, medias }
}

export default {
    route: {
        method: "get",
        path: "/downloader/fbdown",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video Facebook via fbdown.to",
        description: "Mengunduh video Facebook (publik) menggunakan fbdown.to. Mengembalikan link unduhan berbagai kualitas (HD/SD).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL video Facebook (postingan, reels, atau watch)",
                schema: { type: "string", example: "https://www.facebook.com/facebook/videos/10153231379946729/" },
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
            const result = await fbdown(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
