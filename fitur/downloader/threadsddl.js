import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://www.thethreadsdownloader.com/api"
const TENANT = "21" // dari frontend thethreadsdownloader.com

// Ambil shortcode dari URL Threads: .../post/<code>
function extractCode(url) {
    const m = String(url).match(/\/post\/([A-Za-z0-9_-]+)/)
    return m ? m[1] : null
}

function mapType(t) {
    return t === 2 ? "video" : "image"
}

async function thethreadsdownloader(threadsUrl) {
    const code = extractCode(threadsUrl)
    if (!code) throw new Error("URL Threads tidak valid (shortcode tidak ditemukan)")

    const { data: j, status } = await axios.get(`${BASE}/threads/post_detail/${code}`, {
        headers: {
            "user-agent": UA,
            tenantId: TENANT,
            "time-zone": "Asia/Jakarta",
            origin: "https://www.thethreadsdownloader.com",
            referer: "https://www.thethreadsdownloader.com/",
            accept: "application/json, text/plain, */*",
        },
        validateStatus: () => true,
    })

    const pd = j?.data?.post_detail
    if (status !== 200 || j?.code !== 0 || !pd || !Array.isArray(pd.media_list)) {
        throw new Error(j?.message || "Media tidak ditemukan atau URL tidak valid")
    }

    const medias = []
    for (const m of pd.media_list) {
        if (!m.url) continue
        const type = mapType(m.media_type)
        // resolusi alternatif (terutama untuk gambar)
        const variants = Array.isArray(m.version_medias)
            ? m.version_medias.filter(v => v.url).map(v => ({ url: v.url, width: v.width || null, height: v.height || null }))
            : []
        medias.push({
            type,
            url: m.url,
            cover: m.cover_image || null,
            width: m.width || null,
            height: m.height || null,
            ...(variants.length ? { variants } : {}),
        })
    }

    if (!medias.length) throw new Error("Tidak ada media yang dapat diunduh")
    return {
        code: pd.code || code,
        caption: pd.caption_text || null,
        thumbnail: pd.cover_image || null,
        publishTime: pd.publish_time || null,
        likeCount: pd.like_count ?? null,
        total: medias.length,
        videos: medias.filter(m => m.type === "video").length,
        images: medias.filter(m => m.type === "image").length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/thethreadsdl",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media Threads via thethreadsdownloader",
        description: "Mengunduh media (video/gambar) dari postingan Threads publik menggunakan thethreadsdownloader.com. Mendukung carousel dan menyertakan resolusi alternatif untuk gambar.",
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
                                        code: { type: "string" },
                                        caption: { type: "string" },
                                        thumbnail: { type: "string" },
                                        publishTime: { type: "string" },
                                        likeCount: { type: "integer" },
                                        total: { type: "integer" },
                                        videos: { type: "integer" },
                                        images: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "image"] },
                                                    url: { type: "string" },
                                                    cover: { type: "string" },
                                                    width: { type: "integer" },
                                                    height: { type: "integer" },
                                                    variants: { type: "array" },
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
            const result = await thethreadsdownloader(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
