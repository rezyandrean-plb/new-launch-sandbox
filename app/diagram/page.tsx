"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CommissionFlowDiagram from "@/components/commission-flow-diagram";

export default function DiagramPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const encodedData = searchParams.get("data");
    if (encodedData) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(encodedData)));
        setData(decoded);
      } catch (error) {
        console.error("Error decoding data:", error);
        router.push("/");
      }
    } else {
      // Try to get from localStorage as fallback
      const stored = localStorage.getItem("commissionFlowData");
      if (stored) {
        try {
          setData(JSON.parse(stored));
        } catch (error) {
          console.error("Error parsing stored data:", error);
          router.push("/");
        }
      } else {
        router.push("/");
      }
    }
  }, [searchParams, router]);

  if (!data) {
    return (
      <main className="min-h-screen bg-[#f5f5f5] pb-16 text-black">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-12 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-black/10 bg-white p-8 text-center text-sm text-black/60">
            Loading commission flow diagram...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] pb-16 text-black">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#B40101]">
                Commission Flow Diagram
              </p>
              <h1 className="mt-3 text-3xl font-semibold text-black sm:text-4xl">
                Project Leads Commission Flow
              </h1>
              <p className="mt-4 max-w-3xl text-base text-black/70">
                Visual representation of the commission flow structure and calculations.
              </p>
            </div>
            <button
              onClick={() => router.push("/")}
              className="rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-black/5"
            >
              ← Back to Editor
            </button>
          </div>
        </header>
        <CommissionFlowDiagram data={data} />
      </div>
    </main>
  );
}

