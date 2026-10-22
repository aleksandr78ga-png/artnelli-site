# Avito catalogue preparation — 22 October 2026

Nelli authorised preparing and testing an Avito connection to the shared
Telegram catalogue. She approved the Expanded subscription and a total budget
of RUB 5,550 for the first 30 days (RUB 3,000 subscription plus RUB 2,550 views,
at the prices shown in her account on 8 October). This is not permission for
unlimited top-ups, paid promotions or a more expensive subscription. Payment
and activation of a paid subscription have **not** been confirmed. Nelli later
chose to test manual preparation before proceeding with a subscription.

## Manual preparation page — 22 October 2026

Nelli confirmed that she saved and activated the existing “Монохром” ad in her
own browser without a payment request. This confirms that particular manual
edit/reactivation, not free publication of all future ads or an API connection.
She then asked to simplify this workflow as much as possible.

`site/avito/` is a preparation page using only the existing
`/feeds/avito-source.json`. It has search, separate text copy buttons, a photos-only PNG ZIP,
optional user-controlled photo rotation, and browser-local completion marks.
It does not access Avito, fill Avito forms, pay, activate or publish anything.
Only public product data is served; user-supplied ad links and progress stay in
localStorage and can be exported/imported as a local backup. This is a temporary
manual workflow, not the final automatic receiving integration.

- The one explicitly observed existing multi-size ad groups source IDs 8, 60,
  and 66 for display only. These are three distinct source records. Other
  identically named products are not merged. The used ID 2347 remains separate.
  Missing/held members block transfer of the combined card for manual review.
- Prices, measurements and source descriptions are retained. Request-only
  prices are never copied as zero. Contacts/location/category warnings remain
  visible; no global seller type or location is fabricated.
- Images are downloaded from same-origin catalogue assets, checked against
  the shared hash and converted to PNG without resizing. Only rotations
  explicitly chosen by the user are applied. A partial failed download does
  not produce a misleading complete archive.
- Cards follow the website's default order: new, used, rental; newest source
  date and ID first. `sourceDate` is display metadata outside the product
  fingerprint, so this sorting change does not invalidate saved progress.
  The observed multi-size ad appears at its first sorted member's position.
- “Скачать все фотографии” downloads only numbered PNG files, directly inside
  one ZIP. Title, description and price remain separate copy fields on the page.
- Completion is a user assertion, not an Avito observation. Source fingerprints
  detect changed product fields and photo content. Only confirmed source
  tombstones produce manual removal-review tasks for previously marked cards.
  No actual listing is removed. Marks do not automatically roam across devices.
- The page refreshes the published feed every 15 seconds while visible and on
  return. The feed itself is produced by the existing publisher; it is not a
  fresh direct Telegram inspection on each page refresh.
- A changed source or failed refresh disables transfer from an already open
  card until the source is successfully reloaded. The last valid list is retained.

Run `node --test scripts/avito-manual.test.mjs` for grouping, price, change/removal
evidence, unsafe input and ZIP checks. Existing storefront routes and publisher
remain unchanged.

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
