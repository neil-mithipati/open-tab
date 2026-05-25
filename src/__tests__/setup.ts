import "@testing-library/jest-dom";

// Clear sessionStorage between tests so hook state doesn't bleed across
beforeEach(() => {
  sessionStorage.clear();
});
