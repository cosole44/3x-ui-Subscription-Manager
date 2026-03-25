#!/usr/bin/env bash

set -euo pipefail

APP_DIR_DEFAULT="/opt/3xui-subscription-manager"
BACKUP_DIR_DEFAULT="/opt/3xui-subscription-manager-backups"
APP_DIR="${APP_DIR_DEFAULT}"
BACKUP_DIR="${BACKUP_DIR_DEFAULT}"
PURGE_BACKUPS="false"

usage() {
  cat <<EOF
Usage:
  sudo ./uninstall.sh [options]

Options:
  --app-dir PATH        Install directory. Default: /opt/3xui-subscription-manager
  --backup-dir PATH     Backup directory. Default: /opt/3xui-subscription-manager-backups
  --purge-backups       Remove backup files too
  --help, -h            Show this help message
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
    --purge-backups)
      PURGE_BACKUPS="true"
      shift
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

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

stop_stack() {
  if [[ -f "${APP_DIR}/docker-compose.yml" ]]; then
    (
      cd "${APP_DIR}"
      docker compose down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true
    )
  fi
}

remove_containers() {
  docker rm -f 3xui-subscription-manager-app 3xui-subscription-manager-caddy >/dev/null 2>&1 || true
}

remove_volumes() {
  docker volume rm 3xui_subscription_manager_caddy_data 3xui_subscription_manager_caddy_config >/dev/null 2>&1 || true
}

remove_network() {
  docker network rm 3xui_subscription_manager_web >/dev/null 2>&1 || true
}

remove_files() {
  rm -rf "${APP_DIR}"

  if [[ "${PURGE_BACKUPS}" == "true" ]]; then
    rm -rf "${BACKUP_DIR}"
  fi
}

stop_stack
remove_containers
remove_volumes
remove_network
remove_files

echo "3x-ui Subscription Manager removed."
if [[ "${PURGE_BACKUPS}" == "true" ]]; then
  echo "Backups were removed too."
else
  echo "Backups were kept in: ${BACKUP_DIR}"
fi
