const TWEET_QUERY_HASH = "tmhPpO5sDermwYmq3h034A"
const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"

const URL_REGEX = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i

function tweetIdFromUrl(input) {
    const s = String(input || "").trim()
    if (/^\d{5,25}$/.test(s)) return s
    const m = s.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i)
    return m ? m[1] : null
}

function buildEndpoint(tweetId) {
    const variables = {
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false
    }
    const features = {
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_enhance_cards_enabled: false
    }
    const toggles = {
        withArticleRichContentState: true,
        withArticlePlainText: false
    }
    const qs = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
        fieldToggles: JSON.stringify(toggles)
    })
    return `https://api.x.com/graphql/${TWEET_QUERY_HASH}/TweetResultByRestId?${qs}`
}

function bestMp4(variants) {
    if (!Array.isArray(variants)) return null
    const mp4 = variants.filter(v => v.content_type === "video/mp4")
    mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
    return mp4[0] || variants[0] || null
}

function shapeMedia(rawMedia) {
    if (!Array.isArray(rawMedia)) return []
    return rawMedia.map(m => {
        const base = {
            id: m.id_str || null,
            type: m.type,
            width: m.original_info?.width || null,
            height: m.original_info?.height || null,
            preview: m.media_url_https || null
        }
        if (m.type === "photo") {
            const u = m.media_url_https || ""
            return {
                ...base,
                mime: "image/jpeg",
                download_url: u ? `${u}?name=orig` : null,
                small: u ? `${u}?name=small` : null,
                medium: u ? `${u}?name=medium` : null,
                large: u ? `${u}?name=large` : null
            }
        }
        if (m.type === "video" || m.type === "animated_gif") {
            const variants = m.video_info?.variants || []
            const best = bestMp4(variants)
            return {
                ...base,
                mime: best?.content_type || "video/mp4",
                bitrate: best?.bitrate || null,
                duration_ms: m.video_info?.duration_millis || null,
                aspect_ratio: m.video_info?.aspect_ratio || null,
                thumbnail: m.media_url_https || null,
                download_url: best?.url || null,
                hls: variants.find(v => v.content_type === "application/x-mpegURL")?.url || null,
                variants: variants
                    .filter(v => v.content_type === "video/mp4")
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
                    .map(v => ({ url: v.url, bitrate: v.bitrate || 0, content_type: v.content_type }))
            }
        }
        return { ...base, mime: "application/octet-stream", download_url: m.media_url_https || null }
    })
}

function shapeAuthor(userResult) {
    if (!userResult) return null
    const core = userResult.core || {}
    const legacy = userResult.legacy || {}
    const avatar = userResult.avatar?.image_url || legacy.profile_image_url_https || null
    return {
        id: userResult.rest_id || null,
        username: core.screen_name || legacy.screen_name || null,
        name: core.name || legacy.name || "",
        avatar: avatar ? avatar.replace("_normal.", "_400x400.") : null,
        banner: legacy.profile_banner_url || null,
        bio: legacy.description || "",
        verified: !!userResult.is_blue_verified || !!userResult.verification?.verified || !!legacy.verified,
        protected: !!legacy.protected,
        followers: Number(legacy.followers_count) || 0,
        following: Number(legacy.friends_count) || 0,
        tweets: Number(legacy.statuses_count) || 0,
        location: legacy.location || null,
        joined: legacy.created_at || null,
        url: legacy.entities?.url?.urls?.[0]?.expanded_url || null
    }
}

function shapeStats(legacy, result) {
    return {
        likes: Number(legacy?.favorite_count) || 0,
        retweets: Number(legacy?.retweet_count) || 0,
        replies: Number(legacy?.reply_count) || 0,
        quotes: Number(legacy?.quote_count) || 0,
        bookmarks: Number(legacy?.bookmark_count) || 0,
        views: Number(result?.views?.count) || 0
    }
}

function shapeEntities(legacy) {
    const ent = legacy?.entities || {}
    return {
        hashtags: (ent.hashtags || []).map(h => h.text),
        mentions: (ent.user_mentions || []).map(u => ({ username: u.screen_name, name: u.name, id: u.id_str })),
        urls: (ent.urls || []).map(u => ({ short: u.url, expanded: u.expanded_url, display: u.display_url })),
        symbols: (ent.symbols || []).map(s => s.text)
    }
}

function shapeTweet(result, requestedUrl) {
    if (!result) return null
    const inner = result.tweet || result
    const legacy = inner.legacy
    if (!legacy) return null

    const user = inner.core?.user_results?.result
    const quoted = inner.quoted_status_result?.result
    const card = inner.card?.legacy
    const noteTweet = inner.note_tweet?.note_tweet_results?.result
    const fullText = noteTweet?.text || legacy.full_text || ""

    return {
        id: inner.rest_id || result.rest_id,
        url: requestedUrl,
        created_at: legacy.created_at || null,
        text: fullText,
        lang: legacy.lang || null,
        source: inner.source ? inner.source.replace(/<[^>]+>/g, "") : null,
        is_reply: !!legacy.in_reply_to_status_id_str,
        reply_to: legacy.in_reply_to_status_id_str ? {
            tweet_id: legacy.in_reply_to_status_id_str,
            username: legacy.in_reply_to_screen_name || null
        } : null,
        is_quote: !!quoted,
        quoted: quoted ? shapeTweet(quoted, null) : null,
        author: shapeAuthor(user),
        stats: shapeStats(legacy, inner),
        media: shapeMedia(legacy.extended_entities?.media),
        entities: shapeEntities(legacy),
        card: card ? { name: card.name || null, url: card.url || null } : null,
        sensitive: !!legacy.possibly_sensitive
    }
}

async function xTweet(input) {
    const id = tweetIdFromUrl(input)
    if (!id) throw new Error("Invalid X/Twitter URL — must contain /status/<id>")

    const res = await fetch(buildEndpoint(id), {
        headers: {
            authorization: `Bearer ${BEARER}`,
            "content-type": "application/json",
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            origin: "https://x.com",
            referer: "https://x.com/",
            "user-agent": UA
        }
    })

    if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`X returned HTTP ${res.status}${body ? " :: " + body.slice(0, 180) : ""}`)
    }

    const data = await res.json()
    const result = data?.data?.tweetResult?.result

    if (!result || Object.keys(result).length === 0) {
        throw new Error("Tweet not found or unavailable (deleted, private, or region-locked)")
    }
    if (result.__typename === "TweetUnavailable") {
        throw new Error(`Tweet unavailable: ${result.reason || "unknown"}`)
    }
    if (result.__typename === "TweetTombstone") {
        throw new Error("Tweet was removed")
    }

    return shapeTweet(result, typeof input === "string" ? input : `https://x.com/i/status/${id}`)
}

export default {
    route: {
        method: "get",
        path: "/downloader/x2",
        auth: false,
        tags: ["Downloader"],
        summary: "Download video/media dari Twitter/X (GraphQL)",
        description: "Mengambil data tweet lengkap termasuk media, author, stats, dan entities langsung dari X GraphQL API tanpa pihak ketiga.",
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
            const result = await xTweet(url)
            res.json({ ok: true, result })
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message })
        }
    }
}
