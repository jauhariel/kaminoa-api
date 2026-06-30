import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

// @credit: ONLym-Api

const BASE = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://removal.ai",
  "Referer": "https://removal.ai/upload/",
  "X-Requested-With": "XMLHttpRequest",
}

function cleanCookies(headers) {
  if (!headers || !headers.length) return ""
  return headers.map(c => c.split(";")[0]).filter(c => c.trim()).join("; ")
}

async function getWebToken() {
  const session = await fetch("https://removal.ai/upload/", { headers: BASE })
  const html = await session.text()
  const cookies = cleanCookies(session.headers.getSetCookie?.() || [])

  const m = html.match(/"ajax_nonce"\s*:\s*"([^"]+)"/) || html.match(/security\s*=\s*"([^"]+)"/)
  const nonce = m ? m[1] : "f84d58eda0"

  const r = await fetch(
    `https://removal.ai/wp-admin/admin-ajax.php?action=ajax_get_webtoken&security=${nonce}`,
    { headers: { ...BASE, Cookie: cookies } }
  )
  const d = await r.json()
  if (!d?.success || !d?.data?.webtoken) {
    throw new Error("Gagal dapat webtoken: " + JSON.stringify(d).slice(0, 200))
  }
  return { token: d.data.webtoken, cookies }
}

async function removeBackground(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error("File not found")

  const { token, cookies } = await getWebToken()
  const buf = fs.readFileSync(imagePath)
  const form = new FormData()
  form.append("image_file", new Blob([buf], { type: "image/jpeg" }), path.basename(imagePath))

  const r = await fetch("https://api.removal.ai/3.0/remove", {
    method: "POST",
    headers: { ...BASE, "Web-Token": token, Cookie: cookies },
    body: form,
  })
  const d = await r.json()
  const url = d?.url || d?.low_resolution
  if (!url) throw new Error("Gagal remove bg: " + JSON.stringify(d).slice(0, 200))
  return url
}

function sniffExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png"
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return "webp"
  return "jpg"
}

export default {
  route: {
    method: "get",
    path: "/tools/removebg2",
    auth: false,
    tags: ["Tools"],
    summary: "Remove BG v2 — hapus background foto via Removal.ai",
    description: "Hapus latar belakang foto otomatis pakai Removal.ai. Hasil berupa PNG transparan (URL langsung dari Removal.ai). Kirim URL gambar publik.",
    parameters: [
      {
        name: "url",
        in: "query",
        required: true,
        description: "URL gambar publik yang akan dihapus background-nya",
        schema: { type: "string", example: "https://example.com/photo.jpg" },
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
                result: { type: "string", description: "URL PNG hasil remove bg (Removal.ai CDN)" },
              },
            },
          },
        },
      },
      "400": { description: "Parameter tidak lengkap / URL tidak valid" },
      "500": { description: "Gagal memproses gambar" },
    },
  },

  handler: async (req, res) => {
    const imageUrl = req.query.url?.trim()
    if (!imageUrl) return res.status(400).json({ ok: false, error: "Parameter 'url' wajib diisi" })

    let tmpPath = null
    try {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
      const mime = imgRes.headers.get("content-type") || ""
      if (mime && !/^image\//i.test(mime)) throw new Error(`URL bukan gambar (content-type: ${mime})`)
      const input = Buffer.from(await imgRes.arrayBuffer())

      const ext = sniffExt(input)
      tmpPath = path.join(os.tmpdir(), `rmbg2_in_${crypto.randomBytes(6).toString("hex")}.${ext}`)
      fs.writeFileSync(tmpPath, input)

      const resultUrl = await removeBackground(tmpPath)
      res.json({ ok: true, result: resultUrl })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    } finally {
      if (tmpPath) try { fs.unlinkSync(tmpPath) } catch {}
    }
  },
}
