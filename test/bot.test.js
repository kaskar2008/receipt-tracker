const test = require("node:test");
const assert = require("node:assert/strict");
const { Telegram } = require("telegraf");
const { createBot } = require("../bot");

function textExpenseUpdate(updateId) {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      date: 1_700_000_000,
      text: "трата\nеда\n1500",
      chat: { id: 42, type: "private", first_name: "Owner" },
      from: { id: 42, is_bot: false, first_name: "Owner" },
    },
  };
}

function photoExpenseUpdate(updateId, caption = "трата") {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      date: 1_700_000_000,
      caption,
      photo: [
        { file_id: "small", file_unique_id: "small-unique", width: 90, height: 90 },
        { file_id: "large", file_unique_id: "large-unique", width: 800, height: 1200 },
      ],
      chat: { id: 42, type: "private", first_name: "Owner" },
      from: { id: 42, is_bot: false, first_name: "Owner" },
    },
  };
}

function mockTelegram(t) {
  const apiCalls = [];
  const originalCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async (method, payload) => {
    apiCalls.push({ method, payload });
    if (method === "getFile") {
      return { file_id: payload.file_id, file_path: "photos/receipt.jpg" };
    }
    if (method === "sendMessage") return { message_id: apiCalls.length };
    return true;
  };
  t.after(() => {
    Telegram.prototype.callApi = originalCallApi;
  });
  return apiCalls;
}

function createPhotoBot(recognitionResult, appendExpense) {
  const bot = createBot({
    token: "123456:test-token",
    ownerId: 42,
    expenseStore: {
      async hasExpense() {
        return false;
      },
      appendExpense,
      async getSheetSum() {
        return 0;
      },
    },
    async recognizeReceiptFromPhoto() {
      return recognitionResult;
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

test("a failed expense update is acknowledged and answered only once", async (t) => {
  let appendCalls = 0;
  const apiCalls = [];
  const originalCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async (method, payload) => {
    apiCalls.push({ method, payload });
    if (method === "sendMessage") return { message_id: apiCalls.length };
    return true;
  };
  t.after(() => {
    Telegram.prototype.callApi = originalCallApi;
  });

  const bot = createBot({
    token: "123456:test-token",
    ownerId: 42,
    expenseStore: {
      async hasExpense() {
        return false;
      },
      async appendExpense() {
        appendCalls += 1;
        throw new Error("Sheets unavailable");
      },
      async getSheetSum() {
        return 0;
      },
    },
    async recognizeReceiptFromPhoto() {
      throw new Error("not used");
    },
  });
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: "Test",
    username: "test_bot",
  };
  const update = textExpenseUpdate(777);
  await bot.handleUpdate(update);
  await bot.handleUpdate(update);

  assert.equal(appendCalls, 1);
  assert.equal(
    apiCalls.filter(
      ({ method, payload }) =>
        method === "sendMessage" &&
        payload.text === "Ошибка сохранения, попробуйте позже"
    ).length,
    1
  );
});

test("a recognized expense description is saved as the receipt comment", async (t) => {
  mockTelegram(t);
  let savedExpense;
  const bot = createPhotoBot(
    {
      date: "2020-07-08",
      total: 4200,
      description: "Кафе",
      items: [{ name: "Лапша", price: 4200 }],
    },
    async (expense) => {
      savedExpense = expense;
      return { duplicate: false };
    }
  );

  await bot.handleUpdate(photoExpenseUpdate(778));

  assert.equal(savedExpense.description, "Кафе");
});

test("receipt items are used when the expense type is unknown", async (t) => {
  mockTelegram(t);
  let savedExpense;
  const bot = createPhotoBot(
    {
      date: "2020-07-08",
      total: 4200,
      description: null,
      items: [
        { name: "Позиция 1", price: 1500 },
        { name: "Позиция 2", price: 2700 },
      ],
    },
    async (expense) => {
      savedExpense = expense;
      return { duplicate: false };
    }
  );

  await bot.handleUpdate(photoExpenseUpdate(779));

  assert.equal(
    savedExpense.description,
    "Чек (распознан)\n\nПозиция 1 --- 1500\nПозиция 2 --- 2700"
  );
});

test("a manual receipt comment overrides the recognized description", async (t) => {
  mockTelegram(t);
  let savedExpense;
  const bot = createPhotoBot(
    {
      date: "2020-07-08",
      total: 4200,
      description: "Кафе",
      items: [{ name: "Лапша", price: 4200 }],
    },
    async (expense) => {
      savedExpense = expense;
      return { duplicate: false };
    }
  );

  await bot.handleUpdate(photoExpenseUpdate(780, "трата\nОбед с коллегами"));

  assert.equal(savedExpense.description, "Обед с коллегами");
});

test("a forum topic creation service message is ignored", async (t) => {
  const apiCalls = [];
  const originalCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async (method, payload) => {
    apiCalls.push({ method, payload });
    if (method === "getChatAdministrators") {
      return [{ user: { id: 42 } }];
    }
    if (method === "sendMessage") return { message_id: apiCalls.length };
    return true;
  };
  t.after(() => {
    Telegram.prototype.callApi = originalCallApi;
  });

  const bot = createPhotoBot(null, async () => ({ duplicate: false }));
  await bot.handleUpdate({
    update_id: 781,
    message: {
      message_id: 11,
      message_thread_id: 100,
      date: 1_700_000_000,
      is_topic_message: true,
      forum_topic_created: { name: "Новый топик", icon_color: 7_322_096 },
      chat: {
        id: -100123456,
        type: "supergroup",
        title: "Test group",
        is_forum: true,
      },
      from: { id: 42, is_bot: false, first_name: "Owner" },
    },
  });

  assert.equal(
    apiCalls.filter(({ method }) => method === "sendMessage").length,
    0
  );
  assert.equal(
    apiCalls.filter(({ method }) => method === "getChatAdministrators").length,
    0
  );
});
