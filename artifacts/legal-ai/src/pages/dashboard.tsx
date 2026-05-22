import {
  useGetStoredLaws,
  useGetPendingLawChanges,
  useHealthCheck,
  useGetSyncStatus,
  useTriggerSync,
  getGetSyncStatusQueryKey,
  getGetStoredLawsQueryKey,
  getGetPendingLawChangesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Scale, Activity, CheckCircle2, ShieldAlert, RefreshCw, XCircle, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 flex items-center gap-3 text-sm text-destructive">
      <XCircle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: lawsData, isLoading: isLoadingLaws, isError: isErrorLaws } = useGetStoredLaws();
  const { data: pendingData, isLoading: isLoadingPending, isError: isErrorPending } = useGetPendingLawChanges();
  const { data: healthData, isLoading: isLoadingHealth } = useHealthCheck();
  const { data: syncStatus, isLoading: isLoadingSync } = useGetSyncStatus({
    query: { refetchInterval: 5000, queryKey: getGetSyncStatusQueryKey() },
  });
  const triggerSync = useTriggerSync();

  const totalLaws = lawsData?.total || 0;
  const pendingCount = pendingData?.unreviewed || 0;
  const systemStatus = healthData?.status === "ok" ? "Operational" : "Degraded";
  const syncInProgress = syncStatus?.inProgress ?? false;

  function handleSync() {
    triggerSync.mutate(undefined, {
      onSuccess: (data) => {
        if (data.queued) {
          toast({ title: "Sync started", description: "Law sync is running in the background." });
          // Invalidate sync status so the spinner reflects inProgress=true quickly
          void queryClient.invalidateQueries({ queryKey: getGetSyncStatusQueryKey() });
        } else {
          toast({ title: "Already syncing", description: data.message, variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Sync failed", description: "Could not start sync. Check server logs.", variant: "destructive" });
      },
    });
  }

  // When sync finishes (inProgress flips false), refresh laws + pending
  const prevInProgress = syncStatus?.inProgress;
  if (prevInProgress === false && syncStatus?.lastSyncAt) {
    void queryClient.invalidateQueries({ queryKey: getGetStoredLawsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetPendingLawChangesQueryKey() });
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Overview of Qanooni AI's legal intelligence system.</p>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Button
            onClick={handleSync}
            disabled={syncInProgress || triggerSync.isPending}
            size="sm"
            className="gap-2"
            data-testid="sync-now-btn"
          >
            <RefreshCw className={`w-4 h-4 ${syncInProgress ? "animate-spin" : ""}`} />
            {syncInProgress ? "Syncing…" : "Sync Now"}
          </Button>

          {!isLoadingSync && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>
                Last sync:{" "}
                <span
                  className={syncStatus?.lastSyncStatus === "error" ? "text-destructive font-medium" : ""}
                  data-testid="last-sync-time"
                >
                  {formatRelativeTime(syncStatus?.lastSyncAt)}
                </span>
                {syncStatus?.lastSyncStatus === "error" && (
                  <span className="text-destructive ml-1">(failed)</span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-l-4 border-l-primary shadow-sm hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Total Stored Laws
            </CardTitle>
            <Scale className="w-5 h-5 text-muted-foreground/50" />
          </CardHeader>
          <CardContent>
            {isLoadingLaws ? (
              <Skeleton className="h-10 w-24" />
            ) : isErrorLaws ? (
              <div className="text-destructive text-sm flex items-center gap-2"><XCircle className="w-4 h-4" /> Error loading</div>
            ) : (
              <div className="text-4xl font-bold tracking-tighter" data-testid="stat-total-laws">{totalLaws}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Actively monitored in DB</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-destructive shadow-sm hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Pending Reviews
            </CardTitle>
            <AlertCircle className="w-5 h-5 text-destructive/50" />
          </CardHeader>
          <CardContent>
            {isLoadingPending ? (
              <Skeleton className="h-10 w-24" />
            ) : isErrorPending ? (
              <div className="text-destructive text-sm flex items-center gap-2"><XCircle className="w-4 h-4" /> Error loading</div>
            ) : (
              <div className="text-4xl font-bold tracking-tighter text-destructive" data-testid="stat-pending-reviews">{pendingCount}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Amendments requiring attention</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-600 shadow-sm hover-elevate transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              System Status
            </CardTitle>
            <Activity className="w-5 h-5 text-emerald-600/50" />
          </CardHeader>
          <CardContent>
            {isLoadingHealth ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <div className="flex items-center gap-2" data-testid="stat-system-status">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                <span className="text-2xl font-bold tracking-tight">{systemStatus}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Scraper & API operational</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <ShieldAlert className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Priority Action Items</h2>
          </div>
          {isLoadingPending ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : isErrorPending ? (
            <ErrorCard message="Could not load pending reviews. Check your connection." />
          ) : pendingCount > 0 ? (
            <div className="bg-card border rounded-lg overflow-hidden divide-y">
              {pendingData?.laws.slice(0, 3).map((law) => (
                <div key={law.lawId} className="p-4 flex justify-between items-center bg-destructive/5">
                  <div>
                    <h3 className="font-semibold text-sm" dir="rtl">{law.lawName}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{law.changesCount} unreviewed changes</p>
                  </div>
                  <Link href="/pending" className="text-sm font-medium text-primary hover:underline px-3 py-1.5 bg-background border rounded-md shadow-sm">
                    Review
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <p className="font-medium text-emerald-800">All caught up</p>
              <p className="text-sm text-emerald-600 mt-1">No pending law changes require review.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <Scale className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Recently Monitored Laws</h2>
          </div>
          {isLoadingLaws ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : isErrorLaws ? (
            <ErrorCard message="Could not load law registry. Check your connection." />
          ) : (
            <div className="bg-card border rounded-lg overflow-hidden divide-y">
              {lawsData?.laws.slice(0, 4).map((law) => (
                <div key={law.id} className="p-3 px-4 flex justify-between items-center hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col gap-1 items-start">
                    <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">{law.lawId}</span>
                    <span className="font-medium text-sm text-right w-full" dir="rtl">{law.arabicName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
