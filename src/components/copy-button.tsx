"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md border border-bone bg-white px-3 py-1.5 text-xs font-medium text-ink/80 hover:border-taupe"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
