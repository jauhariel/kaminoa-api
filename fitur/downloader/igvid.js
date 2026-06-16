import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const API = "https://api.igvideodownloader.net/api/contentsite_api/media/parse"
// Kredensial statis dari frontend igvideodownloader.net
const AUTH = "20250901majwlqo"
const DOMAIN = "api-ak.igvideodownloader.net"

async function igvid(igUrl) {
    const body = new URLSearchParams({ auth: AUTH, domain: DOMAIN, origin: "source", link: igUrl }).toString()
    const { data: j } = await axios.post(API, body, {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://igvideodownloader.net",
            referer: "https://igvideodownloader.net/",
            accept: "*/*",
        },
        validateStatus: () => true,
    })

    const d = j?.data
    if (!d || !Array.isArray(d.media)) {
        throw new Error(j?.msg || "Media tidak ditemukan atau URL tidak valid")
    }

    const items = []
    for (const m of d.media) {
        const resources = (m.resources || [])
            .filter(r => r.download_url)
            .map(r => ({
                quality: r.quality || null,
                format: (r.format || "").toLowerCase() || null,
                url: r.download_url,
            }))
        if (resources.length) {
            items.push({ type: m.type === "picture" ? "image" : m.type || "video", resources })
        }
    }

    if (!items.length) throw new Error("Tidak ada media yang dapat diunduh")
    return {
        id: d.id || null,
        title: d.title || null,
        thumbnail: d.thumbnail || null,
        total: items.length,
        media: items,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/igvid",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Instagram via igvideodownloader",
        description: "Mengunduh media Instagram (post, reels, carousel) menggunakan igvideodownloader.net. Video tersedia dalam beberapa kualitas (hingga 1080P), langsung dari cdninstagram.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Instagram (post /p/, reel /reel/, atau /tv/)",
                schema: { type: "string", example: "https://www.instagram.com/reel/DXVZ4yCCG0J/" },
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
                                        id: { type: "string" },
                                        title: { type: "string" },
                                        thumbnail: { type: "string" },
                                        total: { type: "integer" },
                                        media: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "image"] },
                                                    resources: {
                                                        type: "array",
                                                        items: {
                                                            type: "object",
                                                            properties: {
                                                                quality: { type: "string" },
                                                                format: { type: "string" },
                                                                url: { type: "string" },
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
            const result = await igvid(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
