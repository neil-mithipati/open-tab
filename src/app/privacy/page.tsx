import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";

const LAST_UPDATED = "August 19, 2026";
const CONTACT_EMAIL = "[contact email]";

// Static policy page, server component, no data fetching. Every claim below
// has to be true of the shipped app — see deleteAccount.ts for the deletion
// section, which this was checked against directly.
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center px-5 py-12">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <div>
          <Link href="/" className="text-sm text-secondary hover:text-primary transition-colors">
            &larr; Back
          </Link>
          <h1 className="text-3xl font-black tracking-tight mt-3">Privacy</h1>
          <p className="text-xs text-secondary mt-1">Last updated {LAST_UPDATED}</p>
        </div>

        <GlassCard className="p-6 flex flex-col gap-6 text-sm text-secondary leading-relaxed">
          <Section title="What we collect">
            <p>
              Your email (to run your account), your Venmo username, your display
              name, receipt photos and the line items parsed from them, and any
              names or Venmo handles you add for friends.
            </p>
          </Section>

          <Section title="How it's used">
            <p>
              To split bills and generate Venmo charge links. Receipt photos are
              sent to Google&apos;s Gemini API for parsing. Everything is stored
              with Supabase.
            </p>
          </Section>

          <Section title="What we never do">
            <p>
              We don&apos;t sell your data, send anything to your contacts, or
              post or pay on your behalf. A Venmo link just opens Venmo &mdash; no
              payment happens inside this app.
            </p>
          </Section>

          <Section title="Sharing links">
            <p>
              Anyone with a tab&apos;s share link can see that tab&apos;s items and
              its participants&apos; first names and Venmo handles. Share links
              accordingly.
            </p>
          </Section>

          <Section title="Deletion">
            <p>
              Deleting your account removes your receipt photos from storage,
              your profile and everything cascading from it &mdash; tabs you
              created with their items, participants, assignments and charges;
              friendships both ways; external contacts; friend groups &mdash;
              and your login, then signs you out.
            </p>
            <p className="mt-3">
              Your rows on tabs other people created are kept but unlinked from
              your account: the account link is removed while both your display
              name and your Venmo username remain, so their totals still
              reconcile.
            </p>
            <p className="mt-3">
              Charge rows on tabs other people created are re-pointed to that
              tab&apos;s owner, not deleted.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about any of this:{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand underline"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </Section>
        </GlassCard>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-primary mb-2">{title}</h2>
      {children}
    </div>
  );
}
