import https from 'https'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BASE = 'https://id-y2mate.com/y2dl'

// Profil audio yang didukung backend y2dl (termasuk lossless FLAC/WAV/ALAC).
const AUDIO = {
    mp3: { format: 'mp3', audioBitrate: '128', kind: 'mp3' },
    'mp3-320': { format: 'mp3', audioBitrate: '320', kind: 'mp3' },
    'mp3-192': { format: 'mp3', audioBitrate: '192', kind: 'mp3' },
    'mp3-128': { format: 'mp3', audioBitrate: '128', kind: 'mp3' },
    'mp3-64': { format: 'mp3', audioBitrate: '64', kind: 'mp3' },
    m4a: { format: 'm4a', audioBitrate: 'best', kind: 'm4a' },
    wav: { format: 'wav', audioBitrate: 'best', kind: 'wav' },
    flac: { format: 'flac', audioBitrate: 'best', kind: 'flac' },
    alac: { format: 'alac', audioBitrate: 'best', kind: 'alac' },
    aac: { format: 'aac', audioBitrate: '192', kind: 'aac' },
    ogg: { format: 'ogg', audioBitrate: '192', kind: 'ogg' },
    opus: { format: 'opus', audioBitrate: '192', kind: 'opus' },
}
const VIDEO_QUALITIES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const body = data ? JSON.stringify(data) : null
        const parsed = new URL(BASE + path)
        const headers = { 'User-Agent': UA, Referer: 'https://id-y2mate.com/', Origin: 'https://id-y2mate.com', Accept: 'application/json' }
        if (body) {
            headers['Content-Type'] = 'application/json'
            headers['Content-Length'] = Buffer.byteLength(body)
        }
        const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method, headers }, (res) => {
            let raw = ''
            res.on('data', (c) => (raw += c))
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) } catch { resolve({ status: res.statusCode, body: raw }) }
            })
        })
        req.on('error', reject)
        if (body) req.write(body)
        req.end()
    })
}

async function getInfo(url) {
    const { body } = await request('POST', '/info', { url })
    if (!body || body.status !== 'ok' || !body.video) {
        const err = new Error(body?.detail || 'Video tidak ditemukan atau URL tidak valid')
        err.code = 400
        throw err
    }
    return body
}

async function startConvert(url, mode, profile, videoQuality) {
    const payload = mode === 'video'
        ? { url, downloadMode: 'video', format: 'mp4', audioBitrate: 'best', profile: { kind: 'mp4' }, videoQuality }
        : { url, downloadMode: 'audio', format: profile.format, audioBitrate: profile.audioBitrate, profile: { kind: profile.kind } }

    const { body } = await request('POST', '/download', payload)
    if (body?.error) {
        const err = new Error(body.detail || body.error)
        err.code = 400
        throw err
    }
    if (body?.url) return body
    const id = body?.jobId
    if (!id) throw new Error('Respon tidak terduga dari y2mate')
    for (let i = 0; i < 24; i++) {
        const { body: p } = await request('GET', `/progress/${id}?wait=10&_=${Date.now()}`)
        if (p?.url) return p
        if (p?.status === 'error' || p?.status === 'failed') throw new Error(p.error || 'Konversi gagal di server')
        await sleep(1500)
    }
    throw new Error('Timeout: konversi belum selesai')
}

async function getDownloadLink(url, format, quality) {
    const isVideo = format === 'mp4' || format === 'video'
    const info = await getInfo(url)

    let converted, finalQuality, finalFormat
    if (isVideo) {
        finalFormat = 'mp4'
        finalQuality = VIDEO_QUALITIES.includes(String(quality)) ? String(quality) : '720'
        converted = await startConvert(url, 'video', null, finalQuality)
    } else {
        finalFormat = format
        finalQuality = AUDIO[format].audioBitrate === 'best' ? 'best' : `${AUDIO[format].audioBitrate}kbps`
        converted = await startConvert(url, 'audio', AUDIO[format])
    }

    const v = info.video
    return {
        title: v.title,
        videoId: v.videoId,
        channel: v.channel || null,
        thumbnail: v.thumbnailUrl || null,
        type: isVideo ? 'video' : 'audio',
        format: finalFormat,
        quality: finalQuality,
        downloadUrl: converted.url,
        expiresAt: converted.expiresAt ? new Date(converted.expiresAt).toISOString() : null,
        availableFormats: {
            audio: Object.keys(AUDIO),
            video: (info.formats?.video || []).map((f) => f.quality),
        },
    }
}

export default {
    route: {
        method: 'get',
        path: '/downloader/y2mate',
        auth: false,
        tags: ['Downloader'],
        summary: 'Download YouTube via y2mate (mp4 + audio HQ termasuk FLAC)',
        description: 'Mengunduh video (hingga 4K) atau audio YouTube menggunakan id-y2mate.com. Audio mendukung FLAC, WAV, ALAC, MP3 320/192/128, M4A, AAC, OGG, Opus.',
        parameters: [
            {
                name: 'url',
                in: 'query',
                required: true,
                description: 'URL YouTube yang ingin diunduh',
                schema: { type: 'string', example: 'https://youtu.be/MqDqREHvMhQ' },
            },
            {
                name: 'format',
                in: 'query',
                required: false,
                description: 'mp4 (video, default) atau audio: mp3 (=128), mp3-320, mp3-192, mp3-64, m4a, wav, flac, alac, aac, ogg, opus',
                schema: { type: 'string', default: 'mp4', example: 'flac' },
            },
            {
                name: 'quality',
                in: 'query',
                required: false,
                description: 'Khusus video (format=mp4): 2160, 1440, 1080, 720, 480, 360, 240, 144. Default 720',
                schema: { type: 'string', example: '1080' },
            },
        ],
        responses: {
            '200': {
                description: 'Berhasil',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                ok: { type: 'boolean', example: true },
                                result: {
                                    type: 'object',
                                    properties: {
                                        title: { type: 'string' },
                                        videoId: { type: 'string' },
                                        channel: { type: 'string' },
                                        thumbnail: { type: 'string' },
                                        type: { type: 'string' },
                                        format: { type: 'string' },
                                        quality: { type: 'string' },
                                        downloadUrl: { type: 'string' },
                                        expiresAt: { type: 'string' },
                                        availableFormats: { type: 'object' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '400': {
                description: 'URL tidak valid',
                content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } } } } },
            },
            '500': {
                description: 'Kesalahan server',
                content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } } } } },
            },
        },
    },

    handler: async (req, res) => {
        const { url, format = 'mp4', quality = null } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: 'URL tidak valid' })
        }
        const fmt = String(format).toLowerCase()
        const isVideo = fmt === 'mp4' || fmt === 'video'
        if (!isVideo && !AUDIO[fmt]) {
            return res.status(400).json({ ok: false, error: `Format tidak valid. Pilihan audio: ${Object.keys(AUDIO).join(', ')}, atau mp4 untuk video` })
        }
        try {
            const result = await getDownloadLink(url, fmt, quality)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(e.code === 400 ? 400 : 500).json({ ok: false, error: e.message })
        }
    },
}
