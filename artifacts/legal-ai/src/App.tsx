import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Scale, Clock, AlertCircle, LayoutDashboard, LogOut } from "lucide-react";
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

function Sidebar({ onLogout }: { onLogout: () => void }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/pending", label: "Pending Reviews", icon: AlertCircle },
    { href: "/laws", label: "Law Registry", icon: Scale },
    { href: "/history", label: "Change History", icon: Clock },
  ];

  return (
    <div className="w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border min-h-[100dvh] flex flex-col">
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight text-sidebar-primary">Qanooni AI</h1>
        <p className="text-xs text-sidebar-primary/70 mt-1 uppercase tracking-wider font-mono">Operations Command</p>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
              }`}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border mt-auto">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center font-bold text-xs">
            AD
          </div>
          <div className="text-sm flex-1 min-w-0">
            <p className="font-medium">Admin User</p>
            <p className="text-xs text-sidebar-foreground/60">Legal Team</p>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  return (
    <div className="flex min-h-[100dvh] bg-background">
      <Sidebar onLogout={onLogout} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
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
