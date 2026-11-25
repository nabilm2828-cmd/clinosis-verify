# CLINOSIS prescription page (free hosting)

A static page (no server, no database). The QR on every printed prescription opens
`<this page>#/verify/<code>`:
- **the pharmacist** sees whether the prescription is genuine (signature checked on the phone);
- **the patient** sees their drugs and taps "اضبط مواعيد الدوا": the page makes a calendar
  file (.ics) with a reminder for every dose and hands it to the phone's calendar (M2.8b).

Nothing after `#` is ever sent to a server, so no patient data goes online.
The program also serves the same files at `/verify/` (the web build copies this folder).

Files: `index.html`, `style.css`, `app.js` (the page), `rx-core.js` (checking + reminders,
tested by `tests/e2e/rx_patient.mjs`), `fonts/`. Upload **all of them** together.

## Put it online for free (GitHub Pages) — once
1. Make a free account on github.com (or use yours).
2. New repository, name it e.g. `clinosis-verify`, **Public**.
3. "uploading an existing file": drag every file and the `fonts` folder from this folder (not this README). Commit.
4. Settings › Pages › Source: "Deploy from a branch", branch `main`, folder `/ (root)` › Save.
5. After a minute the page is at `https://<your-user-name>.github.io/clinosis-verify/`.
6. On every clinic PC put that address in `.env`: `RX_VERIFY_URL=https://<your-user-name>.github.io/clinosis-verify/`
   and restart CLINOSIS. Prescriptions printed after that carry the new address.

## Updating it
Raise the `?v=` number in `index.html` (style.css, app.js) and in the `import` line of `app.js` (rx-core.js), so phones that kept the old page fetch the new files.
Upload the changed files again to the same repository (same names replace the old ones).
QR codes printed earlier keep working: old prescriptions just have no duration, so the patient types the days.

A domain of your own can be added later (GitHub Pages › Custom domain); then change `RX_VERIFY_URL`.

`OWNER_PUBLIC_KEY` in `rx-core.js` is the public half of the key in `owner-keys` (the one that signs licenses); never change it.
