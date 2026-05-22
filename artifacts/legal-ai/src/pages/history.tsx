import { useGetLawChangesHistory } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, CheckCircle2 } from "lucide-react";

function changeTypeBadge(type: string) {
  if (type === "added") return <Badge className="bg-emerald-100 text-emerald-800 border-0 text-xs">Added</Badge>;
  if (type === "modified") return <Badge className="bg-amber-100 text-amber-800 border-0 text-xs">Modified</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-0 text-xs">Removed</Badge>;
}

export default function HistoryLog() {
  const { data, isLoading } = useGetLawChangesHistory();

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Change History</h1>
          <p className="text-muted-foreground mt-2">Complete audit trail of all law changes detected by the scraper.</p>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-mono bg-muted px-3 py-2 rounded-md">
            <Clock className="w-4 h-4" />
            {data?.total ?? 0} records
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (data?.changes ?? []).length === 0 ? (
        <div className="bg-muted/50 border rounded-xl p-16 text-center">
          <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold">No changes recorded yet</h3>
          <p className="text-muted-foreground mt-2">Change history will appear here after the scraper runs.</p>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden shadow-sm divide-y bg-card">
          {data!.changes.map((change, idx) => (
            <div
              key={change.id}
              data-testid={`history-row-${change.id}`}
              className={`p-4 flex items-start gap-4 transition-colors hover:bg-muted/30 ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
            >
              <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                {changeTypeBadge(change.changeType)}
                <span className="text-xs font-mono text-muted-foreground">Art.{change.articleNumber}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold text-primary">{change.lawId}</span>
                  {change.acknowledgedAt ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      Reviewed
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground font-medium bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">Pending</span>
                  )}
                </div>

                {change.newText && (
                  <p className="text-sm text-muted-foreground mt-1 truncate" dir="rtl">{change.newText}…</p>
                )}
                {!change.newText && change.oldText && (
                  <p className="text-sm text-muted-foreground line-through mt-1 truncate" dir="rtl">{change.oldText}…</p>
                )}
              </div>

              <div className="shrink-0 text-right">
                {change.detectedAt && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(change.detectedAt).toLocaleDateString("en-GB")}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
