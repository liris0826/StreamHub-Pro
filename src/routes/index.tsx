import { createFileRoute } from "@tanstack/react-router";
import { VideoOff } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "No Video Link Found" },
      { name: "description", content: "No video link was provided." },
      { property: "og:title", content: "No Video Link Found" },
      { property: "og:description", content: "No video link was provided." },
    ],
  }),
  component: Index,
});

export function NoVideo() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <VideoOff className="h-12 w-12 text-muted-foreground" />
      <h1 className="font-display text-2xl">No Video Link Found</h1>
    </main>
  );
}

function Index() {
  return <NoVideo />;
}
