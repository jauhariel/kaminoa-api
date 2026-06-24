import axios from "axios"
import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = resolve(__dirname, "../../assets/tools")
const WILAYAH_PATH = resolve(CACHE_DIR, "wilayah.json")
// Dataset di-fetch dari GitHub & di-cache lokal (pola sama seperti cuaca.js / hadits.js)
const WILAYAH_URL = "https://raw.githubusercontent.com/jauhariel/dataset/main/tools/wilayah.json"

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

// Ambil JSON wilayah dari cache lokal; kalau belum ada, fetch dari GitHub lalu cache.
async function loadRaw() {
    if (existsSync(WILAYAH_PATH)) {
        return JSON.parse(readFileSync(WILAYAH_PATH, "utf-8"))
    }
    const { data } = await axios.get(WILAYAH_URL, { timeout: 30000, responseType: "json" })
    if (!data?.data || !data?.prov || !data?.kab) throw new Error("format dataset wilayah tidak dikenali")
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
    await writeFile(WILAYAH_PATH, JSON.stringify(data))
    return data
}

// Index 6 digit kode wilayah (prov.kab.kec) -> nama lengkap. Format baris: [kode, desa, kecamatan, kabIndex, provIndex]
let WIL = null
let loadingWIL = null

async function buildIndex() {
    const raw = await loadRaw()
    const map = {}
    for (const row of raw.data) {
        const code6 = row[0].split(".").slice(0, 3).join("")
        if (!map[code6]) {
            map[code6] = {
                kelurahan: row[1],
                kecamatan: row[2],
                kabupaten: raw.kab[row[3]] ?? null,
                provinsi: raw.prov[row[4]] ?? null
            }
        }
    }
    return map
}

async function getIndex() {
    if (WIL) return WIL
    if (!loadingWIL) loadingWIL = buildIndex()
    try {
        WIL = await loadingWIL
    } catch (e) {
        loadingWIL = null // reset supaya request berikutnya bisa coba fetch lagi
        throw e
    }
    return WIL
}

async function decodeNIK(nik) {
    if (!/^\d{16}$/.test(nik)) {
        const err = new Error("NIK harus 16 digit angka")
        err.status = 400
        throw err
    }

    const index = await getIndex()
    const wil = index[nik.slice(0, 6)]
    if (!wil) {
        const err = new Error("Kode wilayah pada NIK tidak dikenali (6 digit pertama tidak valid)")
        err.status = 404
        throw err
    }

    // Digit 7-12: tanggal lahir DDMMYY, DD ditambah 40 untuk perempuan
    let dd = parseInt(nik.slice(6, 8), 10)
    const jenisKelamin = dd > 40 ? "Perempuan" : "Laki-laki"
    if (dd > 40) dd -= 40

    const mm = parseInt(nik.slice(8, 10), 10)
    const yy = parseInt(nik.slice(10, 12), 10)

    if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) {
        const err = new Error("Tanggal lahir pada NIK tidak valid")
        err.status = 400
        throw err
    }

    // Tahun 2 digit ambigu: <= tahun-sekarang(2 digit) dianggap 20xx, selebihnya 19xx
    const nowYear = new Date().getFullYear()
    const tahun = yy <= (nowYear % 100) ? 2000 + yy : 1900 + yy
    const usia = nowYear - tahun

    return {
        nik,
        kelamin: jenisKelamin,
        lahir: {
            tanggal: `${String(dd).padStart(2, "0")}-${String(mm).padStart(2, "0")}-${tahun}`,
            terbaca: `${String(dd).padStart(2, "0")} ${BULAN[mm - 1]} ${tahun}`,
            usia
        },
        wilayah: {
            provinsi: wil.provinsi,
            kotaKabupaten: wil.kabupaten,
            kecamatan: wil.kecamatan,
            kelurahan: wil.kelurahan,
            kodeWilayah: nik.slice(0, 6)
        },
        nomorUrut: nik.slice(12, 16)
    }
}

export default {
    route: {
        method: "get",
        path: "/search/cek-nik",
        auth: false,
        tags: ["Search"],
        summary: "Cek info dari NIK KTP",
        description: "Membaca informasi yang terkandung dalam NIK (Nomor Induk Kependudukan) 16 digit: provinsi, kota/kabupaten, kecamatan, kelurahan, tanggal lahir, jenis kelamin, dan nomor urut. Murni dihitung dari struktur NIK + data wilayah Kemendagri, tanpa akses data pribadi.",
        parameters: [
            {
                name: "nik",
                in: "query",
                required: true,
                description: "Nomor Induk Kependudukan 16 digit",
                schema: { type: "string", example: "3271011708950001" }
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
                                result: {
                                    type: "object",
                                    properties: {
                                        nik: { type: "string", example: "3271011708950001" },
                                        kelamin: { type: "string", example: "Laki-laki" },
                                        lahir: {
                                            type: "object",
                                            properties: {
                                                tanggal: { type: "string", example: "17-08-1995" },
                                                terbaca: { type: "string", example: "17 Agustus 1995" },
                                                usia: { type: "integer", example: 30 }
                                            }
                                        },
                                        wilayah: {
                                            type: "object",
                                            properties: {
                                                provinsi: { type: "string", example: "Jawa Barat" },
                                                kotaKabupaten: { type: "string", example: "Kota BOGOR" },
                                                kecamatan: { type: "string", example: "Bogor Selatan" },
                                                kelurahan: { type: "string", example: "Batu Tulis" },
                                                kodeWilayah: { type: "string", example: "327101" }
                                            }
                                        },
                                        nomorUrut: { type: "string", example: "0001" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "NIK tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Kode wilayah tidak dikenali",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const nik = req.query.nik?.trim()

        if (!nik) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'nik' (16 digit)" })
        }

        try {
            const result = await decodeNIK(nik)
            return res.json({ ok: true, result })
        } catch (e) {
            return res.status(e.status || 500).json({ ok: false, error: e.message })
        }
    }
}
