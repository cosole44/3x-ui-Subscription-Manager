#!/usr/bin/env bash

set -euo pipefail

APP_DIR_DEFAULT="/opt/3xui-subscription-manager"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if [[ $# -ge 1 ]]; then
  DOMAIN="$1"
else
  read -r -p "Domain for the app (example: sub.example.com): " DOMAIN
fi

if [[ $# -ge 2 ]]; then
  EMAIL="$2"
else
  read -r -p "Email for Let's Encrypt notices: " EMAIL
fi

if [[ $# -ge 3 ]]; then
  APP_DIR="$3"
else
  APP_DIR="${APP_DIR_DEFAULT}"
fi

if [[ -z "${DOMAIN}" || -z "${EMAIL}" ]]; then
  echo "Domain and email are required."
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
      curl -fsSL https://download.docker.com/linux/"$(. /etc/os-release && echo "$ID")"/gpg -o /etc/apt/keyrings/docker.asc
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
  echo "Install Docker Engine and Docker Compose plugin manually, then run:"
  echo "DOMAIN=${DOMAIN} EMAIL=${EMAIL} docker compose up -d --build"
  exit 1
}

check_dns() {
  if command -v getent >/dev/null 2>&1; then
    if ! getent ahosts "${DOMAIN}" >/dev/null 2>&1; then
      echo "Warning: ${DOMAIN} does not resolve yet. HTTPS certificate issuance may fail until DNS points to this server."
    fi
  fi
}

install_docker
check_dns

mkdir -p "${APP_DIR}"
cp -R . "${APP_DIR}"
cd "${APP_DIR}"

if [[ ! -f .env ]]; then
  cat > .env <<EOF
DOMAIN=${DOMAIN}
EMAIL=${EMAIL}
EOF
else
  sed -i.bak -E "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env || true
  sed -i.bak -E "s/^EMAIL=.*/EMAIL=${EMAIL}/" .env || true
  if ! grep -q '^DOMAIN=' .env; then
    echo "DOMAIN=${DOMAIN}" >> .env
  fi
  if ! grep -q '^EMAIL=' .env; then
    echo "EMAIL=${EMAIL}" >> .env
  fi
  rm -f .env.bak
fi

mkdir -p data
if [[ ! -f data/sources.json ]]; then
  echo "[]" > data/sources.json
fi

docker compose up -d --build

echo
echo "Deployment completed."
echo "App URL: https://${DOMAIN}"
echo "If HTTPS is not ready immediately, wait 30-60 seconds and check DNS for ${DOMAIN}."
echo "View logs:"
echo "  cd ${APP_DIR} && docker compose logs -f"
