import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

function decodeHtml(text) {
    return String(text || "")
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
}

function cleanText(text) {
    return decodeHtml(text).replace(/<\/?[^>]+>/g, "").replace(/\[\d+\]/g, "").replace(/\[[a-z]\]/gi, "").replace(/\s+/g, " ").trim()
}

function cleanBlock(text) {
    return decodeHtml(text).replace(/<\/?[^>]+>/g, "").replace(/\[\d+\]/g, "").replace(/\[[a-z]\]/gi, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function fixUrl(url, base) {
    if (!url) return null
    if (url.startsWith("//")) return `https:${url}`
    if (url.startsWith("/")) return `${base}${url}`
    return url
}

function uniqueBy(array, key) {
    return array.filter((item, i, self) => self.findIndex(x => x[key] === item[key]) === i)
}

async function searchWikipedia(query, lang) {
    const base = `https://${lang}.wikipedia.org`
    const { data, status } = await axios.get(`${base}/w/api.php`, {
        params: { action: "query", list: "search", srsearch: query, srlimit: 5, format: "json", origin: "*" },
        headers: { "user-agent": UA, "accept-language": "id-ID,id;q=0.9,en-US;q=0.8" }
    })
    return { code: status, base, results: data?.query?.search || [] }
}

async function getFullArticle(title, base) {
    const pagePath = `/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`
    const pageUrl = `${base}${pagePath}`

    const { data, status } = await axios.get(pageUrl, {
        headers: {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "id-ID,id;q=0.9,en-US;q=0.8",
            referer: "https://www.wikipedia.org/"
        }
    })

    const $ = cheerio.load(data)
    $("script,style,noscript,sup.reference,.mw-editsection,.navbox,.metadata,.ambox,.hatnote,.toc,#toc,table.vertical-navbox").remove()

    const pageTitle = cleanText($("#firstHeading").text()) || title
    const description = cleanText($(".tagline").first().text()) || null

    const introParagraphs = []
    $(".mw-parser-output > section").first().find("p").each((_, el) => {
        const text = cleanBlock($(el).text())
        if (text.length > 40) introParagraphs.push(text)
    })
    if (!introParagraphs.length) {
        $(".mw-parser-output > p").each((_, el) => {
            const text = cleanBlock($(el).text())
            if (text.length > 40) introParagraphs.push(text)
        })
    }

    const sections = []
    $(".mw-parser-output > section").each((_, section) => {
        const heading = cleanText($(section).find("h2,h3").first().text())
        if (!heading || heading.toLowerCase() === "daftar isi") return
        const texts = []
        $(section).find("p,ul,ol").each((_, el) => {
            const text = cleanBlock($(el).text())
            if (text.length > 40) texts.push(text)
        })
        if (texts.length) sections.push({ title: heading, text: texts.join("\n\n") })
    })

    const infobox = {}
    $(".infobox tr").each((_, tr) => {
        const key = cleanText($(tr).find("th").first().text())
        const value = cleanText($(tr).find("td").first().text())
        if (key && value && key.length < 100) infobox[key] = value
    })

    const images = []
    $(".mw-parser-output img").each((_, img) => {
        const src = fixUrl($(img).attr("src"), base)
        const alt = cleanText($(img).attr("alt"))
        if (!src || src.includes("static/images") || src.includes("Semi-protection") || src.includes("OOjs_UI")) return
        images.push({ alt: alt || null, url: src })
    })

    return {
        code: status,
        article: {
            title: pageTitle,
            description,
            url: pageUrl,
            extract: introParagraphs.join("\n\n") || null,
            sections,
            infobox,
            images: uniqueBy(images, "url")
        }
    }
}

export default {
    route: {
        method: "get",
        path: "/search/wikipedia",
        auth: false,
        tags: ["Search"],
        summary: "Cari artikel Wikipedia",
        description: "Mencari artikel di Wikipedia berdasarkan kata kunci dan mengembalikan konten lengkap termasuk ekstrak, seksi, infobox, dan gambar.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: true,
                description: "Kata kunci pencarian",
                schema: { type: "string", example: "Rendang" }
            },
            {
                name: "lang",
                in: "query",
                required: false,
                description: "Kode bahasa Wikipedia",
                schema: { type: "string", default: "id", example: "id" }
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
                                input: { type: "string" },
                                selected: {
                                    type: "object",
                                    properties: {
                                        title: { type: "string" },
                                        pageId: { type: "integer" },
                                        snippet: { type: "string" }
                                    }
                                },
                                result: {
                                    type: "object",
                                    properties: {
                                        title: { type: "string" },
                                        description: { type: "string", nullable: true },
                                        url: { type: "string" },
                                        extract: { type: "string", nullable: true },
                                        sections: { type: "array", items: { type: "object" } },
                                        infobox: { type: "object" },
                                        images: { type: "array", items: { type: "object" } }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "404": {
                description: "Artikel tidak ditemukan",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { query, lang = "id" } = req.query
        if (!query || !query.trim()) {
            return res.status(400).json({ ok: false, error: "query wajib diisi" })
        }
        try {
            const search = await searchWikipedia(query.trim(), lang)
            if (!search.results.length) {
                return res.status(404).json({ ok: false, error: "artikel tidak ditemukan" })
            }
            const first = search.results[0]
            const detail = await getFullArticle(first.title, search.base)
            res.json({
                ok: true,
                input: query.trim(),
                selected: { title: first.title, pageId: first.pageid, snippet: cleanText(first.snippet) },
                result: detail.article
            })
        } catch (e) {
            res.status(e.response?.status || 500).json({ ok: false, error: e.response?.data?.error?.info || e.message })
        }
    }
}
