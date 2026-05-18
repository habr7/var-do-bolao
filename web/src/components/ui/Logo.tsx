import { cn } from "@/lib/cn";

export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = {
    sm: { box: "h-7 w-7", text: "text-base" },
    md: { box: "h-9 w-9", text: "text-lg md:text-xl" },
    lg: { box: "h-14 w-14", text: "text-2xl md:text-3xl" },
  }[size];

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex items-center justify-center rounded-full",
          "bg-[var(--color-verde-conexao)] text-[var(--color-verde-gramado-deep)] font-black",
          "shadow-[0_0_24px_color-mix(in_srgb,var(--color-verde-conexao)_45%,transparent)]",
          dims.box,
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3/5 w-3/5"
        >
          <path d="M12 2 L7 6 L9 12 L15 12 L17 6 Z" />
          <path d="M9 12 L6 17 L12 22 L18 17 L15 12" />
          <path d="M2 8 L7 6" />
          <path d="M22 8 L17 6" />
          <path d="M6 17 L4 22" />
          <path d="M18 17 L20 22" />
        </svg>
      </span>
      <span
        className={cn(
          "font-[var(--font-display)] uppercase leading-none tracking-tight",
          dims.text,
        )}
      >
        VAR <span className="text-[var(--color-verde-conexao)]">do Bolão</span>
      </span>
    </div>
  );
}
