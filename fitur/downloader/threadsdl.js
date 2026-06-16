import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://www.threadsdl.app"

async function threadsdl(threadsUrl) {
    const { data: j, status } = await axios.post(`${BASE}/api/threads`, { url: threadsUrl }, {
        headers: {
            "user-agent": UA,
            "content-type": "application/json",
            origin: BASE,
            referer: `${BASE}/id/`,
            accept: "*/*",
        },
        validateStatus: () => true,
    })

    if (status !== 200 || !j || !Array.isArray(j.medias)) {
        throw new Error(j?.error || "Media tidak ditemukan atau URL tidak valid")
    }

    const medias = []
    for (const m of j.medias) {
        if (m.mediaType === 2 && Array.isArray(m.videos) && m.videos.length) {
            // video: variannya menunjuk ke file sama; ambil yang pertama
            medias.push({
                type: "video",
                url: m.videos[0].url,
                cover: m.cover || null,
                width: m.width || null,
                height: m.height || null,
            })
        } else if (Array.isArray(m.images) && m.images.length) {
            // gambar: ambil resolusi tertinggi (varian pertama biasanya original/terbesar)
            medias.push({
                type: "image",
                url: m.images[0].url,
                width: m.width || null,
                height: m.height || null,
            })
        }
    }

    if (!medias.length) throw new Error("Tidak ada media yang dapat diunduh")
    return {
        username: j.username || null,
        text: j.text || null,
        avatar: j.avatar || null,
        total: medias.length,
        videos: medias.filter(m => m.type === "video").length,
        images: medias.filter(m => m.type === "image").length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/threadsdl",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media Threads via threadsdl",
        description: "Mengunduh media (video/gambar) dari postingan Threads publik menggunakan threadsdl.app. Mendukung carousel multi-media.",
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
                                        text: { type: "string" },
                                        avatar: { type: "string" },
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
            const result = await threadsdl(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
