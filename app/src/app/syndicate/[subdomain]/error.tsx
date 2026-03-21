"use client";
import ErrorDisplay from "@/components/ErrorDisplay";

export default function SyndicateError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorDisplay title="Failed to load syndicate" minHeight="60vh" reset={reset} />;
}
