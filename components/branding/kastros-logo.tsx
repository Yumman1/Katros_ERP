import { cn } from "@/lib/utils";

type Props = {
  variant?: "icon" | "full" | "full-white";
  size?: "sm" | "md" | "lg";
  className?: string;
  subtitle?: string;
};

const ICON = "/branding/favicon.png";
const LOGO = "/branding/logo.png";
const LOGO_WHITE = "/branding/logo-white.png";

const sizes = {
  sm: { icon: 32, fullW: 120, fullH: 32 },
  md: { icon: 40, fullW: 148, fullH: 40 },
  lg: { icon: 56, fullW: 200, fullH: 52 },
};

export function KastrosLogo({ variant = "icon", size = "md", className, subtitle }: Props) {
  const s = sizes[size];

  if (variant === "icon") {
    return (
      <img
        src={ICON}
        alt="Kastros"
        width={s.icon}
        height={s.icon}
        className={cn("rounded-xl", className)}
        decoding="async"
      />
    );
  }

  const src = variant === "full-white" ? LOGO_WHITE : LOGO;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <img
        src={src}
        alt="Kastros"
        width={s.fullW}
        height={s.fullH}
        className={cn(
          "block object-contain object-left",
          variant === "full-white" ? "mix-blend-screen" : "",
        )}
        style={{ width: s.fullW, height: "auto", maxWidth: "100%" }}
        decoding="async"
      />
      {subtitle ? (
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-widest",
            variant === "full-white" ? "text-white/80" : "text-muted-foreground",
          )}
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}
