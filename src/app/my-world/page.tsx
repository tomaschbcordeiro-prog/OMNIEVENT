import type { Metadata } from "next";
import { Suspense } from "react";
import { MyWorldClient } from "@/components/my-world/my-world-client";

export const metadata: Metadata = { title: "My World", robots: { index: false } };

export default function MyWorldPage() {
  return (
    <main className="mx-auto max-w-[1300px] px-4 sm:px-6 pt-8 pb-20">
      <Suspense fallback={<div className="skeleton h-40" />}>
        <MyWorldClient />
      </Suspense>
    </main>
  );
}
