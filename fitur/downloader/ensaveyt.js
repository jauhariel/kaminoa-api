import axios from "axios"

// Endpoint khusus YouTube, mengikuti halaman en-save-net.com/y2mate-video-downloader/
// Backend-nya proxy ke RapidAPI `youtube-video-audio-downloader`.
// Override key lewat env RAPIDAPI_ENSAVE_KEY untuk pakai key sendiri.
const RAPIDAPI_KEY = process.env.RAPIDAPI_ENSAVE_KEY || "12b36cb3d0mshe36b32035bbe360p13ae4ejsn004cdec46085"
const RAPIDAPI_HOST = "youtube-video-audio-downloader.p.rapidapi.com"
const INFO_URL = `https://${RAPIDAPI_HOST}/api/v1/youtube-media/info`

const YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|live\/|shorts\/)|[?&]v=)([a-zA-Z0-9-_]{11})/

function extractVideoId(url) {
    const m = String(url).match(YT_RE)
    return m ? m[1] : null
}

async function ensaveyt(youtubeUrl) {
    const { data } = await axios.get(INFO_URL, {
        params: { url: youtubeUrl },
        headers: {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": RAPIDAPI_HOST,
        },
        timeout: 15000,
    })
    if (data.status !== "success" || !data.data) {
        throw new Error(data.message || "Gagal memproses video YouTube")
    }
    const d = data.data
    const links = (d.links || []).map((l) => ({
        type: l.type || null,
        quality: l.resolution || l.quality || null,
        url: l.download_url || l.url || null,
    })).filter((l) => l.url)

    const videoId = extractVideoId(youtubeUrl)
    return {
        videoId,
        title: d.title || null,
        uploader: d.uploader || null,
        thumbnail: d.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
        duration: d.duration || null,
        links,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/ensaveyt",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube via en-save-net (RapidAPI, khusus YouTube)",
        description:
            "Mengunduh video/audio YouTube menggunakan en-save-net.com (proxy RapidAPI youtube-video-audio-downloader). Mengembalikan metadata + daftar tautan unduh: audio (mp3) dan video (360p/480p/720p/1080p). Gunakan query `type` dan `quality` untuk memfilter.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL YouTube (watch, youtu.be, shorts, live, atau embed)",
                schema: { type: "string", example: "https://youtu.be/dQw4w9WgXcQ" },
            },
            {
                name: "type",
                in: "query",
                required: false,
                description: "Filter tipe link: audio, video, atau all (default all).",
                schema: { type: "string", enum: ["all", "audio", "video"], default: "all" },
            },
            {
                name: "quality",
                in: "query",
                required: false,
                description: "Ambil satu link dengan kualitas tertentu, mis. 720p atau bestaudio. Bila cocok, field `link` terisi.",
                schema: { type: "string", example: "720p" },
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
                                        videoId: { type: "string", example: "dQw4w9WgXcQ" },
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
                                        link: {
                                            type: "object",
                                            nullable: true,
                                            description: "Link tunggal bila `quality` cocok",
                                            properties: {
                                                type: { type: "string" },
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
            "400": {
                description: "URL tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
        },
    },

    handler: async (req, res) => {
        const { url, type = "all", quality } = req.query
        if (!url || !/^https?:\/\//i.test(url) || !extractVideoId(url)) {
            return res.status(400).json({ ok: false, error: "URL YouTube tidak valid" })
        }
        try {
            const result = await ensaveyt(url)

            // filter by type
            let links = result.links
            if (type && type !== "all") {
                links = links.filter((l) => l.type === type)
            }
            result.links = links

            // pick single link by quality
            if (quality) {
                const q = String(quality).toLowerCase()
                const match =
                    (q === "bestaudio" || q === "audio"
                        ? links.find((l) => l.type === "audio")
                        : null) ||
                    links.find((l) => String(l.quality).toLowerCase() === q) ||
                    links.find((l) => String(l.quality).toLowerCase().includes(q))
                result.link = match || null
            }
            res.json({ ok: true, result })
        } catch (e) {
            const status = e.response && e.response.status >= 400 && e.response.status < 500 ? 400 : 500
            const msg = e.response?.data?.message || e.message
            res.status(status).json({ ok: false, error: msg })
        }
    },
}
