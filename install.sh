#!/usr/bin/env bash

set -euo pipefail

APP_DIR_DEFAULT="/opt/3xui-subscription-manager"
APP_PORT="3000"
DOMAIN=""
APP_DIR="${APP_DIR_DEFAULT}"

usage() {
  cat <<EOF
Usage:
  sudo ./install.sh DOMAIN [options]

Options:
  --app-dir PATH       Install directory. Default: /opt/3xui-subscription-manager
  --help, -h           Show this help message

Notes:
  - The service is exposed only over HTTPS on port 3000.
  - Caddy uses an internal self-signed certificate.
  - For a publicly trusted certificate you need a separate setup on port 443.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      if [[ -z "${DOMAIN}" ]]; then
        DOMAIN="$1"
      else
        echo "Unknown argument: $1"
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if [[ -z "${DOMAIN}" ]]; then
  read -r -p "Domain for the app (example: sub.example.com): " DOMAIN
fi

if [[ -z "${DOMAIN}" ]]; then
  echo "Domain is required."
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

check_port() {
  if port_in_use "${APP_PORT}"; then
    echo "Port ${APP_PORT} is already in use."
    echo "Free port ${APP_PORT} before installation. The current deployment is HTTPS-only on this port."
    exit 1
  fi
}

stop_existing_deployment() {
  if [[ -f "${APP_DIR}/docker-compose.yml" ]]; then
    (
      cd "${APP_DIR}"
      docker compose down --remove-orphans >/dev/null 2>&1 || true
    )
  fi
}

check_dns() {
  if command -v getent >/dev/null 2>&1; then
    if ! getent ahosts "${DOMAIN}" >/dev/null 2>&1; then
      echo "Warning: ${DOMAIN} does not resolve yet."
      echo "The service will still start, but you should point the domain to this VPS before using it."
    fi
  fi
}

write_env_file() {
  cat > .env <<EOF
DOMAIN=${DOMAIN}
EOF
}

generate_caddyfile() {
  cat > Caddyfile <<EOF
https://${DOMAIN}:${APP_PORT} {
	encode gzip zstd

	header {
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy strict-origin-when-cross-origin
	}

	tls internal

	reverse_proxy app:3000
}
EOF
}

install_docker
check_dns
stop_existing_deployment
check_port

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
echo "App URL: https://${DOMAIN}:${APP_PORT}"
echo "HTTPS is enabled with a Caddy internal certificate."
echo "Browsers and clients may ask you to trust the certificate."
echo "View logs:"
echo "  cd ${APP_DIR} && docker compose logs -f"
