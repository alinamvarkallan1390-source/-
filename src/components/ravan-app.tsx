"use client";

import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bot as BotIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Hash,
  KeyRound,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Reply,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { hasSearchTerm, normalizePersianSearch } from "@/lib/search";

type AppUser = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  role: "member" | "admin" | "moderator";
  profilePublic: boolean;
  createdAt: string;
};

type Health = {
  status: string;
  database: "connected" | "not_configured" | "unreachable";
  email: boolean;
};

type Conversation = {
  id: string;
  type: "direct" | "group" | "channel";
  title: string | null;
  username: string | null;
  isPublic: boolean;
  updatedAt: string;
  role: "owner" | "admin" | "member";
  muted: boolean;
  peer: { id: string; username: string; displayName: string } | null;
  lastMessage: { id: string; content: string; createdAt: string; senderName: string } | null;
  unreadCount: number;
};

type Message = {
  id: string;
  content: string;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  replyTo: { id: string; content: string; senderName: string } | null;
  sender: { id: string | null; username: string | null; displayName: string; isBot: boolean };
};

type BotRecord = {
  id: string;
  username: string;
  name: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  conversationsCount: number;
  conversationIds: string[];
  eventsCount: number;
  lastUsedAt: string | null;
  hasActiveToken: boolean;
};

type ToastData = { id: number; message: string; kind: "success" | "error" | "info" };
type TabId = "chats" | "bots" | "settings" | "admin";
type SearchData = {
  messages: Array<{
    id: string;
    conversationId: string;
    conversationType: string;
    conversationTitle: string;
    content: string;
    createdAt: string;
    senderUsername: string | null;
    senderName: string;
    rank: number;
  }>;
  people: Array<{ id: string; username: string; displayName: string; bio: string }>;
  publicConversations: Array<{ id: string; type: string; title: string | null; username: string | null; isPublic: boolean }>;
};
type SearchHistoryItem = { query: string; scopeId: string | null };
type SearchNavigationItem =
  | { kind: "message"; key: string; result: SearchData["messages"][number] }
  | { kind: "person"; key: string; result: SearchData["people"][number] }
  | { kind: "public"; key: string; result: SearchData["publicConversations"][number] }
  | { kind: "history"; key: string; result: SearchHistoryItem };
type JumpRequest = { messageId: string; nonce: number } | null;

function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, kind: ToastData["kind"] = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, kind });
    timer.current = setTimeout(() => setToast(null), 3400);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  return { toast, showToast, dismissToast };
}

function Toast({ toast, onClose }: { toast: ToastData | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite" key={toast.id}>
      <span className="toast-dot" />
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="بستن پیام"><X size={15} /></button>
    </div>
  );
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark${small ? " brand-mark-small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 44 44" fill="none">
        <path d="M9 29.5c0-8.1 5.8-14.5 13.4-14.5 4.6 0 8.2 1.8 11.2 5.3" stroke="currentColor" strokeWidth="4.1" strokeLinecap="round" />
        <path d="M34.2 11v14.1c0 4.6-3.5 8.2-8.1 8.2-3.1 0-5.8-1.6-7.2-4.1" stroke="var(--accent-lilac)" strokeWidth="4.1" strokeLinecap="round" />
        <circle cx="10" cy="33" r="2.6" fill="currentColor" />
      </svg>
    </span>
  );
}

function Avatar({ label, tone = 0, online = false, size = "normal" }: { label: string; tone?: number; online?: boolean; size?: "normal" | "large" | "small" }) {
  const first = label.trim().slice(0, 1) || "ر";
  return (
    <span className={`avatar avatar-tone-${tone % 5} avatar-${size}`} aria-hidden="true">
      <span>{first}</span>
      {online && <i className="avatar-online" />}
    </span>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-label="در حال آماده‌سازی روان">
      <BrandMark />
      <span className="loading-pulse" />
      <p>روان را آماده می‌کنیم</p>
    </main>
  );
}

function AuthScreen({ health, onAuthenticated }: {
  health: Health | null;
  onAuthenticated: (user: AppUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const databaseReady = health?.database === "connected";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "login") {
        const result = await apiFetch<{ user: AppUser }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ identifier, password }),
        });
        onAuthenticated(result.user);
      } else if (mode === "signup") {
        const result = await apiFetch<{ user?: AppUser; requiresEmailVerification: boolean; message?: string }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ username, email, displayName, password }),
        });
        if (result.requiresEmailVerification) {
          setNotice(result.message ?? "پیوند تأیید برای شما ارسال شد.");
          setMode("login");
          setIdentifier(email);
        } else if (result.user) {
          onAuthenticated(result.user);
        }
      } else {
        const result = await apiFetch<{ message: string }>("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setNotice(result.message);
      }
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? "خوش برگشتی" : mode === "signup" ? "حساب تازه بساز" : "بازیابی رمز عبور";

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="معرفی روان">
        <div className="auth-story-top"><BrandMark /><span>RAVAN / روان</span><span className="story-version">۰۱</span></div>
        <div className="story-copy">
          <span className="eyebrow">گفت‌وگو، با ریتم خودت</span>
          <h1>جایی برای<br /><em>حرف‌های مهم.</em></h1>
          <p>فضایی آرام و روشن برای ارتباط‌های روزمره؛ با جست‌وجویی که فارسی را می‌فهمد و ابزارهایی که زیر کنترل تو می‌مانند.</p>
          <div className="story-footnote"><span className="story-line" /><span>خصوصی به‌صورت پیش‌فرض · بدون ادعای رمزنگاری سرتاسری</span></div>
        </div>
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
        <div className="auth-watermark">ر</div>
      </section>

      <section className="auth-main">
        <div className="auth-topline"><span className="tiny-status"><i /> پیام‌رسان فارسی</span><span className="auth-locale">FA <span>·</span> RTL</span></div>
        <div className="auth-card-wrap">
          <div className="auth-mobile-brand"><BrandMark /><span>روان</span></div>
          <div className="auth-card">
            <div className="auth-card-heading">
              <span className="eyebrow">{mode === "login" ? "حساب کاربری" : mode === "signup" ? "به روان خوش آمدی" : "دسترسی دوباره"}</span>
              <h2>{title}</h2>
              <p>{mode === "login" ? "برای ادامه، وارد حساب خودت شو." : mode === "signup" ? "یک حساب بساز و گفت‌وگو را شروع کن." : "ایمیل حساب را وارد کن؛ اگر سرویس ایمیل فعال باشد، پیوند یک‌بارمصرف می‌فرستیم."}</p>
            </div>

            {health?.database !== "connected" && (
              <div className="setup-notice" role="status">
                <span className="setup-icon"><Settings2 size={17} /></span>
                <div>
                  <strong>{health?.database === "unreachable" ? "پایگاه داده پاسخ نمی‌دهد" : "نیازمند راه‌اندازی پایگاه داده"}</strong>
                  <p>{health?.database === "unreachable" ? "بررسی اتصال PostgreSQL ناموفق بود. تنظیمات محیطی را بررسی کنید." : "برای فعال‌کردن حساب‌ها و پیام‌های واقعی، DATABASE_URL را تنظیم و مهاجرت SQL را اجرا کنید."}</p>
                </div>
              </div>
            )}

            {notice && <div className="inline-notice" role="status">{notice}</div>}
            {error && <div className="inline-error" role="alert">{error}</div>}

            <form onSubmit={submit} className="auth-form">
              {mode === "login" && (
                <>
                  <label className="field-label" htmlFor="auth-identifier">نام کاربری یا ایمیل</label>
                  <input id="auth-identifier" className="text-field" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="مثلاً ramin یا you@example.com" required />
                </>
              )}
              {mode === "signup" && (
                <>
                  <label className="field-label" htmlFor="auth-display">نام نمایشی</label>
                  <input id="auth-display" className="text-field" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="نامی که دیگران می‌بینند" required maxLength={64} />
                  <label className="field-label" htmlFor="auth-username">نام کاربری</label>
                  <div className="input-prefix"><span>@</span><input id="auth-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="username" required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" /></div>
                  <label className="field-label" htmlFor="auth-email">ایمیل</label>
                  <input id="auth-email" className="text-field" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} />
                </>
              )}
              {mode === "forgot" && (
                <>
                  <label className="field-label" htmlFor="forgot-email">ایمیل حساب</label>
                  <input id="forgot-email" className="text-field" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
                  {!health?.email && <p className="field-hint">بازیابی رمز تا زمان پیکربندی فرستندهٔ ایمیل غیرفعال است.</p>}
                </>
              )}
              {mode !== "forgot" && (
                <>
                  <label className="field-label" htmlFor="auth-password">رمز عبور</label>
                  <input id="auth-password" className="text-field" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "login" ? "رمز عبور" : "حداقل ۱۲ نویسه"} required minLength={mode === "signup" ? 12 : 1} maxLength={128} />
                  {mode === "signup" && <p className="field-hint">حداقل ۱۲ نویسه؛ رمز عبور فقط به‌صورت scrypt hash ذخیره می‌شود.</p>}
                </>
              )}
              <button className="button button-primary auth-submit" type="submit" disabled={!databaseReady || busy || (mode === "forgot" && !health?.email)}>
                {busy ? <LoaderCircle size={17} className="spin" /> : null}
                {busy ? "در حال انجام…" : mode === "login" ? "ورود به روان" : mode === "signup" ? "ساخت حساب" : "ارسال پیوند بازیابی"}
                {!busy && <ArrowLeft size={16} />}
              </button>
            </form>

            <div className="auth-switches">
              {mode === "login" ? (
                <>
                  <button type="button" className="text-link" onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>حساب ندارید؟ <strong>ثبت‌نام</strong></button>
                  <button type="button" className="text-link subtle-link" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>رمز را فراموش کرده‌اید؟</button>
                </>
              ) : (
                <button type="button" className="text-link" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>بازگشت به <strong>ورود</strong></button>
              )}
            </div>
            <div className="auth-trust"><ShieldCheck size={15} /><span>نشست امن با کوکی HttpOnly و SameSite</span><span className="trust-dot">·</span><span>بدون E2EE در این نسخه</span></div>
          </div>
          <div className="auth-copyright"><span>RAVAN / روان</span><span>ساخته‌شده برای گفت‌وگوی روشن</span></div>
        </div>
      </section>
    </main>
  );
}

function conversationTitle(conversation: Conversation): string {
  if (conversation.type === "direct") return conversation.peer?.displayName ?? `@${conversation.peer?.username ?? "کاربر"}`;
  return conversation.title ?? "گفتگوی بدون نام";
}

function formatClock(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric" }).format(new Date(value));
  } catch {
    return "";
  }
}

function ConversationItem({ conversation, selected, onSelect, index }: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const title = conversationTitle(conversation);
  const subtitle = conversation.type === "direct"
    ? `@${conversation.peer?.username ?? ""}`
    : conversation.type === "channel" ? "کانال" : "گروه";
  return (
    <button type="button" className={`conversation-item${selected ? " conversation-selected" : ""}`} onClick={onSelect} aria-current={selected ? "page" : undefined}>
      <Avatar label={title} tone={index} />
      <span className="conversation-copy">
        <span className="conversation-line-one"><strong>{title}</strong><time>{formatClock(conversation.lastMessage?.createdAt ?? conversation.updatedAt)}</time></span>
        <span className="conversation-line-two"><span>{conversation.lastMessage?.content ?? subtitle}</span>{conversation.unreadCount > 0 && <b>{conversation.unreadCount > 99 ? "۹۹+" : conversation.unreadCount}</b>}</span>
      </span>
      {conversation.muted && <span className="muted-mark" title="بی‌صدا"><span>·</span></span>}
    </button>
  );
}

function EmptyChat({ onNewConversation, onSearch }: { onNewConversation: () => void; onSearch: () => void }) {
  return (
    <section className="empty-chat">
      <div className="empty-art" aria-hidden="true"><div className="empty-ring ring-one" /><div className="empty-ring ring-two" /><div className="empty-core"><BrandMark /></div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /></div>
      <span className="eyebrow">به روان خوش آمدید</span>
      <h1>گفت‌وگوهایت<br /><em>اینجا شروع می‌شوند.</em></h1>
      <p>برای پیدا کردن یک نفر جست‌وجو کن یا یک گفتگوی تازه بساز. محتوای خصوصی دیگران هرگز در نتایج جست‌وجو نمایش داده نمی‌شود.</p>
      <div className="empty-actions"><button className="button button-primary" onClick={onNewConversation}><Plus size={16} /> گفتگوی تازه</button><button className="button button-quiet" onClick={onSearch}><Search size={16} /> جست‌وجو</button></div>
      <div className="empty-footer"><span><i /> زیرساخت آمادهٔ PostgreSQL</span><span>نمایش دادهٔ آزمایشی خاموش است</span></div>
    </section>
  );
}

function MessageRow({ message, currentUserId, highlighted, onReply, onEdit, onDelete }: {
  message: Message;
  currentUserId: string;
  highlighted: boolean;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
}) {
  const own = message.sender.id === currentUserId && !message.sender.isBot;
  return (
    <article id={`message-${message.id}`} className={`message-row${own ? " message-own" : ""}${highlighted ? " message-highlight" : ""}`}>
      {!own && <Avatar label={message.sender.displayName} size="small" tone={message.sender.isBot ? 3 : 1} />}
      <div className="message-content-wrap">
        {!own && <div className="message-sender">{message.sender.displayName}{message.sender.isBot && <span className="bot-badge">ربات</span>}</div>}
        <div className="message-bubble">
          {message.replyTo && <div className="reply-preview"><span /> <div><strong>{message.replyTo.senderName}</strong><p>{message.replyTo.content}</p></div></div>}
          <p className={message.deleted ? "deleted-message" : ""}>{message.content}</p>
          <div className="message-meta"><time>{formatClock(message.createdAt)}</time>{message.editedAt && !message.deleted && <span>ویرایش‌شده</span>}</div>
        </div>
        {!message.deleted && (
          <div className="message-actions" aria-label="عملیات پیام">
            <button type="button" title="پاسخ" onClick={() => onReply(message)}><Reply size={14} /></button>
            {own && <button type="button" title="ویرایش" onClick={() => onEdit(message)}><Pencil size={13} /></button>}
            {(own || message.sender.isBot) && <button type="button" title="حذف" onClick={() => onDelete(message)}><Trash2 size={13} /></button>}
          </div>
        )}
      </div>
      {own && <span className="own-message-spacer" />}
    </article>
  );
}

function ChatPanel({ conversation, user, onBack, onSearch, onDetails, jumpRequest, onChanged, showToast }: {
  conversation: Conversation;
  user: AppUser;
  onBack: () => void;
  onSearch: () => void;
  onDetails: () => void;
  jumpRequest: JumpRequest;
  onChanged: () => void;
  showToast: (message: string, kind?: ToastData["kind"]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [oldestId, setOldestId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [sendError, setSendError] = useState("");
  const [pendingIdempotency, setPendingIdempotency] = useState<{ text: string; id: string } | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const canSend = conversation.type !== "channel" || conversation.role === "owner" || conversation.role === "admin";
  const title = conversationTitle(conversation);

  const loadRecent = useCallback(async (initial = false, jumpId: string | null = null) => {
    try {
      const before = jumpId ? (BigInt(jumpId) + 1n).toString() : null;
      const query = before ? `?before=${before}&limit=50` : "?limit=50";
      const result = await apiFetch<{ messages: Message[]; hasMore: boolean; nextBefore: string | null }>(`/api/conversations/${conversation.id}/messages${query}`);
      setConnectionIssue(false);
      if (initial || jumpId) {
        setMessages(result.messages);
        setHasMore(result.hasMore);
        setOldestId(result.nextBefore);
      } else {
        const shouldStick = atBottom.current;
        setMessages((previous) => {
          const map = new Map(previous.map((message) => [message.id, message]));
          for (const message of result.messages) map.set(message.id, message);
          return [...map.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        });
        if (shouldStick) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
      }
      return result;
    } catch (error) {
      setConnectionIssue(true);
      if (initial) showToast(errorMessage(error), "error");
      return null;
    } finally {
      if (initial) setLoading(false);
    }
  }, [conversation.id, showToast]);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setLoading(true);
    setDraft("");
    setReplyTo(null);
    setEditing(null);
    setPendingIdempotency(null);
    setConnectionIssue(false);
    void loadRecent(true, jumpRequest?.messageId ?? null).then(() => {
      if (!active) return;
      requestAnimationFrame(() => {
        if (jumpRequest?.messageId) {
          document.getElementById(`message-${jumpRequest.messageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        } else {
          listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
        }
      });
    });

    const poll = () => {
      if (document.visibilityState === "visible") void loadRecent(false);
    };
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener("focus", poll);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [conversation.id, jumpRequest?.nonce, jumpRequest?.messageId, loadRecent]);

  useEffect(() => {
    if (jumpRequest?.messageId && messages.some((message) => message.id === jumpRequest.messageId)) {
      document.getElementById(`message-${jumpRequest.messageId}`)?.classList.add("message-highlight");
      const timer = window.setTimeout(() => document.getElementById(`message-${jumpRequest.messageId}`)?.classList.remove("message-highlight"), 2600);
      return () => clearTimeout(timer);
    }
  }, [jumpRequest?.nonce, jumpRequest?.messageId, messages]);

  async function loadOlder() {
    if (!oldestId || loadingOlder || !hasMore) return;
    const container = listRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const result = await apiFetch<{ messages: Message[]; hasMore: boolean; nextBefore: string | null }>(`/api/conversations/${conversation.id}/messages?before=${oldestId}&limit=50`);
      setMessages((previous) => {
        const map = new Map(result.messages.map((message) => [message.id, message]));
        for (const message of previous) map.set(message.id, message);
        return [...map.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      });
      setHasMore(result.hasMore);
      setOldestId(result.nextBefore);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - previousHeight;
      });
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setLoadingOlder(false);
    }
  }

  function handleScroll() {
    const container = listRef.current;
    if (!container) return;
    atBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 110;
    if (container.scrollTop < 24) void loadOlder();
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || !canSend) return;
    const clientRequestId = pendingIdempotency?.text === text ? pendingIdempotency.id : crypto.randomUUID();
    setPendingIdempotency({ text, id: clientRequestId });
    setSending(true);
    setSendError("");
    try {
      const result = await apiFetch<{ message: Message }>(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, clientRequestId, ...(replyTo ? { replyToId: replyTo.id } : {}) }),
      });
      setMessages((previous) => {
        const map = new Map(previous.map((message) => [message.id, message]));
        map.set(result.message.id, result.message);
        return [...map.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      });
      setDraft("");
      setReplyTo(null);
      setPendingIdempotency(null);
      atBottom.current = true;
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
      onChanged();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (error) {
      const message = errorMessage(error);
      setSendError(message);
      setPendingIdempotency({ text, id: clientRequestId });
      showToast("پیام ارسال نشد؛ متن حفظ شده و می‌توانید دوباره تلاش کنید.", "error");
    } finally {
      setSending(false);
    }
  }

  async function editMessage() {
    if (!editing) return;
    try {
      const result = await apiFetch<{ message: { id: string; content: string; editedAt: string } }>(`/api/conversations/${conversation.id}/messages/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: editText }),
      });
      setMessages((previous) => previous.map((message) => message.id === editing.id ? { ...message, content: result.message.content, editedAt: result.message.editedAt } : message));
      setEditing(null);
      showToast("پیام ویرایش شد.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function deleteMessage(message: Message) {
    if (!window.confirm("این پیام برای اعضای گفتگو حذف شود؟")) return;
    try {
      await apiFetch(`/api/conversations/${conversation.id}/messages/${message.id}`, { method: "DELETE" });
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, content: "این پیام حذف شده است", deleted: true } : item));
      showToast("پیام حذف شد.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function setConversationFlag(key: "muted" | "archived", value: boolean) {
    try {
      await apiFetch(`/api/conversations/${conversation.id}`, { method: "PATCH", body: JSON.stringify({ [key]: value }) });
      setChatMenuOpen(false);
      onChanged();
      if (key === "archived" && value) onBack();
      showToast(key === "muted" ? (value ? "گفتگو بی‌صدا شد." : "صدای گفتگو فعال شد.") : "گفتگو از فهرست اصلی پنهان شد.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  function onTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
    if (event.key === "Escape") setReplyTo(null);
  }

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <button type="button" className="icon-button mobile-back" onClick={onBack} aria-label="بازگشت به فهرست گفتگوها"><ArrowRightIcon /></button>
        <button type="button" className="chat-profile" onClick={onDetails}>
          <Avatar label={title} tone={conversation.type === "channel" ? 4 : 1} />
          <span className="chat-title-wrap"><strong>{title}</strong><small>{conversation.type === "direct" ? `@${conversation.peer?.username ?? ""}` : conversation.type === "channel" ? "کانال" : "گروه خصوصی"}</small></span>
        </button>
        <div className="chat-header-actions">
          <button type="button" className="icon-button" onClick={onSearch} aria-label="جست‌وجو در گفتگو" title="جست‌وجو"><Search size={18} /></button>
          <button type="button" className="icon-button" onClick={onDetails} aria-label="اعضا و اطلاعات گفتگو" title="اعضا"><Users size={18} /></button>
          <div className="menu-wrap">
            <button type="button" className="icon-button" onClick={() => setChatMenuOpen((value) => !value)} aria-label="گزینه‌های گفتگو"><MoreHorizontal size={19} /></button>
            {chatMenuOpen && <div className="context-menu">
              <button onClick={() => void setConversationFlag("muted", !conversation.muted)}>{conversation.muted ? "فعال‌کردن اعلان‌ها" : "بی‌صداکردن گفتگو"}</button>
              <button onClick={() => void setConversationFlag("archived", true)}>بایگانی گفتگو</button>
              <button onClick={onDetails}>اطلاعات گفتگو</button>
            </div>}
          </div>
        </div>
      </header>

      {connectionIssue && <div className="connection-banner"><span /> اتصال ناپایدار است؛ همگام‌سازی دوباره تلاش می‌شود.<button onClick={() => void loadRecent(false)}>تلاش دوباره</button></div>}
      <div className="chat-canvas">
        <div className="chat-watermark" aria-hidden="true">ر</div>
        <div className="message-list" ref={listRef} onScroll={handleScroll} role="log" aria-label={`پیام‌های ${title}`} aria-live="polite">
          {loadingOlder && <div className="load-older"><LoaderCircle className="spin" size={16} /> پیام‌های پیشین</div>}
          {loading ? <div className="message-skeletons"><div /><div /><div /><div /></div> : messages.length === 0 ? (
            <div className="chat-empty-state"><div className="chat-empty-icon"><MessageCircle size={25} /></div><strong>شروع یک گفت‌وگوی تازه</strong><p>اولین پیام را بفرست؛ پیام‌ها فقط برای اعضای مجاز این گفتگو قابل مشاهده‌اند.</p></div>
          ) : (
            <>
              <div className="history-note"><span /> پیام‌های این گفتگو از پایگاه داده دریافت می‌شوند <span /></div>
              {messages.map((message) => (
                <div className="message-edit-wrap" key={message.id}>
                  {editing?.id === message.id ? (
                    <div className="edit-message-box"><textarea autoFocus value={editText} maxLength={5000} onChange={(event) => setEditText(event.target.value)} /><div><button className="button button-quiet button-small" onClick={() => setEditing(null)}>لغو</button><button className="button button-primary button-small" onClick={() => void editMessage()}>ذخیره</button></div></div>
                  ) : (
                    <MessageRow
                      message={message}
                      currentUserId={user.id}
                      highlighted={jumpRequest?.messageId === message.id}
                      onReply={(selected) => { setReplyTo(selected); textareaRef.current?.focus(); }}
                      onEdit={(selected) => { setEditing(selected); setEditText(selected.content); }}
                      onDelete={(selected) => void deleteMessage(selected)}
                    />
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="chat-composer-wrap">
          {replyTo && <div className="reply-composer"><div><strong>پاسخ به {replyTo.sender.displayName}</strong><span>{replyTo.content}</span></div><button onClick={() => setReplyTo(null)} aria-label="لغو پاسخ"><X size={16} /></button></div>}
          {sendError && <div className="send-error" role="alert"><span>{sendError}</span><button onClick={() => void sendMessage()}>تلاش دوباره</button></div>}
          {!canSend && <div className="channel-readonly">در این کانال فقط مالک یا مدیر می‌تواند پیام بفرستد.</div>}
          <form className="composer" onSubmit={(event) => void sendMessage(event)}>
            <textarea
              ref={textareaRef}
              aria-label="متن پیام"
              placeholder={canSend ? "پیامت را بنویس…" : "ارسال پیام فقط برای مدیران فعال است"}
              value={draft}
              maxLength={5000}
              disabled={!canSend}
              rows={1}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(value);
                setSendError("");
                if (pendingIdempotency && pendingIdempotency.text !== value.trim()) setPendingIdempotency(null);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 148)}px`;
              }}
              onKeyDown={onTextareaKeyDown}
            />
            <div className="composer-tools"><span className="composer-hint">Enter برای ارسال · Shift+Enter برای خط جدید</span><div><span className="character-count">{draft.length > 4500 ? `${draft.length}/5000` : ""}</span><button type="submit" className="send-button" disabled={!draft.trim() || sending || !canSend} aria-label="ارسال پیام" title="ارسال پیام">{sending ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button></div></div>
          </form>
          <div className="composer-footnote"><span><LockMark /></span><span>گفتگو با کنترل دسترسی عضویت · همگام‌سازی هر ۱۵ ثانیه در حالت فعال</span><span className="composer-privacy-dot">·</span><span>بدون E2EE</span></div>
        </div>
      </div>
    </section>
  );
}

function ArrowRightIcon() {
  return <ArrowLeft size={19} />;
}

function LockMark() {
  return <span className="lock-mark" aria-hidden="true">⌑</span>;
}

function Modal({ title, children, onClose, width = "normal" }: { title: string; children: ReactNode; onClose: () => void; width?: "normal" | "wide" }) {
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal-card${width === "wide" ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header"><div><span className="eyebrow">روان</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="بستن"><X size={19} /></button></header>
        {children}
      </section>
    </div>
  );
}

function CreateConversationDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [type, setType] = useState<"direct" | "group" | "channel">("direct");
  const [username, setUsername] = useState("");
  const [title, setTitle] = useState("");
  const [publicUsername, setPublicUsername] = useState("");
  const [members, setMembers] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (type === "direct") await onCreate({ type, username: username.trim().replace(/^@/, "").toLowerCase() });
      else await onCreate({
        type,
        title: title.trim(),
        ...(type === "channel" && isPublic ? { username: publicUsername.trim().replace(/^@/, "").toLowerCase() } : {}),
        isPublic: type === "channel" && isPublic,
        members: members.split(/[،,\n]/).map((member) => member.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
      });
      onClose();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="گفتگوی تازه" onClose={onClose}>
      <div className="segmented-control" role="tablist" aria-label="نوع گفتگو">
        {([ ["direct", "خصوصی"], ["group", "گروه"], ["channel", "کانال"] ] as const).map(([value, label]) => <button type="button" key={value} className={type === value ? "segment-active" : ""} onClick={() => setType(value)} role="tab" aria-selected={type === value}>{label}</button>)}
      </div>
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        {type === "direct" ? (
          <><label className="field-label" htmlFor="direct-username">نام کاربری طرف گفتگو</label><div className="input-prefix"><span>@</span><input id="direct-username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} autoFocus placeholder="username" required minLength={3} maxLength={24} /></div><p className="field-hint">کاربر باید حساب فعال و پروفایل قابل جست‌وجو داشته باشد. ایجاد گفتگو، دادهٔ آزمایشی تولید نمی‌کند.</p></>
        ) : (
          <>
            <label className="field-label" htmlFor="conversation-title">نام {type === "group" ? "گروه" : "کانال"}</label>
            <input id="conversation-title" className="text-field" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus maxLength={80} placeholder={type === "group" ? "مثلاً تیم طراحی" : "مثلاً خبرهای محصول"} required />
            {type === "channel" && <label className="toggle-row"><span><strong>کانال عمومی</strong><small>قابل کشف از طریق جست‌وجوی عمومی</small></span><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /><span className="toggle-ui" /></label>}
            {type === "channel" && isPublic && <><label className="field-label" htmlFor="channel-username">نام کاربری عمومی</label><div className="input-prefix"><span>@</span><input id="channel-username" value={publicUsername} onChange={(event) => setPublicUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="channel_name" minLength={3} maxLength={32} required /></div></>}
            <label className="field-label" htmlFor="group-members">اعضای اولیه <span className="optional">اختیاری</span></label>
            <input id="group-members" className="text-field" value={members} onChange={(event) => setMembers(event.target.value)} placeholder="username1، username2" />
            <p className="field-hint">نام‌های کاربری را با ویرگول جدا کن؛ سازنده مالک گروه خواهد بود.</p>
          </>
        )}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <button className="button button-primary modal-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{busy ? "در حال ساخت…" : "ساخت گفتگو"}</button>
      </form>
    </Modal>
  );
}

function SearchPalette({ onClose, conversations, scopeId, history, onHistory, onOpenMessage, onOpenPerson, onJoinConversation, onOpenConversation }: {
  onClose: () => void;
  conversations: Conversation[];
  scopeId: string | null;
  history: SearchHistoryItem[];
  onHistory: (item: SearchHistoryItem) => void;
  onOpenMessage: (result: SearchData["messages"][number]) => void;
  onOpenPerson: (username: string) => void;
  onJoinConversation: (id: string) => Promise<void>;
  onOpenConversation: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "messages" | "people" | "public">("all");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setData(null);
      setError("");
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setData(null);
    setBusy(true);
    setError("");
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: trimmed });
      if (scopeId) params.set("conversationId", scopeId);
      try {
        const result = await apiFetch<SearchData>(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!controller.signal.aborted) setData(result);
      } catch (searchError) {
        if (!controller.signal.aborted) setError(errorMessage(searchError));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 260);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, scopeId]);

  const scopeTitle = scopeId ? conversations.find((conversation) => conversation.id === scopeId) : null;
  const messageResults = useMemo(() => data?.messages ?? [], [data]);
  const peopleResults = useMemo(() => data?.people ?? [], [data]);
  const publicResults = useMemo(() => data?.publicConversations ?? [], [data]);
  const hasAny = messageResults.length + peopleResults.length + publicResults.length > 0;
  const showMessages = filter === "all" || filter === "messages";
  const showPeople = filter === "all" || filter === "people";
  const showPublic = filter === "all" || filter === "public";
  const navigationItems = useMemo<SearchNavigationItem[]>(() => {
    if (query.trim().length < 2) {
      return history.map((result, index) => ({ kind: "history", key: `history:${result.scopeId ?? ""}:${result.query}:${index}`, result }));
    }
    if (busy || error) return [];
    return [
      ...(showMessages ? messageResults.map((result) => ({ kind: "message" as const, key: `message:${result.conversationId}:${result.id}`, result })) : []),
      ...(showPeople ? peopleResults.map((result) => ({ kind: "person" as const, key: `person:${result.id}`, result })) : []),
      ...(showPublic ? publicResults.map((result) => ({ kind: "public" as const, key: `public:${result.id}`, result })) : []),
    ];
  }, [query, history, busy, error, showMessages, showPeople, showPublic, messageResults, peopleResults, publicResults]);
  const navigationIndexes = useMemo(() => new Map(navigationItems.map((item, index) => [item.key, index])), [navigationItems]);

  useEffect(() => { setActiveIndex(0); }, [query, filter, scopeId]);
  useEffect(() => {
    if (navigationItems.length === 0) {
      if (activeIndex !== 0) setActiveIndex(0);
    } else if (activeIndex >= navigationItems.length) {
      setActiveIndex(navigationItems.length - 1);
    }
  }, [activeIndex, navigationItems.length]);
  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activateResult = async (item: SearchNavigationItem) => {
    if (item.kind === "history") {
      setQuery(item.result.query);
      return;
    }
    onHistory({ query: trimmedHistory(query), scopeId });
    if (item.kind === "message") {
      onOpenMessage(item.result);
      return;
    }
    if (item.kind === "person") {
      onOpenPerson(item.result.username);
      return;
    }
    if (conversations.some((conversation) => conversation.id === item.result.id)) {
      onOpenConversation(item.result.id);
      return;
    }
    if (joiningId) return;
    setJoiningId(item.result.id);
    try {
      await onJoinConversation(item.result.id);
    } catch (joinError) {
      setError(errorMessage(joinError));
    } finally {
      setJoiningId(null);
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && navigationItems.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => event.key === "ArrowDown"
        ? (current + 1) % navigationItems.length
        : (current - 1 + navigationItems.length) % navigationItems.length);
      return;
    }
    if (event.key === "Enter" && navigationItems[activeIndex]) {
      event.preventDefault();
      void activateResult(navigationItems[activeIndex]);
    }
  };

  const indexOf = (key: string) => navigationIndexes.get(key) ?? -1;

  return (
    <div className="search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-palette" role="dialog" aria-modal="true" aria-label="جست‌وجوی سراسری">
        <div className="search-input-row"><Search size={19} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scopeTitle ? `جست‌وجو در ${conversationTitle(scopeTitle)}` : "نام، پیام یا عبارت را جست‌وجو کن…"} onKeyDown={handleSearchKeyDown} aria-activedescendant={navigationItems[activeIndex] ? `search-result-${activeIndex}` : undefined} /><kbd>ESC</kbd><button className="icon-button search-close" onClick={onClose} aria-label="بستن جست‌وجو"><X size={17} /></button></div>
        <div className="search-filters">{([ ["all", "همه"], ["messages", "پیام‌ها"], ["people", "افراد"], ["public", "عمومی"] ] as const).map(([value, label]) => <button key={value} className={filter === value ? "filter-active" : ""} onClick={() => setFilter(value)}>{label}</button>)}{scopeTitle && <span className="scope-chip">در {conversationTitle(scopeTitle)}<button onClick={() => setQuery("")} aria-label="پاک‌کردن عبارت"><X size={12} /></button></span>}</div>
        <div className="search-results" aria-live="polite">
          {query.trim().length < 2 ? (
            <>
              <div className="search-section-title"><span>جست‌وجوهای اخیر همین نشست</span>{history.length > 0 && <button onClick={() => onHistory({ query: "__clear__", scopeId: null })}>پاک‌کردن</button>}</div>
              {history.length ? history.map((item, index) => <button className={`search-history-row${activeIndex === index ? " search-history-row-active" : ""}`} key={`${item.query}-${index}`} id={`search-result-${index}`} data-search-index={index} aria-current={activeIndex === index ? "true" : undefined} onClick={() => { void activateResult({ kind: "history", key: `history:${item.scopeId ?? ""}:${item.query}:${index}`, result: item }); }}><Clock3 size={15} /><span>{item.query}</span><ChevronLeft size={14} /></button>) : <div className="search-idle"><Search size={22} /><p>دو نویسه یا بیشتر بنویس.</p><small>برای عبارت دقیق، آن را داخل «گیومه» بنویس.</small></div>}
            </>
          ) : busy ? <div className="search-loading"><LoaderCircle size={19} className="spin" /> در حال جست‌وجوی مجاز…</div> : error ? <div className="search-empty-state"><span className="empty-search-icon"><Search size={19} /></span><strong>جست‌وجو انجام نشد</strong><p>{error}</p></div> : !hasAny ? <div className="search-empty-state"><span className="empty-search-icon"><Search size={19} /></span><strong>چیزی پیدا نشد</strong><p>املای عبارت را بررسی کن یا فیلتر را تغییر بده.</p></div> : (
            <>
              {showMessages && messageResults.length > 0 && <div className="search-section"><div className="search-section-title"><span>پیام‌ها <b>{messageResults.length}</b></span><span className="search-section-caption">فقط گفتگوهای مجاز تو</span></div>{messageResults.map((result) => {
                const itemKey = `message:${result.conversationId}:${result.id}`;
                const itemIndex = indexOf(itemKey);
                return <button key={itemKey} id={`search-result-${itemIndex}`} data-search-index={itemIndex} aria-current={activeIndex === itemIndex ? "true" : undefined} className={`search-result-row${activeIndex === itemIndex ? " search-result-row-active" : ""}`} onClick={() => { void activateResult({ kind: "message", key: itemKey, result }); }}><span className="result-icon"><MessageCircle size={15} /></span><span className="result-main"><span className="result-heading"><strong>{result.conversationTitle}</strong><time>{formatDate(result.createdAt)} · {formatClock(result.createdAt)}</time></span><span className="result-snippet"><b>{result.senderName}</b> · <HighlightedText text={result.content} query={query} /></span></span><ArrowUpRight size={14} className="result-arrow" /></button>;
              })}</div>}
              {showPeople && peopleResults.length > 0 && <div className="search-section"><div className="search-section-title"><span>افراد <b>{peopleResults.length}</b></span><span className="search-section-caption">پروفایل عمومی</span></div>{peopleResults.map((person, index) => {
                const itemKey = `person:${person.id}`;
                const itemIndex = indexOf(itemKey);
                return <button key={itemKey} id={`search-result-${itemIndex}`} data-search-index={itemIndex} aria-current={activeIndex === itemIndex ? "true" : undefined} className={`search-result-row${activeIndex === itemIndex ? " search-result-row-active" : ""}`} onClick={() => { void activateResult({ kind: "person", key: itemKey, result: person }); }}><Avatar label={person.displayName} tone={index} size="small" /><span className="result-main"><span className="result-heading"><strong>{person.displayName}</strong><small>@{person.username}</small></span><span className="result-snippet">{person.bio || "پروفایل عمومی"}</span></span><ChevronLeft size={15} className="result-arrow" /></button>;
              })}</div>}
              {showPublic && publicResults.length > 0 && <div className="search-section"><div className="search-section-title"><span>گروه‌ها و کانال‌های عمومی <b>{publicResults.length}</b></span><span className="search-section-caption">قابل کشف عمومی</span></div>{publicResults.map((conversation, index) => {
                const itemKey = `public:${conversation.id}`;
                const itemIndex = indexOf(itemKey);
                return <div key={itemKey} id={`search-result-${itemIndex}`} data-search-index={itemIndex} aria-current={activeIndex === itemIndex ? "true" : undefined} className={`search-result-row public-result${activeIndex === itemIndex ? " search-result-row-active" : ""}`}><Avatar label={conversation.title ?? "گفتگو"} tone={index + 3} size="small" /><span className="result-main"><span className="result-heading"><strong>{conversation.title}</strong><small>@{conversation.username ?? "عمومی"}</small></span><span className="result-snippet">{conversation.type === "channel" ? "کانال" : "گروه عمومی"}</span></span><button className="button button-quiet button-small" disabled={joiningId !== null} onClick={() => { void activateResult({ kind: "public", key: itemKey, result: conversation }); }}>{joiningId === conversation.id ? <LoaderCircle size={14} className="spin" /> : "پیوستن"}</button></div>;
              })}</div>}
            </>
          )}
        </div>
        <footer className="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> پیمایش</span><span><kbd>↵</kbd> انتخاب</span><span>نتایج خصوصی در سرور محدود می‌شوند</span></footer>
      </section>
    </div>
  );
}

function trimmedHistory(value: string) {
  return value.trim().slice(0, 160);
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const rawQuery = query.trim().replace(/^\"|\"$/g, "");
  const normalizedQuery = normalizePersianSearch(rawQuery);
  if (!normalizedQuery || !hasSearchTerm(text, rawQuery)) return <>{text}</>;
  const start = text.toLocaleLowerCase("fa").indexOf(rawQuery.toLocaleLowerCase("fa"));
  if (start < 0) return <>{text}</>;
  return <>{text.slice(0, start)}<mark>{text.slice(start, start + rawQuery.length)}</mark>{text.slice(start + rawQuery.length)}</>;
}

function BotStudio({ conversations, showToast }: { conversations: Conversation[]; showToast: (message: string, kind?: ToastData["kind"]) => void }) {
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenOnce, setTokenOnce] = useState<string | null>(null);
  const [tokenBotName, setTokenBotName] = useState("");
  const [attachConversationId, setAttachConversationId] = useState("");
  const [events, setEvents] = useState<Array<{ updateId: string; type: string; createdAt: string; deliveredAt: string | null; attempts: number }>>([]);
  const [apiErrorText, setApiErrorText] = useState("");

  const selectedBot = bots.find((bot) => bot.id === selectedId) ?? null;
  const selectedBotId = selectedBot?.id ?? null;
  const availableConversations = useMemo(() => conversations.filter((conversation) => !selectedBot?.conversationIds.includes(conversation.id)), [conversations, selectedBot]);

  const refreshBots = useCallback(async () => {
    try {
      const result = await apiFetch<{ bots: BotRecord[] }>("/api/bots");
      setBots(result.bots);
      setSelectedId((current) => current && result.bots.some((bot) => bot.id === current) ? current : result.bots[0]?.id ?? null);
      setApiErrorText("");
    } catch (error) {
      setApiErrorText(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshBots(); }, [refreshBots]);
  useEffect(() => {
    if (!selectedBotId) { setEvents([]); return; }
    let active = true;
    apiFetch<{ events: typeof events }>(`/api/bots/${selectedBotId}/events`)
      .then((result) => { if (active) setEvents(result.events); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [selectedBotId]);

  async function createBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await apiFetch<{ bot: BotRecord; token: string }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({ name: newName, username: newUsername, description: newDescription }),
      });
      setTokenOnce(result.token);
      setTokenBotName(result.bot.name);
      setCreateOpen(false);
      setNewName(""); setNewUsername(""); setNewDescription("");
      await refreshBots();
      setSelectedId(result.bot.id);
      showToast("ربات ساخته شد؛ توکن فقط همین بار نمایش داده می‌شود.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function rotateToken() {
    if (!selectedBot) return;
    if (!window.confirm("توکن فعلی فوراً لغو می‌شود. ادامه می‌دهید؟")) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ token: string }>(`/api/bots/${selectedBot.id}/rotate-token`, { method: "POST" });
      setTokenOnce(result.token);
      setTokenBotName(selectedBot.name);
      await refreshBots();
      showToast("توکن قبلی لغو و توکن تازه صادر شد.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBot() {
    if (!selectedBot) return;
    try {
      await apiFetch(`/api/bots/${selectedBot.id}`, { method: "PATCH", body: JSON.stringify({ active: !selectedBot.active }) });
      await refreshBots();
      showToast(selectedBot.active ? "ربات غیرفعال شد؛ توکن‌های فعال لغو شدند." : "ربات فعال شد؛ برای استفاده توکن تازه صادر کنید.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function removeBot() {
    if (!selectedBot || !window.confirm(`ربات @${selectedBot.username} حذف و توکن‌هایش لغو شود؟`)) return;
    try {
      await apiFetch(`/api/bots/${selectedBot.id}`, { method: "DELETE" });
      setTokenOnce(null);
      await refreshBots();
      showToast("ربات حذف شد.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function attachBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBot || !attachConversationId) return;
    try {
      await apiFetch(`/api/bots/${selectedBot.id}/conversations`, { method: "POST", body: JSON.stringify({ conversationId: attachConversationId }) });
      setAttachConversationId("");
      await refreshBots();
      showToast("ربات به گفتگو اضافه شد.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function detachBot(conversationId: string) {
    if (!selectedBot) return;
    try {
      await apiFetch(`/api/bots/${selectedBot.id}/conversations`, { method: "DELETE", body: JSON.stringify({ conversationId }) });
      await refreshBots();
      showToast("ربات از گفتگو خارج شد.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function copyToken() {
    if (!tokenOnce) return;
    try { await navigator.clipboard.writeText(tokenOnce); showToast("توکن در کلیپ‌بورد کپی شد.", "success"); }
    catch { showToast("کپی خودکار ممکن نیست؛ توکن را دستی کپی کنید.", "error"); }
  }

  async function copyDocs() {
    const snippet = `Authorization: Bearer $RAVAN_BOT_TOKEN\nGET /api/v1/bot/updates?offset=0\nPOST /api/v1/bot/messages`;
    try { await navigator.clipboard.writeText(snippet); showToast("نمونهٔ اتصال کپی شد.", "success"); }
    catch { showToast("دسترسی کلیپ‌بورد در این مرورگر فعال نیست.", "error"); }
  }

  return (
    <section className="studio-view">
      <header className="section-header"><div><span className="eyebrow">فضای توسعه‌دهنده</span><h1>استودیوی ربات</h1><p>توکن امن، API نسخه‌دار، رویدادهای قابل رهگیری.</p></div><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> ربات تازه</button></header>
      {apiErrorText && <div className="inline-error" role="alert">{apiErrorText}</div>}
      <div className="studio-layout">
        <aside className="bot-list-panel">
          <div className="panel-caption"><span>ربات‌های تو</span><span>{bots.length.toLocaleString("fa-IR")}</span></div>
          {loading ? <div className="list-skeleton"><i /><i /><i /></div> : bots.length === 0 ? <div className="bot-list-empty"><BotIcon size={21} /><strong>هنوز رباتی نساختی</strong><p>با یک شناسهٔ یکتا شروع کن.</p><button onClick={() => setCreateOpen(true)}>ساخت اولین ربات</button></div> : bots.map((bot, index) => <button key={bot.id} className={`bot-list-item${selectedId === bot.id ? " bot-list-active" : ""}`} onClick={() => { setSelectedId(bot.id); setTokenOnce(null); }}><Avatar label={bot.name} tone={index + 2} /><span><strong>{bot.name}</strong><small>@{bot.username}</small></span><i className={bot.active ? "bot-online" : "bot-offline"} /></button>)}
          <div className="bot-security-note"><ShieldCheck size={15} /><span>توکن فقط هنگام ساخت یا چرخش نمایش داده می‌شود.</span></div>
        </aside>

        <div className="bot-detail-panel">
          {!selectedBot ? (
            <div className="studio-empty"><div className="studio-empty-icon"><Code2 size={24} /></div><span className="eyebrow">Bot Platform</span><h2>رباتی بساز که<br /><em>زیر کنترل توست.</em></h2><p>کد ربات بیرون از سرور روان اجرا می‌شود. اینجا فقط هویت، مجوز گفتگو و API امن آن را مدیریت می‌کنی.</p><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> ساخت ربات</button></div>
          ) : (
            <>
              <div className="bot-detail-heading"><div className="bot-heading-avatar"><Avatar label={selectedBot.name} tone={3} size="large" /></div><div className="bot-heading-copy"><div className="bot-heading-title"><div><h2>{selectedBot.name}</h2><span>@{selectedBot.username}</span></div><span className={`status-pill${selectedBot.active ? " status-active" : " status-muted"}`}><i />{selectedBot.active ? "فعال" : "غیرفعال"}</span></div><p>{selectedBot.description || "بدون توضیحات"}</p></div><div className="bot-quick-actions"><button className="icon-button" title={selectedBot.active ? "غیرفعال‌کردن ربات" : "فعال‌کردن ربات"} onClick={() => void toggleBot()}><Activity size={17} /></button><button className="icon-button danger-icon" title="حذف ربات" onClick={() => void removeBot()}><Trash2 size={16} /></button></div></div>
              <div className="bot-stat-grid"><div><span>گفتگوهای متصل</span><strong>{selectedBot.conversationsCount.toLocaleString("fa-IR")}</strong></div><div><span>رویدادها</span><strong>{selectedBot.eventsCount.toLocaleString("fa-IR")}</strong></div><div><span>آخرین استفاده</span><strong>{selectedBot.lastUsedAt ? formatDate(selectedBot.lastUsedAt) : "—"}</strong></div></div>

              <section className="studio-card token-card"><div className="studio-card-heading"><div><span className="eyebrow">اعتبارنامه</span><h3>توکن دسترسی</h3></div><KeyRound size={18} /></div><p>توکن در پایگاه داده به‌صورت hash نگهداری می‌شود. با چرخش، توکن قبلی فوراً باطل خواهد شد.</p>{tokenOnce && tokenBotName === selectedBot.name ? <div className="token-once"><div className="token-warning"><ShieldCheck size={16} /><span>این مقدار فقط اکنون قابل مشاهده است؛ پیش از بستن صفحه آن را امن ذخیره کن.</span></div><code dir="ltr">{tokenOnce}</code><button className="button button-primary button-small" onClick={() => void copyToken()}><Copy size={14} /> کپی توکن</button></div> : <div className="token-placeholder"><span className="token-dots">••••••••••••••••••••</span><span>{selectedBot.hasActiveToken ? "توکن پنهان است" : "توکن فعالی وجود ندارد"}</span></div>}<div className="studio-card-actions"><button className="button button-quiet button-small" onClick={() => void rotateToken()} disabled={busy}><KeyRound size={14} /> {selectedBot.hasActiveToken ? "چرخش توکن" : "صدور توکن"}</button><button className="button button-quiet button-small" onClick={() => { setTokenOnce(null); setTokenBotName(""); }}>پنهان‌کردن</button></div></section>

              <section className="studio-card"><div className="studio-card-heading"><div><span className="eyebrow">دسترسی به گفتگو</span><h3>گفتگوهای متصل</h3></div><Users size={18} /></div><p>ربات تنها پس از افزودن به یک گفتگو، رویدادهای مجاز همان گفتگو را دریافت می‌کند.</p>{selectedBot.conversationIds.length === 0 ? <div className="attached-empty">هنوز گفتگویی متصل نیست.</div> : <div className="attached-list">{selectedBot.conversationIds.map((id) => { const conversation = conversations.find((item) => item.id === id); return <div key={id}><span><Hash size={14} /><strong>{conversation ? conversationTitle(conversation) : "گفتگو"}</strong></span><button className="icon-button" onClick={() => void detachBot(id)} aria-label="خروج ربات از گفتگو"><X size={15} /></button></div>; })}</div>}
                {availableConversations.length > 0 && selectedBot.active && <form className="attach-form" onSubmit={(event) => void attachBot(event)}><select value={attachConversationId} onChange={(event) => setAttachConversationId(event.target.value)} aria-label="انتخاب گفتگو"><option value="">انتخاب گفتگو…</option>{availableConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversationTitle(conversation)}</option>)}</select><button className="button button-quiet button-small" type="submit" disabled={!attachConversationId}>افزودن</button></form>}</section>

              <section className="studio-card api-card"><div className="studio-card-heading"><div><span className="eyebrow">API v1</span><h3>شروع سریع</h3></div><Code2 size={18} /></div><p>ربات خود را در یک worker مستقل اجرا کن؛ کد کاربر در سرور روان اجرا نمی‌شود.</p><pre dir="ltr"><code>{`GET  /api/v1/bot/me\nGET  /api/v1/bot/updates?offset=0\nPOST /api/v1/bot/messages\n\nAuthorization: Bearer $RAVAN_BOT_TOKEN`}</code></pre><div className="api-card-actions"><button className="button button-quiet button-small" onClick={() => void copyDocs()}><Copy size={14} /> کپی نمونه</button><a href="https://github.com/alinamvarkallan1390-source/-/blob/arena/f6ebce90-repo/docs/bot-api.md" target="_blank" rel="noreferrer">مستندات کامل <ArrowUpRight size={13} /></a></div></section>

              <section className="studio-card event-card"><div className="studio-card-heading"><div><span className="eyebrow">رویدادهای اخیر</span><h3>آخرین ۱۰۰ رویداد</h3></div><span className="live-indicator">POLLING</span></div>{events.length === 0 ? <div className="attached-empty">هنوز رویدادی ثبت نشده است.</div> : <div className="event-list">{events.slice(0, 12).map((event) => <div key={event.updateId}><span className="event-bullet" /><div><strong>{event.type === "message" ? "پیام جدید" : event.type}</strong><small>شناسه {event.updateId} · {formatDate(event.createdAt)}</small></div><span className="event-state">{event.deliveredAt ? "دریافت‌شده" : "در صف"}</span></div>)}</div>}</section>
            </>
          )}
        </div>
      </div>

      {createOpen && <Modal title="ساخت ربات" onClose={() => setCreateOpen(false)}><form className="modal-form" onSubmit={(event) => void createBot(event)}><label className="field-label" htmlFor="bot-name">نام ربات</label><input id="bot-name" className="text-field" value={newName} onChange={(event) => setNewName(event.target.value)} required maxLength={64} placeholder="مثلاً راهنمای تیم" autoFocus /><label className="field-label" htmlFor="bot-username">شناسهٔ یکتا</label><div className="input-prefix"><span>@</span><input id="bot-username" value={newUsername} onChange={(event) => setNewUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} required minLength={3} maxLength={28} placeholder="team_helper" /></div><label className="field-label" htmlFor="bot-description">توضیحات <span className="optional">اختیاری</span></label><textarea id="bot-description" className="text-field textarea-field" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={280} placeholder="ربات چه کاری انجام می‌دهد؟" /><div className="security-hint"><ShieldCheck size={15} /><span>توکن یک‌بار نمایش داده می‌شود و در دیتابیس به‌صورت hash ذخیره خواهد شد.</span></div><button className="button button-primary modal-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <BotIcon size={16} />}{busy ? "در حال ساخت…" : "ساخت ربات و صدور توکن"}</button></form></Modal>}
    </section>
  );
}

function SettingsPanel({ user, onUserUpdated, onLogout, onAccountDeleted, theme, onThemeChange, showToast }: {
  user: AppUser;
  onUserUpdated: (user: AppUser) => void;
  onLogout: () => Promise<void>;
  onAccountDeleted: () => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  showToast: (message: string, kind?: ToastData["kind"]) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [profilePublic, setProfilePublic] = useState(user.profilePublic);
  const [savingProfile, setSavingProfile] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }>>([]);
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNew, setPasswordNew] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshSessions = useCallback(async () => {
    try {
      const result = await apiFetch<{ sessions: typeof sessions }>("/api/auth/sessions");
      setSessions(result.sessions);
    } catch (error) { showToast(errorMessage(error), "error"); }
  }, [showToast]);
  useEffect(() => { void refreshSessions(); }, [refreshSessions]);
  useEffect(() => { setDisplayName(user.displayName); setBio(user.bio); setProfilePublic(user.profilePublic); }, [user]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const result = await apiFetch<{ user: AppUser }>("/api/profile", { method: "PATCH", body: JSON.stringify({ displayName, bio, profilePublic }) });
      onUserUpdated(result.user);
      showToast("پروفایل ذخیره شد.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
    finally { setSavingProfile(false); }
  }

  async function revokeSession(id: string) {
    try {
      await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
      await refreshSessions();
      showToast("نشست بسته شد.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: passwordCurrent, newPassword: passwordNew }) });
      setPasswordCurrent(""); setPasswordNew("");
      await refreshSessions();
      showToast("رمز تغییر کرد و نشست‌های دیگر بسته شدند.", "success");
    } catch (error) { showToast(errorMessage(error), "error"); }
    finally { setBusy(false); }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("این کار بازگشت‌پذیر نیست. حساب و اطلاعات شناسایی‌کننده حذف شوند؟")) return;
    setBusy(true);
    try {
      await apiFetch("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password: deletePassword, confirmation: "DELETE" }) });
      onAccountDeleted();
    } catch (error) { showToast(errorMessage(error), "error"); }
    finally { setBusy(false); }
  }

  return (
    <section className="settings-view">
      <header className="section-header"><div><span className="eyebrow">حریم شخصی و حساب</span><h1>تنظیمات</h1><p>اطلاعات حساب، نشست‌ها و ظاهر روان را مدیریت کن.</p></div><span className="settings-user-tag"><Avatar label={user.displayName} tone={2} size="small" /><span>@{user.username}</span></span></header>
      <div className="settings-grid">
        <section className="settings-card settings-profile"><div className="settings-card-heading"><div><span className="eyebrow">نمایه</span><h2>اطلاعات عمومی</h2></div><UserRound size={19} /></div><form onSubmit={(event) => void saveProfile(event)} className="settings-form"><label className="field-label" htmlFor="profile-name">نام نمایشی</label><input id="profile-name" className="text-field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={64} required /><label className="field-label" htmlFor="profile-bio">معرفی کوتاه</label><textarea id="profile-bio" className="text-field textarea-field" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={280} placeholder="چند کلمه دربارهٔ خودت…" /><div className="toggle-row privacy-row"><span><strong>پروفایل عمومی</strong><small>نام کاربری و معرفی در جست‌وجوی عمومی دیده شود</small></span><label className="switch-label"><input type="checkbox" checked={profilePublic} onChange={(event) => setProfilePublic(event.target.checked)} aria-label="نمایش پروفایل عمومی" /><span className="toggle-ui" /></label></div><button className="button button-primary button-small" disabled={savingProfile}>{savingProfile ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} ذخیرهٔ پروفایل</button></form></section>

        <section className="settings-card"><div className="settings-card-heading"><div><span className="eyebrow">ظاهر</span><h2>حالت نمایش</h2></div>{theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}</div><p className="settings-description">رنگ انتخابی در همین مرورگر نگهداری می‌شود؛ هیچ محتوای گفتگویی روی دستگاه ذخیره نمی‌شود.</p><div className="theme-options"><button className={theme === "dark" ? "theme-option theme-option-active" : "theme-option"} onClick={() => onThemeChange("dark")}><span className="theme-preview preview-dark"><i /><i /><i /></span><span><strong>تیره</strong><small>پیش‌فرض روان</small></span>{theme === "dark" && <Check size={16} />}</button><button className={theme === "light" ? "theme-option theme-option-active" : "theme-option"} onClick={() => onThemeChange("light")}><span className="theme-preview preview-light"><i /><i /><i /></span><span><strong>روشن</strong><small>کنتراست نرم</small></span>{theme === "light" && <Check size={16} />}</button></div></section>

        <section className="settings-card settings-sessions"><div className="settings-card-heading"><div><span className="eyebrow">امنیت حساب</span><h2>نشست‌های فعال</h2></div><ShieldCheck size={19} /></div><p className="settings-description">نشست‌های دیگر را در هر زمان از حساب خارج کن.</p>{sessions.length === 0 ? <div className="settings-empty">فهرست نشست‌ها در دسترس نیست.</div> : <div className="session-list">{sessions.map((session) => <div className="session-row" key={session.id}><span className="session-device"><Activity size={16} /></span><div className="session-copy"><strong>{session.current ? "این دستگاه" : session.userAgent.slice(0, 80) || "مرورگر دیگر"}</strong><small>آخرین فعالیت {formatDate(session.lastSeenAt)} · انقضا {formatDate(session.expiresAt)}</small></div>{session.current ? <span className="current-session">فعلی</span> : <button className="icon-button" onClick={() => void revokeSession(session.id)} aria-label="بستن نشست"><X size={15} /></button>}</div>)}</div>}</section>

        <section className="settings-card"><div className="settings-card-heading"><div><span className="eyebrow">رمز عبور</span><h2>تغییر رمز</h2></div><KeyRound size={18} /></div><form onSubmit={(event) => void changePassword(event)} className="settings-form compact-form"><label className="field-label" htmlFor="password-current">رمز فعلی</label><input id="password-current" className="text-field" type="password" autoComplete="current-password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} required /><label className="field-label" htmlFor="password-next">رمز تازه <span className="optional">حداقل ۱۲ نویسه</span></label><input id="password-next" className="text-field" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={passwordNew} onChange={(event) => setPasswordNew(event.target.value)} required /><button className="button button-quiet button-small" disabled={busy}>به‌روزرسانی رمز</button></form></section>

        <section className="settings-card danger-card"><div className="settings-card-heading"><div><span className="eyebrow">منطقهٔ حساس</span><h2>حذف حساب</h2></div><Trash2 size={18} /></div><p className="settings-description">جلسه‌ها، پروفایل، ربات‌ها و عضویت‌ها حذف می‌شوند. پیام‌های باقی‌مانده در گفتگوهای دیگران به «کاربر حذف‌شده» ناشناس می‌شوند.</p><form onSubmit={(event) => void deleteAccount(event)} className="settings-form compact-form"><label className="field-label" htmlFor="delete-password">برای تأیید، رمز عبور را وارد کن</label><input id="delete-password" className="text-field" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required /><button className="button button-danger button-small" disabled={busy}>حذف دائمی حساب</button></form></section>

        <section className="settings-card signout-card"><div className="settings-card-heading"><div><span className="eyebrow">پایان نشست</span><h2>خروج از روان</h2></div><LogOut size={18} /></div><p className="settings-description">نشست فعلی باطل می‌شود و کوکی امن پاک خواهد شد.</p><button className="button button-quiet button-small" onClick={() => void onLogout()}><LogOut size={14} /> خروج از حساب</button></section>
      </div>
      <div className="settings-footer"><span>حساب: <b>{user.username}</b></span><span>شناسهٔ پایدار: <code>{user.id.slice(0, 8)}…</code></span><span>عضویت از {formatDate(user.createdAt)}</span></div>
    </section>
  );
}

function AdminPanel({ showToast }: { showToast: (message: string, kind?: ToastData["kind"]) => void }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch<{ stats: Record<string, number> }>("/api/admin/overview")
      .then((result) => setStats(result.stats))
      .catch((error) => showToast(errorMessage(error), "error"))
      .finally(() => setLoading(false));
  }, [showToast]);
  return (
    <section className="admin-view"><header className="section-header"><div><span className="eyebrow">عملیات محدودشده</span><h1>نمای کلی مدیریت</h1><p>فقط آمار تجمیعی؛ پیام خصوصی کاربران در این بخش نمایش داده نمی‌شود.</p></div><span className="admin-badge"><ShieldCheck size={15} /> نقش مدیر</span></header>{loading ? <div className="admin-skeleton"><i /><i /><i /></div> : stats ? <div className="admin-stats">{[["کاربران فعال", stats.users], ["عضوهای تازه · ۲۴ ساعت", stats.new_users_24h], ["گفتگوها", stats.conversations], ["پیام‌ها · ۲۴ ساعت", stats.messages_24h], ["ربات‌ها", stats.bots], ["گزارش‌های باز", stats.open_reports]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString("fa-IR")}</strong></div>)}</div> : <div className="empty-state-card">آمار مدیریت در دسترس نیست.</div>}<div className="admin-privacy-note"><ShieldCheck size={17} /><p>Audit log و نقش‌های مدیریتی در PostgreSQL بررسی می‌شوند؛ دسترسی به محتوای خصوصی کاربران از طریق این پنل ارائه نمی‌شود.</p></div></section>
  );
}

function DetailsPanel({ conversation, onClose, onRemoveMember, onMakeInvite, showToast }: {
  conversation: Conversation;
  onClose: () => void;
  onRemoveMember: (username: string) => Promise<void>;
  onMakeInvite: () => Promise<void>;
  showToast: (message: string, kind?: ToastData["kind"]) => void;
}) {
  const [members, setMembers] = useState<Array<{ id: string; username: string; displayName: string; role: string; joinedAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  useEffect(() => {
    apiFetch<{ members: typeof members }>(`/api/conversations/${conversation.id}/members`)
      .then((result) => setMembers(result.members))
      .catch((error) => showToast(errorMessage(error), "error"));
  }, [conversation.id, showToast]);
  const canManage = conversation.role === "owner" || conversation.role === "admin";
  async function createInvite() {
    setBusy(true);
    try {
      const result = await apiFetch<{ inviteToken: string }>(`/api/conversations/${conversation.id}/invites`, { method: "POST", body: JSON.stringify({ expiresInHours: 72, maxUses: 1 }) });
      setInviteToken(result.inviteToken);
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${result.inviteToken}`);
      showToast("لینک دعوت یک‌بارمصرف ساخته و کپی شد.", "success");
      await onMakeInvite();
    } catch (error) { showToast(errorMessage(error), "error"); }
    finally { setBusy(false); }
  }
  return (
    <aside className="details-panel"><header><div><span className="eyebrow">اطلاعات گفتگو</span><h3>{conversationTitle(conversation)}</h3></div><button className="icon-button" onClick={onClose} aria-label="بستن پنل"><X size={17} /></button></header><div className="details-hero"><Avatar label={conversationTitle(conversation)} tone={2} size="large" /><strong>{conversationTitle(conversation)}</strong><span>{conversation.type === "direct" ? `@${conversation.peer?.username ?? ""}` : conversation.type === "channel" ? "کانال" : "گروه خصوصی"}</span></div>{conversation.type !== "direct" && <div className="details-actions">{canManage && <button className="button button-quiet button-small" onClick={() => void createInvite()} disabled={busy}><Plus size={14} /> لینک دعوت</button>}{inviteToken && <code dir="ltr" className="invite-token">{window.location.origin}/invite/{inviteToken}</code>}</div>}<div className="details-member-heading"><strong>اعضا</strong><span>{members.length.toLocaleString("fa-IR")}</span></div><div className="details-members">{members.map((member, index) => <div className="member-row" key={member.id}><Avatar label={member.displayName} size="small" tone={index} /><span><strong>{member.displayName}</strong><small>@{member.username}</small></span><em>{member.role === "owner" ? "مالک" : member.role === "admin" ? "مدیر" : "عضو"}</em>{canManage && member.role !== "owner" && <button className="icon-button danger-icon" title="حذف عضو" onClick={async () => { await onRemoveMember(member.username); setMembers((previous) => previous.filter((item) => item.id !== member.id)); }}><X size={14} /></button>}</div>)}</div><div className="details-privacy"><LockMark /><span>فهرست اعضا فقط برای اعضای گفتگو قابل مشاهده است.</span></div></aside>
  );
}

function AppShell({ user: initialUser, onUserUpdate, onLogout, onAccountDeleted, theme, onThemeChange, showToast }: {
  user: AppUser;
  onUserUpdate: (user: AppUser) => void;
  onLogout: () => Promise<void>;
  onAccountDeleted: () => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  showToast: (message: string, kind?: ToastData["kind"]) => void;
}) {
  const [user, setUser] = useState(initialUser);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("chats");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [jumpRequest, setJumpRequest] = useState<JumpRequest>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => { setUser(initialUser); }, [initialUser]);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await apiFetch<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(result.conversations);
      setSelectedId((current) => current && result.conversations.some((conversation) => conversation.id === current) ? current : current && mobileChatOpen ? current : null);
      setLoadingConversations(false);
    } catch (error) {
      setLoadingConversations(false);
      if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) await onLogout();
      else showToast(errorMessage(error), "error");
    }
  }, [mobileChatOpen, onLogout, showToast]);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);

  useEffect(() => {
    function onShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchScope(null);
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNewConversationOpen(false);
        setDetailsOpen(false);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const availableTabs: Array<{ id: TabId; title: string; icon: ReactNode }> = [
    { id: "chats", title: "گفتگوها", icon: <MessageCircle size={18} /> },
    { id: "bots", title: "ربات‌ها", icon: <BotIcon size={18} /> },
    { id: "settings", title: "تنظیمات", icon: <Settings2 size={18} /> },
    ...(user.role === "admin" || user.role === "moderator" ? [{ id: "admin" as const, title: "مدیریت", icon: <ShieldCheck size={18} /> }] : []),
  ];

  async function createConversation(payload: Record<string, unknown>) {
    const result = await apiFetch<{ conversationId: string }>("/api/conversations", { method: "POST", body: JSON.stringify(payload) });
    await refreshConversations();
    setSelectedId(result.conversationId);
    setTab("chats");
    setMobileChatOpen(true);
    setDetailsOpen(false);
    showToast("گفتگو ساخته شد.", "success");
  }

  async function joinConversation(id: string) {
    await apiFetch("/api/conversations/join", { method: "POST", body: JSON.stringify({ conversationId: id }) });
    await refreshConversations();
    setSelectedId(id);
    setTab("chats");
    setMobileChatOpen(true);
    setSearchOpen(false);
    showToast("به گفتگوی عمومی پیوستی.", "success");
  }

  function selectMessage(result: SearchData["messages"][number]) {
    setTab("chats");
    setSelectedId(result.conversationId);
    setMobileChatOpen(true);
    setJumpRequest({ messageId: result.id, nonce: Date.now() });
    setSearchOpen(false);
    setSearchScope(null);
  }

  const selectedTab = availableTabs.find((item) => item.id === tab) ?? availableTabs[0];
  const activeTitle = tab === "chats" ? "گفتگوها" : tab === "bots" ? "استودیوی ربات" : tab === "settings" ? "تنظیمات" : "مدیریت";

  return (
    <main className={`workspace workspace-tab-${tab}${mobileChatOpen ? " mobile-chat-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <header className="sidebar-brand"><div className="brand-lockup"><BrandMark /><span><strong>روان</strong><small>RAVAN MESSENGER</small></span></div><button className="icon-button collapse-sidebar" onClick={() => setSidebarCollapsed(true)} aria-label="جمع‌کردن نوار کناری"><ChevronRight size={18} /></button></header>
        <button className="global-search-button" onClick={() => { setSearchScope(null); setSearchOpen(true); }}><Search size={17} /><span>جست‌وجوی سراسری</span><kbd>⌘ K</kbd></button>
        <nav className="sidebar-nav" aria-label="بخش‌های اصلی">{availableTabs.map((item) => <button key={item.id} className={tab === item.id ? "sidebar-nav-active" : ""} onClick={() => { setTab(item.id); setMobileChatOpen(false); setDetailsOpen(false); setJumpRequest(null); }} aria-current={tab === item.id ? "page" : undefined}>{item.icon}<span>{item.title}</span>{item.id === "chats" && conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0) > 0 && <i className="nav-unread-dot" />}</button>)}</nav>
        {tab === "chats" ? <div className="conversation-sidebar-section"><div className="conversation-section-heading"><div><span className="eyebrow">فضاهای تو</span><strong>گفتگوها</strong></div><button className="round-add-button" onClick={() => setNewConversationOpen(true)} aria-label="گفتگوی تازه"><Plus size={17} /></button></div><div className="conversation-list" role="list">
          {loadingConversations ? <div className="conversation-skeletons">{[0, 1, 2, 3, 4].map((item) => <div key={item}><i /><span><b /><small /></span></div>)}</div> : conversations.length === 0 ? <div className="sidebar-empty"><span className="sidebar-empty-icon"><MessageCircle size={18} /></span><strong>هنوز گفتگویی نیست</strong><p>با یک گفتگوی تازه شروع کن؛ فهرست فقط دادهٔ واقعی را نشان می‌دهد.</p><button onClick={() => setNewConversationOpen(true)}>شروع گفتگو <ArrowLeft size={14} /></button></div> : conversations.map((conversation, index) => <ConversationItem key={conversation.id} conversation={conversation} index={index} selected={selectedId === conversation.id} onSelect={() => { setSelectedId(conversation.id); setTab("chats"); setMobileChatOpen(true); setDetailsOpen(false); setJumpRequest(null); }} />)}
        </div></div> : <div className="sidebar-context"><span className="eyebrow">{selectedTab.title}</span><h3>{activeTitle}</h3><p>{tab === "bots" ? "ربات‌ها و کلیدهای API تو" : tab === "settings" ? "حساب، نشست‌ها و حریم خصوصی" : "آمار تجمیعی و امن"}</p><span className="context-rule" /></div>}
        <footer className="user-sidebar-footer"><button className="user-profile-button" onClick={() => setTab("settings")}><Avatar label={user.displayName} tone={2} /><span><strong>{user.displayName}</strong><small>@{user.username}</small></span><ChevronDown size={14} /></button><div className="sidebar-bottom-meta"><span><i /> اتصال امن</span><button onClick={() => void onLogout()} title="خروج" aria-label="خروج از حساب"><LogOut size={15} /></button></div></footer>
      </aside>
      {sidebarCollapsed && <button className="sidebar-reopen" onClick={() => setSidebarCollapsed(false)} aria-label="بازکردن نوار کناری"><ChevronLeft size={18} /></button>}

      <section className="main-content" aria-label={activeTitle}>
        {tab === "chats" && selectedConversation ? <ChatPanel key={selectedConversation.id} conversation={selectedConversation} user={user} onBack={() => { setMobileChatOpen(false); setSelectedId(null); setJumpRequest(null); }} onSearch={() => { setSearchScope(selectedConversation.id); setSearchOpen(true); }} onDetails={() => setDetailsOpen(true)} jumpRequest={jumpRequest} onChanged={() => { void refreshConversations(); }} showToast={showToast} /> : null}
        {tab === "chats" && !selectedConversation ? <EmptyChat onNewConversation={() => setNewConversationOpen(true)} onSearch={() => { setSearchScope(null); setSearchOpen(true); }} /> : null}
        {tab === "bots" && <BotStudio conversations={conversations} showToast={showToast} />}
        {tab === "settings" && <SettingsPanel user={user} onUserUpdated={(updated) => { setUser(updated); onUserUpdate(updated); }} onLogout={onLogout} onAccountDeleted={onAccountDeleted} theme={theme} onThemeChange={onThemeChange} showToast={showToast} />}
        {tab === "admin" && (user.role === "admin" || user.role === "moderator") && <AdminPanel showToast={showToast} />}
      </section>

      {detailsOpen && selectedConversation && <DetailsPanel conversation={selectedConversation} onClose={() => setDetailsOpen(false)} onRemoveMember={async (username) => { await apiFetch(`/api/conversations/${selectedConversation.id}/members/${username}`, { method: "DELETE" }); await refreshConversations(); showToast("عضو حذف شد.", "success"); }} onMakeInvite={async () => { await refreshConversations(); }} showToast={showToast} />}
      {newConversationOpen && <CreateConversationDialog onClose={() => setNewConversationOpen(false)} onCreate={createConversation} />}
      {searchOpen && <SearchPalette onClose={() => { setSearchOpen(false); setSearchScope(null); }} conversations={conversations} scopeId={searchScope} history={searchHistory} onHistory={(item) => { if (item.query === "__clear__") setSearchHistory([]); else setSearchHistory((previous) => [{ query: item.query, scopeId: item.scopeId }, ...previous.filter((entry) => entry.query !== item.query)].slice(0, 8)); }} onOpenMessage={selectMessage} onOpenPerson={async (username) => { try { const result = await apiFetch<{ conversationId: string }>("/api/conversations", { method: "POST", body: JSON.stringify({ type: "direct", username }) }); await refreshConversations(); setSelectedId(result.conversationId); setTab("chats"); setMobileChatOpen(true); setSearchOpen(false); } catch (error) { showToast(errorMessage(error), "error"); } }} onJoinConversation={joinConversation} onOpenConversation={(id) => { setSelectedId(id); setTab("chats"); setMobileChatOpen(true); setSearchOpen(false); }} />}
      <button className="mobile-search-fab" onClick={() => { setSearchScope(null); setSearchOpen(true); }} aria-label="جست‌وجو"><Search size={19} /></button>
    </main>
  );
}

export default function RavanApp() {
  const [health, setHealth] = useState<Health | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { toast, showToast, dismissToast } = useToast();

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const status = await response.json() as Health;
        if (!active) return;
        setHealth(status);
        if (status.database === "connected") {
          try {
            const session = await apiFetch<{ user: AppUser | null }>("/api/auth/session");
            if (active) setUser(session.user);
          } catch {
            if (active) setHealth({ ...status, database: "unreachable", status: "degraded" });
          }
        }
      } catch {
        if (active) setHealth({ status: "degraded", database: "unreachable", email: false });
      } finally {
        if (active) setBooting(false);
      }
    }
    void boot();
    try {
      const savedTheme = localStorage.getItem("ravan-theme");
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    } catch { /* Browser storage can be disabled; dark remains the default. */ }
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ravan-theme", theme); } catch { /* Theme preference is optional. */ }
  }, [theme]);

  const logout = useCallback(async () => {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); }
    catch { /* Clear the local session view even when the server is temporarily unavailable. */ }
    setUser(null);
    setHealth((current) => current ?? { status: "degraded", database: "unreachable", email: false });
  }, []);

  if (booting) return <LoadingScreen />;
  if (!user) return <><AuthScreen health={health} onAuthenticated={(nextUser) => setUser(nextUser)} /><Toast toast={toast} onClose={dismissToast} /></>;
  return <><AppShell user={user} onUserUpdate={setUser} onLogout={logout} onAccountDeleted={() => { setUser(null); showToast("حساب ناشناس و حذف شد.", "success"); }} theme={theme} onThemeChange={setTheme} showToast={showToast} /><Toast toast={toast} onClose={dismissToast} /></>;
}
