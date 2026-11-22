# Deploying to Vercel + Neon

1. Create a Neon project and copy its **pooled** connection string.
2. Push this folder to a GitHub repo and import it in Vercel.
3. In Vercel > Settings > Environment Variables add:
   - `DATABASE_URL`       the Neon connection string
   - `BETTER_AUTH_SECRET` a long random string (run `openssl rand -base64 32`)
   - `BETTER_AUTH_URL`    your live address, e.g. `https://your-app.vercel.app`
   - `BUSINESS_TIMEZONE`  optional, defaults to `Africa/Johannesburg`
4. Deploy. The build creates all tables in Neon automatically (`npm run build` runs the migrations).
5. Open the site. The first screen is **Set up your business**: create the manager
   username and password. After that, public sign-up is closed and the manager adds
   staff and drivers from the **Team** tab.

Rename the app/business any time in **Settings**. Invoice details (VAT number, address, phone) are set there too.
