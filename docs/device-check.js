(() => {
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!mobile) return;
  const notice = document.createElement('section');
  notice.className = 'device-notice';
  notice.setAttribute('aria-labelledby', 'device-title');
  notice.innerHTML = `<img src="/icon.png" width="56" height="56" alt="RoCreate">
    <p class="device-label">DESKTOP EXTENSION</p>
    <h1 id="device-title">Switch to your computer</h1>
    <p>RoCreate is made for Chrome on a Mac or Windows desktop or laptop. It cannot be installed on phones or tablets.</p>
    <p>Open <strong>rocreate.org</strong> on your computer to get started.</p>
    <a href="/privacy.html">Privacy policy</a>`;
  for (const child of document.body.children) {
    if (child.tagName !== 'SCRIPT') child.hidden = true;
  }
  document.body.append(notice);
})();
