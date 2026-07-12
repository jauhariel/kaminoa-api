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

async function searchPddikti(keyword, mode = "mhs") {
    const ip = await getIP()
    
    let path = `/pencarian/mhs/${encodeURIComponent(keyword)}`
    if (mode === "dosen") path = `/pencarian/dosen/${encodeURIComponent(keyword)}`
    else if (mode === "pt") path = `/pencarian/pt/${encodeURIComponent(keyword)}`
    else if (mode === "prodi") path = `/pencarian/prodi/${encodeURIComponent(keyword)}`
    else if (mode === "all") path = `/pencarian/all/${encodeURIComponent(keyword)}`

    const { data } = await axios.get(`${BASE}${path}`, {
        headers: { ...HEADERS, "X-User-IP": ip },
        timeout: 15000
    })
    
    if (mode === "all") {
        return data.data ?? data ?? {}
    }
    
    return Array.isArray(data) ? data : (data.data ?? data.mahasiswa ?? [])
}

async function getDetailMahasiswa(id) {
    const ip = await getIP()
    const { data } = await axios.get(`${BASE}/detail/mhs/${encodeURIComponent(id)}`, {
        headers: { ...HEADERS, "X-User-IP": ip },
        timeout: 15000
    })
    return data.data ?? data
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
                description: "Kata kunci yang dicari (nama/NIM/NIDN/nama PT, dll)",
                schema: { type: "string", example: "Jauhari" }
            },
            {
                name: "mode",
                in: "query",
                required: false,
                description: "Mode pencarian: all, mhs, dosen, pt, prodi (default: mhs)",
                schema: { type: "string", example: "mhs" }
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
                                mode: { type: "string", enum: ["all", "mhs", "dosen", "pt", "prodi"] },
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
        const mode = (req.query.mode ?? "mhs").toLowerCase()

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

            const validModes = ["all", "mhs", "mahasiswa", "dosen", "pt", "prodi"]
            if (!validModes.includes(mode)) {
                return res.status(400).json({ ok: false, error: "Mode tidak valid. Gunakan: all, mhs, dosen, pt, prodi" })
            }

            const activeMode = mode === "mahasiswa" ? "mhs" : mode
            const results = await searchPddikti(query.trim(), activeMode)
            
            if (activeMode === "all") {
                const mhs = Array.isArray(results.mahasiswa) ? results.mahasiswa : []
                const dosen = Array.isArray(results.dosen) ? results.dosen : []
                const pt = Array.isArray(results.pt) ? results.pt : []
                const prodi = Array.isArray(results.prodi) ? results.prodi : []
                const total = mhs.length + dosen.length + pt.length + prodi.length
                
                if (total === 0) {
                    return res.status(404).json({ ok: false, error: "Data tidak ditemukan" })
                }
                
                return res.json({ 
                    ok: true, 
                    type: "search",
                    mode: "all", 
                    query: query.trim(), 
                    total, 
                    results: { mahasiswa: mhs, dosen, pt, prodi } 
                })
            }

            if (!results.length) {
                return res.status(404).json({ ok: false, error: "Data tidak ditemukan" })
            }
            return res.json({ ok: true, type: "search", mode: activeMode, query: query.trim(), total: results.length, results })
        } catch (e) {
            res.status(e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
