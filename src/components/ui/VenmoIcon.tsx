import Image from "next/image";

export function VenmoIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/venmo.png"
      alt="Venmo"
      width={24}
      height={24}
      className={className}
    />
  );
}
