import axios from "axios"

async function fetchAladhan(params, useCity = false) {
    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-")
    const endpoint = useCity ? "timingsByCity" : "timings"
    const url = `https://api.aladhan.com/v1/${endpoint}/${today}`
    const { data } = await axios.get(url, { params, timeout: 10000 })
    if (data.code !== 200) throw new Error("aladhan API error")
    return data.data
}

function parseAladhanTimings(data) {
    const t = data.timings
    return {
        tanggal: data.date.readable,
        hijriyah: `${data.date.hijri.day} ${data.date.hijri.month.en} ${data.date.hijri.year} H`,
        timezone: data.meta.timezone,
        metode: data.meta.method.name,
        jadwal: [
            { nama: "imsak", waktu: t.Imsak },
            { nama: "subuh", waktu: t.Fajr },
            { nama: "terbit", waktu: t.Sunrise },
            { nama: "dzuhur", waktu: t.Dhuhr },
            { nama: "ashar", waktu: t.Asr },
            { nama: "maghrib", waktu: t.Maghrib },
            { nama: "isya", waktu: t.Isha }
        ]
    }
}

export default {
    route: {
        method: "get",
        path: "/search/jadwal-sholat",
        auth: false,
        tags: ["Search"],
        summary: "Jadwal sholat harian",
        description: "Jadwal sholat harian via Aladhan API. Support nama kota atau koordinat lat/lng. Metode default: Kemenag RI.",
        parameters: [
            {
                name: "kota",
                in: "query",
                required: false,
                description: "Nama kota",
                schema: { type: "string", example: "Jakarta" }
            },
            {
                name: "negara",
                in: "query",
                required: false,
                description: "Nama negara (default: Indonesia)",
                schema: { type: "string", example: "Indonesia" }
            },
            {
                name: "lat",
                in: "query",
                required: false,
                description: "Latitude",
                schema: { type: "number", example: -7.0123 }
            },
            {
                name: "lng",
                in: "query",
                required: false,
                description: "Longitude",
                schema: { type: "number", example: 113.8657 }
            },
            {
                name: "metode",
                in: "query",
                required: false,
                description: "Metode perhitungan: 20=Kemenag (default), 3=ISNA, 5=MWL, 8=Gulf Region, 11=Turkiye, 15=Egypt",
                schema: { type: "integer", default: 20 }
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
                                ok: { type: "boolean" },
                                kota: { type: "string" },
                                tanggal: { type: "string" },
                                hijriyah: { type: "string" },
                                metode: { type: "string" },
                                timezone: { type: "string" },
                                jadwal: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            nama: { type: "string" },
                                            waktu: { type: "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const { kota, negara = "Indonesia", lat, lng, metode = "20" } = req.query

        if (!kota && !lat) {
            return res.status(400).json({
                ok: false,
                error: "isi salah satu: kota (contoh: Jakarta) atau lat+lng (contoh: -7.01,113.86)"
            })
        }

        try {
            const params = { method: parseInt(metode) || 20 }
            if (lat && lng) {
                params.latitude = parseFloat(lat)
                params.longitude = parseFloat(lng)
            } else {
                params.city = kota
                params.country = negara
            }

            const useCity = !!(params.city)
            const data = await fetchAladhan(params, useCity)
            const result = parseAladhanTimings(data)

            res.json({
                ok: true,
                kota: kota || `${lat},${lng}`,
                tanggal: result.tanggal,
                hijriyah: result.hijriyah,
                metode: result.metode,
                timezone: result.timezone,
                jadwal: result.jadwal
            })
        } catch (e) {
            res.status(e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
