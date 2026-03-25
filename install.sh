#!/usr/bin/env bash

set -euo pipefail

APP_DIR_DEFAULT="/opt/3xui-subscription-manager"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR="${3:-${APP_DIR_DEFAULT}}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
TLS_MODE="${TLS_MODE:-letsencrypt}"

if [[ -z "${DOMAIN}" ]]; then
  read -r -p "Domain for the app (example: sub.example.com): " DOMAIN
fi

if [[ -z "${EMAIL}" ]]; then
  read -r -p "Email for certificate notices: " EMAIL
fi

if [[ -z "${DOMAIN}" || -z "${EMAIL}" ]]; then
  echo "Domain and email are required."
  exit 1
fi

if [[ ! "${HTTP_PORT}" =~ ^[0-9]+$ || ! "${HTTPS_PORT}" =~ ^[0-9]+$ ]]; then
  echo "HTTP_PORT and HTTPS_PORT must be numeric."
  exit 1
fi

if [[ "${TLS_MODE}" != "letsencrypt" && "${TLS_MODE}" != "internal" ]]; then
  echo "TLS_MODE must be either 'letsencrypt' or 'internal'."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

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

port_in_use() {
  local port="$1"
  ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .
}

check_ports() {
  local failed=0

  if port_in_use "${HTTP_PORT}"; then
    echo "Port ${HTTP_PORT} is already in use."
    failed=1
  fi

  if port_in_use "${HTTPS_PORT}"; then
    echo "Port ${HTTPS_PORT} is already in use."
    failed=1
  fi

  if [[ "${failed}" -eq 1 ]]; then
    echo
    echo "Choose free ports and run again, for example:"
    echo "  HTTP_PORT=3000 HTTPS_PORT=3030 TLS_MODE=internal sudo ./install.sh ${DOMAIN} ${EMAIL}"
    exit 1
  fi
}

check_dns() {
  if command -v getent >/dev/null 2>&1; then
    if ! getent ahosts "${DOMAIN}" >/dev/null 2>&1; then
      echo "Warning: ${DOMAIN} does not resolve yet. Certificate issuance may fail until DNS points to this server."
    fi
  fi
}

validate_tls_mode() {
  if [[ "${TLS_MODE}" == "letsencrypt" ]]; then
    if [[ "${HTTP_PORT}" != "80" || "${HTTPS_PORT}" != "443" ]]; then
      echo "TLS_MODE=letsencrypt is supported only with HTTP_PORT=80 and HTTPS_PORT=443."
      echo "For custom ports use TLS_MODE=internal, or free ports 80/443 for public certificates."
      exit 1
    fi
  fi
}

write_env_file() {
  cat > .env <<EOF
DOMAIN=${DOMAIN}
EMAIL=${EMAIL}
HTTP_PORT=${HTTP_PORT}
HTTPS_PORT=${HTTPS_PORT}
TLS_MODE=${TLS_MODE}
EOF
}

generate_caddyfile() {
  local site_label
  local tls_block=""

  if [[ "${TLS_MODE}" == "letsencrypt" ]]; then
    site_label="${DOMAIN}"
  else
    site_label="http://${DOMAIN}:${HTTP_PORT}, https://${DOMAIN}:${HTTPS_PORT}"
    tls_block=$'\ttls internal\n\n'
  fi

  sed \
    -e "s|{{EMAIL}}|${EMAIL}|g" \
    -e "s|{{SITE_LABEL}}|${site_label}|g" \
    -e "s|{{TLS_BLOCK}}|${tls_block}|g" \
    Caddyfile.template > Caddyfile
}

install_docker
validate_tls_mode
check_dns
check_ports

mkdir -p "${APP_DIR}"
cp -R . "${APP_DIR}"
cd "${APP_DIR}"

write_env_file
generate_caddyfile

mkdir -p data
if [[ ! -f data/sources.json ]]; then
  echo "[]" > data/sources.json
fi

docker compose up -d --build

echo
echo "Deployment completed."
if [[ "${TLS_MODE}" == "letsencrypt" ]]; then
  echo "App URL: https://${DOMAIN}"
  echo "Public TLS: enabled via Let's Encrypt."
else
  echo "App URL (HTTP): http://${DOMAIN}:${HTTP_PORT}"
  echo "App URL (HTTPS): https://${DOMAIN}:${HTTPS_PORT}"
  echo "TLS mode: internal self-signed certificate."
  echo "Browsers and clients may require certificate trust confirmation."
fi
echo "View logs:"
echo "  cd ${APP_DIR} && docker compose logs -f"
