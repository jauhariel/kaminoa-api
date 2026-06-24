import axios from "axios"

const ICON = {
    "Sunny": "☀️", "Clear": "🌙", "Partly cloudy": "⛅", "Cloudy": "☁️",
    "Overcast": "☁️", "Mist": "🌫️", "Fog": "🌫️", "Patchy rain possible": "🌦️",
    "Patchy rain nearby": "🌦️", "Light rain": "🌧️", "Moderate rain": "🌧️",
    "Heavy rain": "🌧️", "Thundery outbreaks possible": "⛈️", "Haze": "🌫️"
}

function mapHour(h) {
    const desc = (h.weatherDesc?.[0]?.value || "").trim()
    return {
        jam: `${String(h.time).padStart(4, "0").slice(0, 2)}:00`,
        suhu: Number(h.tempC),
        terasa: Number(h.FeelsLikeC),
        kelembaban: Number(h.humidity),
        hujan_mm: Number(h.precipMM),
        peluang_hujan: Number(h.chanceofrain),
        angin_kmh: Number(h.windspeedKmph),
        cuaca: desc,
        icon: ICON[desc] || "🌡️"
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/cuaca-global",
        auth: false,
        tags: ["Tools"],
        summary: "Cuaca kota mana saja (worldwide, wttr.in)",
        description: "Prakiraan cuaca untuk kota mana pun di dunia via wttr.in. Terima nama kota dalam bahasa apa saja. Untuk Indonesia yang lebih akurat sampai level desa, pakai /tools/cuaca (BMKG).",
        parameters: [
            {
                name: "kota",
                in: "query",
                required: true,
                description: "Nama kota (mis. Tokyo, Sumenep, Bandung)",
                schema: { type: "string", example: "Tokyo" }
            }
        ],
        responses: {
            "200": { description: "Berhasil" },
            "400": { description: "Parameter tidak valid" },
            "404": { description: "Kota tidak ditemukan" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const kota = String(req.query.kota || "").trim()
        if (!kota) {
            return res.status(400).json({ ok: false, error: "parameter 'kota' wajib diisi" })
        }

        try {
            const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(kota)}`, {
                params: { format: "j1" },
                headers: { "User-Agent": "curl/8.0", "Accept-Language": "id" },
                timeout: 12000
            })

            const cur = data.current_condition?.[0]
            const area = data.nearest_area?.[0]
            if (!cur) throw new Error("data cuaca kosong")

            const curDesc = (cur.weatherDesc?.[0]?.value || "").trim()
            const lokasi = [
                area?.areaName?.[0]?.value,
                area?.region?.[0]?.value,
                area?.country?.[0]?.value
            ].filter(Boolean).join(", ")

            res.json({
                ok: true,
                lokasi: lokasi || kota,
                sumber: "wttr.in",
                sekarang: {
                    suhu: Number(cur.temp_C),
                    terasa: Number(cur.FeelsLikeC),
                    kelembaban: Number(cur.humidity),
                    angin_kmh: Number(cur.windspeedKmph),
                    jarak_pandang_km: Number(cur.visibility),
                    cuaca: curDesc,
                    icon: ICON[curDesc] || "🌡️"
                },
                prakiraan: (data.weather || []).map(d => ({
                    tanggal: d.date,
                    suhu_min: Number(d.mintempC),
                    suhu_max: Number(d.maxtempC),
                    matahari_terbit: d.astronomy?.[0]?.sunrise,
                    matahari_terbenam: d.astronomy?.[0]?.sunset,
                    per_jam: (d.hourly || []).map(mapHour)
                }))
            })
        } catch (e) {
            const status = e.response?.status ?? 500
            if (status === 404) {
                return res.status(404).json({ ok: false, error: `kota '${kota}' tidak ditemukan` })
            }
            res.status(500).json({ ok: false, error: "Gagal mengambil data cuaca" })
        }
    }
}
