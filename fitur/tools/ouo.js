import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0"
const ALLOWED_HOSTS = ["ouo.io", "ouo.press"]

// gabung Set-Cookie dari respons jadi satu header Cookie (tanpa butuh cookie jar)
const collectCookies = (setCookie = []) => setCookie.map((c) => c.split(";")[0]).join("; ")

const ouo = async (input) => {
    // normalisasi: terima dengan/tanpa skema (mis. "ouo.press/abc")
    let url
    try {
        url = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input)
    } catch {
        throw new Error("URL tidak valid")
    }
    if (!ALLOWED_HOSTS.includes(url.hostname)) {
        throw new Error("host harus ouo.io atau ouo.press")
    }

    const host = url.hostname
    const id = url.pathname.replace(/^\//, "")

    const baseHeaders = {
        Host: host,
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": 1,
        "Sec-Fetch-Site": "same-origin",
    }

    const init = await axios.get(url.href, { headers: baseHeaders, validateStatus: () => true })
    if (init.status !== 200) throw new Error(`Gagal membuka link (HTTP ${init.status})`)

    const token = cheerio.load(init.data)('input[name="_token"]').val()
    if (!token) throw new Error("Token tidak ditemukan (link mati / diblokir)")

    const cookies = collectCookies(init.headers["set-cookie"])

    const response = await axios.post(
        `https://${host}/xreallcygo/${id}`,
        new URLSearchParams({ _token: token, "x-token": "" }).toString(),
        {
            headers: {
                ...baseHeaders,
                "Content-Type": "application/x-www-form-urlencoded",
                ...(cookies ? { Cookie: cookies } : {}),
                Referer: `https://${host}/go/${id}`,
                Origin: `https://${host}`,
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-User": "?1",
                Priority: "u=0, i",
            },
            maxRedirects: 0,
            validateStatus: () => true,
        },
    )

    const location = response.headers.location
    // location yang balik ke homepage = gagal resolve (kena anti-bot)
    if (!location || /\/\/ouo\.(io|press)\/?$/i.test(location)) {
        throw new Error("Gagal resolve (kemungkinan diblokir captcha)")
    }
    return location
}

export default {
    route: {
        method: "get",
        path: "/tools/ouo",
        tags: ["Tools"],
        summary: "resolver url shortener ouo.io atau ouo.press",
        description: "Membuka tautan pendek ouo.io / ouo.press menjadi URL tujuan aslinya. URL wajib diawali http:// atau https://.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "url ouo, wajib diawali http:// atau https:// (mis. https://ouo.press/DizKA40)",
                schema: { type: "string", example: "https://ouo.press/DizKA40" },
            },
        ],
        responses: {
            200: {
                description: "Berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean" },
                                result: { type: "string" },
                            },
                        },
                    },
                },
            },
        },
    },
    handler: async (req, res) => {
        const { url } = req.query
        if (!url) return res.status(400).json({ ok: false, error: "url wajib diisi" })
        try {
            res.json({ ok: true, result: await ouo(url) })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
