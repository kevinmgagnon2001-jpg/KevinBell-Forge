import { createFileRoute } from "@tanstack/react-router";
import { ForgeApp } from "@/components/forge/ForgeApp";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <ForgeApp />;
}
