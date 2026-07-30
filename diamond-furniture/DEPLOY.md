# Deploying to Firebase Hosting

This gets you a real, shareable URL (`https://<project>.web.app`) **and** turns on
cloud multi-user mode. ~2–5 minutes. You run it (it publishes under your Google account).

> ⚠️ **Set `.env` BEFORE you build.** Vite bakes the Firebase keys into the build.
> If you deploy without them, the hosted site runs in single-user demo mode.

## One-time setup

1. **Install the CLI and sign in** (as yourself):
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. **Create a project + web app** at <https://console.firebase.google.com>
   (or `firebase projects:create diamond-furniture`). In the console:
   - **Build → Authentication → Get started** → enable **Email/Password** (and **Google** if you want).
   - **Build → Firestore Database → Create database** (production mode is fine — our rules handle access).

3. **Point this folder at your project:**
   ```bash
   cd diamond-furniture
   firebase use --add        # pick your project, call the alias "default"
   ```
   (This writes `.firebaserc`. There's a `.firebaserc.example` for reference.)

4. **Add your web config** to `.env` (copy from `.env.example`; values come from
   Firebase console → Project settings → Your apps → SDK setup & configuration).

## Deploy

```bash
npm run deploy        # builds, then deploys Hosting + Firestore rules
```
Your app is now live at `https://<project>.web.app`. Re-run this anytime to update.

Sub-commands if you want them:
```bash
npm run deploy:hosting   # site only
npm run deploy:rules     # security rules only
```

## Give yourself the owner role

New users default to **viewer**. Make yourself owner once (using the Admin SDK, e.g. a
one-off Node script or a Cloud Function):
```js
const admin = require('firebase-admin');
admin.initializeApp();
admin.auth().setCustomUserClaims('<your-uid>', { role: 'owner' }); // owner | manager | viewer
```
…or, as the quick fallback our rules also accept, create a Firestore doc
`users/<your-uid>` with `{ role: "owner" }`. Sign out and back in to pick up the change.

## Load the data

Sign in (owner/manager) and use **↑ Import Excel** to upload a Master workbook — it
writes all SKUs to Firestore in batches. From then on it's live and shared across users.
