function sheetTitleForChat(chat) {
  return `${chat.title}${chat.id}`;
}

function sheetRange(sheetTitle, cells) {
  return `'${sheetTitle.replace(/'/g, "''")}'!${cells}`;
}

function createExpenseStore({ sheets, spreadsheetId }) {
  async function ensureSheetExists(sheetTitle) {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = res.data.sheets.some(
      (sheet) => sheet.properties.title === sheetTitle
    );

    if (sheetExists) return;

    const addSheetRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      },
    });

    const sheetId = addSheetRes.data.replies[0].addSheet.properties.sheetId;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(sheetTitle, "A1"),
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [
          [
            "Дата",
            "Сумма",
            "Комментарий",
            "Источник",
            "Update ID",
            "",
            "",
            "=SUM(B2:B)",
          ],
        ],
      },
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startColumnIndex: 1,
                endColumnIndex: 2,
                startRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: "NUMBER", pattern: "#,##0.00₸" },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startColumnIndex: 7,
                endColumnIndex: 8,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: "NUMBER", pattern: "#,##0.00₸" },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ],
      },
    });
  }

  async function hasExpense(chat, updateId) {
    if (updateId === undefined || updateId === null) return false;

    const sheetTitle = sheetTitleForChat(chat);
    await ensureSheetExists(sheetTitle);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetRange(sheetTitle, "E2:E"),
    });
    const expected = String(updateId);
    return (res.data.values || []).some((row) => String(row[0]) === expected);
  }

  async function getSheetSum(chat) {
    const sheetTitle = sheetTitleForChat(chat);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetRange(sheetTitle, "H1"),
    });

    return res.data.values?.[0]?.[0] || 0;
  }

  async function appendExpense({
    chat,
    date,
    amount,
    description,
    source,
    updateId,
  }) {
    const sheetTitle = sheetTitleForChat(chat);
    await ensureSheetExists(sheetTitle);

    if (await hasExpense(chat, updateId)) {
      return { duplicate: true };
    }

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange(sheetTitle, "A:E"),
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [[date, amount, description, source, updateId]],
      },
    });

    return { duplicate: false, response };
  }

  return { appendExpense, getSheetSum, hasExpense };
}

module.exports = { createExpenseStore, sheetTitleForChat };
