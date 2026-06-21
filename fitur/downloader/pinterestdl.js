import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const numOrNull = (x) => (x != null ? Number(String(x).replace(/\D/g, "")) || null : null)
const statCount = (ld, type) => (ld?.interactionStatistic || []).find(s => (s.interactionType?.["@type"] || "").includes(type))?.userInteractionCount ?? null
const parseSnippet = (html, testId) => {
    const m = html.match(new RegExp(`<script[^>]*data-test-id="${testId}"[^>]*>([\\s\\S]*?)<\\/script>`))
    if (!m) return null
    try { return JSON.parse(m[1]) } catch { return null }
}

// Scrape langsung dari halaman pin Pinterest (tanpa layanan pihak ketiga).
// - Pin video: <script data-test-id="video-snippet"> berisi VideoObject (schema.org) → mp4 720p + metadata; url HLS dari raw page.
// - Pin gambar: <script data-test-id="leaf-snippet"> berisi SocialMediaPosting → url gambar original + metadata.
async function pinterestdl(pinUrl) {
    const { data: html, request } = await axios.get(pinUrl, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        maxRedirects: 5,
    })

    // id final setelah redirect (pin.it → pinterest.com/pin/<id>)
    const finalUrl = request?.res?.responseUrl || pinUrl
    const id = (finalUrl.match(/\/pin\/(\d+)/) || pinUrl.match(/\/pin\/(\d+)/) || [])[1] || null

    const video = parseSnippet(html, "video-snippet") // VideoObject — hanya pin video
    const leaf = parseSnippet(html, "leaf-snippet")   // SocialMediaPosting — ada di semua pin

    if (video) {
        // kumpulkan semua kualitas dari raw page, normalkan host CDN ke v1.pinimg.com, dedup per-url
        const norm = (u) => u.replace(/v1-[a-z]\.pinimg\.com/, "v1.pinimg.com")
        const mp4s = new Map()
        for (const m of html.matchAll(/https:\/\/v1[^"'\\\s]*\/(\d+p)\/[^"'\\\s]+\.mp4/g)) {
            const url = norm(m[0])
            if (!mp4s.has(url)) mp4s.set(url, m[1])
        }
        const hls = [...new Set([...html.matchAll(/https:\/\/v1[^"'\\\s]*\/hls\/[^"'\\\s]+\.m3u8/g)].map(m => norm(m[0])))]

        const medias = []
        if (mp4s.size) {
            for (const [url, quality] of mp4s) medias.push({ quality, format: "mp4", url })
        } else if (video.contentUrl) {
            medias.push({ quality: (video.contentUrl.match(/\/(\d+p)\//) || [, "sd"])[1], format: "mp4", url: norm(video.contentUrl) })
        }
        if (hls[0]) medias.push({ quality: "adaptive", format: "hls", url: hls[0] })
        if (!medias.length) throw new Error("Tidak ada media video yang ditemukan")

        const dm = (video.duration || "").match(/PT(?:(\d+)M)?(\d+)S/)
        return {
            id,
            type: "video",
            title: video.name || null,
            description: video.description || null,
            thumbnail: video.thumbnailUrl || null,
            duration: dm ? Number(dm[1] || 0) * 60 + Number(dm[2] || 0) : null,
            width: numOrNull(video.width),
            height: numOrNull(video.height),
            uploadDate: video.uploadDate || null,
            author: video.creator
                ? { name: video.creator.name || null, username: video.creator.alternateName || null, url: video.creator.url || null }
                : null,
            stats: { views: statCount(video, "Watch"), likes: statCount(video, "Like"), shares: statCount(video, "Share"), saves: statCount(leaf, "Like") },
            total: medias.length,
            medias,
        }
    }

    // pin gambar
    const orig = leaf?.image
    if (!orig) throw new Error("Tidak ada media yang ditemukan (pin bukan video/gambar atau butuh login)")
    const ext = (orig.match(/\.(\w+)(?:\?|$)/) || [, "jpg"])[1]
    const medias = [{ quality: "original", format: ext, url: orig }]
    if (orig.includes("/originals/")) medias.push({ quality: "736x", format: ext, url: orig.replace("/originals/", "/736x/") })

    return {
        id,
        type: "image",
        title: leaf.headline || null,
        description: leaf.articleBody || null,
        thumbnail: orig,
        duration: null,
        width: null,
        height: null,
        uploadDate: leaf.datePublished || null,
        author: leaf.author
            ? { name: leaf.author.name || null, username: leaf.author.alternateName || null, url: leaf.author.url || null }
            : null,
        stats: { views: null, likes: null, shares: null, saves: statCount(leaf, "Like") },
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
        summary: "Download video/gambar Pinterest (scrape langsung)",
        description: "Mengambil video atau gambar Pinterest dengan scrape langsung halaman pin (tanpa pihak ketiga). Pin video → mp4 720p + HLS adaptif; pin gambar → url original (+ 736x). Field `type` menandai jenis pin. Mendukung link pinterest.com, id.pinterest.com, dan pin.it.",
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
                                        type: { type: "string", enum: ["video", "image"] },
                                        title: { type: "string" },
                                        description: { type: "string" },
                                        thumbnail: { type: "string" },
                                        duration: { type: "integer", nullable: true, description: "Durasi detik (null untuk gambar)" },
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
                                                views: { type: "integer", nullable: true },
                                                likes: { type: "integer", nullable: true },
                                                shares: { type: "integer", nullable: true },
                                                saves: { type: "integer", nullable: true },
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
