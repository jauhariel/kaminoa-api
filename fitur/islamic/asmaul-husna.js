import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(resolve(__dirname, "../../assets/asmaul-husna.json"), "utf-8"))

export default {
    route: {
        method: "get",
        path: "/islamic/asmaul-husna",
        auth: false,
        tags: ["Islamic"],
        summary: "99 Asmaul Husna (Nama-nama Allah)",
        description: "Seluruh 99 Asmaul Husna beserta tulisan Arab, latin, dan terjemahan bahasa Indonesia. Data statis dari islamicdb.",
        responses: {
            "200": {
                description: "Berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                total: { type: "integer", example: 99 },
                                result: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "integer", example: 1 },
                                            arab: { type: "string", example: "الرَّحْمـٰنُ" },
                                            latin: { type: "string", example: "Ar-Rahmânu" },
                                            indo: { type: "string", example: "Yang Maha Pengasih" }
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
        const { search } = req.query

        let result = data
        if (search) {
            const q = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
            result = data.filter(n => {
                const latin = n.latin.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                const indo = n.indo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                return latin.includes(q) || indo.includes(q)
            })
        }

        res.json({ ok: true, total: result.length, result })
    }
}
