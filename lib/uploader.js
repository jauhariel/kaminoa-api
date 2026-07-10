import crypto from "crypto"

async function uploadUguu(buffer, filename) {
    const form = new FormData()
    form.append("files[]", new Blob([buffer]), filename)
    const res = await fetch("https://uguu.se/upload", { method: "POST", body: form })
    const json = await res.json()
    const url = json?.files?.[0]?.url
    if (!url) throw new Error("No URL in response")
    return url
}

async function uploadLitterbox(buffer, filename) {
    const form = new FormData()
    form.append("reqtype", "fileupload")
    form.append("time", "1h")
    form.append("fileToUpload", new Blob([buffer]), filename)
    const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", { method: "POST", body: form })
    const out = (await res.text()).trim()
    if (!out.startsWith("https://")) throw new Error("Invalid response: " + out.slice(0, 100))
    return out
}

async function uploadKaminoa(buffer, filename) {
    const form = new FormData()
    form.append("file", new Blob([buffer]), filename)
    const res = await fetch("https://up.kaminoa.eu.cc/api", { method: "POST", body: form })
    const out = (await res.text()).trim()
    let json
    try {
        json = JSON.parse(out)
    } catch {
        throw new Error("Invalid response: " + out.slice(0, 100))
    }
    const url = json?.url || json?.data?.url || json?.file_url
    if (!url) throw new Error("No URL in response: " + out.slice(0, 100))
    return url
}

async function uploadUploadbay(buffer, filename) {
    const form = new FormData()
    form.append("fileToUpload", new Blob([buffer]), filename)
    const res = await fetch("https://uploadbay.net/upload.php", { method: "POST", body: form })
    const out = await res.text()
    
    const match = out.match(/href=['"](https:\/\/uploadbay\.net\/uploads\/[^'"]+)['"]/)
    if (!match) throw new Error("Invalid response: " + out.slice(0, 100))
    return match[1]
}

const providers = [
    { name: "uploadbay", fn: uploadUploadbay },
    { name: "uguu", fn: uploadUguu },
    { name: "litterbox", fn: uploadLitterbox },
    { name: "kaminoa", fn: uploadKaminoa },
]

/**
 * Upload buffer ke file hosting. Coba provider satu per satu sampai berhasil.
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @returns {Promise<{ url: string, provider: string }>}
 */
export async function upload(buffer, filename) {
    const name = filename || `upload_${crypto.randomBytes(6).toString("hex")}.jpg`
    const errors = []

    for (const { name: providerName, fn } of providers) {
        try {
            const url = await fn(buffer, name)
            return { url, provider: providerName }
        } catch (e) {
            errors.push(`${providerName}: ${e.message}`)
        }
    }

    throw new Error("Semua provider gagal:\n" + errors.join("\n"))
}
