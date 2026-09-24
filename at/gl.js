/* ============================================================
   Phasera GL — single persistent WebGL stage
   hero particle field → works: spine reveal + orbiting liquid cards
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

  // colored studio env: magenta / cyan / violet panels → the iridescent sheen on the spine
  // (a neutral RoomEnvironment only gives white reflections, which read as plain metal)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x04060d, side: THREE.BackSide })));
  [
    [0xff3fa4, 5, -6, 3, 2, 4, 6],   // magenta, left
    [0x3fe8ff, 4, 6, 1, 3, 3, 7],    // cyan, right
    [0x7b5cff, 4, 0, -6, -4, 8, 3],  // violet, floor
    [0xe8f0ff, 2.6, 2, 7, 6, 6, 2],  // soft white key, top
    [0x2b6bff, 3, -3, 0, -8, 6, 6],  // brand blue, back
  ].forEach(([c, k, x, y, z, w, h]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  });
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;

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
      uSpinA: { value: 0 },   // spine yaw — blooms ride on the spine
      uSpineY: { value: -10 }, // spine rise offset
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 aRnd;
      uniform float uTime, uWorks, uVel, uDpr, uGlobal, uSize, uSpinA, uSpineY;
      uniform vec3 uPointer;
      varying float vA; varying vec3 vCol;
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
        // works mode (dust share): condense into a column envelope around the spine
        float bloomShare = step(0.42, aRnd.z);
        float r = length(p.xz);
        float targetR = 2.2 + aRnd.x * 2.4;
        vec2 dir = r > 1e-4 ? p.xz / r : vec2(1., 0.);
        vec2 xzWorks = dir * targetR;
        p.xz = mix(p.xz, xzWorks, uWorks * 0.85 * (1.0 - bloomShare));
        p.y = mix(p.y, p.y * 0.55, uWorks * (1.0 - bloomShare));
        // works mode (bloom share): dense coral-like clusters clinging to the spine,
        // stacked along its height and turning with it
        float k = floor(aRnd.x * 7.0);
        float ang = k * 2.39996 + uSpinA;
        float cr = 0.8 + fract(k * 0.618) * 0.75;
        vec3 cc = vec3(cos(ang) * cr, -3.9 + k * 1.3 + uSpineY, sin(ang) * cr * 0.8);
        float th = aRnd.y * 6.28318 + uTime * 0.05;
        float ph = acos(2.0 * aRnd.w - 1.0);
        vec3 d3b = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
        float lump = 0.72 + 0.28 * sin(th * 5.0 + ph * 4.0 + uTime * 0.4 + k);
        float rr = (0.16 + 0.66 * pow(fract(aRnd.x * 7.0), 0.5)) * lump;
        vec3 bloom = cc + d3b * rr;
        bloom.y += uVel * (0.3 + aRnd.y) * 0.9; // scroll inertia: blooms trail the spine
        float isBloom = bloomShare * uWorks;
        p = mix(p, bloom, isBloom);
        // pointer repulsion
        vec3 d3 = p - uPointer;
        float dist = length(d3.xy);
        p.xy += normalize(d3.xy + 1e-4) * exp(-dist * dist * 1.4) * 0.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float size = (0.9 + aRnd.w * 2.4) * (1.0 - uWorks * 0.35) * (1.0 - coreShare * 0.3);
        gl_PointSize = size * uDpr * (140.0 / -mv.z) * uSize;
        vA = ((0.38 + aRnd.z * 0.5) * (1.0 - uWorks * 0.5) + coreShare * 0.35 + isBloom * 0.22) * uGlobal;
        // hero stays brand blue; blooms shift to magenta / violet / cyan
        vec3 heroCol = mix(vec3(0.61, 0.77, 1.0), vec3(0.24, 0.4, 0.85), aRnd.y);
        float h = fract(k * 0.37 + aRnd.y * 0.3);
        vec3 bloomCol = h < 0.4 ? vec3(1.0, 0.36, 0.76) : (h < 0.75 ? vec3(0.56, 0.4, 1.0) : vec3(0.3, 0.86, 1.0));
        vCol = mix(heroCol, bloomCol, isBloom);
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vCol;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.05, d) * vA;
        gl_FragColor = vec4(vCol, a);
      }`,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  /* =========================================================
     spine — toned to the site (navy metal + blue vessels)
     ========================================================= */
  const spineGroup = new THREE.Group();
  spineGroup.position.y = -10;
  scene.add(spineGroup);
  let spineLoaded = false;

  /* liquid glass: world-space wobble (idle wave + scroll-velocity bend) and an
     iridescent fresnel rim, patched into the stock physical material */
  const spineU = { uTime: { value: 0 }, uBend: { value: 0 }, uRim: { value: 1 } };
  const liquidify = (mat) => {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, spineU);
      sh.vertexShader = 'uniform float uTime, uBend;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 wpos = modelMatrix * vec4(transformed, 1.0);
        float wy = wpos.y;
        wpos.x += sin(wy * 0.9 + uTime * 1.1) * 0.05 + uBend * wy * wy * 0.02;
        wpos.z += cos(wy * 0.7 + uTime * 0.8) * 0.05 - uBend * wy * 0.04;
        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = 'uniform float uTime, uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
        float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        vec3 rimC = mix(vec3(0.25, 0.85, 1.0), vec3(1.0, 0.32, 0.78), 0.5 + 0.5 * sin(vViewPosition.y * 0.9 + uTime * 0.6));
        outgoingLight += rimC * fr * uRim;
        #include <opaque_fragment>`);
    };
    return mat;
  };

  const loader = new GLTFLoader();
  loader.load(
    window.__PH_SPINE || 'assets/3d/spine.glb',
    (gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // oversized close-up: the spine runs off both ends of the viewport (AT: one huge artifact)
      const s = (MOBILE ? 9.5 : 13.5) / size.y; // phones: narrower view, so a smaller spine
      root.scale.setScalar(s);
      root.position.set(-center.x * s, -center.y * s, -center.z * s);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const isVessel = /artery|vein|vessel/.test(o.name);
        if (isVessel) {
          // vessels carry the warm accent (magenta arteries / violet veins)
          const isArtery = /artery|_art_/.test(o.name);
          o.material = liquidify(new THREE.MeshPhysicalMaterial({
            color: isArtery ? 0xff5fb0 : 0x8b6bff,
            emissive: isArtery ? 0xff3f9a : 0x6a4cff,
            emissiveIntensity: isArtery ? 0.9 : 0.7,
            metalness: 0.2, roughness: 0.3,
            clearcoat: 1, iridescence: 0.6,
            transparent: true, opacity: 0,
          }));
        } else {
          // bone: iridescent glass-metal, colored by the studio env + fresnel rim
          o.material = liquidify(new THREE.MeshPhysicalMaterial({
            color: 0x9fb2ff,
            metalness: 0.55, roughness: 0.16,
            iridescence: 1, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 820],
            clearcoat: 1, clearcoatRoughness: 0.08,
            emissive: 0x1a1450, emissiveIntensity: 0.5,
            envMapIntensity: 1.8,
            transparent: true, opacity: 0,
          }));
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
  // landscape glass slabs (AT proportions); wide orbit so side cards read at ~45°
  const R = MOBILE ? 2.05 : 3.1;
  const CW = MOBILE ? 2.1 : 2.5, CH = MOBILE ? 1.31 : 1.56;
  const CD = MOBILE ? 0.08 : 0.1; // slab thickness
  const PITCH = 1.25; // helix rise per revolution
  const cardGeo = new THREE.BoxGeometry(CW, CH, CD, 40, 26, 1);
  const cards = [];
  const IMGS = new Map(); // slug → loaded work photo (composited into card art)

  /* card art: black ground + sunken photo + centered title. The ground stays dark on
     purpose — the shader adds the animated fluid on top, so bright texels read as type. */
  const makeTexture = (w) => {
    const cw = 1024, ch = 640;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const x = cv.getContext('2d');
    x.fillStyle = '#03050b'; x.fillRect(0, 0, cw, ch);
    const ph = IMGS.get(w.slug);
    if (ph) {
      x.save();
      const s = Math.max(cw / ph.width, ch / ph.height);
      x.globalAlpha = 0.6;
      x.drawImage(ph, (cw - ph.width * s) / 2, (ch - ph.height * s) / 2, ph.width * s, ph.height * s);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'color'; // duotone in the card hue
      x.fillStyle = `hsl(${w.hue}, 60%, 55%)`;
      x.fillRect(0, 0, cw, ch);
      x.globalCompositeOperation = 'source-over';
      x.fillStyle = 'rgba(3, 5, 11, 0.62)'; // sink it under the fluid
      x.fillRect(0, 0, cw, ch);
      x.restore();
    }
    const en = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
    const mono = "'Space Mono', 'Courier New', monospace";
    const n = String(WORKS.indexOf(w) + 1).padStart(2, '0');
    // corner meta
    x.fillStyle = 'rgba(190, 210, 255, 0.7)';
    x.font = `400 22px ${mono}`;
    x.fillText(n + ' / ' + String(WORKS.length).padStart(2, '0'), 48, 64);
    x.textAlign = 'right';
    x.fillText(w.cat, cw - 48, 64);
    // centered title block
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if ('letterSpacing' in x) x.letterSpacing = '4px';
    const lh = 116, y0 = ch / 2 - ((w.en.length - 1) * lh) / 2 + 10;
    x.fillStyle = 'rgba(225, 232, 255, 0.72)';
    x.font = `400 22px ${mono}`;
    x.fillText('◈ ' + w.cat + ' ◈', cw / 2, y0 - 98);
    x.fillStyle = 'rgba(244, 247, 255, 0.98)';
    x.font = `500 110px ${en}`;
    w.en.forEach((word, i) => x.fillText(word, cw / 2, y0 + i * lh));
    if ('letterSpacing' in x) x.letterSpacing = '0px';
    x.fillStyle = 'rgba(170, 190, 225, 0.85)';
    x.font = `400 22px ${mono}`;
    x.fillText(w.sub.split(' — ')[0], cw / 2, ch - 58);
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

  const OCT = MOBILE ? 3 : 5; // fbm octaves — cheaper fluid on phones
  WORKS.forEach((w, i) => {
    const colA = new THREE.Color().setHSL(w.hue / 360, 0.75, 0.55);
    const colB = new THREE.Color().setHSL(((w.hue + 95) % 360) / 360, 0.8, 0.6); // magenta/violet counter-tone
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeTexture(w) },
        uTime: { value: 0 },
        uSeed: { value: i * 1.7 },
        uVel: { value: 0 },
        uFocus: { value: 0 },
        uIn: { value: 0 },
        uDim: { value: 0 },
        uGlitch: { value: 0 },
        uTrail: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uColA: { value: colA },
        uColB: { value: colB },
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
          // liquid: bend by orbit/scroll velocity (page-curl style around Y)
          float bend = uVel * 2.2;
          p.z -= sin(st.x * 3.14159) * bend * 0.42;
          p.x += bend * (st.y - 0.5) * 0.22;
          // idle breathing wave — the "liquid slab" life
          p.z += sin(st.y * 5.0 + uTime * 1.3 + uSeed) * 0.035 * uIn;
          p.z += sin(st.x * 6.0 + uTime * 0.9 + uSeed * 2.0) * 0.025 * uIn;
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
        uniform float uFocus, uIn, uDim, uTime, uGlitch, uSeed;
        uniform vec2 uRes;
        uniform vec3 uColA, uColB;
        varying vec2 vUv; varying float vBend; varying vec3 vN;
        const vec2 SZ = vec2(${CW.toFixed(3)}, ${CH.toFixed(3)});
        float hash(float n){ return fract(sin(n) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          float n = i.x + i.y * 57.;
          return mix(mix(hash(n), hash(n + 1.), f.x), mix(hash(n + 57.), hash(n + 58.), f.x), f.y);
        }
        float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < ${OCT}; i++){ v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
        void main(){
          float a = uIn * (1.0 - uDim * 0.82);
          vec3 n = normalize(vN);
          // rounded-rect silhouette — also trims the box's square side corners
          float rad = ${(MOBILE ? 0.09 : 0.13).toFixed(2)};
          vec2 q = abs((vUv - 0.5) * SZ) - (SZ * 0.5 - rad);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
          if (sd > 0.001) discard;
          if (abs(n.z) < 0.5) {
            // slab thickness: glassy edge catching the colored light
            vec3 rim = mix(uColA, vec3(0.92, 0.95, 1.0), 0.35 + uFocus * 0.4);
            gl_FragColor = vec4(rim, a * 0.8);
            return;
          }
          vec2 uv = vUv;
          if (n.z < 0.0) uv.x = 1.0 - uv.x; // keep type readable from behind
          float tr = texture2D(uTrail, gl_FragCoord.xy / uRes).r;
          // animated fluid (domain-warped fbm), stirred by bend + pointer trail
          float t = uTime * 0.06 + uSeed;
          vec2 fp = uv * vec2(SZ.x / SZ.y, 1.0) * 1.6;
          vec2 w = vec2(fbm(fp + t), fbm(fp + 5.2 - t));
          float f = fbm(fp + w * 1.7 + tr * 1.2 + vBend * 0.5);
          vec3 fluid = mix(uColA * 0.16, uColA, smoothstep(0.35, 0.78, f));
          fluid = mix(fluid, uColB, smoothstep(0.5, 0.85, fbm(fp * 1.7 - w + t * 0.5)) * 0.85);
          // glitch: sliced rows + rgb split, fired when the card takes focus
          float row = floor(vUv.y * 28.0);
          float gk = step(0.55, hash(row + floor(uTime * 24.0))) * uGlitch;
          uv.x += (hash(row * 3.1 + floor(uTime * 30.0)) - 0.5) * 0.12 * gk;
          uv += (w - 0.5) * 0.012 + tr * 0.02; // refraction wobble
          uv.x += vBend * 0.03 * sin(vUv.y * 3.14159);
          float sp = 0.003 + 0.014 * uGlitch;
          vec3 c = vec3(texture2D(uMap, uv + vec2(sp, 0.)).r, texture2D(uMap, uv).g, texture2D(uMap, uv - vec2(sp, 0.)).b);
          float lum = dot(c, vec3(0.3, 0.5, 0.2));
          float face = n.z > 0.0 ? 1.0 : 0.45;
          vec3 col = (fluid * (0.5 + uFocus * 0.5) + c * (0.78 + uFocus * 0.35)) * face;
          // glass bevel: bright inner rim + top sheen
          float bevel = smoothstep(-0.05, 0.0, sd);
          col += mix(uColA, vec3(1.0), 0.6) * bevel * (0.35 + uFocus * 0.5);
          col += vec3(0.7, 0.8, 1.0) * pow(vUv.y, 4.0) * 0.08;
          float glassA = 0.5 + lum * 0.6 + bevel * 0.4 + uFocus * 0.2;
          gl_FragColor = vec4(col, a * min(glassA, 1.0));
        }`,
    });
    const mesh = new THREE.Mesh(cardGeo, mat);
    mesh.userData = { i, w, lag: { x: 0, v: 0 }, glitch: 0 };
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
  const spineSway = { x: 0, v: 0 };
  const resV = new THREE.Vector2();
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
    // works now follows the hero directly: the spine starts rising while the hero
    // is still on screen (p≈-0.21 ≈ first scroll of the hero), fully up by p≈0.09
    const revTarget = smooth01((p + (MOBILE ? 0.13 : 0.21)) / 0.3) // phones: rise a little later so hero copy stays readable * (1 - smooth01((p - 1.02) / 0.2));
    reveal = damp(reveal, revTarget, 3.6, dt);

    /* jelly springs — underdamped, so a scroll flick overshoots and settles (the "揺れ") */
    const sdt = Math.min(dt, 1 / 30); // keep the explicit spring stable on frame hitches
    const spring = (s, target, k, c) => {
      s.v += (k * (target - s.x) - c * s.v) * sdt;
      s.x += s.v * sdt;
      return s.x;
    };
    const sway = spring(spineSway, smVel, 38, 5.5);

    /* camera (parallax by pointer, dolly-in + look up at the spine on works) */
    const camZ = (MOBILE ? 8.8 : 7.2) - reveal * 1.4;
    const camY = 0.2 - reveal * 0.45;
    camera.position.x = damp(camera.position.x, (PH.px - 0.5) * -0.7, 3, dt);
    camera.position.y = damp(camera.position.y, camY + (PH.py - 0.5) * 0.3, 3, dt);
    camera.position.z = damp(camera.position.z, camZ, 3, dt);
    camera.lookAt(0, reveal * 0.35, 0);

    /* particles */
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uWorks.value = reveal;
    pMat.uniforms.uVel.value = sway;
    // full field in the hero and works stage, calm behind reading sections
    const heroF = 1.4 - (PH.scroll / Math.max(innerHeight, 1)) * 1.1;
    const gTarget = THREE.MathUtils.clamp(Math.max(heroF, reveal), 0.22, 1);
    pMat.uniforms.uGlobal.value = damp(pMat.uniforms.uGlobal.value, gTarget, 3, dt);
    pMat.uniforms.uPointer.value.copy(worldPointer());

    /* spine — rises from just below the fold, fully standing by reveal 0.4 */
    const rise = Math.min(reveal / 0.4, 1);
    spineGroup.position.y = damp(spineGroup.position.y, -10 * (1 - rise), 3.6, dt);
    spineGroup.rotation.y = t * 0.14 + PH.scroll * 0.0009;
    spineGroup.rotation.z = sway * 0.05;  // whole-body sway on scroll
    spineGroup.rotation.x = -sway * 0.03;
    spineU.uTime.value = t;
    spineU.uBend.value = sway;             // per-vertex bend (liquid)
    pMat.uniforms.uSpinA.value = spineGroup.rotation.y;
    pMat.uniforms.uSpineY.value = spineGroup.position.y;
    const sOp = Math.max(0, Math.min(1, (reveal - 0.02) / 0.3));
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

    /* orbit — starts as soon as the stage pins */
    const scrollOrbit = Math.max(0, (Math.min(p, 1.04) - 0.08)) / 0.92 * TAU * 1.05;
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
    renderer.getDrawingBufferSize(resV);
    cards.forEach((c, i) => {
      const a = i * SEG - orbit;
      const ud = c.userData;
      // each card has its own spring stiffness → they wobble out of phase, like jelly
      const lag = spring(ud.lag, smVel, 26 + i * 5, 4.2);
      // helix: cards spiral upward around the spine as the orbit advances;
      // the focused card (a≈0) sits at eye level, upcoming cards wait below
      const helixY = -(a / TAU) * PITCH + Math.sin(t * 0.7 + i * 1.9) * 0.05;
      c.position.set(Math.sin(a) * R, helixY + lag * 0.55, Math.cos(a) * R);
      c.rotation.y = a * 0.62; // half-turned toward the camera, so side cards still read
      c.rotation.x = Math.sin(t * 0.5 + i) * 0.03 + lag * 0.4;
      c.rotation.z = 0.06 + Math.sin(t * 0.4 + i * 2.3) * 0.02 - lag * 0.08;
      const u = c.material.uniforms;
      u.uTime.value = t;
      u.uVel.value = THREE.MathUtils.clamp(angVel + lag * 0.35, -0.9, 0.9);
      u.uTrail.value = rtA.texture;
      u.uRes.value.copy(resV);
      const focusT = i === fi && reveal > 0.5 ? 1 : 0;
      u.uFocus.value = damp(u.uFocus.value, focusT, 5, dt);
      ud.glitch = Math.max(0, ud.glitch - dt * 1.8);
      u.uGlitch.value = REDUCED ? 0 : ud.glitch;
      // staggered fly-in — cards follow right behind the rising spine
      const inT = smooth01((reveal - (0.3 + i * 0.06)) / 0.3);
      u.uIn.value = inT;
      c.scale.setScalar((0.6 + inT * 0.25) * (0.9 + u.uFocus.value * 0.1)); // focus card ≈ 45% width, spine stays visible
      const dim = filter !== 'ALL' && ud.w.cat !== filter ? 1 : 0;
      u.uDim.value = damp(u.uDim.value, dim, 6, dt);
    });

    if (fi !== focusIdx && reveal > 0.35) {
      if (cards[fi]) cards[fi].userData.glitch = 1; // title scramble on arrival
      if (cards[focusIdx]) cards[focusIdx].userData.glitch = 0.7;
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
