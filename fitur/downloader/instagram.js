import axios from "axios"

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

// Ambil shortcode dari url post/reel/tv (instagram.com/p|reel|tv/<code>/...).
function resolveShortcode(url) {
    const code = (url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[1]
    if (!code) throw new Error("Tidak bisa menemukan shortcode dari URL")
    return code
}

// Media id Instagram menyimpan timestamp pembuatan di high-bits (epoch IG 24 Agt 2011).
// (id >> 23) + 1314220021721 = milidetik. Terverifikasi cocok dengan taken_at_timestamp asli.
function timestampFromId(id) {
    try {
        const ms = (BigInt(id) >> 23n) + 1314220021721n
        return Math.floor(Number(ms) / 1000)
    } catch {
        return null
    }
}

// Halaman /embed/captioned/ menyertakan blob gql_data (JSON ter-escape sekali) berisi
// shortcode_media lengkap: caption, like, komen, owner, dan media — semuanya tanpa login.
async function fetchShortcodeMedia(shortcode) {
    const { data: html } = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
        headers: { "user-agent": UA, accept: "text/html" },
        timeout: 25000,
    })
    const at = html.indexOf('\\"gql_data\\"')
    if (at === -1) throw new Error("Post tidak ditemukan, privat, atau sudah dihapus")
    // Unescape satu lapis lalu potong objek dengan brace-matching.
    const un = html.slice(at).replace(/\\"/g, '"').replace(/\\\\\//g, "/").replace(/\\\\/g, "\\")
    const start = un.indexOf("{")
    let depth = 0, end = -1
    for (let k = start; k < un.length; k++) {
        const c = un[k]
        if (c === "{") depth++
        else if (c === "}" && --depth === 0) { end = k + 1; break }
    }
    let sm
    try {
        sm = JSON.parse(un.slice(start, end)).shortcode_media
    } catch {
        throw new Error("Gagal mem-parse data post")
    }
    if (!sm) throw new Error("Data post tidak tersedia")
    return sm
}

// Pilih url gambar resolusi tertinggi dari display_resources, fallback ke display_url.
function bestImage(node) {
    const res = node.display_resources || []
    const top = res.slice().sort((a, b) => (b.config_width || 0) - (a.config_width || 0))[0]
    return {
        url: top?.src || node.display_url || null,
        width: top?.config_width || node.dimensions?.width || null,
        height: top?.config_height || node.dimensions?.height || null,
    }
}

function mediaItem(node, index) {
    const img = bestImage(node)
    return {
        index,
        type: node.is_video ? "video" : "image",
        thumbnail: node.display_url || img.url,
        // Logged-out embed tidak mengekspos url video; tetap sertakan thumbnail untuk video.
        url: node.is_video ? (node.video_url || null) : img.url,
        width: img.width,
        height: img.height,
    }
}

async function instagram(postUrl) {
    const shortcode = resolveShortcode(postUrl)
    const sm = await fetchShortcodeMedia(shortcode)

    const typeMap = { GraphSidecar: "carousel", GraphVideo: "video", GraphImage: "image" }
    const type = typeMap[sm.__typename] || (sm.is_video ? "video" : "image")

    const children = sm.edge_sidecar_to_children?.edges?.map(e => e.node) || [sm]
    const medias = children.map((n, i) => mediaItem(n, i))

    const owner = sm.owner || {}
    const caption = sm.edge_media_to_caption?.edges?.[0]?.node?.text || null
    const ts = timestampFromId(sm.id)

    return {
        id: sm.id,
        shortcode: sm.shortcode || shortcode,
        type,
        description: caption,
        author: {
            username: owner.username || null,
            id: owner.id || null,
            verified: owner.is_verified ?? null,
            followers: owner.edge_followed_by?.count ?? null,
            url: owner.username ? `https://www.instagram.com/${owner.username}` : null,
        },
        stats: {
            likes: sm.edge_liked_by?.count ?? sm.edge_media_preview_like?.count ?? null,
            comments: sm.edge_media_to_comment?.count ?? sm.edge_media_to_parent_comment?.count ?? null,
            views: sm.video_view_count ?? null,
        },
        takenAt: ts,
        takenAtISO: ts ? new Date(ts * 1000).toISOString() : null,
        thumbnail: sm.display_url || medias[0]?.thumbnail || null,
        total: medias.length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/instagram",
        auth: false,
        tags: ["Downloader"],
        summary: "Info post Instagram: deskripsi, like, komentar, author, waktu (scrape langsung)",
        description: "Mengambil metadata post/reel Instagram via halaman embed (tanpa login/pihak ketiga): deskripsi (caption), jumlah like & komentar, author (username, id, verified, followers), dan waktu post. Waktu diturunkan dari high-bits media id. Mendukung link /p/, /reel/, dan /tv/. Field `medias` berisi thumbnail tiap slot (carousel didukung).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL post/reel Instagram",
                schema: { type: "string", example: "https://www.instagram.com/p/DaHSc8TjxAW/" },
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
                                        shortcode: { type: "string" },
                                        type: { type: "string", enum: ["video", "image", "carousel"] },
                                        description: { type: "string", nullable: true },
                                        author: {
                                            type: "object",
                                            properties: {
                                                username: { type: "string", nullable: true },
                                                id: { type: "string", nullable: true },
                                                verified: { type: "boolean", nullable: true },
                                                followers: { type: "integer", nullable: true },
                                                url: { type: "string", nullable: true },
                                            },
                                        },
                                        stats: {
                                            type: "object",
                                            properties: {
                                                likes: { type: "integer", nullable: true },
                                                comments: { type: "integer", nullable: true },
                                                views: { type: "integer", nullable: true },
                                            },
                                        },
                                        takenAt: { type: "integer", nullable: true, description: "Unix timestamp (detik)" },
                                        takenAtISO: { type: "string", nullable: true },
                                        thumbnail: { type: "string", nullable: true },
                                        total: { type: "integer", description: "Jumlah media" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    index: { type: "integer" },
                                                    type: { type: "string", enum: ["image", "video"] },
                                                    thumbnail: { type: "string", nullable: true },
                                                    url: { type: "string", nullable: true },
                                                    width: { type: "integer", nullable: true },
                                                    height: { type: "integer", nullable: true },
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
            "500": { description: "Kesalahan server / post privat / dihapus" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/instagram\.com\/(?:p|reel|reels|tv)\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Instagram tidak valid" })
        }
        try {
            const result = await instagram(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
