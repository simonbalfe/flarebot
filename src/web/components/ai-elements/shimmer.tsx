import { cn } from "cn";
import type { CSSProperties, ElementType } from "react";

export interface ShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

export const Shimmer = ({ children, as: Component = "span", className, duration = 2, spread = 2 }: ShimmerProps) => {
  const style = { "--fb-shimmer-spread": `${children.length * spread}px`, "--fb-shimmer-duration": `${duration}s` } as CSSProperties;
  return (
    <Component className={cn("fb-shimmer", className)} style={style}>
      {children}
    </Component>
  );
};
