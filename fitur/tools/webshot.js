import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async function shotMicrolink(target, width) {
    const { data } = await axios.get("https://api.microlink.io", {
        params: {
            url: target,
            screenshot: true,
            meta: false,
            "viewport.width": width,
        },
        timeout: 45000,
        headers: { "user-agent": UA },
    })
    const shot = data?.data?.screenshot?.url
    if (data?.status !== "success" || !shot) throw new Error("Microlink gagal mengambil screenshot")
    const img = await axios.get(shot, { responseType: "arraybuffer", timeout: 30000 })
    return Buffer.from(img.data)
}

async function shotThum(target, width, fullpage) {
    const mode = fullpage ? "fullpage/" : ""
    const url = `https://image.thum.io/get/${mode}width/${width}/${target}`
    const img = await axios.get(url, { responseType: "arraybuffer", timeout: 60000, headers: { "user-agent": UA } })
    return Buffer.from(img.data)
}

export default {
    route: {
        method: "get",
        path: "/tools/webshot",
        auth: false,
        tags: ["Tools"],
        summary: "Screenshot website (microlink, fallback thum.io)",
        description:
            "Mengambil screenshot halaman website dan mengembalikannya sebagai gambar PNG/JPG. Provider utama: Microlink API (gratis). Jika gagal, otomatis fallback ke thum.io. Gunakan parameter fullpage=1 untuk menangkap seluruh halaman (hanya berlaku saat fallback thum.io).",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL website yang ingin di-screenshot",
                schema: { type: "string", example: "https://www.google.com" },
            },
            {
                name: "width",
                in: "query",
                required: false,
                description: "Lebar viewport dalam px (default: 1280)",
                schema: { type: "integer", example: 1280 },
            },
            {
                name: "fullpage",
                in: "query",
                required: false,
                description: "Tangkap seluruh halaman (1 = ya). Hanya efektif pada fallback thum.io",
                schema: { type: "string", enum: ["0", "1"], example: "0" },
            },
        ],
        responses: {
            "200": {
                description: "Screenshot berhasil (image binary)",
                content: { "image/png": { schema: { type: "string", format: "binary" } } },
            },
            "400": { description: "URL tidak valid" },
            "502": { description: "Semua provider gagal" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        const width = Math.min(Math.max(parseInt(req.query.width) || 1280, 320), 3840)
        const fullpage = req.query.fullpage === "1"

        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }

        const providers = [
            () => shotMicrolink(url, width),
            () => shotThum(url, width, fullpage),
        ]

        let lastErr
        for (const provider of providers) {
            try {
                const buffer = await provider()
                res.set("Content-Type", "image/png")
                return res.send(buffer)
            } catch (e) {
                lastErr = e
            }
        }
        res.status(502).json({ ok: false, error: `Semua provider gagal: ${lastErr?.message}` })
    },
}
