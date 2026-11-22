# Zorax AI Cloud

One Next.js project serves the dashboard and HTTP API. The Node.js server calls GroqCloud with `fetch`. PostgreSQL stores sessions, extension credentials, encrypted knowledge profiles, and usage.

## Run locally on Windows

Use Node.js 22.18 or newer and open PowerShell at the project root. The commands use `npm.cmd` so PowerShell can run npm without relying on its optional PowerShell shim.

If you already configured `.env`, retain `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ZORAX_SECRET`, and `KNOWLEDGE_ENCRYPTION_KEY`. Add your Groq developer key as `GROQ_API_KEY`. For local use set `APP_ENV=development` and `PUBLIC_ORIGIN=http://127.0.0.1:8000`. The default model is `openai/gpt-oss-20b`. Adjust `GROQ_MODEL` and `GROQ_MODELS` if needed. Check your model access and rate limits in GroqCloud. [Groq models](https://console.groq.com/docs/models) · [Rate limits](https://console.groq.com/docs/rate-limits)

For a new setup, copy `.env.example` to `.env`. Generate a password hash with `npm.cmd run admin:password`, and set independent random secrets of at least 32 characters. Use the Supabase session pooler connection string for IPv4 hosts and use verified TLS in production. The migration role must own the private `zorax` schema and be able to install `pgcrypto` on a fresh database.

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run dev
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) and sign in with your admin password. For subsequent runs use `npm.cmd run dev`. To run a production build locally, use `npm.cmd run build` followed by `npm.cmd start -- --port 8000`. Keep both the encryption key and `ZORAX_SECRET` stable to preserve access to saved data and existing credentials.

## Deploy

1. Apply any pending migrations against your intended Supabase database with `npm.cmd run db:migrate` from a trusted machine.
2. In Vercel, select **Add New → Project** and import the GitHub repository. Use the repository root, the **Next.js** preset, and the default build settings.
3. Add the production environment variables from `.env.example` in Vercel. Set `APP_ENV=production` and keep all credentials server-side. Reuse the existing `ZORAX_SECRET` and `KNOWLEDGE_ENCRYPTION_KEY` when using the same database. If the existing setup leaves the knowledge encryption key empty, keep it empty to continue deriving it from `ZORAX_SECRET`.
4. Deploy, then set `PUBLIC_ORIGIN` to the stable HTTPS production URL without a trailing slash and redeploy. Check `/health`, log in to the dashboard, and update the extension's gateway origin.

   [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)

On Render, create a Blueprint from this repository to use the included `render.yaml` and Dockerfile. Supply the same production credentials in the Blueprint setup. If you do not have the final HTTPS URL yet, update `PUBLIC_ORIGIN` in the service environment after Render assigns it. [Render Blueprints](https://render.com/docs/infrastructure-as-code)

### External uptime monitoring

Create an HTTP monitor named **Zorax AI Cloud** for `https://YOUR-PRODUCTION-HOST/health`. Expect HTTP 200 and enable outage and recovery alerts. UptimeRobot supports HTTP checks at five-minute intervals on its free plan. A PingMe bot can use the same URL if it supports HTTP status checks. [UptimeRobot setup](https://help.uptimerobot.com/en/articles/11358364-how-to-create-your-first-monitor-on-uptimerobot-quick-setup-guide)

For a separate Supabase connectivity check, set `READINESS_MONITOR_TOKEN` in the host environment and create an HTTPS monitor for `/ready` that sends `Authorization: Bearer YOUR_READINESS_MONITOR_TOKEN` as a request header. Keep the token out of the URL. `/health` checks application liveness, and `/ready` checks database connectivity. Render and Supabase free plans are subject to their own idle policies.

## Knowledge Base and extension

Create a profile in **Knowledge Base**. The editor supports structured information, custom fields, saved answers, additional context, JSON transfers, and up to 30 encrypted revisions. Label a free-text fact such as `Shipping region: Western Europe` for direct matching. The gateway resolves exact matches locally, then sends only relevant labels and short reference excerpts to Groq when it needs semantic matching. It applies only answers backed by available candidate values. Stored structured values stay in the gateway. The dashboard shows recorded usage from Zorax requests, including historical provider attribution, and links to GroqCloud for account activity.

Create a Zorax API key and grant it access under **Knowledge Base → Extension access**. In the installed extension, use **Zorax Cloud settings** with your gateway origin and a Zorax key or pairing code. Keys are scoped to authorized profiles. The extension fills its locally known fields first and requests only unresolved fields from the gateway. [Extension setup](zorax-form-filler/zorax-form-filler/README.md#connect-zorax-ai-cloud)

## API and checks

The dashboard’s **API Documentation** page links to an authenticated OpenAPI document. The extension uses `GET /api/v1/profiles`, `POST /api/v1/analyze-form`, and `POST /api/v1/extension/redeem`. The gateway retains `/api/v1/answer-fields`, `/api/v1/models`, and `/api/v1/usage`. The extension uses a Zorax bearer credential. Admin routes use the dashboard’s session cookie.

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

Set `TEST_DATABASE_URL` to a disposable PostgreSQL server with permission to create a temporary database to run the integration test. That test uses a mocked Groq response.
