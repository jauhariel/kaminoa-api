import { create } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

const jar = new CookieJar();
const client = wrapper(create({ jar, withCredentials: true, timeout: 30000 }));

const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0";

const ouo = async (url) => {
  const baseHeaders = {
    Host: "ouo.io",
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Upgrade-Insecure-Requests": 1,
    "Sec-Fetch-Site": "same-origin",
  };

  const init = await client.get(url, {
    headers: baseHeaders,
  });

  if (init.status == 200) {
    let $ = cheerio.load(init.data);
    const token = $('input[name="_token"]').val();

    const response = await client.post(
      url.replace("ouo.io/", "ouo.io/xreallcygo/"),
      {
        _token: token,
        "x-token": "",
      },
      {
        headers: {
          ...baseHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: url.replace("ouo.io/", "ouo.io/go/"),
          Origin: "https://ouo.io",
          "Upgrade-Insecure-Requests": 1,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-User": "?1",
          Priority: "u=0, i",
        },
        maxRedirects: 0,
        validateStatus: () => true,
      },
    );
    return response.headers.location;
  } else return null;
};

export default {
  route: {
    method: "get",
    path: "/resolver/ouo",
    tags: ["Resolver"],
    summary: "resolver url shortener ouo.io atau ouo.press",
    description: "",
    parameters: [
      {
        name: "url",
        in: "query",
        required: true,
        description: "url ouo",
        schema: { type: "string", example: "ouo.press/mYmbGGw" },
      },
    ],
    responses: {
      200: {
        description: "Berhasil",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                result: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  handler: async (req, res) => {
    const { url } = req.query;
    if (!url)
      return res.status(400).json({ ok: false, error: "url wajib diisi" });
    try {
      res.json({ ok: true, result: await ouo(url) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  },
};
