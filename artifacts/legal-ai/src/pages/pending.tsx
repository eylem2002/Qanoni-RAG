import { useState } from "react";
import {
  useGetPendingLawChanges,
  getGetPendingLawChangesQueryKey,
  useAcknowledgeLawChange,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle } from "lucide-react";

function changeTypeBadge(type: string) {
  if (type === "added") return <Badge className="bg-emerald-100 text-emerald-800 border-0 font-semibold">Added</Badge>;
  if (type === "modified") return <Badge className="bg-amber-100 text-amber-800 border-0 font-semibold">Modified</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-0 font-semibold">Removed</Badge>;
}

export default function PendingChanges() {
  const { data, isLoading, isError } = useGetPendingLawChanges();
  const queryClient = useQueryClient();
  const acknowledge = useAcknowledgeLawChange();
  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());

  function handleAcknowledge(changeId: number) {
    acknowledge.mutate(
      { changeId },
      {
        onSuccess: () => {
          setAcknowledged((prev) => new Set([...prev, changeId]));
          queryClient.invalidateQueries({ queryKey: getGetPendingLawChangesQueryKey() });
        },
      }
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Pending Reviews</h1>
          <p className="text-muted-foreground mt-2">Law amendments detected by the scraper requiring acknowledgement.</p>
        </div>
        {!isLoading && (
          <div className="text-right">
            <div className="text-3xl font-bold text-destructive" data-testid="pending-count">{data?.unreviewed ?? 0}</div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Unreviewed</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : isError ? (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-16 text-center">
          <AlertCircle className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-destructive">Failed to load</h3>
          <p className="text-muted-foreground mt-2">Could not fetch pending changes. Check your connection or try refreshing.</p>
        </div>
      ) : (data?.laws ?? []).length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-16 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-emerald-800">All caught up</h3>
          <p className="text-emerald-600 mt-2">No pending law changes require review.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {data!.laws.map((group) => (
            <div key={group.lawId} className="border rounded-xl overflow-hidden shadow-sm">
              <div className="bg-primary text-primary-foreground px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold" dir="rtl">{group.lawName}</h2>
                  <p className="text-primary-foreground/70 text-sm font-mono mt-0.5">({group.lawId})</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">{group.changesCount}</div>
                  <p className="text-primary-foreground/70 text-xs">changes</p>
                </div>
              </div>

              {group.affectedContractTypes.length > 0 && (
                <div className="bg-primary/5 px-6 py-3 border-b flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 text-primary/60 shrink-0" />
                  <div className="flex flex-wrap gap-2">
                    {group.affectedContractTypes.map((type) => (
                      <Badge key={type} variant="outline" className="text-xs font-medium" data-testid={`affected-type-${type}`}>
                        {type}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="divide-y bg-card">
                {group.details.map((change) => {
                  const isAcknowledged = acknowledged.has(change.id);
                  return (
                    <div
                      key={change.id}
                      data-testid={`change-card-${change.id}`}
                      className={`p-6 transition-opacity duration-300 ${isAcknowledged ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-bold text-muted-foreground">
                            Article {change.article}
                          </span>
                          {changeTypeBadge(change.type)}
                        </div>
                        {change.detectedAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(change.detectedAt).toLocaleDateString("en-GB")}
                          </span>
                        )}
                      </div>

                      {change.oldText && (
                        <div className="mb-3 p-4 bg-red-50 border-l-4 border-red-400 rounded-r-md">
                          <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-1">Previous text</p>
                          <p className="text-sm text-red-800 line-through dir-rtl" dir="rtl">{change.oldText}…</p>
                        </div>
                      )}

                      {change.newText && (
                        <div className="mb-4 p-4 bg-emerald-50 border-l-4 border-emerald-400 rounded-r-md">
                          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-1">New text</p>
                          <p className="text-sm text-emerald-800" dir="rtl">{change.newText}…</p>
                        </div>
                      )}

                      {!isAcknowledged && (
                        <Button
                          size="sm"
                          onClick={() => handleAcknowledge(change.id)}
                          disabled={acknowledge.isPending}
                          data-testid={`acknowledge-btn-${change.id}`}
                          className="mt-2"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Mark as reviewed
                        </Button>
                      )}
                      {isAcknowledged && (
                        <div className="flex items-center gap-2 mt-2 text-emerald-600 text-sm font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          Reviewed
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
