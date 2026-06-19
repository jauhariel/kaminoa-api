import axios from "axios"
import { upload } from "../../lib/uploader.js"
import { translate } from "./translate.js"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const ENDPOINT = "https://translate.google.com/translate_tts"
const TTS_LIMIT = 200 // endpoint gratis menolak (HTTP 400) teks > ~200 karakter per request

// Pecah teks jadi potongan <= limit, diusahakan memotong di batas spasi.
function chunkText(text, limit = TTS_LIMIT) {
    const chunks = []
    let rest = text.trim().replace(/\s+/g, " ")
    while (rest.length > limit) {
        let cut = rest.lastIndexOf(" ", limit)
        if (cut <= 0) cut = limit // satu kata super panjang: potong paksa
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
    }
    if (rest) chunks.push(rest)
    return chunks
}

async function ttsChunk(text, lang, idx, total) {
    const url = `${ENDPOINT}?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&total=${total}&idx=${idx}&textlen=${text.length}&q=${encodeURIComponent(text)}`
    const { data } = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "user-agent": UA, referer: "https://translate.google.com/" },
        timeout: 30000,
    })
    return Buffer.from(data)
}

// Hasilkan satu buffer MP3 untuk teks (otomatis dipecah & digabung kalau panjang).
export async function tts(text, lang = "id") {
    const chunks = chunkText(text)
    const buffers = []
    for (let i = 0; i < chunks.length; i += 1) {
        buffers.push(await ttsChunk(chunks[i], lang, i, chunks.length))
    }
    return { buffer: Buffer.concat(buffers), chunks: chunks.length }
}

export default {
    route: {
        method: "get",
        path: "/tools/tts",
        auth: false,
        tags: ["Tools"],
        summary: "Text to Speech (Google Translate TTS)",
        description: "Mengubah teks menjadi audio MP3 via Google Translate TTS. Teks panjang otomatis dipecah (≤200 char) lalu digabung. Set translate=true untuk menerjemahkan dulu dari 'from' ke 'to' sebelum dibacakan. Tanpa API key.",
        parameters: [
            {
                name: "text",
                in: "query",
                required: true,
                description: "Teks yang ingin dijadikan audio",
                schema: { type: "string", example: "Selamat pagi semuanya" },
            },
            {
                name: "to",
                in: "query",
                required: false,
                description: "Kode bahasa suara/output (default id). Bila translate=true, ini juga bahasa tujuan terjemahan.",
                schema: { type: "string", default: "id", example: "ja" },
            },
            {
                name: "translate",
                in: "query",
                required: false,
                description: "true = terjemahkan dulu dari 'from' ke 'to' sebelum TTS",
                schema: { type: "boolean", default: false },
            },
            {
                name: "from",
                in: "query",
                required: false,
                description: "Bahasa sumber untuk terjemahan (dipakai bila translate=true), 'auto' untuk deteksi",
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
                                url: { type: "string", description: "URL file MP3 hasil" },
                                provider: { type: "string" },
                                lang: { type: "string" },
                                translated: { type: "boolean" },
                                text: { type: "string", description: "Teks yang dibacakan" },
                                chunks: { type: "integer", description: "Jumlah potongan TTS yang digabung" },
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
        const input = (req.query.text || "").toString()
        if (!input.trim()) return res.status(400).json({ ok: false, error: "text wajib diisi" })
        const to = (req.query.to || "id").toString().trim()
        const from = (req.query.from || "auto").toString().trim()
        const doTranslate = String(req.query.translate) === "true"

        try {
            let spoken = input
            if (doTranslate) {
                const { translated } = await translate(input, from, to)
                if (translated) spoken = translated
            }

            const { buffer, chunks } = await tts(spoken, to)
            const { url, provider } = await upload(buffer, `tts_${to}_${Date.now()}.mp3`)
            res.json({ ok: true, url, provider, lang: to, translated: doTranslate, text: spoken, chunks })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
