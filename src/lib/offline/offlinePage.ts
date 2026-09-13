/**
 * The page the service worker answers with when a screen was never saved and
 * there is no network.
 *
 * Entirely self-contained: the app's stylesheet is a hashed build file and the
 * page may be the first thing loaded offline, so nothing here may reference
 * another URL. The colours are copied from `_tokens.scss` for the same reason —
 * there is no stylesheet to read them from.
 */
export function offlinePageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>Offline — PnL Tracker</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    box-sizing: border-box; background: #0b0d10; color: #e8eaed;
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; text-align: center; }
  .mark { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 8px;
    background: #2dd4a7; color: #0b0d10; font-weight: 600; font-size: 20px; }
  h1 { margin: 16px 0 8px; font-size: 20px; font-weight: 600; }
  p { margin: 0 0 20px; color: #9aa4b2; }
  button { padding: 8px 16px; border: 0; border-radius: 6px; background: #2dd4a7; color: #0b0d10;
    font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <span class="mark" aria-hidden="true">¥</span>
  <h1>You’re offline</h1>
  <p>This screen hasn’t been saved on this device yet. Screens are saved each time you open them with a connection.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`
}
