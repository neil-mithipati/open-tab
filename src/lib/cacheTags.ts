// Cache tags for the per-user `use cache` reads in lib/queries. Reads tag their
// entries with these; writes invalidate them so the next render sees the change
// instead of a copy cached before it (which reads as an empty tab list, or a
// profile with no Venmo username that bounces the user back to onboarding).
export const userReceiptsTag = (userId: string) => `receipts:${userId}`;
export const userProfileTag = (userId: string) => `profile:${userId}`;
export const userFriendsTag = (userId: string) => `friends:${userId}`;
export const userFriendGroupsTag = (userId: string) => `friend-groups:${userId}`;
