import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// The read path that actually renders a receipt photograph to a browser.
//
// It is the one that mattered: getReceiptImageUrl signs with the service
// client, which bypasses RLS, so neither 0026's storage policies nor the
// receipts policies are in this path. The page authorises the VIEWER against
// the receipt (owner or participant) and then has to decide, separately, which
// OBJECT that receipt is allowed to name — and image_url is a column any user
// can write anything into for a receipt they own.
//
// The attack these tests refuse, end to end: a share link hands an anonymous
// claimer the victim's receipt id and the owner's venmo username;
// find_profile_by_venmo_username (granted to `authenticated` in 0015) turns the
// username into the owner's user id; objects are named
// `<user id>/<receipt id>.<ext>`; the attacker writes that name into their own
// receipt's image_url and opens their own receipt page, where they are
// legitimately the owner.

const getUser = vi.fn();
const getReceiptDetail = vi.fn();
const getReceiptImageUrl = vi.fn();
const getSharedReceipt = vi.fn();
const getClaimCharges = vi.fn();

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/queries", () => ({
  getReceiptDetail: (...args: unknown[]) => getReceiptDetail(...args),
  getReceiptImageUrl: (...args: unknown[]) => getReceiptImageUrl(...args),
}));

vi.mock("@/app/actions/claim", () => ({
  getSharedReceipt: (...args: unknown[]) => getSharedReceipt(...args),
  getClaimCharges: (...args: unknown[]) => getClaimCharges(...args),
}));

// Both leaves are client components with heavy trees; only the props they are
// handed matter here.
vi.mock("@/app/receipts/[id]/ReceiptEditPage", () => ({
  ReceiptEditPage: () => null,
}));
vi.mock("@/components/receipt/ClaimOwnerView", () => ({
  ClaimOwnerView: () => null,
}));

const { default: ReceiptDetailPage } = await import("@/app/receipts/[id]/page");

const ATTACKER = "22222222-2222-2222-2222-222222222222";
const OWNER = "11111111-1111-1111-1111-111111111111";
const ATTACKER_RECEIPT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VICTIM_RECEIPT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SIGN = "https://p.supabase.co/storage/v1/object/sign/receipt-images";

// The page's default export is a Suspense wrapper around the async component
// that does the work. React's client renderer cannot render an async component,
// so the test reaches through the boundary and awaits it directly — which is
// what a Server Components render does with it anyway.
async function renderPage(id: string): Promise<ReactElement> {
  const shell = ReceiptDetailPage({ params: Promise.resolve({ id }) }) as ReactElement<{
    children: ReactElement<Record<string, unknown>>;
  }>;
  const inner = shell.props.children;
  const content = inner.type as (props: unknown) => Promise<ReactElement>;
  return await content(inner.props);
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACKER_RECEIPT,
    created_by: ATTACKER,
    image_url: `${SIGN}/${ATTACKER}/${ATTACKER_RECEIPT}.jpg?token=live`,
    status: "open",
    share_token: null,
    merchant_name: "Cafe",
    date_of_receipt: "2026-08-19",
    subtotal: 10,
    tax: 1,
    tip: 2,
    total: 13,
    split_mode: "equal",
    ...overrides,
  };
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: ATTACKER } } });
  getReceiptImageUrl.mockResolvedValue("https://p.supabase.co/signed-by-the-service-key");
  getSharedReceipt.mockResolvedValue(null);
  getClaimCharges.mockResolvedValue([]);
  getReceiptDetail.mockResolvedValue({
    receipt: receipt(),
    items: [],
    participants: [],
  });
});

describe("the receipt page signs only the receipt's own object", () => {
  it("signs the photograph of a receipt that points at its own object", async () => {
    const el = await renderPage(ATTACKER_RECEIPT);

    expect(getReceiptImageUrl).toHaveBeenCalledWith(`${ATTACKER}/${ATTACKER_RECEIPT}.jpg`);
    expect((el.props as { seed: { signedUrl: string | null } }).seed.signedUrl).toBe(
      "https://p.supabase.co/signed-by-the-service-key"
    );
  });

  // The whole finding, in one test.
  it("produces no signed URL for a receipt pointing at another user's object", async () => {
    getReceiptDetail.mockResolvedValue({
      receipt: receipt({
        image_url: `${SIGN}/${OWNER}/${VICTIM_RECEIPT}.jpg?token=stolen`,
      }),
      items: [],
      participants: [],
    });

    const el = await renderPage(ATTACKER_RECEIPT);

    expect(getReceiptImageUrl).not.toHaveBeenCalled();
    expect((el.props as { seed: { signedUrl: string | null } }).seed.signedUrl).toBeNull();
  });

  it("produces no signed URL for a victim receipt id parked under the attacker's own folder", async () => {
    getReceiptDetail.mockResolvedValue({
      receipt: receipt({
        image_url: `${SIGN}/${ATTACKER}/${VICTIM_RECEIPT}.jpg?token=stolen`,
      }),
      items: [],
      participants: [],
    });

    const el = await renderPage(ATTACKER_RECEIPT);

    expect(getReceiptImageUrl).not.toHaveBeenCalled();
    expect((el.props as { seed: { signedUrl: string | null } }).seed.signedUrl).toBeNull();
  });

  // The other branch of the same page: the owner's view of a shared receipt
  // hands the image to ClaimOwnerView. It reads the same column and had the
  // same hole.
  it("refuses a foreign object on the shared-receipt owner view too", async () => {
    getReceiptDetail.mockResolvedValue({
      receipt: receipt({
        status: "shared",
        share_token: "tok",
        image_url: `${SIGN}/${OWNER}/${VICTIM_RECEIPT}.jpg?token=stolen`,
      }),
      items: [],
      participants: [],
    });
    getSharedReceipt.mockResolvedValue({ id: ATTACKER_RECEIPT, items: [] });

    const el = await renderPage(ATTACKER_RECEIPT);

    expect(getReceiptImageUrl).not.toHaveBeenCalled();
    expect((el.props as { imageUrl: string | null }).imageUrl).toBeNull();
  });

  // A participant is not the uploader, so the binding is to the receipt's
  // owner rather than to the viewer — otherwise the control would lock out
  // exactly the people the app exists to show the check to.
  it("still shows a participant the owner's photograph", async () => {
    const participant = "33333333-3333-3333-3333-333333333333";
    getUser.mockResolvedValue({ data: { user: { id: participant } } });
    getReceiptDetail.mockResolvedValue({
      receipt: receipt({
        id: VICTIM_RECEIPT,
        created_by: OWNER,
        image_url: `${SIGN}/${OWNER}/${VICTIM_RECEIPT}.jpg?token=live`,
      }),
      items: [],
      participants: [{ id: "p1", user_id: participant, display_name: "P", venmo_username: "p", is_owner: false }],
    });

    await renderPage(VICTIM_RECEIPT);

    expect(getReceiptImageUrl).toHaveBeenCalledWith(`${OWNER}/${VICTIM_RECEIPT}.jpg`);
  });

  // Unchanged by this task, restated because the binding is not a substitute
  // for it: a stranger never gets as far as the image question.
  it("404s a viewer who is neither owner nor participant", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "44444444-4444-4444-4444-444444444444" } },
    });

    await expect(renderPage(ATTACKER_RECEIPT)).rejects.toThrow("NOT_FOUND");
    expect(getReceiptImageUrl).not.toHaveBeenCalled();
  });
});
