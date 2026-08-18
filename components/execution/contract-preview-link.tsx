import Link from "next/link";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/** Opens the printable contract note in a new tab — preview on screen, print when ready. */
export function ContractPreviewLink({
  tradeRef,
  variant = "default",
  className,
}: {
  tradeRef: string;
  variant?: "default" | "toolbar" | "compact";
  className?: string;
}) {
  const href = `/execution/print/trade/${encodeURIComponent(tradeRef)}`;

  if (variant === "compact") {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("text-[10px] font-medium text-accent-secondary hover:underline", className)}
        title="Preview and print the contract note"
      >
        Preview
      </Link>
    );
  }

  if (variant === "toolbar") {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-kastros-border px-3 py-1.5 text-xs font-medium text-accent-secondary hover:bg-foreground/[0.04]",
          className,
        )}
        title="Open the contract note — preview on screen, then print if needed"
      >
        <FileText className="h-3.5 w-3.5" />
        Preview contract
      </Link>
    );
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground",
        className,
      )}
      title="Open the contract note — preview on screen, then print if needed"
    >
      <FileText className="h-3.5 w-3.5" />
      Preview contract
    </Link>
  );
}
