import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

function clean(text) {
    return String(text || "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
        .replace(/\s+/g, " ").trim()
}

function parsePOS(el) {
    //Ambil label kata dari <span title="Verba: kata kerja">v</span> etc
    const span = $(el).find('span[title]').first()
    const title = span.attr("title") || ""
    const label = clean(span.text())
    return { label, full: title }
}

async function searchKBBI(query, source = "web") {
    const url = source === "web"
        ? `https://kbbi.web.id/${encodeURIComponent(query)}`
        : `https://kbbi.kemendikdasmen.go.id/entri/${encodeURIComponent(query)}`
    const { data, status } = await axios.get(url, {
        headers: {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "id-ID,id;q=0.9"
        },
        timeout: 15000
    })
    return { data, status, url }
}

function parseEntries(html) {
    const $ = cheerio.load(html)
    const entries = []

    // tiap entri diawali <h2> — cari semua h2 yang bukan navbar
    const h2s = $("h2").filter((_, el) => {
        const parent = $(el).parent()
        return parent.hasClass("container") || parent.hasClass("body-content") || parent.hasClass("container body-content")
    })

    h2s.each((_, h2) => {
        const headword = clean($(h2).text())
        if (!headword) return

        const entry = { lema: headword, entri: [] }

        // ambil sibling berikutnya sampai ketemu h2 berikutnya atau hr terakhir
        let node = $(h2).next()
        while (node.length && !node.is("h2")) {
            // berhenti sebelum "Pesan Redaksi"
            if (node.is("hr") && node.next().is("h4")) break
            if (node.is("h4")) break

            // ambil tesaurus link
            if (node.is("p")) {
                const link = node.find("a[href*='tesaurus']")
                if (link.length) {
                    entry.tesaurus = link.attr("href")
                }
            }

            // ol > li = definisi utama
            if (node.is("ol")) {
                node.find("> li").each((_, li) => {
                    const def = parseDefinition($, li)
                    if (def) entry.entri.push(def)
                })
            }

            // ul.adjusted-par = entri khusus (Tasawuf dll)
            if (node.is("ul")) {
                node.find("> li").each((_, li) => {
                    const def = parseDefinition($, li)
                    if (def) entry.entri.push(def)
                })
            }

            node = node.next()
        }

        if (entry.entri.length) entries.push(entry)
    })

    return entries
}

function parseDefinition($, li) {
    const el = $(li)

    // ambil label kata (v, n, a, dll)
    const posSpans = el.find("font[color='red'] i span[title]")
    let pos = ""
    let posFull = ""
    if (posSpans.length) {
        pos = clean(posSpans.first().text())
        posFull = posSpans.first().attr("title") || ""
    }

    // ambil keterangan (ki = kiasan, TAS = tasawuf, dst)
    const keteranganSpans = el.find("font[color='green']")
    const keterangan = keteranganSpans.length ? clean(keteranganSpans.text()) : null

    // ambil teks definisi — hapus semua tag font/-span styling
    let fullText = el.clone()
    fullText.find("font[color='red'], font[color='green']").remove()

    const greyFont = fullText.find("font[color='grey']")
    const example = []
    greyFont.each((_, gf) => {
        const t = clean($(gf).text()).replace(/^[;:,.\s]+/, "").replace(/[;:,.\s]+$/, "")
        if (t && t !== " ") example.push(t)
    })
    greyFont.remove()

    const brownFont = fullText.find("font[color='brown']")
    const keteranganTambahan = []
    brownFont.each((_, bf) => {
        const t = clean($(bf).text())
        if (t) keteranganTambahan.push(t)
    })
    brownFont.remove()

    const definisi = clean(fullText.text())
    if (!definisi) return null

    const result = {}
    if (pos) result.kode = pos
    if (posFull) result.kelas = posFull
    if (keterangan) result.keterangan = keterangan
    result.arti = definisi
    if (example.length) result.contoh = example
    if (keteranganTambahan.length) result.keterangan_tambahan = keteranganTambahan
    return result
}

function parseWebKBBI(html) {
    const $ = cheerio.load(html)
    const d1 = $("#d1")
    if (!d1.length) return []

    // cek error: "tidak ditemukan"
    if (/tidak ditemukan/i.test(d1.text())) return []

    const entries = []
    const raw = $.html(d1)

    // split per bentuk kata: <br><br> atau <br/><br/>
    const sections = raw.split(/<br\s*\/?><br\s*\/?>/)

    for (const section of sections) {
        const $sec = cheerio.load(`<div>${section}</div>`)
        const root = $sec("div").first()

        const lemaEl = root.find("b").first()
        if (!lemaEl.length) continue
        const lema = clean(lemaEl.text().replace(/<sup>.*?<\/sup>/g, ""))
        if (!lema || /^\d+$/.test(lema)) continue

        const text = clean(root.text().replace(/<sup>.*?<\/sup>/g, ""))
        if (!text) continue

        // ekstrak definisi bernomor (1, 2, 3...)
        const entri = []
        const boldEls = root.find("b")

        boldEls.each((i, el) => {
            const txt = clean($sec(el).text()).replace(/<sup>.*?<\/sup>/g, "")
            if (/^\d+$/.test(txt)) {
                // ambil teks dari setelah <b>N</b> sampai <b> berikutnya atau akhir
                let rest = ""
                let nxt = $sec(el).next()
                while (nxt.length && !(nxt.is("b") && /^\d+$/.test(clean(nxt.text())))) {
                    rest += nxt.text().trim() + " "
                    nxt = nxt.next()
                }
                const arti = clean(rest).replace(/<sup>.*?<\/sup>/g, "")
                if (arti) {
                    const def = { nomor: parseInt(txt), arti }
                    // ekstrak kode dari <em> pertama
                    if (i === 1) {
                        const firstEm = root.find("em").first()
                        if (firstEm.length) def.kode = clean(firstEm.text())
                    }
                    entri.push(def)
                }
            }
        })

        if (!entri.length) {
            entri.push({ arti: text })
        }

        entries.push({ lema, entri })
    }

    if (!entries.length) {
        const text = clean(d1.text())
        const lema = clean(d1.find("b").first().text().replace(/<sup>.*?<\/sup>/g, ""))
        entries.push({ lema: lema || text.split(/\s/)[0], entri: [{ arti: text }] })
    }

    return entries
}

export default {
    route: {
        method: "get",
        path: "/search/kbbi",
        auth: false,
        tags: ["Search"],
        summary: "Cari arti kata di KBBI",
        description: "Mencari arti kata dalam Kamus Besar Bahasa Indonesia (KBBI VI Daring) berdasarkan entri yang tersedia.",
        parameters: [
            {
                name: "q",
                in: "query",
                required: true,
                description: "Kata yang ingin dicari",
                schema: { type: "string", example: "makan" }
            },
            {
                name: "source",
                in: "query",
                required: false,
                description: "Sumber data KBBI (default: web, karena kemendikdasmen sering membatasi akses)",
                schema: { type: "string", enum: ["kemendikdasmen", "web"], default: "web" }
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
                                query: { type: "string" },
                                url: { type: "string" },
                                hasil: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            lema: { type: "string" },
                                            tesaurus: { type: "string" },
                                            entri: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        kode: { type: "string" },
                                                        kelas: { type: "string" },
                                                        keterangan: { type: "string" },
                                                        arti: { type: "string" },
                                                        contoh: { type: "array", items: { type: "string" } }
                                                    }
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
            "404": { description: "Kata tidak ditemukan" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const q = (req.query.q || "").trim()
        const source = req.query.source || "web"
        if (!q) return res.status(400).json({ ok: false, error: "parameter q wajib diisi" })

        const trySource = async (src) => {
            const { data, url } = await searchKBBI(q, src)
            if (src === "web") {
                const entries = parseWebKBBI(data)
                return { entries, url, source: src }
            }
            const $ = cheerio.load(data)
            const errDiv = $("#errorMessageDiv")
            if (errDiv.length && clean(errDiv.text())) {
                throw Object.assign(new Error(clean(errDiv.text())), { statusCode: 404 })
            }
            // cek "Entri tidak ditemukan"
            if (/Entri tidak ditemukan/i.test(data)) {
                throw Object.assign(new Error("Entri tidak ditemukan"), { statusCode: 404 })
            }
            const entries = parseEntries(data)
            return { entries, url, source: src }
        }

        try {
            let result
            if (source === "web") {
                result = await trySource("web")
            } else {
                // coba kemendikdasmen dulu, fallback ke web kalo gagal / dibatasi (Moda Terbatas)
                try {
                    result = await trySource("kemendikdasmen")
                    if (!result.entries.length) result = await trySource("web")
                } catch (err) {
                    if (err.statusCode === 404) {
                        // fallback ke kbbi.web.id
                        const webResult = await trySource("web")
                        result = webResult
                    } else {
                        throw err
                    }
                }
            }

            if (!result.entries.length) {
                return res.status(404).json({ ok: false, error: `kata "${q}" tidak ditemukan di KBBI` })
            }

            res.json({ ok: true, query: q, url: result.url, source: result.source, hasil: result.entries })
        } catch (e) {
            const status = e.statusCode || 500
            if (status === 404) {
                return res.status(404).json({ ok: false, error: `kata "${q}" tidak ditemukan di KBBI` })
            }
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
