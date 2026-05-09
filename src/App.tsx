import { OverlayRoute } from "@/routes/Overlay";
import { SettingsRoute } from "@/routes/Settings";

function parseRoute(): "overlay" | "settings" {
  const h = window.location.hash || "";
  if (h.startsWith("#/settings")) return "settings";
  return "overlay";
}

export default function App() {
  const route = parseRoute();
  if (route === "settings") return <SettingsRoute />;
  return <OverlayRoute />;
}
