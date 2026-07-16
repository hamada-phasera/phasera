/* ============================================================
   Phasera GL — single persistent WebGL stage
   hero particle field → works: spine reveal + orbiting liquid cards
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const PH = (window.PH = window.PH || {
  scroll: 0, vel: 0, worksP: -1, pointer: { x: 0, y: 0 }, px: 0, py: 0,
});
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = window.matchMedia('(max-width: 820px)').matches || 'ontouchstart' in window;
const WORKS = window.PHASERA_WORKS || [];
const TAU = Math.PI * 2;

const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('no-webgl');
}

if (renderer) boot();
else window.dispatchEvent(new CustomEvent('ph:glprogress', { detail: { p: 1 } }));

function boot() {
  // desktop gets a 3x cap for crisper particles; mobile stays at 2x for battery
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 2 : 3));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a14);
  scene.fog = new THREE.Fog(0x050a14, 8.5, 15);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 60);
  camera.position.set(0, 0.2, 7.2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  /* ------- lights ------- */
  scene.add(new THREE.AmbientLight(0x24365c, 0.9));
  const key = new THREE.DirectionalLight(0xdfeaff, 1.35);
  key.position.set(3.5, 4.5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x3c66d9, 2.2);
  rim.position.set(-4, 2, -5);
  scene.add(rim);
  const glow = new THREE.PointLight(0x6fa8ff, 0, 9, 1.6); // ramps in with spine reveal
  glow.position.set(0, 0.4, 0);
  scene.add(glow);

  /* =========================================================
     pointer liquid trail — ping-pong RT, R = intensity
     ========================================================= */
  const TRES = 256;
  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false };
  let rtA = new THREE.WebGLRenderTarget(TRES, TRES, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(TRES, TRES, rtOpts);
  const trailScene = new THREE.Scene();
  const trailCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const trailMat = new THREE.ShaderMaterial({
    uniforms: {
      uPrev: { value: null },
      uP: { value: new THREE.Vector2(-10, -10) },
      uPPrev: { value: new THREE.Vector2(-10, -10) },
      uStrength: { value: 0 },
      uAspect: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `
      uniform sampler2D uPrev; uniform vec2 uP, uPPrev; uniform float uStrength, uAspect;
      varying vec2 vUv;
      float sdSeg(vec2 p, vec2 a, vec2 b){
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0., 1.);
        return length(pa - ba * h);
      }
      void main(){
        float prev = texture2D(uPrev, vUv).r * 0.955;
        vec2 p = vec2(vUv.x * uAspect, vUv.y);
        vec2 a = vec2(uPPrev.x * uAspect, uPPrev.y);
        vec2 b = vec2(uP.x * uAspect, uP.y);
        float d = sdSeg(p, a, b);
        float splat = exp(-d * d * 900.0) * uStrength;
        gl_FragColor = vec4(vec3(min(prev + splat, 1.6)), 1.);
      }`,
  });
  trailScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), trailMat));

  /* trail visualizer — faint wet glow following the cursor */
  const trailView = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uT: { value: null } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.); }`,
      fragmentShader: `
        uniform sampler2D uT; varying vec2 vUv;
        void main(){
          float v = texture2D(uT, vUv).r;
          vec3 col = mix(vec3(0.10, 0.22, 0.55), vec3(0.42, 0.62, 1.0), min(v, 1.));
          gl_FragColor = vec4(col, v * 0.16);
        }`,
    })
  );
  trailView.frustumCulled = false;
  const trailViewScene = new THREE.Scene();
  trailViewScene.add(trailView);
  const trailViewCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /* =========================================================
     particle field
     ========================================================= */
  const N = MOBILE ? 3800 : 16000; // finer grain on desktop
  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const rnd = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 16;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
    rnd[i * 4] = Math.random(); rnd[i * 4 + 1] = Math.random();
    rnd[i * 4 + 2] = Math.random(); rnd[i * 4 + 3] = Math.random();
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  const pMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWorks: { value: 0 },
      uVel: { value: 0 },
      uGlobal: { value: 1 }, // dims the field behind reading sections
      uPointer: { value: new THREE.Vector3(99, 99, 0) },
      uDpr: { value: Math.min(window.devicePixelRatio, MOBILE ? 2 : 3) },
      uSize: { value: MOBILE ? 0.16 : 0.11 }, // smaller dots × more of them = finer field
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 aRnd;
      uniform float uTime, uWorks, uVel, uDpr, uGlobal, uSize;
      uniform vec3 uPointer;
      varying float vA; varying float vTint;
      void main(){
        vec3 p = position;
        float t = uTime * (0.05 + aRnd.x * 0.08);
        // slow drift
        p.x += sin(t * 2.0 + aRnd.y * 40.0) * (0.5 + aRnd.z);
        p.y += cos(t * 1.6 + aRnd.x * 30.0) * 0.4 + sin(uTime * 0.06 + aRnd.w * 20.0) * 0.35;
        p.z += sin(t * 1.3 + aRnd.z * 50.0) * 0.5;
        // scroll velocity smears the field vertically (AT feel)
        p.y += uVel * (0.6 + aRnd.y) * 1.4;
        // hero: a share of particles condenses into a luminous swirling core
        // (pushed away from the camera so the grain reads fine, not coarse)
        float coreShare = step(0.58, aRnd.w) * (1.0 - uWorks);
        float ca = aRnd.x * 6.28318 + uTime * (0.1 + aRnd.y * 0.12);
        float ta = aRnd.y * 6.28318 + uTime * 0.32;
        float tube = 0.34 + aRnd.z * 0.7;
        vec3 corePos = vec3(
          cos(ca) * (2.5 + cos(ta) * tube),
          sin(ta) * tube * 0.8 + sin(ca * 2.0 + uTime * 0.4) * 0.22,
          (sin(ca) * (2.5 + cos(ta) * tube)) * 0.5 - 2.8
        );
        p = mix(p, corePos, coreShare * 0.94);
        // works mode: condense into a column envelope around the spine
        float r = length(p.xz);
        float targetR = 2.2 + aRnd.x * 2.4;
        vec2 dir = r > 1e-4 ? p.xz / r : vec2(1., 0.);
        vec2 xzWorks = dir * targetR;
        p.xz = mix(p.xz, xzWorks, uWorks * 0.85);
        p.y = mix(p.y, p.y * 0.55, uWorks);
        // pointer repulsion
        vec3 d3 = p - uPointer;
        float dist = length(d3.xy);
        p.xy += normalize(d3.xy + 1e-4) * exp(-dist * dist * 1.4) * 0.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float size = (0.9 + aRnd.w * 2.4) * (1.0 - uWorks * 0.35) * (1.0 - coreShare * 0.3);
        gl_PointSize = size * uDpr * (140.0 / -mv.z) * uSize;
        vA = ((0.38 + aRnd.z * 0.5) * (1.0 - uWorks * 0.5) + coreShare * 0.35) * uGlobal;
        vTint = aRnd.y;
      }`,
    fragmentShader: `
      varying float vA; varying float vTint;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.05, d) * vA;
        vec3 col = mix(vec3(0.61, 0.77, 1.0), vec3(0.24, 0.4, 0.85), vTint);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  /* =========================================================
     spine — toned to the site (navy metal + blue vessels)
     ========================================================= */
  const spineGroup = new THREE.Group();
  spineGroup.position.y = -11;
  scene.add(spineGroup);
  let spineLoaded = false;

  const loader = new GLTFLoader();
  loader.load(
    window.__PH_SPINE || 'assets/3d/spine.glb',
    (gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // oversized close-up: the spine crops beyond the viewport (AT: one huge artifact)
      const s = 9.8 / size.y;
      root.scale.setScalar(s);
      root.position.set(-center.x * s, -center.y * s, -center.z * s);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const isVessel = /artery|vein|vessel/.test(o.name);
        if (isVessel) {
          const isArtery = /artery|_art_/.test(o.name);
          o.material = new THREE.MeshStandardMaterial({
            color: 0x2c4fb0,
            emissive: isArtery ? 0x6fa8ff : 0x3c66d9,
            emissiveIntensity: isArtery ? 1.15 : 0.7,
            metalness: 0.25, roughness: 0.4,
            transparent: true, opacity: 0,
          });
        } else {
          o.material = new THREE.MeshStandardMaterial({
            color: 0x8aa6d6,
            metalness: 0.85, roughness: 0.32,
            emissive: 0x122f57, emissiveIntensity: 0.55,
            envMapIntensity: 1.25,
            transparent: true, opacity: 0,
          });
        }
      });
      spineGroup.add(root);
      spineLoaded = true;
      window.dispatchEvent(new CustomEvent('ph:glprogress', { detail: { p: 1 } }));
    },
    (ev) => {
      if (ev.total) window.dispatchEvent(new CustomEvent('ph:glprogress', { detail: { p: ev.loaded / ev.total } }));
    },
    (err) => {
      console.warn('[Phasera] spine.glb load failed — cards continue without the spine', err);
      spineLoaded = true; // fail soft: cards still work
      window.dispatchEvent(new CustomEvent('ph:glprogress', { detail: { p: 1 } }));
    }
  );

  /* =========================================================
     liquid cards orbiting the spine
     ========================================================= */
  const ring = new THREE.Group();
  scene.add(ring);
  const R = MOBILE ? 2.15 : 2.85;
  const CW = MOBILE ? 1.25 : 1.62, CH = MOBILE ? 1.56 : 2.02;
  const CD = MOBILE ? 0.07 : 0.09; // slab thickness
  const PITCH = 1.5; // helix rise per revolution
  const cardGeo = new THREE.BoxGeometry(CW, CH, CD, 26, 32, 1);
  const cards = [];
  const IMGS = new Map(); // slug → loaded work photo (composited into card art)

  const makeTexture = (w) => {
    const cw = 768, ch = 960;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const x = cv.getContext('2d');
    const h = w.hue;
    // base gradient
    const g = x.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, `hsl(${h}, 55%, 22%)`);
    g.addColorStop(0.55, `hsl(${h + 8}, 50%, 12%)`);
    g.addColorStop(1, 'hsl(222, 45%, 7%)');
    x.fillStyle = g; x.fillRect(0, 0, cw, ch);
    // radial glow
    const rg = x.createRadialGradient(cw * 0.72, ch * 0.2, 0, cw * 0.72, ch * 0.2, cw * 0.9);
    rg.addColorStop(0, `hsla(${h}, 85%, 62%, 0.5)`);
    rg.addColorStop(1, 'transparent');
    x.fillStyle = rg; x.fillRect(0, 0, cw, ch);
    // work photo — sunken navy duotone (AT-style: rest≈faint, hue separation not brightness).
    // glassA in the fragment shader tracks texel luminance, so the photo must stay dark
    // or the card goes opaque and the spine stops ghosting through.
    const ph = IMGS.get(w.slug);
    if (ph) {
      x.save();
      const s = Math.max(cw / ph.width, ch / ph.height);
      x.globalAlpha = 0.85;
      x.drawImage(ph, (cw - ph.width * s) / 2, (ch - ph.height * s) / 2, ph.width * s, ph.height * s);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'color'; // duotone: keep luminance, repaint hue/sat in card blue
      x.fillStyle = `hsl(${h}, 60%, 55%)`;
      x.fillRect(0, 0, cw, ch);
      x.globalCompositeOperation = 'source-over'; // navy settle — sinks the photo
      const sink = x.createLinearGradient(0, 0, 0, ch);
      sink.addColorStop(0, 'rgba(4, 8, 18, 0.30)');
      sink.addColorStop(0.6, 'rgba(4, 8, 18, 0.46)');
      sink.addColorStop(1, 'rgba(4, 8, 18, 0.70)');
      x.fillStyle = sink; x.fillRect(0, 0, cw, ch);
      x.restore();
    }
    // fine grid
    x.strokeStyle = 'rgba(156, 196, 255, 0.06)'; x.lineWidth = 1;
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo((cw / 8) * i, 0); x.lineTo((cw / 8) * i, ch); x.stroke(); }
    for (let i = 1; i < 10; i++) { x.beginPath(); x.moveTo(0, (ch / 10) * i); x.lineTo(cw, (ch / 10) * i); x.stroke(); }
    // noise speckle
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(200, 220, 255, ${Math.random() * 0.05})`;
      x.fillRect(Math.random() * cw, Math.random() * ch, 1.4, 1.4);
    }
    // frame
    x.strokeStyle = 'rgba(156, 196, 255, 0.35)'; x.lineWidth = 2;
    x.strokeRect(26, 26, cw - 52, ch - 52);
    const en = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
    const mono = "'Space Mono', 'Courier New', monospace";
    // index + category
    x.fillStyle = 'rgba(156, 196, 255, 0.9)';
    x.font = `400 30px ${mono}`;
    x.fillText(String(WORKS.indexOf(w) + 1).padStart(2, '0'), 58, 104);
    x.textAlign = 'right';
    x.font = `400 24px ${mono}`;
    x.fillText(w.cat, cw - 58, 104);
    x.textAlign = 'left';
    // ghost numeral watermark
    x.strokeStyle = 'rgba(156, 196, 255, 0.09)';
    x.lineWidth = 3;
    x.font = `700 430px ${en}`;
    x.textAlign = 'right';
    x.strokeText(String(WORKS.indexOf(w) + 1).padStart(2, '0'), cw + 40, ch * 0.56);
    x.textAlign = 'left';
    // glyph
    x.fillStyle = 'rgba(156, 196, 255, 0.5)';
    x.font = `400 30px ${mono}`;
    x.fillText('【= ◈ ⌒ ◈ =】', 58, ch * 0.5);
    // big EN words
    x.fillStyle = 'rgba(234, 241, 251, 0.96)';
    x.font = `700 118px ${en}`;
    w.en.forEach((word, i) => x.fillText(word, 54, ch - 150 - (w.en.length - 1 - i) * 118));
    // sub
    x.fillStyle = 'rgba(143, 163, 192, 0.95)';
    x.font = `400 26px ${mono}`;
    x.fillText(w.sub.split(' — ')[0], 58, ch - 74);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };

  /* redraw card art once webfonts are in (canvas uses document fonts) */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      cards.forEach((c) => {
        const old = c.material.uniforms.uMap.value;
        c.material.uniforms.uMap.value = makeTexture(c.userData.w);
        old && old.dispose();
      });
    });
  }

  /* preload work photos, then recomposite that card's texture (same swap pattern) */
  WORKS.forEach((w) => {
    if (!w.img) return;
    const im = new Image();
    im.onload = () => {
      IMGS.set(w.slug, im);
      const c = cards.find((m) => m.userData.w === w);
      if (!c) return;
      const old = c.material.uniforms.uMap.value;
      c.material.uniforms.uMap.value = makeTexture(w);
      old && old.dispose();
    };
    im.onerror = () => console.warn('[Phasera] work photo failed to load — card keeps procedural art:', w.img);
    im.src = w.img;
  });

  WORKS.forEach((w, i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeTexture(w) },
        uTime: { value: 0 },
        uSeed: { value: i * 1.7 },
        uVel: { value: 0 },
        uFocus: { value: 0 },
        uIn: { value: 0 },
        uDim: { value: 0 },
        uTrail: { value: null },
      },
      transparent: true, side: THREE.FrontSide, depthWrite: false, // glass: the spine shows through
      vertexShader: `
        uniform float uTime, uSeed, uVel, uIn;
        uniform sampler2D uTrail;
        varying vec2 vUv; varying float vBend; varying vec3 vN;
        const float CW = ${CW.toFixed(3)}; const float CH = ${CH.toFixed(3)};
        void main(){
          // position-derived uv so all box faces deform coherently
          vec2 st = vec2(position.x / CW + 0.5, position.y / CH + 0.5);
          vUv = st;
          vN = normal;
          vec3 p = position;
          // liquid: bend by orbit velocity (page-curl style around Y)
          float bend = uVel * 2.2;
          p.z -= sin(st.x * 3.14159) * bend * 0.42;
          p.x += bend * (st.y - 0.5) * 0.22;
          // idle breathing wave — the "liquid slab" life
          p.z += sin(st.y * 5.0 + uTime * 1.3 + uSeed) * 0.03 * uIn;
          p.z += sin(st.x * 7.0 + uTime * 0.9 + uSeed * 2.0) * 0.02 * uIn;
          p.x += sin(st.y * 3.0 + uTime * 0.7 + uSeed) * 0.012 * uIn;
          // pointer liquid trail displacement (screen-space)
          vec4 wp = modelMatrix * vec4(p, 1.);
          vec4 clip = projectionMatrix * viewMatrix * wp;
          vec2 ndc = clip.xy / max(clip.w, 1e-4);
          float tr = texture2D(uTrail, ndc * 0.5 + 0.5).r;
          p.z += tr * 0.22;
          vBend = bend;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
        }`,
      fragmentShader: `
        uniform sampler2D uMap, uTrail;
        uniform float uFocus, uIn, uDim, uTime;
        varying vec2 vUv; varying float vBend; varying vec3 vN;
        void main(){
          float a = uIn * (1.0 - uDim * 0.82);
          vec3 n = normalize(vN);
          if (abs(n.z) < 0.5) {
            // slab rim: glassy edge catching the accent light
            float g = 0.5 + 0.5 * sin(vUv.y * 6.28318 + uTime * 0.6);
            vec3 rim = mix(vec3(0.07, 0.14, 0.34), vec3(0.38, 0.58, 1.0), 0.25 + uFocus * 0.5 + g * 0.15);
            gl_FragColor = vec4(rim, a * 0.85);
            return;
          }
          // liquid refraction: shift uv by trail gradient + bend
          vec2 uv = vUv;
          if (n.z < 0.0) uv.x = 1.0 - uv.x; // keep type readable from behind
          uv.x += vBend * 0.03 * sin(vUv.y * 3.14159);
          vec4 c = texture2D(uMap, uv);
          float lum = (0.62 + uFocus * 0.5) * (n.z > 0.0 ? 1.0 : 0.45);
          vec3 col = c.rgb * lum;
          // edge glow on focus
          float edge = smoothstep(0.5, 0.985, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
          col += vec3(0.32, 0.5, 1.0) * edge * uFocus * 0.35;
          // glass: dark body stays see-through, type and glow turn solid
          float bright = dot(c.rgb, vec3(0.35, 0.45, 0.2));
          float glassA = 0.32 + bright * 0.85 + edge * uFocus * 0.3 + uFocus * 0.12;
          gl_FragColor = vec4(col, a * min(glassA, 1.0));
        }`,
    });
    const mesh = new THREE.Mesh(cardGeo, mat);
    mesh.userData = { i, w };
    mesh.renderOrder = 10; // draw after the spine so front cards occlude it
    ring.add(mesh);
    cards.push(mesh);
  });

  /* =========================================================
     orbit interaction — scroll drives, drag overrides
     ========================================================= */
  const SEG = TAU / Math.max(WORKS.length, 1);
  let orbit = 0, orbitTarget = 0, dragOff = 0, dragV = 0, snapOff = 0;
  let dragging = false, lastX = 0, downX = 0, downT = 0;
  const stage = document.querySelector('.works-stage');
  const ringEl = document.getElementById('curRing');

  if (stage) {
    stage.style.pointerEvents = 'auto';
    stage.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = downX = e.clientX; downT = performance.now(); dragV = 0;
      stage.setPointerCapture(e.pointerId);
      ringEl && ringEl.classList.add('drag');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      dragOff -= dx * 0.0038;
      dragV = -dx * 0.0038;
    });
    const tapRay = new THREE.Raycaster();
    const up = (e) => {
      if (!dragging) return;
      dragging = false;
      ringEl && ringEl.classList.remove('drag');
      // quick small-move tap: on the focused card → open Cases; elsewhere → orbit toward tapped side
      const dt = performance.now() - downT;
      if (dt < 220 && Math.abs(e.clientX - downX) < 6) {
        tapRay.setFromCamera(
          new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
          camera
        );
        const hit = tapRay.intersectObjects(cards, false)[0];
        if (hit && hit.object.userData.i === focusIdx) { location.href = '/cases/'; return; }
        snapOff += (e.clientX > innerWidth / 2 ? 1 : -1) * SEG;
      }
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }
  window.addEventListener('ph:worknav', (e) => { snapOff += e.detail.dir * SEG; });

  /* focus tracking → DOM overlay */
  let focusIdx = -1;
  const focusRaw = (orbitNow) => {
    // card whose world-z is greatest (nearest to camera)
    let best = -1, bz = -1e9;
    cards.forEach((c, i) => {
      const a = i * SEG - orbitNow;
      const z = Math.cos(a) * R;
      if (z > bz) { bz = z; best = i; }
    });
    return best;
  };

  /* filter dimming */
  let filter = 'ALL';
  window.addEventListener('ph:workfilter', (e) => { filter = e.detail.f; });

  /* =========================================================
     resize / pointer plumbing
     ========================================================= */
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  };
  window.addEventListener('resize', onResize);

  const pNow = new THREE.Vector2(-10, -10);
  const pPrev = new THREE.Vector2(-10, -10);
  let pSpeed = 0;
  window.addEventListener('pointermove', (e) => {
    pNow.set(e.clientX / innerWidth, 1 - e.clientY / innerHeight);
    if (pPrev.x < -5) pPrev.copy(pNow); // no splat streak from the off-screen sentinel
  }, { passive: true });

  /* unproject pointer to z=0 plane for particle repulsion */
  const ndc = new THREE.Vector3();
  const pointer3 = new THREE.Vector3(99, 99, 0);
  const worldPointer = () => {
    ndc.set(PH.px * 2 - 1, -(PH.py * 2 - 1), 0.5);
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const t = -camera.position.z / dir.z;
    pointer3.copy(camera.position).addScaledVector(dir, t);
    return pointer3;
  };

  /* =========================================================
     main loop
     ========================================================= */
  const clock = new THREE.Clock();
  let smVel = 0, reveal = 0, firstFrame = false;
  window.__PHGL = { renderer, scene, camera, get reveal() { return reveal; }, frames: 0 };

  /* frame-rate independent damping: k per second */
  const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    window.__PHGL.frames++;
    const dt = Math.min(Math.max(clock.getDelta(), 1e-4), 0.2);
    const t = clock.elapsedTime;

    /* trail sim */
    if (!REDUCED) {
      const d = pNow.distanceTo(pPrev);
      pSpeed = damp(pSpeed, Math.min(d * 26, 1.4), 20, dt);
      trailMat.uniforms.uPrev.value = rtA.texture;
      trailMat.uniforms.uP.value.copy(pNow);
      trailMat.uniforms.uPPrev.value.copy(pPrev);
      trailMat.uniforms.uStrength.value = pSpeed * 0.6;
      trailMat.uniforms.uAspect.value = innerWidth / innerHeight;
      renderer.setRenderTarget(rtB);
      renderer.render(trailScene, trailCam);
      renderer.setRenderTarget(null);
      const tmp = rtA; rtA = rtB; rtB = tmp;
      trailView.material.uniforms.uT.value = rtA.texture;
      pPrev.copy(pNow);
    }

    /* scroll states from app.js */
    smVel = damp(smVel, PH.vel, 5, dt);
    const p = PH.worksP; // raw, can be <0 or >1
    const revTarget = smooth01(p / 0.42) * (1 - smooth01((p - 1.02) / 0.2));
    reveal = damp(reveal, revTarget, 3.6, dt);

    /* camera (parallax by pointer, dolly-in on works) */
    const camZ = (MOBILE ? 8.6 : 7.2) - reveal * 1.15;
    const camY = 0.2 - reveal * 0.25;
    camera.position.x = damp(camera.position.x, (PH.px - 0.5) * -0.7, 3, dt);
    camera.position.y = damp(camera.position.y, camY + (PH.py - 0.5) * 0.3, 3, dt);
    camera.position.z = damp(camera.position.z, camZ, 3, dt);
    camera.lookAt(0, reveal * -0.1, 0);

    /* particles */
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uWorks.value = reveal;
    pMat.uniforms.uVel.value = smVel;
    // full field in the hero and works stage, calm behind reading sections
    const heroF = 1.4 - (PH.scroll / Math.max(innerHeight, 1)) * 1.1;
    const gTarget = THREE.MathUtils.clamp(Math.max(heroF, reveal), 0.22, 1);
    pMat.uniforms.uGlobal.value = damp(pMat.uniforms.uGlobal.value, gTarget, 3, dt);
    pMat.uniforms.uPointer.value.copy(worldPointer());

    /* spine — rises first, fully standing by reveal 0.65 */
    const rise = Math.min(reveal / 0.65, 1);
    spineGroup.position.y = damp(spineGroup.position.y, -11 * (1 - rise), 3.6, dt);
    spineGroup.rotation.y = t * 0.14 + PH.scroll * 0.0006;
    const sOp = Math.max(0, Math.min(1, (reveal - 0.15) / 0.6));
    spineGroup.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      // go opaque once fully revealed: correct depth vs cards, no self-transparency
      const wantTransparent = sOp < 0.985;
      if (o.material.transparent !== wantTransparent) {
        o.material.transparent = wantTransparent;
        o.material.needsUpdate = true;
      }
      o.material.opacity = sOp;
    });
    glow.intensity = sOp * 5.2;

    /* orbit */
    const scrollOrbit = Math.max(0, (Math.min(p, 1.04) - 0.45)) / 0.55 * TAU * 1.05;
    if (!dragging) {
      dragOff += dragV * (dt * 60); dragV *= Math.exp(-3.7 * dt);
      // gentle snap of combined offset to segment grid when idle
      const total = dragOff + snapOff;
      const snapped = Math.round(total / SEG) * SEG;
      if (Math.abs(dragV) < 0.0004) dragOff = damp(dragOff, dragOff + (snapped - total), 2.4, dt);
    }
    orbitTarget = scrollOrbit + dragOff + snapOff;
    const prevOrbit = orbit;
    orbit = damp(orbit, orbitTarget, 4.4, dt);
    const angVel = (orbit - prevOrbit) / Math.max(dt, 0.008) * 0.016;

    /* cards */
    const fi = focusRaw(orbit);
    cards.forEach((c, i) => {
      const a = i * SEG - orbit;
      // helix: cards spiral upward around the spine as the orbit advances;
      // the focused card (a≈0) sits at eye level, upcoming cards wait below
      const helixY = -(a / TAU) * PITCH + Math.sin(t * 0.7 + i * 1.9) * 0.05;
      c.position.set(Math.sin(a) * R, helixY, Math.cos(a) * R);
      c.rotation.y = a; // face outward from the spine axis
      c.rotation.x = Math.sin(t * 0.5 + i) * 0.02;
      c.rotation.z = 0.07 + Math.sin(t * 0.4 + i * 2.3) * 0.015; // roll along the helix tangent
      const u = c.material.uniforms;
      u.uTime.value = t;
      u.uVel.value = THREE.MathUtils.clamp(angVel, -0.9, 0.9);
      u.uTrail.value = rtA.texture;
      const focusT = i === fi && reveal > 0.5 ? 1 : 0;
      u.uFocus.value = damp(u.uFocus.value, focusT, 5, dt);
      // staggered fly-in — cards follow after the spine has risen
      const inT = smooth01((reveal - (0.48 + i * 0.05)) / 0.3);
      u.uIn.value = inT;
      c.scale.setScalar(0.7 + inT * 0.3);
      const dim = filter !== 'ALL' && c.userData.w.cat !== filter ? 1 : 0;
      u.uDim.value = damp(u.uDim.value, dim, 6, dt);
    });

    if (fi !== focusIdx && reveal > 0.35) {
      focusIdx = fi;
      window.dispatchEvent(new CustomEvent('ph:workchange', { detail: { index: fi } }));
    }

    renderer.render(scene, camera);
    if (!REDUCED) {
      renderer.autoClear = false; // composite the wet-trail glow over the scene
      renderer.render(trailViewScene, trailViewCam);
      renderer.autoClear = true;
    }

    if (!firstFrame) {
      firstFrame = true;
      window.dispatchEvent(new CustomEvent('ph:glready'));
    }
  }
  requestAnimationFrame(frame);

  function smooth01(v) {
    v = Math.max(0, Math.min(1, v));
    return v * v * (3 - 2 * v);
  }
}
