# PANDOX ODA CONNECT — Deployment Guide

## Prerequisites
- Node.js 20+ (https://nodejs.org)
- A Linux server (VPS) or a PaaS account (Render / Railway)
- A domain name (optional but recommended for production)

## Local run
```bash
npm install
cp .env.example .env   # fill in real values (see .env.example comments)
npm start              # app at http://localhost:3000, dashboard at /admin
```

## Option A — VPS (DigitalOcean, Hetzner, Rackforest, etc.)
1. Provision Ubuntu 22.04/24.04 (1GB RAM minimum).
2. Install Node 20:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Upload this folder to `/var/www/pandox` (e.g. `scp -r . root@YOUR_IP:/var/www/pandox`).
4. Configure:
   ```bash
   cd /var/www/pandox
   npm install --production
   nano .env   # set NODE_ENV=production, APP_URL, real secrets
   ```
5. Run with PM2 (auto-restart + boot):
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name pandox
   pm2 save
   pm2 startup   # run the command it prints
   ```
6. HTTPS with Caddy (auto SSL):
   ```bash
   sudo apt-get install -y caddy
   # /etc/caddy/Caddyfile:
   # app.yourdomain.com {
   #     reverse_proxy localhost:3000
   # }
   sudo systemctl restart caddy
   ```
7. Point your domain's A record at the server IP.

## Option B — PaaS (Render / Railway)
1. Push this repo to GitHub (see README.md for what to commit — never commit `.env`).
2. Render: New → Web Service → connect repo → build `npm install`, start `node server.js`.
3. **Attach a persistent disk** mounted at `/data` and set `DB_PATH=/data/pandox.db` (SQLite must survive restarts).
4. Set every `.env` value in the platform's Environment dashboard.
5. You get a free `https://*.onrender.com` URL; add your own domain in Settings.

## After going live
- **Paystack webhook**: in Paystack dashboard → Settings → Webhooks, add
  `https://yourdomain.com/api/payments/webhook/paystack` with your `PAYSTACK_WEBHOOK_SECRET`.
- **Owner dashboard**: `https://yourdomain.com/admin` — log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.
- **Backups**: copy `data/pandox.db` off-server daily (cron or a backup service).
- **Production checklist**: set `NODE_ENV=production`, use strong `SESSION_SECRET` / `ENCRYPTION_KEY`, enable HTTPS only.

## Tests
```bash
npm test          # 46 smoke tests
node tests/e2e-extended.js   # 86 extended e2e tests
```

## Option C — Docker (one command, recommended for VPS)
1. Install Docker + Docker Compose on your server:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. Upload this folder (with your `.env` filled in) to the server.
3. Run:
   ```bash
   docker compose up -d --build
   ```
4. The app is live at `http://YOUR_SERVER_IP:3000` (dashboard at `/admin`).
5. Updates: `git pull` (or re-upload) then `docker compose up -d --build`.
6. Data persists in `./data/pandox.db` — back it up regularly.

### Docker + Caddy (HTTPS)
```bash
sudo apt-get install -y caddy
# /etc/caddy/Caddyfile:
# app.yourdomain.com {
#     reverse_proxy localhost:3000
# }
sudo systemctl restart caddy
```

## Option D — One-line script (fastest)
On a fresh Ubuntu server, upload this folder, then:
```bash
bash deploy.sh
```
It installs Docker, copies the app to `/opt/pandox-oda-connect`, creates `.env` from the template (edit it with your real values), and starts everything. Then add Caddy for HTTPS as in Option C.
