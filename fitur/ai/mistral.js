import axios from "axios"
import crypto from "crypto"

const USER_AGENT = "le-chat-mobile/2.3.0 (build:20300173; os_name:ios; device_category:smartphone; device_model:iPhone 14 Pro; device_manufacturer:Apple)"

const BASE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en",
    "Accept": "*/*",
    "Content-Type": "application/json"
}

function parseCookies(arr) {
    return Object.fromEntries(
        (arr || []).map(c => {
            const [pair] = c.split(";")
            const i = pair.indexOf("=")
            return i < 0 ? [] : [pair.slice(0, i).trim(), pair.slice(i + 1).trim()]
        }).filter(e => e.length)
    )
}

function encodeSession(chatId, cookies) {
    return Buffer.from(JSON.stringify({ c: chatId, k: cookies })).toString("base64url")
}

function decodeSession(session) {
    try {
        const { c, k } = JSON.parse(Buffer.from(session, "base64url").toString("utf8"))
        if (c && typeof c === "string") return { chatId: c, cookies: typeof k === "string" ? k : "" }
    } catch {}
    return null
}

async function initSession() {
    const payload = {
        "0": { "json": { "name": "app_downloaded", "properties": {} } },
        "1": {
            "json": {
                "name": "app_started",
                "properties": {
                    "os": "iOS",
                    "osVersion": "17.4.1",
                    "deviceManufacturer": "Apple",
                    "screenWidth": 393,
                    "screenHeight": 852
                }
            }
        }
    }

    const response = await axios.post(
        "https://chat.mistral.ai/api/trpc/event.sendEventToDatalake,event.sendEventToDatalake?batch=1",
        payload,
        { headers: BASE_HEADERS }
    )

    const cookies = parseCookies(response.headers["set-cookie"])
    const cookieStore = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")

    await axios.post(
        "https://chat.mistral.ai/api/trpc/user.acceptToS?batch=1",
        { "0": { "json": {} } },
        { headers: { ...BASE_HEADERS, Cookie: cookieStore } }
    )

    return cookieStore
}

async function createNewChat(promptText, cookieStore) {
    const payload = {
        "0": {
            "json": {
                "content": [{ "type": "text", "text": promptText }],
                "transcriptionsMetadata": null,
                "incognito": null,
                "files": [],
                "agentId": null,
                "agentsApiAgentId": null,
                "features": ["beta-websearch"],
                "integrations": [],
                "libraries": [],
                "projectId": null,
                "productType": "chat",
                "chatId": null,
                "parentId": null,
                "parentVersion": null
            },
            "meta": {
                "values": {
                    "transcriptionsMetadata": ["undefined"],
                    "incognito": ["undefined"],
                    "agentId": ["undefined"],
                    "agentsApiAgentId": ["undefined"],
                    "projectId": ["undefined"],
                    "chatId": ["undefined"],
                    "parentId": ["undefined"],
                    "parentVersion": ["undefined"]
                },
                "v": 1
            }
        }
    }

    const response = await axios.post(
        "https://chat.mistral.ai/api/trpc/message.newChat?batch=1",
        payload,
        { headers: { ...BASE_HEADERS, Cookie: cookieStore } }
    )

    const chatId = response.data[0]?.result?.data?.json?.chatId
    if (!chatId) throw new Error("Gagal mengekstrak chatId dari server.")
    return chatId
}

async function sendEventToDatalake(chatId, messageId, promptLength, cookieStore) {
    const payload = {
        "0": {
            "json": {
                "name": "prompt_submitted",
                "properties": {
                    "chat_id": chatId,
                    "prompt_id": messageId,
                    "prompt_version": 0,
                    "prompt_chars_number": promptLength,
                    "model": null,
                    "file_count": 0
                }
            },
            "meta": {
                "values": { "properties.model": ["undefined"] },
                "v": 1
            }
        }
    }

    try {
        await axios.post(
            "https://chat.mistral.ai/api/trpc/event.sendEventToDatalake?batch=1",
            payload,
            { headers: { ...BASE_HEADERS, Cookie: cookieStore } }
        )
    } catch {
        // Non-critical
    }
}

function sendChatMessage(chatId, promptText, cookieStore, mode = "append", sseMessageId = null) {
    const hariIni = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    })

    const messageId = sseMessageId || crypto.randomUUID()

    const payload = {
        chatId,
        stableAnonymousIdentifier: crypto.randomUUID(),
        platform: "mobile",
        clientPromptData: {
            currentDate: hariIni,
            userTimezone: "T+00:00 (Asia/Makassar)"
        },
        shouldAwaitStreamBackgroundTasks: true,
        shouldUseMessagePatch: true,
        supportedTaskCallbacks: [
            "ask_user_question",
            "ask_user_confirmation",
            "collect_workflow_input",
            "delegate_workflow_execution",
            "enable_connector"
        ],
        features: ["beta-websearch"],
        integrations: [],
        libraries: [],
        mode,
        disabledFeatures: mode === "start" ? ["memory-inference"] : undefined,
        messageId: mode === "start" ? undefined : messageId,
        messageInput: mode === "start" ? undefined : [{ type: "text", text: promptText }],
        messageFiles: mode === "start" ? undefined : []
    }

    return new Promise(async (resolve, reject) => {
        try {
            await sendEventToDatalake(chatId, messageId, promptText.length, cookieStore)

            const response = await axios.post(
                "https://chat.mistral.ai/api/chat",
                payload,
                {
                    headers: {
                        ...BASE_HEADERS,
                        Cookie: cookieStore,
                        Accept: "text/event-stream"
                    },
                    responseType: "stream"
                }
            )

            let fullResponse = ""
            let buffer = ""

            response.data.on("data", chunk => {
                buffer += chunk.toString()
                const lines = buffer.split("\n")
                buffer = lines.pop()

                for (const line of lines) {
                    if (!line.trim()) continue
                    const match = line.match(/^\d+:(.*)/)
                    if (match) {
                        try {
                            const parsed = JSON.parse(match[1])
                            if (parsed.json && parsed.json.patches) {
                                for (const patch of parsed.json.patches) {
                                    let text = ""
                                    if (patch.op === "append" && patch.path.includes("/text")) {
                                        text = patch.value
                                    } else if (patch.op === "replace" && patch.path === "/contentChunks") {
                                        if (Array.isArray(patch.value) && patch.value.length > 0 && patch.value[0].text) {
                                            text = patch.value[0].text
                                        }
                                    }
                                    fullResponse += text
                                }
                            }
                        } catch {}
                    }
                }
            })

            response.data.on("end", () => resolve(fullResponse))
            response.data.on("error", reject)
        } catch (e) {
            reject(e)
        }
    })
}

export default {
    route: {
        method: "get",
        path: "/ai/mistral",
        auth: false,
        tags: ["AI"],
        summary: "Chat dengan Mistral AI",
        description: "Kirim prompt ke Mistral AI (le-chat) dan dapatkan respons teks. Support session untuk melanjutkan percakapan.",
        parameters: [
            {
                name: "prompt",
                in: "query",
                required: true,
                description: "Pesan atau pertanyaan yang dikirim ke Mistral AI",
                schema: { type: "string", example: "Apa itu artificial intelligence?" }
            },
            {
                name: "session",
                in: "query",
                required: false,
                description: "Token sesi dari respons sebelumnya untuk melanjutkan percakapan. Kosongkan untuk memulai chat baru.",
                schema: { type: "string" }
            }
        ],
        responses: {
            "200": {
                description: "Respons berhasil",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ok: { type: "boolean", example: true },
                                text: { type: "string" },
                                session: { type: "string", description: "Kirim balik nilai ini di parameter 'session' untuk melanjutkan percakapan" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Request tidak valid",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            },
            "500": {
                description: "Kesalahan server",
                content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, error: { type: "string" } } } } }
            }
        }
    },

    handler: async (req, res) => {
        const { prompt, session } = req.query
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ ok: false, error: "prompt wajib diisi" })
        }

        try {
            let chatId, cookieStore

            if (session) {
                const decoded = decodeSession(session)
                if (!decoded) {
                    return res.status(400).json({ ok: false, error: "session tidak valid atau rusak" })
                }
                chatId = decoded.chatId
                cookieStore = decoded.cookies
            } else {
                cookieStore = await initSession()
                chatId = await createNewChat(prompt.trim(), cookieStore)
                await sendChatMessage(chatId, prompt.trim(), cookieStore, "start")
            }

            const text = await sendChatMessage(chatId, prompt.trim(), cookieStore, "append")
            res.json({ ok: true, text, session: encodeSession(chatId, cookieStore) })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
