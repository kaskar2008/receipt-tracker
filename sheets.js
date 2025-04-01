const { spreadsheetId } = require("./config");

async function ensureSheetExists(sheets, sheetTitle) {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetExists = res.data.sheets.some(
    (s) => s.properties.title === sheetTitle
  );

  if (!sheetExists) {
    // 1. Создаём лист
    const addSheetRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            addSheet: {
              properties: { title: sheetTitle },
            },
          },
        ],
      },
    });

    const sheetId = addSheetRes.data.replies[0].addSheet.properties.sheetId;

    // 2. Добавляем заголовки в A1
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [
          [
            "Дата",
            "Сумма",
            "Комментарий",
            "Источник",
            "",
            "",
            "",
            "=SUM(B2:B)",
          ],
        ],
      },
    });

    // 3. Форматирование: колонка B и ячейка H1 как денежные
    return sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startColumnIndex: 1, // колонка B
                endColumnIndex: 2,
                startRowIndex: 1, // начиная со строки 2, чтобы не трогать заголовок
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: "NUMBER",
                    pattern: "#,##0.00₸", // формат с валютой
                  },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startColumnIndex: 7, // колонка H
                endColumnIndex: 8,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: "NUMBER",
                    pattern: "#,##0.00₸",
                  },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ],
      },
    });
  }
}

async function getSheetSum(sheets, chat) {
  const sheetTitle = `${chat.title}${chat.id}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetTitle}!H1`,
  });

  const value = res.data.values?.[0]?.[0];
  return value || 0;
}

async function appendExpense(
  sheets,
  { chat, date, amount, description, source }
) {
  await ensureSheetExists(sheets, `${chat.title}${chat.id}`);

  return sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${chat.title}${chat.id}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[date, amount, description, source]],
    },
  });
}

module.exports = { appendExpense, getSheetSum };
