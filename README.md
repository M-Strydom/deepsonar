# Deep Sonar — Deploy Guide

## What you need (all free)
- A GitHub account: https://github.com
- A Railway account: https://railway.app (sign in with GitHub)
- Git installed on your computer (most Macs have it — check by opening Terminal and typing `git --version`)

---

## Step 1 — Put the files in a folder

Create a folder on your computer called `deepsonar`.
Copy these 3 files into it:
- `server.js`
- `index.html`
- `package.json`

---

## Step 2 — Push to GitHub

Open Terminal (Mac) or Command Prompt (Windows) and run these commands one by one.
Copy and paste each line exactly:

```bash
cd ~/Desktop/deepsonar
git init
git add .
git commit -m "Deep Sonar initial commit"
```

Now go to https://github.com/new and create a new repository called `deepsonar`.
Make it **Public**. Don't add a README.

Then run (replace YOUR_USERNAME with your GitHub username):

```bash
git remote add origin https://github.com/YOUR_USERNAME/deepsonar.git
git branch -M main
git push -u origin main
```

---

## Step 3 — Deploy on Railway

1. Go to https://railway.app and sign in with GitHub
2. Click **New Project**
3. Click **Deploy from GitHub repo**
4. Select your `deepsonar` repo
5. Railway detects it's a Node app and deploys automatically

Wait ~60 seconds. Railway will show a URL like:
`https://deepsonar-production-xxxx.up.railway.app`

That's your game. Share that URL with your team.

---

## Step 4 — Play

1. One person opens the URL and clicks **Host a game**
2. They fill in crew names, player names, and assign roles
3. They get a 5-letter room code (e.g. `XKQT2`)
4. Everyone else opens the same URL, clicks **Join a game**, enters the code and their name
5. Each player picks their station
6. Play begins — screens update in real time, no copy-pasting

---

## Updating the game later

If you want to make changes, edit the files and run:

```bash
git add .
git commit -m "update"
git push
```

Railway redeploys automatically within ~30 seconds.

---

## Adding Slack notifications later

When you're ready to add Slack, you'll need:
1. A Slack app with a bot token (takes ~10 minutes to set up)
2. A small addition to `server.js` to send DMs when it's a player's turn
3. Player Slack IDs added to the host setup form

Just come back and ask — it's a straightforward addition once the server is running.
