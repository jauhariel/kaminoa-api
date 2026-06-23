import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(resolve(__dirname, "../../assets/islamic/doa.json"), "utf-8"))

export default {
    route: {
        method: "get",
        path: "/islamic/doa-harian",
        auth: false,
        tags: ["Islamic"],
        summary: "Kumpulan Doa Sehari-hari",
        description: "108 doa dari Al-Qur'an, hadits, dan amalan harian. Data statis dari islamicdb.",
        parameters: [
            {
                name: "source",
                in: "query",
                description: "Filter berdasarkan sumber (quran, hadits, harian, ibadah, haji, pilihan, lainnya)",
                schema: { type: "string" }
            },
            {
                name: "search",
                in: "query",
                description: "Cari berdasarkan judul atau artinya",
                schema: { type: "string" }
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
                                total: { type: "integer", example: 108 },
                                result: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "integer", example: 1 },
                                            doa: { type: "string", example: "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً" },
                                            artinya: { type: "string" },
                                            judul: { type: "string" },
                                            source: { type: "string", example: "quran" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },

    handler: async (req, res) => {
        const { source, search } = req.query

        let result = data

        if (source) {
            result = result.filter(d => d.source === source)
        }

        if (search) {
            const q = search.toLowerCase()
            result = result.filter(d =>
                d.judul.toLowerCase().includes(q) ||
                d.artinya.toLowerCase().includes(q)
            )
        }

        res.json({ ok: true, total: result.length, result })
    }
}
