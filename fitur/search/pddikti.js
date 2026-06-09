import axios from "axios"

const BASE = "https://api-pddikti.kemdiktisaintek.go.id"

const HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    "Origin": "https://pddikti.kemdiktisaintek.go.id",
    "Referer": "https://pddikti.kemdiktisaintek.go.id/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}

async function getIP() {
    try {
        const { data } = await axios.get("https://api.ipify.org?format=json", { timeout: 5000 })
        return data.ip
    } catch {
        return "103.47.132.29"
    }
}

async function searchMahasiswa(keyword) {
    const ip = await getIP()
    const { data } = await axios.get(`${BASE}/pencarian/mhs/${encodeURIComponent(keyword)}`, {
        headers: { ...HEADERS, "X-User-IP": ip },
        timeout: 15000
    })
    return Array.isArray(data) ? data : (data.mahasiswa ?? [])
}

async function getDetailMahasiswa(id) {
    const ip = await getIP()
    const { data } = await axios.get(`${BASE}/detail/mhs/${encodeURIComponent(id)}`, {
        headers: { ...HEADERS, "X-User-IP": ip },
        timeout: 15000
    })
    return data
}

export default {
    route: {
        method: "get",
        path: "/search/pddikti",
        auth: false,
        tags: ["Search"],
        summary: "Cari data mahasiswa PDDikti",
        description: "Mencari mahasiswa berdasarkan nama/NIM, atau mengambil detail mahasiswa berdasarkan ID terenkripsi dari PDDikti Kemdiktisaintek.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: false,
                description: "Nama atau NIM mahasiswa yang dicari",
                schema: { type: "string", example: "Jauhari" }
            },
            {
                name: "id",
                in: "query",
                required: false,
                description: "ID terenkripsi mahasiswa untuk mengambil detail (dari URL detail-mahasiswa)",
                schema: { type: "string", example: "gZZ7r650fgrLXDPQOEoKFUk8TaH7Y-O9UB_HxVj3B2YIMboB9vVM4Awkycw9sVXm83Fruw==" }
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
                                type: { type: "string", enum: ["search", "detail"] },
                                query: { type: "string" },
                                total: { type: "integer" },
                                results: { type: "array", items: { type: "object" } },
                                result: { type: "object" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Parameter tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Data tidak ditemukan",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { query, id } = req.query

        if (!query?.trim() && !id?.trim()) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'query' untuk mencari, atau 'id' untuk melihat detail" })
        }

        try {
            if (id?.trim()) {
                const result = await getDetailMahasiswa(id.trim())
                if (!result || Object.keys(result).length === 0) {
                    return res.status(404).json({ ok: false, error: "Data mahasiswa tidak ditemukan" })
                }
                return res.json({ ok: true, type: "detail", result })
            }

            const results = await searchMahasiswa(query.trim())
            if (!results.length) {
                return res.status(404).json({ ok: false, error: "Mahasiswa tidak ditemukan" })
            }
            return res.json({ ok: true, type: "search", query: query.trim(), total: results.length, results })
        } catch (e) {
            res.status(e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
