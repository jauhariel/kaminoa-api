import axios from "axios"
import crypto from "crypto"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"
const SALT = "Yes, absolutely! Our website is fully responsive and optimized for all devices."
const TS_DELTA = 7124
const BASE = "https://instashadow.com/api"
const MEDIA_BASE = "https://instashadow.com"

const KEY_MAP = {
    iu: "image_url", vu: "video_url", hu: "thumbnail_url", vhu: "video_thumbnail_url",
    lc: "like_count", cc: "comment_count", pd: "publish_date", c: "caption",
    id: "media_id", shortcode: "shortcode", om: "other_media",
    fn: "full_name", pp: "profile_pic", hpp: "hd_profile_pic",
    frc: "follower_count", fgc: "following_count", mc: "media_count", b: "biography",
}

function decId(enc) {
    try { return decodeURIComponent(enc || "").split("").reverse().join("") } catch { return enc || "" }
}

function getMed(id) {
    return id ? `${MEDIA_BASE}/media?id=${encodeURIComponent(id)}` : null
}

function cleanObject(obj) {
    if (!obj || typeof obj !== "object") return obj
    if (Array.isArray(obj)) return obj.map(cleanObject)
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
        const nk = KEY_MAP[k] || k
        if (["iu", "vu", "hu", "vhu", "pp", "hpp"].includes(k) && typeof v === "string") {
            out[nk] = getMed(decId(v))
        } else if (v && typeof v === "object") {
            out[nk] = cleanObject(v)
        } else {
            out[nk] = v ?? null
        }
    }
    return out
}

function processResponse(data) {
    const targetKey = ["r", "p", "s", "u"].find(k => k in (data || {}))
    if (!targetKey) return data
    if (targetKey === "u" && !Array.isArray(data.u)) return { profile: cleanObject(data.u) }
    const list = cleanObject(data[targetKey])
    if (targetKey === "s" && data.u) return { profile: cleanObject(data.u), stories: list }
    return list
}

function parseUrl(url) {
    const s = url || ""
    if (/instagram\.com\/reel\//i.test(s)) return { ep: "reels", pl: { _ei: s } }
    if (/instagram\.com\/p\//i.test(s)) return { ep: "posts", pl: { _u: s } }
    if (/instagram\.com\/tv\//i.test(s)) return { ep: "posts", pl: { _u: s } }
    const storyM = s.match(/instagram\.com\/stories\/([^/?]+)/i)
    if (storyM) return { ep: "stories", pl: { _u: storyM[1] } }
    const userM = s.match(/instagram\.com\/([^/?]+)/i)
    if (userM) return { ep: "posts", pl: { _u: userM[1] } }
    return { ep: "posts", pl: { _u: s } }
}

async function sign(payload) {
    const loadedAt = Date.now() - TS_DELTA
    const U = JSON.stringify(payload || {}) + UA
    const P = SALT + loadedAt
    let xored = ""
    for (let i = 0; i < U.length; i++) {
        xored += String.fromCharCode(U.charCodeAt(i) ^ P.charCodeAt(i % P.length))
    }
    const enc = new TextEncoder().encode(xored)
    const hashBuf = await crypto.webcrypto.subtle.digest("SHA-256", enc)
    const bytes = Array.from(new Uint8Array(hashBuf))
    const b64 = btoa(String.fromCharCode(...bytes))
    const sig = b64.replace(/\+/g, "*").replace(/\//g, "~").replace(/=/g, "!")
    return { ...payload, _s: sig, _s1: loadedAt + TS_DELTA }
}

async function instashadow(url) {
    const { ep, pl } = parseUrl(url)
    const body = await sign(pl)
    const { data } = await axios.post(`${BASE}/${ep}`, body, {
        headers: {
            accept: "*/*",
            "accept-language": "id-ID",
            "content-type": "application/json",
            origin: MEDIA_BASE,
            referer: `${MEDIA_BASE}/en`,
            "user-agent": UA,
        },
        timeout: 30000,
    })
    if (data.e) throw new Error(data.e === "something went wrong" ? "Media tidak ditemukan atau API gagal" : data.e)
    const result = processResponse(data)
    if (!result || (Array.isArray(result) && !result.length)) throw new Error("Media tidak ditemukan")
    return Array.isArray(result) ? result : [result]
}

export default {
    route: {
        method: "get",
        path: "/downloader/instashadow",
        auth: false,
        tags: ["Downloader"],
        summary: "Download Instagram via instashadow.com",
        description: "Mengunduh media Instagram (post, reel, stories, profile) via instashadow.com. Tidak memerlukan cookie Instagram.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL Instagram (post /p/, reel /reel/, /tv/, atau stories)",
                schema: { type: "string", example: "https://www.instagram.com/reel/DathhigO4m9/" },
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
                                result: { type: "object" },
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
            const result = await instashadow(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
