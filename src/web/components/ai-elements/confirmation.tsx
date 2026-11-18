import { cn } from "cn";
import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type ConfirmationState = "requested" | "accepted" | "rejected";

const ConfirmationContext = createContext<ConfirmationState | null>(null);

function useConfirmation(): ConfirmationState {
  const state = useContext(ConfirmationContext);
  if (state === null) throw new Error("Confirmation components must be used within Confirmation");
  return state;
}

export type ConfirmationProps = ComponentProps<typeof Alert> & { state?: ConfirmationState };

export const Confirmation = ({ className, state = "requested", ...props }: ConfirmationProps) => (
  <ConfirmationContext.Provider value={state}>
    <Alert className={cn("fb-bubble my-1 flex flex-col gap-2 self-start border-0 bg-fb-control p-4 text-fb-text ring-1 ring-fb-action/50", className)} {...props} />
  </ConfirmationContext.Provider>
);

export type ConfirmationLabelProps = ComponentProps<"span"> & { icon: ReactNode };

export const ConfirmationLabel = ({ className, icon, children, ...props }: ConfirmationLabelProps) => (
  <span className={cn("fb-caption flex items-center gap-1.5 font-semibold text-fb-control-text", className)} {...props}>
    {icon}
    {children}
  </span>
);

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>;

export const ConfirmationTitle = ({ className, ...props }: ConfirmationTitleProps) => (
  <AlertDescription className={cn("text-[15px] leading-5 font-semibold text-fb-text [overflow-wrap:anywhere]", className)} {...props} />
);

export const ConfirmationRequest = ({ children }: { children?: ReactNode }) => (useConfirmation() === "requested" ? children : null);

export const ConfirmationAccepted = ({ children }: { children?: ReactNode }) => (useConfirmation() === "accepted" ? children : null);

export const ConfirmationRejected = ({ children }: { children?: ReactNode }) => (useConfirmation() === "rejected" ? children : null);

export type ConfirmationActionsProps = ComponentProps<"div">;

export const ConfirmationActions = ({ className, ...props }: ConfirmationActionsProps) =>
  useConfirmation() === "requested" ? <div className={cn("mt-1 flex flex-wrap gap-2", className)} {...props} /> : null;

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = (props: ConfirmationActionProps) => <Button size="sm" type="button" {...props} />;
