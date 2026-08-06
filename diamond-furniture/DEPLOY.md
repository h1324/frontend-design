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

## Give yourself the owner role (first owner only)

New users default to **viewer**. Bootstrap the **first** owner once, from the console
(this is the only user you ever create by hand):

1. Sign up on your live site (the **Create account** tab), or add yourself in
   Console → **Authentication → Users → Add user**.
2. Copy your **User UID** from that Users list.
3. Console → **Firestore → users** collection → open your `users/<uid>` document (it's
   created automatically on first sign-in) → set field **`role`** to **`owner`** → Save.
4. Sign out and back in.

**After that, do everything in the app:** the **Team** tab (owner-only) lists everyone
who has signed up and lets you set each person's role — no more console. New people just
use **Create account** on the site; they start as viewer until you promote them.

## Load the data

Sign in (owner/manager) and use **↑ Import Excel** to upload a Master workbook — it
writes all SKUs to Firestore in batches. From then on it's live and shared across users.
