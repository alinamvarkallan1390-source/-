import { AppError } from "@/lib/errors";

function emailSettings() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey && !from) return null;
  if (!apiKey || !from) {
    throw new AppError(503, "EMAIL_NOT_CONFIGURED", "برای ایمیل، RESEND_API_KEY و EMAIL_FROM را با هم تنظیم کنید.");
  }
  return { apiKey, from };
}

export function emailIsConfigured(): boolean {
  const hasKey = Boolean(process.env.RESEND_API_KEY);
  const hasSender = Boolean(process.env.EMAIL_FROM);
  if (hasKey !== hasSender) {
    throw new AppError(503, "EMAIL_NOT_CONFIGURED", "برای ایمیل، RESEND_API_KEY و EMAIL_FROM را با هم تنظیم کنید.");
  }
  return hasKey && hasSender;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const settings = emailSettings();
  if (!settings) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "سرویس ایمیل پیکربندی نشده است.");

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: settings.from, to: [to], subject, html }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new AppError(503, "EMAIL_DELIVERY_FAILED", "ارسال ایمیل موقتاً ممکن نیست.");
  }
  if (!response.ok) throw new AppError(503, "EMAIL_DELIVERY_FAILED", "ارسال ایمیل موقتاً ممکن نیست.");
}

function appUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) throw new AppError(503, "APP_URL_NOT_CONFIGURED", "آدرس عمومی برنامه پیکربندی نشده است.");
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new Error("HTTPS is required in production.");
    }
    return url;
  } catch {
    throw new AppError(503, "APP_URL_NOT_CONFIGURED", "آدرس عمومی برنامه معتبر نیست.");
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const url = appUrl();
  url.pathname = "/verify-email";
  url.search = "";
  url.searchParams.set("token", token);
  await sendEmail(
    email,
    "تأیید نشانی ایمیل در روان",
    `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.9"><h2>تأیید ایمیل</h2><p>برای فعال‌کردن حساب روان، این پیوند یک‌بارمصرف را باز کنید:</p><p><a href="${url.toString()}">تأیید نشانی ایمیل</a></p><p>اگر این درخواست از طرف شما نبوده، این پیام را نادیده بگیرید.</p></div>`,
  );
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const url = appUrl();
  url.pathname = "/reset-password";
  url.search = "";
  url.searchParams.set("token", token);
  await sendEmail(
    email,
    "بازیابی رمز عبور روان",
    `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.9"><h2>بازیابی رمز عبور</h2><p>این پیوند تا ۳۰ دقیقه معتبر و فقط یک‌بار قابل استفاده است:</p><p><a href="${url.toString()}">تنظیم رمز عبور جدید</a></p><p>اگر این درخواست از طرف شما نبوده، این پیام را نادیده بگیرید.</p></div>`,
  );
}
