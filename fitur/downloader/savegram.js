import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://www.savegram.app"

function getVar(html, name) {
    return (html.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || [])[1]
}

// Token pada link adalah JWT yang memuat url cdninstagram langsung + nama file.
function decodeToken(downloadUrl) {
    try {
        const token = new URL(downloadUrl).searchParams.get("token")
        if (!token) return {}
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
        const direct = payload.url ? decodeURIComponent(payload.url) : null
        return {
            directUrl: direct,
            filename: payload.filename || null,
            type: direct && direct.includes(".mp4") ? "video" : "image",
            expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        }
    } catch {
        return {}
    }
}

async function savegram(igUrl) {
    // 1) ambil token bootstrap + endpoint dari halaman
    const { data: home } = await axios.get(`${BASE}/en`, { headers: { "user-agent": UA } })
    const k_token = getVar(home, "k_token")
    const k_exp = getVar(home, "k_exp")
    const k_url = getVar(home, "k_url_search")
    if (!k_token || !k_exp || !k_url) throw new Error("Gagal mengambil token dari savegram")

    // 2) panggil API pencarian
    const body = new URLSearchParams({ k_exp, k_token, q: igUrl, t: "media", lang: "en", v: "v2", w: "", p: "search" })
    const { data: j } = await axios.post(k_url, body.toString(), {
        headers: {
            "user-agent": UA,
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest",
            origin: BASE,
            referer: `${BASE}/`,
        },
    })
    if (!j || j.status !== "ok" || !j.data) throw new Error(j?.mess || "Media tidak ditemukan atau URL tidak valid")

    // 3) parse hasil
    const $ = cheerio.load(j.data)
    const medias = []
    const seen = new Set()
    $('a[href^="http"]').each((_, a) => {
        const downloadUrl = $(a).attr("href")
        if (!downloadUrl || !downloadUrl.includes("snapcdn")) return
        const meta = decodeToken(downloadUrl)
        if (!meta.type || !meta.directUrl || seen.has(meta.directUrl)) return
        seen.add(meta.directUrl)
        medias.push({
            type: meta.type,
            downloadUrl,
            directUrl: meta.directUrl,
            filename: meta.filename || null,
            expiresAt: meta.expiresAt || null,
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
        path: "/downloader/savegram",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Instagram via savegram",
        description: "Mengunduh media Instagram (post, reels, IGTV, carousel) menggunakan savegram.app. Mendukung video dan gambar, termasuk carousel multi-media.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Instagram (post /p/, reel /reel/, atau /tv/)",
                schema: { type: "string", example: "https://www.instagram.com/reel/DIYysAWIe6B/" },
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
                                                    directUrl: { type: "string" },
                                                    filename: { type: "string" },
                                                    expiresAt: { type: "string" },
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
            const result = await savegram(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
