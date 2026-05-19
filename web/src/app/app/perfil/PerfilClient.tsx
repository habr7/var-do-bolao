"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { logout } from "@/app/login/actions";
import { updatePerfil, type PerfilState } from "./actions";

const initial: PerfilState = { ok: false };

type Props = {
  nome: string;
  email: string;
  celular: string;
  dataNascimento: string | null;
};

function ymd(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function PerfilClient({ nome, email, celular, dataNascimento }: Props) {
  const [state, action, pending] = useActionState(updatePerfil, initial);
  const [dataLocal, setDataLocal] = useState(ymd(dataNascimento));

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white/90">Nome</span>
          <input
            name="nome"
            type="text"
            defaultValue={nome}
            minLength={2}
            maxLength={80}
            className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
          />
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" value={email} readOnly />
          <Field label="Celular" value={maskCel(celular)} readOnly />
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white/90">
            Data de nascimento <span className="font-normal text-white/45">(opcional)</span>
          </span>
          <input
            name="dataNascimento"
            type="date"
            value={dataLocal}
            onChange={(e) => setDataLocal(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white focus:border-[var(--color-verde-conexao)] focus:outline-none"
          />
          <p className="mt-2 text-xs text-white/45">
            Pode deixar em branco. Quando preenchida, é usada só pra validar maioridade
            e mandar um abraço no aniversário.
          </p>
        </label>

        {state.message ? (
          <p
            className={`flex items-center gap-1 text-sm ${
              state.ok ? "text-[var(--color-verde-conexao)]" : "text-red-400"
            }`}
          >
            {state.ok ? <Check size={14} /> : null}
            {state.message}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button size="md" variant="primary">
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Salvando…
              </>
            ) : (
              "Salvar alterações"
            )}
          </Button>
        </div>
      </form>

      <hr className="border-white/10" />

      <form action={logout}>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full border border-red-500/40 px-5 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 hover:border-red-500/70"
        >
          <LogOut size={16} /> Sair da conta
        </button>
        <p className="mt-2 text-xs text-white/40">
          O bot no WhatsApp continua funcionando normalmente.
        </p>
      </form>
    </div>
  );
}

function Field({ label, value, readOnly }: { label: string; value: string; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-white/90">{label}</span>
      <input
        readOnly={readOnly}
        value={value}
        className="w-full rounded-lg border border-white/15 bg-white/[0.02] px-4 py-3 text-white/70 cursor-not-allowed"
      />
    </label>
  );
}

function maskCel(d: string): string {
  // 5511999999999 -> +55 (11) 99999-9999
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  return d;
}
