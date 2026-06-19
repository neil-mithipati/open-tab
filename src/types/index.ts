export interface Profile {
  id: string;
  display_name: string;
  email: string;
  venmo_username: string | null;
  invite_token: string;
  created_at: string;
  updated_at: string;
}

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
export interface ParsedReceipt {
  merchant_name: string | null;
  date_of_receipt: string | null;
  items: ParsedItem[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
}

export interface ParsedItem {
  name: string;
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

export interface ComputedCharge {
  participant: FlowParticipant;
  amount: number;
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
