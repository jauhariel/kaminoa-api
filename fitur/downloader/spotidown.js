import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://spotidown.app"
const HEADERS = {
    "user-agent": UA,
    accept: "*/*",
    origin: BASE,
    referer: `${BASE}/`,
    "x-requested-with": "XMLHttpRequest",
}

// spotidown menanam hidden field anti-bot dengan NAMA acak per-load (mis. _NMURm)
// + cookie session_data. Keduanya harus dikirim ulang saat POST /action.
async function getSession() {
    const { data: html, headers } = await axios.get(`${BASE}/`, {
        headers: { "user-agent": UA, accept: "text/html" },
    })
    const $ = cheerio.load(html)
    let token = null
    $('form[name="spotifyurl"] input[type="hidden"]').each((_, el) => {
        const name = $(el).attr("name")
        // lewati g-recaptcha-response; ambil field acak _XxxxX dengan value hex
        if (name && /^_[A-Za-z]+$/.test(name)) token = { name, value: $(el).attr("value") }
    })
    if (!token?.value) throw new Error("Gagal mengambil token sesi dari spotidown")

    const setCookie = headers["set-cookie"] || []
    const cookie = setCookie.map(c => c.split(";")[0]).join("; ")
    return { token, cookie }
}

// Parse HTML balasan /action/track -> link MP3 final + cover
function parseTrackResult(html) {
    const $ = cheerio.load(html)
    const links = $("a[href]")
        .map((_, a) => $(a).attr("href"))
        .get()
        .filter(h => /rapid\.spotidown\.app\/v2\?token=/.test(h))
    return {
        title: $('h3[itemprop="name"] .hover-underline').attr("title") || $('h3[itemprop="name"]').text().trim() || null,
        artist: $(".spotidown-downloader-middle p span").first().text().trim() || null,
        cover: $(".spotidown-downloader-left img").attr("src") || null,
        downloadUrl: links[0] || null,
        coverUrl: links[1] || null,
    }
}

function decodeMeta(b64) {
    try {
        return JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
    } catch {
        return {}
    }
}

// POST /action -> HTML berisi satu/lebih <form name="submitspurl"> (data/base/token)
async function callAction(spotifyUrl) {
    const { token, cookie } = await getSession()
    const reqHeaders = { ...HEADERS, cookie, "content-type": "application/x-www-form-urlencoded" }

    const body = new URLSearchParams({
        url: spotifyUrl,
        "g-recaptcha-response": "dummy", // tidak diverifikasi server
        [token.name]: token.value,
    }).toString()
    const { data: action } = await axios.post(`${BASE}/action`, body, {
        headers: reqHeaders,
        validateStatus: () => true,
    })
    if (!action || action.error) throw new Error(action?.message || "spotidown menolak permintaan (/action)")
    return { html: action.data || "", reqHeaders }
}

// Track tunggal: /action lalu /action/track utk dapat link MP3 final
async function scrapeTrack(spotifyUrl) {
    const { html, reqHeaders } = await callAction(spotifyUrl)

    const $ = cheerio.load(html)
    const form = $('form[name="submitspurl"]').first()
    if (!form.length) throw new Error("Track tidak ditemukan pada balasan spotidown")

    const field = n => form.find(`input[name="${n}"]`).attr("value")
    const data = field("data")
    const baseField = field("base")
    const tokenField = field("token")
    if (!data || !tokenField) throw new Error("Gagal mem-parse data track dari spotidown")

    const trackBody = new URLSearchParams({ data, base: baseField || spotifyUrl, token: tokenField }).toString()
    const { data: track } = await axios.post(`${BASE}/action/track`, trackBody, {
        headers: reqHeaders,
        validateStatus: () => true,
    })
    if (!track || track.error) throw new Error(track?.message || "Gagal mengambil link MP3 (/action/track)")

    const result = parseTrackResult(track.data || "")
    if (!result.downloadUrl) throw new Error("Link download tidak ditemukan pada balasan spotidown")

    const meta = decodeMeta(data)
    return {
        type: "track",
        title: result.title || meta.name || null,
        artist: result.artist || meta.artist || null,
        album: meta.album || null,
        duration: meta.duration || null,
        year: meta.date || null,
        cover: result.cover || meta.cover || null,
        downloadUrl: result.downloadUrl,
        coverUrl: result.coverUrl || null,
    }
}

// Playlist/album: hanya daftar metadata tiap track (tanpa resolve MP3).
// Untuk mengunduh, panggil endpoint ini lagi per `trackUrl`.
async function scrapeList(spotifyUrl) {
    const { html } = await callAction(spotifyUrl)
    const $ = cheerio.load(html)

    const tracks = $('form[name="submitspurl"]')
        .map((_, el) => {
            const data = $(el).find('input[name="data"]').attr("value")
            if (!data) return null
            const m = decodeMeta(data)
            return {
                title: m.name || null,
                artist: m.artist || null,
                album: m.album || null,
                duration: m.duration || null,
                year: m.date || null,
                cover: m.cover || null,
                tid: m.tid || null,
                trackUrl: m.tid ? `https://open.spotify.com/track/${m.tid}` : null,
            }
        })
        .get()
        .filter(Boolean)

    if (!tracks.length) throw new Error("Tidak ada track ditemukan pada playlist/album")

    return {
        type: /playlist/i.test(spotifyUrl) ? "playlist" : "album",
        title: $('h3[itemprop="name"] .hover-underline').attr("title") || null,
        cover: $(".spotidown-downloader-left img").first().attr("src") || null,
        total: tracks.length,
        tracks,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/spotidown",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Spotify (MP3) via spotidown.app",
        description: "Mengunduh track Spotify sebagai MP3 menggunakan spotidown.app. URL track tunggal mengembalikan link download (berlaku ±1 jam). URL playlist/album mengembalikan daftar metadata track (tanpa link download) — unduh tiap track dengan memanggil endpoint ini lagi memakai `trackUrl`.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Spotify: track, playlist, atau album",
                schema: { type: "string", example: "https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8" },
            },
        ],
        responses: {
            "200": {
                description: "Berhasil. `result.type` = track | playlist | album.",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                result: {
                                    type: "object",
                                    properties: {
                                        type: { type: "string", enum: ["track", "playlist", "album"] },
                                        title: { type: "string" },
                                        artist: { type: "string" },
                                        album: { type: "string" },
                                        duration: { type: "string" },
                                        year: { type: "integer" },
                                        cover: { type: "string" },
                                        downloadUrl: { type: "string", description: "Hanya untuk type=track" },
                                        coverUrl: { type: "string", description: "Hanya untuk type=track" },
                                        total: { type: "integer", description: "Jumlah track (playlist/album)" },
                                        tracks: {
                                            type: "array",
                                            description: "Daftar track (playlist/album)",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    title: { type: "string" },
                                                    artist: { type: "string" },
                                                    album: { type: "string" },
                                                    duration: { type: "string" },
                                                    year: { type: "integer" },
                                                    cover: { type: "string" },
                                                    tid: { type: "string" },
                                                    trackUrl: { type: "string" },
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
            "400": { description: "URL Spotify tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/^https?:\/\/(open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Spotify tidak valid (track/playlist/album)" })
        }
        const isList = /\/(playlist|album)\//i.test(url)
        try {
            const result = isList ? await scrapeList(url) : await scrapeTrack(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
