import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// Scrape langsung dari halaman pin Pinterest (tanpa layanan pihak ketiga).
// Pin video menanam <script data-test-id="video-snippet"> berisi VideoObject (schema.org)
// — sumber paling bersih untuk metadata + url mp4 720p. URL kualitas lain (hls) diambil dari raw page.
async function pinterestdl(pinUrl) {
    const { data: html, request } = await axios.get(pinUrl, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        maxRedirects: 5,
    })

    // id final setelah redirect (pin.it → pinterest.com/pin/<id>)
    const finalUrl = request?.res?.responseUrl || pinUrl
    const id = (finalUrl.match(/\/pin\/(\d+)/) || pinUrl.match(/\/pin\/(\d+)/) || [])[1] || null

    const ld = html.match(/<script[^>]*data-test-id="video-snippet"[^>]*>([\s\S]*?)<\/script>/)
    if (!ld) throw new Error("Pin ini bukan video (tidak ditemukan data video)")
    let v
    try {
        v = JSON.parse(ld[1])
    } catch {
        throw new Error("Gagal membaca data video dari halaman")
    }

    // kumpulkan semua kualitas dari raw page, normalkan host CDN ke v1.pinimg.com, dedup per-url
    const norm = (u) => u.replace("v1-c.pinimg.com", "v1.pinimg.com")
    const mp4s = new Map()
    for (const m of html.matchAll(/https:\/\/v1[^"'\\\s]*\/(\d+p)\/[^"'\\\s]+\.mp4/g)) {
        const url = norm(m[0])
        if (!mp4s.has(url)) mp4s.set(url, m[1])
    }
    const hls = [...new Set([...html.matchAll(/https:\/\/v1[^"'\\\s]*\/hls\/[^"'\\\s]+\.m3u8/g)].map(m => norm(m[0])))]

    const medias = []
    if (mp4s.size) {
        for (const [url, quality] of mp4s) medias.push({ quality, format: "mp4", url })
    } else if (v.contentUrl) {
        medias.push({ quality: (v.contentUrl.match(/\/(\d+p)\//) || [, "sd"])[1], format: "mp4", url: norm(v.contentUrl) })
    }
    if (hls[0]) medias.push({ quality: "adaptive", format: "hls", url: hls[0] })
    if (!medias.length) throw new Error("Tidak ada media video yang ditemukan")

    const durMatch = (v.duration || "").match(/PT(?:(\d+)M)?(\d+)S/)
    const duration = durMatch ? Number(durMatch[1] || 0) * 60 + Number(durMatch[2] || 0) : null
    const stat = (t) => (v.interactionStatistic || []).find(s => (s.interactionType?.["@type"] || "").includes(t))?.userInteractionCount ?? null

    return {
        id,
        title: v.name || null,
        description: v.description || null,
        thumbnail: v.thumbnailUrl || null,
        duration,
        width: v.width ? Number(String(v.width).replace(/\D/g, "")) : null,
        height: v.height ? Number(String(v.height).replace(/\D/g, "")) : null,
        uploadDate: v.uploadDate || null,
        author: v.creator
            ? { name: v.creator.name || null, username: v.creator.alternateName || null, url: v.creator.url || null }
            : null,
        stats: { views: stat("Watch"), likes: stat("Like"), shares: stat("Share") },
        total: medias.length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/pinterest",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video Pinterest (scrape langsung)",
        description: "Mengambil video Pinterest dengan scrape langsung halaman pin (tanpa pihak ketiga). Output url mp4 720p + HLS adaptif beserta metadata. Mendukung link pinterest.com, id.pinterest.com, dan pin.it.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL pin Pinterest (pinterest.com/pin/..., id.pinterest.com, atau pin.it)",
                schema: { type: "string", example: "https://id.pinterest.com/pin/647251777700449964/" },
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
                                        description: { type: "string" },
                                        thumbnail: { type: "string" },
                                        duration: { type: "integer", description: "Durasi (detik)" },
                                        width: { type: "integer" },
                                        height: { type: "integer" },
                                        uploadDate: { type: "string" },
                                        author: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string" },
                                                username: { type: "string" },
                                                url: { type: "string" },
                                            },
                                        },
                                        stats: {
                                            type: "object",
                                            properties: {
                                                views: { type: "integer" },
                                                likes: { type: "integer" },
                                                shares: { type: "integer" },
                                            },
                                        },
                                        total: { type: "integer" },
                                        medias: {
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
            "400": { description: "URL tidak valid" },
            "500": { description: "Kesalahan server / pin bukan video" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/pinterest\.com\/pin\/|pin\.it\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Pinterest tidak valid" })
        }
        try {
            const result = await pinterestdl(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
