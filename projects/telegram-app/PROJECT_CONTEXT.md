# Telegram Mini App — Art Nelli

- Bot confirmed by Nelli: @ArtNelliBot.
- Web URL: https://artnelli.com/telegram/
- Configure Main Mini App and menu button in BotFather after web deployment.
- Menu text: Каталог. Main app link once configured: https://t.me/ArtNelliBot?startapp
- Catalogue: shared ../catalog-data.js and /api/live-data.js; keep existing synchronization unchanged.
- Source channel: https://t.me/nelli_leotards
- Personal inquiries: https://t.me/nelli_leotard (singular). Open via Telegram.WebApp.openTelegramLink with a text draft; no automatic sending.
- Product draft includes name, height, ID and direct /telegram/?product=ID URL. Supports startapp=product_ID.
- Booking: six preferred months, mandatory acknowledgement of 15,000 RUB sketch terms. No name/phone/measurements fields or form submission API.
- RU/EN catalogue UI and inquiry drafts; existing product translations are used. Legal documents retain Russian as their source language.
- No bot token in client code. The static catalogue needs no bot token; BotFather configuration is performed by its owner.
- Main site and MAX app are independent and unchanged.
- Verify actual iOS/Android in-app launch after the owner configures BotFather.

## Rental category (28 September 2026)
- Main site, MAX and Telegram expose Rental separately from New and Pre-owned.
- Rental post 5726 (Танец огня) is 4,500 RUB; pre-owned sale post 5733 remains 39,000 RUB.
- scripts/catalog-offer.mjs normalizes explicit rental headings after every catalogue sync, preserving prices and separate sale listings.
- Rental inquiries and prices explicitly say rental.

## Four rental offers confirmed by owner (28 September 2026)
- Rental topic: https://t.me/nelli_leotards/1865. The owner supplied screenshots confirming four offers: Peach 3,500 RUB, Yellow gold 5,000 RUB, Ярко-красный 4,500 RUB, Танец огня 4,500 RUB.
- The first three offers were imported from those screenshots. Their negative local catalogue IDs (-186501, -186502, -186503) are not Telegram message IDs. Link their source buttons to the confirmed rental topic until the individual post URLs are available; do not invent post IDs or reuse sale post IDs.
- Original photos are reused after visual matching. Peach photos were restored from commit e39ed82; its deleted sale listing 2833 remains absent. The separate existing Yellow gold and Ярко-красный sale listings are unchanged.
- The normal sync retains imported rentals. When a single real rental listing with the same name and measurements arrives, scripts/catalog-offer.mjs replaces the local import to avoid a duplicate. A sale listing is never used for that replacement.
- This completes the one-time import, not historical access to Telegram. The upstream bot feed currently omits topic IDs. Full topic-based classification and automatic deletion checks for the three imported offers still need upstream support and verified individual post IDs. Do not report those capabilities as complete.

## Rental event synchronization (28 September 2026)
- The backend now preserves message_thread_id and classifies confirmed topic 1865 as rental even without an explicit rental heading. Public URL redirects never establish topic membership.
- Edited captions, prices, and media remain attached to the original message/album. The publisher refreshes rental images when their source file IDs change and uses versioned asset filenames.
- The scheduled publisher runs at minutes 7, 22, 37, 52 each hour; GitHub may delay scheduled runs.
- Public deletion reconciliation excludes local negative IDs, treats inaccessible posts as unknown, and requires an explicit missing response confirmed at least 10 minutes later. It is not a substitute for authenticated Telegram history access.
- FULL synchronization remains blocked: three screenshot imports still lack original message IDs and the public rental topic cannot be read reliably. No Telegram client/MTProto session or API app credentials are configured. Do not claim guaranteed detection of deletions or media deletions.
- Backend source is maintained in the Sites project appgprj_6a560583dddc81918a4559268688cbff. Keep future backend changes in its source repository.
