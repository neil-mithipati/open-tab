import { GoogleGenAI, createPartFromBase64, createPartFromText } from "@google/genai";
import type { ParsedReceipt } from "@/types";

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
    model: "gemini-2.5-flash",
    contents: [
      createPartFromBase64(imageBase64, mimeType),
      createPartFromText(PROMPT),
    ],
  });

  const text = (response.text ?? "").trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as ParsedReceipt;
  } catch {
    return EMPTY;
  }
}
