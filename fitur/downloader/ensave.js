import axios from "axios"

// Key RapidAPI yang di-embed di bundle front-end en-save-net.com (bocor / publik).
// Bisa di-override lewat env RAPIDAPI_ENSAVE_KEY untuk pakai key sendiri.
const RAPIDAPI_KEY = process.env.RAPIDAPI_ENSAVE_KEY || "12b36cb3d0mshe36b32035bbe360p13ae4ejsn004cdec46085"
const RAPIDAPI_HOST = "youtube-video-audio-downloader.p.rapidapi.com"
const BASE = `https://${RAPIDAPI_HOST}/api/v1`

const PLATFORMS = ["youtube", "facebook", "instagram", "reddit", "soundcloud", "tiktok", "x"]

function isHttp(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url)
}

async function ensave(url, platform = "youtube") {
    if (!PLATFORMS.includes(platform)) {
        throw new Error(`Platform tidak didukung. Pilih: ${PLATFORMS.join(", ")}`)
    }
    if (!isHttp(url)) throw new Error("URL tidak valid")

    const { data } = await axios.get(`${BASE}/${platform}-media/info`, {
        params: { url },
        headers: {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": RAPIDAPI_HOST,
        },
        timeout: 15000,
    })

    if (data.status !== "success" || !data.data) {
        throw new Error(data.message || "Gagal memproses media")
    }
    const d = data.data
    const links = (d.links || []).map((l) => ({
        type: l.type || null,
        quality: l.resolution || l.quality || null,
        url: l.download_url || l.url || null,
    })).filter((l) => l.url)

    return {
        platform,
        title: d.title || null,
        uploader: d.uploader || null,
        thumbnail: d.thumbnail || null,
        duration: d.duration || null,
        links,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/ensave",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media via en-save-net (RapidAPI)",
        description:
            "Mengunduh media dari berbagai platform menggunakan en-save-net.com yang memproksi RapidAPI `youtube-video-audio-downloader`. Mendukung: youtube, facebook, instagram, reddit, soundcloud, tiktok, x. Mengembalikan metadata + daftar tautan unduh (audio/video, berbagai resolusi).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL media (YouTube, TikTok, Instagram, Facebook, Reddit, SoundCloud, X)",
                schema: { type: "string", example: "https://youtu.be/dQw4w9WgXcQ" },
            },
            {
                name: "platform",
                in: "query",
                required: false,
                description: "Platform target. Auto-detected bila kosong.",
                schema: { type: "string", enum: PLATFORMS, default: "youtube" },
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
                                        platform: { type: "string", example: "youtube" },
                                        title: { type: "string" },
                                        uploader: { type: "string" },
                                        thumbnail: { type: "string" },
                                        duration: { type: "string" },
                                        links: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", example: "video" },
                                                    quality: { type: "string", example: "720p" },
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
            "400": {
                description: "URL atau platform tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
        },
    },

    handler: async (req, res) => {
        let { url, platform } = req.query
        if (!url || !isHttp(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        // Auto-detect platform bila kosong / "auto"
        if (!platform || platform === "auto") {
            const u = url.toLowerCase()
            if (u.includes("youtu")) platform = "youtube"
            else if (u.includes("tiktok")) platform = "tiktok"
            else if (u.includes("instagram") || u.includes("instagr.am")) platform = "instagram"
            else if (u.includes("facebook") || u.includes("fb.watch")) platform = "facebook"
            else if (u.includes("reddit")) platform = "reddit"
            else if (u.includes("soundcloud")) platform = "soundcloud"
            else if (u.includes("twitter") || u.includes("x.com")) platform = "x"
            else platform = "youtube"
        }
        if (!PLATFORMS.includes(platform)) {
            return res.status(400).json({ ok: false, error: `Platform tidak didukung. Pilih: ${PLATFORMS.join(", ")}` })
        }
        try {
            const result = await ensave(url, platform)
            res.json({ ok: true, result })
        } catch (e) {
            const status = e.response && e.response.status >= 400 && e.response.status < 500 ? 400 : 500
            const msg = e.response?.data?.message || e.message
            res.status(status).json({ ok: false, error: msg })
        }
    },
}
