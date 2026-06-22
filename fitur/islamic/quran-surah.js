import axios from "axios"

const API = "https://web-api.qurankemenag.net"
const MEDIA = "https://media.qurankemenag.net/audio"
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"
const TOTAL_SURAH = 114

// Qari yang tersedia di media.qurankemenag.net (format folder ala everyayah, semua .m4a aac64)
const QARI = {
    "abu-bakr": { folder: "Abu_Bakr_Ash-Shaatree_aac64", nama: "Abu Bakr Ash-Shaatree" },
    "alafasy": { folder: "Alafasy_aac64", nama: "Mishary Rashid Alafasy" },
    "husary": { folder: "Husary_aac64", nama: "Mahmoud Khalil Al-Husary (Murattal)" },
    "husary-mujawwad": { folder: "Husary_Mujawwad_aac64", nama: "Mahmoud Khalil Al-Husary (Mujawwad)" },
    "abdul-basit": { folder: "Abdul_Basit_Murattal_aac64", nama: "Abdul Basit Abdus Samad" },
    "sudais": { folder: "Abdurrahmaan_As-Sudais_aac64", nama: "Abdurrahman As-Sudais" },
    "hudhaify": { folder: "Hudhaify_aac64", nama: "Ali Al-Hudhaify" },
    "tablaway": { folder: "Mohammad_al_Tablaway_aac64", nama: "Mohammad Al-Tablaway" },
    "ayyoub": { folder: "Muhammad_Ayyoub_aac64", nama: "Muhammad Ayyoub" },
    "minshawy": { folder: "Minshawy_Murattal_aac64", nama: "Mohamed Siddiq El-Minshawi (Murattal)" },
    "minshawy-mujawwad": { folder: "Minshawy_Mujawwad_aac64", nama: "Mohamed Siddiq El-Minshawi (Mujawwad)" }
}
const DEFAULT_QARI = "abu-bakr"

const headers = {
    "user-agent": UA,
    origin: "https://quran.kemenag.go.id",
    referer: "https://quran.kemenag.go.id/"
}

function audioUrl(folder, surah, ayah) {
    const s = String(surah).padStart(3, "0")
    const a = String(ayah).padStart(3, "0")
    return `${MEDIA}/${folder}/${s}${a}.m4a`
}

function mapSurahMeta(s) {
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

function mapAyat(a, qariFolder, withTafsir) {
    const ayat = {
        nomor: a.ayah,
        arab: String(a.arabic || "").trim(),
        latin: String(a.latin || "").trim(),
        terjemah: a.translation,
        audio: audioUrl(qariFolder, a.surah_id, a.ayah),
        halaman: a.page,
        juz: a.juz
    }
    if (withTafsir) {
        ayat.tafsir = {
            wajiz: a.tafsir?.wajiz ?? null,
            tahlili: a.tafsir?.tahlili ?? null
        }
    }
    return ayat
}

export default {
    route: {
        method: "get",
        path: "/islamic/quran-surah",
        auth: false,
        tags: ["Islamic"],
        summary: "Isi 1 surah lengkap dengan ayat, audio & tafsir",
        description: "Menampilkan satu surah Al-Qur'an beserta seluruh ayatnya (arab, latin, terjemah, audio murottal per ayat, halaman, juz, dan tafsir wajiz + tahlili). Sumber: Qur'an Kemenag RI.",
        parameters: [
            {
                name: "id",
                in: "query",
                required: true,
                description: "Nomor surah (1-114)",
                schema: { type: "integer", minimum: 1, maximum: 114, example: 1 }
            },
            {
                name: "qari",
                in: "query",
                required: false,
                description: `Pilih qari murottal. Pilihan: ${Object.keys(QARI).join(", ")}. Default: ${DEFAULT_QARI}`,
                schema: { type: "string", enum: Object.keys(QARI), default: DEFAULT_QARI }
            },
            {
                name: "tafsir",
                in: "query",
                required: false,
                description: "Sertakan tafsir (wajiz & tahlili). Set 'false' untuk respons lebih ringkas. Default: true",
                schema: { type: "boolean", default: true }
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
                                qari: {
                                    type: "object",
                                    properties: {
                                        kode: { type: "string", example: "abu-bakr" },
                                        nama: { type: "string", example: "Abu Bakr Ash-Shaatree" }
                                    }
                                },
                                surah: {
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
                                },
                                ayat: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            nomor: { type: "integer", example: 1 },
                                            arab: { type: "string" },
                                            latin: { type: "string" },
                                            terjemah: { type: "string" },
                                            audio: { type: "string", example: "https://media.qurankemenag.net/audio/Abu_Bakr_Ash-Shaatree_aac64/001001.m4a" },
                                            halaman: { type: "integer" },
                                            juz: { type: "integer" },
                                            tafsir: {
                                                type: "object",
                                                properties: {
                                                    wajiz: { type: "string" },
                                                    tahlili: { type: "string" }
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
            "400": { description: "Parameter tidak valid" },
            "404": { description: "Surah tidak ditemukan" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const id = parseInt(req.query.id, 10)
        if (!Number.isInteger(id) || id < 1 || id > TOTAL_SURAH) {
            return res.status(400).json({ ok: false, error: `parameter id wajib angka 1-${TOTAL_SURAH}` })
        }

        const qariKey = String(req.query.qari ?? DEFAULT_QARI).toLowerCase()
        if (!QARI[qariKey]) {
            return res.status(400).json({ ok: false, error: `qari tidak valid. pilihan: ${Object.keys(QARI).join(", ")}` })
        }
        const qari = QARI[qariKey]

        const withTafsir = !["false", "0", "no"].includes(String(req.query.tafsir ?? "").toLowerCase())

        try {
            const { data } = await axios.get(`${API}/quran-tafsir`, {
                params: { surah: id },
                headers,
                timeout: 20000
            })
            const rows = Array.isArray(data?.data) ? data.data : []
            if (!rows.length) {
                return res.status(404).json({ ok: false, error: `surah ${id} tidak ditemukan` })
            }

            res.json({
                ok: true,
                qari: { kode: qariKey, nama: qari.nama },
                surah: mapSurahMeta(rows[0].surah),
                ayat: rows.map(a => mapAyat(a, qari.folder, withTafsir))
            })
        } catch (e) {
            const status = e.response?.status ?? 500
            res.status(status >= 400 && status < 500 ? status : 500).json({
                ok: false,
                error: "Gagal mengambil isi surah"
            })
        }
    }
}
