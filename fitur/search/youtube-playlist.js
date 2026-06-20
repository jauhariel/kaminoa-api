import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://www.youtube.com"

// ---- ekstraksi ytInitialData (JSON balanced; HTML playlist >1MB jadi regex non-greedy tidak cukup) ----
function extractInitialData(html) {
    const marker = "var ytInitialData = "
    const start = html.indexOf(marker)
    if (start === -1) throw new Error("Gagal menemukan ytInitialData pada respons YouTube")
    const from = html.indexOf("{", start)
    let depth = 0, inStr = false, esc = false
    for (let i = from; i < html.length; i++) {
        const c = html[i]
        if (inStr) {
            if (esc) esc = false
            else if (c === "\\") esc = true
            else if (c === '"') inStr = false
            continue
        }
        if (c === '"') inStr = true
        else if (c === "{") depth++
        else if (c === "}" && --depth === 0) return JSON.parse(html.slice(from, i + 1))
    }
    throw new Error("Struktur ytInitialData tidak utuh")
}

// Konfig InnerTube (key + client version) untuk request continuation halaman berikutnya.
const innertubeConfig = html => ({
    key: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || null,
    clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || "2.20240101.00.00",
})

// Container "rekomendasi" yang YouTube tempel setelah playlist habis — JANGAN ikut dikumpulkan,
// kalau tidak playlist 100 video bisa membengkak jadi 110 (10 video saran).
const SHELF_KEYS = new Set(["horizontalShelfViewModel", "shelfRenderer", "reelShelfRenderer", "richShelfRenderer"])

// YouTube kini memakai lockupViewModel (bukan playlistVideoRenderer). Telusuri & kumpulkan video playlist
// saja: lewati subtree shelf rekomendasi.
function collectLockups(data) {
    const out = []
    const walk = node => {
        if (Array.isArray(node)) for (const v of node) walk(v)
        else if (node && typeof node === "object") {
            if (node.lockupViewModel) out.push(node.lockupViewModel)
            for (const k in node) {
                if (SHELF_KEYS.has(k)) continue
                walk(node[k])
            }
        }
    }
    walk(data)
    return out
}

// Token continuation tersembunyi di continuationItemViewModel (format baru) / continuationItemRenderer (lama).
function findContinuation(data) {
    let token = null
    const walk = node => {
        if (token) return
        if (Array.isArray(node)) for (const v of node) walk(v)
        else if (node && typeof node === "object") {
            const t =
                node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
                node.continuationItemViewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token
            if (t) { token = t; return }
            for (const k in node) walk(node[k])
        }
    }
    walk(data)
    return token
}

const lastSource = sources => sources?.length ? sources[sources.length - 1].url : null

// Durasi diambil dari badge overlay thumbnail ("5:06"); null = live / tidak ada.
function lockupDuration(lv) {
    const overlays = lv?.contentImage?.thumbnailViewModel?.overlays || []
    for (const o of overlays) {
        const badges = o?.thumbnailBottomOverlayViewModel?.badges || []
        for (const b of badges) {
            const text = b?.thumbnailBadgeViewModel?.text
            if (text && /^\d+:\d/.test(text)) return text
        }
    }
    return null
}

function mapLockup(lv) {
    const videoId = lv?.contentId || null
    const meta = lv?.metadata?.lockupMetadataViewModel
    const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || []

    // Baris 0: channel (+ link). Baris 1: views & waktu publish.
    const chPart = rows[0]?.metadataParts?.[0]
    const chName = chPart?.text?.content || null
    const chUrl = chPart?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || null

    const statParts = (rows[1]?.metadataParts || []).map(p => p?.text?.content).filter(Boolean)
    const views = statParts.find(t => /view/i.test(t)) || statParts[0] || null
    const published = statParts.find(t => /ago|tayang|lalu/i.test(t)) || statParts[1] || null

    return {
        videoId,
        title: meta?.title?.content || null,
        url: videoId ? `${BASE}/watch?v=${videoId}` : null,
        duration: lockupDuration(lv),
        views,
        published,
        thumbnail: lastSource(lv?.contentImage?.thumbnailViewModel?.image?.sources),
        channel: {
            name: chName,
            url: chUrl ? (chUrl.startsWith("http") ? chUrl : BASE + chUrl) : null,
        },
    }
}

// Metadata playlist dari pageHeaderRenderer + microformat.
function playlistMeta(data) {
    const ph = data?.header?.pageHeaderRenderer
    const vm = ph?.content?.pageHeaderViewModel
    const rows = vm?.metadata?.contentMetadataViewModel?.metadataRows || []

    const ownerRow = rows.find(r => r?.metadataParts?.some(p => p?.avatarStack))
    const owner = (ownerRow?.metadataParts?.find(p => p?.avatarStack)?.avatarStack?.avatarStackViewModel?.text?.content || "")
        .replace(/^by\s+/i, "") || null

    const statRow = rows.find(r => r?.metadataParts?.some(p => /video/i.test(p?.text?.content || "")))
    const stats = (statRow?.metadataParts || []).map(p => p?.text?.content).filter(Boolean)
    const videoCount = (() => {
        const t = stats.find(s => /video/i.test(s))
        const n = t && t.replace(/[.,]/g, "").match(/\d+/)
        return n ? Number(n[0]) : null
    })()

    const mf = data?.microformat?.microformatDataRenderer
    return {
        title: ph?.pageTitle || mf?.title || null,
        owner,
        description: vm?.description?.descriptionPreviewViewModel?.description?.content || mf?.description || null,
        videoCount,
        views: stats.find(s => /view/i.test(s)) || null,
        cover: lastSource(mf?.thumbnail?.thumbnails) || null,
    }
}

async function fetchContinuation(token, cfg) {
    const { data } = await axios.post(
        `${BASE}/youtubei/v1/browse?key=${cfg.key}`,
        { context: { client: { clientName: "WEB", clientVersion: cfg.clientVersion, hl: "en" } }, continuation: token },
        { headers: { "user-agent": UA, "content-type": "application/json", origin: BASE, referer: `${BASE}/` }, timeout: 30000 }
    )
    return data
}

async function scrape(listId, max) {
    const url = `${BASE}/playlist?list=${listId}&hl=en`
    const { data: html, status } = await axios.get(url, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        timeout: 30000,
        validateStatus: () => true,
    })
    if (status === 404) throw new Error("Playlist tidak ditemukan (privat / dihapus / URL salah)")
    if (status !== 200) throw new Error(`YouTube HTTP ${status}`)
    const data = extractInitialData(html)
    const cfg = innertubeConfig(html)

    const meta = playlistMeta(data)
    const seen = new Set()
    const videos = []
    const add = lockups => {
        let added = 0
        for (const lv of lockups) {
            const v = mapLockup(lv)
            if (!v.videoId || seen.has(v.videoId)) continue
            seen.add(v.videoId)
            videos.push(v)
            added++
        }
        return added
    }
    add(collectLockups(data))
    if (!videos.length && !meta.title) throw new Error("Playlist tidak ditemukan (privat / dihapus / URL salah)")

    // Batas atas: limit dari user, atau jumlah video resmi dari YouTube (cegah ikut shelf rekomendasi).
    const cap = max || meta.videoCount || Infinity

    let token = findContinuation(data)
    // Paginasi sampai habis (atau mencapai batas).
    while (token && videos.length < cap) {
        const page = await fetchContinuation(token, cfg)
        if (!add(collectLockups(page))) break
        token = findContinuation(page)
    }

    const tracks = videos.length > cap ? videos.slice(0, cap) : videos
    return { id: listId, url: `${BASE}/playlist?list=${listId}`, ...meta, count: tracks.length, tracks }
}

export default {
    route: {
        method: "get",
        path: "/search/youtube-playlist",
        auth: false,
        tags: ["Search"],
        summary: "Scrape playlist YouTube",
        description: "Mengambil SEMUA video dari sebuah playlist YouTube (tanpa batas 100 — paginasi otomatis via continuation token InnerTube). Tiap video menyertakan URL watch yang bisa diteruskan ke downloader YouTube (mis. /downloader/savetube). Tanpa API key Google.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL playlist YouTube atau ID playlist (PL..., OLAK..., dst.)",
                schema: { type: "string", example: "https://youtube.com/playlist?list=PL4fGSI1pDJn5QPpj0R4vVgRWk8sSq549G" },
            },
            {
                name: "limit",
                in: "query",
                required: false,
                description: "Batasi jumlah video yang diambil (default: semua). Berguna untuk playlist sangat besar.",
                schema: { type: "integer", minimum: 1 },
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
                                        url: { type: "string" },
                                        title: { type: "string" },
                                        owner: { type: "string", description: "Pembuat playlist" },
                                        description: { type: "string" },
                                        videoCount: { type: "integer", description: "Jumlah video menurut YouTube" },
                                        views: { type: "string" },
                                        cover: { type: "string" },
                                        count: { type: "integer", description: "Jumlah video ter-scrape" },
                                        tracks: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    videoId: { type: "string" },
                                                    title: { type: "string" },
                                                    url: { type: "string", description: "URL watch YouTube" },
                                                    duration: { type: "string", description: "mm:ss (null jika live)" },
                                                    views: { type: "string" },
                                                    published: { type: "string" },
                                                    thumbnail: { type: "string" },
                                                    channel: {
                                                        type: "object",
                                                        properties: {
                                                            name: { type: "string" },
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
                },
            },
            "400": { description: "URL tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const raw = String(req.query.url || "").trim()
        // Terima URL lengkap atau ID playlist langsung.
        const listId = raw.match(/[?&]list=([A-Za-z0-9_-]+)/)?.[1] || (/^[A-Za-z0-9_-]{13,}$/.test(raw) ? raw : null)
        if (!listId) return res.status(400).json({ ok: false, error: "URL atau ID playlist YouTube tidak valid" })

        let max = parseInt(req.query.limit, 10)
        if (isNaN(max) || max < 1) max = 0

        try {
            const result = await scrape(listId, max)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
