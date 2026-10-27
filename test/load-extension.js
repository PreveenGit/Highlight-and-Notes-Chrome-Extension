// Development only. With ?stub in the page URL, runs the extension's content
// scripts (the list in manifest.json) directly on this page with a fake chrome.*
// API (chrome-stub.js), so it works without installing the extension. Fires
// "hl-loaded" on document when done. Don't use ?stub while the real extension
// is installed: both copies would run.
(async () => {
  if (!new URLSearchParams(location.search).has('stub')) return;
  const root = new URL('../', document.currentScript.src);
  const manifest = await (await fetch(new URL('manifest.json', root))).json();
  const { js, css } = manifest.content_scripts[0];

  for (const href of css) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(href, root).href;
    document.head.append(link);
  }
  for (const src of ['test/chrome-stub.js', ...js]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(src, root).href;
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    });
  }
  document.dispatchEvent(new Event('hl-loaded'));
})();
