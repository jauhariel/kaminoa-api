import axios from "axios"

// Endpoint IG API v1. Primary i.instagram.com sering balikin 404 dari IP server,
// jadi www.instagram.com dipakai sebagai jalur utama (terverifikasi jalan dgn cookie).
const API = "https://www.instagram.com/api/v1"
const IG_APP_ID = "936619743392459"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
const EMBED_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

// Cookie IG dari env (jangan hardcode). Isi minimal: "csrftoken=...; sessionid=...".
// Kalau kosong/expired, endpoint otomatis turun ke jalur embed (no-login) tanpa video_url.
function getCookie() {
    return process.env.IG_COOKIE || ""
}

function extractCookie(raw, name) {
    if (!raw) return ""
    const m = raw.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]+)`))
    return m ? m[1] : ""
}

// Ambil shortcode dari url post/reel/tv.
function resolveShortcode(url) {
    const code = (url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[1]
    if (!code) throw new Error("Tidak bisa menemukan shortcode dari URL")
    return code
}

// Konversi shortcode (base64 IG) ke media id numerik.
function shortcodeToMediaId(shortcode) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    let id = 0n
    for (const ch of shortcode) id = id * 64n + BigInt(alphabet.indexOf(ch))
    return id.toString()
}

function buildHeaders(cookieStr) {
    return {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://www.instagram.com/",
        Cookie: cookieStr,
        "X-IG-App-ID": IG_APP_ID,
        "X-CSRFToken": extractCookie(cookieStr, "csrftoken"),
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        Connection: "keep-alive",
    }
}

// Pilih thumbnail resolusi tertinggi dari image_versions2.candidates.
function bestThumb(node) {
    const cands = node?.image_versions2?.candidates || []
    const top = cands.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]
    return top?.url || node?.display_url || node?.thumbnail_src || null
}

// Format satu slot media (dipakai untuk single & tiap child carousel).
function formatMedia(node, index) {
    return {
        index,
        type: node.media_type === 2 ? "video" : "image",
        thumbnail: bestThumb(node),
        // video_versions[0] = resolusi tertinggi; type 101 = varian HD kalau ada.
        url: node.media_type === 2
            ? (node.video_versions?.find(v => v.type === 101)?.url || node.video_versions?.[0]?.url || null)
            : (node.image_versions2?.candidates?.[0]?.url || null),
        width: node.original_width || node.image_versions2?.candidates?.[0]?.width || null,
        height: node.original_height || node.image_versions2?.candidates?.[0]?.height || null,
        duration: node.media_type === 2 ? (node.video_duration ?? null) : null,
    }
}

// Susun object hasil dari raw item /media/info/.
function formatItem(item, shortcode, mediaId) {
    const captionText = item.caption?.text || null
    const typeMap = { 1: "image", 2: "video", 8: "carousel" }
    const children = item.carousel_media || [item]
    const medias = children.map((n, i) => formatMedia(n, i))
    const music = item.clips_metadata?.music_info?.music_asset_info || item.music_asset_info || null

    return {
        id: String(item.pk),
        shortcode: item.code || shortcode,
        media_id: mediaId,
        type: typeMap[item.media_type] || "video",
        product_type: item.product_type || null,
        is_reel: item.product_type === "clips",
        description: captionText,
        hashtags: captionText?.match(/#[\w]+/g) || [],
        mentions: captionText?.match(/@[\w.]+/g) || [],
        author: {
            username: item.user?.username || null,
            id: item.user?.pk ? String(item.user.pk) : null,
            full_name: item.user?.full_name || null,
            verified: item.user?.is_verified ?? null,
            profile_pic_url: item.user?.profile_pic_url || null,
            url: item.user?.username ? `https://www.instagram.com/${item.user.username}` : null,
        },
        stats: {
            likes: item.like_count ?? null,
            comments: item.comment_count ?? null,
            views: item.play_count ?? item.view_count ?? null,
        },
        music: music ? { title: music.title || null, artist: music.display_artist || null } : null,
        has_audio: item.has_audio ?? (item.clips_metadata?.audio_type === "ORIGINAL_AUDIO") ?? false,
        takenAt: item.taken_at ?? null,
        takenAtISO: item.taken_at ? new Date(item.taken_at * 1000).toISOString() : null,
        thumbnail: medias[0]?.thumbnail || null,
        total: medias.length,
        medias,
        source: "api",
    }
}

// Jalur embed (no-login): metadata lengkap TAPI tanpa url video. Dipakai sebagai fallback
// kalau cookie kosong/expired. gql_data ter-escape sekali di halaman /embed/captioned/.
async function fetchEmbed(shortcode, mediaId) {
    const { data: html } = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
        headers: { "user-agent": EMBED_UA, accept: "text/html" },
        timeout: 25000,
    })
    const at = html.indexOf('\\"gql_data\\"')
    if (at === -1) throw new Error("Post tidak ditemukan, privat, atau sudah dihapus")
    const un = html.slice(at).replace(/\\"/g, '"').replace(/\\\\\//g, "/").replace(/\\\\/g, "\\")
    const start = un.indexOf("{")
    let depth = 0, end = -1
    for (let k = start; k < un.length; k++) {
        if (un[k] === "{") depth++
        else if (un[k] === "}" && --depth === 0) { end = k + 1; break }
    }
    let sm
    try { sm = JSON.parse(un.slice(start, end)).shortcode_media } catch { throw new Error("Gagal mem-parse data post") }
    if (!sm) throw new Error("Data post tidak tersedia")

    const typeMap = { GraphSidecar: "carousel", GraphVideo: "video", GraphImage: "image" }
    const children = sm.edge_sidecar_to_children?.edges?.map(e => e.node) || [sm]
    const caption = sm.edge_media_to_caption?.edges?.[0]?.node?.text || null
    const owner = sm.owner || {}

    return {
        id: sm.id,
        shortcode: sm.shortcode || shortcode,
        media_id: mediaId,
        type: typeMap[sm.__typename] || (sm.is_video ? "video" : "image"),
        product_type: null,
        is_reel: sm.__typename === "GraphVideo",
        description: caption,
        hashtags: caption?.match(/#[\w]+/g) || [],
        mentions: caption?.match(/@[\w.]+/g) || [],
        author: {
            username: owner.username || null,
            id: owner.id || null,
            full_name: owner.full_name || null,
            verified: owner.is_verified ?? null,
            profile_pic_url: owner.profile_pic_url || null,
            url: owner.username ? `https://www.instagram.com/${owner.username}` : null,
        },
        stats: {
            likes: sm.edge_liked_by?.count ?? sm.edge_media_preview_like?.count ?? null,
            comments: sm.edge_media_to_comment?.count ?? sm.edge_media_to_parent_comment?.count ?? null,
            views: sm.video_view_count ?? null,
        },
        music: null,
        has_audio: sm.has_audio ?? false,
        takenAt: sm.taken_at_timestamp ?? null,
        takenAtISO: sm.taken_at_timestamp ? new Date(sm.taken_at_timestamp * 1000).toISOString() : null,
        thumbnail: sm.display_url || null,
        total: children.length,
        // Embed logged-out tidak mengekspos url video → url null untuk slot video.
        medias: children.map((n, i) => ({
            index: i,
            type: n.is_video ? "video" : "image",
            thumbnail: n.display_url || null,
            url: n.is_video ? (n.video_url || null) : (n.display_url || null),
            width: n.dimensions?.width || null,
            height: n.dimensions?.height || null,
            duration: null,
        })),
        source: "embed",
    }
}

async function instagram2(postUrl) {
    const shortcode = resolveShortcode(postUrl)
    const mediaId = shortcodeToMediaId(shortcode)
    const cookie = getCookie()

    // Coba jalur login dulu (dapat video_url HD) kalau cookie tersedia.
    // Pakai fetch native, bukan axios: axios kena redirect-loop 302 (redirect-to-self)
    // di /media/info/ walau header identik, sedangkan fetch dapat 200 langsung.
    if (extractCookie(cookie, "sessionid")) {
        try {
            const resp = await fetch(`${API}/media/${mediaId}/info/`, {
                headers: buildHeaders(cookie),
                signal: AbortSignal.timeout(20000),
            })
            // Cookie expired → IG redirect ke login / balikin non-JSON. Anggap gagal → embed.
            if (resp.ok && (resp.headers.get("content-type") || "").includes("json")) {
                const data = await resp.json()
                const item = data?.items?.[0]
                if (item?.pk) return formatItem(item, shortcode, mediaId)
            }
        } catch (e) {
            console.error(`[instagram2] jalur login gagal, fallback embed: ${e.message}`)
        }
    }

    // Fallback: embed no-login (video_url tidak tersedia).
    return fetchEmbed(shortcode, mediaId)
}

export default {
    route: {
        method: "get",
        path: "/downloader/instagram2",
        auth: false,
        tags: ["Downloader"],
        summary: "Info + media Instagram (video HD via cookie login, fallback embed)",
        description: "Mengambil metadata + media post/reel Instagram lewat API v1 (/media/info/). Jika cookie login (env IG_COOKIE) tersedia, mengembalikan url video HD asli, durasi, musik, dan play_count. Bila cookie kosong/expired, otomatis turun ke jalur embed (tanpa login) yang tetap memberi metadata + thumbnail namun tanpa url video. Field `source` menandai jalur yang dipakai (\"api\" atau \"embed\"). Mendukung /p/, /reel/, /tv/ termasuk carousel.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL post/reel Instagram",
                schema: { type: "string", example: "https://www.instagram.com/reel/DaRa2oLTlIo/" },
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
                                        media_id: { type: "string" },
                                        type: { type: "string", enum: ["video", "image", "carousel"] },
                                        product_type: { type: "string", nullable: true },
                                        is_reel: { type: "boolean" },
                                        description: { type: "string", nullable: true },
                                        hashtags: { type: "array", items: { type: "string" } },
                                        mentions: { type: "array", items: { type: "string" } },
                                        author: {
                                            type: "object",
                                            properties: {
                                                username: { type: "string", nullable: true },
                                                id: { type: "string", nullable: true },
                                                full_name: { type: "string", nullable: true },
                                                verified: { type: "boolean", nullable: true },
                                                profile_pic_url: { type: "string", nullable: true },
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
                                        music: {
                                            type: "object",
                                            nullable: true,
                                            properties: {
                                                title: { type: "string", nullable: true },
                                                artist: { type: "string", nullable: true },
                                            },
                                        },
                                        has_audio: { type: "boolean" },
                                        takenAt: { type: "integer", nullable: true, description: "Unix timestamp (detik)" },
                                        takenAtISO: { type: "string", nullable: true },
                                        thumbnail: { type: "string", nullable: true },
                                        total: { type: "integer" },
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
                                                    duration: { type: "number", nullable: true },
                                                },
                                            },
                                        },
                                        source: { type: "string", enum: ["api", "embed"], description: "Jalur data: api (login, ada video_url) atau embed (no-login)" },
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
            const result = await instagram2(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
