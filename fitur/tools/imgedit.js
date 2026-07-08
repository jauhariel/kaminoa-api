import crypto from "crypto"

const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const HDR = {
    "content-type": "application/json",
    origin: "https://imgedit.ai",
    referer: "https://imgedit.ai/",
    "user-agent": AGENT
}
const L1 = ["a","d","g","h","k","o","4","5","6","7","8"]
const L2 = ["0","1","2","3","8","9","a","b","c","d","u","i","o","p","m","n"]

let _aesKey = null
let _aesIv = null

async function fetchKeyFromBundle() {
    if (_aesKey && _aesIv) return { key: _aesKey, iv: _aesIv }
    const html = await (await fetch("https://imgedit.ai/", { headers: { "user-agent": AGENT } })).text()
    const scripts = [...html.matchAll(/src="(\/_nuxt\/[^"]+\.js[^"]*)"/g)].map(m => m[1])
    for (const src of scripts) {
        try {
            const js = await (await fetch("https://imgedit.ai" + src, { headers: { "user-agent": AGENT } })).text()
            const keyMatch = js.match(/aesKey\s*=\s*"([0-9a-f]{32})"/)
            const ivMatch = js.match(/iv\s*=\s*"([0-9a-f]{16})"/)
            if (keyMatch && ivMatch) {
                _aesKey = Buffer.from(keyMatch[1], "utf-8")
                _aesIv = Buffer.from(ivMatch[1], "utf-8")
                return { key: _aesKey, iv: _aesIv }
            }
        } catch {}
    }
    throw new Error("Gagal mengekstrak AES key dari bundle imgedit.ai")
}

function ekey() {
    let s = String(Math.floor(Math.random() * 3000) + 7000)
    for (let i = 0; i < 4; i++) s += L1[Math.floor(Math.random() * L1.length)]
    for (let i = 0; i < 4; i++) s += L2[Math.floor(Math.random() * L2.length)]
    s += String(1000 + Math.floor(Math.random() * 3000))
    return s
}

async function decrypt(data) {
    if (!data) return null
    try {
        const { key, iv } = await fetchKeyFromBundle()
        const dec = crypto.createDecipheriv("aes-256-cbc", key, iv)
        const ct = Buffer.from(data, "base64")
        const out = Buffer.concat([dec.update(ct), dec.final()])
        return JSON.parse(out.toString("utf-8"))
    } catch { return null }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}

async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, { headers: HDR, ...opts })
    return res.json()
}

async function downloadBase64(url) {
    const res = await fetch(url, { headers: { "user-agent": AGENT } })
    if (!res.ok) throw new Error(`Gagal download gambar: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get("content-type") || "image/jpeg"
    return `data:${mime};base64,` + buf.toString("base64")
}

async function uploadImage(dataUri) {
    const qs = `ekey=${ekey()}&soft_id=imgedit_web`
    const json = await fetchJSON(`https://upload.imgedit.ai/api/v1/files/uploadImgs?${qs}`, {
        method: "POST",
        body: JSON.stringify({ files_base64: dataUri })
    })
    const payload = await decrypt(json?.data)
    if (!payload || payload.code !== 0) throw new Error(`Upload gagal: ${payload?.msg || "unknown"}`)
    return payload.data.paths[0]
}

async function createTask(imageKey, prompt) {
    const qs = `ekey=${ekey()}&soft_id=imgedit_web`
    const json = await fetchJSON(`https://imgedit.ai/api/v1/draw-task/nano?${qs}`, {
        method: "POST",
        body: JSON.stringify({
            layout: 9,
            action: 145,
            prompt_text: prompt,
            image_key_type: 3,
            task_params: { input_image: [imageKey] }
        })
    })
    const payload = await decrypt(json?.data)
    if (!payload || payload.code !== 0) throw new Error(`Create task gagal: ${payload?.msg || "unknown"}`)
    return payload.data.serial_no
}

async function pollTask(serialNo) {
    for (let i = 0; i < 90; i++) {
        await sleep(2000)
        const qs = `ekey=${ekey()}&soft_id=imgedit_web`
        const json = await fetchJSON(`https://imgedit.ai/api/v1/draw-task/${serialNo}?${qs}`)
        const payload = await decrypt(json?.data)
        const detail = payload?.data?.detail
        if (!detail) continue
        if (detail.status === 2) {
            const paths = JSON.parse(detail.path)
            return paths
        }
        if (detail.status === 3) throw new Error(`Task gagal: ${detail.fail_msg || "unknown"}`)
    }
    throw new Error("Task timeout")
}

async function editImage(imageUrl, prompt) {
    const dataUri = await downloadBase64(imageUrl)
    const imageKey = await uploadImage(dataUri)
    const serialNo = await createTask(imageKey, prompt)
    const results = await pollTask(serialNo)
    return results[0]
}

export default {
    route: {
        method: "get",
        path: "/tools/imgedit",
        auth: false,
        tags: ["Tools"],
        summary: "Nanobanana Image Editor (imgedit.ai)",
        description: "Edit gambar menggunakan AI model Nanobanana dari imgedit.ai.",
        parameters: [
            {
                name: "image",
                in: "query",
                required: true,
                description: "URL gambar yang akan diedit",
                schema: { type: "string", example: "https://example.com/image.jpg" }
            },
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Instruksi edit gambar",
                schema: { type: "string", example: "make it look like a painting" }
            }
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
                                result: { type: "string", description: "URL gambar hasil edit" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal memproses gambar" }
        }
    },

    handler: async (req, res) => {
        const { image, prompt } = req.query
        if (!image) return res.status(400).json({ ok: false, error: "image wajib diisi" })
        if (!prompt) return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        try {
            const result = await editImage(image, prompt)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
