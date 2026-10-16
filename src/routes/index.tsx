import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ForgeApp } from "@/components/forge/ForgeApp";
import { BlocksGame } from "@/components/blocks/BlocksGame";

export const Route = createFileRoute("/")({
  component: Home,
});

type Launch = "forge" | "blocks";
type LaunchWindow = { ForgeAndroid?: { launchedAs?: () => string }; __forgeLaunch?: (which: string) => void };

/**
 * Forge, or Blocks on its own: the Android app's Blocks icon (MainActivity.kt, launchedAs) or
 * ?app=blocks opens straight into the game, and the 3D world, the model and the rest never load.
 * Tapping the other icon while it runs switches over (window.__forgeLaunch).
 */
function Home() {
  // Decided on the device, so the server render and the first client render agree.
  const [launch, setLaunch] = useState<Launch | null>(null);
  useEffect(() => {
    const w = window as unknown as LaunchWindow;
    let asked = "";
    try {
      asked = w.ForgeAndroid?.launchedAs?.() ?? "";
    } catch {
      asked = "";
    }
    if (new URLSearchParams(window.location.search).get("app") === "blocks") asked = "blocks";
    setLaunch(asked === "blocks" ? "blocks" : "forge");
    w.__forgeLaunch = (which) => setLaunch(which === "blocks" ? "blocks" : "forge");
    return () => {
      w.__forgeLaunch = undefined;
    };
  }, []);
  if (launch === "blocks") return <BlocksGame />;
  if (launch === "forge") return <ForgeApp />;
  return <div className="boot" style={{ minHeight: "100dvh", background: "#09090b" }} />;
}
