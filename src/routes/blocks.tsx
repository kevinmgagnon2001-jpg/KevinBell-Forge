import { createFileRoute } from "@tanstack/react-router";
import { BlocksGame } from "@/components/blocks/BlocksGame";

/** Blocks on its own page: /blocks. No 3D world, no model; just the game. */
export const Route = createFileRoute("/blocks")({
  head: () => ({ meta: [{ title: "Blocks" }, { name: "theme-color", content: "#10162f" }] }),
  component: BlocksPage,
});

function BlocksPage() {
  return <BlocksGame />;
}
