import { AboutRoute } from "@/routes/About";
import { OverlayRoute } from "@/routes/Overlay";
import { SettingsRoute } from "@/routes/Settings";

function parseRoute(): "about" | "overlay" | "settings" {
  const h = window.location.hash || "";
  if (h.startsWith("#/about")) return "about";
  if (h.startsWith("#/settings")) return "settings";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "about") return <AboutRoute />;
  if (route === "settings") return <SettingsRoute />;
  return <OverlayRoute />;
}
