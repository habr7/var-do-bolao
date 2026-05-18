import Link from "next/link";
import { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[var(--color-verde-conexao)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-verde-gramado-deep)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

const sizes: Record<Size, string> = {
  md: "h-11 px-5 text-sm md:text-base",
  lg: "h-14 px-7 text-base md:text-lg",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-verde-conexao)] text-[var(--color-verde-gramado-deep)] hover:bg-[var(--color-verde-conexao-dark)] hover:scale-[1.02] shadow-lg shadow-[color-mix(in_srgb,_var(--color-verde-conexao)_30%,_transparent)]",
  secondary:
    "border-2 border-[var(--color-branco-puro)]/70 text-[var(--color-branco-puro)] bg-transparent hover:bg-[var(--color-branco-puro)]/10 hover:border-[var(--color-branco-puro)]",
  ghost:
    "text-[var(--color-branco-puro)] hover:bg-[var(--color-branco-puro)]/10",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ComponentProps<"button">, "className" | "children"> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
  external?: boolean;
  target?: string;
  rel?: string;
};

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const {
    variant = "primary",
    size = "md",
    className,
    children,
  } = props;

  const classes = cn(base, sizes[size], variants[variant], className);

  if ("href" in props && props.href) {
    const { href, external, target, rel } = props;
    const isExternal = external ?? /^https?:\/\//.test(href);
    if (isExternal) {
      return (
        <a
          href={href}
          target={target ?? "_blank"}
          rel={rel ?? "noopener noreferrer"}
          className={classes}
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  const { variant: _v, size: _s, className: _c, children: _ch, ...rest } =
    props as ButtonAsButton;
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
