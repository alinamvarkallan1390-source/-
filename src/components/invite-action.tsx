"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { BrandMark } from "@/components/ravan-brand";

export function InviteAction({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<{ title: string | null } | null>(null);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ title: string | null }>("/api/invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
      setJoined(result);
    } catch (acceptError) { setError(errorMessage(acceptError)); }
    finally { setBusy(false); }
  }

  return <main className="email-action-page" dir="rtl"><div className="email-action-card"><div className="email-action-brand"><BrandMark /><span>روان</span></div><div className="email-action-icon"><LockKeyhole size={21} /></div><span className="eyebrow">لینک دعوت</span><h1>{joined ? "به گفتگو پیوستی" : "یک گفتگوی تازه منتظر توست"}</h1><p>{joined ? `عضویت در «${joined.title ?? "گفتگو"}» ثبت شد.` : "این لینک دعوت خصوصی است و فقط پس از ورود به حساب معتبر قابل استفاده خواهد بود."}</p>{joined ? <Link className="button button-primary" href="/">رفتن به گفتگوها <ArrowLeft size={15} /></Link> : <><button className="button button-primary invite-accept" onClick={() => void accept()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}پیوستن با حساب فعلی</button>{error && <div className="inline-error" role="alert">{error}</div>}<Link className="invite-signin-link" href="/">ابتدا وارد حساب شو</Link></>}<div className="auth-trust"><LockKeyhole size={14} /><span>پیوند دارای انقضا و محدودیت تعداد استفاده است.</span></div></div></main>;
}
