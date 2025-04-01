const { Telegraf } = require("telegraf");
const { createSheets } = require("./google-client");
const { botToken } = require("./config");
const { appendExpense, getSheetSum } = require("./sheets");
const { recognizeReceiptFromPhoto } = require("./openai-vision");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
require("dayjs/locale/ru");

dayjs.extend(customParseFormat);
dayjs.locale("ru");

const sheets = createSheets();
const bot = new Telegraf(botToken);
const ownerId = parseInt(process.env.OWNER_ID, 10);

async function isOwnerInChat(ctx) {
  if (ctx.chat.type === "private") {
    return ctx.from.id === ownerId;
  }

  try {
    const members = await ctx.getChatAdministrators();
    return members.some((m) => m.user.id === ownerId);
  } catch (err) {
    console.error("Не удалось получить админов чата:", err);
    return false;
  }
}

bot.command("sum", async (ctx) => {
  const isAllowed = await isOwnerInChat(ctx);
  if (!isAllowed) {
    return ctx.reply("Я работаю только в чатах, где есть владелец.");
  }

  try {
    const total = await getSheetSum(sheets, ctx.chat);
    ctx.reply(`Сумма всех трат: ${total}`);
  } catch (err) {
    console.error("Ошибка получения суммы:", err);
    ctx.reply(
      "Не удалось получить сумму. Убедись, что бот уже записывал траты."
    );
  }
});

bot.on("photo", async (ctx) => {
  const isAllowed = await isOwnerInChat(ctx);

  const caption = ctx.message.caption?.trim();
  if (!caption) return;

  const lines = caption
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0 || lines[0].toLowerCase() !== "трата") {
    return; // не обрабатываем, если первая строка — не "трата"
  }

  if (!isAllowed) {
    return ctx.reply("Я работаю только в чатах, где есть владелец.");
  }

  try {
    // получаем самую большую версию фото
    const fileId = ctx.message.photo.pop().file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const dummyMessage = await ctx.reply(
      "Обрабатываю чек, подожди немного...",
      {
        reply_parameters: { message_id: ctx.message.message_id },
      }
    );

    const result = await recognizeReceiptFromPhoto(fileLink.href);

    if (!result || !result.total) {
      return ctx.reply("Не удалось распознать чек.");
    }

    const items = result.items
      .map((el) => `${el.name} --- ${el.price}`)
      .join("\n");

    const description = lines[1] || `Чек (распознан)\n\n${items}`;

    // записываем в таблицу
    await appendExpense(sheets, {
      chat: ctx.chat,
      date: result.date || new Date().toISOString().split("T")[0],
      amount: result.total,
      description,
      source: "photo",
    });

    let msg = `🧾 Чек распознан!\n\nДата: ${
      result.date || "не найдена"
    }\nСумма: ${result.total}₸`;
    if (description || result.items?.length) {
      msg += description
        ? `\n\n${description}`
        : "\n\nПозиции:\n" +
          result.items.map((i) => `• ${i.name} — ${i.price}₸`).join("\n");
    }

    await ctx.reply(msg, {
      reply_parameters: { message_id: ctx.message.message_id },
    });

    ctx.deleteMessage(dummyMessage.message_id);
  } catch (err) {
    console.error("Ошибка при обработке чека:", err);
    ctx.reply("Произошла ошибка при распознавании чека.", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  }
});

bot.on("message", async (ctx) => {
  const isAllowed = await isOwnerInChat(ctx);
  if (!isAllowed || !ctx.text) {
    return ctx.reply("Я работаю только в чатах, где есть владелец.");
  }

  const text = ctx.text;

  if (!text.startsWith("трата") && !text.startsWith("Трата")) return;

  const parts = text
    .replace(/трата/i, "")
    .trim()
    .split(/\n/)
    .filter((el) => !!el);

  if (parts.length < 2) {
    return ctx.reply(
      'Неверный формат. Пример: "еда 1500" или "еда 1500 29.03"',
      {
        reply_parameters: { message_id: ctx.message.message_id },
      }
    );
  }

  const [description, amountStr, dateStr] = parts;
  const amount = parseFloat(amountStr);

  if (!description || isNaN(amount)) {
    return ctx.reply(
      'Неверный формат. Пример: "еда 1500" или "еда 1500 29.03"',
      {
        reply_parameters: { message_id: ctx.message.message_id },
      }
    );
  }

  let date = dayjs();

  if (dateStr) {
    const parsed = dayjs(dateStr, [
      "DD.MM",
      "DD MMMM",
      "DD/MM",
      "DD MMMM YYYY",
      "DD.MM.YYYY",
    ]);

    if (parsed.isValid()) {
      date = parsed.year(date.year());
    } else {
      return ctx.reply('Неверная дата. Пример: "еда 1500 29.03"', {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  }

  const dummyMessage = await ctx.reply("Записываю трату...", {
    reply_parameters: { message_id: ctx.message.message_id },
  });

  try {
    await appendExpense(sheets, {
      chat: ctx.chat,
      date: date.format("YYYY-MM-DD"),
      amount,
      description,
      source: "text",
    });
  } catch (error) {
    console.error(error);
    return ctx.reply("Ошибка сохранения, попробуйте позже", {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  }

  await ctx.reply("Трата записана!", {
    reply_parameters: { message_id: ctx.message.message_id },
  });

  ctx.deleteMessage(dummyMessage.message_id);
});

bot.launch();
