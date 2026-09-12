const test = require("node:test");
const assert = require("node:assert/strict");
const { createExpenseStore } = require("../sheets");

test("a repeated update_id is appended to Google Sheets only once", async () => {
  const updateIds = [];
  const appendCalls = [];
  const sheets = {
    spreadsheets: {
      async get() {
        return {
          data: { sheets: [{ properties: { title: "Family-100" } }] },
        };
      },
      async batchUpdate() {
        throw new Error("existing sheet must not be recreated");
      },
      values: {
        async get({ range }) {
          assert.match(range, /!E2:E$/);
          return { data: { values: updateIds.map((id) => [id]) } };
        },
        async append(options) {
          appendCalls.push(options);
          updateIds.push(options.resource.values[0][4]);
          return { data: { updates: { updatedRows: 1 } } };
        },
      },
    },
  };
  const store = createExpenseStore({ sheets, spreadsheetId: "sheet-id" });
  const expense = {
    chat: { id: -100, title: "Family" },
    date: "2026-09-12",
    amount: 1500,
    description: "еда",
    source: "text",
    updateId: 987654,
  };

  const first = await store.appendExpense(expense);
  const repeated = await store.appendExpense(expense);

  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(appendCalls.length, 1);
  assert.deepEqual(appendCalls[0].resource.values, [
    ["2026-09-12", 1500, "еда", "text", 987654],
  ]);
  assert.match(appendCalls[0].range, /!A:E$/);
});
