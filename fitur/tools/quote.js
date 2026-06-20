import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas"
import axios from "axios"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { upload } from "../../lib/uploader.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "quote", "fonts")
const FONTS = [
    { file: "Inter-Bold.woff", family: "QuoteBold", url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-700-normal.woff" },
    { file: "Inter-SemiBold.woff", family: "QuoteSemiBold", url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-600-normal.woff" },
]

const COL = {
    bubble: "#2a2233",
    avatarBg: "#d4d4d4",
    avatarIcon: "#f1f1f1",
    text: "#ffffff",
}
const DEFAULT_USER_COLOR = "#efa870"

// ── Bootstrap font (sekali, di-cache) ───────────────────────────
let fontReady = null
function ensureFonts() {
    if (!fontReady) {
        fontReady = (async () => {
            for (const f of FONTS) {
                const dest = path.join(FONTS_DIR, f.file)
                if (!fs.existsSync(dest) || fs.statSync(dest).size <= 0) {
                    fs.mkdirSync(FONTS_DIR, { recursive: true })
                    const r = await axios.get(f.url, { responseType: "arraybuffer", timeout: 30000 })
                    const buf = Buffer.from(r.data)
                    if (buf.subarray(0, 4).toString("ascii") !== "wOFF") {
                        throw new Error(`Gagal unduh font ${f.family} (respon bukan WOFF)`)
                    }
                    fs.writeFileSync(dest, buf)
                }
                if (!GlobalFonts.families.some(x => x.family === f.family)) {
                    GlobalFonts.registerFromPath(dest, f.family)
                }
            }
        })().catch(e => { fontReady = null; throw e })
    }
    return fontReady
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
}

// Pecah teks jadi baris ≤ maxW. Kata yang terlalu lebar dipecah per-huruf.
function wrapText(ctx, text, maxW, font) {
    ctx.font = font
    const lines = []
    for (const para of String(text).split("\n")) {
        const words = para.split(/\s+/).filter(Boolean)
        if (!words.length) { lines.push(""); continue }
        let cur = ""
        for (const w of words) {
            if (ctx.measureText(w).width > maxW) {
                if (cur) { lines.push(cur); cur = "" }
                let chunk = ""
                for (const ch of w) {
                    if (!chunk || ctx.measureText(chunk + ch).width <= maxW) chunk += ch
                    else { lines.push(chunk); chunk = ch }
                }
                cur = chunk
                continue
            }
            const trial = cur ? cur + " " + w : w
            if (ctx.measureText(trial).width <= maxW || !cur) cur = trial
            else { lines.push(cur); cur = w }
        }
        if (cur) lines.push(cur)
    }
    return lines
}

function drawAvatar(ctx, cx, cy, r, img) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    if (img) {
        // cover-fit foto ke dalam lingkaran
        const ratio = img.width / img.height
        let w = r * 2, h = r * 2
        if (ratio > 1) w = h * ratio
        else h = w / ratio
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
    } else {
        ctx.fillStyle = COL.avatarBg
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
        ctx.fillStyle = COL.avatarIcon
        ctx.beginPath()
        ctx.arc(cx, cy - r * 0.18, r * 0.34, 0, Math.PI * 2) // kepala
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy + r * 0.62, r * 0.62, Math.PI, 0)     // bahu
        ctx.fill()
    }
    ctx.restore()
}

/**
 * Render chat-bubble quote → Buffer WebP transparan.
 */
async function renderQuote({ username, text, userColor = DEFAULT_USER_COLOR, avatarImg }) {
    await ensureFonts()

    const avatarR = 36
    const margin = 18
    const padX = 30
    const padY = 30
    const userSize = 28
    const textSize = 36
    const gap = 16
    const lineH = Math.round(textSize * 1.28)
    const maxLineW = 620 // ambang wrap

    const probe = createCanvas(10, 10).getContext("2d")
    const userFont = `${userSize}px QuoteSemiBold`
    const textFont = `${textSize}px QuoteBold`

    probe.font = userFont
    const userW = probe.measureText(username).width
    const lines = wrapText(probe, text, maxLineW, textFont)
    probe.font = textFont
    const widestLine = Math.max(0, ...lines.map(l => probe.measureText(l).width))

    const contentW = Math.max(120, userW, widestLine)
    const bubbleW = contentW + padX * 2
    const bubbleH = padY * 2 + userSize + gap + lines.length * lineH

    const bubbleX = margin + avatarR * 2 + 18
    const bubbleY = margin
    const avatarCx = margin + avatarR
    const avatarCy = bubbleY + bubbleH - avatarR

    const canvasW = Math.ceil(bubbleX + bubbleW + margin)
    const canvasH = Math.ceil(bubbleY + bubbleH + margin)

    const canvas = createCanvas(canvasW, canvasH)
    const ctx = canvas.getContext("2d")

    // ekor segitiga ke arah avatar
    ctx.fillStyle = COL.bubble
    ctx.beginPath()
    ctx.moveTo(bubbleX + 4, bubbleY + bubbleH - 30)
    ctx.lineTo(bubbleX - 16, bubbleY + bubbleH - 6)
    ctx.lineTo(bubbleX + 4, bubbleY + bubbleH - 6)
    ctx.closePath()
    ctx.fill()

    // bubble
    ctx.fillStyle = COL.bubble
    roundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 22)
    ctx.fill()

    // teks
    ctx.textBaseline = "top"
    ctx.textAlign = "left"
    const tx = bubbleX + padX
    let ty = bubbleY + padY
    ctx.fillStyle = userColor
    ctx.font = userFont
    ctx.fillText(username, tx, ty)
    ty += userSize + gap
    ctx.fillStyle = COL.text
    ctx.font = textFont
    for (const line of lines) {
        ctx.fillText(line, tx, ty)
        ty += lineH
    }

    drawAvatar(ctx, avatarCx, avatarCy, avatarR, avatarImg)

    return canvas.encode("webp", 95)
}

export default {
    route: {
        method: "get",
        path: "/tools/quote",
        auth: false,
        tags: ["Tools"],
        summary: "Chat Bubble Quote",
        description: "Membuat gambar quote gaya chat bubble (background transparan, output WebP). Username, teks, avatar, dan warna username bisa diatur. Teks panjang auto-wrap.",
        parameters: [
            {
                name: "username",
                in: "query",
                required: true,
                description: "Nama yang ditampilkan (maks 40 karakter)",
                schema: { type: "string", example: "jauhariel.cc" },
            },
            {
                name: "text",
                in: "query",
                required: true,
                description: "Isi pesan (maks 500 karakter, auto-wrap)",
                schema: { type: "string", example: "halo dunia apa kabar" },
            },
            {
                name: "avatar",
                in: "query",
                required: false,
                description: "URL foto avatar. Kosong = ikon default.",
                schema: { type: "string", example: "https://picsum.photos/200/200.jpg" },
            },
            {
                name: "color",
                in: "query",
                required: false,
                description: "Warna username (hex, mis. #efa870). Default oranye.",
                schema: { type: "string", example: "#efa870" },
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
        const username = req.query.username?.trim()
        const text = req.query.text?.trim()
        if (!username) return res.status(400).json({ ok: false, error: "username wajib diisi" })
        if (!text) return res.status(400).json({ ok: false, error: "text wajib diisi" })

        let userColor = DEFAULT_USER_COLOR
        if (req.query.color) {
            const c = req.query.color.startsWith("#") ? req.query.color : "#" + req.query.color
            if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
                return res.status(400).json({ ok: false, error: "color harus hex 6 digit, mis. #efa870" })
            }
            userColor = c
        }

        try {
            let avatarImg = null
            if (req.query.avatar?.trim()) {
                try {
                    const r = await axios.get(req.query.avatar.trim(), { responseType: "arraybuffer", timeout: 30000 })
                    avatarImg = await loadImage(Buffer.from(r.data))
                } catch {
                    avatarImg = null // fallback ke ikon default kalau avatar gagal
                }
            }

            const buffer = await renderQuote({
                username: username.slice(0, 40),
                text: text.slice(0, 500),
                userColor,
                avatarImg,
            })
            const slug = username.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)
            const { url, provider } = await upload(buffer, `quote-${slug}.webp`)
            res.json({ ok: true, url, provider })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
