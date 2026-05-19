"use server";

import { revalidatePath } from "next/cache";
import { ApiError, botFetch } from "@/lib/api";

export type PerfilState = { ok: boolean; message?: string };

export async function updatePerfil(
  _prev: PerfilState,
  formData: FormData,
): Promise<PerfilState> {
  const nome = String(formData.get("nome") ?? "").trim();
  const dataNascimentoRaw = String(formData.get("dataNascimento") ?? "").trim();

  const body: Record<string, string | null> = {};
  if (nome) body.nome = nome;
  if (dataNascimentoRaw) {
    body.dataNascimento = dataNascimentoRaw;
  } else {
    body.dataNascimento = null; // permite limpar
  }

  try {
    await botFetch("/api/me", { method: "PATCH", body });
    revalidatePath("/app/perfil");
    revalidatePath("/app");
    return { ok: true, message: "Perfil atualizado." };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      return { ok: false, message: "Confere os campos — algo não bateu." };
    }
    return { ok: false, message: "Não consegui salvar agora. Tenta de novo." };
  }
}
