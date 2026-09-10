import Link from "next/link";
import { Header } from "@/components/Header";

export const metadata = {
  title: "About — Qorgau",
  description:
    "Qorgau listens to protected land. Acoustic sensors that turn the sound of a forest into something a ranger can act on.",
};

export default function AboutPage() {
  return (
    <div className="min-h-[100dvh]">
      <Header />

      <main className="mx-auto max-w-[720px] px-6 pb-40 pt-24 sm:px-8 sm:pt-32">
        <p className="text-[15px] font-medium tracking-wide text-accent">Qorgau</p>

        <h1 className="mt-5 text-[44px] font-semibold leading-[1.08] tracking-tightest sm:text-[64px]">
          A forest makes a sound
          <br />
          before it disappears.
        </h1>

        <p className="mt-10 text-[21px] font-light leading-[1.5] text-muted sm:text-[24px]">
          Qorgau is an acoustic monitoring system for protected natural territories. A
          network of sound traps listens continuously across the landscape, and tells you
          the moment it hears something that doesn&apos;t belong.
        </p>

        <div className="my-20 h-px bg-white/[0.08]" />

        <h2 className="text-[32px] font-semibold leading-tight tracking-tight sm:text-[40px]">
          Listening, everywhere at once.
        </h2>

        <p className="mt-7 text-[19px] font-light leading-[1.6] text-muted">
          A ranger can walk one valley at a time. A protected area is thousands of
          hectares of ridgeline, spruce forest, and river gorge — most of it out of sight
          on any given day. Sound carries where a patrol route cannot.
        </p>

        <p className="mt-7 text-[19px] font-light leading-[1.6] text-muted">
          Each trap runs on a small battery, sits quietly in the canopy, and listens. When
          it recognises a chainsaw, a gunshot, or a vehicle where no vehicle should be, it
          sends a short recording and its coordinates. Everything else it hears — wind,
          birds, rain, the ordinary noise of a living forest — it leaves alone.
        </p>

        <div className="my-20 h-px bg-white/[0.08]" />

        <h2 className="text-[32px] font-semibold leading-tight tracking-tight sm:text-[40px]">
          From a sound to a decision.
        </h2>

        <p className="mt-7 text-[19px] font-light leading-[1.6] text-muted">
          An alert is only useful if someone can act on it. Every detection arrives on a
          single live map: which trap heard it, where that trap stands, how long ago, and
          the recording itself. No dashboards to assemble, no reports to wait for. You
          open the map and the situation is simply there.
        </p>

        <p className="mt-7 text-[19px] font-light leading-[1.6] text-muted">
          The first traps are deployed in Ile-Alatau National Park, in the mountains south
          of Almaty.
        </p>

        <div className="mt-24">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-[17px] font-medium text-white shadow-sm transition-all duration-300 ease-apple hover:bg-accent-hover hover:shadow-md active:scale-[0.97]"
          >
            Open the live map
            <svg width="7" height="12" viewBox="0 0 7 12" aria-hidden="true">
              <path
                d="M1 1l5 5-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </main>
    </div>
  );
}
