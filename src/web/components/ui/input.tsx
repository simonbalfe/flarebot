import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const inputVariants = cva(
  "w-full min-w-0 border-0 bg-secondary text-foreground ring-1 ring-border transition-colors outline-none placeholder:text-fb-faint focus-visible:ring-[1.5px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-destructive",
  {
    variants: {
      size: {
        default: "h-9 rounded-lg px-3 text-base",
        sm: "h-6.5 rounded-md px-2 text-xs",
      },
    },
    defaultVariants: { size: "default" },
  }
)

function Input({ className, size, ...props }: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return <input data-slot="input" className={cn(inputVariants({ size }), className)} {...props} />
}

export { Input }
