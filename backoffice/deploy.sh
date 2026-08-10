#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DOMAIN="imperial-mc.online"
VERSION="$(cat VERSION 2>/dev/null || echo 'неизвестна')"

echo "=============================================="
echo " Imperial MC — деплой (версия: ${VERSION})"
echo "=============================================="
echo
echo "!! Напоминание: порт 22 должен быть ограничен в облачном"
echo "   файрволе Timeweb (только твой IP) — иначе сервер снова"
echo "   зальют боты. Этот скрипт файрвол не трогает, он настраивается"
echo "   в панели управления, а не отсюда."
echo

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запусти скрипт от root: sudo bash deploy.sh"
  exit 1
fi

# --- 1. Docker ---
if ! command -v docker &> /dev/null; then
  echo "-> Docker не найден, устанавливаю..."
  curl -fsSL https://get.docker.com | sh
else
  echo "-> Docker уже установлен: $(docker --version)"
fi

if ! docker compose version &> /dev/null; then
  echo "Плагин 'docker compose' не найден после установки Docker. Прерываю."
  exit 1
fi

# --- 2. .env: генерируем один раз, дальше не трогаем ---
if [[ ! -f .env ]]; then
  echo "-> .env не найден, генерирую из .env.example со случайными секретами..."
  cp .env.example .env
  PG_PASS=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/POSTGRES_PASSWORD=CHANGE_ME/POSTGRES_PASSWORD=${PG_PASS}/" .env
  sed -i "s/imperialmc:CHANGE_ME@postgres/imperialmc:${PG_PASS}@postgres/" .env
  sed -i "s/JWT_SECRET=CHANGE_ME/JWT_SECRET=${JWT_SECRET}/" .env
  echo "   Секреты сгенерированы и записаны в .env (посмотреть: cat .env)"
else
  echo "-> .env уже существует, не трогаю (секреты не перезаписываются)."
fi

# --- 3. Поднять стек ---
echo "-> Собираю и поднимаю контейнеры..."
docker compose up -d --build

# --- 4. Дождаться готовности Postgres ---
echo "-> Жду готовности PostgreSQL..."
READY=0
for i in $(seq 1 30); do
  CID="$(docker compose ps -q postgres)"
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' "$CID" 2>/dev/null || echo "starting")"
  if [[ "$STATUS" == "healthy" ]]; then
    echo "   Postgres готов."
    READY=1
    break
  fi
  sleep 2
done
if [[ "$READY" -eq 0 ]]; then
  echo "   Postgres не стал healthy за 60 секунд — проверь: docker compose logs postgres"
fi

# --- 5. Администратор (по желанию, безопасно перезапускать) ---
read -rp "Создать/обновить администратора бэкофиса сейчас? (y/N) " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  read -rp "Логин администратора: " ADMIN_USER
  read -rsp "Пароль администратора: " ADMIN_PASS
  echo
  docker compose run --rm app node scripts/create-admin.js "$ADMIN_USER" "$ADMIN_PASS"
fi

echo
echo "=============================================="
echo " Готово."
echo " Проверить:  https://${DOMAIN}/login.html"
echo " Логи:       docker compose logs -f app"
echo " Статус:     docker compose ps"
echo
echo " Не забудь: порт 22 должен быть закрыт в файрволе Timeweb"
echo " для всех, кроме твоего IP."
echo "=============================================="
