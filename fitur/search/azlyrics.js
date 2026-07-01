import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
const BASE = "https://www.azlyrics.com"

// Slugify untuk URL azlyrics: lowercase, hapus spasi & karakter non-alfanumerik
function slug(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
}

// Ekstrak daftar lagu dari halaman artis azlyrics.
// Struktur: <div class="listalbum-item"><a href="/lyrics/.../....html" target="_blank">Judul</a></div>
function parseSongList(html) {
    const songs = []
    const re = /<div class="listalbum-item">\s*<a href="(\/lyrics\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/gi
    let m
    while ((m = re.exec(html)) !== null) {
        songs.push({ title: m[2].trim(), url: BASE + m[1] })
    }
    return songs
}

// Cari URL lirik berdasarkan judul lagu saja via Google "I'm Feeling Lucky".
// Google me-redirect melalui /url?q=... → redirect-notice → extract link azlyrics.
async function searchByTitle(query) {
    const searchUrl =
        `https://www.google.com/search?q=site%3Aazlyrics.com+${encodeURIComponent(query)}&btnI=1&hl=en`

    const { data: html } = await axios.get(searchUrl, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        maxRedirects: 5,
    })

    // Ekstrak URL azlyrics dari redirect notice / halaman hasil
    // Format 1: <a href="https://www.azlyrics.com/lyrics/...">
    const m = html.match(/href="(https:\/\/www\.azlyrics\.com\/lyrics\/[^"]+\.html)"/i)
    if (m) return m[1]

    // Format 2: meta refresh
    const meta = html.match(/URL=(https:\/\/www\.azlyrics\.com\/lyrics\/[^"]+\.html)/i)
    if (meta) return meta[1]

    return null
}
async function fetchArtistPage(artistName) {
    const s = slug(artistName)
    const first = s.charAt(0)
    if (!first) throw new Error("Nama artis tidak valid")

    // Coba first-letter langsung
    const url = `${BASE}/${first}/${s}.html`
    try {
        const { data } = await axios.get(url, {
            headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        })
        return { html: data, url }
    } catch (e) {
        if (e.response?.status !== 404) throw e
    }

    // Fallback: telusuri semua halaman index A-Z cari slug artis
    // Cek beberapa variasi: prefix yang sama, dsb
    throw new Error(
        `Halaman artis tidak ditemukan di ${url}. Coba pakai parameter url langsung.`
    )
}

// Ekstrak lirik dari halaman lyrics azlyrics.
function extractLyrics(html, fallbackArtist, fallbackTitle) {
    // Coba beberapa pola title:
    // 1. English: "Artist - Title Lyrics | AZLyrics.com"
    // 2. Indo:    "Artist - Lirik lagu "Title" | Lyrics at AZLyrics.com"
    let artist = null
    let songTitle = null

    const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""

    // Pola English
    const enMatch = rawTitle.match(/^(.*?)\s*-\s*(.*?)\s*Lyrics\s*\|\s*AZLyrics/i)
    if (enMatch) {
        artist = enMatch[1].trim()
        songTitle = enMatch[2].trim()
    } else {
        // Pola Indo: "Artist - Lirik lagu "Title" | Lyrics at AZLyrics.com"
        const idMatch = rawTitle.match(/^(.*?)\s*-\s*Lirik\s+lagu\s*"([^"]*)"\s*\|\s*Lyrics\s+at\s+AZLyrics/i)
        if (idMatch) {
            artist = idMatch[1].trim()
            songTitle = idMatch[2].trim()
        }
    }

    // Fallback ke parameter
    if (!artist && fallbackArtist) artist = fallbackArtist
    if (!songTitle && fallbackTitle) songTitle = fallbackTitle

    // Cari blok lirik: <div> setelah <b> judul, sebelum <!-- MxM
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
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        if (text) sections[lang] = text
    }

    // Fallback: tidak ada label bahasa
    if (Object.keys(sections).length === 0) {
        let text = block
            .replace(/\r?\n/g, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        if (text) sections.default = text
    }

    return {
        artist,
        title: songTitle,
        lyrics: Object.keys(sections).length ? sections : null,
    }
}

async function scrapeLyrics(url, fallbackArtist, fallbackTitle) {
    const { data: html } = await axios.get(url, {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    })
    return extractLyrics(html, fallbackArtist, fallbackTitle)
}

// Cocokkan judul lagu dengan daftar lagu dari halaman artis.
// 1. Exact match (case-insensitive)
// 2. Slug match
// 3. Contains match (judul mengandung query atau sebaliknya)
function findSong(songs, query) {
    const q = query.trim()
    const qSlug = slug(q)

    // 1. Exact case-insensitive
    let match = songs.find(s => s.title.toLowerCase() === q.toLowerCase())
    if (match) return match

    // 2. Slug match
    match = songs.find(s => slug(s.title) === qSlug)
    if (match) return match

    // 3. Contains
    const qLower = q.toLowerCase()
    match = songs.find(s => {
        const tLower = s.title.toLowerCase()
        return tLower.includes(qLower) || qLower.includes(tLower)
    })
    return match || null
}

export default {
    route: {
        method: "get",
        path: "/search/azlyrics",
        auth: false,
        tags: ["Search"],
        summary: "Scrape lirik lagu dari AZLyrics",
        description:
            "Mengambil lirik lagu dari AZLyrics. Empat mode:\n" +
            "- `url`: langsung scrape URL lirik\n" +
            "- `artist` + `title`: cari artis lalu cocokkan judul lagu\n" +
            "- `artist` saja: kembalikan daftar lagu artis tersebut\n" +
            "- `title` saja: cari via Google ke halaman lirik pertama",
        parameters: [
            {
                name: "url",
                in: "query",
                required: false,
                description: "URL halaman lirik AZLyrics (opsional, prio atas artist+title)",
                schema: {
                    type: "string",
                    example: "https://www.azlyrics.com/lyrics/kobokanaeru/firstlove.html",
                },
            },
            {
                name: "artist",
                in: "query",
                required: false,
                description: "Nama artis/band (contoh: Kobo Kanaeru)",
                schema: { type: "string", example: "Kobo Kanaeru" },
            },
            {
                name: "title",
                in: "query",
                required: false,
                description: "Judul lagu (contoh: Mantra Hujan). Bisa dipakai sendiri tanpa artist.",
                schema: { type: "string", example: "Mantra Hujan" },
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
                                artist: { type: "string", example: "Kobo Kanaeru" },
                                title: { type: "string", example: "Mantra Hujan" },
                                url: { type: "string" },
                                lyrics: {
                                    type: "object",
                                    description: "Key-value bahasa → teks lirik",
                                },
                                songs: {
                                    type: "array",
                                    description: "Daftar lagu (mode artist saja)",
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "404": { description: "Artis/lagu tidak ditemukan" },
            "500": { description: "Kesalahan server / gagal scrape" },
        },
    },

    handler: async (req, res) => {
        const url = (req.query.url || "").toString().trim()
        const artist = (req.query.artist || "").toString().trim()
        const title = (req.query.title || "").toString().trim()

        // Mode 1: URL langsung
        if (url) {
            if (!/^https?:\/\/(www\.)?azlyrics\.com\/lyrics\//i.test(url)) {
                return res.status(400).json({
                    ok: false,
                    error: "URL harus halaman lirik AZLyrics (https://www.azlyrics.com/lyrics/...)",
                })
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

        // Mode 4: title saja → cari via Google
        if (!artist && title) {
            try {
                const foundUrl = await searchByTitle(title)
                if (!foundUrl) {
                    return res.status(404).json({
                        ok: false,
                        error: `Lirik untuk "${title}" tidak ditemukan di AZLyrics.`,
                        hint: "Coba tambahkan parameter artist untuk hasil lebih akurat.",
                    })
                }
                const result = await scrapeLyrics(foundUrl, null, title)
                if (!result.lyrics) {
                    return res.status(500).json({
                        ok: false,
                        error: "Gagal mengekstrak lirik. Mungkin struktur halaman berubah.",
                        artist: result.artist,
                        title: result.title,
                    })
                }
                return res.json({ ok: true, ...result, url: foundUrl })
            } catch (e) {
                return res.status(500).json({ ok: false, error: e.message })
            }
        }

        // Mode 2 & 3: artist (+ title optional)
        if (!artist) {
            return res.status(400).json({
                ok: false,
                error: "Isi parameter url, artist, atau title. Contoh: ?title=Mantra Hujan atau ?artist=Kobo Kanaeru&title=Mantra Hujan",
            })
        }

        try {
            const { html: artistHtml } = await fetchArtistPage(artist)
            const songs = parseSongList(artistHtml)

            if (!songs.length) {
                return res.status(404).json({
                    ok: false,
                    error: `Artis "${artist}" ditemukan tapi tidak ada daftar lagu.`,
                })
            }

            // Mode 3: artist saja → kembalikan daftar lagu
            if (!title) {
                // Ambil nama artis asli dari halaman
                const titleMatch = artistHtml.match(/<title>(.*?) Lyrics<\/title>/i)
                const realArtist = titleMatch?.[1]?.trim() || artist
                return res.json({
                    ok: true,
                    artist: realArtist,
                    total: songs.length,
                    songs,
                })
            }

            // Mode 2: artist + title → cari & scrape
            const song = findSong(songs, title)
            if (!song) {
                return res.status(404).json({
                    ok: false,
                    error: `Lagu "${title}" tidak ditemukan untuk artis "${artist}".`,
                    hint: "Coba cek daftar lagu dengan parameter artist saja.",
                    songs: songs.map(s => s.title),
                })
            }

            const result = await scrapeLyrics(song.url, artist, song.title)
            if (!result.lyrics) {
                return res.status(500).json({
                    ok: false,
                    error: "Gagal mengekstrak lirik. Mungkin struktur halaman berubah.",
                    artist: result.artist,
                    title: result.title,
                })
            }
            return res.json({ ok: true, ...result, url: song.url })
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message })
        }
    },
}
