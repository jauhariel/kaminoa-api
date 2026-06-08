import https from "https"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"

function getInitialAuth() {
    return new Promise((resolve, reject) => {
        https.get({
            hostname: "id.pinterest.com",
            path: "/",
            method: "GET",
            headers: { "User-Agent": UA }
        }, (res) => {
            const cookies = res.headers["set-cookie"]
            if (cookies) {
                const csrfCookie = cookies.find(c => c.startsWith("csrftoken="))
                const sessCookie = cookies.find(c => c.startsWith("_pinterest_sess="))
                if (csrfCookie && sessCookie) {
                    const csrftoken = csrfCookie.split(";")[0].split("=")[1]
                    const sess = sessCookie.split(";")[0]
                    return resolve({ csrftoken, cookieHeader: `csrftoken=${csrftoken}; ${sess}` })
                }
            }
            reject(new Error("Gagal mendapatkan CSRF token atau session cookie"))
        }).on("error", reject)
    })
}

async function searchPinterest2(query, limit) {
    const { csrftoken, cookieHeader } = await getInitialAuth()
    const results = []
    let bookmark = null

    while (results.length < limit) {
        const postData = {
            options: { query, scope: "pins", bookmarks: bookmark ? [bookmark] : [] },
            context: {}
        }
        const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`
        const dataString = `source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(postData))}`

        const body = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: "id.pinterest.com",
                path: "/resource/BaseSearchResource/get/",
                method: "POST",
                headers: {
                    Accept: "application/json, text/javascript, */*, q=0.01",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "User-Agent": UA,
                    "X-Requested-With": "XMLHttpRequest",
                    "X-CSRFToken": csrftoken,
                    "X-Pinterest-Source-Url": sourceUrl,
                    Cookie: cookieHeader
                }
            }, (res) => {
                let buf = ""
                res.on("data", chunk => buf += chunk)
                res.on("end", () => resolve(buf))
            })
            req.on("error", reject)
            req.write(dataString)
            req.end()
        })

        const json = JSON.parse(body)
        const data = json.resource_response?.data

        if (!data?.results?.length) break

        for (const pin of data.results) {
            if (results.length >= limit) break
            const url = pin.images?.["736x"]?.url || pin.images?.["orig"]?.url
            if (url) results.push(url)
        }

        bookmark = json.resource_response?.bookmark
        if (!bookmark) break
    }

    return results.slice(0, limit)
}

export default {
    route: {
        method: "get",
        path: "/search/pinterest2",
        auth: false,
        tags: ["Search"],
        summary: "Cari gambar Pinterest (Advanced)",
        description: "Mencari gambar di Pinterest menggunakan API resmi dengan autentikasi CSRF. Mendukung pagination dan hasil lebih banyak.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: true,
                description: "Kata kunci pencarian",
                schema: { type: "string", example: "furina genshin" }
            },
            {
                name: "limit",
                in: "query",
                required: false,
                description: "Jumlah maksimal gambar (1–100)",
                schema: { type: "integer", default: 10, minimum: 1, maximum: 100, example: 20 }
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
                                query: { type: "string" },
                                total: { type: "integer" },
                                results: { type: "array", items: { type: "string", format: "uri" } }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Tidak ada hasil",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { query, limit = 10 } = req.query
        if (!query || !query.trim()) {
            return res.status(400).json({ ok: false, error: "query wajib diisi" })
        }
        const limitNum = parseInt(limit)
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
            return res.status(400).json({ ok: false, error: "limit harus angka antara 1 dan 100" })
        }
        try {
            const results = await searchPinterest2(query.trim(), limitNum)
            if (!results.length) {
                return res.status(404).json({ ok: false, error: `tidak ada hasil untuk: ${query}` })
            }
            res.json({ ok: true, query: query.trim(), total: results.length, results })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
