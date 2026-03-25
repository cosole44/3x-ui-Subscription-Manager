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

### Как теперь работает установка

- наружу публикуется только `HTTPS` на порту `3000`
- `HTTP` не используется
- `Caddy` выдает внутренний self-signed сертификат через `tls internal`
- домен нужен как стабильное имя сервиса

Важно:

- это не публичный сертификат Let's Encrypt
- браузер или клиент могут попросить подтвердить доверие к сертификату
- если понадобится публично доверенный сертификат, это уже отдельная схема через `443` или DNS challenge
- если открыть `http://domain:3000`, сервер ответит ошибкой `Client sent an HTTP request to an HTTPS server`

### 1. Подготовьте домен

- создайте `A` запись для домена или поддомена
- направьте ее на публичный IP вашего VPS

Пример:

```text
sub.example.com -> 203.0.113.10
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

### 4. Запустите установку

Проект использует один режим установки:

```bash
chmod +x install.sh
sudo ./install.sh sub.example.com
```

После установки сервис будет доступен по адресу:

```text
https://sub.example.com:3000
```

Установщик теперь делает чистую переустановку:

- сохраняет резервную копию старого `data/sources.json`
- останавливает старые контейнеры
- удаляет старые volumes `Caddy`
- удаляет старую директорию установки
- разворачивает сервис заново с нуля
- выгружает корневой сертификат `Caddy` в `certs/caddy-local-root.crt`

### 5. Ссылка подписки

Для клиента `PC`:

```text
https://sub.example.com:3000/subscribe/PC
```

Raw-формат:

```text
https://sub.example.com:3000/subscribe/PC?format=raw
```

### 6. Что делать с ошибкой сертификата

По умолчанию `Caddy` использует внутренний сертификат, поэтому на клиентах может быть предупреждение о недоверенном SSL.

После установки корневой сертификат будет лежать здесь:

```text
/opt/3xui-subscription-manager/certs/caddy-local-root.crt
```

Если установить этот сертификат как доверенный на устройстве, предупреждение о недействительном сертификате исчезнет.

### 7. Почему появляется ошибка `Client sent an HTTP request to an HTTPS server`

Это означает, что ссылка открывается через `http://`, а сервис принимает только `https://`.

Неправильно:

```text
http://sub.example.com:3000
```

Правильно:

```text
https://sub.example.com:3000
```

### 8. Полезные команды

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

### 9. Полное удаление с сервера

Если нужно удалить сервис и все его контейнеры:

```bash
chmod +x uninstall.sh
sudo ./uninstall.sh
```

Если нужно удалить еще и бэкапы:

```bash
sudo ./uninstall.sh --purge-backups
```

## Ручной запуск через Docker Compose

1. Создайте `.env` на основе [.env.example](/Users/oleg/Documents/New%20project/.env.example).
2. Укажите `DOMAIN`.
3. Убедитесь, что [Caddyfile](/Users/oleg/Documents/New%20project/Caddyfile) настроен на `https://DOMAIN:3000`.
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
