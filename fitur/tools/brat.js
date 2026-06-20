import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import axios from "axios"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { upload } from "../../lib/uploader.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "brat", "fonts")
const FONT_PATH = path.join(FONTS_DIR, "arial_narrow.woff")
// Font Arial Narrow yang dipakai bratgenerator.com (di-host situsnya sendiri).
const FONT_URL = "https://www.bratgenerator.com/sites/g/files/g2000017981/files/2024-03/arial_narrow-webfont.woff"

const STYLES = {
    green: { bg: "#8ACF00", fg: "#000000" }, // klasik brat
    white: { bg: "#ffffff", fg: "#000000" },
    black: { bg: "#000000", fg: "#ffffff" },
}

const OUT_FORMAT = "webp"
const OUT_QUALITY = 92

// ── Bootstrap font (sekali, di-cache) ───────────────────────────
let fontReady = null
function ensureFont() {
    if (!fontReady) {
        fontReady = (async () => {
            if (!fs.existsSync(FONT_PATH) || fs.statSync(FONT_PATH).size <= 0) {
                fs.mkdirSync(FONTS_DIR, { recursive: true })
                const r = await axios.get(FONT_URL, {
                    responseType: "arraybuffer",
                    timeout: 30000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        Referer: "https://www.bratgenerator.com/",
                        Accept: "*/*",
                    },
                })
                const buf = Buffer.from(r.data)
                // WOFF magic = 'wOFF'. Kalau bukan, kemungkinan kena halaman error WAF.
                if (buf.subarray(0, 4).toString("ascii") !== "wOFF") {
                    throw new Error("Gagal unduh font brat (respon bukan WOFF)")
                }
                fs.writeFileSync(FONT_PATH, buf)
            }
            if (!GlobalFonts.families.some(f => f.family === "BratNarrow")) {
                GlobalFonts.registerFromPath(FONT_PATH, "BratNarrow")
            }
        })().catch(e => { fontReady = null; throw e })
    }
    return fontReady
}

// Pecah teks jadi baris yang muat di lebar maxW pada ukuran font tertentu.
// Kata tunggal yang lebih lebar dari maxW dipecah per-huruf supaya tidak mberot.
function wrapLines(ctx, text, maxW, fontSize) {
    ctx.font = `${fontSize}px BratNarrow`
    const words = text.split(/\s+/).filter(Boolean)
    const lines = []
    let cur = ""
    for (const w of words) {
        // Kata terlalu lebar utk satu baris → patah per-huruf.
        if (ctx.measureText(w).width > maxW) {
            if (cur) { lines.push(cur); cur = "" }
            let chunk = ""
            for (const ch of w) {
                if (!chunk || ctx.measureText(chunk + ch).width <= maxW) {
                    chunk += ch
                } else {
                    lines.push(chunk)
                    chunk = ch
                }
            }
            cur = chunk
            continue
        }
        const trial = cur ? cur + " " + w : w
        if (ctx.measureText(trial).width <= maxW || !cur) {
            cur = trial
        } else {
            lines.push(cur)
            cur = w
        }
    }
    if (cur) lines.push(cur)
    return lines
}

/**
 * Render kartu brat → Buffer.
 * @param {{ text: string, style?: string, blur?: boolean, size?: number }} o
 */
async function renderBrat({ text, style = "white", blur = false, size = 1000 }) {
    await ensureFont()

    const { bg, fg } = STYLES[style] || STYLES.green
    const canvas = createCanvas(size, size)
    const ctx = canvas.getContext("2d")

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)

    const str = String(text).toLowerCase().trim() || "brat"
    const pad = size * 0.06
    const maxW = size - pad * 2
    const maxH = size - pad * 2
    const lineGap = 0.92

    // Auto-fit: font terbesar yang muat (tiap baris ≤ maxW & total tinggi ≤ maxH).
    let fontSize = size
    let lines = []
    for (; fontSize > 8; fontSize -= 2) {
        lines = wrapLines(ctx, str, maxW, fontSize)
        const totalH = lines.length * fontSize * lineGap
        const widest = Math.max(...lines.map(l => ctx.measureText(l).width))
        if (totalH <= maxH && widest <= maxW) break
    }

    ctx.font = `${fontSize}px BratNarrow`
    ctx.fillStyle = fg
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    if (blur) ctx.filter = "blur(2px)"

    const lineH = fontSize * lineGap
    let y = pad + (maxH - lines.length * lineH) / 2
    for (const line of lines) {
        ctx.fillText(line, pad, y)
        y += lineH
    }
    if (blur) ctx.filter = "none"

    return canvas.encode(OUT_FORMAT, OUT_QUALITY)
}

export default {
    route: {
        method: "get",
        path: "/tools/brat",
        auth: false,
        tags: ["Tools"],
        summary: "Brat Generator",
        description: "Membuat gambar teks gaya album 'brat' (Charli XCX). Varian warna hijau klasik/putih/hitam, blur opsional, teks auto-wrap.",
        parameters: [
            {
                name: "text",
                in: "query",
                required: true,
                description: "Teks yang ditampilkan (otomatis lowercase, maks 20 kata)",
                schema: { type: "string", example: "brat" },
            },
            {
                name: "style",
                in: "query",
                required: false,
                description: "Varian warna: white (default), green, black",
                schema: { type: "string", enum: ["green", "white", "black"], default: "white" },
            },
            {
                name: "blur",
                in: "query",
                required: false,
                description: "Aktifkan efek blur khas brat (true/false, default false)",
                schema: { type: "boolean", default: false },
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
                                url: { type: "string" },
                                provider: { type: "string" },
                                style: { type: "string" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal membuat gambar" },
        },
    },

    handler: async (req, res) => {
        const text = req.query.text?.trim()
        if (!text) return res.status(400).json({ ok: false, error: "text wajib diisi" })

        const style = String(req.query.style || "white").toLowerCase()
        if (!STYLES[style]) {
            return res.status(400).json({ ok: false, error: `style tidak valid, pilih: ${Object.keys(STYLES).join(", ")}` })
        }
        const blur = req.query.blur === "true" || req.query.blur === "1"

        const words = text.split(/\s+/).filter(Boolean)
        if (words.length > 20) {
            return res.status(400).json({ ok: false, error: "teks terlalu panjang (maks 20 kata)" })
        }

        try {
            const buffer = await renderBrat({ text: words.join(" "), style, blur })
            const filename = `brat-${style}-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}.webp`
            const { url, provider } = await upload(buffer, filename)
            res.json({ ok: true, url, provider, style })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
