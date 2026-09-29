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

- Stable source IDs: `artnelli-<Telegram product id>`. Do not regenerate or change
  these IDs when updating names, prices, descriptions or images.
- Exactly one positive numeric RUB price is required. Missing/ambiguous prices
  are reported and omitted; zero prices and guesses are prohibited.
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
