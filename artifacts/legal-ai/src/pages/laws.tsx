import { useGetStoredLaws } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, ExternalLink, CheckCircle2, XCircle } from "lucide-react";

export default function LawsList() {
  const { data, isLoading, isError } = useGetStoredLaws();

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Law Registry</h1>
          <p className="text-muted-foreground mt-1 md:mt-2 text-sm md:text-base">All Jordanian laws currently stored and monitored in the system.</p>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-mono bg-muted px-3 py-2 rounded-md">
            <Scale className="w-4 h-4" />
            {data?.total ?? 0} laws
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-16 text-center">
          <Scale className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-destructive">Failed to load</h3>
          <p className="text-muted-foreground mt-2">Could not fetch the law registry. Check your connection or try refreshing.</p>
        </div>
      ) : (data?.laws ?? []).length === 0 ? (
        <div className="bg-muted/50 border rounded-xl p-16 text-center">
          <Scale className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold">No laws stored yet</h3>
          <p className="text-muted-foreground mt-2">The scraper will populate this registry on its next run.</p>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden shadow-sm divide-y bg-card">
          {data!.laws.map((law) => (
            <div
              key={law.id}
              data-testid={`law-row-${law.id}`}
              className="p-4 md:p-5 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="shrink-0 text-center">
                  <div className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                    {law.lawId}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{law.year}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base text-right truncate" dir="rtl">{law.arabicName}</p>
                  {law.englishName && (
                    <p className="text-sm text-muted-foreground truncate mt-0.5">{law.englishName}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                {law.articleCount != null && (
                  <div className="text-right hidden sm:block">
                    <div className="text-lg font-bold">{law.articleCount}</div>
                    <div className="text-xs text-muted-foreground">articles</div>
                  </div>
                )}

                <div className="text-right hidden md:block">
                  <div className="text-xs text-muted-foreground">Last updated</div>
                  <div className="text-sm font-medium">
                    {new Date(law.lastUpdated).toLocaleDateString("en-GB")}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {law.isActive ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1" data-testid={`law-active-${law.id}`}>
                      <CheckCircle2 className="w-3 h-3" />
                      Active
                    </Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground border-0 gap-1">
                      <XCircle className="w-3 h-3" />
                      Inactive
                    </Badge>
                  )}
                  {law.lobGovUrl && (
                    <a
                      href={law.lobGovUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                      data-testid={`law-link-${law.id}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
