import axios from "axios";

// Function to download image from URL
const downloadImage = async (imageUrl) => {
    try {
        const response = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000, // 30 seconds timeout
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });

        // Get filename from URL or use default
        const urlParts = imageUrl.split("/");
        const filename = urlParts[urlParts.length - 1].split("?")[0] || "image.jpg";

        return {
            buffer: Buffer.from(response.data),
            filename: filename,
            contentType: response.headers["content-type"] || "image/jpeg",
        };
    } catch (error) {
        throw new Error(`Gagal mengunduh gambar dari URL: ${error.message}`);
    }
};

// Function to check NSFW using Nyckel API
const nyckelCheck = async (imageBuffer, filename) => {
    try {
        const form = new FormData();
        const blob = new Blob([imageBuffer], { type: "image/jpeg" });
        form.append("file", blob, filename);

        const res = await axios.post(
            "https://www.nyckel.com/v1/functions/o2f0jzcdyut2qxhu/invoke",
            form,
            {
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    origin: "https://www.nyckel.com",
                    referer:
                        "https://www.nyckel.com/pretrained-classifiers/nsfw-identifier/",
                    "user-agent":
                        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
                    "x-requested-with": "XMLHttpRequest",
                },
            }
        );

        return res.data;
    } catch (err) {
        throw new Error(
            `Gagal memeriksa NSFW: ${JSON.stringify(err.response?.data) || err.message}`
        );
    }
};

export default {
    route: {
        method: "get",
        path: "/tools/nyckel-nsfw",
        auth: false,
        tags: ["Tools"],
        summary: "NSFW Image Checker menggunakan Nyckel",
        description: "Memeriksa apakah gambar mengandung konten NSFW menggunakan AI classifier dari Nyckel",
        parameters: [
            {
                name: "url",
                in: "query",
                required: true,
                description: "URL gambar yang akan diperiksa",
                schema: { type: "string", example: "https://github.com/fluidicon.png" },
            },
        ],
        responses: {
            "200": {
                description: "NSFW check berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                url: { type: "string", example: "https://github.com/fluidicon.png" },
                                result: {
                                    type: "object",
                                    properties: {
                                        labelName: { type: "string", example: "Not Porn" },
                                        labelId: { type: "string", example: "label_n2ian8w116lhxuyk" },
                                        confidence: { type: "number", example: 0.9976704383653677 },
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
        const { url } = req.query;

        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "URL tidak valid" });
        }

        try {
            const { buffer, filename } = await downloadImage(url);
            const result = await nyckelCheck(buffer, filename);
            res.json({ ok: true, url, result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    },
};
