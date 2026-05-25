import { describe, it, expect } from "vitest";
import { buildVenmoLinks } from "@/lib/venmo/deepLink";

describe("buildVenmoLinks", () => {
  const base = { recipientUsername: "alice", amount: 12.5, note: "open-tab: Chipotle 2025-05-24" };

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

  it("includes the amount in the link", () => {
    const { venmoLink } = buildVenmoLinks(base);
    expect(venmoLink).toContain("12.5");
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
