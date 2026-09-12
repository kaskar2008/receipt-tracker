#!/usr/bin/env node

require("dotenv").config();

const action = process.argv[2];

function requireEnv(names) {
  const missing = names.filter(
    (name) => !process.env[name] || process.env[name].trim() === ""
  );
  if (missing.length > 0) {
    throw new Error(`Не заданы переменные окружения: ${missing.join(", ")}`);
  }
}

async function telegramRequest(method, body) {
  requireEnv(["BOT_TOKEN"]);
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    }
  );
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.description || `Telegram API вернул ${response.status}`
    );
  }
  return payload.result;
}

async function main() {
  if (action === "set") {
    requireEnv(["BOT_TOKEN", "WEBHOOK_BASE_URL", "WEBHOOK_SECRET"]);
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(process.env.WEBHOOK_SECRET)) {
      throw new Error(
        "WEBHOOK_SECRET должен содержать 1–256 символов A-Z, a-z, 0-9, _ или -"
      );
    }
    const baseUrl = process.env.WEBHOOK_BASE_URL.replace(/\/+$/, "");
    const webhookUrl = new URL(`${baseUrl}/telegram-webhook`);
    if (webhookUrl.protocol !== "https:") {
      throw new Error("WEBHOOK_BASE_URL должен использовать HTTPS");
    }

    await telegramRequest("setWebhook", {
      url: webhookUrl.href,
      secret_token: process.env.WEBHOOK_SECRET,
      allowed_updates: ["message"],
    });
    console.log(`Webhook установлен: ${webhookUrl.href}`);
    return;
  }

  if (action === "info") {
    const info = await telegramRequest("getWebhookInfo");
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (action === "delete") {
    await telegramRequest("deleteWebhook");
    console.log("Webhook удалён");
    return;
  }

  throw new Error("Использование: node scripts/webhook.js set|info|delete");
}

main().catch((error) => {
  console.error(`Ошибка управления webhook: ${error.message}`);
  process.exitCode = 1;
});
