import { execFile } from "child_process"
import * as cheerio from "cheerio"

function curlPost(url, body, headers) {
    return new Promise((resolve, reject) => {
        const args = ["-s", "-X", "POST", "--compressed", "--data-raw", body]
        for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`)
        args.push(url)
        execFile("curl", args, (err, stdout) => {
            if (err) return reject(err)
            try { resolve(JSON.parse(stdout)) }
            catch (e) { reject(new Error("Parse error: " + stdout.slice(0, 200))) }
        })
    })
}

async function savetikDownload(videoUrl) {
    const params = new URLSearchParams()
    params.append("q", videoUrl)
    params.append("lang", "id")
    params.append("cftoken", "")

    const result = await curlPost("https://savetik.co/api/ajaxSearch", params.toString(), {
        "authority": "savetik.co",
        "accept": "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "origin": "https://savetik.co",
        "referer": "https://savetik.co/id/douyin-downloader",
        "sec-ch-ua": '"Chromium";v="137", "Not/A)Brand";v="24"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
    })

    if (result.status !== "ok") throw new Error("Gagal: " + JSON.stringify(result))

    const $ = cheerio.load(result.data)
    const thumbnail = $(".image-tik img").attr("src") || ""
    const title = $(".clearfix h3").text().trim()
    const duration = $(".clearfix p").first().text().trim()

    const downloads = []
    $(".dl-action a.tik-button-dl").each((i, el) => {
        const href = $(el).attr("href")
        const label = $(el).text().replace(/\s+/g, " ").trim()
        if (href && !href.includes("tiktokio.to")) downloads.push({ label, href })
    })

    return { thumbnail, title, duration, downloads }
}

export default {
    route: {
        method: "get",
        path: "/downloader/savetik",
        auth: false,
        tags: ["Downloader"],
        summary: "TikTok Downloader (Savetik)",
        description: "Download video TikTok tanpa watermark via Savetik.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL video TikTok",
                schema: { type: "string", example: "https://vm.tiktok.com/ZSQB7uUrV/" }
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
                                thumbnail: { type: "string" },
                                title: { type: "string" },
                                duration: { type: "string" },
                                downloads: { type: "array" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal memproses permintaan" }
        }
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url?.trim()) return res.status(400).json({ ok: false, error: "url wajib diisi" })
        try {
            const result = await savetikDownload(url.trim())
            res.json({ ok: true, ...result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
