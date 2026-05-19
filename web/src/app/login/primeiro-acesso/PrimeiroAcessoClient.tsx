"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { firstAccess, type ActionState } from "../actions";

const initial: ActionState = { ok: false };

function strength(s: string): { score: number; label: string; color: string } {
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  if (score <= 1) return { score: 1, label: "Fraca", color: "bg-red-500" };
  if (score <= 3) return { score: 2, label: "Média", color: "bg-amber-400" };
  return { score: 3, label: "Forte", color: "bg-[var(--color-verde-conexao)]" };
}

export function PrimeiroAcessoClient({ nomeInicial }: { nomeInicial?: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [state, action, pending] = useActionState(firstAccess, initial);
  const s = strength(senha);
  const mismatch = confirma && confirma !== senha;

  useEffect(() => {
    if (state.ok && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-white/90">Como podemos te chamar?</span>
        <input
          name="nome"
          type="text"
          defaultValue={nomeInicial ?? ""}
          required
          minLength={2}
          maxLength={80}
          className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-white/90">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="voce@exemplo.com"
          className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-[var(--color-verde-conexao)] focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-2 flex items-center justify-between text-sm font-semibold text-white/90">
          <span>
            Data de nascimento <span className="text-white/40">(opcional)</span>
          </span>
        </span>
        <input
          name="dataNascimento"
          type="date"
          className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
        />
        <p className="mt-2 text-xs text-white/45">
          Pra validar maioridade e mandar um abraço quando der seu aniversário.
        </p>
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-white/90">
          Senha <span className="font-normal text-white/45">(mín 8 caracteres)</span>
        </span>
        <input
          name="senha"
          type="password"
          required
          minLength={8}
          maxLength={72}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
        />
        {senha.length > 0 ? (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded ${i <= s.score ? s.color : "bg-white/10"}`}
                />
              ))}
            </div>
            <span className="text-white/55">{s.label}</span>
          </div>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-white/90">Confirmar senha</span>
        <input
          name="confirmaSenha"
          type="password"
          required
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
          className={`w-full rounded-lg border bg-white/[0.04] px-4 py-3 text-white focus:outline-none ${
            mismatch ? "border-red-500" : "border-white/15 focus:border-[var(--color-verde-conexao)]"
          }`}
        />
        {confirma.length > 0 && !mismatch ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-[var(--color-verde-conexao)]">
            <Check size={12} /> Senhas conferem
          </p>
        ) : null}
      </label>

      {!state.ok && state.message ? (
        <p className="text-sm text-red-400">{state.message}</p>
      ) : null}

      <Button size="lg" variant="primary" className="w-full">
        {pending ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Criando conta…
          </>
        ) : (
          "Criar conta"
        )}
      </Button>

      <p className="text-center text-xs text-white/45">
        Ao criar, você aceita nossa política de privacidade e os termos.
      </p>
    </form>
  );
}
