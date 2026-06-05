import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getSharedReceipt } from "@/app/actions/claim";
import { ClaimPage } from "@/components/claim/ClaimPage";

interface Props {
  params: Promise<{ token: string }>;
}

export default function TabPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-dvh text-secondary text-sm">
          Loading…
        </div>
      }
    >
      <TabContent params={params} />
    </Suspense>
  );
}

async function TabContent({ params }: Props) {
  await connection();
  const { token } = await params;
  const receipt = await getSharedReceipt(token);
  if (!receipt) notFound();

  return <ClaimPage token={token} initial={receipt} />;
}
