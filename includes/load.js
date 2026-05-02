(async () => {
  const header = document.getElementById('header');
  const footer = document.getElementById('footer');
  if (!header || !footer) return;

  try {
    const [headerResp, footerResp] = await Promise.all([
      fetch('/includes/header.html', { cache: 'no-store' }),
      fetch('/includes/footer.html', { cache: 'no-store' }),
    ]);

    if (!headerResp.ok || !footerResp.ok) {
      throw new Error('Failed to load header or footer');
    }

    const [headerHtml, footerHtml] = await Promise.all([
      headerResp.text(),
      footerResp.text(),
    ]);

    header.innerHTML = headerHtml;
    footer.innerHTML = footerHtml;
    document.dispatchEvent(new Event('waveToolsIncludesLoaded'));
  } catch (error) {
    console.error('WaveTools includes load error:', error);
  }
})();
