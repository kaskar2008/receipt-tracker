const { auth, sheets } = require("@googleapis/sheets");

const createAuth = (googleCredentials) =>
  new auth.JWT({
    email: googleCredentials.client_email,
    key: googleCredentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

const createSheets = (googleCredentials) =>
  sheets({ version: "v4", auth: createAuth(googleCredentials) });

module.exports = { createSheets };
