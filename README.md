# Kaminoa API

REST API collection dengan dokumentasi interaktif. Tambah endpoint baru cukup dengan membuat file baru di folder `fitur/` — server langsung mendeteksinya otomatis.

## Instalasi

```bash
npm install
npm start
```

Server berjalan di `http://localhost:3000`  
Dokumentasi di `http://localhost:3000/docs`

## Struktur Folder

```
kaminoa-api/
├── index.js          # Server utama (auto-discovery)
├── public/
│   └── docs.html     # UI dokumentasi interaktif
└── fitur/
    ├── ai/
    │   └── blackboxai.js
    └── tools/
        └── shorturl.js
```

## Menambah Endpoint Baru

Buat file `.js` di dalam `fitur/` sesuai kategori, lalu export `default` dengan format berikut:

```js
// fitur/kategori/namafitur.js

export default {
  route: {
    method: "get",           // get | post | put | patch | delete
    path: "/kategori/nama",
    tags: ["Kategori"],      // nama grup di sidebar docs
    summary: "Deskripsi singkat",
    description: "Deskripsi panjang (opsional)",

    // Untuk GET — gunakan parameters
    parameters: [
      {
        name: "input",
        in: "query",         // query | path | header
        required: true,
        description: "Keterangan parameter",
        schema: { type: "string", example: "contoh" }
      }
    ],

    // Untuk POST — gunakan requestBody
    // requestBody: {
    //   required: true,
    //   content: {
    //     "application/json": {
    //       schema: {
    //         type: "object",
    //         required: ["input"],
    //         properties: {
    //           input: { type: "string" }
    //         }
    //       }
    //     }
    //   }
    // },

    responses: {
      "200": {
        description: "Berhasil",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                result: { type: "string" }
              }
            }
          }
        }
      }
    }
  },

  handler: async (req, res) => {
    const { input } = req.query
    if (!input) return res.status(400).json({ ok: false, error: "input wajib diisi" })
    try {
      res.json({ ok: true, result: input })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  }
}
```

Setelah file dibuat, **restart server** — endpoint otomatis muncul di docs tanpa perlu mengubah file lain.

## Endpoint Tersedia

| Method | Path | Auth | Deskripsi |
|--------|------|------|-----------|
| GET | `/ai/blackbox` | ✓ | Chat dengan Blackbox AI |
| GET | `/tools/shorturl` | — | Persingkat URL (tinyurl, spoome) |

## API Key

Setiap endpoint bisa dikonfigurasi butuh API key atau tidak via field `auth`:

```js
route: {
  auth: true,   // wajib pakai x-api-key header
  // atau
  auth: false,  // bebas tanpa key
}
```

Set `API_KEY` di file `.env` sebelum menjalankan server. Jika tidak di-set, server tetap berjalan tapi semua endpoint dengan `auth: true` akan menolak semua request.

Request dengan auth:
```bash
curl "http://localhost:3000/endpoint" -H "x-api-key: your_key"
```

Di halaman docs, input API key muncul di header (hanya jika ada endpoint yang butuh auth).

## Konfigurasi

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `3000` | Port server |

Contoh `.env`:

```env
API_KEY=ganti_dengan_key_kamu
PORT=3000
```
