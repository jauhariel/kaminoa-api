import crypto from "crypto"
import fs from "fs"
import path from "path"
import os from "os"
const API = "https://a.android.api.remini.ai/v1/mobile"
const ORACLE = "https://api.remini.ai/v1/mobile/oracle"

function genId() {
  const a = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  return {
    android_id: a,
    aaid: crypto.randomUUID(),
    backup_persistent_id: a + "_com.bigwinepot.nwdn.international",
    non_backup_persistent_id: crypto.randomUUID(),
  }
}

let dev = genId()
let token = null

function bh(extra) {
  return {
    "bsp-id": "com.bigwinepot.nwdn.international.android",
    "build-number": "202514479",
    "build-version": "3.7.1020",
    country: "US",
    "device-manufacturer": "Samsung",
    "device-model": "SM-G998B",
    "device-type": "6.8",
    language: "en",
    locale: "en_US",
    "os-version": "33",
    platform: "Android",
    timezone: "America/New_York",
    "android-id": dev.android_id,
    aaid: dev.aaid,
    "accept-encoding": "gzip",
    "user-agent": "okhttp/4.12.0",
    ...(extra || {}),
  }
}

function ah(extra) {
  const h = bh(extra)
  if (token) h["identity-token"] = token
  return h
}

async function auth() {
  dev = genId()
  const r = await fetch(ORACLE + "/setup", {
    headers: bh({
      "first-install-timestamp": Math.floor(Date.now() / 1000) + "E9",
      "backup-persistent-id": dev.backup_persistent_id,
      "non-backup-persistent-id": dev.non_backup_persistent_id,
      environment: "Production",
      "settings-response-version": "v2",
      "is-app-running-in-background": "false",
      "is-old-user": "true",
      "app-set-id": "d44bd45a-a45d-4470-9674-7348a8e3fb71",
    }),
  })
  const d = await r.json()
  token = d.settings.__identity__.token
  if (!token) throw new Error("Remini auth gagal: token tidak ditemukan")
  await fetch(API + "/users/@me", { headers: ah() })
}

async function enhanceRemini(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error("File not found")

  const ext = path.extname(imagePath).toLowerCase()
  const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp" }
  const mime = mimeMap[ext] || "image/jpeg"
  const cont = fs.readFileSync(imagePath)
  const md5 = crypto.createHash("md5").update(cont).digest("base64")
  const meta = { size: fs.statSync(imagePath).size }

  const taskR = await fetch(API + "/tasks", {
    method: "POST",
    headers: ah({ "content-type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({
      image_content_type: mime,
      image_md5: md5,
      feature: { type: "enhance", models: [] },
      metadata: meta,
      options: { high_quality_output: false, save_input: true },
    }),
  })
  const taskD = await taskR.json()
  if (!taskD.task_id || !taskD.upload_url || !taskD.upload_headers) {
    throw new Error("Remini create task gagal: " + JSON.stringify(taskD).slice(0, 200))
  }

  await fetch(taskD.upload_url, {
    method: "PUT",
    headers: { ...taskD.upload_headers, "Content-Length": cont.length, "User-Agent": "okhttp/4.12.0" },
    body: cont,
  })

  await fetch(API + "/tasks/" + taskD.task_id + "/process", {
    method: "POST",
    headers: ah({ "content-length": "0" }),
  })

  let resultUrl = null
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const pr = await fetch(API + "/tasks/" + taskD.task_id, { headers: ah() })
    const pd = await pr.json()
    if (pd.status === "completed") {
      const outs = pd.result?.outputs
      if (outs?.[0]?.url) resultUrl = outs[0].url
      break
    }
    if (pd.status === "failed" || pd.status === "error") {
      throw new Error("Remini process gagal: " + pd.status)
    }
  }

  if (!resultUrl) throw new Error("Remini polling timeout: tidak dapat hasil setelah 40x coba")
  return resultUrl
}

export default {
  route: {
    method: "get",
    path: "/tools/remini",
    auth: false,
    tags: ["Tools"],
    summary: "Remini — enhance & upscale foto pakai Remini AI (gratis, tanpa login)",
    description: "Tingkatkan kualitas dan resolusi foto via Remini AI. Hasil biasanya 2×-4× dari ukuran asli. Kirim URL gambar publik, hasil dikembalikan sebagai URL.",
    parameters: [
      {
        name: "url",
        in: "query",
        required: true,
        description: "URL gambar publik yang akan di-enhance",
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
                result: { type: "string", description: "URL hasil enhance (Remini CDN)" },
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
      // Download gambar input
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
      const mime = imgRes.headers.get("content-type") || ""
      if (mime && !/^image\//i.test(mime)) throw new Error(`URL bukan gambar (content-type: ${mime})`)
      const input = Buffer.from(await imgRes.arrayBuffer())

      // Tulis ke file tmp buat diproses Remini (upload PUT butuh file path)
      const ext = mime.split("/")[1] || "jpg"
      tmpPath = path.join(os.tmpdir(), `remini_in_${crypto.randomBytes(6).toString("hex")}.${ext}`)
      fs.writeFileSync(tmpPath, input)

      // Auth + enhance
      await auth()
      const enhancedUrl = await enhanceRemini(tmpPath)

      res.json({ ok: true, result: enhancedUrl })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    } finally {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath) } catch {}
      }
    }
  },
}
