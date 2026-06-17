import { unfurl } from "unfurl.js"

// Banyak situs (TikTok, FB) hanya menyajikan og-tags untuk UA crawler/bot.
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"

async function linkPreview(url) {
    const data = await unfurl(url, { headers: { "user-agent": CRAWLER_UA } })
    const og = data.open_graph ?? {}
    const tw = data.twitter_card ?? {}

    const image =
        og.images?.[0]?.url ??
        tw.images?.[0]?.url ??
        null

    return {
        url,
        title: data.title ?? og.title ?? tw.title ?? null,
        description: data.description ?? og.description ?? tw.description ?? null,
        image,
        siteName: og.site_name ?? null,
        type: og.type ?? null,
        favicon: data.favicon ?? null,
    }
}

export default {
    route: {
        method: "get",
        path: "/tools/linkpreview",
        auth: false,
        tags: ["Tools"],
        summary: "Preview metadata dari sebuah link (unfurl)",
        description:
            "Mengambil metadata Open Graph / Twitter Card dari sebuah URL (judul, deskripsi, thumbnail, favicon) untuk keperluan preview link. Mendukung YouTube, Facebook publik, dan situs umum lainnya. Catatan: nama penulis/poster umumnya tidak tersedia lewat metadata. URL thumbnail Facebook (fbcdn) memiliki masa kedaluwarsa.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL yang ingin di-preview",
                schema: { type: "string", example: "https://www.youtube.com" },
            },
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
                                        url: { type: "string" },
                                        title: { type: "string" },
                                        description: { type: "string" },
                                        image: { type: "string" },
                                        siteName: { type: "string" },
                                        type: { type: "string" },
                                        favicon: { type: "string" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "URL tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" })
        }
        try {
            const result = await linkPreview(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
