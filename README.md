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
- поддерживает production-развертывание через Docker и Caddy

## Локальный запуск

Требуется [Deno](https://deno.com/).

```bash
deno task start
```

После запуска приложение доступно на [http://localhost:3000](http://localhost:3000).

## Установка на VPS

Ниже сценарий для `Debian 12` или `Ubuntu 22.04/24.04`.

### Что важно про порты и HTTPS

Есть два режима установки:

1. `TLS_MODE=letsencrypt`
   Использует публичный SSL от Let's Encrypt.
   Для этого нужны свободные порты `80` и `443`.

2. `TLS_MODE=internal`
   Использует `Caddy` с внутренним self-signed сертификатом.
   Можно запускать на любых свободных портах, например `3000` и `3030`.
   Такой HTTPS будет работать технически, но браузер или клиент могут попросить подтвердить доверие к сертификату.

Если на сервере `80` и `443` заняты под VLESS или другой сервис, для быстрого запуска используйте `TLS_MODE=internal`.

### 1. Подготовьте домен

- создайте `A` запись для домена или поддомена
- направьте ее на публичный IP вашего VPS

Пример:

```text
subs.netherlands.guardport.online -> 203.0.113.10
```

### 2. Подключитесь к VPS

```bash
ssh root@YOUR_SERVER_IP
```

### 3. Склонируйте репозиторий

```bash
apt update && apt install -y git
git clone https://github.com/cosole44/3x-ui-Subscription-Manager.git
cd 3x-ui-Subscription-Manager
```

### 4. Выберите режим установки

#### Вариант A. Публичный SSL через Let's Encrypt

Подходит только если свободны `80` и `443`.

```bash
chmod +x install.sh
sudo ./install.sh subs.netherlands.guardport.online admin@example.com
```

После установки:

```text
https://subs.netherlands.guardport.online
```

#### Вариант B. Кастомные порты `3000` и `3030`

Подходит, если `80/443` уже заняты.

```bash
chmod +x install.sh
HTTP_PORT=3000 HTTPS_PORT=3030 TLS_MODE=internal sudo ./install.sh subs.netherlands.guardport.online admin@example.com
```

После установки:

```text
http://subs.netherlands.guardport.online:3000
https://subs.netherlands.guardport.online:3030
```

### 5. Ссылка подписки

Для клиента `PC`:

```text
https://subs.netherlands.guardport.online/subscribe/PC
```

Если используется кастомный HTTPS-порт:

```text
https://subs.netherlands.guardport.online:3030/subscribe/PC
```

Raw-формат:

```text
https://subs.netherlands.guardport.online/subscribe/PC?format=raw
```

### 6. Полезные команды

Каталог установки:

```bash
cd /opt/3xui-subscription-manager
```

Логи:

```bash
docker compose logs -f
```

Перезапуск:

```bash
docker compose restart
```

Обновление после изменения кода:

```bash
docker compose up -d --build
```

Остановка:

```bash
docker compose down
```

## Ручной запуск через Docker Compose

1. Создайте `.env` на основе [.env.example](/Users/oleg/Documents/New%20project/.env.example).
2. Укажите `DOMAIN`, `EMAIL`, `HTTP_PORT`, `HTTPS_PORT`, `TLS_MODE`.
3. Сгенерируйте `Caddyfile` в соответствии с выбранным режимом.
4. Запустите:

```bash
docker compose up -d --build
```

## Где лежат данные

Источники сохраняются в:

```text
data/sources.json
```

TLS-данные Caddy сохраняются в docker volume и переживают перезапуск контейнеров.
