// Self-hosted, so a MUSE on a home server needs no connection to Google
import "@fontsource/inter/300.css"
import "@fontsource/inter/600.css"
import "@fontsource/inter/800.css"
import "@fontsource/roboto-mono/400.css"
import * as Sentry from "@sentry/browser"
import { configure } from "mobx"
import { createRoot } from "react-dom/client"
import { App } from "./components/App/App"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
})

configure({
  enforceActions: "never",
})

const root = createRoot(document.querySelector("#root")!)
root.render(<App />)

if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    // Relative to the document, so MUSE also works when it is hosted under a
    // sub path such as https://example.com/muse/
    const base = new URL("./", document.baseURI)
    navigator.serviceWorker
      .register(new URL("service-worker.js", base).href, {
        scope: base.pathname,
      })
      .then((registration) => {
        console.log("SW registered: ", registration)
      })
      .catch((registrationError) => {
        console.log("SW registration failed: ", registrationError)
      })
  })
}
