import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS,
  receiptImageRetentionDays,
  retentionCutoff,
} from "@/lib/retention";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("N is configurable and defaults to 7", () => {
  it("defaults to 7 days when nothing is set", () => {
    expect(DEFAULT_RECEIPT_IMAGE_RETENTION_DAYS).toBe(7);
    expect(receiptImageRetentionDays(undefined)).toBe(7);
    expect(receiptImageRetentionDays("")).toBe(7);
    expect(receiptImageRetentionDays("   ")).toBe(7);
  });

  it("honours an override", () => {
    expect(receiptImageRetentionDays("1")).toBe(1);
    expect(receiptImageRetentionDays("14")).toBe(14);
    expect(receiptImageRetentionDays("30")).toBe(30);
    expect(receiptImageRetentionDays("365")).toBe(365);
  });

  it("tolerates surrounding whitespace, the way an env file leaves it", () => {
    expect(receiptImageRetentionDays(" 14 ")).toBe(14);
  });
});

describe("a bad value falls back rather than disabling the job", () => {
  // A retention job failing open leaves card numbers on disk forever, and
  // quietly. So every rejection lands on the default — a job that keeps
  // deleting — not on "no deletion".
  it("rejects values that are not whole numbers", () => {
    const spy = quiet();
    for (const raw of ["abc", "7.5", "NaN", "1e2x", "-", "seven"]) {
      expect(receiptImageRetentionDays(raw)).toBe(7);
    }
    expect(spy).toHaveBeenCalled();
  });

  it("rejects zero and negatives, which would delete what users are still using", () => {
    quiet();
    expect(receiptImageRetentionDays("0")).toBe(7);
    expect(receiptImageRetentionDays("-1")).toBe(7);
    expect(receiptImageRetentionDays("-3650")).toBe(7);
  });

  it("rejects a value large enough to be retention switched off by typo", () => {
    quiet();
    expect(receiptImageRetentionDays("366")).toBe(7);
    expect(receiptImageRetentionDays("99999")).toBe(7);
  });

  it("says out loud which value it refused", () => {
    const spy = quiet();
    receiptImageRetentionDays("0");
    expect(spy.mock.calls[0][0]).toContain("RECEIPT_IMAGE_RETENTION_DAYS=0");
    expect(spy.mock.calls[0][0]).toContain("7 days");
  });
});

describe("the cutoff", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("is N days before now", () => {
    expect(retentionCutoff(now, 7).toISOString()).toBe("2026-08-13T12:00:00.000Z");
    expect(retentionCutoff(now, 1).toISOString()).toBe("2026-08-19T12:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-07-21T12:00:00.000Z");
  });

  it("moves back, never forward", () => {
    expect(retentionCutoff(now, 7).getTime()).toBeLessThan(now.getTime());
  });

  it("keeps a photo taken one second inside the window", () => {
    const cutoff = retentionCutoff(now, 7);
    const justInside = new Date(now.getTime() - 7 * DAY_MS + 1000);
    expect(justInside.getTime()).toBeGreaterThan(cutoff.getTime());
  });
});
