import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://www.tikwm.com"

const abs = u => (u ? (u.startsWith("http") ? u : BASE + u) : null)

async function tikwm(tiktokUrl) {
    const { data: j } = await axios.get(`${BASE}/api/`, {
        params: { url: tiktokUrl, hd: 1 },
        headers: { "user-agent": UA, accept: "application/json" },
        validateStatus: () => true,
    })
    if (!j || j.code !== 0 || !j.data) {
        throw new Error(j?.msg || "Media tidak ditemukan atau URL tidak valid")
    }
    const d = j.data

    const medias = []
    if (Array.isArray(d.images) && d.images.length) {
        // foto/slideshow
        d.images.forEach((img, i) => medias.push({ type: "image", quality: `image ${i + 1}`, url: abs(img) }))
    } else {
        if (d.play) medias.push({ type: "video", quality: "no watermark", url: abs(d.play) })
        if (d.hdplay) medias.push({ type: "video", quality: "HD (no watermark)", url: abs(d.hdplay) })
        if (d.wmplay) medias.push({ type: "video", quality: "watermark", url: abs(d.wmplay) })
    }
    if (d.music) medias.push({ type: "audio", quality: "mp3", url: abs(d.music) })

    if (!medias.length) throw new Error("Tidak ada media yang dapat diunduh")

    return {
        id: d.id || null,
        title: d.title || null,
        author: d.author ? { name: d.author.nickname || null, username: d.author.unique_id || null, avatar: abs(d.author.avatar) } : null,
        cover: abs(d.cover),
        durationSeconds: d.duration ?? null,
        stats: {
            views: d.play_count ?? null,
            likes: d.digg_count ?? null,
            comments: d.comment_count ?? null,
            shares: d.share_count ?? null,
        },
        total: medias.length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/tikwm",
        auth: false,
        tags: ["Downloader"],
        summary: "Download TikTok via tikwm",
        description: "Mengunduh video TikTok tanpa watermark (+ HD bila tersedia), versi watermark, audio MP3, dan foto/slideshow menggunakan API tikwm.com. Menyertakan metadata & statistik.",
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
                                        id: { type: "string" },
                                        title: { type: "string" },
                                        author: { type: "object" },
                                        cover: { type: "string" },
                                        durationSeconds: { type: "integer" },
                                        stats: { type: "object" },
                                        total: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "audio", "image"] },
                                                    quality: { type: "string" },
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
            const result = await tikwm(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
