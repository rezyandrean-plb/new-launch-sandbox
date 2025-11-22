import PayoutTreeWrapper from "@/components/payout-tree-wrapper";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f5f5f5] pb-16 text-black">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#B40101]">
            New Launch Sandbox
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-black sm:text-4xl">
            Drag-and-Drop Commission Flow Simulator
          </h1>
          <p className="mt-4 max-w-3xl text-base text-black/70">
            Simulate the full commission flow with drag-and-drop functionality.
            Adjust the developer payout, tweak fee percentages or fixed incentives,
            and drag cards within each branch to match how you want to review the flow.
            Every change recalculates in real time according to the hierarchical
            commission structure.
          </p>
        </header>
        <PayoutTreeWrapper />
      </div>
    </main>
  );
}
