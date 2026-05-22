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
import {
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

const PAGE_SIZE = 10;

function changeTypeBadge(type: string) {
  if (type === "added")
    return <Badge className="bg-emerald-100 text-emerald-800 border-0 font-semibold">Added</Badge>;
  if (type === "modified")
    return <Badge className="bg-amber-100 text-amber-800 border-0 font-semibold">Modified</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-0 font-semibold">Removed</Badge>;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const PREVIEW_CHARS = 160;

interface TextBlockProps {
  label: string;
  text: string;
  variant: "old" | "new";
  expanded: boolean;
  onToggle: () => void;
}

function TextBlock({ label, text, variant, expanded, onToggle }: TextBlockProps) {
  const isTruncated = text.length > PREVIEW_CHARS;
  const displayed = expanded || !isTruncated ? text : text.slice(0, PREVIEW_CHARS) + "…";

  const colors =
    variant === "old"
      ? {
          border: "border-red-400",
          bg: "bg-red-50",
          label: "text-red-700",
          body: "text-red-800",
          btn: "text-red-600 hover:text-red-800",
        }
      : {
          border: "border-emerald-400",
          bg: "bg-emerald-50",
          label: "text-emerald-700",
          body: "text-emerald-800",
          btn: "text-emerald-600 hover:text-emerald-800",
        };

  return (
    <div className={`rounded-r-md border-l-4 ${colors.border} ${colors.bg} p-4`}>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${colors.label}`}>
        {label}
      </p>
      <p
        className={`text-sm whitespace-pre-wrap leading-relaxed ${colors.body} ${variant === "old" ? "line-through" : ""}`}
        dir="rtl"
      >
        {displayed}
      </p>
      {isTruncated && (
        <button
          type="button"
          onClick={onToggle}
          className={`mt-2 flex items-center gap-1 text-xs font-semibold ${colors.btn} transition-colors`}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Read full text
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default function PendingChanges() {
  const { data, isLoading, isError } = useGetPendingLawChanges();
  const queryClient = useQueryClient();
  const acknowledge = useAcknowledgeLawChange();

  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());

  // Flatten all change details from every law group into one list
  const allChanges = (data?.laws ?? []).flatMap((group) =>
    group.details.map((change) => ({
      ...change,
      lawId: group.lawId,
      lawName: group.lawName,
      affectedContractTypes: group.affectedContractTypes,
    }))
  );

  const totalPages = Math.max(1, Math.ceil(allChanges.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageChanges = allChanges.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function goToPage(p: number) {
    setPage(Math.max(1, Math.min(p, totalPages)));
    setExpandedText(new Set()); // reset expanded text on page change
  }

  function toggleText(key: string) {
    setExpandedText((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Pending Reviews</h1>
          <p className="text-muted-foreground mt-2">
            Law amendments detected by the scraper requiring acknowledgement.
          </p>
        </div>
        {!isLoading && (
          <div className="text-right">
            <div className="text-3xl font-bold text-destructive" data-testid="pending-count">
              {data?.unreviewed ?? 0}
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Unreviewed</p>
          </div>
        )}
      </div>

      {/* States */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-16 text-center">
          <AlertCircle className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-destructive">Failed to load</h3>
          <p className="text-muted-foreground mt-2">
            Could not fetch pending changes. Check your connection or try refreshing.
          </p>
        </div>
      ) : allChanges.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-16 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-emerald-800">All caught up</h3>
          <p className="text-emerald-600 mt-2">No pending law changes require review.</p>
        </div>
      ) : (
        <>
          {/* Change cards */}
          <div className="space-y-4">
            {pageChanges.map((change) => {
              const isAcknowledged = acknowledged.has(change.id);
              const oldKey = `${change.id}-old`;
              const newKey = `${change.id}-new`;

              return (
                <div
                  key={change.id}
                  data-testid={`change-card-${change.id}`}
                  className={`border rounded-xl overflow-hidden shadow-sm bg-card transition-opacity duration-300 ${
                    isAcknowledged ? "opacity-40" : ""
                  }`}
                >
                  {/* Card header: law name + change info */}
                  <div className="bg-primary/5 border-b px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-primary" dir="rtl">
                        {change.lawName}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        ({change.lawId})
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        Article {change.article}
                      </span>
                      {changeTypeBadge(change.type)}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {change.affectedContractTypes.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
                          {change.affectedContractTypes.map((t) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className="text-xs"
                              data-testid={`affected-type-${t}`}
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(change.detectedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Text blocks */}
                  <div className="p-5 space-y-3">
                    {change.oldText && (
                      <TextBlock
                        label="Previous text"
                        text={change.oldText}
                        variant="old"
                        expanded={expandedText.has(oldKey)}
                        onToggle={() => toggleText(oldKey)}
                      />
                    )}
                    {change.newText && (
                      <TextBlock
                        label="New text"
                        text={change.newText}
                        variant="new"
                        expanded={expandedText.has(newKey)}
                        onToggle={() => toggleText(newKey)}
                      />
                    )}

                    {!isAcknowledged ? (
                      <Button
                        size="sm"
                        onClick={() => handleAcknowledge(change.id)}
                        disabled={acknowledge.isPending}
                        data-testid={`acknowledge-btn-${change.id}`}
                        className="mt-1"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Mark as reviewed
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2 mt-1 text-emerald-600 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Reviewed
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, allChanges.length)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-foreground">{allChanges.length}</span> changes
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
                        <span
                          key={`ellipsis-${i}`}
                          className="px-1 text-muted-foreground text-sm"
                        >
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
