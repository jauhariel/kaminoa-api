import https from 'https'
import crypto from 'crypto'

const BASE_URL = 'https://gemini.google.com'
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
const BL = 'boq_assistant-bard-web-server_20260603.11_p0'

function generateAtToken() {
    const random = crypto.randomBytes(16).toString('base64url').slice(0, 22)
    return `AOOh${random}:${Date.now() * 1000}`
}

function generateFSid() {
    return '-' + String(Math.floor(Math.random() * 9e18) + 1e18)
}

function generateTokenBlob() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const r = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    return '!' + r(24) + 'NAAa-PB6hnjxC' + r(18) + 'AEABE' + r(12) +
        'Z1IzrYRasYCYYnM4bZXAlvfpPcJe2g2Ye8XDL3Ck5BCikk5IYm5xZrnIsIkA0SEgfgSLBh-eSq-mq5McSAgAA' +
        r(8) + 'SAAAC' + r(8) + 'BB34ARK' + r(1100)
}

function buildHeaders(deviceId, extra = {}) {
    return {
        'authority': 'gemini.google.com',
        'accept': '*/*',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'origin': BASE_URL,
        'referer': `${BASE_URL}/`,
        'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': UA,
        'x-same-domain': '1',
        'x-goog-ext-525001261-jspb': `[1,null,null,null,"fbb127bbb056c959",null,null,0,[4],null,null,1,null,null,1,null,"${deviceId}"]`,
        'x-goog-ext-525005358-jspb': `["${deviceId}",1]`,
        'x-goog-ext-73010989-jspb': '[0]',
        'x-goog-ext-73010990-jspb': '[0,0,0]',
        ...extra,
    }
}

function buildPayload(message, atToken, tokenBlob, sessionId) {
    const inner = [
        [message, 0, null, null, null, null, 0],
        ['id'],
        ['', '', '', null, null, null, null, null, null, ''],
        tokenBlob, sessionId,
        null, [0], 1, null, null, 1, 0, null, null, null, null, null,
        [[0]], 0, null, null, null, null, null, null, null, null, 1, null, null,
        [4], null, null, null, null, null, null, null, null, null, null,
        [2], null, null, null, null, null, null, null, null, null, null, null,
        0, null, null, null, null, null,
        crypto.randomUUID(), null, [],
        null, null, null, null, null, null,
        1, null, null, null, null, null, null, null, null, null, null, 1,
    ]
    const params = new URLSearchParams()
    params.append('f.req', JSON.stringify([null, JSON.stringify(inner)]))
    params.append('at', atToken)
    return params.toString()
}

function parseStream(body) {
    let fullText = ''
    for (const line of body.split('\n')) {
        let cleaned = line.startsWith(")]}'") ? line.slice(4) : line
        if (/^\d+$/.test(cleaned.trim()) || !cleaned.trim()) continue
        let parsed
        try { parsed = JSON.parse(cleaned) } catch { continue }
        if (!Array.isArray(parsed) || !parsed[0]) continue
        let inner
        try { inner = JSON.parse(parsed[0]?.[2] || '') } catch { continue }
        if (Array.isArray(inner[4])) {
            for (const block of inner[4]) {
                if (Array.isArray(block?.[1]) && typeof block[1][0] === 'string')
                    if (block[1][0].length > fullText.length) fullText = block[1][0]
            }
        }
    }
    return fullText
}

async function geminiChat(prompt) {
    const deviceId = crypto.randomUUID()
    const atToken = generateAtToken()
    const fSid = generateFSid()
    const tokenBlob = generateTokenBlob()
    const sessionId = crypto.randomBytes(16).toString('hex')
    const payload = buildPayload(prompt, atToken, tokenBlob, sessionId)

    const url = new URL(`${BASE_URL}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`)
    url.searchParams.set('bl', BL)
    url.searchParams.set('f.sid', fSid)
    url.searchParams.set('hl', 'id')
    url.searchParams.set('_reqid', String(Math.floor(Math.random() * 10000000)))
    url.searchParams.set('rt', 'c')

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: buildHeaders(deviceId, { 'content-length': String(Buffer.byteLength(payload)) }),
            timeout: 30000,
        }, res => {
            if (res.statusCode >= 400) {
                let err = ''
                res.on('data', c => err += c)
                res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${err.slice(0, 200)}`)))
                return
            }
            let body = ''
            res.on('data', c => body += c)
            res.on('end', () => {
                const text = parseStream(body)
                resolve(text)
            })
            res.on('error', reject)
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
        req.write(payload)
        req.end()
    })
}

export default {
    route: {
        method: 'get',
        path: '/ai/gemini',
        auth: false,
        tags: ['AI'],
        summary: 'Chat dengan Gemini AI',
        description: 'Kirim prompt ke Gemini AI (Google) dan dapatkan respons teks.',
        parameters: [
            {
                name: 'prompt',
                in: 'query',
                required: true,
                description: 'Pertanyaan atau pesan yang dikirim ke Gemini',
                schema: { type: 'string', example: 'Siapa penemu telepon?' }
            }
        ],
        responses: {
            '200': {
                description: 'Respons berhasil',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                ok: { type: 'boolean', example: true },
                                text: { type: 'string' }
                            }
                        }
                    }
                }
            },
            '400': {
                description: 'Request tidak valid',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                ok: { type: 'boolean', example: false },
                                error: { type: 'string', example: 'prompt wajib diisi' }
                            }
                        }
                    }
                }
            },
            '500': {
                description: 'Kesalahan server',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                ok: { type: 'boolean', example: false },
                                error: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    },

    handler: async (req, res) => {
        const { prompt } = req.query
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: 'prompt wajib diisi' })
        }
        try {
            const text = await geminiChat(prompt.trim())
            res.json({ ok: true, text })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
