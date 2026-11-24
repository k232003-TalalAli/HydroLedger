interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`rounded-card bg-[linear-gradient(90deg,#161616_0%,#2A2A2A_50%,#161616_100%)] bg-[length:200%_100%] animate-shimmer ${className}`}
      aria-hidden="true"
    />
  );
}
