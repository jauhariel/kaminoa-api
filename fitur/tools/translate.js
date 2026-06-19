import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const ENDPOINT = "https://translate.googleapis.com/translate_a/single"

// Terjemah via endpoint gratis Google (tanpa API key / package tambahan).
// from "auto" = deteksi otomatis. Mengembalikan teks + bahasa sumber terdeteksi.
export async function translate(text, from = "auto", to = "id") {
    const url = `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`
    const { data } = await axios.get(url, { headers: { "user-agent": UA }, timeout: 30000 })
    // data: [ [[segTerjemah, segAsli, ...], ...], null, detectedLang, ... ]
    const translated = (data?.[0] || []).map(seg => seg?.[0]).filter(Boolean).join("")
    return { translated, detected: data?.[2] || from }
}

export default {
    route: {
        method: "get",
        path: "/tools/translate",
        auth: false,
        tags: ["Tools"],
        summary: "Translate teks (Google Translate)",
        description: "Menerjemahkan teks menggunakan Google Translate. from='auto' untuk deteksi otomatis. Kode bahasa contoh: id, en, ja, ko, ar, zh-cn. Tanpa API key.",
        parameters: [
            {
                name: "text",
                in: "query",
                required: true,
                description: "Teks yang ingin diterjemahkan",
                schema: { type: "string", example: "Selamat pagi, apa kabar?" },
            },
            {
                name: "to",
                in: "query",
                required: false,
                description: "Kode bahasa tujuan (default id)",
                schema: { type: "string", default: "id", example: "ja" },
            },
            {
                name: "from",
                in: "query",
                required: false,
                description: "Kode bahasa sumber, 'auto' untuk deteksi otomatis (default auto)",
                schema: { type: "string", default: "auto", example: "id" },
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
                                from: { type: "string", description: "Bahasa sumber (terdeteksi bila auto)" },
                                to: { type: "string" },
                                text: { type: "string", description: "Teks asli" },
                                result: { type: "string", description: "Teks hasil terjemahan" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const text = (req.query.text || "").toString()
        if (!text.trim()) return res.status(400).json({ ok: false, error: "text wajib diisi" })
        const to = (req.query.to || "id").toString().trim()
        const from = (req.query.from || "auto").toString().trim()
        try {
            const { translated, detected } = await translate(text, from, to)
            res.json({ ok: true, from: detected, to, text, result: translated })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
