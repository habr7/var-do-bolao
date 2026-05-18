import Link from "next/link";
import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Container } from "@/components/ui/Container";
import { Footer } from "./Footer";

export function PageShell({
  children,
  backHref = "/",
  backLabel = "Voltar ao início",
}: {
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <>
      <header className="border-b border-white/10 bg-[var(--color-verde-gramado-deep)]/85 backdrop-blur-md">
        <Container className="flex h-16 items-center justify-between">
          <Link href="/" aria-label="VAR do Bolão — Home">
            <Logo size="sm" />
          </Link>
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-[var(--color-verde-conexao)]"
          >
            <ArrowLeft size={16} /> {backLabel}
          </Link>
        </Container>
      </header>
      <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
      <Footer />
    </>
  );
}
