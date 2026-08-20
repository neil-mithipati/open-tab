import { describe, it, expect } from "vitest";
import { buildVenmoLinks, buildVenmoProfileUrl } from "@/lib/venmo/deepLink";

describe("buildVenmoProfileUrl", () => {
  it("points at the user's Venmo profile", () => {
    expect(buildVenmoProfileUrl("alice")).toBe("https://venmo.com/u/alice");
  });

  it("strips a leading @", () => {
    expect(buildVenmoProfileUrl("@alice")).toBe("https://venmo.com/u/alice");
  });

  it("encodes characters that would break the path", () => {
    expect(buildVenmoProfileUrl("a b")).toBe("https://venmo.com/u/a%20b");
  });
});

describe("buildVenmoLinks", () => {
  // amountCents — the link takes the integer the split arithmetic produced.
  const base = { recipientUsername: "alice", amountCents: 1250, note: "open-tab: Chipotle 2025-05-24" };

  it("returns a venmoLink starting with https://venmo.com", () => {
    const { venmoLink } = buildVenmoLinks(base);
    expect(venmoLink).toMatch(/^https:\/\/venmo\.com/);
  });

  it("returns a venmoAppLink starting with venmo://", () => {
    const { venmoAppLink } = buildVenmoLinks(base);
    expect(venmoAppLink).toMatch(/^venmo:\/\//);
  });

  it("includes the recipient username in the link", () => {
    const { venmoLink } = buildVenmoLinks(base);
    expect(venmoLink).toContain("alice");
  });

  it("includes the amount in the link, as dollars with two decimals", () => {
    const { venmoLink } = buildVenmoLinks(base);
    expect(venmoLink).toContain("amount=12.50");
  });

  it("converts cents to dollars without floating-point drift", () => {
    // 1 cent short of $100. 9999 / 100 must print as 99.99, not 99.98999….
    const { venmoLink } = buildVenmoLinks({ ...base, amountCents: 9999 });
    expect(venmoLink).toContain("amount=99.99");
  });

  it("strips a leading @ from the username", () => {
    const { venmoLink } = buildVenmoLinks({ ...base, recipientUsername: "@alice" });
    expect(venmoLink).not.toContain("%40");
    expect(venmoLink).toContain("alice");
  });

  it("encodes the note in the URL", () => {
    const { venmoLink } = buildVenmoLinks(base);
    // note has spaces — should be URL-encoded
    expect(venmoLink).not.toContain(" ");
  });

  it("includes txn=pay in both links", () => {
    const { venmoLink, venmoAppLink } = buildVenmoLinks(base);
    expect(venmoLink).toContain("txn=pay");
    expect(venmoAppLink).toContain("txn=pay");
  });
});
