import { useQuery } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { isSignedIn } from "./api";
import { Workspace } from "./App";
import { Toaster } from "./components/ui/sonner";
import { ConnectMac } from "./ConnectMac";
import { SignIn } from "./SignIn";

const optionalText = z.string().min(1).optional().catch(undefined);

const workspaceSearch = z.object({
  bot: optionalText,
  group: optionalText,
  thread: optionalText,
  panel: z.enum(["details", "computer"]).optional().catch(undefined),
  view: z.literal("3d").optional().catch(undefined),
  connected: optionalText,
  connectError: optionalText,
});

export type WorkspaceSearch = z.infer<typeof workspaceSearch>;

const connectMacSearch = z.object({ code: z.string().optional().catch(undefined) });

function Root() {
  const session = useQuery({ queryKey: ["session"], queryFn: isSignedIn, staleTime: Infinity });
  if (session.data === undefined) return <div className="h-svh bg-fb-pane" />;
  if (!session.data) return <SignIn />;
  return (
    <>
      <Outlet />
      <Toaster position="bottom-right" />
    </>
  );
}

const rootRoute = createRootRoute({ component: Root });

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search) => workspaceSearch.parse(search),
  component: Workspace,
});

const connectMacRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connect-mac",
  validateSearch: (search) => connectMacSearch.parse(search),
  component: ConnectMac,
});

function parseSearch(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text));
}

function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") params.set(key, value);
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute, connectMacRoute]),
  parseSearch,
  stringifySearch,
  defaultNotFoundComponent: () => <Navigate to="/" replace />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
