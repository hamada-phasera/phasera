"""Build a self-contained HTML viewer with the GLB embedded as base64."""
import base64

with open('/home/claude/garden_compressed.glb', 'rb') as f:
    glb_b64 = base64.b64encode(f.read()).decode('ascii')

print(f"Base64 size: {len(glb_b64)/1024/1024:.2f} MB")

html = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Anatomical Garden — 3D Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a0f; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif; color: #e8e6df; }
  #canvas-container { position: fixed; inset: 0; width: 100vw; height: 100vh; }
  #canvas-container canvas { display: block; width: 100%; height: 100%; }

  #loading {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center; flex-direction: column;
    background: radial-gradient(circle at center, #1a1825 0%, #050508 100%);
    z-index: 100; transition: opacity 0.6s ease;
  }
  #loading.hidden { opacity: 0; pointer-events: none; }
  .spinner {
    width: 48px; height: 48px;
    border: 2px solid rgba(232,230,223,0.1); border-top-color: #c8a96a;
    border-radius: 50%; animation: spin 1s linear infinite;
    margin-bottom: 1.5rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { font-size: 0.85rem; letter-spacing: 0.15em; opacity: 0.7; text-transform: uppercase; }
  .loading-progress { font-size: 0.75rem; opacity: 0.5; margin-top: 0.5rem; font-variant-numeric: tabular-nums; }

  .hud {
    position: fixed; pointer-events: none; z-index: 10;
    transition: opacity 0.4s ease;
  }
  .hud-top-left { top: 2rem; left: 2rem; max-width: 360px; }
  .hud-bottom-right { bottom: 2rem; right: 2rem; text-align: right; }
  .hud-bottom-left { bottom: 2rem; left: 2rem; pointer-events: auto; }

  .title {
    font-size: 1.75rem; font-weight: 300; letter-spacing: -0.02em;
    margin-bottom: 0.4rem;
  }
  .subtitle {
    font-size: 0.8rem; letter-spacing: 0.1em; opacity: 0.55;
    text-transform: uppercase;
  }
  .description {
    margin-top: 1.2rem; font-size: 0.85rem; line-height: 1.6;
    opacity: 0.7;
  }

  .meta-line { font-size: 0.7rem; letter-spacing: 0.05em; opacity: 0.45; line-height: 1.5; }
  .meta-line strong { color: #c8a96a; font-weight: 400; opacity: 0.9; }

  .controls-hint {
    background: rgba(0,0,0,0.4); backdrop-filter: blur(8px);
    border: 1px solid rgba(232,230,223,0.08);
    padding: 0.8rem 1rem; border-radius: 4px;
    font-size: 0.7rem; letter-spacing: 0.05em; opacity: 0.7;
    line-height: 1.6;
  }
  .controls-hint kbd {
    background: rgba(232,230,223,0.1); padding: 1px 6px; border-radius: 2px;
    font-family: ui-monospace, monospace; font-size: 0.65rem;
  }

  #error {
    position: fixed; inset: 0; display: none;
    align-items: center; justify-content: center; flex-direction: column;
    background: #200; color: #f88; padding: 2rem; text-align: center; z-index: 200;
  }
  #error.visible { display: flex; }
  #error pre { background: #100; padding: 1rem; max-width: 80vw; overflow: auto; font-size: 0.75rem; margin-top: 1rem; }

  @media (max-width: 768px) {
    .hud-top-left { top: 1rem; left: 1rem; max-width: calc(100vw - 2rem); }
    .hud-bottom-right, .hud-bottom-left { bottom: 1rem; }
    .title { font-size: 1.3rem; }
    .description { display: none; }
  }
</style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div class="loading-text">Loading Garden</div>
    <div class="loading-progress" id="loading-progress">decoding…</div>
  </div>

  <div id="canvas-container"></div>

  <div class="hud hud-top-left">
    <div class="title">Anatomical Garden</div>
    <div class="subtitle">解剖学的な庭</div>
    <div class="description">
      患者由来CTスキャン脊椎、Polyhaven写真品質植物、procedural血管。
      ドラッグして回転、ホイールでズーム。
    </div>
  </div>

  <div class="hud hud-bottom-left">
    <div class="controls-hint">
      <kbd>drag</kbd> rotate &nbsp;·&nbsp; <kbd>wheel</kbd> zoom &nbsp;·&nbsp; <kbd>R</kbd> reset
    </div>
  </div>

  <div class="hud hud-bottom-right">
    <div class="meta-line"><strong>Spine</strong> · APIL CT scan, CC-BY-4.0</div>
    <div class="meta-line"><strong>Plants</strong> · Polyhaven CC0 (Nettle, Shrub)</div>
    <div class="meta-line" style="margin-top:0.5rem; opacity:0.3;">v4 · Anatomical Garden</div>
  </div>

  <div id="error">
    <h2>Error loading scene</h2>
    <pre id="error-msg"></pre>
  </div>

<script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js';

const GLB_BASE64 = "__GLB_BASE64__";

async function init() {
  try {
    const container = document.getElementById('canvas-container');

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Scene & background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    scene.fog = new THREE.Fog(0x0a0a0f, 5, 18);

    // Environment for PBR lighting (subtle global illumination)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // Camera
    const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100);
    camera.position.set(2.8, 1.4, 3.4);
    camera.lookAt(0, 0.75, 0);

    // Lights — three-point setup
    // Key light (warm, from front-right-above)
    const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.6);
    keyLight.position.set(3, 4, 3);
    keyLight.castShadow = false;
    scene.add(keyLight);

    // Fill light (cool, from front-left)
    const fillLight = new THREE.DirectionalLight(0x9bb8e8, 0.5);
    fillLight.position.set(-2, 1.5, 2);
    scene.add(fillLight);

    // Rim light (back, magenta tint for drama)
    const rimLight = new THREE.DirectionalLight(0xff80a0, 0.8);
    rimLight.position.set(-1, 2, -3);
    scene.add(rimLight);

    // Ambient floor bounce
    const ambient = new THREE.AmbientLight(0x404060, 0.3);
    scene.add(ambient);

    // Ground plane (subtle, for grounding)
    const groundGeo = new THREE.CircleGeometry(4, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x141420, roughness: 0.95, metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 1.4;
    controls.maxDistance = 9;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.target.set(0, 0.75, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;

    // Decode base64 GLB
    document.getElementById('loading-progress').textContent = 'decoding glb...';
    const binary = atob(GLB_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    document.getElementById('loading-progress').textContent = 'parsing scene...';

    // Load GLB
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        // Inject scene
        scene.add(gltf.scene);

        // Per-mesh tweaks
        let meshCount = 0, polyCount = 0;
        gltf.scene.traverse((obj) => {
          if (obj.isMesh) {
            meshCount++;
            if (obj.geometry.index) polyCount += obj.geometry.index.count / 3;
            else if (obj.geometry.attributes.position) polyCount += obj.geometry.attributes.position.count / 3;

            // Plant materials: alpha test for cutout
            if (obj.material && obj.material.map) {
              obj.material.alphaTest = 0.5;
              obj.material.transparent = false;  // CLIP cutout doesn't need transparent
              obj.material.side = THREE.DoubleSide;
              obj.material.needsUpdate = true;
            }

            // Vessel emissive boost (the procedural curves named artery_/vein_)
            if (obj.name && (obj.name.includes('artery') || obj.name.includes('vein'))) {
              if (obj.material) {
                obj.material.emissiveIntensity = 1.2;
              }
            }
          }
        });

        console.log(`Loaded: ${meshCount} meshes, ${Math.round(polyCount).toLocaleString()} triangles`);

        // Hide loading
        const loading = document.getElementById('loading');
        loading.classList.add('hidden');
        URL.revokeObjectURL(url);
      },
      (xhr) => {
        if (xhr.total > 0) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          document.getElementById('loading-progress').textContent = `loading ${pct}%`;
        }
      },
      (err) => { showError(err); }
    );

    // Resize handler
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Reset key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        camera.position.set(2.8, 1.4, 3.4);
        controls.target.set(0, 0.75, 0);
        controls.update();
      }
    });

    // Pause auto-rotate when user interacts
    let userInteracted = false;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      userInteracted = true;
    });

    // Render loop
    const clock = new THREE.Clock();
    function animate() {
      const dt = clock.getDelta();
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();

  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  const elError = document.getElementById('error');
  const elMsg = document.getElementById('error-msg');
  elError.classList.add('visible');
  elMsg.textContent = (err && err.stack) ? err.stack : String(err);
  document.getElementById('loading').classList.add('hidden');
  console.error(err);
}

init();
</script>
</body>
</html>
"""

html = html.replace("__GLB_BASE64__", glb_b64)

with open("/mnt/user-data/outputs/garden_viewer.html", "w") as f:
    f.write(html)

import os
size_mb = os.path.getsize("/mnt/user-data/outputs/garden_viewer.html") / 1024 / 1024
print(f"HTML written: {size_mb:.2f} MB")
