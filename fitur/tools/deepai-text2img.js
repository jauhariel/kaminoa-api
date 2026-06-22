import crypto from "crypto"

const AGENT = "Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36"
const SALT = "hackers_become_a_little_stinkier_every_time_they_hack"

const md5 = s => crypto.createHash("md5").update(s).digest("hex")
const reverse = s => s.split("").reverse().join("")
const randomIP = () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 254)).join(".")

function genKEY() {
    const r = String(Math.floor(Math.random() * 1e11))
    const h1 = reverse(md5(AGENT + r + SALT))
    const h2 = reverse(md5(AGENT + h1))
    const h3 = reverse(md5(AGENT + h2))
    return `tryit-${r}-${h3}`
}

async function text2img(prompt, style, gridSize) {
    const form = new FormData()
    form.append("text", prompt)
    if (style) form.append("style", style)
    if (gridSize) form.append("grid_size", gridSize)

    const res = await fetch("https://api.deepai.org/api/text2img", {
        method: "POST",
        headers: {
            accept: "*/*",
            origin: "https://deepai.org",
            referer: "https://deepai.org/",
            "user-agent": AGENT,
            "api-key": genKEY(),
            "x-forwarded-for": randomIP()
        },
        body: form
    })
    const json = await res.json()
    if (json?.output_url) return json.output_url
    throw new Error(json?.status || json?.err || `HTTP ${res.status}`)
}

export default {
    route: {
        method: "get",
        path: "/tools/deepai/text2img",
        auth: false,
        tags: ["Tools"],
        summary: "DeepAI Text to Image",
        description: "Generate gambar dari teks menggunakan DeepAI text2img model (gratis, tanpa API key).",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Deskripsi gambar yang ingin dibuat",
                schema: { type: "string", example: "a serene mountain lake at sunrise" }
            },
            {
                name: "style",
                in: "query",
                required: false,
                description: "Gaya gambar (cosmic, noir, neon, pastel, vibrant, dll)",
                schema: { type: "string", example: "cinematic" }
            },
            {
                name: "grid_size",
                in: "query",
                required: false,
                description: "Jumlah gambar (1, 2, 4)",
                schema: { type: "string", example: "1" }
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
                                result: { type: "string", description: "URL gambar hasil generate" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal generate gambar" }
        }
    },

    handler: async (req, res) => {
        const { prompt, style, grid_size } = req.query
        if (!prompt?.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }
        try {
            const result = await text2img(prompt.trim(), style || undefined, grid_size || undefined)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
