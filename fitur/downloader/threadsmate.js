import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://threadsmate.com"

// Token pada link adalah JWT yang memuat url cdn langsung + nama file.
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

async function threadsmate(threadsUrl) {
    // 1) ambil halaman: cookie sesi + field CSRF tersembunyi (nama acak per-load)
    const { data: home, headers } = await axios.get(`${BASE}/id`, { headers: { "user-agent": UA } })
    const cookies = (headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ")
    const hidden = {}
    const $home = cheerio.load(home)
    $home("form[name='formurl'] input[type='hidden']").each((_, el) => {
        const name = $home(el).attr("name")
        if (name) hidden[name] = $home(el).attr("value") || ""
    })

    // 2) kirim ke /action (kadang token belum siap, retry beberapa kali)
    let j
    for (let attempt = 0; attempt < 4; attempt++) {
        const body = new URLSearchParams({ url: threadsUrl, ...hidden, lang: hidden.lang || "id" })
        const resp = await axios.post(`${BASE}/action`, body.toString(), {
            headers: {
                "user-agent": UA,
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
                origin: BASE,
                referer: `${BASE}/id`,
                cookie: cookies,
            },
            validateStatus: () => true,
        })
        j = resp.data
        if (j && j.html) break
        if (j && j.error && j.message) throw new Error(j.message)
        await new Promise(r => setTimeout(r, 1500))
    }
    if (!j || !j.html) throw new Error(j?.message || "Media tidak ditemukan atau URL tidak valid")

    // 3) parse hasil
    const $ = cheerio.load(j.html)
    const username = ($("p span").first().text() || "").replace(/^@/, "").trim() || null
    const caption = $("h3 [title]").first().attr("title") || $("h3").first().text().trim() || null

    const medias = []
    const seen = new Set()
    $("a[href*='fastdl.threadsmate.com']").each((_, a) => {
        const href = ($(a).attr("href") || "").replace(/&amp;/g, "&")
        if (!href || href.includes("/preview") || seen.has(href)) return
        seen.add(href)
        const label = $(a).text().replace(/\s+/g, " ").trim()
        const type = /video/i.test(label) ? "video" : "image"
        const meta = decodeToken(href)
        medias.push({ type, downloadUrl: href, directUrl: meta.directUrl || null, filename: meta.filename || null, expiresAt: meta.expiresAt || null })
    })

    if (!medias.length) throw new Error("Tidak ada media yang dapat diunduh")
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
        path: "/downloader/threadsmate",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media Threads via threadsmate",
        description: "Mengunduh media (video/gambar) dari postingan Threads publik menggunakan threadsmate.com. Mendukung carousel multi-media.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL postingan Threads",
                schema: { type: "string", example: "https://www.threads.com/@esports.ku/post/DZm4eSFEiDs" },
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
            const result = await threadsmate(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
