import { AboutRoute } from "@/routes/About";
import { CaptureFocusRoute } from "@/routes/CaptureFocus";
import { OverlayRoute } from "@/routes/Overlay";
import { PinRoute } from "@/routes/Pin";
import { ScrollChromeRoute } from "@/routes/ScrollChrome";
import { SettingsRoute } from "@/routes/Settings";
import { UpdaterRoute } from "@/routes/Updater";

function parseRoute():
  | "about"
  | "capture-focus"
  | "overlay"
  | "pin"
  | "scroll-chrome"
  | "settings"
  | "updater" {
  const h = window.location.hash || "";
  if (h.startsWith("#/about")) return "about";
  if (h.startsWith("#/capture-focus")) return "capture-focus";
  if (h.startsWith("#/settings")) return "settings";
  if (h.startsWith("#/updater")) return "updater";
  if (h.startsWith("#/pin/")) return "pin";
  if (h.startsWith("#/scroll-chrome/")) return "scroll-chrome";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "about") return <AboutRoute />;
  if (route === "capture-focus") return <CaptureFocusRoute />;
  if (route === "settings") return <SettingsRoute />;
  if (route === "updater") return <UpdaterRoute />;
  if (route === "pin") return <PinRoute />;
  if (route === "scroll-chrome") return <ScrollChromeRoute />;
  return <OverlayRoute />;
}
