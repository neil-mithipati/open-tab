import { GoogleGenAI, Type, createPartFromBase64, createPartFromText } from "@google/genai";
import type { Schema } from "@google/genai";
import { z } from "zod";
import { toCents, toCentsOrNull } from "@/lib/money";
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

// ===========================================================================
// Validation.
//
// responseSchema constrains the model but does not guarantee the reply is
// usable: it can still come back as an unparseable body, as every field null,
// or with a total of NaN. Until this change, a reply that failed JSON.parse
// was swallowed and returned as an all-nulls object the rest of the app could
// not tell apart from a receipt that genuinely had nothing on it — so a failed
// parse was persisted as a clean one. Nothing is returned from here now unless
// it validates; everything else throws.
//
// Two schemas, deliberately:
//
//   modelReceiptSchema        what Gemini sends — plain USD numbers. Validated
//                             once, then converted to cents.
//   parsedReceiptCentsSchema  what crosses into the database write path —
//                             integer cents. Re-checked at the write site in
//                             the parse route, which is the thing that must
//                             never be handed a float.
// ===========================================================================

export type ReceiptParseFailure = "malformed_json" | "schema" | "empty";

export class ReceiptParseError extends Error {
  readonly reason: ReceiptParseFailure;

  constructor(reason: ReceiptParseFailure, message: string) {
    super(message);
    // isTransientModelFailure in the parse route reads `name`; this must not
    // look like an AbortError or a provider 5xx, because it is neither. The
    // model answered and was paid for — there is nothing to retry.
    this.name = "ReceiptParseError";
    this.reason = reason;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const finiteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "must be a finite number" });

// Line prices are signed: a discount or coupon line is a real negative price
// and rejecting it would fail the whole receipt over a coupon.
const lineDollars = finiteNumber;
// Aggregates are not. A receipt whose subtotal or total is negative is not one
// this app can charge anybody for, and the split allocation is not defined for
// it.
const aggregateDollars = finiteNumber.refine((n) => n >= 0, {
  message: "must not be negative",
});

const modelReceiptSchema = z.object({
  merchant_name: z.string().nullish(),
  date_of_receipt: z.string().nullish(),
  items: z.array(
    z.object({
      name: z.string(),
      price: lineDollars,
      quantity: finiteNumber,
    })
  ),
  subtotal: aggregateDollars.nullish(),
  tax: aggregateDollars.nullish(),
  tip: aggregateDollars.nullish(),
  total: aggregateDollars.nullish(),
});

const centsAggregate = z.int().min(0).nullable();

/**
 * The shape allowed into the database write path: integer cents, nothing
 * fractional, nothing NaN, and not empty.
 */
export const parsedReceiptCentsSchema = z
  .object({
    merchant_name: z.string().nullable(),
    date_of_receipt: z.string().regex(ISO_DATE).nullable(),
    items: z.array(
      z.object({
        name: z.string(),
        price: z.int(),
        quantity: z.int().min(1),
      })
    ),
    subtotal: centsAggregate,
    tax: centsAggregate,
    tip: centsAggregate,
    total: centsAggregate,
  })
  // The all-nulls reply. Valid JSON, schema-shaped, and worth nothing: no line
  // items and no total means there is no receipt here, whatever the model
  // said. Refused rather than written, so it can never be read back later as a
  // receipt that parsed cleanly and simply had no values on it.
  .refine((r) => r.items.length > 0 || r.total !== null, {
    message: "no line items and no total — nothing was read off this receipt",
  });

// A date that is not YYYY-MM-DD cannot go into a `date` column, and one bad
// date should not cost the whole receipt. Anything unparseable becomes null
// and the user fills it in.
function isoDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : raw;
}

function cleanText(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

// A quantity is a count of things. Zero would erase a line the model did read
// and a fraction is not something this app can assign to a person, so both are
// normalised rather than rejected. The arithmetic then has to hold, and the
// reconciliation check is what notices if it does not.
function normaliseQuantity(raw: number): number {
  return Math.max(1, Math.round(raw));
}

/**
 * Validate a decoded model reply and convert it to integer cents. Throws
 * ReceiptParseError on anything that must not be persisted.
 */
export function validateModelReceipt(raw: unknown): ParsedReceipt {
  const model = modelReceiptSchema.safeParse(raw);
  if (!model.success) {
    throw new ReceiptParseError(
      "schema",
      `model reply failed validation: ${model.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`
    );
  }

  const receipt: ParsedReceipt = {
    merchant_name: cleanText(model.data.merchant_name),
    date_of_receipt: isoDate(model.data.date_of_receipt),
    items: model.data.items.map((item) => ({
      // The column is NOT NULL and an unnamed line still carries a price, so
      // it keeps its place in the arithmetic under a placeholder rather than
      // being dropped out of the subtotal.
      name: cleanText(item.name) ?? "Item",
      price: toCents(item.price),
      quantity: normaliseQuantity(item.quantity),
    })),
    subtotal: toCentsOrNull(model.data.subtotal),
    tax: toCentsOrNull(model.data.tax),
    tip: toCentsOrNull(model.data.tip),
    total: toCentsOrNull(model.data.total),
  };

  const cents = parsedReceiptCentsSchema.safeParse(receipt);
  if (!cents.success) {
    throw new ReceiptParseError(
      "empty",
      `parsed receipt is not usable: ${cents.error.issues
        .map((i) => i.message)
        .join("; ")}`
    );
  }

  return receipt;
}

/**
 * Parse a receipt photo. Money comes back as INTEGER CENTS — see
 * src/lib/money.ts for the rounding rule, which is applied here, once, and
 * nowhere downstream.
 *
 * Throws ReceiptParseError when the reply cannot be trusted. It does not
 * return an empty receipt: a caller cannot tell that apart from a real one,
 * and the parse route's write-back would have persisted it as clean.
 */
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

  let decoded: unknown;
  try {
    decoded = JSON.parse(cleaned);
  } catch {
    throw new ReceiptParseError(
      "malformed_json",
      "model reply was not valid JSON"
    );
  }

  return validateModelReceipt(decoded);
}
