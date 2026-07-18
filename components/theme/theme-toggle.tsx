"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggle({ className, compact }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className={cn(
          "h-9 w-9 rounded-lg border border-border bg-card",
          compact && "h-8 w-8",
          className,
        )}
        aria-hidden
      />
    );
  }

  const cycle = () => {
    if (theme === "dark") setTheme("light");
    else if (theme === "light") setTheme("system");
    else setTheme("dark");
  };

  const Icon =
    theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  const label =
    theme === "system"
      ? "System theme"
      : resolvedTheme === "dark"
        ? "Dark theme"
        : "Light theme";

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${label} — click to switch`}
      aria-label={`${label}. Click to switch theme.`}
      className={cn(
        "inline-flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors",
        "hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
        compact ? "h-8 w-8" : "h-9 w-9",
        className,
      )}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </button>
  );
}
