import crypto from "crypto"

const prodKey  = "A4nzUYcDOZ"
const host     = "https://api.pixelbin.io"

function getAuth(method, path, deviceId) {
  const ts = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
  const str = method.toUpperCase() + encodeURI(path) + ts + deviceId
  const sig = crypto.createHmac("sha256", prodKey).update(str).digest("hex")
  return {
    "User-Agent": "Neo/1.0",
    "pixb-cl-id": deviceId,
    "captcha-code": "skipcode:qNDyPnC0mz99CLugpqOQJxGp9yTQspHiYaEnoTCU",
    "x-ebg-param": Buffer.from(ts).toString("base64"),
    "x-ebg-signature": sig,
  }
}

async function upscale({ imageUrl, scale = "2X", model = "picasso", enhanceFace = false, enhanceQuality = false, enhanceText = false }) {
  const deviceId = crypto.randomUUID()
  const path = "/service/public/transformation/v1.0/predictions/sr/upscale"

  // Download image
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
  const contentType = imgRes.headers.get("content-type") || "image/jpeg"
  const bytes = new Uint8Array(await imgRes.arrayBuffer())
  let fileName = "input.jpg"
  try { fileName = new URL(imageUrl).pathname.split("/").filter(Boolean).pop() || "input.jpg" } catch {}

  // Submit job
  const form = new FormData()
  form.append("input.type", scale)
  form.append("input.model", model)
  form.append("input.enhance_face", String(enhanceFace))
  form.append("input.enhance_quality", String(enhanceQuality))
  form.append("input.enhance_text", String(enhanceText))
  form.append("input.image", new Blob([bytes], { type: contentType }), fileName)

  const createRes = await fetch(`${host}${path}`, {
    method: "POST",
    headers: getAuth("POST", path, deviceId),
    body: form,
  })
  const createData = await createRes.json()
  if (!createRes.ok) throw new Error(JSON.stringify(createData))

  const pollPath = new URL(createData.urls.get).pathname

  // Polling results
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60_000) {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(`${host}${pollPath}`, {
      headers: getAuth("GET", pollPath, deviceId),
    })
    const data = await pollRes.json()
    if (data.status === "SUCCESS" || data.status === "COMPLETED") {
      return {
        output: data.output?.[0] || null,
        input: data.input,
        id: data._id,
        createdAt: data.createdAt,
      }
    }
    if (["FAILED", "ERROR", "FAILURE"].includes(data.status)) {
      throw new Error(data.error || "Upscale gagal")
    }
  }
  throw new Error("Timeout (>60s)")
}

export default {
  route: {
    method: "get",
    path: "/tools/pixelbin/upscale",
    auth: false,
    tags: ["Tools"],
    summary: "PixelBin Upscale — perbesar gambar pakai AI (1X/2X/4X/8X)",
    description: "Perbesar dan pertajam gambar menggunakan PixelBin AI. Mendukung scale 1X–8X, model picasso/flash, dan enhance face/quality/text.",
    parameters: [
      {
        name: "url",
        in: "query",
        required: true,
        description: "URL gambar publik yang akan diupscale",
        schema: { type: "string", example: "https://example.com/image.jpg" },
      },
      {
        name: "scale",
        in: "query",
        required: false,
        description: "Faktor pembesaran",
        schema: { type: "string", enum: ["1X", "2X", "4X", "8X"], default: "2X" },
      },
      {
        name: "model",
        in: "query",
        required: false,
        description: "Model AI yang digunakan",
        schema: { type: "string", enum: ["picasso", "flash"], default: "picasso" },
      },
      {
        name: "enhance_face",
        in: "query",
        required: false,
        description: "Enhance wajah",
        schema: { type: "string", enum: ["true", "false"], default: "false" },
      },
      {
        name: "enhance_quality",
        in: "query",
        required: false,
        description: "Enhance kualitas gambar",
        schema: { type: "string", enum: ["true", "false"], default: "false" },
      },
      {
        name: "enhance_text",
        in: "query",
        required: false,
        description: "Enhance teks dalam gambar",
        schema: { type: "string", enum: ["true", "false"], default: "false" },
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
                output: { type: "string", description: "URL hasil upscale" },
                input: { type: "object", description: "Parameter input yang digunakan" },
                id: { type: "string" },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
      "400": { description: "Parameter tidak lengkap / tidak valid" },
      "500": { description: "Gagal memproses gambar" },
      "504": { description: "Timeout — server PixelBin lambat" },
    },
  },

  handler: async (req, res) => {
    const imageUrl = req.query.url?.trim()
    if (!imageUrl) return res.status(400).json({ ok: false, error: "Parameter 'url' wajib diisi" })

    const scale = ["1X", "2X", "4X", "8X"].includes(req.query.scale) ? req.query.scale : "2X"
    const model = ["picasso", "flash"].includes(req.query.model) ? req.query.model : "picasso"
    const enhanceFace = req.query.enhance_face === "true"
    const enhanceQuality = req.query.enhance_quality === "true"
    const enhanceText = req.query.enhance_text === "true"

    try {
      const result = await upscale({ imageUrl, scale, model, enhanceFace, enhanceQuality, enhanceText })
      res.json({ ok: true, ...result })
    } catch (e) {
      const code = /timeout/i.test(e.message) ? 504 : 500
      res.status(code).json({ ok: false, error: e.message })
    }
  },
}
