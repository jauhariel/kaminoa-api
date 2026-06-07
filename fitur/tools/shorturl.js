import axios from "axios"

const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

const providers = {
    tinyurl: async (url, custom) => {
        const endpoint = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}&alias=${encodeURIComponent(custom || "")}`
        const res = await axios.get(endpoint, { headers: { "User-Agent": ua, "Accept-Encoding": "gzip" } })
        return res.data.trim()
    },

    spoome: async (url, custom) => {
        const endpoint = `https://spoo.me/?alias=${encodeURIComponent(custom || "")}&url=${encodeURIComponent(url)}`
        const res = await axios.post(endpoint, null, {
            headers: {
                "User-Agent": ua,
                "Accept-Encoding": "gzip",
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json"
            }
        })
        return res.data.short_url
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/shorturl",
        auth: false,
        tags: ["Tools"],
        summary: "Short URL",
        description: "Persingkat URL menggunakan berbagai provider pilihan.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL yang ingin dipersingkat",
                schema: { type: "string", example: "https://example.com/halaman-yang-sangat-panjang" }
            },
            {
                name: "provider",
                in: "query",
                required: false,
                description: "Provider shortener yang digunakan",
                schema: { type: "string", enum: ["tinyurl", "spoome"], default: "tinyurl" }
            },
            {
                name: "custom",
                in: "query",
                required: false,
                description: "Nama custom untuk short URL (tidak semua provider mendukung)",
                schema: { type: "string", example: "namaku" }
            }
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
                                provider: { type: "string", example: "tinyurl" },
                                original: { type: "string" },
                                short: { type: "string", example: "https://tinyurl.com/namaku" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server / provider",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { url, provider = "tinyurl", custom } = req.query
        if (!url) return res.status(400).json({ ok: false, error: "url wajib diisi" })
        if (!providers[provider]) {
            return res.status(400).json({ ok: false, error: `provider tidak valid, pilih: ${Object.keys(providers).join(", ")}` })
        }
        try {
            const short = await providers[provider](url, custom || "")
            res.json({ ok: true, provider, original: url, short })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
