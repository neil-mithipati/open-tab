import { GoogleGenAI, Type, createPartFromBase64, createPartFromText } from "@google/genai";
import type { Schema } from "@google/genai";
import type { ParsedReceipt } from "@/types";

const MODEL = "gemini-2.5-flash-lite";

const PROMPT = `You are a receipt parser. Extract all information from this receipt image and return a single JSON object — nothing else, no markdown fences.

JSON schema:
{
  "merchant_name": string | null,
  "date_of_receipt": "YYYY-MM-DD" | null,
  "items": [{ "name": string, "price": number, "quantity": number }],
  "subtotal": number | null,
  "tax": number | null,
  "tip": number | null,
  "total": number | null
}

Rules:
- All monetary values are plain numbers in USD (no $ sign).
- price is the per-unit price; set quantity accordingly if item shows multiple.
- If a value is unreadable, use null.
- Do not include keys outside the schema or any extra text.`;

// Enforced through the API's `config.responseSchema`, not just the prompt
// text above — the prompt's copy stays as reinforcement, but this is what
// actually constrains the model's output. Mirrors ParsedReceipt in
// src/types exactly.
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    merchant_name: { type: Type.STRING, nullable: true },
    date_of_receipt: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          price: { type: Type.NUMBER },
          quantity: { type: Type.NUMBER },
        },
        required: ["name", "price", "quantity"],
      },
    },
    subtotal: { type: Type.NUMBER, nullable: true },
    tax: { type: Type.NUMBER, nullable: true },
    tip: { type: Type.NUMBER, nullable: true },
    total: { type: Type.NUMBER, nullable: true },
  },
  required: [
    "merchant_name",
    "date_of_receipt",
    "items",
    "subtotal",
    "tax",
    "tip",
    "total",
  ],
};

const EMPTY: ParsedReceipt = {
  merchant_name: null,
  date_of_receipt: null,
  items: [],
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
};

export async function parseReceiptImage(
  imageBase64: string,
  mimeType: string
): Promise<ParsedReceipt> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      createPartFromBase64(imageBase64, mimeType),
      createPartFromText(PROMPT),
    ],
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = (response.text ?? "").trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as ParsedReceipt;
  } catch {
    return EMPTY;
  }
}
