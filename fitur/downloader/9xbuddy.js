import axios from "axios"
import dns from "node:dns"
import net from "node:net"

const dnsLookup = dns.promises

const SITE = "https://9xbuddy.site"
const HOST = "9xbuddy.site"
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const UA_BOT = "facebookexternalhit/1.1"
const TRACKING_PARAMS = ["rdid", "share_url", "_r", "_t", "_d", "_svg", "checksum", "rgssign", "u_code", "share_link_id", "mibextid"]
const MEDIA_RE = /\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|avi|mp3|m4a|aac|wav|ogg|jpg|jpeg|png|webp|gif)(\?|#|$)/i

class XbuddyError extends Error {
    constructor(message, details = {}) {
        super(message)
        this.name = "XbuddyError"
        this.details = details
    }
}

class Cipher {
    ord(v) {
        const s = `${v}`
        const c = s.charCodeAt(0)
        return c >= 55296 && c <= 56319 && s.length > 1 ? (c - 55296) * 1024 + (s.charCodeAt(1) - 56320) + 65536 : c
    }

    b64enc(s) {
        const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        const out = []
        let p
        let m = 0
        for (let i = 0; i < s.length; i += 1) {
            const c = s.charCodeAt(i)
            m = i % 3
            if (m === 0) out.push(t[c >> 2])
            if (m === 1) out.push(t[((p & 3) << 4) | (c >> 4)])
            if (m === 2) out.push(t[((p & 15) << 2) | (c >> 6)], t[c & 63])
            p = c
        }
        if (m === 0) out.push(t[(p & 3) << 4], "==")
        if (m === 1) out.push(t[(p & 15) << 2], "=")
        return out.join("")
    }

    b64dec(s) {
        const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        const input = String(s || "").replace(/\s|=/g, "")
        const out = []
        let p = 0
        for (let i = 0; i < input.length; i += 1) {
            const c = t.indexOf(input[i])
            const m = i % 4
            if (m === 1) out.push(String.fromCharCode((p << 2) | (c >> 4)))
            if (m === 2) out.push(String.fromCharCode(((p & 15) << 4) | (c >> 2)))
            if (m === 3) out.push(String.fromCharCode(((p & 3) << 6) | c))
            p = c
        }
        return out.join("")
    }

    encrypt(text, key) {
        let out = ""
        for (let i = 0; i < text.length; i += 1) out += String.fromCharCode(this.ord(text[i]) + this.ord(key.substr((i % key.length) - 1, 1)))
        return this.b64enc(out)
    }

    decrypt(text, key) {
        const raw = this.b64dec(text)
        let out = ""
        for (let i = 0; i < raw.length; i += 1) out += String.fromCharCode(this.ord(raw[i]) - this.ord(key.substr((i % key.length) - 1, 1)))
        return out
    }

    hex2bin(hex) {
        const out = []
        for (let i = 0; i < String(hex || "").length; i += 2) {
            const a = parseInt(hex[i], 16)
            const b = parseInt(hex[i + 1], 16)
            if (Number.isNaN(a) || Number.isNaN(b)) return ""
            out.push((a << 4) | b)
        }
        return String.fromCharCode(...out)
    }
}

const cipher = new Cipher()

function cleanUrl(url, base) {
    try {
        return new URL(String(url || "").trim().replace(/\\%/g, "%").replace(/\\u0026|&amp;/g, "&"), base).toString()
    } catch {
        return null
    }
}

function mediaType(url, ext = "") {
    const u = String(url || "").split(/[?#]/)[0].toLowerCase()
    const e = String(ext || "").toLowerCase()
    if (u.endsWith(".m3u8")) return "hls"
    if (u.endsWith(".mpd")) return "dash"
    if (u.endsWith(".mp4") || e === "mp4") return "mp4"
    if (u.endsWith(".webm") || e === "webm") return "webm"
    if (u.endsWith(".mp3") || e === "mp3") return "mp3"
    if (u.endsWith(".m4a") || e === "m4a") return "m4a"
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u) || ["jpg", "jpeg", "png", "webp", "gif"].includes(e)) return "image"
    return "link"
}

function scoreItem(item) {
    let n = 0
    if (["hls", "dash", "mp4", "webm"].includes(item.type)) n += 100
    if (["mp3", "m4a"].includes(item.type)) n += 80
    if (item.type === "image") n += 30
    if (/cdn|media|video|stream|download|playback|cloudfront|googlevideo|fbcdn/.test(`${item.url} ${item.label}`.toLowerCase())) n += 20
    return n
}

function makeMedia(url, meta = {}) {
    const finalUrl = cleanUrl(url, SITE)
    if (!finalUrl) return null
    const type = mediaType(finalUrl, meta.ext)
    if (type === "link" && !MEDIA_RE.test(finalUrl)) return null
    const item = {
        url: finalUrl,
        type,
        label: String(meta.quality || meta.label || "").trim(),
        quality: meta.quality || undefined,
        ext: meta.ext || undefined,
        size: meta.size || undefined,
        source: "9xbuddy",
    }
    item.score = scoreItem(item)
    return item.score > 0 ? item : null
}

function unique(items) {
    const seen = new Set()
    return items
        .filter(Boolean)
        .filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)))
        .sort((a, b) => b.score - a.score)
}

function parseInit(html) {
    const start = html.indexOf("{", html.indexOf("window.__INIT__"))
    if (start < 0) throw new XbuddyError("Gagal membaca init dari halaman")
    let depth = 0
    let str = false
    let esc = false
    for (let i = start; i < html.length; i += 1) {
        const c = html[i]
        if (esc) {
            esc = false
            continue
        }
        if (c === "\\") {
            esc = true
            continue
        }
        if (c === "\"") str = !str
        if (str) continue
        if (c === "{") depth += 1
        if (c === "}") depth -= 1
        if (depth === 0) return JSON.parse(html.slice(start, i + 1))
    }
    throw new XbuddyError("init tidak lengkap")
}

function cssHash(html) {
    const m = html.match(/\/build\/(?:assets\/)?main\.([^"]+?)\.css/)
    if (!m) throw new XbuddyError("Hash CSS tidak ditemukan")
    return m[1]
}

function buildAuthToken(html, init) {
    const key = cssHash(html).split("").reverse().join("")
    const ua = init.ua.split("").reverse().join("").slice(0, 10)
    const phrase = [90, 84, 94, 100, 81, 81, 74, 89, 100, 70, 83, 83, 84, 76, 100, 89, 84, 83, 100, 82, 78, 100, 74, 89, 70, 82, 100, 94, 87, 87, 84, 88]
        .map((x) => String.fromCharCode(x - 5))
        .reverse()
        .join("")
    return cipher.encrypt(`${HOST}${key}${ua}${phrase}xbuddy123sudo-${init.appVersion}${init.appVersion}`, key)
}

function decodeUrl(value, token, hash) {
    if (!value || /^https?:\/\//i.test(value)) return value
    const bin = cipher.hex2bin(value)
    return bin ? cipher.decrypt(bin.split("").reverse().join(""), `SORRY_MATE${HOST.length}${hash}${token}`) : value
}

function needsResolve(u) {
    try {
        const x = new URL(u)
        const h = x.hostname.toLowerCase()
        if (/^v[mt]\.tiktok\.com$/.test(h)) return true
        if (h === "fb.watch") return true
        if (/(^|\.)facebook\.com$/.test(h) && /\/share\//.test(x.pathname)) return true
        return false
    } catch {
        return false
    }
}

async function resolveShortUrl(url) {
    if (!needsResolve(url)) return url
    let cur = url
    try {
        for (let i = 0; i < 10; i += 1) {
            const r = await axios.get(cur, {
                maxRedirects: 0,
                validateStatus: () => true,
                timeout: 8000,
                headers: { "user-agent": UA_BOT, "accept-language": "en-US,en;q=0.9" },
                transformResponse: [(x) => x],
            })
            const loc = r.headers.location
            if (r.status >= 300 && r.status < 400 && loc) {
                cur = new URL(loc, cur).toString()
                continue
            }
            if (r.status === 200 && typeof r.data === "string") {
                const m = r.data.match(/property="og:url" content="([^"]+)"/)
                if (m) cur = m[1].replace(/&amp;/g, "&")
            }
            break
        }
        const x = new URL(cur)
        TRACKING_PARAMS.forEach((k) => x.searchParams.delete(k))
        cur = x.toString()
    } catch {
        return url
    }
    return cur
}

async function ensurePublicUrl(url) {
    const u = cleanUrl(url)
    if (!u || !/^https?:\/\//i.test(u)) throw new XbuddyError("URL tidak valid")
    const h = new URL(u).hostname
    if (h === "localhost" || h.endsWith(".localhost") || net.isIP(h)) throw new XbuddyError("Host private tidak diizinkan")
    const ips = await dnsLookup.lookup(h, { all: true })
    if (ips.some((x) => /^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(x.address) || x.address === "::1")) {
        throw new XbuddyError("URL resolve ke private network")
    }
    return u
}

async function xbuddy(target, opt = {}) {
    const resolved = await resolveShortUrl(target)
    const url = await ensurePublicUrl(resolved)
    const timeout = opt.timeout || opt.timeoutMs || 30000
    const pageUrl = `${SITE}/process?url=${encodeURIComponent(url)}`
    const client = axios.create({
        timeout,
        maxBodyLength: 8 * 1024 * 1024,
        maxContentLength: 8 * 1024 * 1024,
        headers: { "user-agent": UA, "accept-language": "id-ID", accept: "application/json, text/plain, */*" },
    })

    const html = (await client.get(pageUrl, { transformResponse: [(x) => x] })).data
    const init = parseInit(html)
    const hash = cssHash(html)
    const authToken = buildAuthToken(html, init)
    const headers = {
        "content-type": "application/json; charset=UTF-8",
        "x-requested-with": "xmlhttprequest",
        "x-auth-token": authToken,
        "x-requested-domain": HOST,
        origin: SITE,
        referer: `${SITE}/`,
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
    }

    const tokenRes = (await client.post(`${init.apiBase}/token`, {}, { headers })).data
    const access = tokenRes?.access_token
    if (!access) throw new XbuddyError("Gagal mengambil access token", { response: tokenRes })

    const body = {
        url: encodeURIComponent(url),
        _sig: cipher.encrypt(encodeURIComponent(url), `${authToken}jv7g2_DAMNN_DUDE`),
        searchEngine: "yt",
        skipCache: false,
    }
    const data = (await client.post(`${init.apiBase}/extract`, body, { headers: { ...headers, "x-access-token": access } })).data
    if (data?.status !== "1" || !data.response) {
        const upstream = data?.message
        const message =
            upstream === "NO_LINKS"
                ? "Media tidak ditemukan atau tidak didukung untuk URL ini (mis. slideshow foto TikTok)"
                : `Gagal extract 9xbuddy${upstream ? `: ${upstream}` : ""}`
        throw new XbuddyError(message, { response: data })
    }

    const res = data.response
    const media = unique([
        ...(res.formats || []).map((x) => makeMedia(decodeUrl(x.url, res.token, hash), x)),
        makeMedia(decodeUrl(res.thumbnail, res.token, hash), { label: "thumbnail" }),
    ])

    return {
        sourceUrl: url,
        finalUrl: pageUrl,
        title: String(res.title || "").trim() || "9xbuddy",
        caption: res.uploader ? `Uploader: ${res.uploader}` : "",
        siteName: "9xbuddy",
        thumbnail: cleanUrl(decodeUrl(res.thumbnail, res.token, hash), SITE),
        media,
        bestMedia: media[0] || null,
    }
}

export default {
    route: {
        method: "get",
        path: "/downloader/9xbuddy",
        auth: false,
        tags: ["Downloader"],
        summary: "Download media dari berbagai situs via 9xbuddy",
        description: "Mengekstrak link unduhan media (video/audio/gambar) dari berbagai platform (YouTube, Facebook, Vimeo, dll) menggunakan 9xbuddy.site.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL media yang ingin diunduh",
                schema: { type: "string", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
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
                                        sourceUrl: { type: "string" },
                                        title: { type: "string" },
                                        caption: { type: "string" },
                                        siteName: { type: "string" },
                                        thumbnail: { type: "string" },
                                        media: { type: "array" },
                                        bestMedia: { type: "object" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": {
                description: "URL tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } },
            },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        try {
            const result = await xbuddy(url)
            res.json({ ok: true, result })
        } catch (e) {
            const status = e.name === "XbuddyError" && /tidak valid|private/i.test(e.message) ? 400 : 500
            res.status(e.response?.status || status).json({ ok: false, error: e.message })
        }
    },
}
