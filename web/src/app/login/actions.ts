"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ApiError, botFetch } from "@/lib/api";
import { clearSessionCookie } from "@/lib/session";

export type ActionState =
  | { ok: false; message?: string }
  | { ok: true; redirectTo?: string; meta?: Record<string, unknown> };

export async function requestOtp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const celular = String(formData.get("celular") ?? "").trim();
  if (!celular) return { ok: false, message: "Digita o número aí, craque." };

  try {
    await botFetch("/api/auth/otp/request", {
      method: "POST",
      body: { celular },
      forwardCookies: false,
    });
    return { ok: true, meta: { celular } };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { ok: false, message: "Calma! Tenta de novo em 1 min." };
      if (e.status === 400) return { ok: false, message: "Número não parece válido. Confere o DDD." };
    }
    return { ok: false, message: "Deu ruim aqui. Tenta de novo em alguns segundos." };
  }
}

export async function verifyOtp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const celular = String(formData.get("celular") ?? "").trim();
  const codigo = String(formData.get("codigo") ?? "").trim();
  if (!celular || !codigo) return { ok: false, message: "Cola o código." };

  try {
    const res = await botFetch<{ firstAccess: boolean; nome: string }>(
      "/api/auth/otp/verify",
      { method: "POST", body: { celular, codigo } },
    );
    if (res.firstAccess) return { ok: true, redirectTo: "/login/primeiro-acesso" };
    return { ok: true, redirectTo: "/app" };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return { ok: false, message: "Código errado. Tenta de novo." };
      if (e.status === 410) return { ok: false, message: "Esse código já venceu. Pede outro." };
      if (e.status === 429) return { ok: false, message: "Muitas tentativas. Espera um pouco." };
    }
    return { ok: false, message: "Não consegui validar. Tenta de novo." };
  }
}

export async function firstAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const confirma = String(formData.get("confirmaSenha") ?? "");
  const dataNascimento = String(formData.get("dataNascimento") ?? "").trim();

  if (senha.length < 8) return { ok: false, message: "Senha precisa de pelo menos 8 caracteres." };
  if (senha !== confirma) return { ok: false, message: "Confirmação da senha não bate." };

  try {
    await botFetch("/api/auth/first-access", {
      method: "POST",
      body: {
        nome: nome || undefined,
        email,
        senha,
        dataNascimento: dataNascimento || undefined,
      },
    });
    return { ok: true, redirectTo: "/app" };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        const reason = (e.payload as { error?: string })?.error;
        if (reason === "EMAIL_TAKEN") return { ok: false, message: "Esse email já tá em uso." };
        if (reason === "WEB_ACCOUNT_EXISTS") return { ok: false, message: "Você já tem conta. Vai pelo login." };
      }
      if (e.status === 401) return { ok: false, message: "Sessão expirou. Pede novo código." };
    }
    return { ok: false, message: "Não consegui criar a conta. Tenta de novo." };
  }
}

export async function loginPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  if (!email || !senha) return { ok: false, message: "Preenche email e senha." };

  try {
    await botFetch("/api/auth/login", {
      method: "POST",
      body: { email, senha },
      forwardCookies: false,
    });
    return { ok: true, redirectTo: "/app" };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return { ok: false, message: "Errou a senha. Tenta de novo, craque." };
      if (e.status === 429) return { ok: false, message: "Muitas tentativas. Espera 15 min." };
    }
    return { ok: false, message: "Não consegui logar. Tenta de novo." };
  }
}

export async function logout() {
  try {
    await botFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignora — limpa local de qualquer jeito
  }
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect("/");
}
