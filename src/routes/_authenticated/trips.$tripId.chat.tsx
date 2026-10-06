import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TripChat } from "@/components/trip-chat";
import { messagesQueryOptions } from "@/lib/messages";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { checkinsQueryOptions } from "@/lib/checkins";
import { useT } from "@/i18n";

const searchSchema = z.object({}).optional();

export const Route = createFileRoute("/_authenticated/trips/$tripId/chat")({
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    context.queryClient.ensureQueryData(messagesQueryOptions(params.tripId));
    context.queryClient.ensureQueryData(tripMembersQueryOptions(params.tripId));
    context.queryClient.ensureQueryData(checkinsQueryOptions(params.tripId));
  },
  component: ChatPage,
  errorComponent: ({ error }) => (
    <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
      {(error as Error).message}
    </div>
  ),
  notFoundComponent: () => {
    const t = useT();
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("chat.notFound")}
      </div>
    );
  },
});

function ChatPage() {
  const { tripId } = Route.useParams();
  return <TripChat tripId={tripId} />;
}
