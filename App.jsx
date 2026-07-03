import { useState, useEffect, useRef, useCallback } from "react";

const hashPassword = async (pw) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};
const uid = () => Math.random().toString(36).slice(2, 10);
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cnicRx = /^\d{5}-\d{7}-\d{1}$/;
const fmt$ = (n) => "$" + Number(n || 0).toLocaleString();
const fmtDate = (d) => new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (d) => new Date(d).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

const KEYS = {
  users: "csms_users", session: "csms_session", cars: "csms_cars",
  sales: "csms_sales", resets: "csms_resets", bookings: "csms_bookings",
  employees: "csms_employees", logs: "csms_logs",
};

// ── GOOGLE SHEET BACKEND ─────────────────────────────────────────────────
// Paste your deployed Apps Script Web App URL here.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE53TBTf-T_pMkPAqPnjT74zVE7AoA_W4ipkxyZ_qkTCTGRYnjgb-aq3INJKR6kwBX/exec";

// Maps each internal storage key to its Sheet tab name. Every entity here is
// synced to the Sheet as individual rows (append/update/delete per item) so
// the Sheet stays human-readable. Keys NOT listed here (session, resets)
// are kept in the browser only — they're ephemeral/sensitive and shouldn't
// live in a shared spreadsheet.
const SHEET_ENTITY = {
  [KEYS.users]: "users",
  [KEYS.cars]: "cars",
  [KEYS.sales]: "sales",
  [KEYS.bookings]: "bookings",
  [KEYS.employees]: "employees",
  [KEYS.logs]: "logs",
};
const LOCAL_ONLY_KEYS = [KEYS.session, KEYS.resets];

// In-memory cache, populated once from the Sheet on app boot.
// load()/save() stay synchronous everywhere else in the app; save() diffs
// the old vs new list and pushes only the changed rows to the Sheet.
let CACHE = {};
let CACHE_READY = false;

const load = (k, fb = null) => {
  if (LOCAL_ONLY_KEYS.includes(k)) {
    try {
      const raw = localStorage.getItem(k);
      return raw != null ? JSON.parse(raw) : fb;
    } catch { return fb; }
  }
  return CACHE.hasOwnProperty(k) && CACHE[k] != null ? CACHE[k] : fb;
};

function sheetPost(body) {
  fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight
    body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(res => { if (!res.success) console.error("Sheet write rejected:", body, res); })
    .catch(err => console.error("Sheet write failed:", body, err));
}

const save = (k, v) => {
  if (LOCAL_ONLY_KEYS.includes(k)) {
    CACHE[k] = v;
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (err) { console.error("Local save failed for", k, err); }
    return;
  }

  const sheetName = SHEET_ENTITY[k];
  const prevList = Array.isArray(CACHE[k]) ? CACHE[k] : [];
  CACHE[k] = v;

  if (!sheetName || !Array.isArray(v)) return; // unknown/non-list key, nothing to sync

  const prevById = new Map(prevList.map(item => [item.id, item]));
  const nextIds = new Set();

  v.forEach(item => {
    if (!item || !item.id) return;
    nextIds.add(item.id);
    const prevItem = prevById.get(item.id);
    if (!prevItem) {
      sheetPost({ sheetName, action: "append", data: item });
    } else if (JSON.stringify(prevItem) !== JSON.stringify(item)) {
      sheetPost({ sheetName, action: "update", id: item.id, data: item });
    }
  });

  prevList.forEach(item => {
    if (item && item.id && !nextIds.has(item.id)) {
      sheetPost({ sheetName, action: "delete", id: item.id });
    }
  });
};

async function bootstrapCache() {
  CACHE = {};
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=getAll`);
    const data = await res.json();
    Object.entries(SHEET_ENTITY).forEach(([internalKey, sheetName]) => {
      CACHE[internalKey] = (data && Array.isArray(data[sheetName])) ? data[sheetName] : [];
    });
  } catch (err) {
    console.error("Failed to load data from Sheet, starting empty.", err);
    Object.keys(SHEET_ENTITY).forEach(internalKey => { CACHE[internalKey] = []; });
  }
  CACHE_READY = true;
}

const logActivity = (userId, userName, action, detail = "") => {
  const logs = load(KEYS.logs, []);
  logs.unshift({ id: uid(), userId, userName, action, detail, at: Date.now() });
  save(KEYS.logs, logs.slice(0, 500));
};

const SEED_CARS = [
  { id: "c1", make: "Toyota", model: "Camry", year: 2023, price: 28500, color: "Pearl White", mileage: 0, fuel: "Petrol", transmission: "Automatic", status: "Available", addedAt: Date.now() },
  { id: "c2", make: "Honda", model: "Civic", year: 2022, price: 24200, color: "Sonic Gray", mileage: 12000, fuel: "Petrol", transmission: "Automatic", status: "Available", addedAt: Date.now() },
  { id: "c3", make: "BMW", model: "3 Series", year: 2024, price: 44900, color: "Mineral White", mileage: 0, fuel: "Petrol", transmission: "Automatic", status: "Available", addedAt: Date.now() },
  { id: "c4", make: "Mercedes", model: "C-Class", year: 2023, price: 47500, color: "Obsidian Black", mileage: 800, fuel: "Petrol", transmission: "Automatic", status: "Available", addedAt: Date.now() },
  { id: "c5", make: "Tesla", model: "Model 3", year: 2024, price: 39990, color: "Midnight Silver", mileage: 0, fuel: "Electric", transmission: "Automatic", status: "Available", addedAt: Date.now() },
  { id: "c6", make: "Suzuki", model: "Alto", year: 2023, price: 9500, color: "Red", mileage: 5000, fuel: "Petrol", transmission: "Manual", status: "Available", addedAt: Date.now() },
  { id: "c7", make: "Kia", model: "Sportage", year: 2024, price: 32000, color: "Blue", mileage: 0, fuel: "Petrol", transmission: "Automatic", status: "Available", addedAt: Date.now() },
  { id: "c8", make: "Hyundai", model: "Tucson", year: 2023, price: 35000, color: "Silver", mileage: 3000, fuel: "Petrol", transmission: "Automatic", status: "Available", addedAt: Date.now() },
];

const SEED_EMPLOYEES = [
  { id: "e1", name: "Ali Hassan", role: "Sales Manager", phone: "+92 301 1111111", email: "ali@apex.com", salary: 85000, joinDate: "2022-01-15", status: "Active" },
  { id: "e2", name: "Sara Khan", role: "Sales Executive", phone: "+92 302 2222222", email: "sara@apex.com", salary: 60000, joinDate: "2022-06-01", status: "Active" },
  { id: "e3", name: "Bilal Ahmed", role: "Finance Officer", phone: "+92 303 3333333", email: "bilal@apex.com", salary: 70000, joinDate: "2023-03-10", status: "Active" },
];

const T = {
  bg: "#0A0C10", surface: "#111318", card: "#161B22", border: "#21262D",
  accent: "#E8A020", accentDim: "#C4881A", accentGlow: "rgba(232,160,32,0.15)",
  text: "#E6EDF3", muted: "#7D8590", danger: "#F85149", success: "#3FB950",
  info: "#58A6FF", purple: "#A371F7", warning: "#D29922",
};

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Bebas+Neue&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body,#root{height:100%}
  body{background:${T.bg};color:${T.text};font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
  input,textarea,select{font-family:inherit;font-size:14px}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${T.surface}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
  .fade-in{animation:fadeIn .22s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  @keyframes spin{to{transform:rotate(360deg)}}
`;

function InjectCSS() {
  useEffect(() => {
    const el = document.createElement("style"); el.textContent = GLOBAL_CSS;
    document.head.appendChild(el); return () => el.remove();
  }, []);
  return null;
}

// ── SHARED UI ──────────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = "primary", size = "md", disabled, style, type = "button" }) {
  const sizes = { sm: { padding: "5px 11px", fontSize: "12px" }, md: { padding: "9px 17px", fontSize: "14px" }, lg: { padding: "12px 26px", fontSize: "15px" } };
  const variants = {
    primary: { background: T.accent, color: "#0A0C10" },
    ghost: { background: "transparent", color: T.text, border: `1px solid ${T.border}` },
    danger: { background: T.danger, color: "#fff" },
    success: { background: T.success, color: "#0A0C10" },
    warning: { background: T.warning, color: "#0A0C10" },
    info: { background: T.info, color: "#0A0C10" },
    subtle: { background: T.surface, color: T.text, border: `1px solid ${T.border}` },
    purple: { background: T.purple, color: "#fff" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", gap: "5px", border: "none",
      borderRadius: "7px", cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600,
      transition: "all .15s", fontFamily: "inherit", opacity: disabled ? 0.5 : 1,
      ...sizes[size], ...variants[variant], ...style
    }}>{children}</button>
  );
}

function Input({ label, error, leftIcon, rightSlot, ...props }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      {label && <label style={{ fontSize: "12px", fontWeight: 500, color: T.muted }}>{label}</label>}
      <div style={{ position: "relative" }}>
        {leftIcon && <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: T.muted, fontSize: "15px", pointerEvents: "none" }}>{leftIcon}</span>}
        <input {...props} style={{
          width: "100%", background: T.surface, border: `1px solid ${error ? T.danger : T.border}`,
          borderRadius: "7px", padding: leftIcon ? "10px 12px 10px 36px" : "10px 12px",
          color: T.text, outline: "none", transition: "border .15s",
          paddingRight: rightSlot ? "42px" : undefined, ...props.style
        }}
          onFocus={e => e.target.style.borderColor = T.accent}
          onBlur={e => e.target.style.borderColor = error ? T.danger : T.border} />
        {rightSlot && <span style={{ position: "absolute", right: "11px", top: "50%", transform: "translateY(-50%)" }}>{rightSlot}</span>}
      </div>
      {error && <span style={{ fontSize: "11px", color: T.danger }}>{error}</span>}
    </div>
  );
}

function Sel({ label, error, children, ...props }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      {label && <label style={{ fontSize: "12px", fontWeight: 500, color: T.muted }}>{label}</label>}
      <select {...props} style={{
        width: "100%", background: T.surface, border: `1px solid ${error ? T.danger : T.border}`,
        borderRadius: "7px", padding: "10px 12px", color: T.text, outline: "none",
        appearance: "none", ...props.style
      }}>{children}</select>
      {error && <span style={{ fontSize: "11px", color: T.danger }}>{error}</span>}
    </div>
  );
}

function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "11px", padding: "18px", cursor: onClick ? "pointer" : undefined, transition: onClick ? "border-color .15s" : undefined, ...style }}
    onMouseEnter={onClick ? e => e.currentTarget.style.borderColor = T.accent : undefined}
    onMouseLeave={onClick ? e => e.currentTarget.style.borderColor = T.border : undefined}
  >{children}</div>;
}

function Badge({ children, color = T.accent, size = "sm" }) {
  return <span style={{ background: color + "22", color, borderRadius: "5px", padding: size === "sm" ? "2px 7px" : "4px 10px", fontSize: size === "sm" ? "11px" : "13px", fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
}

function Spinner({ size = 18 }) {
  return <div style={{ width: size, height: size, border: `2px solid ${T.border}`, borderTopColor: T.accent, borderRadius: "50%", animation: "spin .7s linear infinite", flexShrink: 0 }} />;
}

function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, []);
  const c = { success: T.success, error: T.danger, info: T.info, warning: T.warning }[type] || T.success;
  return (
    <div className="fade-in" style={{ position: "fixed", bottom: 22, right: 22, zIndex: 9999, background: T.card, border: `1px solid ${c}`, borderRadius: "10px", padding: "13px 17px", maxWidth: 340, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 32px rgba(0,0,0,.6)" }}>
      <span style={{ fontSize: 16 }}>{type === "success" ? "✓" : type === "error" ? "✕" : type === "warning" ? "⚠" : "ℹ"}</span>
      <span style={{ flex: 1, fontSize: 13 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
    </div>
  );
}

function Modal({ title, children, onClose, width = "500px" }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fade-in" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "13px", width: "100%", maxWidth: width, maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "22px" }}>{children}</div>
      </div>
    </div>
  );
}

function Confirm({ message, onYes, onNo, yesVariant = "danger", yesLabel = "Confirm" }) {
  return (
    <Modal title="Are you sure?" onClose={onNo} width="360px">
      <p style={{ color: T.muted, marginBottom: 20, lineHeight: 1.7 }}>{message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn onClick={onNo} variant="ghost">Cancel</Btn>
        <Btn onClick={onYes} variant={yesVariant}>{yesLabel}</Btn>
      </div>
    </Modal>
  );
}

function Table({ cols, rows, empty = "No records found." }) {
  return (
    <div style={{ overflowX: "auto" }}>
      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: T.muted }}>{empty}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
          <thead>
            <tr style={{ background: T.surface }}>
              {cols.map(c => <th key={c.key} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id || i} style={{ borderTop: `1px solid ${T.border}` }}>
                {cols.map(c => <td key={c.key} style={{ padding: "11px 14px", fontSize: 13, verticalAlign: "middle" }}>{c.render ? c.render(row) : row[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
      <div><h1 style={{ fontSize: 22, fontWeight: 700 }}>{title}</h1>{subtitle && <p style={{ color: T.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</p>}</div>
      {action}
    </div>
  );
}

function StatCard({ icon, label, value, color = T.accent, sub }) {
  return (
    <Card style={{ padding: "18px" }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

// ── AUTH ──────────────────────────────────────────────────────────────────
function AuthLayout({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: `radial-gradient(ellipse at 20% 50%, ${T.accentGlow} 0%, transparent 60%), ${T.bg}` }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 44, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 3, color: T.accent, lineHeight: 1 }}>APEX</div>
          <div style={{ fontSize: 11, letterSpacing: 4, color: T.muted, marginTop: 4, textTransform: "uppercase" }}>Car Showroom Management</div>
        </div>
        <Card style={{ padding: 30 }}>{children}</Card>
      </div>
    </div>
  );
}

function LoginPage({ onLogin, onGoSignup, onGoForgot, toast }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false); const [errs, setErrs] = useState({});
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const e = {};
    if (!email) e.email = "Required"; else if (!emailRx.test(email)) e.email = "Invalid email";
    if (!pw) e.pw = "Required"; setErrs(e);
    if (Object.keys(e).length) return;
    setLoading(true); await new Promise(r => setTimeout(r, 500));
    const users = load(KEYS.users, []); const hashed = await hashPassword(pw);
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === hashed);
    if (!user) { setErrs({ general: "Incorrect email or password" }); setLoading(false); return; }
    save(KEYS.session, { userId: user.id, expiresAt: Date.now() + 7 * 86400000 });
    logActivity(user.id, user.fullName, "LOGIN", "Signed in");
    toast("Welcome back, " + user.fullName.split(" ")[0] + "!", "success");
    onLogin(user); setLoading(false);
  };

  return (
    <>
      <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 5 }}>Sign in</h2>
      <p style={{ color: T.muted, marginBottom: 22, fontSize: 13 }}>Access your showroom dashboard</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {errs.general && <div style={{ background: T.danger + "20", border: `1px solid ${T.danger}`, borderRadius: 7, padding: "9px 13px", color: T.danger, fontSize: 13 }}>{errs.general}</div>}
        <Input label="Email Address" type="email" value={email} onChange={e => setEmail(e.target.value)} error={errs.email} onKeyDown={e => e.key === "Enter" && submit()} />
        <Input label="Password" type={showPw ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)} error={errs.pw}
          rightSlot={<button onClick={() => setShowPw(!showPw)} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 15 }}>{showPw ? "Hide" : "Show"}</button>}
          onKeyDown={e => e.key === "Enter" && submit()} />
        <div style={{ textAlign: "right" }}><button onClick={onGoForgot} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 12 }}>Forgot password?</button></div>
        <Btn onClick={submit} disabled={loading} size="lg" style={{ width: "100%", justifyContent: "center" }}>{loading ? <><Spinner />Signing in…</> : "Sign In"}</Btn>
        <p style={{ textAlign: "center", color: T.muted, fontSize: 12 }}>No account? <button onClick={onGoSignup} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontWeight: 600 }}>Sign up</button></p>
      </div>
    </>
  );
}

function SignupPage({ onLogin, onGoLogin, toast }) {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "", phone: "", cnic: "", address: "" });
  const [avatar, setAvatar] = useState(null); const [showPw, setShowPw] = useState(false);
  const [errs, setErrs] = useState({}); const [loading, setLoading] = useState(false);
  const fileRef = useRef();
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    const e = {};
    if (!form.fullName.trim()) e.fullName = "Required";
    if (!emailRx.test(form.email)) e.email = "Invalid email";
    if (form.password.length < 8) e.pw = "Min 8 characters";
    if (form.password !== form.confirm) e.confirm = "Passwords don't match";
    if (!/^\+?[\d\s\-]{7,15}$/.test(form.phone)) e.phone = "Invalid phone";
    if (form.cnic && !cnicRx.test(form.cnic)) e.cnic = "Format: 12345-1234567-1";
    if (!form.address.trim()) e.address = "Required";
    setErrs(e); if (Object.keys(e).length) return;
    setLoading(true); await new Promise(r => setTimeout(r, 600));
    const users = load(KEYS.users, []);
    if (users.find(u => u.email.toLowerCase() === form.email.toLowerCase())) { setErrs({ email: "Already registered" }); setLoading(false); return; }
    const hashed = await hashPassword(form.password);
    const newUser = { id: uid(), fullName: form.fullName.trim(), email: form.email.toLowerCase(), password: hashed, phone: form.phone.trim(), cnic: form.cnic.trim(), address: form.address.trim(), avatar, role: "user", createdAt: Date.now() };
    save(KEYS.users, [...users, newUser]);
    save(KEYS.session, { userId: newUser.id, expiresAt: Date.now() + 7 * 86400000 });
    logActivity(newUser.id, newUser.fullName, "SIGNUP", "New account created");
    toast("Account created! Welcome, " + newUser.fullName.split(" ")[0] + "!", "success");
    onLogin(newUser); setLoading(false);
  };

  const handleAvatar = e => { const f2 = e.target.files[0]; if (!f2) return; const r = new FileReader(); r.onload = () => setAvatar(r.result); r.readAsDataURL(f2); };

  return (
    <div style={{ maxHeight: "78vh", overflowY: "auto" }}>
      <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 5 }}>Create Account</h2>
      <p style={{ color: T.muted, marginBottom: 20, fontSize: 13 }}>Join as a Public User to browse & book cars</p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div onClick={() => fileRef.current.click()} style={{ width: 60, height: 60, borderRadius: "50%", background: T.surface, border: `2px dashed ${T.border}`, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {avatar ? <img src={avatar} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: T.muted }}>Add</span>}
        </div>
        <div><button onClick={() => fileRef.current.click()} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", color: T.text, cursor: "pointer", fontSize: 12 }}>Upload Photo</button><p style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>Optional</p></div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatar} style={{ display: "none" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Input label="Full Name *" value={form.fullName} onChange={f("fullName")} error={errs.fullName} />
        <Input label="Email *" type="email" value={form.email} onChange={f("email")} error={errs.email} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Password *" type={showPw ? "text" : "password"} value={form.password} onChange={f("password")} error={errs.pw}
            rightSlot={<button onClick={() => setShowPw(!showPw)} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 13 }}>{showPw ? "Hide" : "Show"}</button>} />
          <Input label="Confirm *" type="password" value={form.confirm} onChange={f("confirm")} error={errs.confirm} />
        </div>
        <Input label="Phone *" type="tel" value={form.phone} onChange={f("phone")} error={errs.phone} />
        <Input label="CNIC (optional)" value={form.cnic} onChange={f("cnic")} error={errs.cnic} />
        <Input label="Address *" value={form.address} onChange={f("address")} error={errs.address} />
        <Btn onClick={submit} disabled={loading} size="lg" style={{ width: "100%", justifyContent: "center" }}>{loading ? <><Spinner />Creating…</> : "Create Account"}</Btn>
        <p style={{ textAlign: "center", color: T.muted, fontSize: 12 }}>Already have one? <button onClick={onGoLogin} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontWeight: 600 }}>Sign in</button></p>
      </div>
    </div>
  );
}

function ForgotPage({ onGoLogin, toast }) {
  const [step, setStep] = useState(1); const [email, setEmail] = useState("");
  const [inputCode, setInputCode] = useState(""); const [newPw, setNewPw] = useState(""); const [confirm, setConfirm] = useState("");
  const [errs, setErrs] = useState({}); const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!emailRx.test(email)) { setErrs({ email: "Invalid email" }); return; }
    const users = load(KEYS.users, []);
    if (!users.find(u => u.email.toLowerCase() === email.toLowerCase())) { setErrs({ email: "No account found" }); return; }
    setLoading(true); await new Promise(r => setTimeout(r, 400));
    const c = Math.floor(100000 + Math.random() * 900000).toString();
    const resets = load(KEYS.resets, {}); resets[email.toLowerCase()] = { code: c, expiresAt: Date.now() + 900000 };
    save(KEYS.resets, resets);
    toast(`Reset code: ${c} (demo — copy this!)`, "info"); setStep(2); setLoading(false);
  };

  const verifyCode = () => {
    const resets = load(KEYS.resets, {}); const r = resets[email.toLowerCase()];
    if (!r || r.code !== inputCode || Date.now() > r.expiresAt) { setErrs({ code: "Invalid or expired code" }); return; }
    setStep(3); setErrs({});
  };

  const resetPw = async () => {
    const e = {};
    if (newPw.length < 8) e.pw = "Min 8 characters";
    if (newPw !== confirm) e.confirm = "Passwords don't match";
    setErrs(e); if (Object.keys(e).length) return;
    setLoading(true); await new Promise(r => setTimeout(r, 400));
    const users = load(KEYS.users, []); const hashed = await hashPassword(newPw);
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    users[idx].password = hashed; save(KEYS.users, users);
    const resets = load(KEYS.resets, {}); delete resets[email.toLowerCase()]; save(KEYS.resets, resets);
    toast("Password reset!", "success"); onGoLogin(); setLoading(false);
  };

  return (
    <>
      <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 5 }}>Reset Password</h2>
      <p style={{ color: T.muted, marginBottom: 22, fontSize: 13 }}>{step === 1 ? "Enter your email." : step === 2 ? "Enter the 6-digit code." : "Set a new password."}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {step === 1 && <><Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} error={errs.email} />
          <Btn onClick={sendCode} disabled={loading} size="lg" style={{ width: "100%", justifyContent: "center" }}>{loading ? <><Spinner />Sending…</> : "Send Code"}</Btn></>}
        {step === 2 && <><Input label="Code" value={inputCode} onChange={e => setInputCode(e.target.value)} error={errs.code} />
          <Btn onClick={verifyCode} size="lg" style={{ width: "100%", justifyContent: "center" }}>Verify</Btn></>}
        {step === 3 && <><Input label="New Password" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} error={errs.pw} />
          <Input label="Confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errs.confirm} />
          <Btn onClick={resetPw} disabled={loading} size="lg" style={{ width: "100%", justifyContent: "center" }}>{loading ? <><Spinner />Saving…</> : "Set Password"}</Btn></>}
        <button onClick={onGoLogin} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 12 }}>← Back to sign in</button>
      </div>
    </>
  );
}

// ── INVOICE ───────────────────────────────────────────────────────────────
function InvoiceModal({ sale, onClose }) {
  const inv = `INV-${sale.id.toUpperCase().slice(0, 6)}`;
  const tax = Math.round(sale.price * 0.05);
  const total = sale.price + tax;

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=800,height=700");
    w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv}</title>
      <style>body{font-family:Arial,sans-serif;color:#111;padding:40px;max-width:700px;margin:0 auto}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #E8A020}.logo{font-size:32px;font-weight:900;letter-spacing:3px;color:#E8A020}table{width:100%;border-collapse:collapse;margin-bottom:24px}th{background:#f5f5f5;padding:10px 14px;text-align:left;font-size:12px}td{padding:10px 14px;border-bottom:1px solid #eee;font-size:14px}.grand{font-size:18px;font-weight:700;color:#E8A020}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;text-align:center;font-size:12px;color:#999}</style>
    </head><body>
      <div class="header"><div><div class="logo">APEX</div><p style="font-size:12px;color:#666">Car Showroom · Lahore, Pakistan</p></div>
        <div style="text-align:right"><h2>INVOICE</h2><p style="color:#666;font-size:13px">${inv}<br>${fmtDate(sale.createdAt)}</p></div></div>
      <table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody><tr><td>${sale.carName} — Vehicle Purchase</td><td style="text-align:right">$${sale.price.toLocaleString()}</td></tr>
        <tr><td>GST (5%)</td><td style="text-align:right">$${tax.toLocaleString()}</td></tr>
        <tr><td class="grand">Total</td><td class="grand" style="text-align:right">$${total.toLocaleString()}</td></tr></tbody></table>
      <p><strong>Customer:</strong> ${sale.customerName} &nbsp; <strong>Phone:</strong> ${sale.customerPhone || "—"}</p>
      ${sale.notes ? `<p style="margin-top:8px;font-size:13px;color:#666"><strong>Notes:</strong> ${sale.notes}</p>` : ""}
      <div class="footer">Thank you for your business! · APEX Car Showroom</div>
    </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close(); }, 400);
  };

  return (
    <Modal title="Invoice Preview" onClose={onClose} width="520px">
      <div style={{ background: "#fff", color: "#111", borderRadius: 8, padding: "24px 28px", fontFamily: "Arial, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, paddingBottom: 14, borderBottom: "2px solid #E8A020" }}>
          <div><div style={{ fontSize: 22, fontWeight: 900, color: "#E8A020", letterSpacing: 2 }}>APEX</div><div style={{ fontSize: 10, color: "#666" }}>CAR SHOWROOM · LAHORE</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700 }}>INVOICE</div><div style={{ fontSize: 12, color: "#666" }}>{inv}</div><div style={{ fontSize: 12, color: "#666" }}>{fmtDate(sale.createdAt)}</div></div>
        </div>
        <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", marginBottom: 3 }}>Customer</div>
          <div style={{ fontWeight: 600 }}>{sale.customerName}</div><div style={{ fontSize: 12, color: "#666" }}>{sale.customerPhone || "—"}</div></div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <thead><tr style={{ background: "#f5f5f5" }}><th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11 }}>Description</th><th style={{ padding: "8px 10px", textAlign: "right", fontSize: 11 }}>Amount</th></tr></thead>
          <tbody>
            <tr><td style={{ padding: "8px 10px", fontSize: 13 }}>{sale.carName}</td><td style={{ padding: "8px 10px", textAlign: "right", fontSize: 13 }}>${sale.price.toLocaleString()}</td></tr>
            <tr style={{ borderTop: "1px solid #eee" }}><td style={{ padding: "8px 10px", fontSize: 12, color: "#666" }}>GST (5%)</td><td style={{ padding: "8px 10px", textAlign: "right", fontSize: 12, color: "#666" }}>${tax.toLocaleString()}</td></tr>
            <tr style={{ borderTop: "2px solid #E8A020" }}><td style={{ padding: "8px 10px", fontWeight: 700, color: "#E8A020" }}>Total</td><td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#E8A020", fontSize: 16 }}>${total.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <Btn onClick={onClose} variant="ghost">Close</Btn>
        <Btn onClick={handlePrint}>Print / Download PDF</Btn>
      </div>
    </Modal>
  );
}

const exportCSV = (filename, headers, rows) => {
  const lines = [headers.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
};

// ── SIDEBAR ────────────────────────────────────────────────────────────────
const ADMIN_NAV = [
  { id: "dashboard", label: "Dashboard", icon: "" },
  { id: "inventory", label: "Inventory", icon: "" },
  { id: "bookings", label: "Bookings", icon: "" },
  { id: "sales", label: "Sales", icon: "" },
  { id: "customers", label: "Customers", icon: "" },
  { id: "employees", label: "Employees", icon: "" },
  { id: "reports", label: "Reports", icon: "" },
  { id: "users", label: "User Mgmt", icon: "" },
  { id: "logs", label: "Activity Logs", icon: "" },
  { id: "profile", label: "Profile", icon: "" },
];

const USER_NAV = [
  { id: "browse", label: "Browse Cars", icon: "" },
  { id: "mybookings", label: "My Bookings", icon: "" },
  { id: "profile", label: "My Profile", icon: "" },
];

function Sidebar({ active, onNav, user, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = user.role === "admin";
  const nav = isAdmin ? ADMIN_NAV : USER_NAV;

  return (
    <aside style={{ width: collapsed ? 60 : 215, minHeight: "100vh", background: T.surface, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", transition: "width .2s", flexShrink: 0 }}>
      <div style={{ padding: "16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.border}` }}>
        {!collapsed && <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 2, color: T.accent }}>APEX</div>}
        <button onClick={() => setCollapsed(!collapsed)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16, marginLeft: collapsed ? "auto" : 0 }}>{collapsed ? "▶" : "◀"}</button>
      </div>
      {!collapsed && (
        <div style={{ margin: "10px 10px 0", background: isAdmin ? T.accentGlow : T.info + "18", border: `1px solid ${isAdmin ? T.accent : T.info}44`, borderRadius: 7, padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: T.muted }}>{isAdmin ? "Admin" : "User"}</span>
          <span style={{ fontSize: 11, color: isAdmin ? T.accent : T.info, fontWeight: 700 }}>{isAdmin ? "ADMIN" : "PUBLIC USER"}</span>
        </div>
      )}
      <nav style={{ flex: 1, padding: "10px 7px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
        {nav.map(item => (
          <button key={item.id} onClick={() => onNav(item.id)} title={collapsed ? item.label : ""} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "9px 9px", borderRadius: 7,
            border: "none", cursor: "pointer", textAlign: "left",
            background: active === item.id ? T.accentGlow : "transparent",
            color: active === item.id ? T.accent : T.text,
            fontWeight: active === item.id ? 600 : 400,
            borderLeft: active === item.id ? `3px solid ${T.accent}` : "3px solid transparent",
            transition: "all .13s", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden"
          }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && item.label}
          </button>
        ))}
      </nav>
      <div style={{ padding: "10px 7px", borderTop: `1px solid ${T.border}` }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", marginBottom: 6 }}>
            {user.avatar ? <img src={user.avatar} style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} /> :
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#0A0C10" }}>{user.fullName[0]}</div>}
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.fullName}</div>
              <div style={{ fontSize: 10, color: T.muted }}>{user.role}</div>
            </div>
          </div>
        )}
        <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 9px", borderRadius: 7, border: "none", background: "transparent", color: T.danger, cursor: "pointer", fontSize: 12, justifyContent: collapsed ? "center" : "flex-start" }}>
          {!collapsed && "Sign out"}
        </button>
      </div>
    </aside>
  );
}

// ── ADMIN PAGES ────────────────────────────────────────────────────────────
function AdminDashboard({ user }) {
  const cars = load(KEYS.cars, SEED_CARS);
  const sales = load(KEYS.sales, []);
  const bookings = load(KEYS.bookings, []);
  const users = load(KEYS.users, []);
  const employees = load(KEYS.employees, SEED_EMPLOYEES);
  const revenue = sales.reduce((s, x) => s + x.price, 0);

  const stats = [
    { icon: "", label: "Total Cars", value: cars.length, color: T.info },
    { icon: "", label: "Available", value: cars.filter(c => c.status === "Available").length, color: T.success },
    { icon: "", label: "Sold", value: cars.filter(c => c.status === "Sold").length, color: T.accent },
    { icon: "", label: "Booked", value: cars.filter(c => c.status === "Booked").length, color: T.purple },
    { icon: "", label: "Customers", value: users.filter(u => u.role !== "admin").length, color: T.info },
    { icon: "", label: "Employees", value: employees.length, color: T.warning },
    { icon: "", label: "Total Revenue", value: fmt$(revenue), color: T.success },
    { icon: "", label: "Total Sales", value: sales.length, color: T.accent },
  ];

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Admin Dashboard</h1>
        <p style={{ color: T.muted, fontSize: 13, marginTop: 3 }}>Welcome back, {user.fullName.split(" ")[0]} · {new Date().toDateString()}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <h3 style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>Recent Sales</h3>
          {sales.length === 0 ? <p style={{ color: T.muted, fontSize: 13 }}>No sales yet.</p> :
            [...sales].reverse().slice(0, 5).map(s => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${T.border}` }}>
                <div><div style={{ fontWeight: 500, fontSize: 13 }}>{s.carName}</div><div style={{ fontSize: 11, color: T.muted }}>{s.customerName} · {fmtDate(s.createdAt)}</div></div>
                <Badge color={T.success}>{fmt$(s.price)}</Badge>
              </div>
            ))}
        </Card>
        <Card>
          <h3 style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>Recent Bookings</h3>
          {bookings.length === 0 ? <p style={{ color: T.muted, fontSize: 13 }}>No bookings yet.</p> :
            [...bookings].reverse().slice(0, 5).map(b => {
              const sc = { Pending: T.warning, Approved: T.success, Rejected: T.danger, Cancelled: T.muted };
              return (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${T.border}` }}>
                  <div><div style={{ fontWeight: 500, fontSize: 13 }}>{b.carName}</div><div style={{ fontSize: 11, color: T.muted }}>{b.userName} · {fmtDate(b.createdAt)}</div></div>
                  <Badge color={sc[b.status] || T.muted}>{b.status}</Badge>
                </div>
              );
            })}
        </Card>
      </div>
    </div>
  );
}

const BLANK_CAR = { make: "", model: "", year: new Date().getFullYear(), price: "", color: "", mileage: 0, fuel: "Petrol", transmission: "Automatic", status: "Available" };

function InventoryPage({ toast, user }) {
  const [cars, setCars] = useState(() => { const s = load(KEYS.cars, null); if (!s) { save(KEYS.cars, SEED_CARS); return SEED_CARS; } return s; });
  const [search, setSearch] = useState(""); const [filterStatus, setFilterStatus] = useState("All");
  const [modal, setModal] = useState(null); const [form, setForm] = useState(BLANK_CAR);
  const [formErrs, setFormErrs] = useState({}); const [delConfirm, setDelConfirm] = useState(null);

  const persist = (list) => { setCars(list); save(KEYS.cars, list); };
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const filtered = cars.filter(c => {
    const q = search.toLowerCase();
    return (!q || `${c.make} ${c.model} ${c.color} ${c.year}`.toLowerCase().includes(q))
      && (filterStatus === "All" || c.status === filterStatus);
  });

  const saveCar = () => {
    const e = {};
    if (!form.make.trim()) e.make = "Required";
    if (!form.model.trim()) e.model = "Required";
    if (!form.price || isNaN(form.price) || +form.price <= 0) e.price = "Enter valid price";
    setFormErrs(e); if (Object.keys(e).length) return;
    if (modal === "add") {
      const nc = { ...form, id: uid(), price: +form.price, year: +form.year, mileage: +form.mileage, addedAt: Date.now() };
      persist([...cars, nc]);
      logActivity(user.id, user.fullName, "ADD_CAR", `Added ${nc.year} ${nc.make} ${nc.model}`);
      toast("Car added!", "success");
    } else {
      persist(cars.map(c => c.id === form.id ? { ...form, price: +form.price, year: +form.year, mileage: +form.mileage } : c));
      logActivity(user.id, user.fullName, "EDIT_CAR", `Edited ${form.year} ${form.make} ${form.model}`);
      toast("Car updated!", "success");
    }
    setModal(null);
  };

  const deleteCar = (id) => {
    const car = cars.find(c => c.id === id);
    persist(cars.filter(c => c.id !== id));
    logActivity(user.id, user.fullName, "DELETE_CAR", `Deleted ${car?.make} ${car?.model}`);
    toast("Car removed.", "info"); setDelConfirm(null);
  };

  const statusColor = { Available: T.success, Reserved: T.warning, Sold: T.muted, Booked: T.purple };
  const exportInventory = () => exportCSV("inventory.csv", ["Make", "Model", "Year", "Price", "Color", "Fuel", "Transmission", "Status", "Mileage"],
    filtered.map(c => [c.make, c.model, c.year, c.price, c.color, c.fuel, c.transmission, c.status, c.mileage]));

  return (
    <div className="fade-in">
      <PageHeader title="Inventory" subtitle={`${cars.length} vehicles`}
        action={<div style={{ display: "flex", gap: 8 }}><Btn onClick={exportInventory} variant="ghost" size="sm">Export</Btn><Btn onClick={() => { setForm(BLANK_CAR); setFormErrs({}); setModal("add"); }}>+ Add Vehicle</Btn></div>} />
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <Input value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
        {["All", "Available", "Booked", "Reserved", "Sold"].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: "7px 14px", borderRadius: 7, border: `1px solid ${filterStatus === s ? T.accent : T.border}`, background: filterStatus === s ? T.accentGlow : "transparent", color: filterStatus === s ? T.accent : T.text, cursor: "pointer", fontSize: 12, fontWeight: filterStatus === s ? 600 : 400 }}>{s}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(265px, 1fr))", gap: 14 }}>
        {filtered.length === 0 && <p style={{ color: T.muted, gridColumn: "1/-1", textAlign: "center", padding: 48 }}>No vehicles found.</p>}
        {filtered.map(car => (
          <Card key={car.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div><div style={{ fontWeight: 700, fontSize: 15 }}>{car.year} {car.make} {car.model}</div>
                <div style={{ color: T.muted, fontSize: 11 }}>{car.color} · {car.fuel} · {car.transmission}</div></div>
              <Badge color={statusColor[car.status] || T.muted}>{car.status}</Badge>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.accent, marginBottom: 10 }}>{fmt$(car.price)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 12 }}>
              {[["Mileage", car.mileage + " km"], ["Year", car.year]].map(([k, v]) => (
                <div key={k} style={{ background: T.surface, borderRadius: 6, padding: "7px 9px" }}>
                  <div style={{ fontSize: 10, color: T.muted }}>{k}</div><div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <Btn onClick={() => { setForm({ ...car }); setFormErrs({}); setModal(car); }} variant="ghost" size="sm" style={{ flex: 1, justifyContent: "center" }}>Edit</Btn>
              <Btn onClick={() => setDelConfirm(car.id)} variant="danger" size="sm">Delete</Btn>
            </div>
          </Card>
        ))}
      </div>
      {modal && (
        <Modal title={modal === "add" ? "Add Vehicle" : "Edit Vehicle"} onClose={() => setModal(null)} width="540px">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
            <Input label="Make *" value={form.make} onChange={f("make")} error={formErrs.make} />
            <Input label="Model *" value={form.model} onChange={f("model")} error={formErrs.model} />
            <Input label="Year" type="number" value={form.year} onChange={f("year")} min="1980" max="2030" />
            <Input label="Price (USD) *" type="number" value={form.price} onChange={f("price")} error={formErrs.price} />
            <Input label="Color" value={form.color} onChange={f("color")} />
            <Input label="Mileage (km)" type="number" value={form.mileage} onChange={f("mileage")} />
            <Sel label="Fuel" value={form.fuel} onChange={f("fuel")}>{["Petrol", "Diesel", "Electric", "Hybrid", "CNG"].map(o => <option key={o}>{o}</option>)}</Sel>
            <Sel label="Transmission" value={form.transmission} onChange={f("transmission")}>{["Automatic", "Manual", "CVT"].map(o => <option key={o}>{o}</option>)}</Sel>
            <Sel label="Status" value={form.status} onChange={f("status")} style={{ gridColumn: "1/-1" }}>{["Available", "Reserved", "Booked", "Sold"].map(o => <option key={o}>{o}</option>)}</Sel>
          </div>
          <div style={{ display: "flex", gap: 9, marginTop: 18, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} variant="ghost">Cancel</Btn>
            <Btn onClick={saveCar}>Save</Btn>
          </div>
        </Modal>
      )}
      {delConfirm && <Confirm message="Remove this vehicle from inventory?" onYes={() => deleteCar(delConfirm)} onNo={() => setDelConfirm(null)} />}
    </div>
  );
}

function BookingsAdminPage({ toast, user }) {
  const [bookings, setBookings] = useState(() => load(KEYS.bookings, []));
  const [filter, setFilter] = useState("All"); const [invoiceSale, setInvoiceSale] = useState(null);

  const persist = b => { setBookings(b); save(KEYS.bookings, b); };

  const updateStatus = (id, status) => {
    const bk = bookings.find(b => b.id === id);
    persist(bookings.map(b => b.id === id ? { ...b, status, updatedAt: Date.now() } : b));
    if (status === "Approved") { const cars = load(KEYS.cars, SEED_CARS); save(KEYS.cars, cars.map(c => c.id === bk.carId ? { ...c, status: "Booked" } : c)); }
    if (status === "Rejected" || status === "Cancelled") { const cars = load(KEYS.cars, SEED_CARS); save(KEYS.cars, cars.map(c => c.id === bk.carId ? { ...c, status: "Available" } : c)); }
    logActivity(user.id, user.fullName, `BOOKING_${status.toUpperCase()}`, `Booking for ${bk.carName}`);
    toast(`Booking ${status.toLowerCase()}!`, "success");
  };

  const convertToSale = (bk) => {
    const sale = { id: uid(), carId: bk.carId, carName: bk.carName, customerName: bk.userName, customerPhone: bk.userPhone, price: bk.price, date: new Date().toISOString().split("T")[0], notes: "Converted from booking", createdAt: Date.now() };
    const sales = load(KEYS.sales, []); save(KEYS.sales, [...sales, sale]);
    const cars = load(KEYS.cars, []); save(KEYS.cars, cars.map(c => c.id === bk.carId ? { ...c, status: "Sold" } : c));
    persist(bookings.map(b => b.id === bk.id ? { ...b, status: "Sold", saleId: sale.id } : b));
    logActivity(user.id, user.fullName, "BOOKING_TO_SALE", `${bk.carName} → sold`);
    toast("Converted to sale!", "success"); setInvoiceSale(sale);
  };

  const filtered = bookings.filter(b => filter === "All" || b.status === filter);
  const sc = { Pending: T.warning, Approved: T.success, Rejected: T.danger, Cancelled: T.muted, Sold: T.purple };
  const exportB = () => exportCSV("bookings.csv", ["Car", "Customer", "Phone", "Price", "Status", "Date"],
    filtered.map(b => [b.carName, b.userName, b.userPhone, b.price, b.status, fmtDate(b.createdAt)]));

  return (
    <div className="fade-in">
      <PageHeader title="Booking Management" subtitle={`${bookings.length} total`} action={<Btn onClick={exportB} variant="ghost" size="sm">Export</Btn>} />
      <div style={{ display: "flex", gap: 9, marginBottom: 18, flexWrap: "wrap" }}>
        {["All", "Pending", "Approved", "Rejected", "Cancelled", "Sold"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: "6px 13px", borderRadius: 7, border: `1px solid ${filter === s ? T.accent : T.border}`, background: filter === s ? T.accentGlow : "transparent", color: filter === s ? T.accent : T.text, cursor: "pointer", fontSize: 12 }}>{s}</button>
        ))}
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Table cols={[
          { key: "carName", label: "Vehicle", render: r => <span style={{ fontWeight: 500 }}>{r.carName}</span> },
          { key: "userName", label: "Customer" },
          { key: "userPhone", label: "Phone", render: r => <span style={{ color: T.muted }}>{r.userPhone || "—"}</span> },
          { key: "price", label: "Price", render: r => <Badge color={T.accent}>{fmt$(r.price)}</Badge> },
          { key: "status", label: "Status", render: r => <Badge color={sc[r.status] || T.muted}>{r.status}</Badge> },
          { key: "date", label: "Date", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{fmtDate(r.createdAt)}</span> },
          { key: "actions", label: "Actions", render: r => (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {r.status === "Pending" && <><Btn onClick={() => updateStatus(r.id, "Approved")} variant="success" size="sm">Approve</Btn><Btn onClick={() => updateStatus(r.id, "Rejected")} variant="danger" size="sm">Reject</Btn></>}
              {r.status === "Approved" && <><Btn onClick={() => convertToSale(r)} variant="primary" size="sm">Sell</Btn><Btn onClick={() => updateStatus(r.id, "Cancelled")} variant="ghost" size="sm">Cancel</Btn></>}
            </div>
          )},
        ]} rows={filtered} empty="No bookings found." />
      </Card>
      {invoiceSale && <InvoiceModal sale={invoiceSale} onClose={() => setInvoiceSale(null)} />}
    </div>
  );
}

function SalesPage({ toast, user }) {
  const [sales, setSales] = useState(() => load(KEYS.sales, []));
  const [modal, setModal] = useState(false); const [invoiceSale, setInvoiceSale] = useState(null);
  const [form, setForm] = useState({ carId: "", customerName: "", customerPhone: "", price: "", date: new Date().toISOString().split("T")[0], notes: "" });
  const [errs, setErrs] = useState({});
  const cars = load(KEYS.cars, SEED_CARS).filter(c => c.status === "Available" || c.status === "Booked");
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    const e = {};
    if (!form.carId) e.car = "Select a vehicle";
    if (!form.customerName.trim()) e.name = "Required";
    if (!form.price || isNaN(form.price)) e.price = "Valid price required";
    setErrs(e); if (Object.keys(e).length) return;
    const allCars = load(KEYS.cars, SEED_CARS); const car = allCars.find(c => c.id === form.carId);
    const sale = { id: uid(), carId: form.carId, carName: `${car.year} ${car.make} ${car.model}`, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim(), price: +form.price, date: form.date, notes: form.notes, createdAt: Date.now() };
    const updated = [...sales, sale]; setSales(updated); save(KEYS.sales, updated);
    save(KEYS.cars, allCars.map(c => c.id === form.carId ? { ...c, status: "Sold" } : c));
    logActivity(user.id, user.fullName, "RECORD_SALE", `Sold ${sale.carName} to ${sale.customerName}`);
    toast("Sale recorded!", "success"); setModal(false);
    setForm({ carId: "", customerName: "", customerPhone: "", price: "", date: new Date().toISOString().split("T")[0], notes: "" });
    setInvoiceSale(sale);
  };

  const exportSales = () => exportCSV("sales.csv", ["Car", "Customer", "Phone", "Price", "Date"],
    sales.map(s => [s.carName, s.customerName, s.customerPhone, s.price, s.date]));

  return (
    <div className="fade-in">
      <PageHeader title="Sales" subtitle={`Revenue: ${fmt$(sales.reduce((s, x) => s + x.price, 0))}`}
        action={<div style={{ display: "flex", gap: 8 }}><Btn onClick={exportSales} variant="ghost" size="sm">Export</Btn><Btn onClick={() => setModal(true)}>+ Record Sale</Btn></div>} />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Table cols={[
          { key: "carName", label: "Vehicle", render: r => <span style={{ fontWeight: 500 }}>{r.carName}</span> },
          { key: "customerName", label: "Customer" },
          { key: "customerPhone", label: "Phone", render: r => <span style={{ color: T.muted }}>{r.customerPhone || "—"}</span> },
          { key: "price", label: "Price", render: r => <Badge color={T.success}>{fmt$(r.price)}</Badge> },
          { key: "date", label: "Date", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{fmtDate(r.createdAt)}</span> },
          { key: "inv", label: "Invoice", render: r => <Btn onClick={() => setInvoiceSale(r)} variant="subtle" size="sm">Invoice</Btn> },
        ]} rows={[...sales].reverse()} empty="No sales recorded." />
      </Card>
      {modal && (
        <Modal title="Record Sale" onClose={() => setModal(false)} width="500px">
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <Sel label="Vehicle *" value={form.carId} onChange={e => { const car = load(KEYS.cars, SEED_CARS).find(c => c.id === e.target.value); setForm(p => ({ ...p, carId: e.target.value, price: car ? car.price : "" })); }} error={errs.car}>
              <option value="">Select…</option>
              {cars.map(c => <option key={c.id} value={c.id}>{c.year} {c.make} {c.model} — {fmt$(c.price)}</option>)}
            </Sel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
              <Input label="Customer Name *" value={form.customerName} onChange={f("customerName")} error={errs.name} />
              <Input label="Phone" value={form.customerPhone} onChange={f("customerPhone")} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
              <Input label="Sale Price *" type="number" value={form.price} onChange={f("price")} error={errs.price} />
              <Input label="Date" type="date" value={form.date} onChange={f("date")} />
            </div>
            <Input label="Notes" value={form.notes} onChange={f("notes")} />
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <Btn onClick={() => setModal(false)} variant="ghost">Cancel</Btn>
              <Btn onClick={submit} variant="success">Record Sale</Btn>
            </div>
          </div>
        </Modal>
      )}
      {invoiceSale && <InvoiceModal sale={invoiceSale} onClose={() => setInvoiceSale(null)} />}
    </div>
  );
}

function CustomersPage({ toast, user: adminUser }) {
  const [users, setUsers] = useState(() => load(KEYS.users, []));
  const [search, setSearch] = useState(""); const [delConfirm, setDelConfirm] = useState(null);
  const sales = load(KEYS.sales, []);
  const filtered = users.filter(u => u.role !== "admin" && (!search || `${u.fullName} ${u.email} ${u.phone}`.toLowerCase().includes(search.toLowerCase())));

  const deleteUser = (id) => {
    const u = users.find(x => x.id === id);
    const updated = users.filter(x => x.id !== id); setUsers(updated); save(KEYS.users, updated);
    logActivity(adminUser.id, adminUser.fullName, "DELETE_USER", `Removed ${u?.fullName}`);
    toast("User removed.", "info"); setDelConfirm(null);
  };

  const exportC = () => exportCSV("customers.csv", ["Name", "Email", "Phone", "CNIC", "Address", "Joined"],
    filtered.map(u => [u.fullName, u.email, u.phone, u.cnic || "", u.address, fmtDate(u.createdAt)]));

  return (
    <div className="fade-in">
      <PageHeader title="Customers" subtitle={`${filtered.length} users`} action={<Btn onClick={exportC} variant="ghost" size="sm">Export</Btn>} />
      <div style={{ marginBottom: 16 }}><Input value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 300 }} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 14 }}>
        {filtered.length === 0 && <Card style={{ textAlign: "center", padding: 60, gridColumn: "1/-1" }}><p style={{ color: T.muted }}>No customers found.</p></Card>}
        {filtered.map(u => {
          const userSales = sales.filter(s => s.customerName === u.fullName);
          return (
            <Card key={u.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 11 }}>
                {u.avatar ? <img src={u.avatar} style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} /> :
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: T.accent + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: T.accent }}>{u.fullName[0]}</div>}
                <div><div style={{ fontWeight: 600, fontSize: 14 }}>{u.fullName}</div><div style={{ fontSize: 11, color: T.muted }}>{u.role}</div></div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <div style={{ color: T.muted }}>{u.email}</div>
                <div style={{ color: T.muted }}>{u.phone}</div>
                {u.cnic && <div style={{ color: T.muted }}>{u.cnic}</div>}
                <div style={{ color: T.muted }}>{u.address}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                <Badge color={userSales.length > 0 ? T.success : T.muted}>{userSales.length} purchase{userSales.length !== 1 ? "s" : ""}</Badge>
                <Btn onClick={() => setDelConfirm(u.id)} variant="danger" size="sm">Delete</Btn>
              </div>
            </Card>
          );
        })}
      </div>
      {delConfirm && <Confirm message="Permanently remove this user?" onYes={() => deleteUser(delConfirm)} onNo={() => setDelConfirm(null)} />}
    </div>
  );
}

const BLANK_EMP = { name: "", role: "", phone: "", email: "", salary: "", joinDate: new Date().toISOString().split("T")[0], status: "Active" };

function EmployeesPage({ toast, user: adminUser }) {
  const [employees, setEmployees] = useState(() => { const s = load(KEYS.employees, null); if (!s) { save(KEYS.employees, SEED_EMPLOYEES); return SEED_EMPLOYEES; } return s; });
  const [modal, setModal] = useState(null); const [form, setForm] = useState(BLANK_EMP);
  const [delConfirm, setDelConfirm] = useState(null); const [search, setSearch] = useState("");
  const persist = e => { setEmployees(e); save(KEYS.employees, e); };
  const f = k => e2 => setForm(p => ({ ...p, [k]: e2.target.value }));
  const filtered = employees.filter(e => !search || `${e.name} ${e.role} ${e.email}`.toLowerCase().includes(search.toLowerCase()));

  const saveEmp = () => {
    if (!form.name.trim() || !form.role.trim()) return;
    if (modal === "add") {
      const ne = { ...form, id: uid(), salary: +form.salary, createdAt: Date.now() };
      persist([...employees, ne]);
      logActivity(adminUser.id, adminUser.fullName, "ADD_EMPLOYEE", `Added ${ne.name}`);
      toast("Employee added!", "success");
    } else {
      persist(employees.map(e => e.id === form.id ? { ...form, salary: +form.salary } : e));
      toast("Employee updated!", "success");
    }
    setModal(null);
  };

  const exportE = () => exportCSV("employees.csv", ["Name", "Role", "Email", "Phone", "Salary", "Join Date", "Status"],
    filtered.map(e => [e.name, e.role, e.email, e.phone, e.salary, e.joinDate, e.status]));

  return (
    <div className="fade-in">
      <PageHeader title="Employees" subtitle={`${employees.length} staff`}
        action={<div style={{ display: "flex", gap: 8 }}><Btn onClick={exportE} variant="ghost" size="sm">Export</Btn><Btn onClick={() => { setForm(BLANK_EMP); setModal("add"); }}>+ Add Employee</Btn></div>} />
      <div style={{ marginBottom: 16 }}><Input value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 280 }} /></div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Table cols={[
          { key: "name", label: "Name", render: r => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div style={{ fontSize: 11, color: T.muted }}>{r.email}</div></div> },
          { key: "role", label: "Role" },
          { key: "phone", label: "Phone", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{r.phone}</span> },
          { key: "salary", label: "Salary", render: r => <Badge color={T.success}>PKR {Number(r.salary).toLocaleString()}</Badge> },
          { key: "joinDate", label: "Joined", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{fmtDate(r.joinDate)}</span> },
          { key: "status", label: "Status", render: r => <Badge color={r.status === "Active" ? T.success : T.muted}>{r.status}</Badge> },
          { key: "actions", label: "", render: r => <div style={{ display: "flex", gap: 6 }}><Btn onClick={() => { setForm({ ...r }); setModal(r); }} variant="ghost" size="sm">Edit</Btn><Btn onClick={() => setDelConfirm(r.id)} variant="danger" size="sm">Delete</Btn></div> },
        ]} rows={filtered} empty="No employees." />
      </Card>
      {modal && (
        <Modal title={modal === "add" ? "Add Employee" : "Edit Employee"} onClose={() => setModal(null)} width="500px">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Full Name *" value={form.name} onChange={f("name")} />
            <Input label="Role *" value={form.role} onChange={f("role")} />
            <Input label="Email" type="email" value={form.email} onChange={f("email")} />
            <Input label="Phone" value={form.phone} onChange={f("phone")} />
            <Input label="Salary (PKR)" type="number" value={form.salary} onChange={f("salary")} />
            <Input label="Join Date" type="date" value={form.joinDate} onChange={f("joinDate")} />
            <Sel label="Status" value={form.status} onChange={f("status")} style={{ gridColumn: "1/-1" }}>
              {["Active", "On Leave", "Resigned"].map(o => <option key={o}>{o}</option>)}
            </Sel>
          </div>
          <div style={{ display: "flex", gap: 9, marginTop: 18, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} variant="ghost">Cancel</Btn>
            <Btn onClick={saveEmp}>Save</Btn>
          </div>
        </Modal>
      )}
      {delConfirm && <Confirm message="Remove this employee?" onYes={() => { const e = employees.find(x => x.id === delConfirm); persist(employees.filter(x => x.id !== delConfirm)); logActivity(adminUser.id, adminUser.fullName, "DELETE_EMPLOYEE", `Removed ${e?.name}`); toast("Removed.", "info"); setDelConfirm(null); }} onNo={() => setDelConfirm(null)} />}
    </div>
  );
}

function ReportsPage() {
  const sales = load(KEYS.sales, []);
  const cars = load(KEYS.cars, SEED_CARS);
  const bookings = load(KEYS.bookings, []);
  const revenue = sales.reduce((s, x) => s + x.price, 0);
  const avgSale = sales.length ? Math.round(revenue / sales.length) : 0;
  const monthlySales = {};
  sales.forEach(s => { const m = new Date(s.createdAt).toLocaleString("default", { month: "short", year: "2-digit" }); monthlySales[m] = (monthlySales[m] || 0) + s.price; });
  const fuelCounts = {};
  cars.forEach(c => { fuelCounts[c.fuel] = (fuelCounts[c.fuel] || 0) + 1; });

  const exportReport = () => exportCSV("report.csv", ["Metric", "Value"], [
    ["Total Cars", cars.length], ["Available", cars.filter(c => c.status === "Available").length],
    ["Sold", cars.filter(c => c.status === "Sold").length], ["Revenue", revenue],
    ["Avg Sale", avgSale], ["Bookings", bookings.length],
  ]);

  return (
    <div className="fade-in">
      <PageHeader title="Reports & Analytics" action={<Btn onClick={exportReport} variant="ghost" size="sm">Export</Btn>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 22 }}>
        <StatCard icon="" label="Total Revenue" value={fmt$(revenue)} color={T.success} />
        <StatCard icon="" label="Avg Sale Price" value={fmt$(avgSale)} color={T.info} />
        <StatCard icon="" label="Cars in Stock" value={cars.length} color={T.accent} />
        <StatCard icon="" label="Total Bookings" value={bookings.length} color={T.purple} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <h3 style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>Monthly Revenue</h3>
          {Object.keys(monthlySales).length === 0 ? <p style={{ color: T.muted, fontSize: 13 }}>No data yet.</p> :
            Object.entries(monthlySales).map(([m, v]) => (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                <div style={{ width: 45, fontSize: 11, color: T.muted }}>{m}</div>
                <div style={{ flex: 1, height: 8, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min((v / revenue) * 100, 100)}%`, height: "100%", background: T.accent, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.accent }}>{fmt$(v)}</div>
              </div>
            ))}
        </Card>
        <Card>
          <h3 style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>Cars by Fuel</h3>
          {Object.entries(fuelCounts).map(([f, c]) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
              <div style={{ width: 55, fontSize: 11, color: T.muted }}>{f}</div>
              <div style={{ flex: 1, height: 8, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${(c / cars.length) * 100}%`, height: "100%", background: T.info, borderRadius: 4 }} />
              </div>
              <Badge color={T.info}>{c}</Badge>
            </div>
          ))}
        </Card>
      </div>
      <Card>
        <h3 style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>Booking Status Breakdown</h3>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[["Pending", T.warning], ["Approved", T.success], ["Rejected", T.danger], ["Cancelled", T.muted], ["Sold", T.purple]].map(([s, c]) => (
            <div key={s} style={{ background: T.surface, borderRadius: 8, padding: "12px 18px", textAlign: "center", minWidth: 90 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{bookings.filter(b => b.status === s).length}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{s}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function UserMgmtPage({ toast, user: adminUser }) {
  const [users, setUsers] = useState(() => load(KEYS.users, []));
  const [delConfirm, setDelConfirm] = useState(null);

  const toggleRole = (id) => {
    const u = users.find(x => x.id === id);
    if (u.id === adminUser.id) { toast("Cannot change your own role.", "warning"); return; }
    const newRole = u.role === "admin" ? "user" : "admin";
    const updated = users.map(x => x.id === id ? { ...x, role: newRole } : x);
    setUsers(updated); save(KEYS.users, updated);
    logActivity(adminUser.id, adminUser.fullName, "ROLE_CHANGE", `${u.fullName}: ${u.role} → ${newRole}`);
    toast(`${u.fullName} is now ${newRole}.`, "success");
  };

  const deleteUser = (id) => {
    if (id === adminUser.id) { toast("Cannot delete yourself.", "warning"); setDelConfirm(null); return; }
    const u = users.find(x => x.id === id);
    const updated = users.filter(x => x.id !== id); setUsers(updated); save(KEYS.users, updated);
    logActivity(adminUser.id, adminUser.fullName, "DELETE_USER", `Deleted ${u?.fullName}`);
    toast("User deleted.", "info"); setDelConfirm(null);
  };

  return (
    <div className="fade-in">
      <PageHeader title="User Management" subtitle={`${users.length} accounts`} />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Table cols={[
          { key: "fullName", label: "User", render: r => <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {r.avatar ? <img src={r.avatar} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} /> :
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.accent + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: T.accent }}>{r.fullName[0]}</div>}
            <div><div style={{ fontWeight: 500 }}>{r.fullName}</div><div style={{ fontSize: 11, color: T.muted }}>{r.email}</div></div>
          </div> },
          { key: "phone", label: "Phone", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{r.phone}</span> },
          { key: "role", label: "Role", render: r => <Badge color={r.role === "admin" ? T.accent : T.info}>{r.role}</Badge> },
          { key: "joined", label: "Joined", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{r.createdAt ? fmtDate(r.createdAt) : "—"}</span> },
          { key: "actions", label: "Actions", render: r => <div style={{ display: "flex", gap: 6 }}>
            <Btn onClick={() => toggleRole(r.id)} variant={r.role === "admin" ? "warning" : "info"} size="sm">{r.role === "admin" ? "→ User" : "→ Admin"}</Btn>
            <Btn onClick={() => setDelConfirm(r.id)} variant="danger" size="sm">Delete</Btn>
          </div> },
        ]} rows={users} empty="No users." />
      </Card>
      {delConfirm && <Confirm message="Permanently delete this user?" onYes={() => deleteUser(delConfirm)} onNo={() => setDelConfirm(null)} />}
    </div>
  );
}

function ActivityLogsPage() {
  const [logs, setLogs] = useState(() => load(KEYS.logs, []));
  const [search, setSearch] = useState("");
  const filtered = logs.filter(l => !search || `${l.userName} ${l.action} ${l.detail}`.toLowerCase().includes(search.toLowerCase()));
  const ac = { LOGIN: T.success, SIGNUP: T.info, ADD_CAR: T.accent, EDIT_CAR: T.warning, DELETE_CAR: T.danger, RECORD_SALE: T.success, ADD_EMPLOYEE: T.purple, DELETE_USER: T.danger, ROLE_CHANGE: T.warning };

  return (
    <div className="fade-in">
      <PageHeader title="Activity Logs" subtitle={`${logs.length} entries`}
        action={<Btn onClick={() => { save(KEYS.logs, []); setLogs([]); }} variant="danger" size="sm">Clear</Btn>} />
      <div style={{ marginBottom: 16 }}><Input value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 300 }} /></div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Table cols={[
          { key: "at", label: "Time", render: r => <div><div style={{ fontSize: 12 }}>{fmtDate(r.at)}</div><div style={{ fontSize: 11, color: T.muted }}>{fmtTime(r.at)}</div></div> },
          { key: "userName", label: "User", render: r => <span style={{ fontWeight: 500 }}>{r.userName}</span> },
          { key: "action", label: "Action", render: r => <Badge color={ac[r.action] || T.muted} size="sm">{r.action.replace(/_/g, " ")}</Badge> },
          { key: "detail", label: "Detail", render: r => <span style={{ color: T.muted, fontSize: 12 }}>{r.detail || "—"}</span> },
        ]} rows={filtered} empty="No logs yet." />
      </Card>
    </div>
  );
}

// ── PROFILE (shared) ───────────────────────────────────────────────────────
function ProfilePage({ user, onUserUpdate, toast }) {
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone || "", cnic: user.cnic || "", address: user.address || "" });
  const [avatar, setAvatar] = useState(user.avatar);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwErrs, setPwErrs] = useState({}); const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const fp = k => e => setPwForm(p => ({ ...p, [k]: e.target.value }));

  const saveProfile = async () => {
    setSaving(true); await new Promise(r => setTimeout(r, 350));
    const users = load(KEYS.users, []);
    const updated = { ...user, fullName: form.fullName.trim(), phone: form.phone.trim(), cnic: form.cnic.trim(), address: form.address.trim(), avatar };
    save(KEYS.users, users.map(u => u.id === user.id ? updated : u));
    onUserUpdate(updated);
    logActivity(user.id, user.fullName, "PROFILE_UPDATE", "Updated profile");
    toast("Profile updated!", "success"); setSaving(false);
  };

  const changePw = async () => {
    const e = {}; const users = load(KEYS.users, []);
    const hc = await hashPassword(pwForm.current); const u = users.find(x => x.id === user.id);
    if (u.password !== hc) e.current = "Incorrect password";
    if (pwForm.next.length < 8) e.next = "Min 8 characters";
    if (pwForm.next !== pwForm.confirm) e.confirm = "Passwords don't match";
    setPwErrs(e); if (Object.keys(e).length) return;
    const hn = await hashPassword(pwForm.next);
    save(KEYS.users, users.map(x => x.id === user.id ? { ...x, password: hn } : x));
    logActivity(user.id, user.fullName, "PASSWORD_CHANGE", "Changed password");
    toast("Password changed!", "success"); setPwForm({ current: "", next: "", confirm: "" });
  };

  const handleAvatar = e => { const f2 = e.target.files[0]; if (!f2) return; const r = new FileReader(); r.onload = () => setAvatar(r.result); r.readAsDataURL(f2); };

  return (
    <div className="fade-in" style={{ maxWidth: 580 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, marginBottom: 22 }}>My Profile</h1>
      <Card style={{ marginBottom: 18 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 18, fontSize: 15 }}>Personal Information</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div onClick={() => fileRef.current.click()} style={{ width: 68, height: 68, borderRadius: "50%", overflow: "hidden", background: T.surface, border: `2px dashed ${T.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {avatar ? <img src={avatar} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ fontSize: 26, fontWeight: 700, color: T.accent }}>{user.fullName[0]}</div>}
          </div>
          <div><button onClick={() => fileRef.current.click()} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 13px", color: T.text, cursor: "pointer", fontSize: 12 }}>Change Photo</button>
            <p style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>JPG, PNG</p></div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatar} style={{ display: "none" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Full Name" value={form.fullName} onChange={f("fullName")} />
          <Input label="Phone" value={form.phone} onChange={f("phone")} />
          <Input label="CNIC" value={form.cnic} onChange={f("cnic")} />
          <Input label="Address" value={form.address} onChange={f("address")} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Btn onClick={saveProfile} disabled={saving}>{saving ? <><Spinner />Saving…</> : "Save Changes"}</Btn>
            <Badge color={user.role === "admin" ? T.accent : T.info} size="sm">Role: {user.role}</Badge>
          </div>
        </div>
      </Card>
      <Card>
        <h3 style={{ fontWeight: 600, marginBottom: 18, fontSize: 15 }}>Change Password</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Current Password" type="password" value={pwForm.current} onChange={fp("current")} error={pwErrs.current} />
          <Input label="New Password" type="password" value={pwForm.next} onChange={fp("next")} error={pwErrs.next} />
          <Input label="Confirm New" type="password" value={pwForm.confirm} onChange={fp("confirm")} error={pwErrs.confirm} />
          <div style={{ textAlign: "right" }}><Btn onClick={changePw}>Update Password</Btn></div>
        </div>
      </Card>
    </div>
  );
}

// ── PUBLIC USER PAGES ──────────────────────────────────────────────────────

// Car Detail Modal for public users
function CarDetailModal({ car, user, onClose, onBook, toast }) {
  const [bForm, setBForm] = useState({ notes: "", phone: user.phone || "" });
  const [showBookForm, setShowBookForm] = useState(false);

  const submitBooking = () => {
    if (!bForm.phone.trim()) { toast("Please enter your phone number.", "warning"); return; }
    const bookings = load(KEYS.bookings, []);
    const existing = bookings.find(b => b.carId === car.id && b.userId === user.id && b.status === "Pending");
    if (existing) { toast("You already have a pending booking for this car.", "warning"); return; }
    const nb = { id: uid(), carId: car.id, carName: `${car.year} ${car.make} ${car.model}`, userId: user.id, userName: user.fullName, userPhone: bForm.phone.trim(), price: car.price, notes: bForm.notes, status: "Pending", createdAt: Date.now() };
    save(KEYS.bookings, [...bookings, nb]);
    logActivity(user.id, user.fullName, "BOOKING_REQUEST", `Requested ${nb.carName}`);
    toast("Booking request sent! Check My Bookings.", "success");
    onBook(); onClose();
  };

  const specs = [
    ["Make", car.make], ["Model", car.model], ["Year", car.year],
    ["Color", car.color], ["Fuel", car.fuel], ["Transmission", car.transmission],
    ["Mileage", car.mileage + " km"], ["Price", fmt$(car.price)],
  ];

  return (
    <Modal title={`${car.year} ${car.make} ${car.model}`} onClose={onClose} width="520px">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, padding: "14px 18px", background: T.surface, borderRadius: 9 }}>
        <div style={{ fontSize: 13, color: T.muted }}>No Image</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: T.accent }}>{fmt$(car.price)}</div>
          <Badge color={T.success} size="md">Available</Badge>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 18 }}>
        {specs.map(([k, v]) => (
          <div key={k} style={{ background: T.surface, borderRadius: 7, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: T.muted }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>
      {!showBookForm ? (
        <Btn onClick={() => setShowBookForm(true)} style={{ width: "100%", justifyContent: "center" }} size="lg">Request Booking</Btn>
      ) : (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <h4 style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Booking Request</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <Input label="Your Phone *" value={bForm.phone} onChange={e => setBForm(p => ({ ...p, phone: e.target.value }))} />
            <Input label="Notes (optional)" value={bForm.notes} onChange={e => setBForm(p => ({ ...p, notes: e.target.value }))} />
            <div style={{ background: T.warning + "18", border: `1px solid ${T.warning}44`, borderRadius: 7, padding: "8px 12px", fontSize: 12, color: T.warning }}>
              Admin will review and approve/reject your request.
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <Btn onClick={() => setShowBookForm(false)} variant="ghost" style={{ flex: 1, justifyContent: "center" }}>Back</Btn>
              <Btn onClick={submitBooking} style={{ flex: 1, justifyContent: "center" }}>Submit Request</Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BrowseCarsPage({ user, toast }) {
  const [cars, setCars] = useState(() => { const s = load(KEYS.cars, null); if (!s) { save(KEYS.cars, SEED_CARS); return SEED_CARS; } return s; });
  const [search, setSearch] = useState("");
  const [filterFuel, setFilterFuel] = useState("All");
  const [filterTrans, setFilterTrans] = useState("All");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [detailCar, setDetailCar] = useState(null);

  const refresh = () => setCars(load(KEYS.cars, SEED_CARS));

  const available = cars.filter(c => {
    const q = search.toLowerCase();
    const matchQ = !q || `${c.make} ${c.model} ${c.year} ${c.color} ${c.fuel}`.toLowerCase().includes(q);
    const matchFuel = filterFuel === "All" || c.fuel === filterFuel;
    const matchTrans = filterTrans === "All" || c.transmission === filterTrans;
    const matchMin = !priceMin || c.price >= +priceMin;
    const matchMax = !priceMax || c.price <= +priceMax;
    return c.status === "Available" && matchQ && matchFuel && matchTrans && matchMin && matchMax;
  }).sort((a, b) => {
    if (sortBy === "price_asc") return a.price - b.price;
    if (sortBy === "price_desc") return b.price - a.price;
    if (sortBy === "year") return b.year - a.year;
    return b.addedAt - a.addedAt;
  });

  const fuels = ["All", ...new Set(cars.map(c => c.fuel))];
  const trans = ["All", "Automatic", "Manual", "CVT"];

  const clearFilters = () => { setSearch(""); setFilterFuel("All"); setFilterTrans("All"); setPriceMin(""); setPriceMax(""); setSortBy("newest"); };

  return (
    <div className="fade-in">
      <PageHeader title="Browse Available Cars" subtitle={`${available.length} cars found`} />

      {/* Search & Filters */}
      <Card style={{ marginBottom: 20, padding: "16px 18px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Input value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <Sel label="" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 155 }}>
            <option value="newest">Newest First</option>
            <option value="price_asc">Price: Low → High</option>
            <option value="price_desc">Price: High → Low</option>
            <option value="year">Year: Newest</option>
          </Sel>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>Fuel Type</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {fuels.map(f => (
                <button key={f} onClick={() => setFilterFuel(f)} style={{ padding: "5px 11px", borderRadius: 6, border: `1px solid ${filterFuel === f ? T.accent : T.border}`, background: filterFuel === f ? T.accentGlow : "transparent", color: filterFuel === f ? T.accent : T.text, cursor: "pointer", fontSize: 12 }}>{f}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>Transmission</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {trans.map(t => (
                <button key={t} onClick={() => setFilterTrans(t)} style={{ padding: "5px 11px", borderRadius: 6, border: `1px solid ${filterTrans === t ? T.accent : T.border}`, background: filterTrans === t ? T.accentGlow : "transparent", color: filterTrans === t ? T.accent : T.text, cursor: "pointer", fontSize: 12 }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
            <Input label="Min Price $" type="number" value={priceMin} onChange={e => setPriceMin(e.target.value)} style={{ width: 110 }} />
            <Input label="Max Price $" type="number" value={priceMax} onChange={e => setPriceMax(e.target.value)} style={{ width: 110 }} />
          </div>
          <Btn onClick={clearFilters} variant="ghost" size="sm">Clear</Btn>
        </div>
      </Card>

      {available.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 60 }}>
          
          <h3 style={{ marginBottom: 8 }}>No cars match your filters</h3>
          <p style={{ color: T.muted, fontSize: 13 }}>Try adjusting your search or filters.</p>
          <div style={{ marginTop: 16 }}><Btn onClick={clearFilters} variant="ghost">Clear Filters</Btn></div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 14 }}>
          {available.map(car => (
            <Card key={car.id} onClick={() => setDetailCar(car)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{car.year} {car.make}</div>
                  <div style={{ fontWeight: 600, color: T.muted, fontSize: 14 }}>{car.model}</div>
                </div>
                <Badge color={T.success}>Available</Badge>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.accent, marginBottom: 12 }}>{fmt$(car.price)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
                {[car.fuel, car.transmission, car.color, car.mileage + " km"].map((v) => (
                  <div key={v} style={{ background: T.surface, borderRadius: 6, padding: "6px 9px", display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 11, color: T.muted }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <Btn onClick={e => { e.stopPropagation(); setDetailCar(car); }} variant="ghost" size="sm" style={{ flex: 1, justifyContent: "center" }}>View Details</Btn>
                <Btn onClick={e => { e.stopPropagation(); setDetailCar(car); }} size="sm" style={{ flex: 1, justifyContent: "center" }}>Book</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      {detailCar && <CarDetailModal car={detailCar} user={user} onClose={() => setDetailCar(null)} onBook={refresh} toast={toast} />}
    </div>
  );
}

function MyBookingsPage({ user, toast }) {
  const [bookings, setBookings] = useState(() => load(KEYS.bookings, []).filter(b => b.userId === user.id));
  const [filter, setFilter] = useState("All");

  const refresh = () => setBookings(load(KEYS.bookings, []).filter(b => b.userId === user.id));

  const cancel = (id) => {
    const all = load(KEYS.bookings, []);
    const bk = all.find(b => b.id === id);
    const updated = all.map(b => b.id === id ? { ...b, status: "Cancelled" } : b);
    save(KEYS.bookings, updated);
    const cars = load(KEYS.cars, []); save(KEYS.cars, cars.map(c => c.id === bk.carId ? { ...c, status: "Available" } : c));
    logActivity(user.id, user.fullName, "BOOKING_CANCEL", `Cancelled ${bk.carName}`);
    refresh(); toast("Booking cancelled.", "info");
  };

  const sc = { Pending: T.warning, Approved: T.success, Rejected: T.danger, Cancelled: T.muted, Sold: T.purple };
  const filtered = bookings.filter(b => filter === "All" || b.status === filter);

  const stats = [
    { label: "Total", value: bookings.length, color: T.info },
    { label: "Pending", value: bookings.filter(b => b.status === "Pending").length, color: T.warning },
    { label: "Approved", value: bookings.filter(b => b.status === "Approved").length, color: T.success },
    { label: "Rejected", value: bookings.filter(b => b.status === "Rejected").length, color: T.danger },
  ];

  return (
    <div className="fade-in">
      <PageHeader title="My Bookings" subtitle="Track all your booking requests" />

      {/* Stats row */}
      {bookings.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, padding: "12px 18px", textAlign: "center", minWidth: 80 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {bookings.length > 0 && (
        <div style={{ display: "flex", gap: 7, marginBottom: 18, flexWrap: "wrap" }}>
          {["All", "Pending", "Approved", "Rejected", "Cancelled"].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ padding: "6px 13px", borderRadius: 7, border: `1px solid ${filter === s ? T.accent : T.border}`, background: filter === s ? T.accentGlow : "transparent", color: filter === s ? T.accent : T.text, cursor: "pointer", fontSize: 12 }}>{s}</button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 60 }}>
          
          <h3 style={{ marginBottom: 8 }}>No bookings yet</h3>
          <p style={{ color: T.muted, fontSize: 13 }}>Browse cars and submit a booking request.</p>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...filtered].reverse().map(b => (
            <Card key={b.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{b.carName}</div>
                  <div style={{ color: T.accent, fontWeight: 700, fontSize: 16 }}>{fmt$(b.price)}</div>
                  <div style={{ color: T.muted, fontSize: 12, marginTop: 5 }}>Requested: {fmtDate(b.createdAt)}</div>
                  {b.userPhone && <div style={{ color: T.muted, fontSize: 12 }}>{b.userPhone}</div>}
                  {b.notes && <div style={{ color: T.muted, fontSize: 12 }}>{b.notes}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <Badge color={sc[b.status] || T.muted}>{b.status}</Badge>
                  {b.status === "Pending" && <Btn onClick={() => cancel(b.id)} variant="danger" size="sm">Cancel</Btn>}
                </div>
              </div>
              {b.status === "Approved" && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: T.success + "18", border: `1px solid ${T.success}44`, borderRadius: 7, fontSize: 13, color: T.success }}>
                  Approved! Please visit our showroom to complete your purchase. <br />
                  <span style={{ fontSize: 12, opacity: 0.8 }}>123 Auto Avenue, Lahore · +92 42 1234567</span>
                </div>
              )}
              {b.status === "Rejected" && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: T.danger + "18", border: `1px solid ${T.danger}44`, borderRadius: 7, fontSize: 13, color: T.danger }}>
                  This booking was rejected. Browse other available cars.
                </div>
              )}
              {b.status === "Sold" && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: T.purple + "18", border: `1px solid ${T.purple}44`, borderRadius: 7, fontSize: 13, color: T.purple }}>
                  Congratulations! This car has been marked as sold.
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── APP ROOT ───────────────────────────────────────────────────────────────
export default function App() {
  const [authPage, setAuthPage] = useState("login");
  const [user, setUser] = useState(null);
  const [navPage, setNavPage] = useState("dashboard");
  const [toastMsg, setToastMsg] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      await bootstrapCache();

      const users = load(KEYS.users, []);
      if (!users.find(u => u.email === "admin@apex.com")) {
        const hashed = await hashPassword("admin1234");
        const admin = { id: "admin001", fullName: "Apex Admin", email: "admin@apex.com", password: hashed, phone: "+92 42 1234567", cnic: "35202-1234567-1", address: "123 Auto Avenue, Lahore", avatar: null, role: "admin", createdAt: Date.now() };
        save(KEYS.users, [...users, admin]);
      }

      const session = load(KEYS.session, null);
      if (session && Date.now() <= session.expiresAt) {
        const users = load(KEYS.users, []);
        const u = users.find(x => x.id === session.userId);
        if (u) { setUser(u); setNavPage(u.role === "admin" ? "dashboard" : "browse"); }
      }

      setBooting(false);
    })();
  }, []);

  const toast = useCallback((message, type = "success") => setToastMsg({ message, type, key: Date.now() }), []);

  if (booting) {
    return (
      <>
        <InjectCSS />
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexDirection: "column" }}>
          <Spinner size={30} />
          <div style={{ color: T.muted, fontSize: 13 }}>Loading data from Google Sheet…</div>
        </div>
      </>
    );
  }

  const handleLogin = (u) => { setUser(u); setNavPage(u.role === "admin" ? "dashboard" : "browse"); };
  const handleLogout = () => { save(KEYS.session, null); setUser(null); setNavPage("login"); toast("Signed out.", "info"); };
  const handleUserUpdate = (u) => { setUser(u); };

  if (!user) {
    return (
      <>
        <InjectCSS />
        <AuthLayout>
          {authPage === "login" && <LoginPage onLogin={handleLogin} onGoSignup={() => setAuthPage("signup")} onGoForgot={() => setAuthPage("forgot")} toast={toast} />}
          {authPage === "signup" && <SignupPage onLogin={handleLogin} onGoLogin={() => setAuthPage("login")} toast={toast} />}
          {authPage === "forgot" && <ForgotPage onGoLogin={() => setAuthPage("login")} toast={toast} />}
        </AuthLayout>
        {toastMsg && <Toast key={toastMsg.key} message={toastMsg.message} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
      </>
    );
  }

  const isAdmin = user.role === "admin";

  const adminPages = {
    dashboard: <AdminDashboard user={user} />,
    inventory: <InventoryPage toast={toast} user={user} />,
    bookings: <BookingsAdminPage toast={toast} user={user} />,
    sales: <SalesPage toast={toast} user={user} />,
    customers: <CustomersPage toast={toast} user={user} />,
    employees: <EmployeesPage toast={toast} user={user} />,
    reports: <ReportsPage />,
    users: <UserMgmtPage toast={toast} user={user} />,
    logs: <ActivityLogsPage />,
    profile: <ProfilePage user={user} onUserUpdate={handleUserUpdate} toast={toast} />,
  };

  const userPages = {
    browse: <BrowseCarsPage user={user} toast={toast} />,
    mybookings: <MyBookingsPage user={user} toast={toast} />,
    profile: <ProfilePage user={user} onUserUpdate={handleUserUpdate} toast={toast} />,
  };

  const pages = isAdmin ? adminPages : userPages;
  const defaultPage = isAdmin ? "dashboard" : "browse";
  const currentPage = pages[navPage] || pages[defaultPage];

  return (
    <>
      <InjectCSS />
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar active={navPage} onNav={setNavPage} user={user} onLogout={handleLogout} />
        <main style={{ flex: 1, padding: "28px 32px", overflowY: "auto", minWidth: 0 }}>
          {currentPage}
        </main>
      </div>
      {toastMsg && <Toast key={toastMsg.key} message={toastMsg.message} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
    </>
  );
}