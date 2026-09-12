const { Telegraf } = require("telegraf");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
require("dayjs/locale/ru");

dayjs.extend(customParseFormat);
dayjs.locale("ru");

function createBot({ token, ownerId, expenseStore, recognizeReceiptFromPhoto }) {
  const bot = new Telegraf(token);
  // Send replies through the Bot API immediately. The webhook response is kept
  // exclusively as Telegram's delivery acknowledgement.
  bot.telegram.webhookReply = false;

  // Telegram reuses update_id when it redelivers a webhook. Keep a bounded
  // in-process cache so an already accepted update cannot produce duplicate
  // replies while this instance is alive. Successfully saved expenses are
  // additionally deduplicated persistently by the Sheets store.
  const recentUpdateIds = new Set();
  const maxRecentUpdateIds = 10_000;
  bot.use(async (ctx, next) => {
    const updateId = ctx.update?.update_id;
    if (updateId === undefined || updateId === null) return next();
    if (recentUpdateIds.has(updateId)) return;

    recentUpdateIds.add(updateId);
    if (recentUpdateIds.size > maxRecentUpdateIds) {
      recentUpdateIds.delete(recentUpdateIds.values().next().value);
    }

    return next();
  });

  async function isOwnerInChat(ctx) {
    if (ctx.chat.type === "private") return ctx.from.id === ownerId;

    try {
      const members = await ctx.getChatAdministrators();
      return members.some((member) => member.user.id === ownerId);
    } catch (error) {
      console.error("Не удалось получить админов чата:", error);
      return false;
    }
  }

  bot.command("sum", async (ctx) => {
    const isAllowed = await isOwnerInChat(ctx);
    if (!isAllowed) {
      return ctx.reply("Я работаю только в чатах, где есть владелец.");
    }

    try {
      const total = await expenseStore.getSheetSum(ctx.chat);
      await ctx.reply(`Сумма всех трат: ${total}`);
    } catch (error) {
      console.error("Ошибка получения суммы:", error);
      await ctx.reply(
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
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0 || lines[0].toLowerCase() !== "трата") return;
    if (!isAllowed) {
      return ctx.reply("Я работаю только в чатах, где есть владелец.");
    }

    const updateId = ctx.update.update_id;
    let dummyMessage;
    try {
      if (await expenseStore.hasExpense(ctx.chat, updateId)) return;

      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      dummyMessage = await ctx.reply(
        "Обрабатываю чек, подожди немного...",
        { reply_parameters: { message_id: ctx.message.message_id } }
      );

      const result = await recognizeReceiptFromPhoto(fileLink.href);
      if (!result || !result.total) {
        return ctx.reply("Не удалось распознать чек.");
      }

      const items = (result.items || [])
        .map((item) => `${item.name} --- ${item.price}`)
        .join("\n");
      const recognizedDescription =
        typeof result.description === "string"
          ? result.description.trim()
          : "";
      const description =
        lines[1] ||
        recognizedDescription ||
        `Чек (распознан)\n\n${items}`;

      const saved = await expenseStore.appendExpense({
        chat: ctx.chat,
        date: result.date || new Date().toISOString().split("T")[0],
        amount: result.total,
        description,
        source: "photo",
        updateId,
      });
      if (saved.duplicate) return;

      let message = `🧾 Чек распознан!\n\nДата: ${
        result.date || "не найдена"
      }\nСумма: ${result.total}₸`;
      if (description || result.items?.length) {
        message += description
          ? `\n\n${description}`
          :
            "\n\nПозиции:\n" +
            result.items
              .map((item) => `• ${item.name} — ${item.price}₸`)
              .join("\n");
      }

      await ctx.reply(message, {
        reply_parameters: { message_id: ctx.message.message_id },
      });
      await ctx.deleteMessage(dummyMessage.message_id).catch(() => {});
    } catch (error) {
      console.error("Ошибка при обработке чека:", error);
      if (dummyMessage) {
        await ctx.deleteMessage(dummyMessage.message_id).catch(() => {});
      }
      try {
        await ctx.reply("Произошла ошибка при распознавании чека.", {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      } catch (replyError) {
        console.error("Не удалось отправить сообщение об ошибке:", replyError);
      }
    }
  });

  bot.on("message", async (ctx) => {
    // Telegram sends topic creation and other service events as messages
    // without text. They are unrelated to expenses and must be ignored.
    if (!ctx.text) return;

    const text = ctx.text;
    if (!text.startsWith("трата") && !text.startsWith("Трата")) return;

    const isAllowed = await isOwnerInChat(ctx);
    if (!isAllowed) {
      return ctx.reply("Я работаю только в чатах, где есть владелец.");
    }

    const parts = text
      .replace(/трата/i, "")
      .trim()
      .split(/\n/)
      .filter(Boolean);

    if (parts.length < 2) {
      return ctx.reply(
        'Неверный формат. Пример: "еда 1500" или "еда 1500 29.03"',
        { reply_parameters: { message_id: ctx.message.message_id } }
      );
    }

    const [description, amountStr, dateStr] = parts;
    const amount = Number.parseFloat(amountStr);
    if (!description || Number.isNaN(amount)) {
      return ctx.reply(
        'Неверный формат. Пример: "еда 1500" или "еда 1500 29.03"',
        { reply_parameters: { message_id: ctx.message.message_id } }
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

    const updateId = ctx.update.update_id;
    let dummyMessage;
    try {
      if (await expenseStore.hasExpense(ctx.chat, updateId)) return;

      dummyMessage = await ctx.reply("Записываю трату...", {
        reply_parameters: { message_id: ctx.message.message_id },
      });
      const saved = await expenseStore.appendExpense({
        chat: ctx.chat,
        date: date.format("YYYY-MM-DD"),
        amount,
        description,
        source: "text",
        updateId,
      });
      if (saved.duplicate) return;

      await ctx.reply("Трата записана!", {
        reply_parameters: { message_id: ctx.message.message_id },
      });
      await ctx.deleteMessage(dummyMessage.message_id).catch(() => {});
    } catch (error) {
      console.error("Ошибка сохранения траты:", error);
      if (dummyMessage) {
        await ctx.deleteMessage(dummyMessage.message_id).catch(() => {});
      }
      try {
        await ctx.reply("Ошибка сохранения, попробуйте позже", {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      } catch (replyError) {
        console.error("Не удалось отправить сообщение об ошибке:", replyError);
      }
    }
  });

  return bot;
}

module.exports = { createBot };
