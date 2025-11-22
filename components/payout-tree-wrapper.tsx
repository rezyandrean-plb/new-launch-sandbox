"use client";

import dynamic from "next/dynamic";

const PayoutTree = dynamic(
  () => import("@/components/payout-tree").then((mod) => mod.PayoutTree),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-3xl border border-dashed border-black/10 bg-white p-8 text-center text-sm text-black/60">
        Preparing interactive payout flow…
      </div>
    ),
  },
);

export default function PayoutTreeWrapper() {
  return <PayoutTree />;
}





