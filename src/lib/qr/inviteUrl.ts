export function buildInviteUrl(inviteToken: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/invite/${inviteToken}`;
}

export function buildTabUrl(shareToken: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/tab/${shareToken}`;
}
