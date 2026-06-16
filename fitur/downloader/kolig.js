import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://kol.id"
const PAGE = "/download-video/instagram"
const API = "/api/v2/downloader/instagram"

const sleep = ms => new Promise(r => setTimeout(r, ms))

function buildMedias(data) {
    const medias = []
    if (Array.isArray(data.slides) && data.slides.length) {
        for (const s of data.slides) {
            const url = s.url || s.download_url || s.video_url || s.image_url
            if (url) medias.push({ type: s.type || (/\.mp4/.test(url) ? "video" : "image"), quality: s.quality || null, url })
        }
    } else if (data.video_url) {
        medias.push({ type: "video", quality: data.quality || null, url: data.video_url })
    } else if (data.url) {
        medias.push({ type: data.type === "video" ? "video" : "image", quality: data.quality || null, url: data.url })
    }
    return medias
}

async function kolig(igUrl) {
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
    const body = new URLSearchParams({ _method: "POST", _token: token, url: igUrl }).toString()

    // 2) API berbasis antrian: bisa balas hasil langsung (cached) atau request_id untuk di-poll
    for (let attempt = 0; attempt < 6; attempt++) {
        const { data: j } = await axios.post(`${BASE}${API}`, body, { headers, validateStatus: () => true })
        const d = j?.data

        if (d && (d.video_url || d.slides || d.url)) return d            // hasil langsung
        if (j?.meta?.success === false) throw new Error(j.meta.message || "Media tidak ditemukan")

        if (d?.status_url) {
            // poll sampai selesai
            for (let i = 0; i < 12; i++) {
                await sleep(2500)
                const { data: s } = await axios.get(d.status_url, { headers, validateStatus: () => true })
                const sd = s?.data
                if (sd && (sd.video_url || sd.slides || sd.url)) return sd
                if (s?.meta?.success === false || sd?.status === "failed") {
                    throw new Error(s?.meta?.message || "Media tidak ditemukan (post privat / URL tidak valid)")
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
        path: "/downloader/kolig",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Instagram via kol.id",
        description: "Mengunduh media Instagram (post, reels, foto, story, carousel) menggunakan kol.id. Mengembalikan URL media langsung dari cdninstagram.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Instagram (post /p/, reel /reel/, atau story)",
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
                                        title: { type: "string" },
                                        author: { type: "string" },
                                        thumbnail: { type: "string" },
                                        type: { type: "string" },
                                        total: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "image"] },
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
            const data = await kolig(url)
            const medias = buildMedias(data)
            if (!medias.length) return res.status(500).json({ ok: false, error: "Tidak ada media yang ditemukan" })
            res.json({
                ok: true,
                result: {
                    title: data.title || null,
                    author: data.author || null,
                    thumbnail: data.thumbnail || null,
                    type: data.type || (medias.length > 1 ? "slide" : medias[0].type),
                    total: medias.length,
                    medias,
                },
            })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
