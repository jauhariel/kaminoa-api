import axios from "axios"

const BASE = "https://data.bmkg.go.id/DataMKG/TEWS"

// BMKG di balik Cloudflare WAF — wajib header mirip browser biar lolos (hindari 403)
const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    "Referer": "https://www.bmkg.go.id/",
    "Origin": "https://www.bmkg.go.id"
}

const SUMBER = {
    terkini: { file: "autogempa.json", list: false },   // 1 gempa terbaru (M5+)
    terbesar: { file: "gempaterkini.json", list: true }, // 15 gempa M5+ terakhir
    dirasakan: { file: "gempadirasakan.json", list: true } // 15 gempa yang dirasakan
}

function mapGempa(g) {
    return {
        tanggal: g.Tanggal,
        jam: g.Jam,
        datetime: g.DateTime,
        magnitudo: parseFloat(g.Magnitude),
        kedalaman: g.Kedalaman,
        lintang: g.Lintang,
        bujur: g.Bujur,
        koordinat: g.Coordinates,
        wilayah: g.Wilayah,
        ...(g.Potensi && { potensi: g.Potensi }),
        ...(g.Dirasakan && { dirasakan: g.Dirasakan }),
        ...(g.Shakemap && { shakemap: `${BASE}/${g.Shakemap}` })
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/gempa",
        auth: false,
        tags: ["Tools"],
        summary: "Info gempa bumi terkini (BMKG)",
        description: "Data gempa bumi resmi dari BMKG. tipe=terkini (1 gempa terbaru), terbesar (15 gempa M5.0+ terakhir), atau dirasakan (15 gempa yang dirasakan masyarakat).",
        parameters: [
            {
                name: "tipe",
                in: "query",
                required: false,
                description: "Jenis data: terkini (default), terbesar, dirasakan",
                schema: { type: "string", enum: ["terkini", "terbesar", "dirasakan"], default: "terkini" }
            }
        ],
        responses: {
            "200": { description: "Berhasil" },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const tipe = String(req.query.tipe || "terkini").toLowerCase()
        const sumber = SUMBER[tipe]

        if (!sumber) {
            return res.status(400).json({
                ok: false,
                error: `tipe tidak valid. Pilih: ${Object.keys(SUMBER).join(", ")}`
            })
        }

        try {
            const { data } = await axios.get(`${BASE}/${sumber.file}`, { headers, timeout: 12000 })
            const raw = data?.Infogempa?.gempa
            if (!raw) throw new Error("format respon BMKG tidak dikenali")

            if (sumber.list) {
                const list = (Array.isArray(raw) ? raw : [raw]).map(mapGempa)
                return res.json({ ok: true, tipe, jumlah: list.length, gempa: list })
            }
            return res.json({ ok: true, tipe, gempa: mapGempa(raw) })
        } catch (e) {
            const status = e.response?.status ?? 500
            res.status(status === 403 ? 502 : 500).json({
                ok: false,
                error: status === 403 ? "Akses BMKG diblokir (WAF)" : "Gagal mengambil data gempa BMKG"
            })
        }
    }
}
