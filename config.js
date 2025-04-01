require("dotenv").config();

module.exports = {
  botToken: process.env.BOT_TOKEN,
  spreadsheetId: process.env.SPREADSHEET_ID,
  googleCredentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
};
