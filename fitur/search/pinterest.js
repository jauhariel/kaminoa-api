async function searchPinterest(query) {
    const response = await fetch(
        "https://www.pinterest.com/resource/BaseSearchResource/get/?data=" +
        encodeURIComponent('{"options":{"query":"' + encodeURIComponent(query) + '"}}'),
        {
            method: "head",
            headers: {
                "screen-dpr": "4",
                "x-pinterest-pws-handler": "www/search/[scope].js"
            }
        }
    )

    if (!response.ok) throw new Error(`error ${response.status} ${response.statusText}`)

    const rhl = response.headers.get("Link")
    if (!rhl) throw new Error(`hasil pencarian ${query} kosong`)

    return [...rhl.matchAll(/<(.*?)>/gm)].map(v => v[1])
}

export default {
    route: {
        method: "get",
        path: "/search/pinterest",
        auth: false,
        tags: ["Search"],
        summary: "Cari gambar di Pinterest",
        description: "Mencari gambar di Pinterest berdasarkan kata kunci dan mengembalikan array URL gambar.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: true,
                description: "Kata kunci pencarian",
                schema: { type: "string", example: "furina" }
            },
            {
                name: "limit",
                in: "query",
                required: false,
                description: "Jumlah maksimal gambar (1–50)",
                schema: { type: "integer", default: 20, minimum: 1, maximum: 50, example: 10 }
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
                                results: {
                                    type: "array",
                                    items: { type: "string", format: "uri" }
                                }
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
        const { query, limit = 20 } = req.query
        if (!query || !query.trim()) {
            return res.status(400).json({ ok: false, error: "query wajib diisi" })
        }
        const limitNum = parseInt(limit)
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({ ok: false, error: "limit harus angka antara 1 dan 50" })
        }
        try {
            const results = (await searchPinterest(query.trim())).slice(0, limitNum)
            res.json({ ok: true, query: query.trim(), total: results.length, results })
        } catch (e) {
            const isEmpty = e.message.includes("kosong")
            res.status(isEmpty ? 404 : 500).json({ ok: false, error: e.message })
        }
    }
}
