import { AboutRoute } from "@/routes/About";
import { OverlayRoute } from "@/routes/Overlay";
import { SettingsRoute } from "@/routes/Settings";
import { UpdaterRoute } from "@/routes/Updater";

function parseRoute(): "about" | "overlay" | "settings" | "updater" {
  const h = window.location.hash || "";
  if (h.startsWith("#/about")) return "about";
  if (h.startsWith("#/settings")) return "settings";
  if (h.startsWith("#/updater")) return "updater";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "about") return <AboutRoute />;
  if (route === "settings") return <SettingsRoute />;
  if (route === "updater") return <UpdaterRoute />;
  return <OverlayRoute />;
}
