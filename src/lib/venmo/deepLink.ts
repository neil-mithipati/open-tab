interface VenmoParams {
  recipientUsername: string;
  amount: number;
  note: string;
}

export function buildVenmoLinks(params: VenmoParams): {
  venmoLink: string;
  venmoAppLink: string;
} {
  const { recipientUsername, amount, note } = params;
  const username = recipientUsername.replace(/^@/, "");
  const encoded = encodeURIComponent(note);
  const amt = amount.toFixed(2);

  return {
    venmoLink: `https://venmo.com/paycharge?txn=pay&recipients=${username}&amount=${amt}&note=${encoded}`,
    venmoAppLink: `venmo://paycharge?txn=pay&recipients=${username}&amount=${amt}&note=${encoded}`,
  };
}
