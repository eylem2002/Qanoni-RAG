import { useState } from "react";
import { useGetLawChangesHistory } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

const PAGE_SIZE = 25;

function changeTypeBadge(type: string) {
  if (type === "added")
    return <Badge className="bg-emerald-100 text-emerald-800 border-0 text-xs">Added</Badge>;
  if (type === "modified")
    return <Badge className="bg-amber-100 text-amber-800 border-0 text-xs">Modified</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-0 text-xs">Removed</Badge>;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function HistoryLog() {
  const { data, isLoading, isError } = useGetLawChangesHistory();
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const allChanges = data?.changes ?? [];
  const totalPages = Math.max(1, Math.ceil(allChanges.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageChanges = allChanges.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goToPage(p: number) {
    setPage(Math.max(1, Math.min(p, totalPages)));
    setExpanded(new Set()); // collapse all when changing page
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Change History</h1>
          <p className="text-muted-foreground mt-1 md:mt-2 text-sm md:text-base">
            Complete audit trail of all law changes detected by the scraper.
          </p>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-mono bg-muted px-3 py-2 rounded-md">
            <Clock className="w-4 h-4" />
            {data?.total ?? 0} records
          </div>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-16 text-center">
          <Clock className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-destructive">Failed to load</h3>
          <p className="text-muted-foreground mt-2">
            Could not fetch change history. Check your connection or try refreshing.
          </p>
        </div>
      ) : allChanges.length === 0 ? (
        <div className="bg-muted/50 border rounded-xl p-16 text-center">
          <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold">No changes recorded yet</h3>
          <p className="text-muted-foreground mt-2">
            Change history will appear here after the scraper runs.
          </p>
        </div>
      ) : (
        <>
          <div className="border rounded-xl overflow-hidden shadow-sm bg-card divide-y">
            {pageChanges.map((change, idx) => {
              const isOpen = expanded.has(change.id);
              const hasDetail = !!(change.oldText || change.newText);

              return (
                <div
                  key={change.id}
                  data-testid={`history-row-${change.id}`}
                  className={idx % 2 === 0 ? "" : "bg-muted/10"}
                >
                  {/* Row summary — always visible, clickable to expand */}
                  <button
                    type="button"
                    onClick={() => hasDetail && toggleExpand(change.id)}
                    className={`w-full text-left p-4 flex items-start gap-4 transition-colors
                      ${hasDetail ? "hover:bg-muted/30 cursor-pointer" : "cursor-default"}
                      ${isOpen ? "bg-primary/5" : ""}`}
                    aria-expanded={isOpen}
                  >
                    {/* Left: type badge + article */}
                    <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5 w-20">
                      {changeTypeBadge(change.changeType)}
                      <span className="text-xs font-mono text-muted-foreground">
                        Art.{change.articleNumber}
                      </span>
                    </div>

                    {/* Middle: law ID + status + text preview */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-primary">
                          {change.lawId}
                        </span>
                        {change.acknowledgedAt ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            Reviewed
                          </span>
                        ) : (
                          <span className="text-xs font-medium bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                            Pending
                          </span>
                        )}
                      </div>

                      {change.newText && !isOpen && (
                        <p className="text-sm text-muted-foreground mt-1 truncate" dir="rtl">
                          {change.newText}…
                        </p>
                      )}
                      {!change.newText && change.oldText && !isOpen && (
                        <p className="text-sm text-muted-foreground line-through mt-1 truncate" dir="rtl">
                          {change.oldText}…
                        </p>
                      )}
                    </div>

                    {/* Right: date + expand chevron */}
                    <div className="shrink-0 flex items-center gap-3">
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(change.detectedAt)}
                      </p>
                      {hasDetail && (
                        <span className="text-muted-foreground">
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isOpen && (
                    <div className="px-6 pb-5 pt-1 bg-primary/5 border-t border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-1">
                        <span>
                          <span className="font-semibold text-foreground">Law:</span>{" "}
                          {change.lawId}
                        </span>
                        <span>
                          <span className="font-semibold text-foreground">Article:</span>{" "}
                          {change.articleNumber}
                        </span>
                        <span>
                          <span className="font-semibold text-foreground">Detected:</span>{" "}
                          {formatDate(change.detectedAt)}
                        </span>
                        {change.acknowledgedAt && (
                          <span>
                            <span className="font-semibold text-foreground">Reviewed:</span>{" "}
                            {formatDate(change.acknowledgedAt)}
                          </span>
                        )}
                      </div>

                      {change.oldText && (
                        <div className="rounded-lg border-l-4 border-red-400 bg-red-50 p-4">
                          <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">
                            Previous text
                          </p>
                          <p className="text-sm text-red-800 whitespace-pre-wrap leading-relaxed" dir="rtl">
                            {change.oldText}
                          </p>
                        </div>
                      )}

                      {change.newText && (
                        <div className="rounded-lg border-l-4 border-emerald-400 bg-emerald-50 p-4">
                          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">
                            New text
                          </p>
                          <p className="text-sm text-emerald-800 whitespace-pre-wrap leading-relaxed" dir="rtl">
                            {change.newText}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, allChanges.length)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-foreground">{allChanges.length}</span>
              </p>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(1)}
                  disabled={safePage === 1}
                  title="First page"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(safePage - 1)}
                  disabled={safePage === 1}
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <div className="flex items-center gap-1 px-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                    .reduce<(number | "…")[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, i) =>
                      item === "…" ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground text-sm">
                          …
                        </span>
                      ) : (
                        <Button
                          key={item}
                          variant={item === safePage ? "default" : "outline"}
                          size="icon"
                          className="h-8 w-8 text-sm"
                          onClick={() => goToPage(item as number)}
                        >
                          {item}
                        </Button>
                      )
                    )}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(safePage + 1)}
                  disabled={safePage === totalPages}
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(totalPages)}
                  disabled={safePage === totalPages}
                  title="Last page"
                >
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
