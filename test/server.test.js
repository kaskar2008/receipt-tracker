const test = require("node:test");
const assert = require("node:assert/strict");
const { createBot } = require("../bot");
const { WEBHOOK_PATH, createHttpServer, listen } = require("../server");

async function startTestServer(webhookHandler) {
  const logger = { log() {}, error() {} };
  const server = createHttpServer({ webhookHandler, logger });
  await listen(server, 0, "127.0.0.1");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function createTestBot() {
  const bot = createBot({
    token: "123456:test-token",
    ownerId: 42,
    expenseStore: {
      async getSheetSum() {
        return 0;
      },
      async hasExpense() {
        return false;
      },
      async appendExpense() {
        return { duplicate: false };
      },
    },
    async recognizeReceiptFromPhoto() {
      throw new Error("OpenAI must not be called by this test");
    },
  });
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: "Test",
    username: "test_bot",
  };
  return bot;
}

test("GET /healthz returns 200", async (t) => {
  const { server, baseUrl } = await startTestServer(async () => {});
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("GET /health is a Cloud Run-compatible health alias", async (t) => {
  const { server, baseUrl } = await startTestServer(async () => {});
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("webhook rejects an invalid Telegram secret", async (t) => {
  const bot = createTestBot();
  const handler = bot.webhookCallback(WEBHOOK_PATH, {
    secretToken: "correct-secret",
  });
  const { server, baseUrl } = await startTestServer(handler);
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "wrong-secret",
    },
    body: JSON.stringify({ update_id: 1 }),
  });

  assert.equal(response.status, 403);
});

test("webhook accepts a valid Telegram secret", async (t) => {
  const bot = createTestBot();
  const handler = bot.webhookCallback(WEBHOOK_PATH, {
    secretToken: "correct-secret",
  });
  const { server, baseUrl } = await startTestServer(handler);
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "correct-secret",
    },
    body: JSON.stringify({
      update_id: 2,
      message: {
        message_id: 10,
        date: 1_700_000_000,
        text: "обычное сообщение",
        chat: { id: 42, type: "private", first_name: "Owner" },
        from: { id: 42, is_bot: false, first_name: "Owner" },
      },
    }),
  });

  assert.equal(response.status, 200);
});

test("webhook acknowledges an update when processing fails", async (t) => {
  const { server, baseUrl } = await startTestServer(async (_req, res) => {
    // Telegraf ends its response in a finally block, even when a handler throws.
    res.end();
    throw new Error("processing failed");
  });
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
    method: "POST",
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});
