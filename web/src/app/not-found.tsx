import Link from "next/link";
import { PageShell } from "@/components/landing/PageShell";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <PageShell>
      <Container className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <p className="font-[var(--font-display)] text-7xl text-[var(--color-verde-conexao)] md:text-9xl">
          404
        </p>
        <h1 className="mt-4 font-[var(--font-display)] text-2xl uppercase md:text-4xl">
          Bola pra fora.
        </h1>
        <p className="mt-3 max-w-md text-white/70">
          Essa página não existe — ou foi pro vestiário. Volta pro início e
          tenta de novo.
        </p>
        <div className="mt-8">
          <Button href="/" variant="primary" size="lg">
            Voltar pro início
          </Button>
        </div>
        <p className="mt-12 text-xs text-white/40">
          Procurando alguma coisa específica?{" "}
          <Link href="/login" className="underline hover:text-white">
            Entrar
          </Link>
        </p>
      </Container>
    </PageShell>
  );
}
