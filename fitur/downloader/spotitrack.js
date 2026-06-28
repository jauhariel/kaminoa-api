import { upload } from "../../lib/uploader.js"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
const BASE = "https://spotitrack.com"

// next-router-state-tree default yang dikirim React Server Actions saat POST.
const ROUTER_TREE =
    "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22locale%22%2C%22en%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D"

// Token Server Action (Next.js) TIDAK ada di HTML — ia tertanam di salah satu JS
// chunk sebagai `createServerReference)("<id>")` dan id-nya berubah tiap rebuild.
// Emergency fallback dipakai hanya bila discovery & cache dua-duanya gagal.
const LAST_KNOWN_ACTION = "40140d41ab0803c936eac316edb1fbc6b036e5478f"
const TOKEN_TTL = 30 * 60 * 1000 // cache 30 menit: hindari fetch 18 chunk tiap request
let tokenCache = { value: null, ts: 0 }

// Telusuri homepage -> daftar chunk -> token createServerReference pertama.
async function discoverActionToken() {
    const html = await (await fetch(`${BASE}/`, { headers: { "user-agent": UA } })).text()
    const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"]+?\.js/g)].map(m => m[0]))]
    if (!chunks.length) throw new Error("Tidak ada chunk JS di homepage")

    const tokens = await Promise.all(
        chunks.map(async c => {
            try {
                const js = await (await fetch(BASE + c, { headers: { "user-agent": UA } })).text()
                return js.match(/createServerReference\)\("([a-f0-9]{30,})"/)?.[1] || null
            } catch {
                return null
            }
        }),
    )
    const token = tokens.find(Boolean)
    if (!token) throw new Error("Token Server Action tidak ditemukan di chunk manapun")
    return token
}

// Token dengan cache + fallback berlapis. force=true memaksa discovery ulang.
async function getActionToken(force = false) {
    if (!force && tokenCache.value && Date.now() - tokenCache.ts < TOKEN_TTL) return tokenCache.value
    try {
        const token = await discoverActionToken()
        tokenCache = { value: token, ts: Date.now() }
        return token
    } catch (e) {
        if (tokenCache.value) return tokenCache.value // pakai cache lama walau basi
        return LAST_KNOWN_ACTION // benar-benar last resort
    }
}

// POST Server Action -> balasan text/x-component baris "1:{json}" berisi metadata.
// Self-heal: bila gagal di level HTTP/stream (indikasi token basi), refresh token & ulang 1x.
async function callAction(spotifyUrl) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const nextAction = await getActionToken(attempt === 1)
        const res = await fetch(`${BASE}/`, {
            method: "POST",
            headers: {
                accept: "text/x-component",
                "content-type": "text/plain;charset=UTF-8",
                "next-action": nextAction,
                "next-router-state-tree": ROUTER_TREE,
                origin: BASE,
                referer: `${BASE}/`,
                "user-agent": UA,
            },
            body: JSON.stringify([spotifyUrl]),
        })

        if (!res.ok) {
            if (attempt === 0) continue // mungkin token basi -> refresh & coba lagi
            throw new Error(`Server Action menolak permintaan (HTTP ${res.status})`)
        }

        const line = (await res.text()).split("\n").find(l => l.startsWith("1:"))
        if (!line) {
            if (attempt === 0) continue
            throw new Error("Gagal mengekstrak metadata dari server stream")
        }

        const json = JSON.parse(line.slice(2))
        if (!json.success || !json.data) throw new Error(json.message || "Tautan Spotify tidak valid")
        return json.data
    }
}

// Track: ambil metadata -> POST /api/proxy/download (balas MP3 mentah) -> upload.
async function scrapeTrack(spotifyUrl) {
    const info = await callAction(spotifyUrl)
    const artist = Array.isArray(info.artists) ? info.artists.join(", ") : String(info.artists)

    const audioRes = await fetch(`${BASE}/api/proxy/download`, {
        method: "POST",
        headers: {
            accept: "*/*",
            "content-type": "application/json",
            origin: BASE,
            referer: `${BASE}/`,
            "user-agent": UA,
        },
        body: JSON.stringify({ url: spotifyUrl, quality: "128", title: info.name, artist, imageUrl: info.image }),
    })
    if (!audioRes.ok) throw new Error(`API download merespons HTTP ${audioRes.status}`)

    const buffer = Buffer.from(await audioRes.arrayBuffer())
    if (!buffer.length) throw new Error("Buffer audio kosong dari server")

    const safe = `${artist} - ${info.name}`.replace(/[^\w\s.-]/g, "").trim().slice(0, 80) || info.id
    const { url, provider } = await upload(buffer, `${safe}.mp3`)

    return {
        type: "track",
        id: info.id,
        title: info.name,
        artist,
        album: info.album || null,
        duration: info.duration || null,
        cover: info.image || null,
        filesize: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
        quality: "128kbps",
        downloadUrl: url,
        provider,
    }
}

// Playlist: metadata -> GET /api/proxy/playlist (SSE) -> link ZIP final.
async function scrapePlaylist(playlistUrl) {
    const meta = await callAction(playlistUrl)

    const qs = new URLSearchParams({
        url: playlistUrl,
        quality: "128",
        title: meta.name || "My Playlist",
        trackCount: String(meta.trackCount || 0),
        imageUrl: meta.image || "",
    })
    const sse = await fetch(`${BASE}/api/proxy/playlist?${qs}`, {
        headers: { accept: "text/event-stream", "user-agent": UA },
    })
    if (!sse.ok) throw new Error(`Gagal memproses stream playlist (HTTP ${sse.status})`)

    const reader = sse.body.getReader()
    const decoder = new TextDecoder()
    let downloadUrl = ""
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        for (let line of decoder.decode(value).split("\n")) {
            line = line.trim().replace(/^data:\s*/, "")
            if (!line.startsWith("{")) continue
            try {
                const ev = JSON.parse(line)
                if (ev.status === "complete" && ev.download_url) downloadUrl = ev.download_url
            } catch {}
        }
    }
    if (!downloadUrl) throw new Error("Gagal mendapatkan link ZIP dari event-stream")

    return {
        type: "playlist",
        title: meta.name || null,
        trackCount: meta.trackCount || null,
        cover: meta.image || null,
        downloadUrl, // ZIP presigned (spoticatch S3), berlaku ±1 jam
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/spotitrack",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Spotify (track MP3 / playlist ZIP) via spotitrack.com",
        description:
            "Mengunduh Spotify lewat spotitrack.com. URL track mengembalikan MP3 128kbps yang sudah di-upload ke file hosting (link permanen). URL playlist mengembalikan link ZIP berisi semua track (presigned S3, berlaku ±1 jam — segera unduh).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Spotify: track atau playlist",
                schema: { type: "string", example: "https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8" },
            },
        ],
        responses: {
            "200": {
                description: "Berhasil. `result.type` = track | playlist.",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                result: {
                                    type: "object",
                                    properties: {
                                        type: { type: "string", enum: ["track", "playlist"] },
                                        id: { type: "string", description: "Hanya track" },
                                        title: { type: "string" },
                                        artist: { type: "string", description: "Hanya track" },
                                        album: { type: "string", description: "Hanya track" },
                                        duration: { type: "integer", description: "Durasi ms (track)" },
                                        cover: { type: "string" },
                                        filesize: { type: "string", description: "Hanya track" },
                                        quality: { type: "string", description: "Hanya track" },
                                        trackCount: { type: "integer", description: "Hanya playlist" },
                                        downloadUrl: { type: "string", description: "MP3 (track) atau ZIP (playlist)" },
                                        provider: { type: "string", description: "Host upload MP3 (track)" },
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
        if (!url || !/^https?:\/\/(open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist)\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Spotify tidak valid (track/playlist)" })
        }
        try {
            const isPlaylist = /\/playlist\//i.test(url)
            const result = isPlaylist ? await scrapePlaylist(url) : await scrapeTrack(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
