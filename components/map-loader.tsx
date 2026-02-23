"use client";

import dynamic from "next/dynamic";

const WardrivingMap = dynamic(() => import("@/components/wardriving-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0f172a]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
        <p className="text-sm text-[#94a3b8]">Initializing map...</p>
      </div>
    </div>
  ),
});

export default function MapLoader() {
  return <WardrivingMap />;
}
