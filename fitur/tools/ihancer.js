import { upload } from "../../lib/uploader.js"

// @credit: ren-offc

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"

// Server kadang kirim content-type yang salah — deteksi ekstensi dari magic bytes.
function sniffExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png"
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return "webp"
  return "jpg"
}

async function enhance({ buffer, method }) {
  const blob = new Blob([buffer], { type: "image/jpeg" })
  const form = new FormData()
  form.set("method", String(method))
  form.set("is_pro_version", "true")
  form.set("is_enhancing_more", "false")
  form.set("max_image_size", "high")
  form.set("file", blob, "file.jpg")

  const res = await fetch("https://ihancer.com/api/enhance", {
    method: "POST",
    headers: { "User-Agent": UA, Referer: "https://ihancer.com/app/" },
    body: form,
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`ihancer HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export default {
  route: {
    method: "get",
    path: "/tools/ihancer",
    auth: false,
    tags: ["Tools"],
    summary: "iHancer — perjelas & upscale foto pakai AI (gratis, tanpa login)",
    description: "Tingkatkan kualitas dan resolusi foto via iHancer AI. method=1 upscale terbesar (~3×), 2/3/4 mode enhance 2×. Kirim URL gambar publik, hasil dikembalikan sebagai URL.",
    parameters: [
      {
        name: "url",
        in: "query",
        required: true,
        description: "URL gambar publik yang akan dienhance",
        schema: { type: "string", example: "https://example.com/photo.jpg" },
      },
      {
        name: "method",
        in: "query",
        required: false,
        description: "Mode enhance — 1: upscale terbesar (~3×), 2/3/4: enhance 2× dengan tuning berbeda",
        schema: { type: "integer", enum: [1, 2, 3, 4], default: 1 },
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
                result: { type: "string", description: "URL hasil enhance" },
                method: { type: "integer", example: 1 },
                provider: { type: "string", description: "File host yang dipakai" },
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

    const method = [1, 2, 3, 4].includes(Number(req.query.method)) ? Number(req.query.method) : 1

    try {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
      const mime = imgRes.headers.get("content-type") || ""
      if (mime && !/^image\//i.test(mime)) throw new Error(`URL bukan gambar (content-type: ${mime})`)
      const input = Buffer.from(await imgRes.arrayBuffer())

      const out = await enhance({ buffer: input, method })
      const { url, provider } = await upload(out, `ihancer_${Date.now()}.${sniffExt(out)}`)

      res.json({ ok: true, result: url, method, provider })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  },
}
