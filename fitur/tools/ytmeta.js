import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function extractId(u) {
    try {
        const url = new URL(u)
        const h = url.hostname.replace(/^www\./, "").replace(/^m\./, "")
        if (h === "youtu.be") return url.pathname.slice(1).split("/")[0]
        if (h.endsWith("youtube.com") || h.endsWith("youtube-nocookie.com")) {
            if (url.searchParams.get("v")) return url.searchParams.get("v")
            const m = url.pathname.match(/\/(?:shorts|embed|live|v)\/([^/?]+)/)
            if (m) return m[1]
        }
    } catch {}
    const m = String(u).match(/[a-zA-Z0-9_-]{11}/)
    return m ? m[0] : null
}

function fmtDuration(sec) {
    sec = Number(sec) || 0
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`
}

async function ytmeta(youtubeUrl) {
    const id = extractId(youtubeUrl)
    if (!id || id.length !== 11) throw new Error("ID video YouTube tidak ditemukan pada URL")
    const watch = `https://www.youtube.com/watch?v=${id}`

    // Ambil dua sumber paralel: oEmbed (resmi) + halaman watch (untuk durasi/stats)
    const [oembed, page] = await Promise.allSettled([
        axios.get("https://www.youtube.com/oembed", { params: { url: watch, format: "json" }, headers: { "user-agent": UA }, validateStatus: () => true }),
        axios.get(watch, { headers: { "user-agent": UA, "accept-language": "en" }, validateStatus: () => true, responseType: "text" }),
    ])

    let title = null, author = null, durationSeconds = null, viewCount = null, publishDate = null, keywords = null, shortDescription = null

    if (oembed.status === "fulfilled" && oembed.value.status === 200 && oembed.value.data?.title) {
        title = oembed.value.data.title
        author = oembed.value.data.author_name || null
    }

    if (page.status === "fulfilled" && typeof page.value.data === "string") {
        const html = page.value.data
        const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|const|window|<\/script>)/s) || html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s)
        if (m) {
            try {
                const pr = JSON.parse(m[1])
                const d = pr.videoDetails || {}
                const micro = pr.microformat?.playerMicroformatRenderer || {}
                title = d.title || title
                author = d.author || author
                durationSeconds = d.lengthSeconds ? Number(d.lengthSeconds) : null
                viewCount = d.viewCount ? Number(d.viewCount) : null
                publishDate = micro.publishDate || micro.uploadDate || null
                keywords = Array.isArray(d.keywords) ? d.keywords.slice(0, 15) : null
                shortDescription = d.shortDescription ? d.shortDescription.slice(0, 500) : null
            } catch {}
        }
    }

    if (!title) throw new Error("Gagal mengambil metadata (video privat/dihapus, atau YouTube memblokir)")

    return {
        videoId: id,
        title,
        author,
        durationSeconds,
        duration: durationSeconds != null ? fmtDuration(durationSeconds) : null,
        viewCount,
        publishDate,
        shortDescription,
        keywords,
        url: watch,
        thumbnails: {
            default: `https://i.ytimg.com/vi/${id}/default.jpg`,
            medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
            high: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            standard: `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
            maxres: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        },
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/ytmeta",
        auth: false,
        tags: ["Tools"],
        summary: "Metadata video YouTube",
        description: "Mengambil metadata video YouTube (judul, durasi, thumbnail, author, views, tanggal terbit) langsung dari YouTube (oEmbed resmi + halaman watch), tanpa pihak ketiga.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL atau ID video YouTube (watch, youtu.be, shorts, music, embed)",
                schema: { type: "string", example: "https://youtu.be/pNNnrE_RSdE" },
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
                                        videoId: { type: "string" },
                                        title: { type: "string" },
                                        author: { type: "string" },
                                        durationSeconds: { type: "integer" },
                                        duration: { type: "string" },
                                        viewCount: { type: "integer" },
                                        publishDate: { type: "string" },
                                        shortDescription: { type: "string" },
                                        keywords: { type: "array", items: { type: "string" } },
                                        url: { type: "string" },
                                        thumbnails: { type: "object" },
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
        if (!url?.trim()) return res.status(400).json({ ok: false, error: "url wajib diisi" })
        try {
            const result = await ytmeta(url.trim())
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
