import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas"
import axios from "axios"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { upload } from "../../lib/uploader.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const IPHONE_DIR = path.join(__dirname, "..", "..", "assets", "iphone")
const FONTS_DIR = path.join(IPHONE_DIR, "fonts")
const iconPath = name => path.join(IPHONE_DIR, name)

// Font Inter (pengganti SF Pro) — di-download & di-cache sekali, sama seperti tool brat/quote.
const FONTS = [
    { file: "Inter-Regular.woff", family: "FakeReg", url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-400-normal.woff" },
    { file: "Inter-Bold.woff", family: "FakeBold", url: "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-700-normal.woff" },
]
// Italic dirender dengan skew/shear (bukan font terpisah) → lebih ringan.
const ITALIC_SHEAR = -0.18

// Reaction bar iMessage (emoji Apple asli, di-bundle sebagai PNG lokal — urutannya tetap).
const REACTIONS = ["1f44d", "2764-fe0f", "1f602", "1f62e", "1f622", "1f64f", "1f914"]

// Warna bubble pesan. fg dihitung auto-kontras dari bg.
const BUBBLES = {
    gray: "#272a2f", // default (iMessage diterima, mode gelap)
    blue: "#0a84ff", // iMessage terkirim
    green: "#34c759",
}
const REACTION_BG = "#272a2f"
const MENU_BG = "rgba(39, 42, 47, 0.85)"

// Hapus karakter emoji dari teks (tool ini sengaja ringan, tidak render emoji di dalam teks).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu

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

function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
}

function getContrast(hex) {
    const h = hex.replace("#", "")
    if (h.length !== 6) return "#ffffff"
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? "#000000" : "#ffffff"
}

function fontFor(type, size) {
    switch (type) {
        case "bold": return `${size}px FakeBold`
        case "bolditalic": return `${size}px FakeBold`
        default: return `${size}px FakeReg` // text, italic, strike, mono, ws → regular
    }
}
const isItalic = type => type === "italic" || type === "bolditalic"

// Pecah teks ber-markdown jadi segmen bergaya (*bold* _italic_ ~coret~ `mono`).
function parseSegments(ctx, text, size) {
    const segs = []
    const lines = String(text).split("\n")
    lines.forEach((line, idx) => {
        if (line !== "") {
            const re = /(\*_.*?_\*|_\*.*?\*_)|(\*.*?\*)|(_.*?_)|(~.*?~)|(```.*?```)|(\s+)|([^\s*~_`]+)/g
            let m
            while ((m = re.exec(line)) !== null) {
                const [, bi, b, i, s, mono, ws, txt] = m
                let type, content
                if (bi) { type = "bolditalic"; content = bi.slice(2, -2) }
                else if (b) { type = "bold"; content = b.slice(1, -1) }
                else if (i) { type = "italic"; content = i.slice(1, -1) }
                else if (s) { type = "strike"; content = s.slice(1, -1) }
                else if (mono) { type = "mono"; content = mono.slice(3, -3) }
                else if (ws) { type = "ws"; content = ws }
                else { type = "text"; content = txt }
                ctx.font = fontFor(type, size)
                segs.push({ type, content, width: ctx.measureText(content).width })
            }
        }
        if (idx < lines.length - 1) segs.push({ type: "newline", content: "\n", width: 0 })
    })
    return segs
}

// Susun segmen jadi baris ≤ maxW. Kata yang terlalu lebar dipecah per-huruf.
function wrapSegments(ctx, segments, maxW, size) {
    const lines = []
    let cur = []
    let curW = 0
    for (const seg of segments) {
        if (seg.type === "newline") { lines.push(cur); cur = []; curW = 0; continue }
        if (seg.width > maxW) {
            if (cur.length) { lines.push(cur); cur = []; curW = 0 }
            ctx.font = fontFor(seg.type, size)
            let tmp = ""
            for (const ch of seg.content) {
                if (tmp && ctx.measureText(tmp + ch).width > maxW) {
                    lines.push([{ type: seg.type, content: tmp, width: ctx.measureText(tmp).width }])
                    tmp = ch
                } else tmp += ch
            }
            if (tmp) { cur = [{ type: seg.type, content: tmp, width: ctx.measureText(tmp).width }]; curW = cur[0].width }
            continue
        }
        if (curW + seg.width > maxW && cur.length) { lines.push(cur); cur = [seg]; curW = seg.width }
        else { if (seg.type === "ws" && cur.length === 0) continue; cur.push(seg); curW += seg.width }
    }
    if (cur.length) lines.push(cur)
    return lines
}

/**
 * Render screenshot iMessage (tap-tahan: reaction bar + bubble pesan + menu konteks) → Buffer WebP.
 */
async function renderFakeChat({ text, chatTime = "11:02", statusTime = "17:01", bubbleBg = BUBBLES.gray }) {
    await ensureFonts()

    const W = 1320
    const H = 2868
    const fg = getContrast(bubbleBg)
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext("2d")

    const bg = await loadImage(iconPath("background.jpg"))
    ctx.drawImage(bg, 0, 0, W, H)

    // ── Status bar ──────────────────────────────────────────────
    ctx.fillStyle = "#ffffff"
    ctx.font = "50px FakeBold"
    ctx.textBaseline = "middle"
    ctx.textAlign = "left"
    ctx.fillText(statusTime, 40, 80)

    const sIconY = 60, sIconSize = 55, rMargin = 40, iconGap = 20
    let xs = W - rMargin - sIconSize
    ctx.drawImage(await loadImage(iconPath("battery.png")), xs, sIconY - 10, sIconSize, sIconSize * 1.5)
    xs -= sIconSize + iconGap
    ctx.drawImage(await loadImage(iconPath("wifi.png")), xs, sIconY, sIconSize, sIconSize)
    xs -= sIconSize + iconGap
    ctx.drawImage(await loadImage(iconPath("signal.png")), xs, sIconY, sIconSize, sIconSize)

    const startX = 40
    const spacing = 20

    // ── Bubble 1: reaction bar ─────────────────────────────────
    const emojiSize = 65, plusSize = 115, ePad = 15
    const emojiContentWidth = REACTIONS.length * (emojiSize + 20) + plusSize + 20
    const bubble1W = emojiContentWidth + ePad * 2 - 20
    const bubble1H = 110

    // ── Bubble 2: pesan ────────────────────────────────────────
    const textSize = 52
    const lineH = textSize * 1.4
    const pad = 40
    const maxW = W - startX - 40
    const segments = parseSegments(ctx, text, textSize)
    const textLines = wrapSegments(ctx, segments, maxW - pad * 2, textSize)
    let bubble2W
    if (textLines.length === 1) {
        const w = textLines[0].reduce((s, seg) => s + seg.width, 0)
        bubble2W = w + pad * 2
    } else {
        bubble2W = maxW
    }
    const bubble2H = textLines.length * lineH + pad * 2

    // ── Bubble 3: menu konteks ─────────────────────────────────
    const menuItems = [
        { text: "Reply", icon: "reply.png" }, { text: "Forward", icon: "forward.png" },
        { text: "Copy", icon: "copy.png" }, { text: "Star", icon: "star.png" },
        { text: "Pin", icon: "pin.png" }, { text: "Report", icon: "report.png" },
        { text: "Delete", icon: "delete.png", color: "#ff453a" },
    ]
    const itemH = 110
    const bubble3W = (W * 4 / 9) - startX
    const bubble3H = menuItems.length * itemH

    // ── Posisi vertikal (center, tapi clamp atas & bawah) ──────
    const seqBlock = bubble1H + spacing + bubble2H
    const topLimit = 200
    const bottomLimit = H - 100
    const bubble1Y = Math.max((H - seqBlock) / 2, topLimit)
    const bubble2Y = bubble1Y + bubble1H + spacing
    const normalB3Y = bubble2Y + bubble2H + spacing
    const bubble3Y = normalB3Y + bubble3H >= bottomLimit ? bottomLimit - bubble3H : normalB3Y

    // ── Gambar bubble 1 ────────────────────────────────────────
    ctx.fillStyle = REACTION_BG
    drawRoundRect(ctx, startX, bubble1Y, bubble1W, bubble1H, 60)
    ctx.fill()
    let ex = startX + ePad
    for (const code of REACTIONS) {
        const img = await loadImage(iconPath(path.join("reactions", `${code}.png`)))
        ctx.drawImage(img, ex, bubble1Y + (bubble1H - emojiSize) / 2, emojiSize, emojiSize)
        ex += emojiSize + 20
    }
    ctx.drawImage(await loadImage(iconPath("plus.png")), ex, bubble1Y + (bubble1H - plusSize) / 2, plusSize, plusSize)

    // ── Gambar bubble 2 + teks ─────────────────────────────────
    ctx.fillStyle = bubbleBg
    drawRoundRect(ctx, startX, bubble2Y, bubble2W, bubble2H, 45)
    ctx.fill()
    ctx.strokeStyle = fg
    ctx.textBaseline = "top"
    ctx.textAlign = "left"
    for (let i = 0; i < textLines.length; i++) {
        let tx = startX + pad
        const ty = bubble2Y + pad + i * lineH
        for (const seg of textLines[i]) {
            ctx.fillStyle = fg
            ctx.font = fontFor(seg.type, textSize)
            if (isItalic(seg.type)) {
                // miring via shear: pivot di baseline bawah teks
                ctx.save()
                ctx.transform(1, 0, ITALIC_SHEAR, 1, -ITALIC_SHEAR * (ty + textSize), 0)
                ctx.fillText(seg.content, tx, ty)
                ctx.restore()
            } else {
                ctx.fillText(seg.content, tx, ty)
            }
            if (seg.type === "strike") {
                const sy = ty + textSize / 2
                ctx.lineWidth = 3
                ctx.beginPath()
                ctx.moveTo(tx, sy)
                ctx.lineTo(tx + seg.width, sy)
                ctx.stroke()
            }
            tx += seg.width
        }
    }
    // jam kecil di pojok bubble
    ctx.fillStyle = fg === "#000000" ? "#6b6b6b" : "#a0a0a0"
    ctx.font = "34px FakeReg"
    ctx.textAlign = "right"
    ctx.textBaseline = "bottom"
    ctx.fillText(chatTime, startX + bubble2W - pad / 1.5, bubble2Y + bubble2H - pad / 8)

    // ── Gambar bubble 3 (menu) ─────────────────────────────────
    ctx.fillStyle = MENU_BG
    drawRoundRect(ctx, startX, bubble3Y, bubble3W, bubble3H, 40)
    ctx.fill()
    for (let i = 0; i < menuItems.length; i++) {
        const item = menuItems[i]
        const iy = bubble3Y + i * itemH
        ctx.fillStyle = item.color || "#ffffff"
        ctx.font = "50px FakeReg"
        ctx.textAlign = "left"
        ctx.textBaseline = "middle"
        ctx.fillText(item.text, startX + 40, iy + itemH / 2)
        const icon = await loadImage(iconPath(item.icon))
        const iSize = 55
        ctx.drawImage(icon, startX + bubble3W - 40 - iSize, iy + (itemH - iSize) / 2, iSize, iSize)
        if (i < menuItems.length - 1) {
            const ly = iy + itemH
            ctx.strokeStyle = "#555555"
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(startX + 40, ly)
            ctx.lineTo(startX + bubble3W - 40, ly)
            ctx.stroke()
        }
    }

    // ── Home indicator ─────────────────────────────────────────
    const iw = 450, ih = 15
    ctx.fillStyle = "#ffffff"
    drawRoundRect(ctx, (W - iw) / 2, H - ih - 20, iw, ih, ih / 2)
    ctx.fill()

    return canvas.encode("webp", 92)
}

export default {
    route: {
        method: "get",
        path: "/maker/iqc",
        auth: false,
        tags: ["Maker"],
        summary: "IQC — Iphone Quotly Chat",
        description: "IQC (Iphone Quotly Chat). Screenshot iMessage gaya tap-tahan (reaction bar emoji Apple + bubble pesan + menu Reply/Forward/Copy/Star/Pin/Report/Delete). Teks mendukung markdown *tebal* _miring_ ~coret~. Emoji di dalam teks tidak dirender (otomatis dihapus).",
        parameters: [
            {
                name: "text",
                in: "query",
                required: true,
                description: "Isi pesan (maks 400 karakter, auto-wrap, mendukung markdown *tebal* _miring_ ~coret~)",
                schema: { type: "string", example: "Ini adalah *contoh* fake chat iPhone.\nMendukung _markdown_ ~juga~." },
            },
            {
                name: "time",
                in: "query",
                required: false,
                description: "Jam pesan di pojok bubble (default 11:02)",
                schema: { type: "string", default: "11:02" },
            },
            {
                name: "clock",
                in: "query",
                required: false,
                description: "Jam di status bar atas (default 17:01)",
                schema: { type: "string", default: "17:01" },
            },
            {
                name: "bubble",
                in: "query",
                required: false,
                description: "Warna bubble pesan: gray (default), blue, green, atau hex (mis. #ff2d55). Warna teks auto-kontras.",
                schema: { type: "string", default: "gray", example: "gray" },
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
        let text = req.query.text?.trim()
        if (!text) return res.status(400).json({ ok: false, error: "text wajib diisi" })

        // Buang emoji (tool ini ringan, tidak render emoji di teks), rapikan spasi.
        text = text.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").trim()
        if (!text) return res.status(400).json({ ok: false, error: "text kosong setelah emoji dihapus" })
        if (text.length > 400) text = text.slice(0, 400)

        // Resolusi warna bubble.
        let bubbleBg = BUBBLES.gray
        const bRaw = String(req.query.bubble || "gray").toLowerCase()
        if (BUBBLES[bRaw]) {
            bubbleBg = BUBBLES[bRaw]
        } else {
            const c = bRaw.startsWith("#") ? bRaw : "#" + bRaw
            if (!/^#[0-9a-f]{6}$/.test(c)) {
                return res.status(400).json({ ok: false, error: `bubble tidak valid: pakai ${Object.keys(BUBBLES).join("/")} atau hex 6 digit` })
            }
            bubbleBg = c
        }

        const chatTime = (req.query.time || "11:02").toString().slice(0, 8)
        const statusTime = (req.query.clock || "17:01").toString().slice(0, 8)

        try {
            const buffer = await renderFakeChat({ text, chatTime, statusTime, bubbleBg })
            const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "chat"
            const { url, provider } = await upload(buffer, `iqc-${slug}.webp`)
            res.json({ ok: true, url, provider })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
