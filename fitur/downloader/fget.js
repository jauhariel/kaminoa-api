import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://fget.io"

async function fget(fbUrl) {
    // Form HTMX: POST /process dengan field id (url) + locale
    const { data: html } = await axios.post(`${BASE}/process`, new URLSearchParams({ id: fbUrl, locale: "en" }).toString(), {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded",
            "hx-request": "true",
            origin: BASE,
            referer: `${BASE}/`,
            accept: "*/*",
        },
    })

    const $ = cheerio.load(html)

    // pesan error muncul di blok khusus, bukan tabel hasil
    const errEl = $(".error-message, #error-message, [class*='error']").first()
    if (!$('a[href*="ssscdn.io/fget"]').length && errEl.text().trim()) {
        throw new Error(errEl.text().replace(/\s+/g, " ").trim())
    }

    const title = $(".result-title").first().text().trim() || null
    const thumbnail = $(".result-thumbnail img").first().attr("src") || null

    const medias = []
    const seen = new Set()
    $('a[href*="ssscdn.io/fget"]').each((_, a) => {
        const downloadUrl = ($(a).attr("href") || "").replace(/&amp;/g, "&")
        if (!downloadUrl || seen.has(downloadUrl)) return
        seen.add(downloadUrl)
        const quality = $(a).closest("div.flex.items-center.justify-between").find(".text-sm.font-medium").first().text().trim()
        const q = quality || $(a).text().replace(/\s+/g, " ").trim()
        medias.push({
            quality: q || null,
            type: /mp3|audio/i.test(q) ? "audio" : "video",
            downloadUrl,
        })
    })

    if (!medias.length) throw new Error("Video tidak ditemukan atau URL tidak valid")
    return { title, thumbnail, total: medias.length, medias }
}

export default {
    route: {
        method: "get",
        path: "/downloader/fget",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video Facebook via fget",
        description: "Mengunduh video Facebook (termasuk video grup) menggunakan fget.io. Mengembalikan berbagai kualitas (HD/SD) dan audio (MP3).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL video Facebook (post, reels, watch, atau permalink grup)",
                schema: { type: "string", example: "https://www.facebook.com/groups/1821107578248933/permalink/2828477544178593/" },
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
                                                    type: { type: "string", enum: ["video", "audio"] },
                                                    downloadUrl: { type: "string" },
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
            const result = await fget(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
