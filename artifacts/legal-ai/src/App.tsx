import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Scale, Clock, AlertCircle, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { setAuthHeader } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import PendingChanges from "@/pages/pending";
import LawsList from "@/pages/laws";
import HistoryLog from "@/pages/history";
import Login from "@/pages/login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if (error && typeof error === "object" && "status" in error) {
          const status = (error as { status: number }).status;
          if (status === 401 || status === 403) return false;
        }
        return failureCount < 2;
      },
    },
  },
});

const SESSION_KEY = "qanooni_admin_auth";

function makeBasicHeader(password: string): string {
  return "Basic " + btoa(`admin:${password}`);
}

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pending", label: "Pending Reviews", icon: AlertCircle },
  { href: "/laws", label: "Law Registry", icon: Scale },
  { href: "/history", label: "Change History", icon: Clock },
];

function SidebarContent({ onLogout, onNavigate }: { onLogout: () => void; onNavigate?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="p-6 shrink-0">
        <h1 className="text-xl font-bold tracking-tight text-sidebar-primary">Qanooni AI</h1>
        <p className="text-xs text-sidebar-primary/70 mt-1 uppercase tracking-wider font-mono">
          Operations Command
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 space-y-1 mt-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
              }`}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border mt-auto shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center font-bold text-xs shrink-0">
            AD
          </div>
          <div className="text-sm flex-1 min-w-0">
            <p className="font-medium">Admin User</p>
            <p className="text-xs text-sidebar-foreground/60">Legal Team</p>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors p-1"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change
  const [location] = useLocation();
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* ── Desktop sidebar ───────────────────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col min-h-[100dvh]">
        <SidebarContent onLogout={onLogout} />
      </aside>

      {/* ── Mobile overlay backdrop ────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer ─────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col
          transform transition-transform duration-200 ease-in-out md:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <SidebarContent onLogout={onLogout} onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 bg-background border-b px-4 py-3 flex items-center gap-3 shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="text-foreground/60 hover:text-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm tracking-tight text-foreground">Qanooni AI</span>
        </header>

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

function Router({ onLogout }: { onLogout: () => void }) {
  return (
    <Layout onLogout={onLogout}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/pending" component={PendingChanges} />
        <Route path="/laws" component={LawsList} />
        <Route path="/history" component={HistoryLog} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      setAuthHeader(stored);
      return true;
    }
    return false;
  });

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) setAuthHeader(stored);
  }, []);

  const handleLogin = useCallback(async (password: string): Promise<boolean> => {
    const header = makeBasicHeader(password);
    setAuthHeader(header);
    try {
      const res = await fetch("/api/admin/law-changes/laws", {
        headers: { Authorization: header },
      });
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, header);
        queryClient.clear();
        setAuthenticated(true);
        return true;
      }
    } catch {
      // network error
    }
    setAuthHeader(null);
    return false;
  }, []);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setAuthHeader(null);
    queryClient.clear();
    setAuthenticated(false);
  }, []);

  if (!authenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <Login onLogin={handleLogin} />
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router onLogout={handleLogout} />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
