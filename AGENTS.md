# Instructions for Art Nelli projects

Before changing a storefront or catalogue integration, read `PROJECT_RULES.md`
and `CATALOG_SYNC.md`; read `VK_SYNC.md` when working on the VK export/receiver.

Nelli's standing instruction of 2026-10-06 makes Telegram catalogue
`nelli_leotards` the only primary source. Preserve automatic additions,
confirmed deletions and edits of every product field/media for artnelli.com,
Telegram Mini App, MAX and all future storefronts, including VK and Avito.
Reconcile additions and confirmed deletions every hour. Fully reconcile edits of
all product facts and media once daily. Verify actual delivery on every connected
storefront; retain the existing faster bot-event path.
The standing instruction authorizes routine source-driven synchronization.
Keep other approval requirements from `PROJECT_RULES.md`.

Use stable source IDs and observed album membership; never match by name alone.
Never infer deletion from failed authentication, partial reads or partial exports.
Use the common catalogue and existing publisher; do not maintain independent copies.
Verify actual create/update/delete reception before reporting a new shop synchronized.
Do not claim that an export file establishes automatic import into a marketplace.
