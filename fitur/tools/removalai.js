// Remove Background via removal.ai (guest/anonymous)
// Credit: @ONLym-Api
// Note: FormData npm tidak kompatibel dengan Node 24, jadi multipart manual.

import axios from "axios"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://removal.ai",
    "Referer": "https://removal.ai/upload/",
    "X-Requested-With": "XMLHttpRequest"
}

function parseCookies(headers) {
    if (!headers || !headers.length) return ""
    return (Array.isArray(headers) ? headers : [headers])
        .map(c => c.split(";")[0]).filter(Boolean).join("; ")
}

async function getWebtoken() {
    const s1 = await axios.get("https://removal.ai/upload/", { headers: BASE_HEADERS })
    const cookies = parseCookies(s1.headers["set-cookie"])

    // Nonce dari ajax_upload_object (khusus upload), bukan ajax_object (general WP)
    const uploadCfg = s1.data.match(/ajax_upload_object\s*=\s*\{[^}]+\}/)?.[0]
    const secMatch = uploadCfg?.match(/"security":"([^"]+)"/)
    const security = secMatch ? secMatch[1] : null
    if (!security) throw new Error("Gagal ekstrak security nonce dari halaman")

    const s2 = await axios.get("https://removal.ai/wp-admin/admin-ajax.php", {
        headers: { ...BASE_HEADERS, Cookie: cookies },
        params: { action: "ajax_get_webtoken", security }
    })
    if (!s2.data?.success) throw new Error("Gagal dapat webtoken: " + JSON.stringify(s2.data))
    return { token: s2.data.data.webtoken, cookies }
}

async function downloadImage(url) {
    const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KaminoaBot/1.0)" },
        redirect: "follow"
    })
    if (!res.ok) throw new Error(`Gagal download gambar (HTTP ${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    let name = "image.png"
    try { name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || name) } catch {}
    const tmpPath = path.join(os.tmpdir(), `removalai_${Date.now()}_${name}`)
    fs.writeFileSync(tmpPath, buf)
    return tmpPath
}

async function removebg(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("File tidak ditemukan: " + filePath)

    const { token, cookies } = await getWebtoken()
    const imgBuf = fs.readFileSync(filePath)
    const filename = filePath.split("/").pop() || "image.png"
    const boundary = "----WebKitFormBoundary" + crypto.randomBytes(16).toString("hex")

    // Manual multipart (form-data npm incompatible dengan Node 24)
    const header = [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="image_file"; filename="${filename}"\r\n`,
        `Content-Type: image/png\r\n\r\n`
    ].join("")
    const footer = `\r\n--${boundary}--\r\n`
    const body = Buffer.concat([Buffer.from(header), imgBuf, Buffer.from(footer)])

    const s3 = await axios.post("https://api.removal.ai/3.0/remove", body, {
        headers: {
            ...BASE_HEADERS,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Web-Token": token,
            "Cookie": cookies
        },
        maxBodyLength: Infinity
    })

    const d = s3.data
    return {
        width: d.original_width || null,
        height: d.original_height || null,
        original_url: d.original || null,
        result_url: d.url || d.low_resolution || null
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/removalai",
        auth: false,
        tags: ["Tools"],
        summary: "Remove Background — hapus background gambar via removal.ai",
        description: "Menghapus latar belakang gambar menggunakan removal.ai (tanpa login). Output berupa URL PNG tanpa background.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar publik yang akan dihapus background-nya.",
                schema: { type: "string", example: "https://example.com/foto.jpg" }
            }
        ],
        responses: {
            "200": {
                description: "Background berhasil dihapus",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                result_url: { type: "string", description: "URL gambar tanpa background (PNG)" },
                                original_url: { type: "string" },
                                width: { type: "number" },
                                height: { type: "number" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Gagal memproses gambar" }
        }
    },

    handler: async (req, res) => {
        const imageUrl = req.query.url?.trim()
        if (!imageUrl) return res.status(400).json({ ok: false, error: "url wajib diisi" })

        let filePath = null
        try {
            filePath = await downloadImage(imageUrl)
            const result = await removebg(filePath)
            res.json({ ok: true, ...result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        } finally {
            if (filePath) {
                try { fs.unlinkSync(filePath) } catch {}
            }
        }
    }
}
