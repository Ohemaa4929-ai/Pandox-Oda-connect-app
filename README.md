# PANDOX ODA CONNECT

Full-stack platform for Akim Oda, Ghana — customer/provider app + owner dashboard, one backend/database.

## Features
- Ride hailing, delivery, hotels, short stays, apartments, property
- Paystack payments (Ghana)
- Owner dashboard with RBAC, audit trail, 2FA
- Docker one-command deploy

## Quick start
```bash
npm install
cp .env.example .env   # fill in real values
npm start              # http://localhost:3000 (dashboard at /admin)
```

## Deploy
See `README-DEPLOY.md` — VPS, Render/Railway, or Docker (`bash deploy.sh`).

## Tests
```bash
npm test                        # 46 smoke tests
node tests/e2e-extended.js      # 86 extended e2e tests
```