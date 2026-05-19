"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, Loader2, Lock, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { requestOtp, verifyOtp, loginPassword, type ActionState } from "./actions";

const initial: ActionState = { ok: false };

function maskCelular(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function LoginClient({ initialNext }: { initialNext: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"otp" | "senha">("otp");
  const [celular, setCelular] = useState("");
  const [stage, setStage] = useState<"celular" | "codigo">("celular");

  // OTP request
  const [reqState, reqAction, reqPending] = useActionState(requestOtp, initial);
  // OTP verify
  const [verState, verAction, verPending] = useActionState(verifyOtp, initial);
  // Senha login
  const [pwState, pwAction, pwPending] = useActionState(loginPassword, initial);

  useEffect(() => {
    if (reqState.ok && "meta" in reqState) {
      setStage("codigo");
    }
  }, [reqState]);

  useEffect(() => {
    if (verState.ok && verState.redirectTo) {
      const target = verState.redirectTo === "/app" && initialNext ? initialNext : verState.redirectTo;
      router.push(target);
      router.refresh();
    }
  }, [verState, router, initialNext]);

  useEffect(() => {
    if (pwState.ok && pwState.redirectTo) {
      router.push(initialNext ?? pwState.redirectTo);
      router.refresh();
    }
  }, [pwState, router, initialNext]);

  return (
    <div>
      {/* Mode tabs */}
      <div className="mb-6 flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
        <button
          type="button"
          onClick={() => setMode("otp")}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
            mode === "otp" ? "bg-[var(--color-verde-conexao)] text-[var(--color-verde-gramado-deep)]" : "text-white/65"
          }`}
        >
          Por WhatsApp
        </button>
        <button
          type="button"
          onClick={() => setMode("senha")}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
            mode === "senha" ? "bg-[var(--color-verde-conexao)] text-[var(--color-verde-gramado-deep)]" : "text-white/65"
          }`}
        >
          Com senha
        </button>
      </div>

      {mode === "otp" ? (
        stage === "celular" ? (
          <form action={reqAction} className="space-y-4">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/90">
                <Smartphone size={16} /> Celular com DDD
              </span>
              <input
                name="celular"
                type="tel"
                inputMode="tel"
                autoFocus
                required
                placeholder="(11) 99999-9999"
                value={maskCelular(celular)}
                onChange={(e) => setCelular(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-[var(--color-verde-conexao)] focus:outline-none"
              />
              <p className="mt-2 text-xs text-white/45">
                A gente manda um código de 6 dígitos pelo bot.
              </p>
            </label>
            {!reqState.ok && reqState.message ? (
              <p className="text-sm text-red-400">{reqState.message}</p>
            ) : null}
            <Button size="lg" variant="primary" className="w-full">
              {reqPending ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Mandando…
                </>
              ) : (
                <>
                  Receber código <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>
        ) : (
          <form action={verAction} className="space-y-4">
            <input type="hidden" name="celular" value={celular} />
            <div>
              <p className="mb-2 text-sm font-semibold text-white/90">
                Código recebido no WhatsApp
              </p>
              <CodeInput name="codigo" />
              <p className="mt-3 text-xs text-white/55">
                Mandamos pra <strong className="text-white">{maskCelular(celular)}</strong>.{" "}
                <button
                  type="button"
                  onClick={() => setStage("celular")}
                  className="underline hover:text-white"
                >
                  Trocar número
                </button>
              </p>
            </div>
            {!verState.ok && verState.message ? (
              <p className="text-sm text-red-400">{verState.message}</p>
            ) : null}
            <Button size="lg" variant="primary" className="w-full">
              {verPending ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Verificando…
                </>
              ) : (
                <>
                  Entrar <ArrowRight size={16} />
                </>
              )}
            </Button>
            <ResendInline celular={celular} />
          </form>
        )
      ) : (
        <form action={pwAction} className="space-y-4">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/90">
              <Lock size={16} /> Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@exemplo.com"
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-[var(--color-verde-conexao)] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/90">
              <KeyRound size={16} /> Senha
            </span>
            <input
              name="senha"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
            />
          </label>
          {!pwState.ok && pwState.message ? (
            <p className="text-sm text-red-400">{pwState.message}</p>
          ) : null}
          <Button size="lg" variant="primary" className="w-full">
            {pwPending ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </Button>
          <p className="text-center text-xs text-white/50">
            Esqueceu a senha?{" "}
            <button
              type="button"
              onClick={() => setMode("otp")}
              className="underline hover:text-white"
            >
              Entra por WhatsApp
            </button>
          </p>
        </form>
      )}

      <p className="mt-8 text-center text-xs text-white/45">
        Ao entrar, você aceita a{" "}
        <Link href="/politica-privacidade" className="underline hover:text-white">
          Política
        </Link>{" "}
        e os{" "}
        <Link href="/termos" className="underline hover:text-white">
          Termos
        </Link>
        .
      </p>
    </div>
  );
}

function CodeInput({ name }: { name: string }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(i: number, v: string) {
    const clean = v.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!t) return;
    e.preventDefault();
    const next = Array(6).fill("").map((_, i) => t[i] ?? "");
    setDigits(next);
    refs.current[Math.min(t.length, 5)]?.focus();
  }

  return (
    <div className="flex gap-2">
      <input type="hidden" name={name} value={digits.join("")} />
      {Array(6)
        .fill(0)
        .map((_, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            autoFocus={i === 0}
            value={digits[i]}
            onChange={(e) => handleChange(i, e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) {
                refs.current[i - 1]?.focus();
              }
            }}
            className="h-14 w-12 rounded-lg border border-white/15 bg-white/[0.04] text-center font-[var(--font-display)] text-2xl text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
          />
        ))}
    </div>
  );
}

function ResendInline({ celular }: { celular: string }) {
  const [seconds, setSeconds] = useState(60);
  const [reqState, reqAction, reqPending] = useActionState(requestOtp, initial);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  if (seconds > 0) {
    return (
      <p className="text-center text-xs text-white/45">
        Não chegou? Pode reenviar em <strong className="text-white">{seconds}s</strong>.
      </p>
    );
  }

  return (
    <form action={reqAction} className="text-center">
      <input type="hidden" name="celular" value={celular} />
      <button
        type="submit"
        disabled={reqPending}
        className="text-xs text-[var(--color-verde-conexao)] underline hover:text-white"
      >
        {reqPending ? "Reenviando…" : "Reenviar código"}
      </button>
      {!reqState.ok && reqState.message ? (
        <p className="mt-1 text-xs text-red-400">{reqState.message}</p>
      ) : null}
    </form>
  );
}
