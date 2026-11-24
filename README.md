# Get Opinion

Anonymous A/B voting. Anyone can vote without an account. Posting needs an email login with a 6-digit code, and new accounts get 100 credits.

Hosting: Vercel (free) for the app, Neon (free) for the database.

## 1. Put the code on GitHub
1. Unzip this file on your computer.
2. On github.com, click **+** (top right) > **New repository**. Name it `get-opinion`, keep it **Private**, click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Open the unzipped `get-opinion` folder, select everything inside it (`api`, `lib`, `public`, `package.json`, `vercel.json`, `README.md`) and drag it onto the page.
5. Click **Commit changes**.

## 2. Deploy on Vercel
1. Go to vercel.com and **Sign up with GitHub**.
2. Click **Add New** > **Project**, find `get-opinion`, click **Import**.
3. Leave the settings as they are (Framework: Other) and click **Deploy**.
   The page loads, but polls show a database message until step 3 is done.

## 3. Add the database
1. In your Vercel project, open the **Storage** tab > **Create Database** > **Neon** > follow the prompts (free plan).
2. Connect it to the `get-opinion` project. Vercel adds `DATABASE_URL` for you.

## 4. Add your secret
1. Open **Settings** > **Environment Variables**.
2. Add `SESSION_SECRET` with any long random text (30+ characters).

## 5. Redeploy
Open **Deployments**, click **⋯** on the latest one > **Redeploy**. Open your link (like `get-opinion.vercel.app`). On first visit the app creates its tables and loads 50 starter polls.

## Test mode vs real emails
Without an email key, login codes are shown on screen so you can test yourself. Before inviting anyone:
1. Sign up at resend.com, add and verify a domain you own, create an API key.
2. In Vercel Environment Variables add `RESEND_API_KEY` and `EMAIL_FROM` (for example `Get Opinion <login@yourdomain.com>`).
3. Redeploy.

Until a domain is verified, Resend’s test sender only delivers to your own email.

## Optional
`ANTHROPIC_API_KEY` turns on AI photo screening. Without it, a basic skin check still runs.

## Updating later
Upload changed files to the GitHub repository. Vercel redeploys automatically.

## What’s stored where
- **Accounts:** email, nickname, credits. Emails are never shown to other users.
- **Login codes:** stored hashed, expire in 10 minutes, 5 wrong tries max, 1 code per minute.
- **Sessions:** random token in a secure cookie, stored hashed, lasts 60 days.
- **Polls and photos:** in the database. Photos are resized on the phone before upload.
- **Votes:** linked to an anonymous ID or account ID, never to an email.
- **Reports:** a poll with 3 reports is hidden.
