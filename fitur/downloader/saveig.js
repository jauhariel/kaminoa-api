import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://saveig.in"
const API = `${BASE}/wp-json/visolix/api/download`

// Normalkan link saveig (mis. ".../includes/../dl.php" -> ".../dl.php").
function cleanUrl(href) {
    try {
        return new URL(href, BASE).toString()
    } catch {
        return href
    }
}

// Thumbnail disajikan sebagai proxy "img.php?img=<base64 url cdninstagram>".
// Decode base64-nya untuk mendapat URL CDN asli (tanpa proxy saveig).
function decodeThumb(src) {
    if (!src) return null
    try {
        const b64 = new URL(src, BASE).searchParams.get("img")
        if (!b64) return cleanUrl(src)
        const real = Buffer.from(b64, "base64").toString("utf8")
        return /^https?:\/\//i.test(real) ? real : cleanUrl(src)
    } catch {
        return cleanUrl(src)
    }
}

async function saveig(igUrl) {
    // Catatan: header x-visolix-nonce sengaja tidak dikirim — server saveig.in
    // tidak memvalidasinya (request tanpa nonce pun tetap diterima).
    const { data: j } = await axios.post(
        API,
        { url: igUrl, format: "", captcha_response: null },
        {
            headers: {
                accept: "*/*",
                "content-type": "application/json",
                origin: BASE,
                referer: `${BASE}/`,
                "user-agent": UA,
            },
            timeout: 30000,
        },
    )

    if (!j || !j.status || !j.data) throw new Error(j?.message || "Media tidak ditemukan atau URL tidak valid")

    const $ = cheerio.load(j.data)
    const medias = []
    const seen = new Set()

    $(".visolix-media-box").each((_, box) => {
        const $box = $(box)
        const downloadUrl = cleanUrl($box.find("a.visolix-item-download").attr("href") || "")
        if (!downloadUrl.includes("dl.php") || seen.has(downloadUrl)) return
        seen.add(downloadUrl)

        // Tipe dari teks tombol ("Download video/image"), fallback ke nama file ikon.
        // Catatan: cek "video.svg" spesifik — path ikon selalu memuat kata "video"
        // (folder plugin bernama "visolix-video-downloader").
        const icon = $box.find(".visolix-media-icon img").attr("src") || ""
        const btnText = $box.find("a.visolix-item-download").text().trim().toLowerCase()
        const type = btnText.includes("video") || /video\.svg/i.test(icon) ? "video" : "image"

        medias.push({
            type,
            downloadUrl,
            thumbnail: decodeThumb($box.find('img[alt="Preview image"]').attr("src")),
        })
    })

    if (!medias.length) throw new Error("Tidak ada media yang ditemukan")
    return {
        total: medias.length,
        videos: medias.filter(m => m.type === "video").length,
        images: medias.filter(m => m.type === "image").length,
        medias,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/saveig",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Instagram via saveig",
        description: "Mengunduh media Instagram (post, reels, IGTV, carousel) menggunakan saveig.in. Mendukung video dan gambar, termasuk carousel multi-media.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Instagram (post /p/, reel /reel/, atau /tv/)",
                schema: { type: "string", example: "https://www.instagram.com/p/DZm4ZVYk00W/" },
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
                                        total: { type: "integer" },
                                        videos: { type: "integer" },
                                        images: { type: "integer" },
                                        medias: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: { type: "string", enum: ["video", "image"] },
                                                    downloadUrl: { type: "string" },
                                                    thumbnail: { type: "string" },
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
        const { url } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        try {
            const result = await saveig(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
