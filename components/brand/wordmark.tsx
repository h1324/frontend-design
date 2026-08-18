// The EPE Foam wordmark. The mark is a closed-cell grid — the literal structure of expanded
// polyethylene foam — set in the brand green; the name is in the display face.

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-[7px] bg-foreground">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="none">
          {[0, 6.5, 13].map((y) =>
            [0, 6.5, 13].map((x) => (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width="5"
                height="5"
                rx="1.4"
                fill="hsl(168 64% 46%)"
                opacity={(x + y) % 13 === 0 ? 1 : 0.62}
              />
            )),
          )}
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-sm font-extrabold tracking-tight text-foreground">
          EPE FOAM
        </span>
        <span className="eyebrow mt-0.5 !tracking-[0.2em] text-[0.5625rem]">
          Operations
        </span>
      </span>
    </div>
  );
}
