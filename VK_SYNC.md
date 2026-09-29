# VK catalogue connection

## Status — 2026-09-29

Nelli authorised connecting the VK shop to the shared catalogue. This change
prepares the **source-side export only**. It does not enable VK synchronisation,
call VK APIs, authorise a third-party service, or modify the 44 existing VK cards.

Source: `site/catalog-data.js`, the same catalogue used by the website, Telegram
Mini App and MAX. The existing source synchronisation schedule is approximately
every 15 minutes (GitHub scheduling can be delayed).

Generated files:

- `https://artnelli.com/feeds/vk.yml` — YML export.
- `https://artnelli.com/feeds/vk-report.json` — included/skipped counts and reasons.
- `https://artnelli.com/feeds/vk-pending.json` — source offers requiring a receiving
  mapping for on-request pricing or distinct offer variants; not a VK import file.
- `site/feeds/vk-images/` — JPEG copies for VK; originals are unchanged.

The source export is rebuilt after each successful Telegram catalogue update.
**This does not cause VK to read it.** A receiving integration and its refresh
schedule still need to be selected and configured.

## Confirmed VK requirements

Nelli supplied screenshots of VK shop management and its help article
«Как автоматизировать загрузку товаров?» on 2026-09-29. The UI accepts local
Excel/CSV/YML or a file URL. The shown help requires UTF-8, up to 8 MB and 15,000
products, id/name/description/picture/price, accessible JPG/PNG/static GIF images
of at least 400 × 400, and no HTML in product text. It permits at most two param
properties; this export puts measurements in the description instead.

The supplied help **does not establish** recurring URL refreshes, matching to
manually created cards, or deletion behaviour. File import is not evidence of
automatic synchronisation.

## Export rules

Nelli clarified on 2026-09-29: an absent price means **price on request**, not a
broken card. The same product may be offered both for sale and for rent at
different prices; these must remain distinct offers. Do not choose one amount
arbitrarily, take the lowest price, or convert an on-request price into zero.

The received VK YML instructions require a price field; representation of
on-request pricing has not yet been verified. These cards are preserved in
`vk-pending.json` with the appropriate status, pending a verified receiver
mapping. Distinct prices without explicit sale/rental assignment also remain
there until their roles are established. They are not catalogue errors.

Telegram post 538 explicitly labels 38,900 RUB as black and 41,900 RUB as red
(colour variants); those offers still need their photos mapped. On 2026-09-29
Nelli restored “Кармин” (3062) to 71,800 RUB. The corrected Telegram listing was
visually verified: 68,500 RUB is gone. The catalogue description is corrected
accordingly; this is a current purchase price, not a rental price.

- Stable source IDs: `artnelli-<Telegram product id>`. Do not regenerate or change
  these IDs when updating names, prices, descriptions or images.
- The current numeric YML file requires one positive numeric RUB price. Offers
  priced on request and variants awaiting price-role mapping are retained in
  the pending-offers file; zero prices and guesses are prohibited.
  The structured price must agree with every explicitly stated RUB price in
  the original description; currency is never inferred from the number alone.
- New, used and rental offers have distinct categories. Used/rental names are
  marked explicitly. A rental price must not appear as a purchase price.
- Only structured catalogue fields are exported in descriptions, with the
  original Telegram listing link for full details. Free-form seller phone
  numbers, names and addresses are not copied into this new export.
- Every valid source image is exported as JPEG, preserving the full frame and
  resolution, with orientation applied and metadata removed. Small, animated,
  missing or unreadable images are reported. No image is invented or upscaled.
- Source catalogue, original photos, website appearance and existing Telegram
  import/removal rules are unchanged.
- Empty/malformed source, duplicate IDs or an empty export abort the build;
  they do not replace the last valid YML file.
- Historical generated images are retained; no cleanup/deletion is introduced.

## Required before enabling VK writes

1. Choose a receiving integration with documented regular refreshes. Check any
   service cost with Nelli before subscribing.
2. Export/back up the existing VK catalogue, then map its manually created cards
   to the source IDs. Do not bulk import on the assumption names will match.
3. Review `vk-report.json`. **Never delete VK cards merely because they are
   missing from this partial export**: they may have an unresolved price/image.
4. Confirm actual availability changes against the Telegram source and agree on
   the receiving integration's removal behaviour before enabling it.
5. Verify one matched card, then one automatic price/photo update, and verify no
   duplicate cards were created. Only then report VK synchronisation as enabled.

The assistant's cloud browser was blocked from VK by site-safety policy in this
session. No alternative browser/API route was used. VK-side configuration must
remain pending until a permitted connection or user-operated setup is available.

## Development

```sh
python -m pip install -r scripts/requirements-vk-feed.txt
python scripts/test-vk-feed.py
python scripts/build-vk-feed.py
```

The PR workflow validates against the real checked-out catalogue and its images.
`site.yml` is the only production publisher; no parallel publishing workflow is
introduced.

## Existing Telegram listing updates — 2026-09-29

Nelli authorised all required corrections and continued synchronisation setup.
The Sites backend previously checked old listing existence without importing
its edited caption. Version 48 now refreshes all known listing captions/prices
in bounded concurrent requests, persists those observations, and returns them
in the same live payload. A newer snapshot is not overwritten by an older bot
record; a later bot edit still wins. Existing album media is retained during
caption refresh. Unknown/unavailable pages never establish removal. The existing
approximately 15-minute publisher remains in use; scheduler delay and source
availability can delay an update. Regression tests cover old-price correction,
on-request price, source freshness, bounded full traversal, and unknown pages.

Backend source commit: `59b06e5c3d0963fc953112566da709e88a52ff9d`.

## Receiving service research — not connected

Official Soc Commerce documentation currently offers an initial import that
either deletes old cards or leaves them beside newly created cards. It does not
establish matching the 44 manual cards. Its no-price option inserts 0.01, which
is not Nelli’s price-on-request requirement. Neither option is enabled.
A paid subscription, new account, or VK permission grant has not been made.
Sources inspected: https://soc-commerce.com/features/import-to-vk and
https://docs.soc-commerce.com/shop/settings/main_settings.html.

## Verification — 2026-09-29 05:57 UTC

The updated backend was verified against live Telegram content: Кармин 71,800
RUB, Oriental lemon 85,000 RUB; crossed-out prices are excluded in both HTML
and bot caption entities. Adjacent amounts cannot concatenate into one price.
The GitHub importer rejects any structured amount that is not a separate
explicit RUB amount in the source, before writing or publishing the catalogue.
An unnamed old listing retains its existing catalogue name. All 11 backend
regression tests passed. The production source run succeeded after the earlier
rejected price was corrected (run 36527942983, retry).

The refreshed export has 98 source cards, 73 numeric-price offers, 24 cards
priced on request and one two-colour listing awaiting a receiver mapping.
Кармин is included as `artnelli-3062` at 71,800 RUB. No VK writes occurred.

Scheduling limitation: site.yml requests runs every 15 minutes, but this session
observed scheduled source runs at 2026-09-28 16:49/22:17 and 2026-09-29 02:03 UTC,
with longer gaps than requested. Do not promise a strict 15-minute refresh SLA.
The existing paused hourly rental-check automation remains paused; no duplicate
schedule was added. GitHub documents that scheduled runs may be delayed/dropped:
https://docs.github.com/en/actions/how-tos/troubleshoot-workflows.
