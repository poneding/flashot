import { AboutRoute } from "@/routes/About";
import { OverlayRoute } from "@/routes/Overlay";
import { PinRoute } from "@/routes/Pin";
import { ScrollChromeRoute } from "@/routes/ScrollChrome";
import { SettingsRoute } from "@/routes/Settings";
import { UpdaterRoute } from "@/routes/Updater";

function parseRoute(): "about" | "overlay" | "pin" | "scroll-chrome" | "settings" | "updater" {
  const h = window.location.hash || "";
  if (h.startsWith("#/about")) return "about";
  if (h.startsWith("#/settings")) return "settings";
  if (h.startsWith("#/updater")) return "updater";
  if (h.startsWith("#/pin/")) return "pin";
  if (h.startsWith("#/scroll-chrome/")) return "scroll-chrome";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "about") return <AboutRoute />;
  if (route === "settings") return <SettingsRoute />;
  if (route === "updater") return <UpdaterRoute />;
  if (route === "pin") return <PinRoute />;
  if (route === "scroll-chrome") return <ScrollChromeRoute />;
  return <OverlayRoute />;
}
