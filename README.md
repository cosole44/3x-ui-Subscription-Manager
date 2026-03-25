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

## Установка на VPS

Ниже сценарий для чистого VPS с `Debian 12` или `Ubuntu 22.04/24.04`.

### 1. Подготовьте домен

- создайте `A` запись для домена или поддомена
- направьте ее на публичный IP вашего VPS
- дождитесь, пока домен начнет открываться по IP сервера

Пример:

```text
vpn-sub.example.com -> 203.0.113.10
```

### 2. Подключитесь к серверу

```bash
ssh root@YOUR_SERVER_IP
```

Если вы работаете не под `root`, то используйте пользователя с `sudo`.

### 3. Склонируйте репозиторий

```bash
apt update && apt install -y git
git clone https://github.com/cosole44/3x-ui-Subscription-Manager.git
cd 3x-ui-Subscription-Manager
```

### 4. Запустите установку

```bash
chmod +x install.sh
sudo ./install.sh vpn-sub.example.com admin@example.com
```

Скрипт автоматически:

- установит Docker Engine и Docker Compose plugin, если их еще нет
- скопирует проект в `/opt/3xui-subscription-manager`
- создаст файл `.env` с доменом и email
- запустит приложение и reverse proxy
- запросит SSL-сертификат Let's Encrypt

### 5. Проверьте запуск

После установки откройте:

```text
https://vpn-sub.example.com
```

Готовая ссылка подписки для клиента `PC`:

```text
https://vpn-sub.example.com/subscribe/PC
```

Если сертификат не выдался сразу:

- проверьте, что домен уже смотрит на нужный IP
- убедитесь, что порты `80` и `443` открыты в firewall провайдера и на сервере
- подождите 30-60 секунд и проверьте логи

### 6. Полезные команды на VPS

Перейти в каталог установки:

```bash
cd /opt/3xui-subscription-manager
```

Посмотреть логи:

```bash
docker compose logs -f
```

Перезапустить сервис:

```bash
docker compose restart
```

Обновить сервис после `git pull`:

```bash
docker compose up -d --build
```

Остановить сервис:

```bash
docker compose down
```

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
