import axios from "axios"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"
const BASE = "https://musicfab.io"
const API = `${BASE}/api/spotify`

async function musicfab(url) {
    const { data, status } = await axios.post(API, { url }, {
        headers: {
            "User-Agent": UA,
            Accept: "*/*",
            "Content-Type": "application/json",
            Origin: BASE,
            Referer: `${BASE}/`,
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
            "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        timeout: 60000,
        validateStatus: () => true,
    })

    const meta = data?.data?.metadata || null
    if (!meta?.download) throw new Error(data?.message || `Gagal mengambil link download (HTTP ${status})`)

    const id = (String(url).match(/track\/([A-Za-z0-9]+)/) || [])[1] || null
    return {
        type: "track",
        id,
        title: meta.name || null,
        artist: meta.artist || null,
        album: meta.album || null,
        duration: meta.duration || null,
        image: meta.image || null,
        downloadUrl: meta.download,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/musicfab",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Spotify (MP3) via musicfab.io",
        description: "Mengunduh track Spotify sebagai MP3 menggunakan musicfab.io. Satu request, mengembalikan link MP3 langsung (CDN) beserta metadata.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL track Spotify",
                schema: { type: "string", example: "https://open.spotify.com/track/4bCoqCjwZggHxHcUSRpFDG" },
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
                                        type: { type: "string" },
                                        id: { type: "string" },
                                        title: { type: "string" },
                                        artist: { type: "string" },
                                        album: { type: "string" },
                                        duration: { type: "string" },
                                        image: { type: "string" },
                                        downloadUrl: { type: "string", description: "Link MP3 langsung (CDN)" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "URL Spotify tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/^https?:\/\/(open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?track\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL track Spotify tidak valid" })
        }
        try {
            const result = await musicfab(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
