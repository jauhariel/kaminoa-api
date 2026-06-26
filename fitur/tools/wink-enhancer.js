import crypto from "crypto"
import path from "path"

const BASE_URL = "https://wink.ai"
const STRATEGY_URL = "https://strategy.app.meitudata.com"

const CLIENT_ID = "1189857605"
const VERSION = "5.1.2"
const COUNTRY_CODE = "ID"
const CLIENT_LANGUAGE = "en_US"
const CLIENT_TIMEZONE = "Asia/Jakarta"

const TASK_TYPE = "12"
const CONTENT_TYPE = "1"
const EXT_VALUE = "2"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

const sleep = ms => new Promise(r => setTimeout(r, ms))

function mimeToSuffix(mime) {
  if (/png/i.test(mime)) return ".png"
  if (/webp/i.test(mime)) return ".webp"
  return ".jpg"
}

// Tiap pemanggilan punya konteks sendiri (cookie jar + gnum) — aman untuk concurrency.
function createSession() {
  const gnum = crypto.randomUUID()
  const cookies = new Map()

  const setCookie = str => {
    const [pair] = str.split(";")
    const i = pair.indexOf("=")
    if (i !== -1) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
  setCookie(`_sm=${gnum}`)
  setCookie(`meitustat=${encodeURIComponent(JSON.stringify({ wgid: gnum }))}`)

  const commonHeaders = {
    accept: "*/*",
    origin: BASE_URL,
    "user-agent": UA,
    "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": "\"Android\"",
    ab_info: JSON.stringify({ ab_codes: [], version: "1.4.4" }),
  }

  const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
  const absorb = res => { for (const c of res.headers.getSetCookie?.() ?? []) setCookie(c) }

  const makeTrace = () => `${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-1`
  const traceHeaders = (transaction = "GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload") => {
    const trace = makeTrace()
    return {
      "sentry-trace": trace,
      baggage: [
        "sentry-environment=release",
        "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
        "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
        `sentry-trace_id=${trace.split("-")[0]}`,
        `sentry-transaction=${transaction}`,
        "sentry-sampled=true",
        "sentry-sample_rate=0.75",
      ].join(","),
    }
  }

  const baseParams = (extra = {}) => new URLSearchParams({
    client_id: CLIENT_ID,
    version: VERSION,
    country_code: COUNTRY_CODE,
    gnum,
    client_language: CLIENT_LANGUAGE,
    client_channel_id: "",
    client_timezone: CLIENT_TIMEZONE,
    ...extra,
  })

  const get = async (url, extraHeaders = {}) => {
    const res = await fetch(url, {
      headers: { ...commonHeaders, referer: `${BASE_URL}/image-enhancer/upload`, cookie: cookieHeader(), ...extraHeaders },
    })
    absorb(res)
    return { status: res.status, data: await res.json().catch(() => null) }
  }

  const post = async (url, body, extraHeaders = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...commonHeaders,
        referer: `${BASE_URL}/image-enhancer/upload`,
        cookie: cookieHeader(),
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...extraHeaders,
      },
      body,
    })
    absorb(res)
    return { status: res.status, data: await res.json().catch(() => null) }
  }

  return { gnum, traceHeaders, baseParams, get, post }
}

async function enhance({ buffer, mime, taskName }) {
  const s = createSession()
  const suffix = mimeToSuffix(mime)

  // 1. get_maat_sign
  const signRes = await s.get(
    `${BASE_URL}/api/file/get_maat_sign.json?${s.baseParams({ suffix, type: "temp", count: "1" })}`,
    s.traceHeaders()
  )
  if (signRes.status >= 400 || signRes.data?.code !== 0) throw new Error(`get_maat_sign gagal: ${JSON.stringify(signRes.data)}`)
  const sign = signRes.data.data

  // 2. upload policy (qiniu)
  const policyParams = new URLSearchParams({
    app: sign.app, count: String(sign.count), sig: sign.sig,
    sigTime: sign.sig_time, sigVersion: sign.sig_version, suffix: sign.suffix, type: sign.type,
  })
  const policyRes = await fetch(`${STRATEGY_URL}/upload/policy?${policyParams}`, {
    headers: { accept: "*/*", origin: BASE_URL, referer: `${BASE_URL}/`, "user-agent": UA },
  })
  const policyData = await policyRes.json().catch(() => null)
  if (!Array.isArray(policyData) || !policyData[0]?.qiniu) throw new Error(`upload policy gagal: ${JSON.stringify(policyData)}`)
  const policy = policyData[0].qiniu

  // 3. upload ke qiniu
  const fname = path.basename(policy.key)
  const form = new FormData()
  form.append("file", new Blob([buffer], { type: mime }), fname)
  form.append("token", policy.token)
  form.append("key", policy.key)
  form.append("fname", fname)
  const upRes = await fetch(policy.url, {
    method: "POST",
    headers: { origin: BASE_URL, referer: `${BASE_URL}/`, "user-agent": UA, accept: "*/*" },
    body: form,
  })
  const upData = await upRes.json().catch(() => null)
  if (upRes.status >= 400 || (!upData?.url && !upData?.data)) throw new Error(`upload qiniu gagal: ${JSON.stringify(upData)}`)
  const fileKey = policy.key
  const sourceUrl = upData.url || upData.data

  // 4. meta_info
  const metaRes = await s.post(`${BASE_URL}/api/file/meta_info.json`, s.baseParams({ file_key: fileKey }).toString(), s.traceHeaders())
  if (metaRes.status >= 400 || metaRes.data?.code !== 0) throw new Error(`meta_info gagal: ${JSON.stringify(metaRes.data)}`)

  // 5. calc_need_beans
  const typeParams = JSON.stringify({ is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2" })
  const rightDetail = JSON.stringify({ source: "1", touch_type: "4", function_id: "630", material_id: "63011", url: "https://wink.ai/image-enhancer/upload" })
  const itemList = JSON.stringify([{ type: Number(TASK_TYPE), ext_value: EXT_VALUE, content_type: Number(CONTENT_TYPE), duration: 0, type_params: typeParams, right_detail: rightDetail }])
  const beansRes = await s.post(`${BASE_URL}/api/subscribe/batch_calc_need_beans.json`, s.baseParams({ item_list: itemList }).toString(), s.traceHeaders())
  if (beansRes.status >= 400 || beansRes.data?.code !== 0) throw new Error(`calc_need_beans gagal: ${JSON.stringify(beansRes.data)}`)

  // 6. delivery
  const deliveryBody = s.baseParams({
    type: TASK_TYPE,
    content_type: CONTENT_TYPE,
    source_url: sourceUrl,
    type_params: typeParams,
    right_detail: rightDetail,
    ext_params: JSON.stringify({ task_name: taskName, records: TASK_TYPE }),
    with_prepare: "1",
  })
  const delRes = await s.post(`${BASE_URL}/api/meitu_ai/delivery.json`, deliveryBody.toString(), s.traceHeaders())
  if (delRes.status >= 400 || delRes.data?.code !== 0) throw new Error(`delivery gagal: ${JSON.stringify(delRes.data)}`)
  const firstMsgId = delRes.data.data?.msg_id || delRes.data.data?.prepare_msg_id
  if (!firstMsgId) throw new Error(`delivery tidak mengembalikan msg_id: ${JSON.stringify(delRes.data.data)}`)

  // 7. polling
  let msgId = firstMsgId
  let last = null
  for (let i = 0; i < 80; i++) {
    const qRes = await s.get(
      `${BASE_URL}/api/meitu_ai/query_batch.json?${s.baseParams({ msg_ids: msgId })}`,
      { ...s.traceHeaders("%2F%3Alocale%2Feditor%2Frecent-task"), referer: `${BASE_URL}/image-enhancer/upload` }
    )
    if (qRes.status >= 400 || qRes.data?.code !== 0) throw new Error(`query_batch gagal: ${JSON.stringify(qRes.data)}`)
    const data = qRes.data.data
    last = data
    const item = data?.item_list?.[0]
    const result = item?.result || {}

    // chained msg_id: prepare → real task id
    const resultValue = result.result || ""
    const realMsgId = result.msg_id || item?.msg_id || ""
    let next = ""
    if (resultValue && resultValue !== msgId && !resultValue.startsWith("http")) next = resultValue
    else if (realMsgId && realMsgId !== msgId && !realMsgId.startsWith("wpr_")) next = realMsgId
    if (next) { msgId = next; await sleep(1000); continue }

    const url = result.media_info_list?.[0]?.media_data || ""
    const errorCode = result.error_code
    if (url.startsWith("http") && errorCode === 0) return { url, sourceUrl }
    if (errorCode && errorCode !== 29901 && errorCode !== 0) throw new Error(`task gagal: ${errorCode} ${result.error_msg || ""}`)
    await sleep(3000)
  }
  throw new Error(`timeout — result belum selesai: ${JSON.stringify(last)}`)
}

export default {
  route: {
    method: "get",
    path: "/tools/wink/enhancer",
    auth: false,
    tags: ["Tools"],
    summary: "Wink Enhancer — perjelas & upscale foto pakai AI (Ultra HD 4×)",
    description: "Tingkatkan kualitas dan resolusi foto menggunakan Wink AI (Meitu) mode Ultra HD. Hasil upscale ~4× tanpa login. Kirim URL gambar publik.",
    parameters: [
      {
        name: "url",
        in: "query",
        required: true,
        description: "URL gambar publik yang akan dienhance",
        schema: { type: "string", example: "https://example.com/photo.jpg" },
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
                result: { type: "string", description: "URL hasil enhance" },
                source: { type: "string", description: "URL gambar input di storage Wink" },
              },
            },
          },
        },
      },
      "400": { description: "Parameter tidak lengkap / URL tidak valid" },
      "500": { description: "Gagal memproses gambar" },
      "504": { description: "Timeout — server Wink lambat" },
    },
  },

  handler: async (req, res) => {
    const imageUrl = req.query.url?.trim()
    if (!imageUrl) return res.status(400).json({ ok: false, error: "Parameter 'url' wajib diisi" })

    try {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`Gagal unduh gambar (HTTP ${imgRes.status})`)
      const mime = imgRes.headers.get("content-type") || "image/jpeg"
      if (!/^image\//i.test(mime)) throw new Error(`URL bukan gambar (content-type: ${mime})`)
      const buffer = Buffer.from(await imgRes.arrayBuffer())

      let name = "photo"
      try { name = path.parse(new URL(imageUrl).pathname.split("/").pop() || "photo").name || "photo" } catch {}
      const taskName = `Enhancer-Ultra HD-${name}`

      const { url, sourceUrl } = await enhance({ buffer, mime, taskName })
      res.json({ ok: true, result: url, source: sourceUrl })
    } catch (e) {
      const code = /timeout/i.test(e.message) ? 504 : 500
      res.status(code).json({ ok: false, error: e.message })
    }
  },
}
