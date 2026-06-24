import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { installGlobalContextMenuBlocker } from "./lib/context-menu";
import "./styles/globals.css";
import "./styles/fonts.css";

installGlobalContextMenuBlocker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
