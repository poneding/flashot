import { AboutRoute } from "@/routes/About";
import { OverlayRoute } from "@/routes/Overlay";
import { PinRoute } from "@/routes/Pin";
import { SettingsRoute } from "@/routes/Settings";
import { UpdaterRoute } from "@/routes/Updater";

function parseRoute(): "about" | "overlay" | "pin" | "settings" | "updater" {
  const h = window.location.hash || "";
  if (h.startsWith("#/about")) return "about";
  if (h.startsWith("#/settings")) return "settings";
  if (h.startsWith("#/updater")) return "updater";
  if (h.startsWith("#/pin/")) return "pin";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "about") return <AboutRoute />;
  if (route === "settings") return <SettingsRoute />;
  if (route === "updater") return <UpdaterRoute />;
  if (route === "pin") return <PinRoute />;
  return <OverlayRoute />;
}
