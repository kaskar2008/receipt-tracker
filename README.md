# receipt-tracker

Telegram-бот для записи текстовых трат и распознанных чеков в Google Sheets.
Production-запуск использует Telegram webhook и отдельный Cloud Run service
`receipt-tracker-bot`.

Backend и бот разворачиваются как **два независимых Cloud Run services** в одном
Google Cloud project и одном region. Код и конфигурация backend при этом не
изменяются.

## Архитектура

- `GET /healthz` — локальная проверка здоровья контейнера.
- `GET /health` — публичный health endpoint, поскольку Cloud Run перехватывает
  путь `/healthz` на доменах `run.app`.
- `POST /telegram-webhook` — единственная webhook-точка Telegram.
- Telegraf проверяет заголовок `X-Telegram-Bot-Api-Secret-Token` по
  `WEBHOOK_SECRET`.
- Запись расхода сохраняет A — дату, B — сумму, C — комментарий, D — источник и
  E — Telegram `update_id` одной операцией append. Формула суммы остаётся в H1.
- Перед записью колонка E проверяется на существующий `update_id`. Начальная
  конфигурация Cloud Run ограничена одним instance и concurrency 1, поэтому
  проверка и append не выполняются параллельно.
- Ошибка обработки возвращает 5xx, чтобы Telegram повторил update; успешная
  обработка возвращает 2xx.

Webhook не регистрируется при старте контейнера. Это отдельная операция через
`npm run webhook:set`.

## Переменные окружения

Секреты:

- `BOT_TOKEN`
- `OPENAI_API_KEY`
- `GOOGLE_PRIVATE_KEY`
- `WEBHOOK_SECRET`

Обычная конфигурация:

- `GOOGLE_CLIENT_EMAIL`
- `SPREADSHEET_ID`
- `OWNER_ID`
- `NODE_ENV` (`production` в Cloud Run)
- `PORT` (Cloud Run задаёт автоматически; локальное значение по умолчанию 8080)

Для команды `webhook:set` локально также нужен `WEBHOOK_BASE_URL`. Значение
`GOOGLE_PRIVATE_KEY` может содержать настоящие переводы строк или литералы
`\n`; поддерживаются оба варианта.

Никогда не коммитьте `.env`. Скопировать список ключей для локальной настройки
можно из `.env.example`.

## Google Sheets

Используется существующая таблица с текущим `SPREADSHEET_ID`; новую создавать не
нужно. Таблица должна быть расшарена на адрес из `GOOGLE_CLIENT_EMAIL` с ролью
**Editor**. Существующие колонки A–D и формула H1 не меняются; колонка E
используется для защиты от повторной доставки webhook.

## Локальная проверка

Нужен Node.js 24:

```sh
npm ci
npm test
```

После заполнения `.env` приложение запускается командой `npm start` и слушает
`0.0.0.0:${PORT:-8080}`. Long polling не используется.

## Деплой в Google Cloud Run

Ниже `PROJECT_ID` и `REGION` должны совпадать с project и region существующего
backend. Подставьте также несекретные значения конфигурации:

```sh
export PROJECT_ID="your-project-id"
export REGION="your-backend-region"
export GOOGLE_CLIENT_EMAIL="service-account@your-project-id.iam.gserviceaccount.com"
export SPREADSHEET_ID="existing-spreadsheet-id"
export OWNER_ID="telegram-owner-id"

gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

### 1. Создать секреты без записи значений в исходники или history

Сначала создайте контейнеры Secret Manager (команда не содержит значений):

```sh
for SECRET_NAME in BOT_TOKEN OPENAI_API_KEY GOOGLE_PRIVATE_KEY WEBHOOK_SECRET; do
  gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1 || \
    gcloud secrets create "$SECRET_NAME" --replication-policy=automatic
done
```

Для `BOT_TOKEN`, `OPENAI_API_KEY` и `GOOGLE_PRIVATE_KEY` по очереди используйте
скрытый ввод. Для private key вставьте одну строку с литералами `\n`:

```sh
read -r -s SECRET_VALUE
printf %s "$SECRET_VALUE" | gcloud secrets versions add BOT_TOKEN --data-file=-
unset SECRET_VALUE

read -r -s SECRET_VALUE
printf %s "$SECRET_VALUE" | gcloud secrets versions add OPENAI_API_KEY --data-file=-
unset SECRET_VALUE

read -r -s SECRET_VALUE
printf %s "$SECRET_VALUE" | gcloud secrets versions add GOOGLE_PRIVATE_KEY --data-file=-
unset SECRET_VALUE
```

Сгенерируйте webhook secret, не выводя его в терминал:

```sh
openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets versions add WEBHOOK_SECRET --data-file=-
```

Не передавайте эти четыре значения через `--set-env-vars`: такая команда
останется в shell history и сохранит секреты как обычную конфигурацию Cloud Run.

### 2. Дать Cloud Run доступ к секретам

Создайте отдельную runtime identity и выдайте ей минимально необходимую роль на
каждый секрет:

```sh
gcloud iam service-accounts describe \
  "receipt-tracker-bot@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || \
  gcloud iam service-accounts create receipt-tracker-bot \
    --display-name="Receipt Tracker Bot"

export RUN_SERVICE_ACCOUNT="receipt-tracker-bot@$PROJECT_ID.iam.gserviceaccount.com"

for SECRET_NAME in BOT_TOKEN OPENAI_API_KEY GOOGLE_PRIVATE_KEY WEBHOOK_SECRET; do
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member="serviceAccount:$RUN_SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 3. Развернуть отдельный service

Команда использует `Dockerfile`, Cloud Build и Artifact Registry. Timeout 300
секунд оставляет время на распознавание фотографии. Публичный ingress необходим:
Telegram не умеет проходить Cloud Run IAM-аутентификацию, а запрос защищён
`WEBHOOK_SECRET`.

```sh
gcloud run deploy receipt-tracker-bot \
  --source . \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="$RUN_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=1 \
  --timeout=300s \
  --set-env-vars="GOOGLE_CLIENT_EMAIL=$GOOGLE_CLIENT_EMAIL,SPREADSHEET_ID=$SPREADSHEET_ID,OWNER_ID=$OWNER_ID,NODE_ENV=production" \
  --set-secrets="BOT_TOKEN=BOT_TOKEN:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,GOOGLE_PRIVATE_KEY=GOOGLE_PRIVATE_KEY:latest,WEBHOOK_SECRET=WEBHOOK_SECRET:latest"
```

Получите публичный URL и проверьте health endpoint:

```sh
export WEBHOOK_BASE_URL="$(gcloud run services describe receipt-tracker-bot \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"

curl --fail --show-error "$WEBHOOK_BASE_URL/health"
```

### 4. Зарегистрировать webhook один раз после деплоя

Загрузите секреты во временные переменные окружения напрямую из Secret Manager;
их значения не появятся в history и скрипт их не печатает:

```sh
export BOT_TOKEN="$(gcloud secrets versions access latest --secret=BOT_TOKEN --project="$PROJECT_ID")"
export WEBHOOK_SECRET="$(gcloud secrets versions access latest --secret=WEBHOOK_SECRET --project="$PROJECT_ID")"

npm run webhook:set
npm run webhook:info

unset BOT_TOKEN WEBHOOK_SECRET WEBHOOK_BASE_URL
```

`webhook:set` регистрирует `${WEBHOOK_BASE_URL}/telegram-webhook`, передаёт
`secret_token` и ограничивает `allowed_updates` значением `message` (фотографии
тоже приходят как message). При необходимости webhook удаляется командой:

```sh
export BOT_TOKEN="$(gcloud secrets versions access latest --secret=BOT_TOKEN --project="$PROJECT_ID")"
npm run webhook:delete
unset BOT_TOKEN
```

### 5. Проверить логи

```sh
gcloud run services logs read receipt-tracker-bot \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --limit=100
```

Полезные официальные ссылки: [deploy из исходников](https://cloud.google.com/run/docs/deploying-source-code),
[секреты Cloud Run](https://cloud.google.com/run/docs/configuring/services/secrets),
[создание Secret Manager secrets](https://cloud.google.com/secret-manager/docs/creating-and-accessing-secrets)
и [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook).
