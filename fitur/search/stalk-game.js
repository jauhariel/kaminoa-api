import axios from "axios"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

// Mobile Legends: butuh userId + zoneId. Sumber utama gopay.co.id, fallback mlbb-api.isan.eu.org/find
async function stalkML(id, zone) {
    if (!zone?.trim()) {
        const err = new Error("Mobile Legends butuh parameter 'zone' (zone ID). Contoh: ?game=ml&id=157228049&zone=2241")
        err.status = 400
        throw err
    }

    // 1) gopay: nama game MOBILE_LEGENDS (pakai underscore — varian lain "Success" tapi data cuma echo id+zone)
    try {
        const { data } = await axios.get("https://gopay.co.id/games/v1/order/prepare/MOBILE_LEGENDS", {
            params: { userId: id, zoneId: zone },
            headers: { "User-Agent": UA, "Accept": "application/json" },
            timeout: 12000,
            validateStatus: () => true
        })
        const name = data?.data
        // tolak false positive: gopay kadang balikin echo "<id><zone>" bukan nickname asli
        if (data?.message === "Success" && name && name !== `${id}${zone}`) {
            return {
                game: "Mobile Legends: Bang Bang",
                userId: String(id),
                zoneId: String(zone),
                nickname: name,
                country: null,
                countryCode: null
            }
        }
    } catch {
        // lanjut ke fallback
    }

    // 2) fallback isan — bonus info negara
    const { data } = await axios.get("https://mlbb-api.isan.eu.org/find", {
        params: { id, zone },
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: 15000,
        validateStatus: () => true
    })
    if (!data?.success || !data?.name) {
        const err = new Error("Akun Mobile Legends tidak ditemukan, cek kembali User ID & Zone ID")
        err.status = 404
        throw err
    }
    return {
        game: "Mobile Legends: Bang Bang",
        userId: String(id),
        zoneId: String(zone),
        nickname: data.name,
        country: data.countryName ?? null,
        countryCode: data.countryCode ?? null
    }
}

// Free Fire: cukup userId. Sumber: gopay.co.id prepare order FREEFIRE
async function stalkFF(id) {
    const { data } = await axios.get(`https://gopay.co.id/games/v1/order/prepare/FREEFIRE`, {
        params: { userId: id },
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: 15000,
        validateStatus: () => true
    })
    if (data?.message !== "Success" || !data?.data) {
        const err = new Error("Akun Free Fire tidak ditemukan, cek kembali User ID")
        err.status = 404
        throw err
    }
    return {
        game: "Garena Free Fire",
        userId: String(id),
        nickname: data.data
    }
}

const GAMES = {
    ml: stalkML,
    mlbb: stalkML,
    ff: stalkFF,
    freefire: stalkFF
}

export default {
    route: {
        method: "get",
        path: "/search/stalk-game",
        auth: false,
        tags: ["Search"],
        summary: "Cek nickname akun game (Mobile Legends & Free Fire)",
        description: "Mengecek nickname pemilik akun game berdasarkan User ID. Mobile Legends butuh User ID + Zone ID, Free Fire cukup User ID. Tanpa login, data validasi resmi (isan.eu.org untuk ML, gopay.co.id untuk FF).",
        parameters: [
            {
                name: "game",
                in: "query",
                required: true,
                description: "Game yang dicek: ml (Mobile Legends) atau ff (Free Fire)",
                schema: { type: "string", enum: ["ml", "ff"], example: "ml" }
            },
            {
                name: "id",
                in: "query",
                required: true,
                description: "User ID akun game",
                schema: { type: "string", example: "157228049" }
            },
            {
                name: "zone",
                in: "query",
                required: false,
                description: "Zone ID (WAJIB untuk Mobile Legends, abaikan untuk Free Fire)",
                schema: { type: "string", example: "2241" }
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
                                        game: { type: "string", example: "Mobile Legends: Bang Bang" },
                                        userId: { type: "string", example: "157228049" },
                                        zoneId: { type: "string", example: "2241" },
                                        nickname: { type: "string", example: "SELOTIP" },
                                        country: { type: "string", example: "Indonesia" },
                                        countryCode: { type: "string", example: "ID" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Parameter tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Akun tidak ditemukan",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { game, id, zone } = req.query

        if (!game?.trim()) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'game' (ml atau ff)" })
        }
        if (!id?.trim()) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'id' (User ID)" })
        }

        const fn = GAMES[game.trim().toLowerCase()]
        if (!fn) {
            return res.status(400).json({ ok: false, error: "Game tidak didukung. Pilihan: ml (Mobile Legends), ff (Free Fire)" })
        }

        try {
            const result = await fn(id.trim(), zone)
            return res.json({ ok: true, result })
        } catch (e) {
            return res.status(e.status || e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
