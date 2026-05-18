"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { CTA_CRIAR_BOLAO } from "@/lib/constants";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#por-que", label: "Por que" },
  { href: "#copa", label: "Copa 2026" },
  { href: "#faq", label: "FAQ" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "backdrop-blur-md bg-[var(--color-verde-gramado-deep)]/85 border-b border-white/10"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="VAR do Bolão — Home" className="shrink-0">
          <Logo size="md" />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Principal">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm text-white/80 transition-colors hover:text-[var(--color-verde-conexao)]"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button href="/login" variant="ghost" size="md">
            Entrar
          </Button>
          <Button href={CTA_CRIAR_BOLAO} variant="primary" size="md">
            Criar bolão
          </Button>
        </div>

        <button
          type="button"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-white md:hidden"
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Drawer mobile */}
      <div
        className={cn(
          "md:hidden fixed inset-x-0 top-16 bottom-0 bg-[var(--color-verde-gramado-deep)]/95 backdrop-blur-md transition-all duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
      >
        <nav
          className="flex flex-col gap-1 px-5 pt-6"
          aria-label="Mobile"
        >
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="border-b border-white/10 py-4 text-lg font-semibold"
            >
              {n.label}
            </a>
          ))}
          <div className="mt-6 flex flex-col gap-3">
            <Button href="/login" variant="secondary" size="lg">
              Entrar
            </Button>
            <Button href={CTA_CRIAR_BOLAO} variant="primary" size="lg">
              Criar bolão grátis
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
