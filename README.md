# 3x-ui Subscription Manager

Веб-приложение для объединения подписок из нескольких панелей 3x-ui в одну итоговую ссылку.

## Возможности

- хранит список серверов с полями `name`, `domain`, `port`, `path`
- по имени клиента собирает подписки со всех серверов
- понимает plain text и base64-ответы от 3x-ui
- подменяет имя каждой итоговой `vless://` ссылки на название соответствующего сервера
- убирает дубли конфигов
- отдает общую подписку по URL `/subscribe/:username`
- показывает статус по каждому источнику в браузере
- поддерживает production-развертывание через Docker с HTTPS

## Локальный запуск

Требуется [Deno](https://deno.com/).

```bash
deno task start
```

После запуска приложение доступно на [http://localhost:3000](http://localhost:3000).

## Production в Docker

Стек состоит из двух контейнеров:

- `app` с Deno-приложением
- `caddy` как reverse proxy с автоматическим выпуском SSL-сертификата

### Что нужно перед установкой

- сервер с Debian или Ubuntu
- домен или поддомен, который уже указывает на IP сервера
- открытые порты `80` и `443`

### Быстрая установка

Скопируйте проект на сервер и выполните:

```bash
chmod +x install.sh
sudo ./install.sh vpn-sub.example.com admin@example.com
```

Скрипт:

- установит Docker и Docker Compose plugin, если их нет
- скопирует проект в `/opt/3xui-subscription-manager`
- создаст `.env`
- поднимет контейнеры
- включит HTTPS через Let's Encrypt

После установки приложение будет доступно по адресу:

```text
https://vpn-sub.example.com
```

И общая подписка для пользователя `PC` будет доступна по адресу:

```text
https://vpn-sub.example.com/subscribe/PC
```

Если нужен raw-текст без base64:

```text
https://vpn-sub.example.com/subscribe/PC?format=raw
```

## Ручной запуск через Docker Compose

1. Создайте `.env` на основе [.env.example](/Users/oleg/Documents/New%20project/.env.example).
2. Укажите `DOMAIN` и `EMAIL`.
3. Запустите:

```bash
docker compose up -d --build
```

4. Посмотрите логи:

```bash
docker compose logs -f
```

## Где лежат данные

Источники сохраняются в:

```text
data/sources.json
```

TLS-данные Caddy сохраняются в docker volume и переживают перезапуск контейнеров.

## Обновление

После изменения кода на сервере:

```bash
docker compose up -d --build
```
