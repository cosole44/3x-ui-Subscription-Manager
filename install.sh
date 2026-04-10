#!/usr/bin/env bash

set -euo pipefail

APP_DIR_DEFAULT="/opt/3xui-subscription-manager"
BACKUP_DIR_DEFAULT="/opt/3xui-subscription-manager-backups"
CERT_BASE_DIR="/root/cert"
APP_PORT="3000"
DOMAIN=""
ADMIN_USER=""
ADMIN_PASS=""
SUB_TOKEN=""
SESSION_SECRET=""
APP_DIR="${APP_DIR_DEFAULT}"
BACKUP_DIR="${BACKUP_DIR_DEFAULT}"

# ═══════════════════════════════════════════════════════════════════════════════
# Справка
# ═══════════════════════════════════════════════════════════════════════════════

usage() {
  cat <<EOF
Usage:
  sudo ./install.sh [options]

Options:
  --app-dir PATH       Install directory. Default: /opt/3xui-subscription-manager
  --backup-dir PATH    Backup directory. Default: /opt/3xui-subscription-manager-backups
  --help, -h           Show this help message

Notes:
  - The script will interactively ask for domain, login and password.
  - Domain is selected from certificates found in ${CERT_BASE_DIR}/.
  - SUB_TOKEN and SESSION_SECRET are generated automatically.
  - The service is exposed over HTTPS on port ${APP_PORT}.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════════
# Проверка root
# ═══════════════════════════════════════════════════════════════════════════════

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# ═══════════════════════════════════════════════════════════════════════════════
# Выбор домена из /root/cert/
# ═══════════════════════════════════════════════════════════════════════════════

pick_domain() {
  if [[ ! -d "${CERT_BASE_DIR}" ]]; then
    echo "Certificate directory ${CERT_BASE_DIR} not found."
    echo "Please place your certificates in ${CERT_BASE_DIR}/<domain>/fullchain.pem and privkey.pem"
    exit 1
  fi

  # Собираем только папки где есть оба файла
  local domains=()
  while IFS= read -r -d '' dir; do
    local name
    name="$(basename "${dir}")"
    if [[ -f "${dir}/fullchain.pem" && -f "${dir}/privkey.pem" ]]; then
      domains+=("${name}")
    fi
  done < <(find "${CERT_BASE_DIR}" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

  if [[ ${#domains[@]} -eq 0 ]]; then
    echo "No valid certificates found in ${CERT_BASE_DIR}."
    echo "Each subdirectory must contain fullchain.pem and privkey.pem."
    exit 1
  fi

  echo
  echo "Available domains with certificates:"
  local i=1
  for d in "${domains[@]}"; do
    echo "  ${i}) ${d}"
    (( i++ ))
  done
  echo

  local choice
  while true; do
    read -r -p "Select domain [1-${#domains[@]}]: " choice
    if [[ "${choice}" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#domains[@]} )); then
      DOMAIN="${domains[$((choice - 1))]}"
      echo "Selected: ${DOMAIN}"
      break
    fi
    echo "Invalid choice, try again."
  done
}

# ═══════════════════════════════════════════════════════════════════════════════
# Запрос логина и пароля
# ═══════════════════════════════════════════════════════════════════════════════

prompt_credentials() {
  echo

  # Логин
  while true; do
    read -r -p "Admin username [default: admin]: " ADMIN_USER
    ADMIN_USER="${ADMIN_USER:-admin}"
    if [[ -n "${ADMIN_USER}" ]]; then
      break
    fi
    echo "Username cannot be empty."
  done

  # Пароль (дважды, скрытый ввод)
  while true; do
    read -r -s -p "Admin password: " ADMIN_PASS
    echo
    if [[ -z "${ADMIN_PASS}" ]]; then
      echo "Password cannot be empty."
      continue
    fi
    if [[ ${#ADMIN_PASS} -lt 8 ]]; then
      echo "Password must be at least 8 characters."
      continue
    fi
    local pass_confirm
    read -r -s -p "Confirm password: " pass_confirm
    echo
    if [[ "${ADMIN_PASS}" != "${pass_confirm}" ]]; then
      echo "Passwords do not match, try again."
      continue
    fi
    break
  done
}

# ═══════════════════════════════════════════════════════════════════════════════
# Генерация токенов
# ═══════════════════════════════════════════════════════════════════════════════

generate_secrets() {
  SUB_TOKEN="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Docker
# ═══════════════════════════════════════════════════════════════════════════════

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  if [[ -f /etc/debian_version ]]; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings

    if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
      curl -fsSL "https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
    fi

    . /etc/os-release
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} \
      ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    return
  fi

  echo "Automatic dependency installation is supported only on Debian/Ubuntu."
  echo "Install Docker Engine and Docker Compose plugin manually, then run again."
  exit 1
}

# ═══════════════════════════════════════════════════════════════════════════════
# Порты / DNS / остановка старого
# ═══════════════════════════════════════════════════════════════════════════════

port_in_use() {
  local port="$1"
  ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .
}

check_port() {
  if port_in_use "${APP_PORT}"; then
    echo "Port ${APP_PORT} is already in use."
    echo "Free port ${APP_PORT} before installation."
    exit 1
  fi
}

check_dns() {
  if command -v getent >/dev/null 2>&1; then
    if ! getent ahosts "${DOMAIN}" >/dev/null 2>&1; then
      echo "Warning: ${DOMAIN} does not resolve yet."
      echo "The service will still start, but point the domain to this server before using it."
    fi
  fi
}

stop_existing_deployment() {
  if [[ -f "${APP_DIR}/docker-compose.yml" ]]; then
    (
      cd "${APP_DIR}"
      docker compose down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true
    )
  fi

  docker rm -f 3xui-subscription-manager-app 3xui-subscription-manager-caddy >/dev/null 2>&1 || true
  docker volume rm 3xui_subscription_manager_caddy_data 3xui_subscription_manager_caddy_config >/dev/null 2>&1 || true
}

backup_existing_data() {
  local sources_file="${APP_DIR}/data/sources.json"

  if [[ -f "${sources_file}" ]]; then
    mkdir -p "${BACKUP_DIR}"
    cp "${sources_file}" "${BACKUP_DIR}/sources-$(date +%Y%m%d-%H%M%S).json"
    echo "Existing data backed up to ${BACKUP_DIR}"
  fi
}

recreate_install_dir() {
  rm -rf "${APP_DIR}"
  mkdir -p "${APP_DIR}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Генерация конфигов
# ═══════════════════════════════════════════════════════════════════════════════

write_env_file() {
  cat > .env <<EOF
DOMAIN=${DOMAIN}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
SUB_TOKEN=${SUB_TOKEN}
SESSION_SECRET=${SESSION_SECRET}
EOF
  chmod 600 .env
}

generate_caddyfile() {
  cat > Caddyfile <<EOF
{
    auto_https off
}

https://${DOMAIN}:${APP_PORT} {
	encode gzip zstd

	header {
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy strict-origin-when-cross-origin
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		-Server
	}

	tls /certs/${DOMAIN}/fullchain.pem /certs/${DOMAIN}/privkey.pem

	reverse_proxy app:3000
}
EOF
}

generate_compose_file() {
  cat > docker-compose.yml <<EOF
name: 3xui_subscription_manager

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: 3xui-subscription-manager-app
    restart: unless-stopped
    env_file: .env
    environment:
      HOST: 0.0.0.0
      PORT: 3000
    volumes:
      - ./data:/app/data
    networks:
      - internal

  caddy:
    image: caddy:2.10.0
    container_name: 3xui-subscription-manager-caddy
    restart: unless-stopped
    depends_on:
      - app
    environment:
      DOMAIN: \${DOMAIN}
    ports:
      - "${APP_PORT}:${APP_PORT}"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ${CERT_BASE_DIR}:/certs:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - internal

networks:
  internal:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
EOF
}

fix_cert_permissions() {
  echo "Setting certificate permissions..."
  chmod 755 "${CERT_BASE_DIR}"
  chmod 755 "${CERT_BASE_DIR}/${DOMAIN}"
  chmod 644 "${CERT_BASE_DIR}/${DOMAIN}/fullchain.pem"
  chmod 644 "${CERT_BASE_DIR}/${DOMAIN}/privkey.pem"
}

# ═══════════════════════════════════════════════════════════════════════════════
# Основной поток
# ═══════════════════════════════════════════════════════════════════════════════

pick_domain
prompt_credentials
generate_secrets

install_docker
check_dns
backup_existing_data
stop_existing_deployment
check_port

recreate_install_dir
cp -R . "${APP_DIR}"
cd "${APP_DIR}"

fix_cert_permissions
write_env_file
generate_caddyfile
generate_compose_file

mkdir -p data
if [[ ! -f data/sources.json ]]; then
  echo "[]" > data/sources.json
fi

docker compose up -d --build

echo
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              Deployment completed!                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf  "║  App URL  : https://%-37s║\n" "${DOMAIN}:${APP_PORT}"
printf  "║  Login    : %-44s║\n" "${ADMIN_USER}"
printf  "║  Password : %-44s║\n" "${ADMIN_PASS}"
printf  "║  SUB_TOKEN: %-44s║\n" "${SUB_TOKEN}"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Save these credentials — they won't be shown again!    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo
echo "View logs:"
echo "  cd ${APP_DIR} && docker compose logs -f"
