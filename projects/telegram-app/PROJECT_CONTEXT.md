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
