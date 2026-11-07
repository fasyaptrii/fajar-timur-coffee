# Sistem Pemesanan Makanan Berbasis Kode QR — Fajar Timur Coffee

Pelanggan scan QR di meja → menu terbuka dengan nomor meja terisi otomatis → pesan & bayar (QRIS/tunai) → kasir menerima pesanan real-time. Owner melihat laporan dan prediksi penjualan, admin mengelola menu, meja/QR, dan pengguna.

**Stack:** HTML/CSS/JS · Node.js + Express + Socket.io · MySQL · QRIS (Midtrans) · analitik SQL.

## Akun contoh (ganti setelah login pertama)
| Peran | Username | Password | Dashboard |
|---|---|---|---|
| Owner | `owner` | `Owner#2026` | `/owner` |
| Admin | `admin` | `Admin#2026` | `/admin` |
| Kasir | `kasir` | `Kasir#2026` | `/kasir` |

Login di `/login.html`; setelah masuk otomatis diarahkan sesuai peran. Password awal bisa diganti lewat env `OWNER_PASSWORD`, `ADMIN_PASSWORD`, `KASIR_PASSWORD` **sebelum** boot pertama. Admin dapat mereset password Admin/Kasir di menu Pengguna.

## Menjalankan lokal
1. Buat database kosong MySQL (`CREATE DATABASE fajar_timur;`).
2. `cp .env.example .env` lalu isi `MYSQL_URL`.
3. `npm install && npm start` → buka http://localhost:3000/login.html
Saat boot pertama aplikasi otomatis membuat tabel, 3 akun, menu (sesuai daftar kafe), **Meja 1–12**, dan ±1.000 transaksi contoh 60 hari (matikan dengan `SEED_DEMO=false`).
Untuk mencoba QR di ponsel, set `BASE_URL` ke alamat yang bisa diakses ponsel (mis. `http://192.168.1.10:3000`).

## Deploy ke Railway
1. Push folder ini ke GitHub → Railway **New Project → Deploy from GitHub**.
2. Tambah plugin **MySQL** di project yang sama. Di service aplikasi, tambah variabel: `MYSQL_URL` = `${{MySQL.MYSQL_URL}}`.
3. Variabel lain: `NODE_ENV=production`, `BASE_URL=https://<domain-railway-anda>` (wajib agar isi QR benar), `SESSION_HOURS=8`, `TZ_OFFSET=+09:00`.
4. Pembayaran: lihat bagian QRIS. Tanpa kunci Midtrans, set `SIMULATE_PAYMENT=true` untuk demo.
5. Generate domain di Settings → Networking. Cetak QR dari dashboard Admin **setelah** `BASE_URL` benar.
Backup: aktifkan backup volume MySQL di Railway atau jalankan `mysqldump` terjadwal.

## QRIS (Midtrans)
Isi `MIDTRANS_SERVER_KEY` (kunci tetap di server). Di dashboard Midtrans set *Payment Notification URL* ke `https://<domain>/api/payments/notification`. Notifikasi diverifikasi dengan signature SHA-512; hanya yang valid mengubah status menjadi lunas dan layar pelanggan ter-update via Socket.io. Untuk produksi ganti `MIDTRANS_BASE_URL` ke `https://api.midtrans.com`. Tanpa kunci → mode simulasi (tombol "Simulasikan pembayaran").

## Fitur per peran
- **Pelanggan** (tanpa login): menu per kategori, keranjang + catatan, rekomendasi "sering dipesan bersamaan", bayar QRIS/tunai, status real-time, invoice digital setelah lunas.
- **Kasir:** papan pesanan real-time (bunyi notifikasi), Terima → Proses → Selesai, konfirmasi tunai, batalkan, invoice.
- **Admin:** CRUD menu & kategori, CRUD meja + QR (lihat, unduh PNG, cetak satu/semua), kelola akun Admin/Kasir.
- **Owner:** laporan per periode (pendapatan, menu terlaris, jam ramai, metode bayar), prediksi 7 hari + rekomendasi stok, riwayat transaksi.

## Fitur AI (analitik berbasis data MySQL)
- **Rekomendasi Menu (DSS):** *market-basket* — menghitung berapa kali menu lain muncul di pesanan yang sama dengan menu di keranjang; jika data kurang, dilengkapi menu terlaris.
- **Prediksi Penjualan (ESS):** rata-rata pendapatan per hari-dalam-minggu (56 hari) × faktor tren 14 hari (dibatasi ±30%); kebutuhan stok = rata-rata porsi 28 hari × 7 × tren × 1,1.

## Keamanan
Password di-hash bcrypt · sesi di tabel `sessions` (token acak, hanya hash SHA-256 yang disimpan, cookie HttpOnly+SameSite, kedaluwarsa otomatis, logout menghapus sesi) · RBAC di server pada setiap API dan halaman dashboard · query berparameter (anti SQL Injection) · harga selalu dihitung ulang di server · helmet + CSP · rate limit login & pemesanan · escape HTML di semua tampilan · signature webhook diverifikasi · kunci gateway hanya di server.

## Struktur
`server.js` (API, auth, Socket.io) · `db.js` (koneksi, migrasi, seed) · `database/schema.sql` · `views/dashboard.html` (hanya lewat route ber-RBAC) · `public/` (index = menu pelanggan, login, invoice, css, js).
Tabel: `users, sessions, categories, menu_items, dining_tables, orders, order_items` (order menyimpan snapshot nama/harga/nomor meja, sehingga riwayat tetap utuh saat menu/meja diubah atau dihapus).

## Daftar uji (manual)
1. Login tiap peran → masuk dashboard sendiri; buka `/owner` sebagai kasir → dialihkan; logout lalu buka `/kasir` → ke login.
2. Admin tambah/ubah/hapus meja; QR terunduh PNG; scan → nomor meja terisi; scan QR meja yang dihapus → pesan error.
3. Pelanggan pesan tunai → muncul di kasir <3 dtk → konfirmasi tunai → status lunas di layar pelanggan tanpa refresh → invoice.
4. Pesan QRIS → simulasi/webhook → lunas otomatis; kasir tidak bisa memproses sebelum lunas.
5. Kirim harga/ID menu palsu lewat API → ditolak/dihitung ulang. Coba `' OR 1=1 --` di form login → gagal.
6. Owner: laporan, grafik prediksi, riwayat tampil dari data contoh.
