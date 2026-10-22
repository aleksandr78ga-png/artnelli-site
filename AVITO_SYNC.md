# Avito catalogue preparation — 22 October 2026

Nelli authorised preparing and testing an Avito connection to the shared
Telegram catalogue. She approved the Expanded subscription and a total budget
of RUB 5,550 for the first 30 days (RUB 3,000 subscription plus RUB 2,550 views,
at the prices shown in her account on 8 October). This is not permission for
unlimited top-ups, paid promotions or a more expensive subscription. Activation
and payment have **not** been confirmed.

## Implemented scope

`scripts/build-avito-source.mjs` prepares `site/feeds/avito-source.json` after
the existing successful catalogue sync. This JSON is an intermediate source
payload, **not an Avito upload format**. There is no Avito API request, account
access, XML import, listing creation, payment or live connection in this code.

The single production publisher remains `.github/workflows/site.yml`. An error
in the new optional preparation step preserves the previous output and does
not interrupt the working site, Telegram Mini App or MAX.

- Source is `site/catalog-data.js`, produced from `nelli_leotards` by the existing
  importer; no separate hand-maintained product catalogue.
- IDs are `artnelli-tg-<canonical Telegram ID>-sale` or `-rental`. Names, prices,
  measurements and image changes do not change IDs. Separate posts are not
  merged just because their model names match.
- Product text, measurements, source links, all photos in their original order,
  sale/rental kind and price meaning are preserved in the intermediate payload.
  It is on the same site as the already public source catalogue; it must not be
  forwarded unchanged as Avito descriptions without contact/location review.
- Explicit RUB prices must match the source text. No-price cards stay on request,
  never zero. Multiple prices remain unresolved variants; rental is not sale.
- Images reference existing assets. Byte hashes detect changes even when a URL
  stays the same. Avito-specific encoding/limits must be confirmed with its
  actual template; no invented or cropped product photos.
- `sync-catalog.mjs` writes an ephemeral checkpoint with the exact catalogue
  SHA-256 and upstream-confirmed removals. The preparer rejects mismatched
  evidence. An absent, invalid or unresolved offer never means deletion.
  Unconfirmed missing records are held for reconciliation.
- Verified existing Avito IDs belong in `data/avito-connection.json` bindings.
  Empty bindings do not authorise recreation of manually published ads.
- `previewChanges` is a non-executable plan. It tests matching and changes but
  does not claim successful reception by Avito. `mode: live` is rejected.

## Required to finish the connection

1. Obtain the current official upload template from Nelli's Avito account for
   `Хобби и отдых → Спорт и отдых → Гимнастика и танцы → Одежда → Купальники`.
   That visible category was confirmed in her screenshot on 8 October; exact
   XML/Excel field names and current mandatory values have not been retrieved.
2. Obtain the existing Avito listing inventory including archived listings and
   Avito IDs. Match products using actual photos/source facts, then save stable
   bindings. Do not delete or recreate existing ads to simplify setup.
3. Implement the receiver-specific XML adapter against that official template
   and validate it in Avito. Confirm the seller's actual business type, listing
   location/contact fields and treatment of consignment goods. Do not infer
   that all used products are located in Tyumen or select “Продаю своё” globally.
4. Verify rental categories/periods, request-only prices and price/photo variants.
   Keep unsupported offers pending, with the Telegram facts unchanged.
5. Connect the validated feed in Nelli's account; check recurring fetch timing,
   moderation results, exact disappearance/withdrawal rules and paid options.
   Source refresh scheduling does not guarantee an Avito processing interval.
6. Verify a few real existing/new cards: add, change price/text/photo without a
   duplicate, and withdraw a source-confirmed unavailable card. Keep records
   and links restorable. Only then enable the full catalogue and declare sync live.

Avito account access in the assistant's cloud browser was denied by the
browser site-safety policy. No alternative browser, raw HTTP account access or
unofficial API is used. Nelli can perform the account-side steps in her own
browser and supply the template/inventory. Do not contact support on her behalf.

## Checks

```sh
node --test scripts/avito-source.test.mjs
node scripts/build-avito-source.mjs
# Production, only after a successful normal source sync:
node scripts/build-avito-source.mjs --require-checkpoint
```

Tests cover stable IDs, price changes, photo changes, rental isolation,
on-request/variant/currency handling, duplicate prevention, confirmed removal
evidence, partial-source holds and preservation of the last valid output.
They are local source-side checks, not Avito acceptance tests.
