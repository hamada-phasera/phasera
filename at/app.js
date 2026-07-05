/* ============================================================
   Phasera — app.js (DOM: loader, scroll state, cursor, nav,
   works overlay UI, reveals, form)
   ============================================================ */
(function () {
  'use strict';

  var PH = (window.PH = window.PH || {});
  PH.scroll = 0; PH.vel = 0; PH.worksP = -1; PH.px = 0.5; PH.py = 0.5;

  var WORKS = window.PHASERA_WORKS || [];
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- preloader ---------- */
  var loaderEl = document.getElementById('loader');
  var pctNum = document.getElementById('pctNum');
  var pctBar = document.getElementById('pctBar');
  var pctSt = document.getElementById('pctSt');
  var assetP = 0, shownP = 0, glReady = false, minTimeDone = false;
  var t0 = performance.now();

  window.addEventListener('ph:glprogress', function (e) { assetP = Math.max(assetP, e.detail.p); });
  window.addEventListener('ph:glready', function () { glReady = true; });
  setTimeout(function () { minTimeDone = true; }, 900);
  // hard fallback: never hold the page hostage
  setTimeout(function () { assetP = 1; glReady = true; }, 9000);

  var lastTick = performance.now();
  (function tickLoader(now) {
    now = now || performance.now();
    var dt = Math.min((now - lastTick) / 1000, 0.3);
    lastTick = now;
    var target = assetP * 100;
    shownP += (target - shownP) * Math.min(1, 5 * dt);
    if (pctNum) pctNum.textContent = String(Math.round(shownP));
    if (pctBar) pctBar.style.transform = 'scaleX(' + shownP / 100 + ')';
    if (pctSt) pctSt.textContent = shownP > 95 ? 'COMPOSING FIELD' : shownP > 55 ? 'LOADING SPINE' : 'LOADING FIELD';
    if (shownP > 99.2 && (glReady || document.body.classList.contains('no-webgl')) && minTimeDone) {
      if (pctNum) pctNum.textContent = '100';
      loaderEl && loaderEl.classList.add('done');
      document.body.classList.remove('locked');
      requestAnimationFrame(function () { document.body.classList.add('ready'); });
      return;
    }
    requestAnimationFrame(tickLoader);
  })();

  /* ---------- pointer ---------- */
  window.addEventListener('pointermove', function (e) {
    PH.px = e.clientX / window.innerWidth;
    PH.py = e.clientY / window.innerHeight;
  }, { passive: true });

  /* ---------- custom cursor ---------- */
  var dot = document.getElementById('curDot');
  var ring = document.getElementById('curRing');
  var cx = -100, cy = -100, rx = -100, ry = -100, mx = -100, my = -100;
  window.addEventListener('pointermove', function (e) { mx = e.clientX; my = e.clientY; }, { passive: true });
  document.addEventListener('mouseover', function (e) {
    if (!ring) return;
    var t = e.target.closest('a, button, summary, .ask-pill');
    ring.classList.toggle('link', !!t);
  });

  /* ---------- scroll state ---------- */
  var worksEl = document.getElementById('works');
  var scrollPill = document.getElementById('scrollPill');
  var navEl = document.getElementById('nav');
  var wBar = document.getElementById('wBar');
  var papers = Array.prototype.slice.call(document.querySelectorAll('.paper, footer.light'));
  var prevY = window.scrollY;

  // is a light sheet under this viewport y?
  function overLight(y) {
    for (var i = 0; i < papers.length; i++) {
      var r = papers[i].getBoundingClientRect();
      if (r.top <= y && r.bottom >= y) return true;
    }
    return false;
  }

  function rafLoop() {
    requestAnimationFrame(rafLoop);
    var y = window.scrollY;
    PH.vel += ((y - prevY) / Math.max(window.innerHeight, 1) * -6 - PH.vel) * 0.1;
    prevY = y;
    PH.scroll = y;

    if (worksEl) {
      var total = worksEl.offsetHeight - window.innerHeight;
      var top = worksEl.getBoundingClientRect().top;
      PH.worksP = total > 0 ? -top / total : -1;
      if (wBar) wBar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, PH.worksP)) + ')';
    }

    // fixed chrome goes solid dark while riding over a light sheet
    document.body.classList.toggle('chrome-top-light', overLight(56));
    document.body.classList.toggle('chrome-bot-light', overLight(window.innerHeight - 44));

    // velocity-deformed pills (AT signature detail)
    if (!REDUCED) {
      var v = Math.min(Math.abs(PH.vel) * 0.55, 0.8);
      if (scrollPill) scrollPill.style.transform = 'scale(' + (1 - v * 0.25) + ',' + (1 + v) + ')';
      if (navEl) navEl.style.transform = 'scale(' + (1 + v * 0.03) + ',' + (1 - v * 0.12) + ')';
    }

    // cursor chase
    if (dot) {
      cx += (mx - cx) * 0.6; cy += (my - cy) * 0.6;
      rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
      dot.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
      ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
    }
  }
  rafLoop();

  /* ---------- nav active state ---------- */
  var navLinks = document.querySelectorAll('.nav ul a');
  var sections = [];
  navLinks.forEach(function (a) {
    var id = a.getAttribute('href');
    if (id && id[0] === '#') {
      var el = document.querySelector(id);
      if (el) sections.push({ a: a, el: el });
    }
  });
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      var hit = sections.find(function (s) { return s.el === en.target; });
      if (hit && en.isIntersecting) {
        navLinks.forEach(function (a) { a.classList.remove('on'); });
        hit.a.classList.add('on');
      }
    });
  }, { rootMargin: '-40% 0px -50% 0px' });
  sections.forEach(function (s) { io.observe(s.el); });

  /* ---------- burger / menu ---------- */
  var burger = document.getElementById('burger');
  var menu = document.getElementById('menu');
  var menuClose = document.getElementById('menuClose');
  function closeMenu() { menu && menu.classList.remove('open'); }
  burger && burger.addEventListener('click', function () { menu.classList.add('open'); });
  menuClose && menuClose.addEventListener('click', closeMenu);
  menu && menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMenu); });

  /* ---------- paper sheets: reveal over the dark field ---------- */
  var pio = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('on'); pio.unobserve(en.target); }
    });
  }, { threshold: 0.02 });
  document.querySelectorAll('.paper').forEach(function (el) { pio.observe(el); });

  /* ---------- reveal on scroll ---------- */
  var rv = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (en.isIntersecting) {
        var d = parseInt(en.target.getAttribute('data-rv') || '0', 10);
        setTimeout(function () { en.target.classList.add('in'); }, d);
        rv.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.rv').forEach(function (el) { rv.observe(el); });

  /* ---------- count-up ---------- */
  var cu = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (!en.isIntersecting) return;
      cu.unobserve(en.target);
      var el = en.target, target = parseFloat(el.getAttribute('data-count') || '0');
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min((now - t0) / 1400, 1);
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach(function (el) { cu.observe(el); });

  /* ---------- works overlay UI ---------- */
  var wIdx = document.getElementById('wIdx');
  var wTitle = document.getElementById('wTitle');
  var wSub = document.getElementById('wSub');
  var wDesc = document.getElementById('wDesc');

  function renderTitle(i) {
    var w = WORKS[i];
    if (!w || !wTitle) return;
    wTitle.classList.add('out');
    setTimeout(function () {
      wIdx.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(WORKS.length).padStart(2, '0') + ' — ' + w.cat;
      wTitle.innerHTML = w.en.map(function (l) { return '<span class="wl-ln"><span>' + l + '</span></span>'; }).join('');
      wSub.textContent = w.sub;
      wDesc.textContent = w.desc;
      wTitle.classList.remove('out');
    }, 240);
  }
  window.addEventListener('ph:workchange', function (e) { renderTitle(e.detail.index); });
  renderTitle(0);

  var prevB = document.getElementById('wPrev');
  var nextB = document.getElementById('wNext');
  prevB && prevB.addEventListener('click', function () {
    window.dispatchEvent(new CustomEvent('ph:worknav', { detail: { dir: -1 } }));
  });
  nextB && nextB.addEventListener('click', function () {
    window.dispatchEvent(new CustomEvent('ph:worknav', { detail: { dir: 1 } }));
  });

  document.querySelectorAll('.w-filter a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelectorAll('.w-filter a').forEach(function (x) { x.classList.remove('on'); });
      a.classList.add('on');
      window.dispatchEvent(new CustomEvent('ph:workfilter', { detail: { f: a.getAttribute('data-f') } }));
    });
  });

  /* ---------- ask pill rotating placeholder ---------- */
  var askPh = document.getElementById('askPh');
  var prompts = [
    '「問い合わせ対応、自動化できる？」',
    '「うちの業界の事例を見せて」',
    '「診断って何をするの？」',
    '「毎日3時間、事務に溶けてます」',
  ];
  if (askPh && !REDUCED) {
    var pi = 0;
    setInterval(function () {
      pi = (pi + 1) % prompts.length;
      askPh.style.opacity = '0';
      setTimeout(function () { askPh.innerHTML = 'Ask Phasera… <em>' + prompts[pi] + '</em>'; askPh.style.opacity = '1'; }, 350);
    }, 4200);
    askPh.style.transition = 'opacity .35s';
  }

  /* ---------- FAQ: close others ---------- */
  document.querySelectorAll('.faq-item').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) document.querySelectorAll('.faq-item[open]').forEach(function (o) { if (o !== d) o.open = false; });
    });
  });

  /* ---------- form (静的サイト: mailto フォールバック) ---------- */
  var form = document.getElementById('diagnose-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      ['f-name', 'f-email', 'f-industry'].forEach(function (id) {
        var el = document.getElementById(id);
        var field = el.closest('.field');
        var valid = !!el.value && (id !== 'f-email' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value));
        field.classList.toggle('error', !valid);
        if (!valid) ok = false;
      });
      var status = document.getElementById('form-status');
      if (!ok) { status.textContent = '未入力の項目をご確認ください。'; return; }
      var name = document.getElementById('f-name').value;
      var industry = document.getElementById('f-industry').value;
      var msg = document.getElementById('f-message').value;
      var body = encodeURIComponent('お名前: ' + name + '\n業種: ' + industry + '\n相談内容:\n' + msg);
      window.location.href = 'mailto:hamada.phasera@gmail.com?subject=' + encodeURIComponent('【診断申込】' + name) + '&body=' + body;
      status.textContent = 'メールクライアントを開いています — 送信して完了です。';
    });
  }

  /* ---------- anchor smooth scroll ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var href = a.getAttribute('href');
      if (!href || href.length < 2) return; // bare "#" (filter links) is not a target
      var el = document.querySelector(href);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
    });
  });
})();
