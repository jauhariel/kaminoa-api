import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://threadster.app"

// Token pada link adalah JWT yang memuat url cdninstagram langsung.
function decodeToken(downloadUrl) {
    try {
        const token = new URL(downloadUrl).searchParams.get("token")
        if (!token) return {}
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
        return {
            directUrl: payload.url ? decodeURIComponent(payload.url) : null,
            expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        }
    } catch {
        return {}
    }
}

async function threadster(threadsUrl) {
    // 1) ambil cookie sesi (_csrf) dari halaman utama
    const home = await axios.get(`${BASE}/`, { headers: { "user-agent": UA } })
    const cookies = (home.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ")
    if (!cookies) throw new Error("Gagal mengambil sesi dari threadster")

    // 2) kirim URL ke endpoint download
    const { data: html } = await axios.post(`${BASE}/download`, new URLSearchParams({ url: threadsUrl }).toString(), {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded",
            origin: BASE,
            referer: `${BASE}/`,
            cookie: cookies,
        },
    })

    // 3) parse hasil
    const $ = cheerio.load(html)
    const username = ($(".download__item__user_info span").first().text() || "").replace(/^@/, "").trim() || null
    const caption = $(".download__item__caption__text").first().text().trim() || null

    const medias = []
    const seen = new Set()
    $("a.download__item__download_btn[href]").each((_, a) => {
        const downloadUrl = $(a).attr("href")
        if (!downloadUrl || !downloadUrl.includes("acxcdn.com")) return
        const type = downloadUrl.includes("/video") ? "video" : "image"
        const meta = decodeToken(downloadUrl)
        const dedupeKey = meta.directUrl || downloadUrl
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        medias.push({ type, downloadUrl, directUrl: meta.directUrl || null, expiresAt: meta.expiresAt || null })
    })

    if (!medias.length) {
        const msg = $("h1, h2, h3").filter((_, el) => /couldn'?t|tidak|invalid|error/i.test($(el).text())).first().text().trim()
        throw new Error(msg || "Media tidak ditemukan (post privat, tidak ada media, atau URL tidak valid)")
    }

    return {
        username,
        caption,
        total: medias.length,
        videos: medias.filter(m => m.type === "video").length,
        images: medias.filter(m => m.type === "image").length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/threadster",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media Threads via threadster",
        description: "Mengunduh media (video/gambar) dari postingan Threads publik menggunakan threadster.app. Mendukung carousel multi-media.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL postingan Threads",
                schema: { type: "string", example: "https://www.threads.com/@citra_nurmalasarii/post/DZmxdS9mIw0" },
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
                                        username: { type: "string" },
                                        caption: { type: "string" },
                                        total: { type: "integer" },
                                        videos: { type: "integer" },
                                        images: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "image"] },
                                                    downloadUrl: { type: "string" },
                                                    directUrl: { type: "string" },
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
            const result = await threadster(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
