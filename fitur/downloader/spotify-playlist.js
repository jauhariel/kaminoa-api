import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://open.spotify.com"
const PATHFINDER = "https://api-partner.spotify.com/pathfinder/v1/query"
const PAGE = 100

const fmt = ms => {
    const s = Math.round((ms || 0) / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
const pickCover = sources => sources?.slice(-1)?.[0]?.url || null
const artistNames = items => (items || []).map(a => a?.profile?.name).filter(Boolean).join(", ") || null

// Konfigurasi per-tipe: operation GraphQL, variabel, dan cara baca struktur respons.
// playlist -> fetchPlaylist (data.playlistV2), album -> getAlbum (data.albumUnion).
const TYPES = {
    playlist: {
        op: "fetchPlaylist",
        vars: (uri, offset, limit) => ({ uri, offset, limit, enableWatchFeedEntrypoint: false }),
        root: j => j?.data?.playlistV2,
        total: r => r?.content?.totalCount || 0,
        items: r => r?.content?.items || [],
        meta: r => ({ name: r?.name || null, owner: r?.ownerV2?.data?.name || null, cover: pickCover(r?.images?.items?.[0]?.sources) }),
        track: it => {
            const d = it?.itemV2?.data
            return d?.name ? { name: d.name, artists: d.artists?.items, ms: d.trackDuration?.totalMilliseconds, uri: d.uri } : null
        },
    },
    album: {
        op: "getAlbum",
        vars: (uri, offset, limit) => ({ uri, offset, limit, locale: "" }),
        root: j => j?.data?.albumUnion,
        total: r => r?.tracksV2?.totalCount || 0,
        items: r => r?.tracksV2?.items || [],
        meta: r => ({ name: r?.name || null, owner: artistNames(r?.artists?.items), cover: pickCover(r?.coverArt?.sources) }),
        track: it => {
            const t = it?.track
            return t?.name ? { name: t.name, artists: t.artists?.items, ms: t.duration?.totalMilliseconds, uri: t.uri } : null
        },
    },
}

// ---- token anonim (dari halaman embed) ----
let tokenCache = { token: null, exp: 0 }
async function getToken(type, id, force = false) {
    if (!force && tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token
    const { data: html } = await axios.get(`${BASE}/embed/${type}/${id}`, { headers: { "user-agent": UA }, timeout: 30000 })
    const token = String(html).match(/"accessToken":"([^"]+)"/)?.[1]
    if (!token) throw new Error("Gagal mengambil token Spotify (kemungkinan entity privat / tidak ada)")
    const exp = Number(String(html).match(/"accessTokenExpirationTimestampMs":(\d+)/)?.[1]) || Date.now() + 30 * 60000
    tokenCache = { token, exp }
    return token
}

// ---- hash persisted-query (dari bundle JS web player; berotasi saat Spotify update) ----
let hashCache = null
async function getHashes(force = false) {
    if (!force && hashCache) return hashCache
    const { data: home } = await axios.get(`${BASE}/`, { headers: { "user-agent": UA }, timeout: 30000 })
    const bundle = String(home).match(/src="([^"]+web-player\.[a-f0-9]+\.js)"/)?.[1]
    if (!bundle) throw new Error("Bundle web-player Spotify tidak ditemukan")
    const { data: js } = await axios.get(bundle, { headers: { "user-agent": UA }, timeout: 30000, responseType: "text" })
    const hashOf = op => String(js).match(new RegExp(`"${op}"[\\s\\S]{0,160}?([a-f0-9]{64})`))?.[1] || null
    const hashes = { fetchPlaylist: hashOf("fetchPlaylist"), getAlbum: hashOf("getAlbum") }
    if (!hashes.fetchPlaylist || !hashes.getAlbum) throw new Error("Hash query Spotify tidak ditemukan di bundle")
    hashCache = hashes
    return hashes
}

async function pathfinder(op, variables, token, _retried = false) {
    const hashes = await getHashes()
    const { data, status } = await axios.get(PATHFINDER, {
        params: {
            operationName: op,
            variables: JSON.stringify(variables),
            extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hashes[op] } }),
        },
        headers: { authorization: `Bearer ${token}`, "user-agent": UA, accept: "application/json", origin: BASE, referer: `${BASE}/` },
        timeout: 30000,
        validateStatus: () => true,
    })
    if (data?.errors?.length) {
        const msg = data.errors[0]?.message || "error"
        // Hash basi -> ambil hash terbaru sekali lalu ulangi.
        if (/PersistedQueryNotFound/i.test(msg) && !_retried) {
            await getHashes(true)
            return pathfinder(op, variables, token, true)
        }
        throw new Error(`Spotify menolak: ${msg}`)
    }
    if (status !== 200) throw new Error(`Spotify pathfinder HTTP ${status}`)
    return data
}

async function scrape(type, id) {
    const cfg = TYPES[type]
    const uri = `spotify:${type}:${id}`
    const token = await getToken(type, id)

    const first = await pathfinder(cfg.op, cfg.vars(uri, 0, PAGE), token)
    const root = cfg.root(first)
    if (!root) throw new Error("Data tidak ditemukan (entity privat atau tidak ada)")

    const total = cfg.total(root)
    const tracks = []
    const collect = items => {
        for (const it of items) {
            const t = cfg.track(it)
            if (!t?.uri) continue
            const tid = t.uri.split(":").pop()
            tracks.push({ title: t.name, artist: artistNames(t.artists), duration: fmt(t.ms), durationMs: t.ms || null, id: tid, url: `${BASE}/track/${tid}` })
        }
    }

    collect(cfg.items(root))
    let offset = cfg.items(root).length
    while (offset < total) {
        const page = await pathfinder(cfg.op, cfg.vars(uri, offset, PAGE), token)
        const items = cfg.items(cfg.root(page))
        if (!items.length) break
        collect(items)
        offset += items.length
    }

    const meta = cfg.meta(root)
    return { type, id, name: meta.name, owner: meta.owner, cover: meta.cover, total, count: tracks.length, tracks }
}

export default {
    route: {
        method: "get",
        path: "/downloader/spotify-playlist",
        auth: false,
        tags: ["Downloader"],
        summary: "Scrape playlist/album Spotify (semua track)",
        description: "Mengambil seluruh daftar track dari playlist atau album Spotify (tanpa batas 100), lengkap dengan URL track tiap lagu — yang bisa diteruskan ke endpoint downloader Spotify (mis. /downloader/musicfab) untuk mengunduh MP3. Tanpa API key.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL playlist atau album Spotify",
                schema: { type: "string", example: "https://open.spotify.com/playlist/3Lf9PqUBWQMeOtfuCNPnoY" },
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
                                        type: { type: "string", enum: ["playlist", "album"] },
                                        id: { type: "string" },
                                        name: { type: "string" },
                                        owner: { type: "string" },
                                        cover: { type: "string" },
                                        total: { type: "integer", description: "Total track menurut Spotify" },
                                        count: { type: "integer", description: "Jumlah track ter-scrape" },
                                        tracks: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    title: { type: "string" },
                                                    artist: { type: "string" },
                                                    duration: { type: "string", description: "mm:ss" },
                                                    durationMs: { type: "integer" },
                                                    id: { type: "string" },
                                                    url: { type: "string", description: "URL track Spotify" },
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
        const m = String(req.query.url || "").match(/spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album)\/([A-Za-z0-9]+)/i)
        if (!m) return res.status(400).json({ ok: false, error: "URL playlist/album Spotify tidak valid" })
        try {
            const result = await scrape(m[1].toLowerCase(), m[2])
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
