import axios from "axios"
import crypto from "crypto"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0"
const ENDPOINT = "https://gql.tokopedia.com/graphql/SearchProductV5Query"

// Mode urut Tokopedia (param "ob"). Terverifikasi: 23=relevansi, 3=termurah, 4=termahal.
const SORT_MAP = { relevan: "23", termurah: "3", termahal: "4" }

function parsePrice(v) {
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
}

// Device id 19-digit acak penuh tanpa precision-loss. bd-device-id memengaruhi
// jumlah hasil yang dikembalikan Tokopedia, jadi harus nilai yang valid.
function randomDeviceId() {
    const d = ["7"]
    for (let i = 0; i < 18; i += 1) d.push(String(crypto.randomInt(10)))
    return d.join("")
}

const QUERY = `
query SearchProductV5Query($params: String!) {
  searchProductV5(params: $params) {
    header { totalData responseCode isQuerySafe }
    data { totalDataText products {
      oldID: id id: id_str_auto_ ttsProductID name url applink
      mediaURL { image image300 videoCustom }
      shop { oldID: id id: id_str_auto_ ttsSellerID name url city tier }
      stock { ttsSKUID } badge { oldID: id id: id_str_auto_ title url }
      price { text number range original discountPercentage }
      labelGroups { position title type url }
      category { oldID: id id: id_str_auto_ name breadcrumb gaKey }
      rating wishlist ads { id productClickURL productViewURL productWishlistURL tag }
    } }
  }
}`

// Paginasi dikendalikan oleh "start" (offset), BUKAN "page": field page harus
// tetap "1" — nilai >=2 membuat Tokopedia balikin 0 hasil. Offset sembarang dihormati.
// related="false" mematikan ekor produk rekomendasi yang mengabaikan filter/sort.
function buildParams(keyword, start, rows, uniqueId, opts = {}) {
    const params = {
        device: "desktop", enter_method: "normal_search", l_name: "sre", navsource: "home",
        ob: opts.ob || "23", page: "1", q: keyword, related: opts.related === false ? "false" : "true", rows: String(rows),
        safe_search: "false", sc: "", scheme: "https", shipping: "", show_adult: "false",
        source: "universe", st: "product", start: String(start), topads_bucket: "true",
        unique_id: uniqueId, user_addressId: "", user_cityId: "176", user_districtId: "2274",
        user_id: "", user_lat: "", user_long: "", user_postCode: "", user_warehouseId: "",
        variants: "", warehouses: "",
    }
    if (opts.pmin != null) params.pmin = String(opts.pmin)
    if (opts.pmax != null) params.pmax = String(opts.pmax)
    return new URLSearchParams(params).toString()
}

const label = (x, pos) => x?.labelGroups?.find(v => v.position === pos)?.title || null

// Diskon asli ada di label "ri_ribbon" (yang ditampilkan Tokopedia); field
// price.discountPercentage selalu 0. Fallback: hitung dari harga asli vs sekarang.
function getDiscount(x) {
    const ribbon = label(x, "ri_ribbon")
    if (ribbon) {
        const n = parseInt(String(ribbon).replace(/\D/g, ""), 10)
        if (n > 0) return n
    }
    const orig = Number(String(x?.price?.original || "").replace(/\D/g, ""))
    const now = Number(x?.price?.number || 0)
    if (orig > now && orig > 0) return Math.round(((orig - now) / orig) * 100)
    return Number(x?.price?.discountPercentage) || 0
}

// Status toko dari badge: id 4 = Official Store, id 3 = Power Merchant Pro.
// Catatan: badge.title justru berisi nama kota, jadi tidak dipakai sebagai status.
function shopStatus(x) {
    const id = Number(x?.badge?.id ?? x?.badge?.oldID)
    const url = x?.badge?.url || ""
    if (id === 4 || /badge_os|official_store/i.test(url)) return "Official Store"
    if (id === 3 || /power.?merchant.?pro/i.test(url)) return "Power Merchant Pro"
    return "Regular"
}

function cleanProduct(x) {
    const status = shopStatus(x)
    return {
        id: x?.id || null,
        name: x?.name || null,
        url: x?.url || null,
        image: x?.mediaURL?.image || null,
        price: x?.price?.text || null,
        priceNumber: x?.price?.number || null,
        originalPrice: x?.price?.original || null,
        discount: getDiscount(x),
        rating: x?.rating || null,
        sold: label(x, "ri_product_credibility"),
        shop: {
            id: x?.shop?.id || null,
            name: x?.shop?.name || null,
            url: x?.shop?.url || null,
            city: x?.shop?.city || null,
            tier: x?.shop?.tier ?? null,
            status,
            officialStore: status === "Official Store",
        },
        category: {
            id: x?.category?.id || null,
            name: x?.category?.name || null,
            breadcrumb: x?.category?.breadcrumb || null,
        },
    }
}

async function search(keyword, page, limit, { ob = "23", pmin = null, pmax = null } = {}) {
    // Minta data lebih banyak dari limit (Tokopedia kerap balikin >rows), lalu potong di sisi kita.
    // Offset paginasi berbasis limit agar "page" intuitif (page 2 = lanjut sebanyak limit).
    const rows = Math.max(limit, 60)
    const start = (page - 1) * limit
    // Saat filter harga / sort non-default dipakai, matikan produk rekomendasi
    // (related) yang mengabaikan filter — biar hasil bersih.
    const filtering = pmin != null || pmax != null || ob !== "23"
    const deviceId = randomDeviceId()
    const payload = [{
        operationName: "SearchProductV5Query",
        variables: { params: buildParams(keyword, start, rows, crypto.randomBytes(16).toString("hex"), { ob, pmin, pmax, related: !filtering }) },
        query: QUERY,
    }]

    const { data } = await axios.post(ENDPOINT, payload, {
        headers: {
            "user-agent": UA,
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            origin: "https://www.tokopedia.com",
            referer: "https://www.tokopedia.com/",
            "x-tkpd-lite-service": "zeus",
            "x-source": "tokopedia-lite",
            "bd-device-id": deviceId,
            "bd-web-id": deviceId,
        },
        timeout: 30000,
    })

    const root = Array.isArray(data) ? data[0] : data
    if (root?.errors?.length) throw new Error(root.errors[0]?.message || "Tokopedia menolak permintaan")
    const result = root?.data?.searchProductV5
    if (!result) throw new Error("Respons tidak terduga dari Tokopedia")

    let products = result.data?.products || []
    // Jaring pengaman: buang produk di luar rentang harga kalau ada yang lolos dari filter server.
    if (pmin != null) products = products.filter(p => Number(p?.price?.number || 0) >= pmin)
    if (pmax != null) products = products.filter(p => Number(p?.price?.number || 0) <= pmax)
    return {
        total: Number(result.header?.totalData || 0),
        totalText: result.data?.totalDataText || String(products.length),
        result: products.slice(0, limit).map(cleanProduct),
    }
}

export default {
    route: {
        method: "get",
        path: "/search/tokopedia",
        auth: false,
        tags: ["Search"],
        summary: "Cari produk Tokopedia",
        description: "Mencari produk di Tokopedia (harga, diskon, rating, terjual, status toko). Mendukung halaman (page), batas hasil (limit), urutan (sort), dan filter harga (pmin/pmax). Tanpa API key.",
        parameters: [
            {
                name: "q",
                in: "query",
                required: true,
                description: "Kata kunci pencarian produk",
                schema: { type: "string", example: "vivo x300" },
            },
            {
                name: "page",
                in: "query",
                required: false,
                description: "Halaman hasil (default 1)",
                schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
                name: "limit",
                in: "query",
                required: false,
                description: "Jumlah maksimum hasil (1-60, default 20)",
                schema: { type: "integer", default: 20, minimum: 1, maximum: 60 },
            },
            {
                name: "sort",
                in: "query",
                required: false,
                description: "Urutan hasil (default relevan)",
                schema: { type: "string", enum: ["relevan", "termurah", "termahal"], default: "relevan" },
            },
            {
                name: "pmin",
                in: "query",
                required: false,
                description: "Filter harga minimum (rupiah)",
                schema: { type: "integer", minimum: 0, example: 5000000 },
            },
            {
                name: "pmax",
                in: "query",
                required: false,
                description: "Filter harga maksimum (rupiah)",
                schema: { type: "integer", minimum: 0, example: 8000000 },
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
                                query: { type: "string" },
                                page: { type: "integer" },
                                total: { type: "integer", description: "Total produk yang cocok di Tokopedia" },
                                totalText: { type: "string" },
                                count: { type: "integer", description: "Jumlah produk pada respons ini" },
                                result: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            name: { type: "string" },
                                            url: { type: "string" },
                                            image: { type: "string" },
                                            price: { type: "string" },
                                            priceNumber: { type: "integer" },
                                            originalPrice: { type: "string" },
                                            discount: { type: "integer", description: "Persentase diskon" },
                                            rating: { type: "string" },
                                            sold: { type: "string" },
                                            shop: {
                                                type: "object",
                                                properties: {
                                                    id: { type: "string" },
                                                    name: { type: "string" },
                                                    url: { type: "string" },
                                                    city: { type: "string" },
                                                    tier: { type: "integer" },
                                                    status: { type: "string", enum: ["Official Store", "Power Merchant Pro", "Regular"] },
                                                    officialStore: { type: "boolean" },
                                                },
                                            },
                                            category: {
                                                type: "object",
                                                properties: {
                                                    id: { type: "string" },
                                                    name: { type: "string" },
                                                    breadcrumb: { type: "string" },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "400": { description: "Parameter tidak valid" },
            "500": { description: "Kesalahan server" },
        },
    },

    handler: async (req, res) => {
        const q = (req.query.q || "").toString().trim()
        if (!q) return res.status(400).json({ ok: false, error: "Parameter q wajib diisi" })
        let page = parseInt(req.query.page, 10)
        if (isNaN(page) || page < 1) page = 1
        let limit = parseInt(req.query.limit, 10)
        if (isNaN(limit)) limit = 20
        limit = Math.max(1, Math.min(60, limit))

        const sort = (req.query.sort || "relevan").toString().toLowerCase()
        const ob = SORT_MAP[sort] || "23"
        let pmin = parsePrice(req.query.pmin)
        let pmax = parsePrice(req.query.pmax)
        // Tukar kalau terbalik supaya rentang tetap masuk akal.
        if (pmin != null && pmax != null && pmin > pmax) [pmin, pmax] = [pmax, pmin]

        try {
            const { total, totalText, result } = await search(q, page, limit, { ob, pmin, pmax })
            res.json({ ok: true, query: q, page, sort, priceMin: pmin, priceMax: pmax, total, totalText, count: result.length, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    },
}
