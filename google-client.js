const { google } = require("googleapis");
const { googleCredentials } = require("./config");

const createAuth = () =>
  new google.auth.JWT(
    googleCredentials.client_email,
    null,
    googleCredentials.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

const createSheets = () => google.sheets({ version: "v4", auth: createAuth() });

module.exports = { createSheets };
