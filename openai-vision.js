const { OpenAI } = require("openai");

function createReceiptRecognizer(apiKey) {
  const openai = new OpenAI({ apiKey });

  return async function recognizeReceiptFromPhoto(photoUrl) {
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      messages: [
        {
          role: "system",
          content:
            "Ты помощник, который читает чеки, извлекает данные и кратко определяет тип траты.",
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
- краткое описание траты на русском языке по содержимому чека

В финале верни только JSON строго в следующем виде:

{
  "date": "2025-03-30",
  "total": 2475,
  "description": "Кафе",
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
- Для description определи понятный тип траты по позициям, например: "Кафе", "Продукты", "Аптека", "Такси", "Одежда" или "Товары для дома".
- Не угадывай без достаточных оснований. Если тип траты определить нельзя, верни description: null.
- Если других данных не видно — верни null или пустой массив.
- Не добавляй пояснений. Верни только JSON без форматирования, в RAW формате.
`,
            },
            { type: "image_url", image_url: { url: photoUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "receipt",
          strict: true,
          schema: {
            type: "object",
            properties: {
              date: { type: ["string", "null"] },
              total: { type: ["number", "null"] },
              description: { type: ["string", "null"] },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    price: { type: "number" },
                  },
                  required: ["name", "price"],
                  additionalProperties: false,
                },
              },
            },
            required: ["date", "total", "description", "items"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 1000,
    });

    const text = response.choices[0].message.content;
    try {
      return JSON.parse(text);
    } catch (error) {
      console.error("Не удалось распарсить JSON-ответ OpenAI");
      return null;
    }
  };
}

module.exports = { createReceiptRecognizer };
