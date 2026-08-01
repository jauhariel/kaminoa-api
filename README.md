# Kaminoa API

REST API collection dengan dokumentasi interaktif. Tambah endpoint baru cukup dengan membuat file baru di folder `fitur/` — server langsung mendeteksinya otomatis.

## Instalasi

```bash
npm install
npm start
```

Server berjalan di `http://localhost:47291`  
Dokumentasi di `http://localhost:47291/docs`

## Struktur Folder

```
kaminoa-api/
├── index.js          # Server utama (auto-discovery)
├── public/
│   └── docs.html     # UI dokumentasi interaktif
└── fitur/
    ├── ai/
    │   └── blackboxai.js
    ├── tools/
    │   └── shorturl.js
    └── (tambah folder/file baru sesuai kategori)
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
curl "http://localhost:47291/endpoint" -H "x-api-key: your_key"
```

Di halaman docs, input API key muncul di header (hanya jika ada endpoint yang butuh auth).

## Login (Google) & API Key per User

Kalau kredensial Google diisi, server berjalan dalam **mode login**:

- Semua **halaman** (docs, dashboard) **wajib login** via Google.
- Setiap user yang login otomatis dibuatkan akun + **API key pribadi** (lihat di `/dashboard`).
- Semua **endpoint API wajib** pakai API key pribadi via header `x-api-key` — session login tidak berlaku untuk hit API.
- Pemakaian tiap key dibatasi kuota harian sesuai **plan**-nya.

Setup:

1. Buat OAuth client di [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (tipe *Web application*), lalu tambahkan *Authorized redirect URI*:
   `http://localhost:47291/auth/google/callback` (plus URL production kamu).
2. Isi kredensialnya di `.env`:

```env
SESSION_SECRET=hasil_openssl_rand_hex_32
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# Opsional — batasi akun yang boleh masuk (kosongkan = semua akun Google bisa login)
ALLOWED_USERS=kamu@gmail.com
```

Kalau kredensial kosong, login **nonaktif** dan server berperilaku seperti mode lama (endpoint `auth: true` pakai master `API_KEY`).

### Plan & kuota

| Plan | Kuota default | Env override |
|------|---------------|--------------|
| `free` (default user baru) | 100 req/hari | `FREE_DAILY_LIMIT` |
| `pro` | 50.000 req/hari (Rp10rb/bulan) | `PRO_DAILY_LIMIT` |

Kuota reset otomatis tiap jam 00:00. Respons API menyertakan header `X-RateLimit-Limit`, `X-RateLimit-Remaining`, dan `X-RateLimit-Reset`. Kalau kuota habis → HTTP `429`.

Upgrade plan user secara manual pakai master `API_KEY`:

```bash
curl -X POST http://localhost:47291/admin/plan \
  -H "x-api-key: MASTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@gmail.com","plan":"pro"}'
```

Plan yang di-set admin bersifat **tanpa kedaluwarsa** (beda dengan hasil pembayaran yang 30 hari).

### Halaman Admin (`/admin`)

Login Google dengan email yang terdaftar di `ADMIN_USERS`, lalu buka `/admin`. Isinya:

- Statistik: total user, user pro, request hari ini
- **Admin keys** — buat key khusus **unlimited** (tidak kena kuota), bisa diberi label & dicabut kapan saja
- Daftar semua user: plan, pemakaian hari ini, API key-nya, plus tombol ubah plan

Semua endpoint admin juga bisa diakses via master `API_KEY` (header `x-api-key`) untuk otomasi:
`GET /admin/overview` · `GET /admin/users` · `POST /admin/plan` · `GET/POST/DELETE /admin/keys`

### Pembayaran otomatis (MustikaPay)

User bisa upgrade ke Pro sendiri dari `/dashboard` — bayar via QRIS, plan aktif otomatis setelah lunas (berlaku `PRO_DURATION_DAYS` hari, lalu turun ke Free lagi).

Setup:

1. Isi `MUSTIKA_API_KEY` di `.env` (dari [dashboard MustikaPay](https://mustikapayment.com)).
2. Set **Webhook URL** di Profile Dashboard MustikaPay: `https://domainkamu/pay/webhook`
   (opsional tapi disarankan — tanpa webhook, upgrade tetap jalan via auto-poll dari dashboard).

Alurnya: dashboard bikin tagihan QRIS (`POST /pay/create`) → user scan → server verifikasi ke MustikaPay (`/pay/status/:ref` dipoll, plus webhook `/pay/webhook`) → plan otomatis jadi `pro`. Data tagihan tersimpan di `.payments.json`.

Catatan:
- Dashboard user (`/dashboard`): lihat profil, plan, sisa kuota, salin & regenerate API key.
- Master `API_KEY` di `.env` bersifat **tanpa limit** — simpan baik-baik, jangan dibagikan.
- Data user, kuota, admin keys & pembayaran tersimpan di `data/data.sqlite` (SQLite bawaan Node via `node:sqlite`, tanpa dependency tambahan). Jangan di-commit.
- Semua runtime state ada di folder `data/` — untuk backup cukup salin folder `data/` + file `.env`.
- Migrasi dari format lama: kalau sebelumnya pakai `.users.json` / `.payments.json`, isinya otomatis diimpor ke SQLite saat pertama jalan (file lama disimpan sebagai `*.json.bak`).
- Logout lewat tombol di pojok kanan atas docs, atau buka `/auth/logout`.
- Sesi tersimpan di `data/sessions.json` (tahan restart) dan berlaku 7 hari.

## Konfigurasi

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `47291` | Port server |
| `API_KEY` | — | Master key admin (tanpa limit, untuk `/admin/plan`) |
| `SESSION_SECRET` | acak | Secret cookie session (isi untuk production) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | OAuth Google (aktifkan mode login) |
| `FREE_DAILY_LIMIT` | `100` | Kuota harian plan free |
| `PRO_DAILY_LIMIT` | `50000` | Kuota harian plan pro |
| `MUSTIKA_API_KEY` | — | API key MustikaPay (aktifkan pembayaran) |
| `PRO_PRICE` | `10000` | Harga upgrade Pro (IDR) |
| `PRO_DURATION_DAYS` | `30` | Masa aktif Pro hasil pembayaran |
| `ALLOWED_USERS` | semua boleh | Whitelist akun: email Google / `google:ID` |
| `ADMIN_USERS` | — | Email admin halaman `/admin` (pisahkan koma) |

Contoh `.env`:

```env
API_KEY=ganti_dengan_key_kamu
PORT=47291
```
