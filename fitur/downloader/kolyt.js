import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://kol.id"
const PAGE = "/download-video/youtube"
const API = "/api/v2/downloader/youtube"

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function kolyt(ytUrl) {
    // 1) ambil CSRF token + cookie sesi
    const home = await axios.get(`${BASE}${PAGE}`, { headers: { "user-agent": UA } })
    const cookies = (home.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ")
    const token = (String(home.data).match(/name="_token"\s+value="([^"]+)"/) || [])[1]
    if (!token) throw new Error("Gagal mengambil token dari kol.id")

    const headers = {
        "user-agent": UA,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        origin: BASE,
        referer: `${BASE}${PAGE}`,
        accept: "application/json, text/javascript, */*; q=0.01",
        cookie: cookies,
    }
    const body = new URLSearchParams({ _method: "POST", _token: token, url: ytUrl }).toString()

    // 2) API berbasis antrian: bisa balas hasil langsung (cached) atau di-poll
    for (let attempt = 0; attempt < 6; attempt++) {
        const { data: j } = await axios.post(`${BASE}${API}`, body, { headers, validateStatus: () => true })
        const d = j?.data

        if (d && Array.isArray(d.video)) return d
        if (j?.meta?.success === false) throw new Error(j.meta.message || "Video tidak ditemukan")

        if (d?.status_url) {
            for (let i = 0; i < 15; i++) {
                await sleep(2500)
                const { data: s } = await axios.get(d.status_url, { headers, validateStatus: () => true })
                const sd = s?.data
                if (sd && Array.isArray(sd.video)) return sd
                if (s?.meta?.success === false || sd?.status === "failed") {
                    throw new Error(s?.meta?.message || "Video tidak ditemukan atau tidak dapat diproses")
                }
            }
            break
        }
        await sleep(2000)
    }
    throw new Error("Timeout: kol.id tidak mengembalikan hasil")
}

export default {
    route: {
        method: "get",
        path: "/downloader/kolyt",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube via kol.id",
        description: "Mengunduh video/audio YouTube menggunakan kol.id. Mengembalikan tautan langsung berbagai kualitas (hingga 2160p) dan audio.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL YouTube (watch atau youtu.be)",
                schema: { type: "string", example: "https://youtu.be/dQw4w9WgXcQ" },
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
                                        thumbnail: { type: "string" },
                                        duration: { type: "integer" },
                                        channel: { type: "object" },
                                        videos: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    quality: { type: "string" },
                                                    hasAudio: { type: "boolean" },
                                                    url: { type: "string" },
                                                },
                                            },
                                        },
                                        audios: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
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
            const d = await kolyt(url)
            const all = d.video || []
            const videos = all.filter(v => v.format !== "audio" && v.url).map(v => ({ quality: v.quality, hasAudio: !!v.audio, url: v.url }))
            const audios = all.filter(v => v.format === "audio" && v.url).map(v => ({ quality: v.quality, url: v.url }))
            res.json({
                ok: true,
                result: {
                    videoId: d.video_id || null,
                    title: d.title || null,
                    thumbnail: d.thumbnail || null,
                    duration: d.length_seconds ?? null,
                    channel: d.channel || null,
                    videos,
                    audios,
                },
            })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
