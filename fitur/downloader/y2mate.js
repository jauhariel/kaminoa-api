import https from 'https'
import querystring from 'querystring'

function post(url, data) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify(data)
        const parsed = new URL(url)
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://id-y2mate.com/',
                'Origin': 'https://id-y2mate.com',
            },
        }
        const req = https.request(options, (res) => {
            let raw = ''
            res.on('data', (chunk) => (raw += chunk))
            res.on('end', () => {
                try { resolve(JSON.parse(raw)) } catch { resolve(raw) }
            })
        })
        req.on('error', reject)
        req.write(body)
        req.end()
    })
}

async function analyze(youtubeUrl) {
    const data = await post('https://id-y2mate.com/mates/analyzeV2/ajax', {
        k_query: youtubeUrl,
        k_page: 'youtube',
        hl: 'id',
        q_auto: 1,
    })
    if (!data || data.status !== 'ok') throw new Error(`Analyze gagal: ${JSON.stringify(data)}`)
    return data
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms))
}

async function convert(vid, key, retries = 5) {
    for (let i = 0; i < retries; i++) {
        const data = await post('https://id-y2mate.com/mates/convertV2/index', { vid, k: key })
        if (!data || data.status !== 'ok') throw new Error(`Convert gagal: ${JSON.stringify(data)}`)
        if (data.c_status === 'CONVERTED' && data.dlink) return data
        await sleep(2000)
    }
    throw new Error('Convert timeout: link tidak tersedia setelah beberapa percobaan')
}

function parseLinks(result) {
    const links = []
    for (const [type, formats] of Object.entries(result.links || {})) {
        for (const [, info] of Object.entries(formats)) {
            if (info.k) links.push({ type, quality: info.q, key: info.k, size: info.size || '?' })
        }
    }
    return links
}

async function getDownloadLink(youtubeUrl, format = 'mp4', targetQuality = null) {
    const result = await analyze(youtubeUrl)
    const links = parseLinks(result)
    const defaultQuality = format === 'mp3' ? '128kbps' : '360p'
    const quality = targetQuality || defaultQuality
    const target =
        links.find((l) => l.type === format && l.quality === quality) ||
        links.find((l) => l.type === format) ||
        links[0]
    if (!target) throw new Error('Tidak ada format yang tersedia')
    const converted = await convert(result.vid, target.key)
    return {
        title: result.title,
        vid: result.vid,
        type: target.type,
        quality: target.quality,
        size: target.size,
        downloadUrl: converted.dlink,
        availableFormats: links.map((l) => ({ type: l.type, quality: l.quality, size: l.size })),
    }
}

export default {
    route: {
        method: 'get',
        path: '/downloader/y2mate',
        auth: false,
        tags: ['Downloader'],
        summary: 'Download YouTube via y2mate',
        description: 'Mengunduh video/audio YouTube menggunakan id-y2mate.com. Mendukung format mp4 dan mp3.',
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
                description: 'Format unduhan: mp4 (default) atau mp3',
                schema: { type: 'string', enum: ['mp4', 'mp3'], default: 'mp4' },
            },
            {
                name: 'quality',
                in: 'query',
                required: false,
                description: 'Kualitas unduhan, misal: 360p, 720p, 128kbps. Default: 360p (mp4) atau 128kbps (mp3)',
                schema: { type: 'string', example: '360p' },
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
                                        vid: { type: 'string' },
                                        type: { type: 'string' },
                                        quality: { type: 'string' },
                                        size: { type: 'string' },
                                        downloadUrl: { type: 'string' },
                                        availableFormats: { type: 'array' },
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
        if (!['mp4', 'mp3'].includes(format)) {
            return res.status(400).json({ ok: false, error: 'Format harus mp4 atau mp3' })
        }
        try {
            const result = await getDownloadLink(url, format, quality || null)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
