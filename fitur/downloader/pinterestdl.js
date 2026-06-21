import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// Ambil id numerik dari url; pin.it / link pendek di-resolve lewat redirect.
async function resolveId(url) {
    let id = (url.match(/\/pin\/(\d+)/) || [])[1]
    if (id) return id
    const r = await axios.get(url, { headers: { "user-agent": UA }, maxRedirects: 5, validateStatus: () => true })
    const finalUrl = r.request?.res?.responseUrl || url
    id = (finalUrl.match(/\/pin\/(\d+)/) || [])[1]
    if (!id) throw new Error("Tidak bisa menemukan id pin dari URL")
    return id
}

// PinResource (tanpa login) → JSON bersih untuk semua jenis pin: video, gambar, carousel, story/idea.
async function fetchPin(id) {
    const data = encodeURIComponent(JSON.stringify({ options: { id, field_set_key: "detailed" } }))
    const { data: j } = await axios.get(`https://www.pinterest.com/resource/PinResource/get/?data=${data}`, {
        headers: { "user-agent": UA, "x-pinterest-pws-handler": "www/pin/[id].js", accept: "application/json" },
    })
    const p = j?.resource_response?.data
    if (!p || !p.id) throw new Error("Pin tidak ditemukan atau butuh login")
    return p
}

// Pilih gambar resolusi tertinggi dari objek images Pinterest ({ orig|originals|"736x": {url,width,height} }).
// Slot carousel hanya menyediakan varian berukuran (maks 736x) → bangun url originals dari path.
function pickImage(images) {
    if (!images) return null
    const best = images.orig || images.originals
    if (best?.url) return { url: best.url, width: best.width || null, height: best.height || null }
    const sized = Object.values(images).filter(v => v?.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0]
    if (!sized) return null
    return { url: sized.url.replace(/\/\d+x\d*\//, "/originals/"), width: null, height: null }
}

function videoItem(videos, index) {
    const vl = videos?.video_list
    if (!vl) return null
    const mp4 = vl.V_720P || vl.V_480P || Object.values(vl).find(v => /\.mp4(\?|$)/.test(v.url || ""))
    const hls = vl.V_HLSV4 || vl.V_HLSV3_MOBILE || Object.values(vl).find(v => /\.m3u8(\?|$)/.test(v.url || ""))
    const src = mp4 || hls
    if (!src) return null
    return {
        index,
        type: "video",
        url: (mp4 || src).url.replace(/v1-[a-z]\.pinimg\.com/, "v1.pinimg.com"),
        hls: hls ? hls.url.replace(/v1-[a-z]\.pinimg\.com/, "v1.pinimg.com") : null,
        width: src.width || null,
        height: src.height || null,
        duration: src.duration ? Math.round(src.duration / 1000) : null,
    }
}

function imageItem(images, index) {
    const img = pickImage(images)
    if (!img) return null
    const ext = (img.url.match(/\.(\w+)(?:\?|$)/) || [, "jpg"])[1]
    return { index, type: "image", url: img.url, format: ext, width: img.width, height: img.height }
}

async function pinterestdl(pinUrl) {
    const id = await resolveId(pinUrl)
    const p = await fetchPin(id)

    let type, medias
    if (p.story_pin_data?.pages?.length) {
        type = "story"
        medias = p.story_pin_data.pages.map((pg, i) =>
            pg.video?.video_list ? videoItem(pg.video, i) : imageItem(pg.image?.images, i)
        ).filter(Boolean)
    } else if (p.carousel_data?.carousel_slots?.length) {
        type = "carousel"
        medias = p.carousel_data.carousel_slots.map((s, i) =>
            s.videos?.video_list ? videoItem(s.videos, i) : imageItem(s.images, i)
        ).filter(Boolean)
    } else if (p.videos?.video_list) {
        type = "video"
        medias = [videoItem(p.videos, 0)].filter(Boolean)
    } else {
        type = "image"
        medias = [imageItem(p.images, 0)].filter(Boolean)
    }
    if (!medias.length) throw new Error("Tidak ada media yang ditemukan pada pin ini")

    const seg = (s) => (s || "").split(" | ")[0].trim()
    const title = (p.title || p.grid_title || "").trim() || seg(p.seo_title) || null
    const description = (p.description || p.seo_description || p.closeup_unified_description || "").trim() || null
    const creator = p.native_creator || p.pinner
    const cover = medias[0]?.type === "image" ? medias[0].url : (p.images?.orig?.url || pickImage(p.images)?.url || null)

    return {
        id,
        type,
        title,
        description,
        thumbnail: cover,
        uploadDate: p.created_at || null,
        author: creator
            ? {
                name: creator.full_name || null,
                username: creator.username || null,
                url: creator.username ? `https://www.pinterest.com/${creator.username}` : null,
            }
            : null,
        stats: {
            saves: p.aggregated_pin_data?.aggregated_stats?.saves ?? p.repin_count ?? null,
            comments: p.aggregated_pin_data?.aggregated_stats?.done ?? p.comment_count ?? null,
            reactions: p.reaction_counts ? Object.values(p.reaction_counts).reduce((a, b) => a + b, 0) : null,
        },
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
        description: "Mengambil media Pinterest via PinResource (tanpa pihak ketiga/login). Mendukung pin video, gambar, carousel (multi-gambar), dan story/idea pin (multi-halaman). Field `type` menandai jenis pin; `medias` berisi satu entri per media (gambar/video) lengkap dengan indeks. Mendukung link pinterest.com, id.pinterest.com, dan pin.it.",
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
                                        type: { type: "string", enum: ["video", "image", "carousel", "story"] },
                                        title: { type: "string", nullable: true },
                                        description: { type: "string", nullable: true },
                                        thumbnail: { type: "string", nullable: true },
                                        uploadDate: { type: "string", nullable: true },
                                        author: {
                                            type: "object",
                                            nullable: true,
                                            properties: {
                                                name: { type: "string", nullable: true },
                                                username: { type: "string", nullable: true },
                                                url: { type: "string", nullable: true },
                                            },
                                        },
                                        stats: {
                                            type: "object",
                                            properties: {
                                                saves: { type: "integer", nullable: true },
                                                comments: { type: "integer", nullable: true },
                                                reactions: { type: "integer", nullable: true },
                                            },
                                        },
                                        total: { type: "integer", description: "Jumlah media" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    index: { type: "integer" },
                                                    type: { type: "string", enum: ["image", "video"] },
                                                    url: { type: "string" },
                                                    format: { type: "string", description: "Ekstensi (gambar)" },
                                                    hls: { type: "string", nullable: true, description: "URL HLS adaptif (video)" },
                                                    width: { type: "integer", nullable: true },
                                                    height: { type: "integer", nullable: true },
                                                    duration: { type: "integer", nullable: true, description: "Durasi detik (video)" },
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
            "500": { description: "Kesalahan server / pin butuh login" },
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
