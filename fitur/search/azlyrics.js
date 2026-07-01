import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
const BASE = "https://www.azlyrics.com"

// Cache x token dari geo.js — statis per region, jarang berubah
let cachedX = null
let xExpiry = 0
const X_TTL = 3600_000 // 1 jam

async function getXToken() {
    if (cachedX && Date.now() < xExpiry) return { x: cachedX, source: "cache" }

    const FALLBACK = "83d477b04d73c0db98162b56069d08649a5101fadd9b0b642201ec60d9af2260"

    // Coba fetch geo.js — file ini inject hidden input x ke form search
    const geoUrls = [
        { url: `${BASE}/geo.js`, headers: { "user-agent": UA, referer: `${BASE}/search/` } },
        { url: `${BASE}/geo.js`, headers: { "user-agent": UA } }, // tanpa referer
    ]

    for (const { url, headers } of geoUrls) {
        try {
            const { data } = await axios.get(url, { headers, timeout: 5000 })
            // Cari setAttribute("value", "...") — panjang hash bisa bervariasi
            const m = data.match(/setAttribute\s*\(\s*"value"\s*,\s*"([a-f0-9]+)"\s*\)/)
            if (m) {
                cachedX = m[1]
                xExpiry = Date.now() + X_TTL
                return { x: cachedX, source: "geo.js" }
            }
        } catch {}
    }

    // Fallback statis — nilai dari geo.js region ID per Juli 2026
    cachedX = FALLBACK
    xExpiry = Date.now() + X_TTL
    return { x: cachedX, source: "fallback" }
}

// Parse hasil search dari halaman /search/?q=...&x=...
function parseSearchResults(html) {
    const songs = [], artists = [], lyrics = []

    // Panel Song results
    const songPanel = html.match(/<b>Song results:<\/b>[\s\S]*?<\/table>/i)
    if (songPanel) {
        // Format: <a href="...">N. <span><b>"Title"</b>[optional text]</span> - <b>Artist</b></a>
        const re = /<a href="(https:\/\/www\.azlyrics\.com\/lyrics\/[^"]+\.html)">[^<]*<span><b>"?([^"<]+)"?<\/b>[^<]*<\/span>\s*-\s*<b>([^<]+)<\/b>/gi
        let m
        while ((m = re.exec(songPanel[0])) !== null) {
            const artist = m[3].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            songs.push({ url: m[1], title: m[2].trim(), artist })
        }
    }

    // Panel Artist results
    const artistPanel = html.match(/<b>Artist results:<\/b>[\s\S]*?<\/table>/i)
    if (artistPanel) {
        const re = /<a href="((?:https:)?\/\/www\.azlyrics\.com\/[a-z0-9]\/[^"]+\.html)">[^<]*<span><b>([^<]+)<\/b><\/span>/gi
        let m
        while ((m = re.exec(artistPanel[0])) !== null) {
            const url = m[1].startsWith("http") ? m[1] : "https:" + m[1]
            artists.push({ url, artist: m[2].trim() })
        }
    }

    // Panel Lyrics results
    const lyricsPanel = html.match(/<b>Lyrics results:<\/b>[\s\S]*?<\/table>/i)
    if (lyricsPanel) {
        const re = /<a href="(https:\/\/www\.azlyrics\.com\/lyrics\/[^"]+\.html)">[^<]*<span>([\s\S]*?)<\/span>/gi
        let m
        while ((m = re.exec(lyricsPanel[0])) !== null) {
            const snippet = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim()
            lyrics.push({ url: m[1], snippet })
        }
    }

    return { songs, artists, lyrics }
}

// Cari via /search/ HTML page
async function searchPage(query) {
    const { x, source } = await getXToken()
    const { data: html } = await axios.get(`${BASE}/search/`, {
        params: { q: query, x },
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    })
    const results = parseSearchResults(html)
    results._debug = { xSource: source, xHash: x.substring(0, 8) + "..." }
    return results
}

// Cari via /suggest/ API — JSON autocomplete
async function searchSuggest(query) {
    const { x, source } = await getXToken()
    const { data } = await axios.get(`${BASE}/suggest/`, {
        params: { q: query, x },
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "application/json" },
    })

    const songs = (data.songs || []).map(hit => {
        const titleMatch = hit.autocomplete.match(/"([^"]+)"/)
        const title = titleMatch ? titleMatch[1] : hit.autocomplete.replace(/^"/, "").replace(/"\s*-\s*.*$/, "").trim()
        const artist = hit.autocomplete.replace(/^.*-\s*/, "").trim()
        return { url: hit.url, title, artist }
    })

    return {
        songs,
        artists: (data.artists || []).map(a => ({ url: a.url, artist: a.autocomplete })),
        lyrics: (data.lyrics || []).map(l => ({ url: l.url, snippet: l.autocomplete })),
        _debug: { xSource: source, xHash: x.substring(0, 8) + "..." },
    }
}

// Cocokkan artist secara fuzzy — case-insensitive, substring, atau token match
function artistMatches(resultArtist, queryArtist) {
    const a = resultArtist.toLowerCase().trim()
    const b = queryArtist.toLowerCase().trim()

    // Exact match
    if (a === b) return true
    // Salah satu mengandung yang lain
    if (a.includes(b) || b.includes(a)) return true
    // Token-based: semua kata di query ada di artist
    const tokens = b.split(/\s+/).filter(t => t.length > 1)
    if (tokens.length > 0 && tokens.every(t => a.includes(t))) return true

    return false
}

// Ekstrak lirik dari halaman lyrics
function extractLyrics(html) {
    let artist = null, songTitle = null
    const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""

    // Pola English: "Artist - Title Lyrics | AZLyrics.com"
    const enMatch = rawTitle.match(/^(.*?)\s*-\s*(.*?)\s*Lyrics\s*\|\s*AZLyrics/i)
    if (enMatch) { artist = enMatch[1].trim(); songTitle = enMatch[2].trim() }

    // Pola Indo: "Artist - Lirik lagu "Title" | Lyrics at AZLyrics.com"
    if (!artist) {
        const idMatch = rawTitle.match(/^(.*?)\s*-\s*Lirik\s+lagu\s*"([^"]*)"\s*\|\s*Lyrics\s+at\s+AZLyrics/i)
        if (idMatch) { artist = idMatch[1].trim(); songTitle = idMatch[2].trim() }
    }

    // Pola Korea/other: Artist - "Title" 가사 | Lyrics at AZLyrics.com
    if (!artist) {
        const koMatch = rawTitle.match(/^(.*?)\s*-\s*"(.*?)"\s+[^|]+\|\s*Lyrics\s+at\s+AZLyrics/i)
        if (koMatch) { artist = koMatch[1].trim(); songTitle = koMatch[2].trim() }
    }

    // Fallback generik
    if (!artist) {
        const parts = rawTitle.split(/\s*\|\s*/)
        if (parts.length >= 2) {
            const left = parts[0].trim()
            const dashIdx = left.indexOf(" - ")
            if (dashIdx > 0) {
                artist = left.substring(0, dashIdx).trim()
                songTitle = left.substring(dashIdx + 3).trim()
                songTitle = songTitle.replace(/\s+(Lyrics|Lirik|Liedtext|Letras|Paroles|Testo|歌词|歌詞|가사|Texty|Текст)$/i, "").trim()
                songTitle = songTitle.replace(/^"(.*)"$/, "$1").trim()
            }
        }
    }

    // Cari blok lirik: <div> setelah </b> terakhir sebelum <!-- MxM
    const bEnd = html.lastIndexOf("</b>", html.indexOf("<!-- MxM"))
    if (bEnd === -1) return { artist, title: songTitle, lyrics: null }

    const divStart = html.indexOf("<div>", bEnd)
    if (divStart === -1) return { artist, title: songTitle, lyrics: null }

    const mxmIdx = html.indexOf("<!-- MxM", divStart)
    const divEnd = html.lastIndexOf("</div>", mxmIdx !== -1 ? mxmIdx : html.length)
    if (divEnd === -1 || divEnd <= divStart) return { artist, title: songTitle, lyrics: null }

    let block = html.substring(divStart + 5, divEnd)
    block = block.replace(/<!--[\s\S]*?-->/g, "")

    // Split berdasarkan label bahasa: <i>[Nama:]</i>
    const sections = {}
    const sectionPattern = /<i>\s*\[([^\]]+?)\]:?\s*<\/i>\s*<br>\s*([\s\S]*?)(?=<i>\s*\[|$)/gi
    let match
    while ((match = sectionPattern.exec(block)) !== null) {
        const lang = match[1].toLowerCase().replace(/:$/, "").trim()
        let text = match[2]
            .replace(/\r?\n/g, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
            .replace(/\n{3,}/g, "\n\n").trim()
        if (text) sections[lang] = text
    }

    if (Object.keys(sections).length === 0) {
        let text = block
            .replace(/\r?\n/g, "").replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
            .replace(/\n{3,}/g, "\n\n").trim()
        if (text) sections.default = text
    }

    return { artist, title: songTitle, lyrics: Object.keys(sections).length ? sections : null }
}

async function scrapeLyrics(url) {
    const { data: html } = await axios.get(url, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    })
    return extractLyrics(html)
}

export default {
    route: {
        method: "get",
        path: "/search/azlyrics",
        auth: false,
        tags: ["Search"],
        summary: "Cari & scrape lirik dari AZLyrics (search internal, tanpa Google)",
        description:
            "Cari lirik langsung dari AZLyrics pakai search engine internal.\n" +
            "- `?title=judul` — cari lagu & auto-scrape hasil pertama\n" +
            "- `?title=judul&artist=nama` — cari lebih akurat dengan filter artist\n" +
            "- `?title=judul&list=1` — tampilkan daftar hasil tanpa auto-scrape\n" +
            "- `?url=...` — scrape langsung URL lirik (skip search)",
        parameters: [
            {
                name: "title",
                in: "query",
                required: false,
                description: "Judul lagu",
                schema: { type: "string", example: "Mantra Hujan" },
            },
            {
                name: "artist",
                in: "query",
                required: false,
                description: "Nama artis/band (opsional, untuk hasil lebih akurat)",
                schema: { type: "string", example: "Kobo Kanaeru" },
            },
            {
                name: "url",
                in: "query",
                required: false,
                description: "URL langsung halaman lirik (skip search)",
                schema: { type: "string", example: "https://www.azlyrics.com/lyrics/kobokanaeru/mantrahujan.html" },
            },
            {
                name: "list",
                in: "query",
                required: false,
                description: "Set ke 1 untuk menampilkan daftar hasil search tanpa auto-scrape lirik",
                schema: { type: "string", example: "1" },
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
                                ok: { type: "boolean" },
                                artist: { type: "string" },
                                title: { type: "string" },
                                url: { type: "string" },
                                lyrics: { type: "object" },
                                results: {
                                    type: "object",
                                    description: "Daftar hasil search (mode list=1)",
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "404": { description: "Lagu tidak ditemukan" },
            "500": { description: "Gagal scrape" },
        },
    },

    handler: async (req, res) => {
        const title = (req.query.title || "").trim()
        const artist = (req.query.artist || "").trim()
        const url = (req.query.url || "").trim()
        const listOnly = req.query.list === "1" || req.query.list === "true"

        // Mode URL langsung
        if (url) {
            if (!/^https?:\/\/(www\.)?azlyrics\.com\/lyrics\//i.test(url)) {
                return res.status(400).json({ ok: false, error: "URL harus dari azlyrics.com/lyrics/..." })
            }
            try {
                const result = await scrapeLyrics(url)
                if (!result.lyrics) {
                    return res.status(500).json({
                        ok: false,
                        error: "Gagal mengekstrak lirik. Mungkin struktur halaman berubah.",
                        artist: result.artist,
                        title: result.title,
                    })
                }
                return res.json({ ok: true, ...result, url })
            } catch (e) {
                if (e.response?.status === 404) {
                    return res.status(404).json({ ok: false, error: "Halaman lirik tidak ditemukan (404)" })
                }
                return res.status(500).json({ ok: false, error: e.message })
            }
        }

        if (!title) {
            return res.status(400).json({
                ok: false,
                error: "Parameter `title` diperlukan. Contoh: ?title=Mantra Hujan atau ?title=Overdose&artist=EXO",
            })
        }

        try {
            // Gabung title + artist buat query search
            const query = artist ? `${title} ${artist}` : title

            // Cari via search page (HTML) — comprehensive
            let results = await searchPage(query)

            // Fallback ke suggest API kalau search page kosong
            if (!results.songs.length && !results.artists.length) {
                results = await searchSuggest(query)
            }

            // Retry: kalau masih kosong, invalidate cache x & coba sekali lagi
            if (!results.songs.length && !results.artists.length) {
                cachedX = null
                results = await searchPage(query)
                if (!results.songs.length && !results.artists.length) {
                    results = await searchSuggest(query)
                }
            }

            const debug = results._debug || {}

            // Kalau ada artist filter, saring hasil berdasarkan kecocokan artist
            if (artist && results.songs.length > 0) {
                const matched = results.songs.filter(s => artistMatches(s.artist, artist))
                const unmatched = results.songs.filter(s => !artistMatches(s.artist, artist))
                results.songs = [...matched, ...unmatched]
            }

            // Mode list — tampilkan semua hasil
            if (listOnly) {
                const total = results.songs.length + results.artists.length + results.lyrics.length
                if (total === 0) {
                    return res.status(404).json({
                        ok: false,
                        error: `Tidak ada hasil untuk "${query}".`,
                        hint: "Coba kata kunci lain.",
                        _debug: debug,
                    })
                }
                return res.json({ ok: true, query, total, ...results })
            }

            // Mode auto-scrape — ambil hasil song pertama (yang sudah difilter kalau ada artist)
            if (results.songs.length > 0) {
                const first = results.songs[0]
                const lyricResult = await scrapeLyrics(first.url)
                if (!lyricResult.lyrics) {
                    return res.status(500).json({
                        ok: false,
                        error: "Gagal mengekstrak lirik dari hasil pertama.",
                        artist: lyricResult.artist,
                        title: lyricResult.title,
                        url: first.url,
                    })
                }
                return res.json({
                    ok: true,
                    ...lyricResult,
                    url: first.url,
                    otherResults: {
                        songs: results.songs.slice(1, 6),
                        artists: results.artists.slice(0, 3),
                    },
                })
            }

            // Ada artist results tapi ga ada song
            if (results.artists.length > 0) {
                return res.status(404).json({
                    ok: false,
                    error: `Artis "${results.artists[0].artist}" ditemukan tapi tidak ada lagu yang cocok.`,
                    hint: "Coba tambahkan judul lagu, atau pakai ?list=1 untuk lihat semua hasil.",
                    artists: results.artists.slice(0, 5),
                    _debug: debug,
                })
            }

            return res.status(404).json({
                ok: false,
                error: `Lirik untuk "${query}" tidak ditemukan.`,
                hint: "Coba tambahkan nama artist. Contoh: ?title=Overdose&artist=EXO",
                _debug: debug,
            })
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message })
        }
    },
}
