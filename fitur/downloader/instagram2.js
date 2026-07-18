import axios from "axios"

async function scraper(url) {
    const res = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 25000,
    })

    const html = res.data

    const videoMatches = [...html.matchAll(/"video_versions":\[(.*?)\]/g)]
    const imageMatches = [...html.matchAll(/"image_versions2":\{"candidates":\[(.*?)\]\}/g)]

    let mediaArr = []

    for (const match of videoMatches) {
        try {
            const data = JSON.parse("[" + match[1] + "]")
            if (data.length > 0) mediaArr.push({ type: "video", url: data[0].url })
        } catch {
            const mp4 = match[1].match(/"url":"(.*?)"/)
            if (mp4) mediaArr.push({ type: "video", url: mp4[1].replace(/\\\//g, "/") })
        }
    }

    if (mediaArr.length === 0) {
        for (const match of imageMatches) {
            try {
                const data = JSON.parse("[" + match[1] + "]")
                if (data.length > 0) mediaArr.push({ type: "image", url: data[0].url })
            } catch {
                const jpg = match[1].match(/"url":"(.*?)"/)
                if (jpg) mediaArr.push({ type: "image", url: jpg[1].replace(/\\\//g, "/") })
            }
        }
    }

    if (mediaArr.length === 0) throw new Error("Media URL tidak ditemukan. Post mungkin diproteksi.")

    const seen = new Set()
    const unique = []
    for (const m of mediaArr) {
        if (!seen.has(m.url)) {
            seen.add(m.url)
            unique.push(m)
        }
    }

    return {
        media: unique.map((m, i) => ({ index: i, type: m.type === "video" ? "video" : "image", url: m.url })),
        total: unique.length,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/instagram2",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media Instagram via Googlebot SEO trick (no cookie)",
        description: "Scrape halaman Instagram dengan User-Agent Googlebot untuk mendapatkan URL media (gambar carousel atau video reel bila tersedia). Tanpa login/cookie. Tidak selalu berhasil — Instagram kadang memblokir halaman.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL post/reel Instagram",
                schema: { type: "string", example: "https://www.instagram.com/reel/DZOyRZNTfLZ/" },
            },
        ],
        responses: {
            "200": { description: "Berhasil" },
            "400": { description: "URL tidak valid" },
            "500": { description: "Gagal scrape / post diproteksi" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/instagram\.com\/(?:p|reel|reels|tv)\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Instagram tidak valid" })
        }
        try {
            const result = await scraper(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
