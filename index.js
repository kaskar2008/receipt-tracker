require("events").defaultMaxListeners = 30;

const { loadConfig } = require("./config");
const { createBot } = require("./bot");
const { createSheets } = require("./google-client");
const { createExpenseStore } = require("./sheets");
const { createReceiptRecognizer } = require("./openai-vision");
const {
  WEBHOOK_PATH,
  createHttpServer,
  installShutdownHandlers,
  listen,
} = require("./server");

async function main() {
  const config = loadConfig();
  const sheets = createSheets(config.googleCredentials);
  const expenseStore = createExpenseStore({
    sheets,
    spreadsheetId: config.spreadsheetId,
  });
  const bot = createBot({
    token: config.botToken,
    ownerId: config.ownerId,
    expenseStore,
    recognizeReceiptFromPhoto: createReceiptRecognizer(config.openaiApiKey),
  });
  const webhookHandler = bot.webhookCallback(WEBHOOK_PATH, {
    secretToken: config.webhookSecret,
  });
  const server = createHttpServer({ webhookHandler });

  installShutdownHandlers(server);
  await listen(server, config.port);
  console.log(`HTTP-сервер слушает 0.0.0.0:${config.port}`);
}

main().catch((error) => {
  console.error("Не удалось запустить приложение:", error.message);
  process.exitCode = 1;
});
