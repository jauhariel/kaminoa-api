import axios from "axios"

const API = "https://web-api.qurankemenag.net"
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

const headers = {
    "user-agent": UA,
    origin: "https://quran.kemenag.go.id",
    referer: "https://quran.kemenag.go.id/"
}

function mapSurah(s) {
    return {
        nomor: s.id,
        arab: String(s.arabic || "").trim(),
        latin: String(s.latin || "").trim(),
        transliterasi: s.transliteration,
        terjemah: s.translation,
        jumlah_ayat: s.num_ayah,
        halaman: s.page,
        tempat_turun: s.location
    }
}

export default {
    route: {
        method: "get",
        path: "/islamic/quran-list",
        auth: false,
        tags: ["Islamic"],
        summary: "Daftar 114 surah Al-Qur'an",
        description: "Daftar lengkap 114 surah Al-Qur'an beserta metadata (nama arab, latin, transliterasi, terjemah, jumlah ayat, halaman, tempat turun). Sumber: Qur'an Kemenag RI.",
        responses: {
            "200": {
                description: "Berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                total: { type: "integer", example: 114 },
                                result: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            nomor: { type: "integer", example: 1 },
                                            arab: { type: "string", example: "الفاتحة" },
                                            latin: { type: "string", example: "Al-Fātiḥah" },
                                            transliterasi: { type: "string", example: "Al-Fatihah" },
                                            terjemah: { type: "string", example: "Pembuka" },
                                            jumlah_ayat: { type: "integer", example: 7 },
                                            halaman: { type: "integer", example: 1 },
                                            tempat_turun: { type: "string", example: "Makkiyah" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        try {
            const { data } = await axios.get(`${API}/quran-surah`, { headers, timeout: 15000 })
            const list = Array.isArray(data?.data) ? data.data : []
            if (!list.length) throw new Error("daftar surah kosong")

            const result = list.map(mapSurah)
            res.json({ ok: true, total: result.length, result })
        } catch (e) {
            const status = e.response?.status ?? 500
            res.status(status >= 400 && status < 500 ? status : 500).json({
                ok: false,
                error: "Gagal mengambil daftar surah"
            })
        }
    }
}
