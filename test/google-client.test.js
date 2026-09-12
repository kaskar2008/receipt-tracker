const test = require("node:test");
const assert = require("node:assert/strict");
const { createSheets } = require("../google-client");

test("Google Sheets client can be constructed from service-account fields", () => {
  const client = createSheets({
    client_email: "bot@example.iam.gserviceaccount.com",
    private_key: "not-used-until-a-request-is-sent",
  });

  assert.equal(typeof client.spreadsheets.values.get, "function");
  assert.equal(typeof client.spreadsheets.values.append, "function");
});
