import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"
const BASE = "https://spowload.cc"

// Cookie-jar manual per-request (pengganti tough-cookie + axios-cookiejar-support).
// Dibuat baru tiap panggilan agar sesi Laravel tidak tercampur antar request.
function createClient() {
    const cookieStore = {}
    const cookieHeader = () => Object.entries(cookieStore).map(([k, v]) => `${k}=${v}`).join("; ")
    const client = axios.create({
        maxRedirects: 5,
        validateStatus: () => true,
        timeout: 60000,
        headers: {
            "User-Agent": UA,
            "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
            "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
            "sec-ch-ua-mobile": "?1",
            "sec-ch-ua-platform": '"Android"',
        },
    })
    client.interceptors.request.use(cfg => {
        const ch = cookieHeader()
        if (ch) cfg.headers.Cookie = ch
        return cfg
    })
    client.interceptors.response.use(res => {
        for (const sc of res.headers?.["set-cookie"] || []) {
            const part = sc.split(";")[0]
            const i = part.indexOf("=")
            if (i > -1) cookieStore[part.slice(0, i).trim()] = part.slice(i + 1)
        }
        return res
    })
    return client
}

const pickCsrf = html => cheerio.load(html)('meta[name="csrf-token"]').first().attr("content") || null

// Halaman analyze menanam metadata track sebagai: let urldata = "<json string ter-escape>"
function pickTrackData(html) {
    const m = html.match(/let\s+urldata\s*=\s*"((?:\\.|[^"\\])*)"/)
    if (!m) return null
    try {
        return JSON.parse(JSON.parse(`"${m[1]}"`))
    } catch {
        return null
    }
}

const pickImage = d => d?.album?.images?.[0]?.url || d?.images?.[0]?.url || d?.tracks?.items?.[0]?.track?.album?.images?.[0]?.url || d?.tracks?.[0]?.album?.images?.[0]?.url || null
const pickSpotifyUrl = (d, fb) => d?.external_urls?.spotify || fb
const cleanArtists = d => (d?.artists || d?.track?.artists || []).map(v => v.name).filter(Boolean).join(", ") || null
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Konversi lambat dikembalikan sebagai task_id; polling sampai dapat download_url.
async function pollTask(client, taskId) {
    for (let i = 0; i < 10; i += 1) {
        const { data } = await client.get(`${BASE}/tasks/${encodeURIComponent(taskId)}`, {
            headers: { Accept: "application/json, text/plain, */*", Referer: `${BASE}/en2` },
        })
        const status = data?.data?.status
        const result = data?.data?.result?.download_url || data?.data?.download_url || data?.data?.url || null
        if (result) return result
        if (["completed", "success", "finished"].includes(status)) return result
        if (status === "failed") throw new Error("Konversi gagal di spowload")
        await sleep(2000)
    }
    throw new Error("Task timeout, coba ulangi lagi")
}

async function spowload(url) {
    const client = createClient()

    // 1) ambil halaman + CSRF token (set cookie sesi)
    const home = await client.get(`${BASE}/en2`, {
        headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", Referer: BASE },
    })
    const token = pickCsrf(home.data)
    if (!token) throw new Error("CSRF token tidak ditemukan (kemungkinan kena Cloudflare/captcha)")

    // 2) analyze -> halaman berisi metadata track
    const form = new URLSearchParams({ _token: token, trackUrl: url }).toString()
    const analyzed = await client.post(`${BASE}/analyze`, form, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Origin: BASE, Referer: `${BASE}/en2`,
            "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document",
        },
    })
    const html = typeof analyzed.data === "string" ? analyzed.data : ""
    const csrf = pickCsrf(html) || token
    const trackData = pickTrackData(html)
    if (!trackData) throw new Error("Data track tidak ditemukan dari halaman analyze")

    const spotifyUrl = pickSpotifyUrl(trackData, url)
    const cover = pickImage(trackData)

    // 3) convert -> link MP3 (langsung atau via task_id)
    const { data: body, status } = await client.post(`${BASE}/convert`, { urls: spotifyUrl, cover }, {
        headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "X-CSRF-TOKEN": csrf,
            Origin: BASE, Referer: `${BASE}/spotify/${trackData.type || "track"}-${trackData.id}`,
            "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
        },
    })

    let downloadUrl = body?.url || body?.data?.url || body?.data?.download_url || null
    if (!downloadUrl && (body?.task_id || body?.taskId)) downloadUrl = await pollTask(client, body.task_id || body.taskId)
    if (!downloadUrl) throw new Error(`Link download tidak ditemukan (convert HTTP ${status})`)

    return {
        type: trackData.type || "track",
        id: trackData.id || null,
        title: trackData.name || null,
        artist: cleanArtists(trackData),
        durationMs: trackData.duration_ms || null,
        cover,
        spotifyUrl,
        downloadUrl,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/spowload",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Spotify (MP3) via spowload.cc",
        description: "Mengunduh track Spotify sebagai MP3 menggunakan spowload.cc. Mengembalikan link MP3 langsung (bertanda-tangan, berlaku sementara) beserta metadata.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL track Spotify",
                schema: { type: "string", example: "https://open.spotify.com/track/0Wms5IftbzNzmrAyXx4A33" },
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
                                        type: { type: "string" },
                                        id: { type: "string" },
                                        title: { type: "string" },
                                        artist: { type: "string" },
                                        durationMs: { type: "integer" },
                                        cover: { type: "string" },
                                        spotifyUrl: { type: "string" },
                                        downloadUrl: { type: "string", description: "Link MP3 langsung (berlaku sementara)" },
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
        if (!url || !/^https?:\/\/(open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?track\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL track Spotify tidak valid" })
        }
        try {
            const result = await spowload(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
