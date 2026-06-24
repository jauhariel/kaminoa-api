import axios from "axios"
import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = resolve(__dirname, "../../assets/tools")
const WILAYAH_PATH = resolve(CACHE_DIR, "wilayah.json")
// Dataset di-fetch dari GitHub & di-cache lokal (pola sama seperti hadits.js)
const WILAYAH_URL = "https://raw.githubusercontent.com/jauhariel/dataset/main/tools/wilayah.json"

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
// buang prefix administratif biar "Kota Bandung"/"DKI Jakarta" cocok dengan query "bandung"/"jakarta"
const bare = (s) => norm(s).replace(/\b(kota|kab|kabupaten|adm|administrasi|kep|dki|di)\b/g, "").replace(/\s+/g, " ").trim()
const ADM4_RE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/

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

// Dataset wilayah Kemendagri (Permendagri 72/2019) di-load sekali di memori dalam bentuk RAMPING:
// nama kab/prov disimpan via index ke dict bersama (bukan string diulang 83rb kali), dan tanpa
// field _gabung. Hemat RAM ~10x (±11MB vs ±109MB) dibanding menyimpan objek lengkap per baris.
let WILAYAH = null
let loadingWilayah = null

async function buildWilayah() {
    const raw = await loadRaw()
    // dict kecil (34 prov / 514 kab) — disimpan sekali, bukan per baris
    const provNorm = raw.prov.map(norm)
    const provBare = raw.prov.map(bare)
    const kabNorm = raw.kab.map(norm)
    const kabBare = raw.kab.map(bare)
    const kabKota = raw.kab.map(k => /^kota\b/i.test(k)) // "Kota Bandung" diutamakan atas "Kab. Bandung"
    // normalisasi kecamatan di-share (±6.8rb kecamatan unik dipakai 83rb baris)
    const kecCache = new Map()
    const normKec = (s) => {
        let v = kecCache.get(s)
        if (v === undefined) { v = norm(s); kecCache.set(s, v) }
        return v
    }
    const rows = raw.data.map(([adm4, desa, kecamatan, ki, pi]) => {
        const _kec = normKec(kecamatan)
        return {
            adm4, desa, kecamatan, ki, pi,
            _desa: norm(desa),
            _kec,
            _pusat: /\bkota\b/.test(_kec) || _kec === kabBare[ki] // kelurahan pusat kab/kota
        }
    })
    return { rows, prov: raw.prov, kab: raw.kab, provNorm, provBare, kabNorm, kabBare, kabKota }
}

async function getWilayah() {
    if (WILAYAH) return WILAYAH
    // dedup: kalau beberapa request datang barengan saat fetch pertama, cukup satu fetch
    if (!loadingWilayah) loadingWilayah = buildWilayah()
    try {
        WILAYAH = await loadingWilayah
    } catch (e) {
        loadingWilayah = null // reset supaya request berikutnya bisa coba fetch lagi
        throw e
    }
    return WILAYAH
}

// Cari wilayah dari nama bebas. Bisa multi-kata ("gayam sumenep").
// Prioritas: nama kota/kabupaten > desa persis > kecamatan > sebagian.
// Saat query = nama kota/kabupaten, dipilihkan kelurahan di pusatnya.
async function cariWilayah(query, limit = 5) {
    const q = norm(query)
    if (!q) return []
    const tokens = q.split(" ")
    const { rows, prov, kab, provNorm, provBare, kabNorm, kabBare, kabKota } = await getWilayah()
    const hasil = []

    for (const w of rows) {
        const kabN = kabNorm[w.ki], kabB = kabBare[w.ki]
        const provN = provNorm[w.pi], provB = provBare[w.pi]
        // semua token harus muncul di salah satu field (pengganti _gabung)
        if (!tokens.every(t => w._desa.includes(t) || w._kec.includes(t) || kabN.includes(t) || provN.includes(t))) continue

        let skor
        if (kabB === q) skor = w._pusat ? 130 : 118      // "bandung", "sumenep" -> pusat kotanya
        else if (provB === q) skor = w._pusat ? 112 : 108 // "jakarta" -> pusat administratif
        else if (kabB.startsWith(q + " ")) skor = w._pusat ? 105 : 92 // "jakarta" -> "jakarta pusat" dst
        else if (w._desa === q) skor = 100
        else if (w._kec === q) skor = w._desa === q ? 95 : 85
        else if (w._desa.startsWith(q)) skor = 50
        else if (w._desa.includes(q)) skor = 40
        else if (w._kec.includes(q)) skor = 30
        else if (kabB.includes(q)) skor = 25
        else skor = 10
        if (tokens.length > 1) skor += 5
        if (kabKota[w.ki]) skor += 3 // Kota > Kabupaten saat nama telanjang sama

        hasil.push({ skor, w })
    }

    // tie-break: skor desc, lalu kode adm4 asc (kecamatan/desa pusat biasanya berkode kecil)
    hasil.sort((a, b) => b.skor - a.skor || (a.w.adm4 < b.w.adm4 ? -1 : 1))
    // enrich hanya hasil teratas dengan nama lengkap kab/prov (dari dict) — bukan 83rb baris
    return hasil.slice(0, limit).map(h => ({
        adm4: h.w.adm4,
        desa: h.w.desa,
        kecamatan: h.w.kecamatan,
        kabupaten: kab[h.w.ki] || "",
        provinsi: prov[h.w.pi] || ""
    }))
}

const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    "Referer": "https://www.bmkg.go.id/",
    "Origin": "https://www.bmkg.go.id"
}

const KODE_CUACA = {
    0: "Cerah", 1: "Cerah Berawan", 2: "Cerah Berawan", 3: "Berawan",
    4: "Berawan Tebal", 5: "Udara Kabur", 10: "Asap", 45: "Kabut",
    60: "Hujan Ringan", 61: "Hujan Sedang", 63: "Hujan Lebat",
    80: "Hujan Lokal", 95: "Hujan Petir", 97: "Hujan Petir"
}

function mapCuaca(c) {
    return {
        waktu: c.local_datetime,
        utc: c.utc_datetime,
        suhu: c.t,
        kelembaban: c.hu,
        cuaca: c.weather_desc,
        cuaca_en: c.weather_desc_en,
        kode_cuaca: c.weather,
        tutupan_awan: c.tcc,
        curah_hujan_mm: c.tp,
        angin_arah: c.wd,
        angin_kecepatan_kmh: c.ws,
        jarak_pandang: c.vs_text,
        icon: c.image
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/cuaca",
        auth: false,
        tags: ["Tools"],
        summary: "Prakiraan cuaca Indonesia (BMKG, akurat sampai desa)",
        description: "Prakiraan cuaca resmi BMKG, granular sampai level desa/kelurahan. Cari pakai nama daerah (?daerah=sumenep) — auto-mapping ke kode wilayah, atau langsung pakai ?adm4=35.29.20.2006. Tambah ?list=1 untuk melihat kandidat hasil pencarian tanpa ambil cuaca.",
        parameters: [
            {
                name: "daerah",
                in: "query",
                required: false,
                description: "Nama daerah (desa/kecamatan/kota). Bisa lebih spesifik: 'gayam sumenep'.",
                schema: { type: "string", example: "gayam sumenep" }
            },
            {
                name: "adm4",
                in: "query",
                required: false,
                description: "Kode wilayah Kemendagri level desa (format: 35.29.20.2006). Dipakai jika tahu kodenya.",
                schema: { type: "string", example: "35.29.20.2006" }
            },
            {
                name: "list",
                in: "query",
                required: false,
                description: "Jika 1, kembalikan daftar kandidat wilayah dari pencarian (tanpa ambil cuaca).",
                schema: { type: "integer", enum: [0, 1], default: 0 }
            }
        ],
        responses: {
            "200": { description: "Berhasil" },
            "400": { description: "Parameter tidak valid" },
            "404": { description: "Wilayah tidak ditemukan" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const { daerah, adm4, list } = req.query

        if (!daerah && !adm4) {
            return res.status(400).json({
                ok: false,
                error: "isi salah satu: daerah (mis. ?daerah=sumenep) atau adm4 (mis. ?adm4=35.29.20.2006)"
            })
        }

        let kode = adm4
        let wilayah = null

        // Resolusi nama daerah -> kode adm4
        if (!kode) {
            let kandidat
            try {
                kandidat = await cariWilayah(daerah)
            } catch (e) {
                return res.status(503).json({ ok: false, error: "Dataset wilayah belum siap (gagal memuat). Coba lagi sebentar." })
            }
            if (kandidat.length === 0) {
                return res.status(404).json({ ok: false, error: `daerah '${daerah}' tidak ditemukan` })
            }
            if (String(list) === "1") {
                return res.json({
                    ok: true,
                    query: daerah,
                    kandidat: kandidat.map(w => ({
                        adm4: w.adm4,
                        nama: `${w.desa}, ${w.kecamatan}, ${w.kabupaten}, ${w.provinsi}`
                    }))
                })
            }
            wilayah = kandidat[0]
            kode = wilayah.adm4
        } else if (!ADM4_RE.test(kode)) {
            return res.status(400).json({
                ok: false,
                error: "format adm4 salah. Contoh benar: 35.29.20.2006"
            })
        }

        try {
            const { data } = await axios.get("https://api.bmkg.go.id/publik/prakiraan-cuaca", {
                params: { adm4: kode },
                headers,
                timeout: 12000
            })

            const lok = data?.lokasi
            const blok = data?.data?.[0]?.cuaca
            if (!lok || !blok) {
                return res.status(404).json({ ok: false, error: `tidak ada data cuaca untuk adm4=${kode}` })
            }

            const prakiraan = blok.flat().map(mapCuaca)

            res.json({
                ok: true,
                sumber: "BMKG",
                lokasi: {
                    desa: lok.desa,
                    kecamatan: lok.kecamatan,
                    kota_kabupaten: lok.kotkab,
                    provinsi: lok.provinsi,
                    adm4: lok.adm4,
                    koordinat: { lat: lok.lat, lon: lok.lon },
                    timezone: lok.timezone
                },
                ...(wilayah && daerah && {
                    catatan: `hasil pencarian '${daerah}' → ${lok.desa}, ${lok.kecamatan}. Tambah ?list=1 untuk lihat kandidat lain.`
                }),
                jumlah: prakiraan.length,
                prakiraan
            })
        } catch (e) {
            const status = e.response?.status ?? 500
            if (status === 404) {
                return res.status(404).json({ ok: false, error: `kode adm4=${kode} tidak valid di BMKG` })
            }
            res.status(status === 403 ? 502 : 500).json({
                ok: false,
                error: status === 403 ? "Akses BMKG diblokir (WAF)" : "Gagal mengambil data cuaca BMKG"
            })
        }
    }
}
