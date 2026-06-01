/**
 * <anatomical-garden-bg> — Web Component
 *
 * Drop-in 3D background of the Anatomical Garden scene.
 *
 * Usage:
 *   <script type="module" src="./anatomical-garden-bg.js"></script>
 *   <anatomical-garden-bg src="./garden.glb"></anatomical-garden-bg>
 *
 * Attributes:
 *   src              — GLB URL (required)
 *   rotate-speed     — auto-rotate speed, 0 disables (default: 0.15)
 *   exposure         — tone mapping exposure (default: 1.05)
 *   vignette         — vignette strength 0..1 (default: 0.55)
 *   overlay-color    — CSS color for overlay tint (default: #0a0a0f)
 *   overlay-opacity  — overlay opacity 0..1 (default: 0.35)
 *   fog-near         — fog start distance (default: 5)
 *   fog-far          — fog end distance (default: 18)
 *   camera-distance  — initial camera distance (default: 4.4)
 *   camera-height    — initial camera height (default: 1.4)
 *   target-height    — orbit target Y (default: 0.75)
 *   pixel-ratio-cap  — max devicePixelRatio (default: 2)
 *   paused-when-hidden — pause render loop when off-screen (boolean attr)
 */

import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js';

const num = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

class AnatomicalGardenBg extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._raf = null;
    this._disposed = false;
  }

  connectedCallback() {
    const src = this.getAttribute('src');
    if (!src) {
      console.error('<anatomical-garden-bg>: src attribute is required');
      return;
    }

    const overlayColor = this.getAttribute('overlay-color') || '#0a0a0f';
    const overlayOpacity = num(this.getAttribute('overlay-opacity'), 0.35);
    const vignetteStrength = num(this.getAttribute('vignette'), 0.55);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #0a0a0f;
          pointer-events: none;
        }
        :host([fixed]) {
          position: fixed;
          inset: 0;
          z-index: -1;
        }
        .stage { position: absolute; inset: 0; }
        canvas { display: block; width: 100% !important; height: 100% !important; }

        .overlay {
          position: absolute; inset: 0;
          background: ${overlayColor};
          opacity: ${overlayOpacity};
          pointer-events: none;
        }
        .vignette {
          position: absolute; inset: 0;
          pointer-events: none;
          background: radial-gradient(
            ellipse at center,
            rgba(0,0,0,0) 40%,
            rgba(0,0,0,${vignetteStrength * 0.6}) 75%,
            rgba(0,0,0,${vignetteStrength}) 100%
          );
        }
        .fallback {
          position: absolute; inset: 0;
          display: none;
          background: radial-gradient(circle at 30% 40%, #1a1825 0%, #050508 70%);
        }
        :host(.no-webgl) .fallback { display: block; }
        :host(.no-webgl) .stage { display: none; }
      </style>
      <div class="stage"></div>
      <div class="overlay"></div>
      <div class="vignette"></div>
      <div class="fallback"></div>
    `;

    this._init(src);
  }

  disconnectedCallback() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._resizeObs) this._resizeObs.disconnect();
    if (this._intersectObs) this._intersectObs.disconnect();
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer.forceContextLoss?.();
    }
    if (this._scene) {
      this._scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            for (const k in m) {
              const v = m[k];
              if (v && v.isTexture) v.dispose();
            }
            m.dispose?.();
          });
        }
      });
    }
  }

  _init(src) {
    const stage = this.shadowRoot.querySelector('.stage');

    const transparentBg = this.hasAttribute('transparent-bg');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparentBg, powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('<anatomical-garden-bg>: WebGL unavailable, showing fallback', e);
      this.classList.add('no-webgl');
      return;
    }
    this._renderer = renderer;

    const pixelRatioCap = num(this.getAttribute('pixel-ratio-cap'), 2);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = num(this.getAttribute('exposure'), 1.05);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    if (transparentBg) {
      // Transparent canvas — let host page bg show through
      renderer.setClearColor(0x000000, 0);
      scene.background = null;
      const fogColor = parseInt((this.getAttribute('fog-color') || '0xeef2f8').replace('#', '0x'));
      scene.fog = new THREE.Fog(fogColor, num(this.getAttribute('fog-near'), 8), num(this.getAttribute('fog-far'), 24));
    } else {
      scene.background = new THREE.Color(0x0a0a0f);
      scene.fog = new THREE.Fog(0x0a0a0f, num(this.getAttribute('fog-near'), 5), num(this.getAttribute('fog-far'), 18));
    }
    this._scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const rect = this.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.05, 100);
    const camDist = num(this.getAttribute('camera-distance'), 4.4);
    const camHeight = num(this.getAttribute('camera-height'), 1.4);
    const targetY = num(this.getAttribute('target-height'), 0.75);
    const camAxial = this.hasAttribute('camera-axial');
    if (camAxial) {
      // straight-ahead position so the model sits centered horizontally
      camera.position.set(0, camHeight, camDist);
    } else {
      camera.position.set(camDist * 0.7, camHeight, camDist * 0.85);
    }
    camera.lookAt(0, targetY, 0);
    this._camera = camera;
    renderer.setSize(w, h, false);

    // Lights — three-point setup
    const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.6);
    keyLight.position.set(3, 4, 3);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9bb8e8, 0.5);
    fillLight.position.set(-2, 1.5, 2);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xff80a0, 0.8);
    rimLight.position.set(-1, 2, -3);
    scene.add(rimLight);
    const ambient = new THREE.AmbientLight(0x404060, 0.3);
    scene.add(ambient);

    if (!transparentBg) {
      const groundGeo = new THREE.CircleGeometry(4, 64);
      const groundMat = new THREE.MeshStandardMaterial({ color: 0x141420, roughness: 0.95, metalness: 0.0 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
    }

    // Auto-orbit "controls" — we don't take user input (background is non-interactive),
    // but use OrbitControls' autoRotate math so it matches the original viewer's feel.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false; // no user input
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.set(0, targetY, 0);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const rotateSpeed = num(this.getAttribute('rotate-speed'), 0.15);
    controls.autoRotate = !reduceMotion && rotateSpeed > 0;
    controls.autoRotateSpeed = rotateSpeed;
    this._controls = controls;

    // Load GLB
    const loader = new GLTFLoader();
    // === IT layer (procedural, replaces plants when transparent-bg is set) ===
    // scroll-3d-bg pattern: premium-metal mood + organic-tendril + floating-particles
    let itLayer = null;
    if (transparentBg) {
      itLayer = new THREE.Group();
      itLayer.name = 'IT_LAYER';
      // 1. Floating data particles around the spine (scroll-3d-bg: floating-particles)
      const partCount = 700;
      const partGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(partCount * 3);
      const phases = new Float32Array(partCount);
      for (let i = 0; i < partCount; i++) {
        const r = 0.6 + Math.random() * 1.6;
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.3) * 2.6;
        positions[i*3] = Math.cos(theta) * r;
        positions[i*3+1] = y;
        positions[i*3+2] = Math.sin(theta) * r;
        phases[i] = Math.random() * Math.PI * 2;
      }
      partGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      partGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
      // sprite texture (radial gradient blue dot)
      const sCanvas = document.createElement('canvas'); sCanvas.width = sCanvas.height = 32;
      const sCtx = sCanvas.getContext('2d');
      const sGrad = sCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
      sGrad.addColorStop(0, 'rgba(60, 102, 217, 1)');
      sGrad.addColorStop(0.5, 'rgba(60, 102, 217, 0.45)');
      sGrad.addColorStop(1, 'rgba(60, 102, 217, 0)');
      sCtx.fillStyle = sGrad; sCtx.fillRect(0, 0, 32, 32);
      const partMat = new THREE.PointsMaterial({
        size: 0.05, map: new THREE.CanvasTexture(sCanvas),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        color: 0x3C66D9, opacity: 0.85
      });
      const dataPoints = new THREE.Points(partGeo, partMat);
      itLayer.add(dataPoints);
      itLayer.userData.partGeo = partGeo;
      itLayer.userData.partCount = partCount;

      // 2. Circuit nodes (small geometric primitives — IT modules)
      const nodeMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.25, metalness: 0.7,
        emissive: 0x3C66D9, emissiveIntensity: 0.5
      });
      for (let i = 0; i < 18; i++) {
        const isOcta = i % 3 === 0;
        const geom = isOcta
          ? new THREE.OctahedronGeometry(0.05 + Math.random() * 0.04, 0)
          : new THREE.BoxGeometry(0.05, 0.05, 0.05);
        const node = new THREE.Mesh(geom, nodeMat.clone());
        const r = 0.85 + Math.random() * 1.0;
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.35) * 2.2;
        node.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
        node.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        node.userData.spinSpeed = 0.005 + Math.random() * 0.012;
        itLayer.add(node);
      }

      // 3. Data wires (scroll-3d-bg: organic-tendril) connecting spine center to nodes
      const wireMat = new THREE.MeshStandardMaterial({
        color: 0x3C66D9, roughness: 0.4, metalness: 0.4,
        emissive: 0x3C66D9, emissiveIntensity: 0.4,
        transparent: true, opacity: 0.55
      });
      for (let i = 0; i < 22; i++) {
        const startY = (Math.random() - 0.4) * 2.0;
        const start = new THREE.Vector3(0, startY, 0);
        const r = 0.9 + Math.random() * 1.4;
        const theta = Math.random() * Math.PI * 2;
        const endY = startY + (Math.random() - 0.5) * 0.8;
        const end = new THREE.Vector3(Math.cos(theta) * r, endY, Math.sin(theta) * r);
        const mid1 = start.clone().lerp(end, 0.33).add(new THREE.Vector3(
          (Math.random()-0.5) * 0.3, (Math.random()-0.5) * 0.3, (Math.random()-0.5) * 0.3
        ));
        const mid2 = start.clone().lerp(end, 0.66).add(new THREE.Vector3(
          (Math.random()-0.5) * 0.3, (Math.random()-0.5) * 0.3, (Math.random()-0.5) * 0.3
        ));
        const curve = new THREE.CatmullRomCurve3([start, mid1, mid2, end]);
        const tube = new THREE.TubeGeometry(curve, 28, 0.006 + Math.random() * 0.005, 6, false);
        const wire = new THREE.Mesh(tube, wireMat);
        itLayer.add(wire);
        // small glowing terminator at end
        const term = new THREE.Mesh(
          new THREE.SphereGeometry(0.02, 10, 10),
          new THREE.MeshStandardMaterial({
            color: 0x9CC4FF, emissive: 0x9CC4FF, emissiveIntensity: 1.0,
            metalness: 0.4, roughness: 0.2
          })
        );
        term.position.copy(end);
        itLayer.add(term);
      }
      scene.add(itLayer);
      this._itLayer = itLayer;
    }

    loader.load(src, (gltf) => {
      if (this._disposed) return;
      this._gardenRoot = gltf.scene;
      scene.add(gltf.scene);
      // Recenter GLB based on its bounding box so the spine sits at scene origin
      if (this.hasAttribute('camera-axial')) {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        // Center horizontally + depth, keep Y so target-height controls vertical framing
        gltf.scene.position.x -= center.x;
        gltf.scene.position.z -= center.z;
        gltf.scene.position.y -= center.y - targetY;
      }
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.material && obj.material.map) {
          obj.material.alphaTest = 0.5;
          obj.material.transparent = false;
          obj.material.side = THREE.DoubleSide;
          obj.material.needsUpdate = true;
        }
        if (obj.name && (obj.name.includes('artery') || obj.name.includes('vein'))) {
          if (obj.material) obj.material.emissiveIntensity = 1.2;
        }
        // For light-page backgrounds: force dark navy color, hide plants (replaced by IT layer)
        if (transparentBg && obj.material) {
          const isVessel = obj.name && (obj.name.includes('artery') || obj.name.includes('vein'));
          const isPlant = obj.name && (obj.name.toLowerCase().includes('leaf') || obj.name.toLowerCase().includes('nettle') || obj.name.toLowerCase().includes('plant'));
          if (isPlant) {
            // Hide plants — replaced by procedural IT layer
            obj.visible = false;
            return;
          }
          obj.material.map = null;
          obj.material.metalness = 0.0;
          obj.material.roughness = 1.0;
          if (isVessel) {
            obj.material.color = new THREE.Color(0x3C66D9);
            obj.material.emissive = new THREE.Color(0x3C66D9);
            obj.material.emissiveIntensity = 0.6;
          } else {
            // Spine / bone
            obj.material.color = new THREE.Color(0x0B1E3F);
          }
          obj.material.transparent = false;
          obj.material.opacity = 1;
          obj.material.needsUpdate = true;
        }
      });
      this.dispatchEvent(new CustomEvent('garden-loaded', { bubbles: true }));
    }, undefined, (err) => {
      console.error('<anatomical-garden-bg>: GLB load failed', err);
      this.dispatchEvent(new CustomEvent('garden-error', { bubbles: true, detail: err }));
    });

    // Resize via ResizeObserver (works whether host is fixed/inline)
    this._resizeObs = new ResizeObserver(() => {
      const r = this.getBoundingClientRect();
      const W = Math.max(1, r.width), H = Math.max(1, r.height);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H, false);
    });
    this._resizeObs.observe(this);

    // Pause when off-screen for power saving
    this._visible = true;
    if (this.hasAttribute('paused-when-hidden')) {
      this._intersectObs = new IntersectionObserver((entries) => {
        for (const e of entries) this._visible = e.isIntersecting;
      });
      this._intersectObs.observe(this);
    }
    document.addEventListener('visibilitychange', () => {
      this._tabVisible = document.visibilityState === 'visible';
    });
    this._tabVisible = document.visibilityState === 'visible';

    // === scroll-3d-bg: scroll-driven rotation+tilt+scale with LERP ===
    const scrollDriven = this.hasAttribute('scroll-driven');
    if (scrollDriven) {
      controls.autoRotate = false;
    }
    let scrollProgress = 0;
    let smoothed = 0;
    let mx = 0, my = 0, smx = 0, smy = 0;
    if (scrollDriven) {
      const updateScroll = () => {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        scrollProgress = Math.min(1, Math.max(0, window.scrollY / max));
      };
      window.addEventListener('scroll', updateScroll, { passive: true });
      updateScroll();
      window.addEventListener('mousemove', (e) => {
        mx = (e.clientX / window.innerWidth) - 0.5;
        my = (e.clientY / window.innerHeight) - 0.5;
      });
    }
    const clock = new THREE.Clock();
    const animate = () => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(animate);
      if (!this._visible || !this._tabVisible) return;
      // host が opacity 0 / data-paused 属性付きならスキップ（GPU 節約）
      const hostOpa = parseFloat(getComputedStyle(this.parentElement || this).opacity);
      if (this.hasAttribute('data-paused') || (Number.isFinite(hostOpa) && hostOpa < 0.04)) return;
      const t = clock.getElapsedTime();

      if (scrollDriven) {
        // LERP smoothing
        smoothed += (scrollProgress - smoothed) * 0.06;
        smx += (mx - smx) * 0.04;
        smy += (my - smy) * 0.04;
        // Apply rotation + tilt + scale + downward translate to garden + IT layer
        const baseY = smoothed * Math.PI * 1.6 + t * 0.04;
        const baseX = -0.10 + smoothed * 0.45;
        const scl = 1 + smoothed * 0.22;
        const dropY = -smoothed * 3.5; // descend as user scrolls
        if (this._gardenRoot) {
          this._gardenRoot.rotation.y = baseY + smx * 0.3;
          this._gardenRoot.rotation.x = baseX + smy * 0.18;
          this._gardenRoot.scale.setScalar(scl);
          // Preserve recenter offset on x/z, drive y as scroll-descent
          if (this._gardenRoot.userData._yOffset === undefined) {
            this._gardenRoot.userData._yOffset = this._gardenRoot.position.y;
          }
          this._gardenRoot.position.y = this._gardenRoot.userData._yOffset + dropY;
        }
        if (this._itLayer) {
          this._itLayer.rotation.y = baseY * 0.8 + smx * 0.4;
          this._itLayer.rotation.x = baseX + smy * 0.15;
          this._itLayer.scale.setScalar(scl);
          this._itLayer.position.y = dropY * 0.85;
          // node spin
          this._itLayer.children.forEach((c) => {
            if (c.userData && c.userData.spinSpeed) {
              c.rotation.x += c.userData.spinSpeed;
              c.rotation.y += c.userData.spinSpeed * 0.7;
            }
          });
          // particle drift
          const partGeo = this._itLayer.userData.partGeo;
          if (partGeo) {
            const arr = partGeo.attributes.position.array;
            const phs = partGeo.attributes.aPhase.array;
            const partCount = this._itLayer.userData.partCount;
            for (let i = 0; i < partCount; i++) {
              arr[i*3+1] += Math.sin(t * 0.5 + phs[i]) * 0.0018;
              arr[i*3]   += Math.cos(t * 0.4 + phs[i]) * 0.0008;
            }
            partGeo.attributes.position.needsUpdate = true;
          }
        }
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    };
    animate();
  }
}

if (!customElements.get('anatomical-garden-bg')) {
  customElements.define('anatomical-garden-bg', AnatomicalGardenBg);
}

export { AnatomicalGardenBg };
