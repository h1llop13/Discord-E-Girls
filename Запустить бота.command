#!/bin/zsh

# Finder starts .command files with a minimal PATH, so include the usual
# Homebrew and Docker Desktop locations explicitly.
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR" || exit 1

pause_before_exit() {
  printf '\nНажмите любую клавишу, чтобы закрыть окно...'
  read -rs -k 1
  printf '\n'
}

fail() {
  printf '\n❌ %s\n' "$1"
  pause_before_exit
  exit 1
}

run_step() {
  local label="$1"
  shift

  printf '\n▶ %s\n' "$label"
  "$@" || fail "Не удалось: $label"
}

printf '\033]0;Discord E-Girls Bot\007'
printf '\n🤖 Discord E-Girls Bot — локальный запуск\n'
printf 'Папка: %s\n' "$PROJECT_DIR"

[[ -f .env ]] || fail 'Не найден файл .env рядом с файлом запуска.'
[[ -f package.json && -f package-lock.json && -f compose.yaml ]] || \
  fail 'Файл запуска должен находиться в корне проекта.'

command -v node >/dev/null 2>&1 || \
  fail 'Node.js не найден. Установите его в Терминале: brew install node'
command -v npm >/dev/null 2>&1 || fail 'npm не найден рядом с Node.js.'
command -v docker >/dev/null 2>&1 || \
  fail 'Docker не найден. Установите Docker Desktop для macOS.'

node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || \
  fail 'Не удалось определить версию Node.js.'
(( node_major >= 22 )) || fail 'Нужен Node.js 22 или новее.'

if ! docker info >/dev/null 2>&1; then
  printf '\n▶ Docker Desktop не запущен. Открываю его и жду готовности...\n'
  open -a Docker || fail 'Не удалось открыть Docker Desktop.'

  docker_ready=false
  for _ in {1..60}; do
    if docker info >/dev/null 2>&1; then
      docker_ready=true
      break
    fi
    sleep 2
  done

  [[ "$docker_ready" == true ]] || \
    fail 'Docker Desktop не запустился за 2 минуты. Проверьте его окно и повторите запуск.'
fi

run_step 'Запуск PostgreSQL в Docker' docker compose up -d

printf '\n▶ Ожидание PostgreSQL...\n'
database_ready=false
for _ in {1..30}; do
  if docker compose exec -T postgres pg_isready -U discord_bot -d discord_bot >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done
[[ "$database_ready" == true ]] || fail 'PostgreSQL не стал доступен за 30 секунд.'
printf '✅ PostgreSQL готов.\n'

if [[ ! -d node_modules || ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  run_step 'Установка зависимостей' npm ci
else
  printf '\n✅ Зависимости уже установлены.\n'
fi

run_step 'Применение миграций базы' npm run db:migrate
run_step 'Сборка проекта' npm run build

printf '\n✅ Всё готово. Запускаю бота.\n'
printf 'Для остановки нажмите Control + C в этом окне.\n\n'

npm start
bot_status=$?

if (( bot_status == 0 || bot_status == 130 )); then
  printf '\n⏹ Бот остановлен. PostgreSQL остался запущенным в Docker.\n'
else
  printf '\n❌ Бот завершился с ошибкой (code %d).\n' "$bot_status"
fi

pause_before_exit
exit "$bot_status"
