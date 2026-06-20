// Background remover via ezremove.ai (jalur anonim, tanpa login).
// Native fetch + FormData (Node 18+) — tanpa dependency tambahan.
//
// 6 mode AI:
//   general_v1  → cepat, subject biasa (orang/produk)
//   general_v2  → presisi tinggi, edge lebih detail
//   logo        → edge tajam, untuk logo/badge
//   text        → isolasi teks dari background
//   anime       → artwork-aware, untuk anime/kartun
//   custom      → erase berbasis prompt (butuh query "prompt")

const API_BASE = "https://api.ezremove.ai/api/ez-remove/v3/background-remove"

const MODES = ["general_v1", "general_v2", "logo", "text", "anime", "custom"]

function randomSerial() {
    let s = ""
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
    return s
}

async function removeBackground({ imageUrl, mode = "general_v1", prompt }) {
    // 1. Unduh gambar sumber
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
    const contentType = imgRes.headers.get("content-type") || "image/png"
    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    if (bytes.length < 100) throw new Error("Gambar terlalu kecil / tidak valid")
    let fileName = "input.png"
    try {
        fileName = new URL(imageUrl).pathname.split("/").filter(Boolean).pop() || "input.png"
    } catch { /* biarkan default */ }

    const serial = randomSerial()
    const headers = {
        "Product-Serial": serial,
        Origin: "https://ezremove.ai",
        Referer: "https://ezremove.ai/",
    }

    // 2. Buat job
    const form = new FormData()
    form.append("image_file", new Blob([bytes], { type: contentType }), fileName)
    form.append("mode", mode)
    if (mode === "custom" && prompt) form.append("params", JSON.stringify({ prompt }))

    const createRes = await fetch(`${API_BASE}/create-job`, { method: "POST", headers, body: form })
    const createData = await createRes.json().catch(() => null)
    const jobId = createData?.result?.job_id
    if (createRes.status !== 200 || !jobId) {
        throw new Error(`Create job gagal: ${JSON.stringify(createData).slice(0, 200)}`)
    }
    const inputUrl = createData.result.image_url

    // 3. Polling hasil (budget ~40s, backoff 1s→3s)
    const startedAt = Date.now()
    let delay = 1000
    while (Date.now() - startedAt < 40_000) {
        await new Promise(r => setTimeout(r, delay))
        delay = Math.min(delay + 500, 3000)
        let pollData
        try {
            const pollRes = await fetch(`${API_BASE}/get-job/${jobId}`, { headers })
            if (!pollRes.ok) continue
            pollData = await pollRes.json()
        } catch { continue } // network blip — lanjut polling
        const status = pollData?.result?.status
        if (status === 2) {
            const out = pollData.result.output || {}
            const preview = Array.isArray(out.preview) ? out.preview[0] : null
            if (!preview) throw new Error("Job selesai tapi output preview kosong")
            // Catatan: max-quality (full-res) di-gate di balik login ezremove,
            // jadi pada jalur anonim ini hanya tersedia URL preview.
            return { jobId, mode, url: preview, inputUrl }
        }
        if (status === 3) throw new Error(`Proses gagal: ${pollData?.result?.error ?? "unknown"}`)
    }
    throw new Error(`Timeout (>40s), job belum selesai. Job ID: ${jobId}`)
}

export default {
    route: {
        method: "get",
        path: "/tools/removebg",
        auth: false,
        tags: ["Tools"],
        summary: "Remove Background — hapus background gambar (AI)",
        description: "Menghapus background gambar via ezremove.ai (tanpa login). Output berupa URL PNG transparan (RGBA) bawaan provider. Tersedia 6 mode AI. Catatan: link output ditandatangani (signed) dan kedaluwarsa beberapa menit.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar publik yang akan dihapus background-nya (hindari URL yang redirect lintas-host).",
                schema: { type: "string", example: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=512&h=512&fit=crop" },
            },
            {
                name: "mode",
                in: "query",
                required: false,
                description: "Mode AI. Default general_v1.",
                schema: { type: "string", enum: MODES, default: "general_v1" },
            },
            {
                name: "prompt",
                in: "query",
                required: false,
                description: "Hanya untuk mode=custom. Instruksi erase berbasis prompt, mis. \"remove the person on the left\".",
                schema: { type: "string", example: "remove the background only" },
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
                                mode: { type: "string" },
                                url: { type: "string", description: "URL PNG transparan hasil (bawaan provider, signed)" },
                                jobId: { type: "string" },
                                inputUrl: { type: "string" },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal memproses gambar" },
            "504": { description: "Timeout — server provider lambat, coba lagi" },
        },
    },

    handler: async (req, res) => {
        const imageUrl = req.query.url?.trim()
        if (!imageUrl) return res.status(400).json({ ok: false, error: "url wajib diisi" })

        const mode = String(req.query.mode || "general_v1").toLowerCase()
        if (!MODES.includes(mode)) {
            return res.status(400).json({ ok: false, error: `mode tidak valid, pilih: ${MODES.join(", ")}` })
        }

        const prompt = req.query.prompt?.trim()
        if (mode === "custom" && !prompt) {
            return res.status(400).json({ ok: false, error: "mode=custom butuh query 'prompt'" })
        }

        try {
            const result = await removeBackground({ imageUrl, mode, prompt })
            res.json({ ok: true, ...result })
        } catch (e) {
            const code = /timeout/i.test(e.message) ? 504 : 500
            res.status(code).json({ ok: false, error: e.message })
        }
    },
}
