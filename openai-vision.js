const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function recognizeReceiptFromPhoto(photoUrl) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Ты помощник, который читает чеки и возвращает дату, итоговую сумму и список позиций в формате JSON.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
На изображении — чек из магазина, кафе или сервиса. Твоя задача — извлечь из него:

- итоговую сумму к оплате (именно итоговую, не НДС, не скидки)
- дату покупки
- список покупок: название и цена

В финале верни только JSON строго в следующем виде:

{
  "date": "2025-03-30",
  "total": 2475,
  "items": [
    { "name": "Круассан", "price": 550 },
    { "name": "Капучино", "price": 800 },
    { "name": "Печенье", "price": 1125 }
  ]
}

Важно:
- Итоговая сумма должна быть той, что написана в строке вроде "ИТОГО", "К ОПЛАТЕ", "Всего".
- Если указаны НДС, скидки, сдача — не используй их как итог.
- Иногда возле итоговой суммы указывается итоговый НДС - игнорируй такую строку, бери только строку суммы где написано например "итого" или "сумма"
- Названия товаров пиши коротко, без артикулов.
- Если чего-то не видно — верни null или пустой массив.
- Не добавляй пояснений. Верни только JSON без форматирования, в RAW формате.
`,
          },
          {
            type: "image_url",
            image_url: {
              url: photoUrl,
            },
          },
        ],
      },
    ],
    max_tokens: 1000,
  });

  const text = response.choices[0].message.content;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Не удалось распарсить JSON:", text);
    return null;
  }
}

module.exports = { recognizeReceiptFromPhoto };
