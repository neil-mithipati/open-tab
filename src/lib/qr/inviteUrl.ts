function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }
  throw new Error("NEXT_PUBLIC_APP_URL must be set in production");
}

export function buildInviteUrl(inviteToken: string): string {
  const base = appBaseUrl();
  return `${base}/invite/${inviteToken}`;
}

export function buildTabUrl(shareToken: string): string {
  const base = appBaseUrl();
  return `${base}/tab/${shareToken}`;
}
