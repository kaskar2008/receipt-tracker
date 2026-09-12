const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../config");

const baseEnv = {
  BOT_TOKEN: "token",
  OPENAI_API_KEY: "openai",
  GOOGLE_CLIENT_EMAIL: "bot@example.iam.gserviceaccount.com",
  GOOGLE_PRIVATE_KEY: "line 1\\nline 2",
  SPREADSHEET_ID: "sheet",
  OWNER_ID: "42",
  WEBHOOK_SECRET: "secret",
  NODE_ENV: "test",
};

test("config supports escaped newlines in GOOGLE_PRIVATE_KEY", () => {
  assert.equal(loadConfig(baseEnv).googleCredentials.private_key, "line 1\nline 2");
});

test("config supports real newlines in GOOGLE_PRIVATE_KEY", () => {
  const env = { ...baseEnv, GOOGLE_PRIVATE_KEY: "line 1\nline 2" };
  assert.equal(loadConfig(env).googleCredentials.private_key, "line 1\nline 2");
});

test("config reports missing variable names without their values", () => {
  const env = { ...baseEnv, BOT_TOKEN: "" };
  assert.throws(() => loadConfig(env), /BOT_TOKEN/);
});
