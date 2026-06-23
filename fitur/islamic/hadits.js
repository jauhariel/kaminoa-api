import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = resolve(__dirname, "../../assets/islamic/hadits")
const GITHUB_RAW = "https://raw.githubusercontent.com/jauhariel/islamicdb/main/data/hadits"
const INDEX_FILE = "_index.json"
const KITAB_SLUGS = [
    "abu-dawud", "ahmad", "arbain", "bukhari", "bulughul-maram",
    "darimi", "ibnu-majah", "malik", "muslim", "nasai", "tirmidzi"
]

function getFromCache(filename) {
    const filePath = resolve(CACHE_DIR, filename)
    if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, "utf-8"))
    }
    return null
}

async function fetchAndCache(filename) {
    const url = `${GITHUB_RAW}/${filename}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Gagal mengambil data: ${res.status}`)
    const data = await res.json()

    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
    await writeFile(resolve(CACHE_DIR, filename), JSON.stringify(data))

    return data
}

async function getData(filename) {
    const cached = getFromCache(filename)
    if (cached) return cached
    return await fetchAndCache(filename)
}

export default {
    route: {
        method: "get",
        path: "/islamic/hadits",
        auth: false,
        tags: ["Islamic"],
        summary: "Kumpulan Hadits",
        description: "Ambil hadits dari berbagai kitab hadits. Tanpa parameter mengembalikan daftar kitab tersedia. Dengan parameter `kitab` mengembalikan range nomor hadits. Gunakan parameter `no` untuk melihat detail lengkap hadits. Bisa cari teks terjemahan dengan parameter `search`.",
        parameters: [
            {
                name: "kitab",
                in: "query",
                description: "Slug kitab hadits. Tanpa parameter ini akan mengembalikan daftar kitab tersedia.",
                schema: {
                    type: "string",
                    enum: KITAB_SLUGS
                },
                examples: {
                    bukhari: { value: "bukhari", summary: "Shahih Bukhari" },
                    muslim: { value: "muslim", summary: "Shahih Muslim" },
                    arbain: { value: "arbain", summary: "Arbain Nawawi" },
                    tirmidzi: { value: "tirmidzi", summary: "Sunan Tirmidzi" },
                    "abu-dawud": { value: "abu-dawud", summary: "Sunan Abu Dawud" },
                    nasai: { value: "nasai", summary: "Sunan Nasai" },
                    "ibnu-majah": { value: "ibnu-majah", summary: "Sunan Ibnu Majah" },
                    ahmad: { value: "ahmad", summary: "Musnad Ahmad" },
                    malik: { value: "malik", summary: "Muwatta Malik" },
                    darimi: { value: "darimi", summary: "Sunan Darimi" },
                    "bulughul-maram": { value: "bulughul-maram", summary: "Bulughul Maram" }
                }
            },
            {
                name: "no",
                in: "query",
                description: "Nomor hadits dalam kitab (mulai dari 1). Hanya berlaku jika parameter `kitab` diisi.",
                schema: { type: "string", example: "1" }
            },
            {
                name: "search",
                in: "query",
                description: "Cari hadits berdasarkan judul atau terjemahan Indonesia. Hanya berlaku jika parameter `kitab` diisi.",
                schema: { type: "string", example: "niat" }
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
                                result: { type: "object" }
                            }
                        }
                    }
                }
            },
            "404": {
                description: "Hadits tidak ditemukan",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: false },
                                error: { type: "string" }
                            }
                        }
                    }
                }
            }
        }
    },

    handler: async (req, res) => {
        try {
            const { kitab, no, search } = req.query

            if (!kitab) {
                const index = await getData(INDEX_FILE)
                const sorted = index.sort((a, b) => a.name.localeCompare(b.name))
                return res.json({ ok: true, result: sorted })
            }

            if (!KITAB_SLUGS.includes(kitab)) {
                return res.status(400).json({
                    ok: false,
                    error: `Kitab "${kitab}" tidak tersedia. Pilih dari: ${KITAB_SLUGS.join(", ")}`
                })
            }

            const data = await getData(`${kitab}.json`)

            if (no) {
                const hadits = data.hadits.find(h => h.no == no || h.number == no)
                if (!hadits) {
                    return res.status(404).json({
                        ok: false,
                        error: `Hadits no ${no} dari kitab ${data.name} tidak ditemukan`
                    })
                }
                return res.json({ ok: true, result: { kitab: data.name, hadits } })
            }

            if (search) {
                const q = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                const filtered = data.hadits.filter(h => {
                    const id = (h.id || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                    return id.includes(q)
                })
                return res.json({
                    ok: true,
                    result: {
                        kitab: data.name,
                        total: data.total,
                        count: filtered.length,
                        hadits: filtered.map(h => ({ no: h.number }))
                    }
                })
            }

            res.json({
                ok: true,
                result: {
                    kitab: data.name,
                    total: data.total,
                    range: { from: 1, to: data.total }
                }
            })
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message })
        }
    }
}
