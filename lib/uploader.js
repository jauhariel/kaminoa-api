import { execFile } from "child_process"
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import crypto from "crypto"

function curlUpload(args) {
    return new Promise((resolve, reject) => {
        execFile("curl", ["-s", ...args], (err, stdout) => {
            if (err) return reject(err)
            resolve(stdout.trim())
        })
    })
}

async function uploadUguu(buffer, filename) {
    const tmp = join(process.env.TMPDIR || "/tmp", filename)
    writeFileSync(tmp, buffer)
    try {
        const out = await curlUpload(["-F", `files[]=@${tmp}`, "https://uguu.se/upload"])
        const json = JSON.parse(out)
        const url = json?.files?.[0]?.url
        if (!url) throw new Error("No URL in response")
        return url
    } finally {
        if (existsSync(tmp)) unlinkSync(tmp)
    }
}

async function uploadLitterbox(buffer, filename) {
    const tmp = join(process.env.TMPDIR || "/tmp", filename)
    writeFileSync(tmp, buffer)
    try {
        const out = await curlUpload([
            "-F", "reqtype=fileupload",
            "-F", "time=1h",
            "-F", `fileToUpload=@${tmp}`,
            "https://litterbox.catbox.moe/resources/internals/api.php"
        ])
        if (!out.startsWith("https://")) throw new Error("Invalid response: " + out.slice(0, 100))
        return out
    } finally {
        if (existsSync(tmp)) unlinkSync(tmp)
    }
}

async function uploadKaminoa(buffer, filename) {
    const tmp = join(process.env.TMPDIR || "/tmp", filename)
    writeFileSync(tmp, buffer)
    try {
        const out = await curlUpload([
            "-X", "POST",
            "-F", `file=@${tmp}`,
            "-F", "upload_type=temporary",
            "https://cloud.kaminoa.eu.cc/api.php"
        ])
        const json = JSON.parse(out)
        const url = json?.url || json?.data?.url || json?.file_url
        if (!url) throw new Error("No URL in response: " + out.slice(0, 100))
        return url
    } finally {
        if (existsSync(tmp)) unlinkSync(tmp)
    }
}

const providers = [
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
