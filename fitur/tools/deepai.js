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

async function editImage(imageUrl, prompt) {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Gagal download gambar: ${imgRes.status}`)
    const imgBuf = Buffer.from(await imgRes.arrayBuffer())
    const contentType = imgRes.headers.get("content-type") || "image/jpeg"
    const deviceId = crypto.randomUUID()

    let last = "request failed"
    for (let i = 0; i < 6; i++) {
        const form = new FormData()
        form.append("image", new Blob([imgBuf], { type: contentType }), "image.jpg")
        form.append("text", prompt)
        form.append("image_generator_version", "standard")
        try {
            const res = await fetch("https://api.deepai.org/api/image-editor", {
                method: "POST",
                headers: {
                    accept: "*/*",
                    origin: "https://deepai.org",
                    referer: "https://deepai.org/",
                    "user-agent": AGENT,
                    "api-key": genKEY(),
                    "x-forwarded-for": randomIP(),
                    Cookie: `device_id=${deviceId}`
                },
                body: form
            })
            const json = await res.json().catch(() => null)
            if (json?.output_url) return json.output_url
            last = json?.status || json?.err || `http ${res.status}`
        } catch (e) { last = e.message }
    }
    throw new Error(last)
}

export default {
    route: {
        method: "get",
        path: "/tools/deepai",
        auth: false,
        tags: ["Tools"],
        summary: "DeepAI Image Editor",
        description: "Edit gambar menggunakan DeepAI Image Editor dengan instruksi teks.",
        parameters: [
            {
                name: "image",
                in: "query",
                required: true,
                description: "URL gambar yang akan diedit",
                schema: { type: "string", example: "https://example.com/image.jpg" }
            },
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Instruksi edit gambar",
                schema: { type: "string", example: "remove all text from the image" }
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
                                result: { type: "string", description: "URL gambar hasil edit" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal memproses gambar" }
        }
    },

    handler: async (req, res) => {
        const { image, prompt } = req.query
        if (!image) return res.status(400).json({ ok: false, error: "image wajib diisi" })
        if (!prompt) return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        try {
            const result = await editImage(image, prompt)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
