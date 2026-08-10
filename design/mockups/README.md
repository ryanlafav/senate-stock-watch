# UI mockups (historical)

`iteration-b.html` is the design mockup that was chosen and is now implemented as the real
site in `docs/`. It is kept only as a design reference. `iteration-a.html` (the light,
top-nav alternative) was rejected and deleted.

**This directory deliberately sits outside `docs/`.** GitHub Pages publishes `docs/`, and the
mockup contains fabricated placeholder figures - invented monthly disclosure counts for
Sep 2025 - Apr 2026, and a fake signed-in user. Those numbers are clearly marked inside the
page, but on an accountability site they have no business being reachable at a public URL, so
the file is kept out of the published tree.

## What differs between the mockup and the shipped site

The shipped implementation is not a straight copy. Three things changed deliberately:

1. **No fabricated data.** The mockup padded the trend chart with eight invented months so the
   12-month axis looked full. The real dashboard plots only months that actually have filings
   and grows its own axis as coverage accumulates.
2. **No fake account chrome.** The mockup had an avatar, user name and account switcher. The
   site is a static public dataset with no accounts, so that was replaced with a real
   data-freshness status pill.
3. **Placeholders are scoped to unbuilt features.** The "Not built yet" cards and the
   `SOON`-tagged nav items remain, because those describe real roadmap gaps rather than
   inventing data.
