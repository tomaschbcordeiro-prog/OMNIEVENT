/** Shown at once while a page's data loads on the server, so a slow first load never looks frozen. */
export function PageSkeleton({ variant = "list" }: { variant?: "list" | "detail" | "grid" }) {
  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8" aria-busy="true" aria-label="Loading">
      <div className="map-progress fixed inset-x-0 top-0 z-50" aria-hidden />
      <div className="skeleton h-4 w-40" aria-hidden />
      <div className="skeleton mt-4 h-10 w-[min(520px,80%)]" aria-hidden />
      <div className="skeleton mt-3 h-4 w-[min(640px,90%)]" aria-hidden />
      {variant === "detail" ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]" aria-hidden>
          <div className="grid gap-4">
            <div className="skeleton aspect-[16/7] w-full rounded-[var(--radius-l)]" />
            <div className="skeleton h-6 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-32 w-full" />
          </div>
          <div className="skeleton h-64 rounded-[var(--radius-l)]" />
        </div>
      ) : variant === "grid" ? (
        <div className="mt-8 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-[var(--radius-m)]" />)}
        </div>
      ) : (
        <div className="mt-8 grid gap-3" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton h-12 w-12 rounded-[var(--radius-s)]" />
              <div className="flex-1 grid gap-2">
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
