import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import webp from "node-webpmux"
import axios from "axios"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { upload } from "../../lib/uploader.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "brat", "fonts")
const FONT_PATH = path.join(FONTS_DIR, "arial_narrow.woff")
const FONT_URL = "https://www.bratgenerator.com/sites/g/files/g2000017981/files/2024-03/arial_narrow-webfont.woff"

const STYLES = {
    green: { bg: "#8ACF00", fg: "#000000" },
    white: { bg: "#ffffff", fg: "#000000" },
    black: { bg: "#000000", fg: "#ffffff" },
}

const SIZE = 1000
const SPEED = { slow: 650, normal: 450, fast: 280 } // ms per kata
const HOLD_MS = 1300 // tahan frame terakhir (teks lengkap)

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

// Layout final: tiap segmen dapat posisi tetap {str, x, wordIndex}. Dihitung
// sekali utk teks lengkap supaya kata tidak "loncat" saat di-reveal bertahap.
// Kata yang lebih lebar dari maxW dipecah per-huruf, tapi tiap potongan tetap
// menyimpan wordIndex asal → reveal tetap "satu kata satu langkah".
function computeLayout(ctx, words, maxW, fontSize) {
    ctx.font = `${fontSize}px BratNarrow`
    const spaceW = ctx.measureText(" ").width
    const lines = []
    let cur = { segs: [], width: 0 }
    const pushLine = () => { lines.push(cur); cur = { segs: [], width: 0 } }

    for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi]

        // Kata terlalu lebar utk satu baris → patah per-huruf antar baris.
        if (ctx.measureText(w).width > maxW) {
            if (cur.segs.length) pushLine()
            let chunk = ""
            for (const ch of w) {
                if (!chunk || ctx.measureText(chunk + ch).width <= maxW) {
                    chunk += ch
                } else {
                    cur.segs.push({ str: chunk, x: 0, wordIndex: wi })
                    cur.width = ctx.measureText(chunk).width
                    pushLine()
                    chunk = ch
                }
            }
            cur.segs.push({ str: chunk, x: 0, wordIndex: wi })
            cur.width = ctx.measureText(chunk).width
            continue
        }

        const ww = ctx.measureText(w).width
        const addW = cur.segs.length ? spaceW + ww : ww
        if (cur.segs.length && cur.width + addW > maxW) pushLine()
        const x = cur.segs.length ? cur.width + spaceW : 0
        cur.segs.push({ str: w, x, wordIndex: wi })
        cur.width = x + ww
    }
    if (cur.segs.length) pushLine()
    return lines
}

// Render satu frame: hanya `revealCount` kata pertama (akumulatif).
function renderFrame({ layout, revealCount, fontSize, pad, maxH, style, blur }) {
    const { bg, fg } = STYLES[style]
    const canvas = createCanvas(SIZE, SIZE)
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, SIZE, SIZE)

    ctx.font = `${fontSize}px BratNarrow`
    ctx.fillStyle = fg
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    if (blur) ctx.filter = "blur(2px)"

    const lineH = fontSize * 0.92
    const startY = pad + (maxH - layout.length * lineH) / 2

    // Tampilkan semua segmen yang berasal dari `revealCount` kata pertama.
    for (let li = 0; li < layout.length; li++) {
        const y = startY + li * lineH
        for (const seg of layout[li].segs) {
            if (seg.wordIndex < revealCount) ctx.fillText(seg.str, pad + seg.x, y)
        }
    }
    if (blur) ctx.filter = "none"
    return canvas
}

/**
 * Render brat animasi (reveal kata akumulatif) → Buffer animated WebP.
 */
async function renderBratAnim({ text, style = "white", blur = false, msPerWord = SPEED.normal }) {
    await ensureFont()

    const words = String(text).toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (!words.length) words.push("brat")

    const pad = SIZE * 0.06
    const maxW = SIZE - pad * 2
    const maxH = SIZE - pad * 2

    // Auto-fit font utk teks final (semua kata).
    const probe = createCanvas(SIZE, SIZE).getContext("2d")
    let fontSize = SIZE
    let layout = []
    for (; fontSize > 8; fontSize -= 2) {
        layout = computeLayout(probe, words, maxW, fontSize)
        const totalH = layout.length * fontSize * 0.92
        const widest = Math.max(...layout.map(l => l.width))
        if (totalH <= maxH && widest <= maxW) break
    }

    await webp.Image.initLib()
    const frames = []
    for (let n = 1; n <= words.length; n++) {
        const canvas = renderFrame({ layout, revealCount: n, fontSize, pad, maxH, style, blur })
        const buf = await canvas.encode("webp", 92)
        const delay = n === words.length ? HOLD_MS : msPerWord
        frames.push(await webp.Image.generateFrame({ buffer: buf, delay }))
    }

    const img = await webp.Image.getEmptyImage()
    img.convertToAnim()
    img.frames.push(...frames)
    return img.save(null, { width: SIZE, height: SIZE, loop: 0 })
}

export default {
    route: {
        method: "get",
        path: "/maker/bratanim",
        auth: false,
        tags: ["Maker"],
        summary: "Brat Generator (Animasi)",
        description: "Membuat brat animasi (WebP): kata muncul satu per satu secara akumulatif (kata sebelumnya tetap tampil). Varian warna + blur opsional.",
        parameters: [
            {
                name: "text",
                in: "query",
                required: true,
                description: "Teks. Tiap kata muncul bergantian. (maks 10 kata)",
                schema: { type: "string", example: "i'm so julia" },
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
                description: "Efek blur khas brat (true/false, default false)",
                schema: { type: "boolean", default: false },
            },
            {
                name: "speed",
                in: "query",
                required: false,
                description: "Kecepatan reveal: slow, normal (default), fast",
                schema: { type: "string", enum: ["slow", "normal", "fast"], default: "normal" },
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
                                frames: { type: "integer" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal membuat animasi" },
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
        const msPerWord = SPEED[String(req.query.speed || "normal").toLowerCase()] || SPEED.normal

        // Batasi jumlah kata supaya frame tidak meledak.
        const words = text.toLowerCase().split(/\s+/).filter(Boolean)
        if (words.length > 10) {
            return res.status(400).json({ ok: false, error: "teks terlalu panjang (maks 10 kata)" })
        }

        try {
            const buffer = await renderBratAnim({ text: words.join(" "), style, blur, msPerWord })
            const slug = words.join("-").replace(/[^a-z0-9-]+/g, "").slice(0, 30)
            const filename = `bratanim-${style}-${slug}.webp`
            const { url, provider } = await upload(buffer, filename)
            res.json({ ok: true, url, provider, style, frames: words.length })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
