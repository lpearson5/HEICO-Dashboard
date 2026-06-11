# HEICO Dashboard — One-Time Setup Guide

Follow these steps in order. The whole thing takes about 15 minutes.

---

## Step 1 — Install Node.js (if you haven't already)

1. Go to https://nodejs.org
2. Click the big green **"LTS"** button to download the installer
3. Run the installer, click Next through everything, leave all defaults
4. When done, open a new **Command Prompt** window (search "cmd" in Start menu)

---

## Step 2 — Create a free GitHub account

1. Go to https://github.com and click **Sign up**
2. Pick a username and verify your email

---

## Step 3 — Create a new GitHub repository

1. Log in to GitHub, click the **+** in the top-right → **New repository**
2. Name it: `heico-dashboard`
3. Set it to **Public** (required for free Actions minutes)
4. Leave everything else as-is, click **Create repository**
5. GitHub shows you a page with setup instructions — keep this tab open

---

## Step 4 — Upload the project code to GitHub

Open **Command Prompt** on your computer and run these commands one at a time
(replace `YOUR_GITHUB_USERNAME` with your actual username):

```
cd C:\Users\linpea\.claude\sessions\heico-dashboard
git init
git add .
git commit -m "initial dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/heico-dashboard.git
git push -u origin main
```

When prompted, enter your GitHub username and password (or a Personal Access Token
if GitHub asks — go to Settings → Developer settings → Personal access tokens → Generate new token).

---

## Step 5 — Run the first data fetch on GitHub

1. Go to your repo on GitHub: `https://github.com/YOUR_GITHUB_USERNAME/heico-dashboard`
2. Click the **"Actions"** tab at the top
3. Click **"Fetch EDGAR Data"** in the left sidebar
4. Click **"Run workflow"** → **"Run workflow"** (green button)
5. Wait 5–10 minutes for it to finish (you'll see a green checkmark)

This fetches all HEICO 13F filings from EDGAR and saves them to the repo.
After this, it runs automatically every morning at 6 AM UTC.

---

## Step 6 — Deploy to Vercel (free, permanent URL)

1. Go to https://vercel.com and click **Sign up** → **Continue with GitHub**
2. Click **"Add New Project"**
3. Find `heico-dashboard` in the list and click **Import**
4. Leave all settings as defaults
5. Click **Deploy**
6. Wait ~2 minutes — Vercel builds and deploys your dashboard

**Your permanent URL** will be shown at the top of the screen, something like:
```
https://heico-dashboard-abc123.vercel.app
```

Share this link with your colleagues — it's live forever and updates automatically.

---

## How it stays up to date

- Every morning at 6 AM UTC, GitHub Actions re-fetches the latest 13F data from EDGAR
- This commits updated JSON files to your repo
- Vercel automatically redeploys when new data arrives
- You get fresh data without doing anything

---

## Need to force a refresh?

Go to your GitHub repo → **Actions** tab → **Fetch EDGAR Data** → **Run workflow**

---

## Troubleshooting

**"The action failed with an error"** — Go to the Actions tab, click the failed run,
and look at the error message. Most common cause: GitHub rate-limiting EDGAR requests.
Just re-run the workflow — it will work on retry.

**"The dashboard shows no data"** — The first data fetch hasn't run yet.
Complete Step 5 above.

**"I want to update the dashboard design"** — The files are in
`C:\Users\linpea\.claude\sessions\heico-dashboard\components\Dashboard.tsx`
