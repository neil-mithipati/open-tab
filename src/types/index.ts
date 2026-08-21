export interface Profile {
  id: string;
  display_name: string;
  email: string;
  venmo_username: string | null;
  invite_token: string;
  created_at: string;
  updated_at: string;
}

// numeric(10,2) columns — dollars, not cents. See the note further down.
export interface Receipt {
  id: string;
  created_by: string;
  image_url: string | null;
  merchant_name: string | null;
  date_of_receipt: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  notes: string | null;
  split_mode: "equal" | "by_item";
  status: "open" | "shared" | "closed";
  share_token: string | null;
  created_at: string;
}

// numeric(10,2) column — `price` is dollars here, unlike ParsedItem below.
export interface ReceiptItem {
  id: string;
  receipt_id: string;
  name: string;
  price: number;
  quantity: number;
  sort_order: number;
}

export interface ReceiptParticipant {
  id: string;
  receipt_id: string;
  user_id: string | null;
  venmo_username: string;
  display_name: string;
  is_owner: boolean;
  joined_via_share: boolean;
  claim_done_at: string | null;
}

export interface ItemAssignment {
  id: string;
  receipt_item_id: string;
  participant_id: string;
  quantity_assigned: number;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
}

// numeric(10,2) column — `amount` is dollars here, unlike ComputedCharge below.
export interface Charge {
  id: string;
  receipt_id: string;
  from_user_id: string;
  to_participant_id: string;
  amount: number;
  venmo_link: string | null;
  paid_at: string | null;
  created_at: string;
}

// Client-side flow types
// ===========================================================================
// MONEY UNITS. Read this before touching a number below.
//
// The row interfaces above (Receipt, ReceiptItem, Charge, SharedReceipt) mirror
// numeric(10,2) columns, so their money is DOLLARS. That is the only place
// dollars are allowed to live.
//
// Everything from here down — the parse result, the editing flow, the computed
// charges — is INTEGER CENTS. See src/lib/money.ts for the rounding rule and
// the conversion helpers; toCents at every read out of the database or off the
// model, fromCents at every write back into it.
//
// The cent-denominated fields keep their old names (`price`, `subtotal`,
// `total`, …) rather than gaining a `_cents` suffix because they are also the
// wire shape of /api/receipts/parse, which CaptureStep copies straight into
// the flow state field for field. Renaming them would have meant editing that
// component, which is owned by another change in flight. The unit is the one
// documented here, not the one the name suggests.
// ===========================================================================
export interface ParsedReceipt {
  merchant_name: string | null;
  date_of_receipt: string | null;
  items: ParsedItem[];
  /** Integer cents. */
  subtotal: number | null;
  /** Integer cents. */
  tax: number | null;
  /** Integer cents. */
  tip: number | null;
  /** Integer cents. */
  total: number | null;
}

export interface ParsedItem {
  name: string;
  /** Unit price, integer cents. Signed — a discount line is negative. */
  price: number;
  quantity: number;
}

export interface EditableItem extends ParsedItem {
  clientId: string;
  dbId?: string;
}

export interface FlowParticipant {
  clientId: string;
  dbId?: string;
  type: "friend" | "manual";
  userId?: string;
  displayName: string;
  venmoUsername: string;
  isOwner: boolean;
}

// Friend groups -------------------------------------------------------------

// Members are a snapshot: a Venmo username plus the label it was saved under.
// They're resolved against the live friends list when a group is expanded onto
// a check, so a member who isn't (or is no longer) a friend still works.
export interface FriendGroupMember {
  venmoUsername: string;
  displayName: string | null;
}

export interface FriendGroup {
  id: string;
  name: string;
  members: FriendGroupMember[];
}

export interface ComputedCharge {
  participant: FlowParticipant;
  /** Integer cents. */
  amountCents: number;
  venmoLink: string;
  venmoAppLink: string;
}

// Share / claim flow ---------------------------------------------------------

export interface ClaimParticipant {
  id: string;
  display_name: string;
  venmo_username: string;
  is_owner: boolean;
  joined_via_share: boolean;
  claim_done_at: string | null;
}

// Public, no-auth view of a shared receipt returned by the claim server actions.
// Excludes owner-private fields; includes just what the claim page needs.
export interface SharedReceipt {
  id: string;
  status: Receipt["status"];
  // True once the owner has closed claiming and charges exist — the check is
  // still "shared" but now in the collect phase (claiming is locked).
  claims_closed: boolean;
  merchant_name: string | null;
  date_of_receipt: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  owner: { display_name: string; venmo_username: string | null };
  items: ReceiptItem[];
  participants: ClaimParticipant[];
  // itemId → participantIds claiming it
  assignments: Record<string, string[]>;
}
