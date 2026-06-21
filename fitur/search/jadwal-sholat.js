import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

// ═══════════════════════════════════════════════════
//  Aladhan API (free, no login, support nama kota)
// ═══════════════════════════════════════════════════

const PRAYER_NAME_MAP_ALADHAN = {
    Imsak: "imsak",
    Fajr: "subuh",
    Sunrise: "terbit",
    Dhuhr: "dzuhur",
    Asr: "ashar",
    Maghrib: "maghrib",
    Isha: "isya"
}

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

// ═══════════════════════════════════════════════════
//  MuslimPro scrape (by URL)
// ═══════════════════════════════════════════════════

const PRAYER_NAME_MAP_MP = {
    Imsak: "imsak", Fajr: "subuh", Sunrise: "terbit",
    Zuhr: "dzuhur", Asr: "ashar", Maghrib: "maghrib", Isha: "isya"
}

function extractFromMuslimPro(html) {
    const $ = cheerio.load(html)
    const jadwal = []

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).text())
            if (json["@type"] === "ItemList" && json.itemListElement?.[0]?.["@type"] === "Event") {
                for (const ev of json.itemListElement) {
                    const startDate = ev.startDate || ""
                    const timeMatch = startDate.match(/T(\d{2}:\d{2})/)
                    const tzMatch = startDate.match(/([+-]\d{2}:\d{2})$/)
                    jadwal.push({
                        nama: PRAYER_NAME_MAP_MP[ev.name] || ev.name.toLowerCase(),
                        waktu: timeMatch ? timeMatch[1] : null,
                        timezone: tzMatch ? tzMatch[1] : null
                    })
                }
            }
        } catch {}
    })

    const desc = $('meta[name="description"]').attr("content") || ""
    const m1 = desc.match(/Jadwal sholat di (.+?) hari ini/)
    const kota = m1 ? m1[1].trim() : ($('meta[property="og:title"]').attr("content") || "").match(/^(.+?):\s*Waktu/)?.[1]?.trim() || null

    return { kota, jadwal }
}

// ═══════════════════════════════════════════════════
//  Handler
// ═══════════════════════════════════════════════════

export default {
    route: {
        method: "get",
        path: "/search/jadwal-sholat",
        auth: false,
        tags: ["Search"],
        summary: "Jadwal sholat harian",
        description: "Jadwal sholat harian dari 2 sumber: (1) Aladhan API — pakai parameter kota/negara atau lat/lng, (2) MuslimPro — pakai parameter url. Metode default: Kemenag RI.",
        parameters: [
            {
                name: "kota",
                in: "query",
                required: false,
                description: "Nama kota (via Aladhan API)",
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
                description: "Latitude (via Aladhan API)",
                schema: { type: "number", example: -7.0123 }
            },
            {
                name: "lng",
                in: "query",
                required: false,
                description: "Longitude (via Aladhan API)",
                schema: { type: "number", example: 113.8657 }
            },
            {
                name: "metode",
                in: "query",
                required: false,
                description: "Metode perhitungan: 20=Kemenag (default), 3=ISNA, 5=MWL, 8=Gulf Region, 11=Turkiye, 15=Egypt",
                schema: { type: "integer", default: 20 }
            },
            {
                name: "url",
                in: "query",
                required: false,
                description: "URL halaman MuslimPro (alternatif)",
                schema: { type: "string", example: "https://app.muslimpro.com/id/prayer-times/indonesia/waktu-sholat-jakarta/1642911" }
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
                                sumber: { type: "string" },
                                metode: { type: "string" },
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
        const { kota, negara = "Indonesia", lat, lng, metode = "20", url } = req.query

        if (!kota && !lat && !url) {
            return res.status(400).json({
                ok: false,
                error: "isi salah satu: kota (contoh: Jakarta), lat+lng (contoh: -7.0123,113.8657), atau url (MuslimPro URL)"
            })
        }

        try {
            // Sumber 1: MuslimPro (by URL)
            if (url) {
                if (!url.includes("muslimpro.com")) {
                    return res.status(400).json({ ok: false, error: "url harus dari muslimpro.com" })
                }
                const { data } = await axios.get(url, {
                    headers: { "user-agent": UA, "accept-language": "id-ID,id;q=0.9" },
                    timeout: 15000
                })
                const result = extractFromMuslimPro(data)
                if (!result.jadwal.length) {
                    return res.status(500).json({ ok: false, error: "gagal mengekstrak jadwal sholat dari halaman" })
                }
                return res.json({
                    ok: true,
                    kota: result.kota || "Unknown",
                    sumber: "MuslimPro",
                    url,
                    jadwal: result.jadwal
                })
            }

            // Sumber 2: Aladhan API (by nama kota atau lat/lng)
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

            const lokasi = kota || `${lat},${lng}`

            res.json({
                ok: true,
                kota: lokasi,
                tanggal: result.tanggal,
                hijriyah: result.hijriyah,
                sumber: "Aladhan",
                metode: result.metode,
                timezone: result.timezone,
                jadwal: result.jadwal
            })
        } catch (e) {
            res.status(e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
