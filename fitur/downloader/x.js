/*
 * Author: Rynn
 * Thanks for the scraper.
 */

import axios from "axios"

const URL_REGEX = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i

async function tweeload(url) {
    const { data } = await axios.get(
        `https://tweeload.aculix.net/status/?url=${encodeURIComponent(url)}`,
        {
            headers: {
                authorization: "cKMQlY4jGCflOStlN3UfnWCxLQSb5GL7UPjPJ3jGS5fkno1Jaf",
                "user-agent": "okhttp/4.12.0"
            }
        }
    )
    return data.tweet || data
}

export default {
    route: {
        method: "get",
        path: "/downloader/x",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video/media dari Twitter/X",
        description: "Mengambil link download media dari tweet Twitter/X berdasarkan URL status.",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL tweet Twitter/X",
                schema: { type: "string", example: "https://x.com/user/status/123456789" }
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
                                result: { type: "object" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "URL tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { url } = req.query
        if (!url || !URL_REGEX.test(url)) {
            return res.status(400).json({ ok: false, error: "URL Twitter/X tidak valid" })
        }
        try {
            const result = await tweeload(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
