import { useState } from "react";
import { Scale } from "lucide-react";

interface LoginProps {
  onLogin: (password: string) => Promise<boolean>;
}

export default function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const ok = await onLogin(password);
    setLoading(false);
    if (!ok) {
      setError("كلمة المرور غير صحيحة. حاول مجدداً.");
      setPassword("");
    }
  }

  return (
    <div className="min-h-[100dvh] bg-sidebar flex items-center justify-center" dir="rtl">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-sidebar-accent flex items-center justify-center mb-4">
            <Scale className="w-7 h-7 text-sidebar-primary" />
          </div>
          <h1 className="text-2xl font-bold text-sidebar-primary">Qanooni AI</h1>
          <p className="text-sm text-sidebar-foreground/60 mt-1 font-mono uppercase tracking-wider">
            Operations Command
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-sidebar-foreground mb-1.5">
              كلمة المرور
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoFocus
              required
              className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-sidebar-foreground placeholder:text-sidebar-foreground/30 text-sm focus:outline-none focus:ring-2 focus:ring-sidebar-primary/50"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 px-4 rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "جارٍ التحقق..." : "دخول"}
          </button>
        </form>

        <p className="text-center text-xs text-sidebar-foreground/30 mt-6">
          للوصول المصرح به فقط — Authorized access only
        </p>
      </div>
    </div>
  );
}
