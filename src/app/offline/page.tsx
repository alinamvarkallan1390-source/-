import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offline-page" dir="rtl">
      <div className="offline-mark" aria-hidden="true">ر</div>
      <p className="eyebrow">RAVAN · روان</p>
      <h1>فعلاً آفلاین هستید</h1>
      <p>برای دریافت گفتگوها دوباره به اینترنت وصل شوید. برای حفظ حریم خصوصی، محتوای گفتگوها روی دستگاه کش نمی‌شود.</p>
      <Link href="/">تلاش دوباره</Link>
    </main>
  );
}
