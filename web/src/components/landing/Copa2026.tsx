"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { COPA_2026_START, CTA_CRIAR_BOLAO } from "@/lib/constants";

type Countdown = { days: number; hours: number; minutes: number; seconds: number; live: boolean };

function computeDelta(): Countdown {
  const now = Date.now();
  const target = COPA_2026_START.getTime();
  const diff = target - now;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, live: true };
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1_000);
  return { days, hours, minutes, seconds, live: false };
}

export function Copa2026() {
  const [c, setC] = useState<Countdown | null>(null);

  useEffect(() => {
    setC(computeDelta());
    const id = setInterval(() => setC(computeDelta()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="copa" className="relative py-20 md:py-28">
      <Container>
        <div
          className="var-frame relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-verde-conexao)]/30 p-8 md:p-14"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--color-verde-conexao) 18%, transparent) 0%, color-mix(in srgb, var(--color-amarelo-arbitro) 6%, transparent) 100%), var(--color-cinza-card)",
          }}
        >
          {/* halo */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full opacity-40 blur-3xl"
            style={{ background: "var(--color-verde-conexao)" }}
          />

          <div className="relative grid items-center gap-10 md:grid-cols-2">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-amarelo-arbitro)]">
                <Trophy size={14} /> Copa do Mundo 2026
              </div>
              <h2 className="font-[var(--font-display)] text-3xl uppercase leading-tight md:text-5xl">
                72 jogos.
                <br />1 ranking.
                <br />
                <span className="text-[var(--color-verde-conexao)]">Zero planilha.</span>
              </h2>
              <p className="mt-5 max-w-md text-base text-white/80 md:text-lg">
                Estados Unidos · Canadá · México · 11 de junho a 19 de julho.
                Bota o bolão da firma no automático antes da bola rolar.
              </p>
              <div className="mt-7">
                <Button href={CTA_CRIAR_BOLAO} variant="primary" size="lg">
                  Quero o meu bolão pronto
                </Button>
              </div>
            </div>

            <div>
              {c?.live ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--color-amarelo-arbitro)]/40 bg-[var(--color-amarelo-arbitro)]/5 p-8 text-center">
                  <span className="animate-pulse-soft rounded-full bg-[var(--color-amarelo-arbitro)] px-4 py-1 text-xs font-bold uppercase tracking-wider text-black">
                    Bola rolando
                  </span>
                  <div className="font-[var(--font-display)] text-4xl uppercase text-[var(--color-amarelo-arbitro)]">
                    A copa começou!
                  </div>
                  <p className="text-sm text-white/70">
                    Já dá pra palpitar nos jogos abertos.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 md:gap-3">
                  <CountUnit label="dias" value={c?.days ?? 0} />
                  <CountUnit label="horas" value={c?.hours ?? 0} />
                  <CountUnit label="min" value={c?.minutes ?? 0} />
                  <CountUnit label="seg" value={c?.seconds ?? 0} />
                </div>
              )}
              <p className="mt-4 text-center text-xs text-white/50">
                Pra abertura · 11/06/2026 · México
              </p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function CountUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[var(--color-verde-gramado-deep)]/70 p-3 text-center md:p-5">
      <div className="font-[var(--font-display)] text-3xl tabular-nums text-white md:text-5xl">
        {String(value).padStart(2, "0")}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-white/55 md:text-xs">
        {label}
      </div>
    </div>
  );
}
