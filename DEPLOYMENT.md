# NewHaus Deployment Checklist

Keep localhost values while developing. Before going live, update the public runtime config and production environment variables.

## Frontend: Netlify

Create a Netlify site from the GitHub repository and point it at the `public`
folder:

- Base directory: `public`
- Build command: leave blank
- Publish directory: `.`
- Functions directory: `validator`

The existing `public/netlify.toml` keeps those settings in code, as long as
Netlify is using `public` as the base directory.

Before deploy, update `public/js/config.js`:

```js
window.NHX_API_BASE = "https://your-backend.vercel.app";
window.NHX_STRAPI_BASE = "https://your-strapi-domain.com";
```

Leave these blank only if the API and Strapi are served from the same domain as the frontend.

## Backend API: Vercel

Create a separate Vercel project from the same GitHub repository and point it
at the `backend` folder:

- Root Directory: `backend`
- Framework Preset: Other
- Build Command: leave blank
- Output Directory: leave blank
- Install Command: default

The existing `backend/vercel.json` routes every request to `api/index.js`,
which exports the Express app from `server.js`.

Set these Vercel environment variables:

```txt
NODE_ENV=production
TRUST_PROXY=true
FRONTEND_ORIGINS=https://nhx.co.za,https://www.nhx.co.za

CLIENT_ID=...
CLIENT_SECRET=...
REFRESH_TOKEN=...
ZOHO_ACCOUNTS_BASE=https://accounts.zoho.com
ZOHO_API_DOMAIN=https://www.zohoapis.com

STRAPI_URL=https://your-strapi-domain.com
STRAPI_API_TOKEN=...

SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=...
ADMIN_ORDER_EMAIL=...
```

Smoke test after deploy:

```txt
GET https://your-backend.vercel.app/api/health
POST https://your-backend.vercel.app/api/shipping
```

## Strapi

Set the production Strapi CORS env:

```txt
STRAPI_CORS_ORIGINS=https://nhx.co.za,https://www.nhx.co.za
```

Use a production database. Do not rely on local SQLite for the live shop.

## Final QA

- Contact form submits to Zoho.
- System assessment submits to Zoho.
- Shop products load from Strapi.
- Delivery methods load after province entry.
- Order request creates the Zoho sales order and Strapi order history.
- Backend and Strapi audits are reviewed before launch.
