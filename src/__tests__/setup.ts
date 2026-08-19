import "@testing-library/jest-dom";
import { beforeEach } from "vitest";

// Clear sessionStorage between tests so hook state doesn't bleed across
beforeEach(() => {
  sessionStorage.clear();
});
