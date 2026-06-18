import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const runsText = node => (node?.runs ? node.runs.map(r => r.text).join("") : node?.simpleText) || null

// Ambil ytInitialData dari HTML halaman hasil pencarian
function extractInitialData(html) {
    const m =
        html.match(/var ytInitialData = (\{.*?\});<\/script>/s) ||
        html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s)
    if (!m) throw new Error("Gagal menemukan ytInitialData pada respons YouTube")
    return JSON.parse(m[1])
}

// Telusuri seluruh struktur, kumpulkan setiap videoRenderer
function collectVideos(data) {
    const out = []
    const walk = node => {
        if (Array.isArray(node)) {
            for (const v of node) walk(v)
        } else if (node && typeof node === "object") {
            if (node.videoRenderer) out.push(node.videoRenderer)
            for (const k in node) walk(node[k])
        }
    }
    walk(data)
    return out
}

function mapVideo(v) {
    const channelEp = v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint
    const thumbs = v.thumbnail?.thumbnails || []
    return {
        videoId: v.videoId || null,
        title: runsText(v.title),
        url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : null,
        duration: runsText(v.lengthText), // null = live / belum tayang
        isLive: Boolean(v.badges?.some(b => b.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW")) || v.lengthText == null,
        views: runsText(v.viewCountText),
        published: runsText(v.publishedTimeText),
        description: runsText(v.detailedMetadataSnippets?.[0]?.snippetText),
        thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : null,
        channel: {
            name: runsText(v.ownerText),
            url: channelEp?.canonicalBaseUrl
                ? `https://www.youtube.com${channelEp.canonicalBaseUrl}`
                : channelEp?.browseId
                  ? `https://www.youtube.com/channel/${channelEp.browseId}`
                  : null,
            verified: Boolean(v.ownerBadges?.some(b => /VERIFIED/.test(b.metadataBadgeRenderer?.style || ""))),
        },
    }
}

async function search(query, limit) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    const { data: html } = await axios.get(url, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    })
    const data = extractInitialData(html)
    return collectVideos(data).filter(v => v.videoId).slice(0, limit).map(mapVideo)
}

export default {
    route: {
        method: "get",
        path: "/search/youtube",
        auth: false,
        tags: ["Search"],
        summary: "Cari video YouTube",
        description: "Mencari video langsung dari halaman hasil pencarian YouTube (parsing ytInitialData). Tanpa API key Google.",
        parameters: [
            {
                name: "q",
                in: "query",
                required: true,
                description: "Kata kunci pencarian",
                schema: { type: "string", example: "never gonna give you up" },
            },
            {
                name: "limit",
                in: "query",
                required: false,
                description: "Jumlah maksimum hasil (1-40, default 20)",
                schema: { type: "integer", default: 20, minimum: 1, maximum: 40 },
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
                                query: { type: "string" },
                                total: { type: "integer" },
                                result: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            videoId: { type: "string" },
                                            title: { type: "string" },
                                            url: { type: "string" },
                                            duration: { type: "string" },
                                            isLive: { type: "boolean" },
                                            views: { type: "string" },
                                            published: { type: "string" },
                                            description: { type: "string" },
                                            thumbnail: { type: "string" },
                                            channel: {
                                                type: "object",
                                                properties: {
                                                    name: { type: "string" },
                                                    url: { type: "string" },
                                                    verified: { type: "boolean" },
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
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const q = (req.query.q || "").toString().trim()
        if (!q) return res.status(400).json({ ok: false, error: "Parameter q wajib diisi" })
        let limit = parseInt(req.query.limit, 10)
        if (isNaN(limit)) limit = 20
        limit = Math.max(1, Math.min(40, limit))
        try {
            const result = await search(q, limit)
            res.json({ ok: true, query: q, total: result.length, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
