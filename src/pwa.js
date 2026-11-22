/* PWA plumbing: offline install without a server or a build step.
   The service worker is same-origin and cache-first, so once the page has been
   visited the whole game runs with the network unplugged. file:// skips all of
   this (service workers need http/https). */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      if (window.console) console.warn('Offline cache unavailable:', err && err.message);
    });
  });
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferred = ev;
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.remove('hidden');
  });
  window.installGame = async function () {
    const btn = document.getElementById('installBtn');
    if (!deferred) return false;
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      if (btn) btn.classList.add('hidden');
      return !!(choice && choice.outcome === 'accepted');
    } catch (e) { return false; }
  };
})();
