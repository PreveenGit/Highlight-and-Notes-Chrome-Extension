// Development only. With ?stub in the page URL, runs the extension's content
// scripts (every entry in manifest.json, in order) directly on this page with a fake
// chrome.* API (chrome-stub.js), so it works without installing the extension. Fires
// "hl-loaded" on document when done. Don't use ?stub while the real extension
// is installed: both copies would run.
(async () => {
  if (!new URLSearchParams(location.search).has('stub')) return;
  const root = new URL('../', document.currentScript.src);
  // python -m http.server sends no cache headers, so bust the cache to always test
  // the files as they are on disk.
  const fresh = (path) => {
    const url = new URL(path, root);
    url.searchParams.set('t', Date.now());
    return url.href;
  };
  const manifest = await (await fetch(fresh('manifest.json'), { cache: 'no-store' })).json();
  const js = manifest.content_scripts.flatMap((entry) => entry.js || []);
  const css = manifest.content_scripts.flatMap((entry) => entry.css || []);

  for (const href of css) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fresh(href);
    document.head.append(link);
  }
  for (const src of ['test/chrome-stub.js', ...js]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = fresh(src);
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    });
  }
  document.dispatchEvent(new Event('hl-loaded'));
})();
