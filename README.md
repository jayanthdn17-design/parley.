# Parley server package

One small Node.js server (no dependencies) that stores accounts and messages and delivers them live to every phone,
and also serves the app itself. 10 phones at once is well within its range.

## Files
- `server.js`   the server (accounts, one-to-one messages, live updates)
- `public/`     the app (index.html, styles.css, app.js, manifest, icons, offline file)
- `package.json` tells hosts to start it with `node server.js` (Node 18 or newer)

## Put it online (no coding)
1. Make a free GitHub account, create a new repository, and upload this folder's contents with "Add file > Upload files".
   `package.json` and `server.js` must be at the top level of the repository, next to the `public` folder.
2. Make a free account at a Node hosting service such as Render, Railway or Fly.io, choose "New web service from a GitHub repository",
   pick your repository, and set:
   - Build command: leave empty (or `npm install`)
   - Start command: `node server.js`
3. When it finishes, the service gives you an https address. Open it on each phone.

Steps vary by host and I could not test any of them from here, so follow the host's own screens.

## Install on each phone
- Open the https address in Chrome on Android, tap the menu (three dots), then "Install app" (or "Add to Home screen").
- Optional APK: give the same https address to a website-to-APK service such as PWABuilder. Not tested here.

## Important limits
- Not end-to-end encrypted. Messages sit as plain text on the server and its owner can read them. HTTPS protects them in transit only.
- Data is one file (`parley-data.json`). On free hosting plans the disk is usually wiped on restart or redeploy, which
  deletes all accounts and messages. Use a host plan with a persistent disk and set `DATA_DIR` to its path.
- One server process only. Do not run several copies.
- No password reset, no account deletion, no two-step login.
- Fonts load from Google Fonts when online; otherwise the phone's default font is used.
