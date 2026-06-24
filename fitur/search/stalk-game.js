import axios from "axios"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"
const GOPAY = "https://gopay.co.id/games/v1/order/prepare"

// Panggil gopay prepare-order. Sukses kalau message "Success" + data nickname asli
// (bukan echo userId/zoneId — gopay kadang balikin echo sebagai false positive).
async function hitGopay(game, params, { id, zone } = {}) {
    const { data } = await axios.get(`${GOPAY}/${game}`, {
        params,
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: 12000,
        validateStatus: () => true
    })
    const name = data?.data
    if (data?.message !== "Success" || !name) return null
    // tolak echo: data === userId, === zoneId, atau === userId+zoneId
    if (name === String(id) || name === String(zone) || name === `${id}${zone}`) return null
    return String(name)
}

function notFound(msg) {
    const err = new Error(msg)
    err.status = 404
    return err
}
function badRequest(msg) {
    const err = new Error(msg)
    err.status = 400
    return err
}

// ---- Mobile Legends: gopay (MOBILE_LEGENDS) utama, fallback isan (bonus negara) ----
async function stalkML(id, zone) {
    if (!zone?.trim()) throw badRequest("Mobile Legends butuh parameter 'zone' (zone ID). Contoh: ?game=ml&id=157228049&zone=2241")

    try {
        const name = await hitGopay("MOBILE_LEGENDS", { userId: id, zoneId: zone }, { id, zone })
        if (name) {
            return { game: "Mobile Legends: Bang Bang", userId: String(id), zoneId: String(zone), nickname: name, country: null, countryCode: null }
        }
    } catch { /* fallback */ }

    const { data } = await axios.get("https://mlbb-api.isan.eu.org/find", {
        params: { id, zone },
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: 15000,
        validateStatus: () => true
    })
    if (!data?.success || !data?.name) throw notFound("Akun Mobile Legends tidak ditemukan, cek kembali User ID & Zone ID")
    return {
        game: "Mobile Legends: Bang Bang",
        userId: String(id),
        zoneId: String(zone),
        nickname: data.name,
        country: data.countryName ?? null,
        countryCode: data.countryCode ?? null
    }
}

// ---- Free Fire: cukup userId ----
async function stalkFF(id) {
    const name = await hitGopay("FREEFIRE", { userId: id }, { id })
    if (!name) throw notFound("Akun Free Fire tidak ditemukan, cek kembali User ID")
    return { game: "Garena Free Fire", userId: String(id), nickname: name }
}

// ---- Genshin Impact: server di-derive dari prefix UID; nickname disensor oleh gopay ----
const GENSHIN_SERVER = { "6": "os_usa", "7": "os_euro", "8": "os_asia", "9": "os_cht", "18": "os_asia" }
function genshinServer(id) {
    const s = String(id)
    return GENSHIN_SERVER[s.slice(0, 2)] || GENSHIN_SERVER[s[0]] || null
}
async function stalkGenshin(id) {
    const server = genshinServer(id)
    if (!server) throw badRequest("UID Genshin tidak dikenali (harus diawali 6/7/8/9 atau 18)")
    const name = await hitGopay("GENSHIN_IMPACT", { userId: id, zoneId: server }, { id, zone: server })
    if (!name) throw notFound("Akun Genshin Impact tidak ditemukan, cek kembali UID")
    return { game: "Genshin Impact", userId: String(id), server, nickname: name, note: "nickname disamarkan oleh sumber" }
}

// ---- Game yang cukup userId saja (struktur respons gopay sama: data = nickname) ----
function simpleGopayGame(gameCode, label) {
    return async (id) => {
        const name = await hitGopay(gameCode, { userId: id }, { id })
        if (!name) throw notFound(`Akun ${label} tidak ditemukan, cek kembali User ID`)
        return { game: label, userId: String(id), nickname: name }
    }
}

const stalkPUBGM = simpleGopayGame("PUBGM", "PUBG Mobile")
const stalkCODM = simpleGopayGame("CALL_OF_DUTY", "Call of Duty Mobile")
const stalkAOV = simpleGopayGame("AOV", "Arena of Valor")

const GAMES = {
    ml: stalkML, mlbb: stalkML,
    ff: stalkFF, freefire: stalkFF,
    gi: stalkGenshin, genshin: stalkGenshin,
    pubgm: stalkPUBGM, pubg: stalkPUBGM,
    codm: stalkCODM, cod: stalkCODM,
    aov: stalkAOV,
}

const GAME_LIST = "ml (Mobile Legends), ff (Free Fire), gi (Genshin Impact), pubgm (PUBG Mobile), codm (Call of Duty Mobile), aov (Arena of Valor)"

export default {
    route: {
        method: "get",
        path: "/search/stalk-game",
        auth: false,
        tags: ["Search"],
        summary: "Cek nickname akun game (ML, FF, Genshin, PUBGM, CODM, AOV)",
        description: "Mengecek nickname pemilik akun game berdasarkan User ID. Mobile Legends butuh User ID + Zone ID; Genshin server otomatis dari prefix UID; game lain cukup User ID. Tanpa login, sumber gopay.co.id (ML fallback ke isan.eu.org). Catatan: nickname Genshin disamarkan oleh sumber.",
        parameters: [
            {
                name: "game",
                in: "query",
                required: true,
                description: "Game yang dicek: ml, ff, gi (Genshin), pubgm, codm, aov",
                schema: { type: "string", enum: ["ml", "ff", "gi", "pubgm", "codm", "aov"], example: "ml" }
            },
            {
                name: "id",
                in: "query",
                required: true,
                description: "User ID / UID akun game",
                schema: { type: "string", example: "157228049" }
            },
            {
                name: "zone",
                in: "query",
                required: false,
                description: "Zone ID (WAJIB untuk Mobile Legends, abaikan untuk game lain)",
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
                                        server: { type: "string", example: "os_asia" },
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
            return res.status(400).json({ ok: false, error: `Isi parameter 'game'. Pilihan: ${GAME_LIST}` })
        }
        if (!id?.trim()) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'id' (User ID)" })
        }

        const fn = GAMES[game.trim().toLowerCase()]
        if (!fn) {
            return res.status(400).json({ ok: false, error: `Game tidak didukung. Pilihan: ${GAME_LIST}` })
        }

        try {
            const result = await fn(id.trim(), zone)
            return res.json({ ok: true, result })
        } catch (e) {
            return res.status(e.status || e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
