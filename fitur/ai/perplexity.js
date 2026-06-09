// credits @Raflix
import crypto from "crypto"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0"

async function bootstrap() {
    const visitorId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const edgeVid = crypto.randomUUID()
    const edgeSid = crypto.randomUUID()

    const captured = []
    try {
        const res = await fetch("https://www.perplexity.ai/", {
            headers: {
                "user-agent": UA,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.9",
                "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "upgrade-insecure-requests": "1"
            },
            redirect: "follow"
        })
        const setCookies = res.headers.getSetCookie?.() || []
        for (const c of setCookies) captured.push(c.split(";")[0])
    } catch {}

    const cookieParts = [
        `pplx.visitor-id=${visitorId}`,
        `pplx.session-id=${sessionId}`,
        `pplx.edge-vid=${edgeVid}`,
        `pplx.edge-sid=${edgeSid}`,
        "pplx.trackingAllowed=true",
        ...captured
    ]
    return { visitorId, sessionId, cookie: cookieParts.join("; ") }
}

async function readSSE(stream) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let lastChunk = null

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() || ""

        for (const ev of events) {
            if (!ev.trim()) continue
            let dataStr = ""
            for (const ln of ev.split(/\r?\n/)) {
                if (ln.startsWith("data: ")) dataStr += ln.slice(6)
                else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim()
            }
            if (!dataStr || dataStr === "{}") continue
            try {
                const obj = JSON.parse(dataStr)
                if (obj && typeof obj === "object" && Object.keys(obj).length > 0) lastChunk = obj
            } catch {}
        }
    }
    return lastChunk
}

function extractAnswer(chunk) {
    if (!chunk?.text) return ""
    let steps
    try { steps = JSON.parse(chunk.text) } catch { return "" }
    if (!Array.isArray(steps)) return ""
    const finalStep = steps.find(s => s.step_type === "FINAL")
    if (!finalStep?.content?.answer) return ""
    try {
        const inner = JSON.parse(finalStep.content.answer)
        return inner.answer || ""
    } catch { return "" }
}

function extractMedia(chunk) {
    if (!chunk?.blocks || !Array.isArray(chunk.blocks)) return []
    const media = []
    for (const block of chunk.blocks) {
        const items = block?.media_items_block?.media_items
        if (Array.isArray(items)) {
            for (const it of items) {
                media.push({
                    title: it.title || it.name || "",
                    url: it.medium_url || it.url || it.image_url || it.image || "",
                    thumbnail: it.thumbnail || it.thumb_url || it.thumb || null,
                    source: it.source || it.source_url || null,
                    domain: it.domain || null
                })
            }
        }
        const images = block?.inline_images_block?.images
        if (Array.isArray(images)) {
            for (const img of images) {
                media.push({
                    title: img.title || "",
                    url: img.image_url || img.url || "",
                    thumbnail: img.thumbnail || null,
                    source: img.source_url || null
                })
            }
        }
    }
    return media.filter(m => m.url)
}

function cleanSources(arr) {
    if (!Array.isArray(arr)) return []
    return arr.map(s => ({
        title: s.name || s.title || "",
        url: s.url || s.link || "",
        snippet: s.snippet || s.description || "",
        domain: (() => { try { return new URL(s.url).hostname.replace(/^www\./, "") } catch { return null } })(),
        publishedAt: s.publish_date || s.timestamp || null
    })).filter(s => s.url)
}

const MODES = ["concise", "copilot", "auto"]
const MODELS = ["turbo", "claude-3-5-sonnet", "sonar-pro", "gpt-4.1"]
const FOCUSES = ["internet", "scholar", "writing", "wolfram", "youtube", "reddit"]

async function perplexitySearch(query, options = {}) {
    const { mode = "concise", model = "turbo", focus = "internet", retries = 1 } = options
    const q = String(query).trim()

    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt++) {
        const session = await bootstrap()
        const payload = {
            params: {
                attachments: [],
                language: "en-US",
                timezone: "UTC",
                search_focus: focus,
                sources: ["web"],
                frontend_uuid: crypto.randomUUID(),
                mode,
                model_preference: model,
                is_related_query: false,
                is_sponsored: false,
                frontend_context_uuid: crypto.randomUUID(),
                prompt_source: "user",
                query_source: "home",
                is_incognito: false,
                time_from_first_type: 3000 + Math.floor(Math.random() * 4000),
                local_search_enabled: false,
                use_schematized_api: true,
                send_back_text_in_streaming_api: false,
                supported_block_use_cases: [
                    "answer_modes", "media_items", "knowledge_cards", "inline_entity_cards",
                    "place_widgets", "finance_widgets", "news_widgets", "shopping_widgets",
                    "search_result_widgets", "inline_images", "inline_assets", "placeholder_cards",
                    "diff_blocks", "inline_knowledge_cards", "entity_group_v2", "refinement_filters",
                    "answer_tabs", "preserve_latex", "in_context_suggestions",
                    "pending_followups", "inline_claims", "unified_assets"
                ],
                client_coordinates: null,
                mentions: [],
                dsl_query: q,
                skip_search_enabled: true,
                is_nav_suggestions_disabled: false,
                source: "default",
                always_search_override: false,
                override_no_search: false,
                client_search_results_cache_key: crypto.randomUUID(),
                should_ask_for_mcp_tool_confirmation: true,
                browser_agent_allow_once_from_toggle: false,
                force_enable_browser_agent: false,
                supported_features: ["browser_agent_permission_banner_v1.1"],
                extended_context: false,
                version: "2.18",
                rum_session_id: crypto.randomUUID()
            },
            query_str: q
        }

        const res = await fetch("https://www.perplexity.ai/rest/sse/perplexity_ask", {
            method: "POST",
            headers: {
                "accept": "text/event-stream",
                "accept-language": "en-US,en;q=0.9",
                "cache-control": "no-cache",
                "content-type": "application/json",
                "cookie": session.cookie,
                "origin": "https://www.perplexity.ai",
                "pragma": "no-cache",
                "referer": "https://www.perplexity.ai/",
                "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "user-agent": UA,
                "x-perplexity-request-endpoint": "https://www.perplexity.ai/rest/sse/perplexity_ask",
                "x-perplexity-request-reason": "ask-query-state-provider",
                "x-perplexity-request-try-number": String(attempt + 1),
                "x-request-id": crypto.randomUUID()
            },
            body: JSON.stringify(payload)
        })

        if (!res.ok) {
            lastError = `HTTP ${res.status}`
            continue
        }

        const lastChunk = await readSSE(res.body)
        if (!lastChunk) { lastError = "empty SSE stream"; continue }

        const answer = extractAnswer(lastChunk)
        if (!answer && attempt < retries) { lastError = "no answer in final chunk"; continue }

        return {
            query: q,
            mode,
            model,
            focus,
            answer: answer.replace(/【\d+†[^】]*】/g, "").trim(),
            sources: cleanSources(lastChunk.sources),
            media: extractMedia(lastChunk),
            related: lastChunk.related_queries || [],
            threadUrl: lastChunk.thread_url_slug
                ? `https://www.perplexity.ai/search/${lastChunk.thread_url_slug}`
                : null
        }
    }

    throw new Error(lastError || "unknown error")
}

export default {
    route: {
        method: "get",
        path: "/ai/perplexity",
        auth: false,
        tags: ["AI"],
        summary: "Perplexity AI Search",
        description: "Cari dan tanya jawab menggunakan Perplexity AI.",
        parameters: [
            {
                name: "query",
                in: "query",
                required: true,
                description: "Pertanyaan atau query pencarian",
                schema: { type: "string", example: "siapa presiden indonesia sekarang?" }
            },
            {
                name: "mode",
                in: "query",
                required: false,
                description: "Mode jawaban",
                schema: { type: "string", enum: MODES, default: "concise" }
            },
            {
                name: "model",
                in: "query",
                required: false,
                description: "Model AI yang digunakan",
                schema: { type: "string", enum: MODELS, default: "turbo" }
            },
            {
                name: "focus",
                in: "query",
                required: false,
                description: "Fokus pencarian",
                schema: { type: "string", enum: FOCUSES, default: "internet" }
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
                                answer: { type: "string" },
                                sources: { type: "array" },
                                media: { type: "array" },
                                related: { type: "array" },
                                threadUrl: { type: "string" }
                            }
                        }
                    }
                }
            },
            "400": { description: "Parameter tidak lengkap" },
            "500": { description: "Gagal memproses permintaan" }
        }
    },

    handler: async (req, res) => {
        const { query, mode = "concise", model = "turbo", focus = "internet" } = req.query
        if (!query?.trim()) return res.status(400).json({ ok: false, error: "query wajib diisi" })
        if (!MODES.includes(mode)) return res.status(400).json({ ok: false, error: `mode tidak valid, pilih: ${MODES.join(", ")}` })
        if (!MODELS.includes(model)) return res.status(400).json({ ok: false, error: `model tidak valid, pilih: ${MODELS.join(", ")}` })
        if (!FOCUSES.includes(focus)) return res.status(400).json({ ok: false, error: `focus tidak valid, pilih: ${FOCUSES.join(", ")}` })
        try {
            const result = await perplexitySearch(query.trim(), { mode, model, focus })
            res.json({ ok: true, ...result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
