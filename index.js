import "dotenv/config"
import express from "express"
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const API_KEY = process.env.API_KEY
if (!API_KEY) {
    console.warn("[auth] Peringatan: API_KEY belum di-set. Endpoint dengan auth: true akan menolak semua request.")
}

function authGuard(req, res, next) {
    const key = req.headers["x-api-key"]
    if (!key || key !== API_KEY) {
        return res.status(401).json({ ok: false, error: "API key tidak valid" })
    }
    next()
}

function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...walkDir(full))
        else if (entry.name.endsWith(".js")) files.push(full)
    }
    return files
}

const features = []
for (const file of walkDir(path.join(__dirname, "fitur"))) {
    try {
        const { default: feature } = await import(pathToFileURL(file).href)
        if (feature?.route && typeof feature.handler === "function") {
            const { method, path: routePath, auth } = feature.route
            if (auth) {
                app[method](routePath, authGuard, feature.handler)
            } else {
                app[method](routePath, feature.handler)
            }
            features.push(feature)
        }
    } catch (e) {
        console.warn(`[warn] Gagal load ${file}:`, e.message)
    }
}
console.log(`[routes] ${features.length} endpoint loaded`)

function buildOpenAPI(req) {
    const paths = {}
    for (const { route } of features) {
        const { method, path: routePath, tags, summary, description, parameters, requestBody, responses, auth } = route
        if (!paths[routePath]) paths[routePath] = {}
        paths[routePath][method] = {
            tags, summary, description,
            ...(parameters && { parameters }),
            ...(requestBody && { requestBody }),
            responses,
            ...(auth && { security: [{ ApiKeyAuth: [] }] })
        }
    }
    return {
        openapi: "3.0.0",
        info: { title: "Kaminoa API", version: "1.0.0", description: "REST API collection by kamino" },
        servers: [{ url: `${req.protocol}://${req.get("host")}` }],
        components: {
            securitySchemes: {
                ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" }
            }
        },
        paths
    }
}

app.get("/openapi.json", (req, res) => res.json(buildOpenAPI(req)))
app.get("/docs", (req, res) => res.sendFile(path.join(__dirname, "public/docs.html")))
app.get("/", (req, res) => res.redirect("/docs"))

const PORT = process.env.PORT || 47291
app.listen(PORT, () => {
    console.log(`\nKaminoa API  →  http://localhost:${PORT}`)
    console.log(`Docs         →  http://localhost:${PORT}/docs\n`)
})
