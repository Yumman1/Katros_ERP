export function PageLoadingSkeleton({
  rows = 6,
  label = "Loading…",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <div className="h-8 w-48 animate-pulse rounded-md bg-foreground/10" />
      <div className="h-4 w-72 animate-pulse rounded-md bg-foreground/5" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-foreground/[0.06]" />
        ))}
      </div>
    </div>
  );
}
