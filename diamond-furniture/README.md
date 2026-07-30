# Diamond Furniture — Inventory Management App

Production rebuild of the design-handoff prototype: **React + Vite + TypeScript**,
**Recharts** for charts, and **Firebase (Auth + Firestore)** for real multi-user
cloud sync. The Industry design system's tokens and the "blueprint" card style are
ported faithfully; all business logic (status classification, months-of-cover, alert
thresholds, XLSX import) matches the prototype, with the corrections agreed during review.

---

## Two run modes

The app runs with **zero setup** in **demo mode**, and switches to **cloud mode**
automatically when Firebase env vars are present.

| Mode | When | Data | Sign-in | Roles |
|------|------|------|---------|-------|
| **Demo** | no `.env` | bundled `data.json` + `localStorage` | none | role selector in header |
| **Cloud** | Firebase env set | Firestore (real-time, multi-user) | Firebase Auth | from custom claims |

### Run the demo (no account needed)
```bash
npm install
npm run dev        # http://localhost:5173
```

### Test / typecheck / build
```bash
npm test           # 37 unit tests (logic + XLSX importer)
npm run typecheck
npm run build
```

---

## Connect Firebase (cloud mode)

1. Create a Firebase project → add a **Web app** → copy the config.
2. `cp .env.example .env` and fill the `VITE_FIREBASE_*` values.
3. In the console: enable **Authentication** (Email/Password and/or Google) and
   create a **Cloud Firestore** database.
4. Deploy the security rules in [`firestore.rules`](./firestore.rules)
   (`firebase deploy --only firestore:rules`, or paste into console → Rules).
5. Assign roles. Either:
   - set a custom claim (recommended, server-side with the Admin SDK):
     ```js
     admin.auth().setCustomUserClaims(uid, { role: 'owner' }); // 'owner' | 'manager' | 'viewer'
     ```
   - or create a `users/{uid}` doc `{ role: 'owner' }` (fallback).
6. Seed the data: sign in as an owner/manager and use **↑ Import Excel** to load a
   Master workbook; it writes all SKUs to Firestore in batches.

Restart `npm run dev` after editing `.env`.

### Deploy to a real URL
See **[DEPLOY.md](./DEPLOY.md)** — `npm run deploy` builds and publishes to Firebase
Hosting (`https://<project>.web.app`) plus the security rules.

### Firestore layout
```
skus/{uid}          { line, model, colour, opening, sold, closing, reorder?, note? }
settings/app        { thresholds, period, lines, machines }
productionLog/{id}  { machine, date, line, qty }
audit/{id}          { at, user, role, action, target, detail }     # append-only
users/{uid}         { role }                                        # role fallback
```

Roles are enforced in **`firestore.rules`**, not just the UI: viewers are read-only,
owner/manager can write, the **audit log is owner-only-read and append-only**, and only
owners can assign roles.

---

## Architecture

```
src/
  domain/        Pure, tested business logic — no React, no Firebase
    logic.ts         eff(), status classification, cover, reorder, per-line thresholds,
                     normalizeDataset (unique ids for duplicate rows), aggregations
    parseWorkbook.ts dependency-free .xlsx reader (fixed closing-column detection)
    applyImport.ts   merge-aware import + override preservation
    format.ts        whole-piece / Indian number formatting
    status.ts        STATUS_META palette
  store/         Backend-agnostic app store (React context) + audit on every write
  firebase/      config, auth hook, DemoRepo (localStorage) + FirebaseRepo (Firestore)
  components/    Blueprint frame, BarList, StatusPill, Toast, dialogs
  views/         Dashboard, Inventory, Production, Alerts, Reports, Activity, Login
  styles/        tokens.css (ported design system) + app.css
```

The same store code runs against either backend via the `Repo` interface, so demo and
cloud behave identically.

---

## Changes vs the prototype (from the review, with sign-off)

1. **Closing-column fix** — the prototype's importer detected the closing column with
   `/closing|stock/`, which matched **"Opening Stock"** first and collapsed closing onto
   opening (corrupting every derived figure on import). Now prefers an explicit
   `closing` match. Regression-tested against the real Master workbook.
2. **Merge-aware import** — a file only replaces the parts it contains, so uploading the
   **production-only** workbook updates machines **without wiping SKUs** (the prototype
   silently emptied inventory). Supports one-file or two-file months.
3. **Whole pieces** — quantities are rounded to integers on import and edit.
4. **Per-line alert thresholds** — low/overstock months can be set per product line, with
   a global default fallback. Changing them recomputes statuses live.
5. **Audit trail + owner Activity view** — every edit, sale, production entry, threshold
   change and import records who/what/when; owners see it under **Activity**.
6. **Unique SKU ids** — the real Master sheet has **9 duplicate `line||model||colour`
   rows** (696 rows, 687 unique); `normalizeDataset` assigns disambiguated ids so no
   Firestore document silently overwrites another. See the open question below.
7. Role label fix ("Viewer — view only", was mislabelled "Manager").

## Known data note / open question

The sample Master workbook contains 9 duplicate SKU keys; for 4 of them one copy holds
the real numbers and the other is all-zero. We keep both (suffixing the id) so nothing is
lost, but the **real fix is upstream** — decide whether those are genuinely distinct SKUs
or data-entry duplicates to be merged. Flagged for the client.
