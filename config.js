require("dotenv").config();

const REQUIRED_ENV = [
  "BOT_TOKEN",
  "OPENAI_API_KEY",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "SPREADSHEET_ID",
  "OWNER_ID",
  "WEBHOOK_SECRET",
  "NODE_ENV",
];

function loadConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter(
    (name) => typeof env[name] !== "string" || env[name].trim() === ""
  );

  if (missing.length > 0) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missing.join(", ")}`
    );
  }

  if (!/^-?\d+$/.test(env.OWNER_ID)) {
    throw new Error("OWNER_ID должен быть целым числом");
  }
  const ownerId = Number.parseInt(env.OWNER_ID, 10);
  if (!Number.isSafeInteger(ownerId)) {
    throw new Error("OWNER_ID выходит за допустимый диапазон целых чисел");
  }

  if (!/^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) {
    throw new Error(
      "WEBHOOK_SECRET должен содержать 1–256 символов A-Z, a-z, 0-9, _ или -"
    );
  }

  const port = Number.parseInt(env.PORT || "8080", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT должен быть целым числом от 0 до 65535");
  }

  return {
    botToken: env.BOT_TOKEN,
    openaiApiKey: env.OPENAI_API_KEY,
    spreadsheetId: env.SPREADSHEET_ID,
    ownerId,
    webhookSecret: env.WEBHOOK_SECRET,
    nodeEnv: env.NODE_ENV,
    port,
    googleCredentials: {
      client_email: env.GOOGLE_CLIENT_EMAIL,
      // Secret Manager may provide real line breaks, while local .env files often
      // contain the two-character sequence "\\n".
      private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
  };
}

module.exports = { loadConfig, REQUIRED_ENV };
