import axios from "axios"
import * as cheerio from "cheerio"
import ManualJS from "../../lib/cekresi-crypto.js"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// Rabbit-encrypt nomor resi jadi token `timers` (divalidasi server cekresi.com)
function encryptTimers(number) {
    const result = ManualJS.MDX.goinstring(
        number,
        ManualJS.jun.Des.parse("79540e250fdb16afac03e19c46dbdeb3"),
        { ii: ManualJS.jun.Des.parse("eb2bb9425e81ffa942522e4414e95bd0") }
    ).rabbittext.toString(ManualJS.jun.Text21)
    return encodeURIComponent(result)
}

// Ambil CSRF (viewstate + secret_key) dari halaman cekresi.com
async function getCSRF(number) {
    const { data } = await axios.get(`https://cekresi.com/?noresi=${encodeURIComponent(number)}&e=JET`, {
        headers: { "User-Agent": UA },
        timeout: 15000
    })
    const $ = cheerio.load(data)
    const viewstate = $('input[name="viewstate"]').val()
    const secret_key = $('input[name="secret_key"]').val()
    if (!viewstate || !secret_key) throw new Error("Gagal mengambil token dari cekresi.com")
    return { viewstate, secret_key }
}

// Parse HTML hasil tracking jadi objek terstruktur
function parseResi($) {
    const blk = $(".alert.alert-success strong")
    const expedisi = blk.eq(1).text().trim()
    const noResi = blk.eq(2).text().trim()
    const pengirim = $('td:contains("Dikirim oleh")').next().next().text().trim()
    const tujuan = $('td:contains("Dikirim ke")').next().next().text().replace(/\s+/g, " ").trim()
    const status = $("#status_resi").text().trim()
    const tanggalKirim = $('td:contains("Dikirim tanggal")').next().next().text().trim()
    const posisiTerakhir = $("#last_position").text().trim()

    const riwayat = []
    $("#collapseTwo .table tr").each((_, row) => {
        const tanggal = $(row).find("td").eq(0).text().trim()
        const keterangan = $(row).find("td").eq(1).text().trim()
        if (tanggal && keterangan && tanggal !== "Tanggal") riwayat.push({ tanggal, keterangan })
    })

    return { expedisi, noResi, pengirim, tujuan, status, tanggalKirim, posisiTerakhir, riwayat }
}

// POST ke endpoint tracking, dengan retry (server kadang timeout)
async function fetchTracking(number, csrf, timers) {
    const postData = `viewstate=${csrf.viewstate}&secret_key=${csrf.secret_key}&e=JET&noresi=${encodeURIComponent(number)}&timers=${timers}`
    const { data } = await axios.post(
        "https://apa2.cekresi.com/cekresi/resi/initialize.php?ui=dad9643acec71f85853608db54345ada&p=1&w=chfj6h",
        postData,
        {
            headers: {
                "User-Agent": UA,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Origin: "https://cekresi.com",
                Referer: "https://cekresi.com/",
                Accept: "*/*"
            },
            timeout: 15000
        }
    )
    return data
}

async function cekResi(number) {
    const csrf = await getCSRF(number)
    const timers = encryptTimers(number)

    // retry sekali kalau timeout/error jaringan (server cekresi kadang lambat)
    let html
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            html = await fetchTracking(number, csrf, timers)
            break
        } catch (e) {
            if (attempt === 1) throw new Error("cekresi.com tidak merespons, coba lagi")
        }
    }

    const $ = cheerio.load(html)
    const result = parseResi($)

    if (!result.expedisi && !result.status) {
        const err = new Error("Nomor resi tidak ditemukan atau belum terinput di sistem ekspedisi")
        err.status = 404
        throw err
    }
    return result
}

export default {
    route: {
        method: "get",
        path: "/search/cek-resi",
        auth: false,
        tags: ["Search"],
        summary: "Lacak paket / cek resi pengiriman",
        description: "Melacak status pengiriman paket dari nomor resi (AWB). Ekspedisi terdeteksi otomatis (JNE, J&T, SiCepat, POS, TIKI, AnterAja, dll). Sumber: cekresi.com.",
        parameters: [
            {
                name: "resi",
                in: "query",
                required: true,
                description: "Nomor resi / AWB paket",
                schema: { type: "string", example: "JP9999999999" }
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
                                        expedisi: { type: "string", example: "JNE Express" },
                                        noResi: { type: "string", example: "JP9999999999" },
                                        pengirim: { type: "string", example: "JAKARTA" },
                                        tujuan: { type: "string", example: "BANDUNG" },
                                        status: { type: "string", example: "Terkirim" },
                                        tanggalKirim: { type: "string", example: "01-06-2026" },
                                        posisiTerakhir: { type: "string", example: "Diterima oleh: YunG (2026-06-03)" },
                                        riwayat: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    tanggal: { type: "string", example: "2026-06-03 10:21" },
                                                    keterangan: { type: "string", example: "Diterima di kota tujuan" }
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
            "400": {
                description: "Parameter tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Resi tidak ditemukan",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const resi = req.query.resi?.trim()

        if (!resi) {
            return res.status(400).json({ ok: false, error: "Isi parameter 'resi' (nomor AWB)" })
        }

        try {
            const result = await cekResi(resi)
            return res.json({ ok: true, result })
        } catch (e) {
            return res.status(e.status || e.response?.status || 500).json({ ok: false, error: e.message })
        }
    }
}
