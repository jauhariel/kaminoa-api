import * as crypto from "node:crypto"
import { Buffer } from "node:buffer"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0"
const SECRET = "376136387538459893883312310911992847112448894410210511297108"
const TOTP_VERSION = 61
const APP_VERSION = "1.2.92.50.g97692e81"
const FALLBACK_HASHES = [
    "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0",
    "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e"
]

const baseHeaders = { referer: "https://open.spotify.com/", origin: "https://open.spotify.com", "user-agent": UA, "accept-language": "en" }
const session = { token: null, clientToken: null, expires: 0 }
let discoveredHash = null

function totp(tsms) {
    const counter = Math.floor((tsms / 1000) / 30)
    const buf = Buffer.alloc(8)
    buf.writeBigInt64BE(BigInt(counter))
    const digest = crypto.createHmac("sha1", Buffer.from(SECRET, "utf8")).update(buf).digest()
    const offset = digest[digest.length - 1] & 0xf
    return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0")
}

async function getAuth(force) {
    if (!force && session.token && Date.now() < session.expires - 60000) return session
    const now = Date.now()
    const params = new URLSearchParams({ reason: "init", productType: "web-player", totp: totp(now), totpServer: totp(now), totpVer: String(TOTP_VERSION) })
    const token = await (await fetch(`https://open.spotify.com/api/token?${params}`, { headers: baseHeaders })).json()
    if (!token?.accessToken) throw new Error("token request failed")
    const client = await (await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
        method: "POST",
        headers: { ...baseHeaders, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_data: { client_version: APP_VERSION, client_id: token.clientId, js_sdk_data: { device_brand: "unknown", device_model: "unknown", os: "windows", os_version: "NT 10.0", device_id: crypto.randomUUID(), device_type: "computer" } } })
    })).json()
    if (!client?.granted_token?.token) throw new Error("client token request failed")
    session.token = token.accessToken
    session.clientToken = client.granted_token.token
    session.expires = token.accessTokenExpirationTimestampMs || (now + 3000000)
    return session
}

async function discoverHash() {
    if (discoveredHash !== null) return discoveredHash || null
    discoveredHash = ""
    try {
        const html = await (await fetch("https://open.spotify.com/", { headers: { "user-agent": UA } })).text()
        const mainUrl = (html.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[0-9a-f]+\.js/) || [])[0]
        if (!mainUrl) return null
        const mainJs = await (await fetch(mainUrl, { headers: { "user-agent": UA, referer: "https://open.spotify.com/" } })).text()
        const candidates = [...new Set([...mainJs.matchAll(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/[\w.\-]*search[\w.\-]*\.js/g)].map(x => x[0]))]
        for (const url of candidates) {
            const chunkJs = await (await fetch(url, { headers: { "user-agent": UA, referer: "https://open.spotify.com/" } })).text()
            const hash = (chunkJs.match(/"searchDesktop","query","([a-f0-9]{64})"/) || [])[1]
            if (hash) { discoveredHash = hash; break }
        }
    } catch {
        discoveredHash = ""
    }
    return discoveredHash || null
}

function fmtDuration(ms) {
    const total = Math.floor((ms || 0) / 1000)
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0")
}

function parseTrack(d) {
    if (!d) return null
    const sources = d.albumOfTrack?.coverArt?.sources || []
    const thumb = sources.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a), sources[0] || {}).url || null
    const id = (d.uri || "").split(":")[2] || null
    return {
        id,
        artist: (d.artists?.items || []).map(a => a.profile?.name).filter(Boolean).join(", "),
        title: d.name || null,
        duration: fmtDuration(d.duration?.totalMilliseconds || 0),
        thumb,
        url: id ? `https://open.spotify.com/track/${id}` : null
    }
}

async function getPreview(id) {
    if (!id) return null
    try {
        const html = await (await fetch(`https://open.spotify.com/embed/track/${id}`, { headers: { "user-agent": UA } })).text()
        const nd = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^]*?)<\/script>/)
        if (nd) return JSON.parse(nd[1])?.props?.pageProps?.state?.data?.entity?.audioPreview?.url || null
        return (html.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[a-zA-Z0-9]+/) || [])[0] || null
    } catch {
        return null
    }
}

async function runQuery(term, hash, limit, auth) {
    const params = new URLSearchParams({
        operationName: "searchDesktop",
        variables: JSON.stringify({ searchTerm: term, offset: 0, limit, numberOfTopResults: 1, includeAudiobooks: false }),
        extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } })
    })
    return fetch(`https://api-partner.spotify.com/pathfinder/v1/query?${params}`, {
        headers: { ...baseHeaders, accept: "application/json", "app-platform": "WebPlayer", authorization: `Bearer ${auth.token}`, "client-token": auth.clientToken, "spotify-app-version": APP_VERSION }
    })
}

async function searchData(term, limit) {
    let auth = await getAuth(false)
    const tryHashes = async (hashes) => {
        for (const hash of hashes) {
            if (!hash) continue
            let res = await runQuery(term, hash, limit, auth)
            if (res.status === 401) { auth = await getAuth(true); res = await runQuery(term, hash, limit, auth) }
            const json = await res.json().catch(() => null)
            if (json?.data?.searchV2) return json.data.searchV2
        }
        return null
    }
    const primary = discoveredHash ? [discoveredHash, ...FALLBACK_HASHES] : FALLBACK_HASHES
    let data = await tryHashes(primary)
    if (!data) {
        const fresh = await discoverHash()
        if (fresh && !primary.includes(fresh)) data = await tryHashes([fresh])
    }
    return data
}

async function spotifySearch(searchTerm, limit) {
    const term = String(searchTerm || "").trim()
    if (!term) return []
    const data = await searchData(term, limit)
    if (!data) return []
    const items = (data.tracksV2?.items || []).map(i => parseTrack(i.item?.data)).filter(Boolean).slice(0, limit)
    const previews = await Promise.all(items.map(t => getPreview(t.id)))
    return items.map((t, i) => ({
        artist: t.artist,
        title: t.title,
        duration: t.duration,
        thumb: t.thumb,
        url: t.url,
        urlpreview: previews[i]
    }))
}

export default {
    route: {
        method: "get",
        path: "/search/spotify",
        auth: false,
        tags: ["Search"],
        summary: "Cari lagu di Spotify",
        description: "Mencari lagu di Spotify berdasarkan kata kunci dan mengembalikan data track beserta preview audio.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: true,
                description: "Kata kunci pencarian lagu",
                schema: { type: "string", example: "introvert lirik" }
            },
            {
                name: "limit",
                in: "query",
                required: false,
                description: "Jumlah maksimal hasil (1–10)",
                schema: { type: "integer", default: 3, minimum: 1, maximum: 10, example: 5 }
            }
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
                                results: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            artist: { type: "string" },
                                            title: { type: "string" },
                                            duration: { type: "string", example: "3:45" },
                                            thumb: { type: "string", format: "uri", nullable: true },
                                            url: { type: "string", format: "uri", nullable: true },
                                            urlpreview: { type: "string", format: "uri", nullable: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Tidak ada hasil",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { query, limit = 3 } = req.query
        if (!query || !String(query).trim()) {
            return res.status(400).json({ ok: false, error: "query wajib diisi" })
        }
        const limitNum = parseInt(limit)
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 10) {
            return res.status(400).json({ ok: false, error: "limit harus angka antara 1 dan 10" })
        }
        try {
            const results = await spotifySearch(query.trim(), limitNum)
            if (!results.length) return res.status(404).json({ ok: false, error: "tidak ada hasil ditemukan" })
            res.json({ ok: true, query: query.trim(), total: results.length, results })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
