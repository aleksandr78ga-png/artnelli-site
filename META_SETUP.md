# Подключение Instagram к Art Nelli

Сайт уже читает число подписчиков и публикации через официальный Meta Graph API. Секреты нельзя хранить в `index.html` или отправлять в открытый репозиторий.

## Что требуется в Meta

1. Instagram `@art_nelli_leotards` должен быть аккаунтом Business или Creator.
2. Он должен быть связан со страницей Facebook, которой управляет владелец аккаунта.
3. В Meta for Developers нужно создать приложение и добавить Facebook Login / Instagram Graph API.
4. В Graph API Explorer выдать приложению разрешения `instagram_basic` и `pages_show_list`.
5. Через `/me/accounts` получить страницу Facebook, затем поле `instagram_business_account` — это `INSTAGRAM_USER_ID`.
6. Полученный токен добавить в секреты хостинга как `INSTAGRAM_ACCESS_TOKEN`.

Официальная инструкция: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started

## Переменные сайта

- `INSTAGRAM_ACCESS_TOKEN` — секретный токен Meta.
- `INSTAGRAM_USER_ID` — ID профессионального Instagram-аккаунта.
- `INSTAGRAM_API_VERSION` — по умолчанию `v21.0`.
- `INSTAGRAM_GRAPH_BASE` — по умолчанию `https://graph.facebook.com`.
- `INSTAGRAM_AUTO_PORTFOLIO_START_DATE` — по умолчанию `2026-07-16T00:00:00+05:00`.
- `INSTAGRAM_AUTO_PORTFOLIO=false` — временно полностью отключает импорт новых фото.

После установки первых двух секретов счётчик подписчиков обновляется автоматически. Новые фото начинают добавляться в портфолио с указанной даты.