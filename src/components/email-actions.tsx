"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Check, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { BrandMark } from "@/components/ravan-brand";

export function VerifyEmailAction() {
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("پیوند تأیید را بررسی می‌کنیم…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setMessage("پیوند تأیید کامل نیست.");
      return;
    }
    apiFetch("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => { setState("success"); setMessage("نشانی ایمیل تأیید شد؛ نشست امن ایجاد شده است."); })
      .catch((error) => { setState("error"); setMessage(errorMessage(error)); });
  }, []);

  return <EmailActionFrame icon={state === "success" ? <Check size={21} /> : state === "loading" ? <LoaderCircle size={21} className="spin" /> : <ShieldCheck size={21} />} title={state === "success" ? "ایمیل تأیید شد" : state === "loading" ? "در حال تأیید" : "تأیید انجام نشد"} message={message} />;
}

export function ResetPasswordAction() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setToken(new URLSearchParams(window.location.search).get("token") ?? ""); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) { setError("تکرار رمز عبور مطابقت ندارد."); return; }
    setBusy(true);
    try {
      await apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      setComplete(true);
    } catch (submitError) { setError(errorMessage(submitError)); }
    finally { setBusy(false); }
  }

  return <main className="email-action-page" dir="rtl"><div className="email-action-card"><div className="email-action-brand"><BrandMark /><span>روان</span></div><span className="eyebrow">امنیت حساب</span><h1>{complete ? "رمز تازه ثبت شد" : "بازیابی رمز عبور"}</h1><p>{complete ? "همهٔ نشست‌های قبلی بسته شدند. حالا با رمز تازه وارد شو." : "یک رمز تازه با حداقل ۱۲ نویسه انتخاب کن."}</p>{complete ? <Link className="button button-primary" href="/">رفتن به ورود <ArrowLeft size={15} /></Link> : <form className="auth-form" onSubmit={(event) => void submit(event)}><label className="field-label" htmlFor="reset-password">رمز تازه</label><input id="reset-password" className="text-field" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /><label className="field-label" htmlFor="reset-confirm">تکرار رمز تازه</label><input id="reset-confirm" className="text-field" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />{error && <div className="inline-error" role="alert">{error}</div>}<button className="button button-primary auth-submit" disabled={busy || token.length < 24}>{busy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />}ثبت رمز تازه</button></form>}<div className="auth-trust"><ShieldCheck size={15} /><span>پیوند یک‌بارمصرف؛ نشست‌های پیشین باطل می‌شوند.</span></div></div></main>;
}

function EmailActionFrame({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return <main className="email-action-page" dir="rtl"><div className="email-action-card"><div className="email-action-brand"><BrandMark /><span>روان</span></div><div className="email-action-icon">{icon}</div><span className="eyebrow">تأیید حساب</span><h1>{title}</h1><p>{message}</p><Link className="button button-primary" href="/">بازگشت به روان <ArrowLeft size={15} /></Link><div className="auth-trust"><ShieldCheck size={15} /><span>پیوند تأیید یک‌بارمصرف است.</span></div></div></main>;
}
