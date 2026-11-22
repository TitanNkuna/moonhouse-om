import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Desk } from "@/components/desk";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { isPending } = useCurrentUserState();
  if (isPending) {
    return <main className="grid min-h-screen place-items-center px-6 text-muted">Loading…</main>;
  }
  return (
    <>
      <SignedIn>
        <Desk />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
