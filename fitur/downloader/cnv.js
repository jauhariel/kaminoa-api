import axios from "axios"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const BASE = "https://cnv.cx"
const HEADERS = { "user-agent": UA, accept: "*/*", origin: "https://iframe.y2meta-uk.com", referer: "https://iframe.y2meta-uk.com/" }

const AUDIO_BITRATES = ["320", "256", "192", "128", "96", "64"]
const VIDEO_QUALITIES = ["2160", "1440", "1080", "720", "480", "360", "240", "144"]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getKey() {
    const { data } = await axios.get(`${BASE}/v2/sanity/key`, { headers: { ...HEADERS, "content-type": "application/json" } })
    if (!data?.key) throw new Error("Gagal mengambil key dari cnv.cx")
    return data.key
}

async function convert(youtubeUrl, format, quality) {
    const key = await getKey()
    const body = new URLSearchParams({
        link: youtubeUrl,
        format,
        audioBitrate: format === "mp3" ? quality : "128",
        videoQuality: format === "mp3" ? "720" : quality,
        filenameStyle: "pretty",
        vCodec: "h264",
    }).toString()

    for (let attempt = 0; attempt < 20; attempt++) {
        const { data: j } = await axios.post(`${BASE}/v2/converter`, body, {
            headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded", key },
            validateStatus: () => true,
        })
        const status = j?.status
        if (status === "tunnel" || status === "stream" || status === "redirect") {
            return { downloadUrl: j.url, filename: j.filename || null }
        }
        // masih diproses
        if (status === "processing" || status === "running" || j?.text === "processing") {
            await sleep(2500)
            continue
        }
        throw new Error(j?.text || j?.error?.code || j?.error || "Konversi gagal")
    }
    throw new Error("Timeout: konversi belum selesai")
}

export default {
    route: {
        method: "get",
        path: "/downloader/cnv",
        auth: false,
        tags: ["Downloader"],
        summary: "Download YouTube via cnv.cx",
        description: "Mengunduh audio (MP3, hingga 320kbps) atau video (MP4, hingga 4K) dari YouTube menggunakan API cnv.cx.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL YouTube (watch atau youtu.be)",
                schema: { type: "string", example: "https://youtu.be/pNNnrE_RSdE" },
            },
            {
                name: "format",
                in: "query",
                required: false,
                description: "mp3 (audio, default) atau mp4 (video)",
                schema: { type: "string", enum: ["mp3", "mp4"], default: "mp3" },
            },
            {
                name: "quality",
                in: "query",
                required: false,
                description: "MP3: bitrate (320/256/192/128/96/64). MP4: resolusi (2160/1440/1080/720/480/360). Default 128 (mp3) / 720 (mp4).",
                schema: { type: "string", example: "320" },
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
                                result: {
                                    type: "object",
                                    properties: {
                                        format: { type: "string" },
                                        quality: { type: "string" },
                                        filename: { type: "string" },
                                        downloadUrl: { type: "string" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter / URL tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url, format = "mp3", quality } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        const fmt = String(format).toLowerCase()
        if (!["mp3", "mp4"].includes(fmt)) {
            return res.status(400).json({ ok: false, error: "format harus mp3 atau mp4" })
        }
        const q = String(quality || (fmt === "mp3" ? "128" : "720"))
        const valid = fmt === "mp3" ? AUDIO_BITRATES : VIDEO_QUALITIES
        if (!valid.includes(q)) {
            return res.status(400).json({ ok: false, error: `quality tidak valid untuk ${fmt}: ${valid.join(", ")}` })
        }
        try {
            const r = await convert(url, fmt, q)
            res.json({ ok: true, result: { format: fmt, quality: q, filename: r.filename, downloadUrl: r.downloadUrl } })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
