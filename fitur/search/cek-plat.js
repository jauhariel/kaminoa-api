const WILAYAH = {
    'A': { provinsi: 'BANTEN', kabupaten: 'Serang, Cilegon, Tangerang' },
    'B': { provinsi: 'DKI JAKARTA', kabupaten: 'Jakarta, Bekasi, Depok, Tangerang, Tangerang Selatan' },
    'D': { provinsi: 'JAWA BARAT', kabupaten: 'Bandung, Cimahi, Sumedang' },
    'E': { provinsi: 'JAWA BARAT', kabupaten: 'Cirebon, Indramayu, Majalengka, Kuningan' },
    'F': { provinsi: 'JAWA BARAT', kabupaten: 'Bogor, Sukabumi, Cianjur' },
    'G': { provinsi: 'JAWA TENGAH', kabupaten: 'Pekalongan, Pemalang, Batang' },
    'H': { provinsi: 'JAWA TENGAH', kabupaten: 'Semarang, Kendal, Demak' },
    'K': { provinsi: 'JAWA TENGAH', kabupaten: 'Kudus, Jepara, Pati, Rembang' },
    'L': { provinsi: 'JAWA TIMUR', kabupaten: 'Surabaya, Sidoarjo, Gresik' },
    'M': { provinsi: 'JAWA TIMUR', kabupaten: 'Madura, Bangkalan, Sampang, Pamekasan, Sumenep' },
    'N': { provinsi: 'JAWA TIMUR', kabupaten: 'Malang, Batu, Pasuruan, Probolinggo' },
    'P': { provinsi: 'JAWA TIMUR', kabupaten: 'Jember, Banyuwangi, Bondowoso, Situbondo' },
    'R': { provinsi: 'JAWA TENGAH', kabupaten: 'Banyumas, Cilacap, Purbalingga, Banjarnegara' },
    'S': { provinsi: 'JAWA TIMUR', kabupaten: 'Bojonegoro, Tuban, Lamongan' },
    'T': { provinsi: 'JAWA BARAT', kabupaten: 'Purwakarta, Subang, Karawang' },
    'W': { provinsi: 'JAWA TIMUR', kabupaten: 'Madiun, Ngawi, Magetan, Ponorogo, Pacitan' },
    'Y': { provinsi: 'JAWA TENGAH', kabupaten: 'Yogyakarta, Sleman, Bantul, Gunung Kidul, Kulon Progo' },
    'Z': { provinsi: 'JAWA BARAT', kabupaten: 'Garut, Tasikmalaya, Ciamis, Pangandaran' },
    'AB': { provinsi: 'SUMATERA BARAT', kabupaten: 'Padang, Bukittinggi, Payakumbuh' },
    'AD': { provinsi: 'SUMATERA BARAT', kabupaten: 'Solok, Sawahlunto, Sijunjung' },
    'BA': { provinsi: 'SUMATERA BARAT', kabupaten: 'Padang Pariaman' },
    'BB': { provinsi: 'SUMATERA UTARA', kabupaten: 'Medan, Deli Serdang, Binjai' },
    'BD': { provinsi: 'SUMATERA UTARA', kabupaten: 'Tanjung Balai, Asahan, Labuhanbatu' },
    'BE': { provinsi: 'SUMATERA UTARA', kabupaten: 'Lubuk Pakam, Pematang Siantar, Simalungun' },
    'BG': { provinsi: 'SUMATERA UTARA', kabupaten: 'Kisaran, Batubara, Tanjung Balai' },
    'BH': { provinsi: 'SUMATERA UTARA', kabupaten: 'Tebing Tinggi, Serdang Bedagai' },
    'BK': { provinsi: 'SUMATERA UTARA', kabupaten: 'Dairi, Karo, Pakpak Bharat' },
    'BL': { provinsi: 'ACEH', kabupaten: 'Banda Aceh, Aceh Besar, Pidie, Bireuen' },
    'BM': { provinsi: 'SUMATERA UTARA', kabupaten: 'Nias, Gunungsitoli' },
    'BN': { provinsi: 'SUMATERA UTARA', kabupaten: 'Tapanuli Tengah, Sibolga' },
    'BP': { provinsi: 'KEPULAUAN RIAU', kabupaten: 'Batam, Tanjungpinang, Bintan' },
    'BT': { provinsi: 'SUMATERA UTARA', kabupaten: 'Tapanuli Utara, Toba, Humbang Hasundutan' },
    'DA': { provinsi: 'KALIMANTAN SELATAN', kabupaten: 'Banjarmasin, Banjarbaru' },
    'DB': { provinsi: 'SULAWESI UTARA', kabupaten: 'Manado, Bitung, Minahasa' },
    'DC': { provinsi: 'SULAWESI BARAT', kabupaten: 'Mamuju, Polewali Mandar' },
    'DD': { provinsi: 'SULAWESI SELATAN', kabupaten: 'Makassar, Gowa, Maros, Pangkep' },
    'DE': { provinsi: 'MALUKU', kabupaten: 'Ambon, Maluku Tengah' },
    'DG': { provinsi: 'MALUKU UTARA', kabupaten: 'Ternate, Tidore, Halmahera' },
    'DH': { provinsi: 'NUSA TENGGARA TIMUR', kabupaten: 'Kupang, Timor Tengah' },
    'DK': { provinsi: 'BALI', kabupaten: 'Denpasar, Badung, Gianyar' },
    'DL': { provinsi: 'SULAWESI UTARA', kabupaten: 'Kotamobagu, Bolaang Mongondow' },
    'DM': { provinsi: 'GORONTALO', kabupaten: 'Gorontalo, Bone Bolango' },
    'DN': { provinsi: 'SULAWESI TENGAH', kabupaten: 'Palu, Donggala, Parigi Moutong' },
    'DP': { provinsi: 'SULAWESI TENGGARA', kabupaten: 'Kendari, Konawe, Kolaka' },
    'DR': { provinsi: 'NUSA TENGGARA BARAT', kabupaten: 'Mataram, Lombok Timur, Lombok Barat' },
    'DS': { provinsi: 'PAPUA', kabupaten: 'Jayapura, Biak, Merauke' },
    'DT': { provinsi: 'PAPUA BARAT', kabupaten: 'Manokwari, Sorong, Fakfak' },
    'DW': { provinsi: 'SULAWESI TENGGARA', kabupaten: 'Buton, Muna, Wakatobi' },
}

function parsePlate(plate) {
    plate = (plate || '').toString().trim().toUpperCase().replace(/\s+/g, ' ')
    const parts = plate.split(' ')

    if (parts.length < 2) return { error: 'Format plat tidak valid', status: 400 }

    const prefix = parts[0]
    if (!/^[A-Z]{1,2}$/.test(prefix)) return { error: 'Kode daerah tidak valid', status: 400 }

    const number = parts[1]
    if (!/^\d+$/.test(number)) return { error: 'Nomor plat harus angka', status: 400 }

    let suffix = ''
    if (parts.length > 2) {
        suffix = parts[2]
        if (!/^[A-Z]{1,3}$/.test(suffix)) suffix = ''
    }

    const wilayah = WILAYAH[prefix]
    if (!wilayah) return { error: `Kode daerah ${prefix} tidak dikenali`, status: 404 }

    let vehicleType = 'Kendaraan Pribadi'
    if (['RI', 'CD', 'RF'].includes(prefix)) vehicleType = 'Kendaraan Dinas Pemerintah'
    else if (['CC', 'CD', 'CE'].includes(prefix)) vehicleType = 'Kendaraan Diplomatik'
    else if (['RF', 'RG'].includes(prefix)) vehicleType = 'Kendaraan Angkutan Umum'

    return {
        result: {
            raw: plate,
            prefix,
            number,
            suffix,
            province: wilayah.provinsi,
            region: wilayah.kabupaten,
            type: vehicleType,
            is_valid: true,
        },
    }
}

export default {
    route: {
        method: "get",
        path: "/search/cek-plat",
        auth: false,
        tags: ["Search"],
        summary: "Cek informasi plat nomor kendaraan Indonesia",
        description: "Memparse plat nomor Indonesia dan mengembalikan provinsi, kabupaten, serta jenis kendaraan berdasarkan kode daerah prefix plat.",
        parameters: [
            {
                name: "plate",
                in: "query",
                required: true,
                description: "Plat nomor kendaraan (contoh: B 1234 ABC)",
                schema: { type: "string", example: "B 1234 ABC" }
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
            "400": { description: "Format plat tidak valid" },
            "404": { description: "Kode daerah tidak dikenali" },
            "500": { description: "Kesalahan server" }
        }
    },

    handler: async (req, res) => {
        const plate = req.query.plate?.toString().trim()
        if (!plate) return res.status(400).json({ ok: false, error: 'Isi parameter "plate"' })

        const { result, error, status = 500 } = parsePlate(plate)
        if (error) return res.status(status).json({ ok: false, error, plate })

        res.json({ ok: true, result })
    }
}
