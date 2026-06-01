# Anatomical Garden — Claude Code Project

3D Web visualization: 解剖学的脊椎に植物が侵食し、毛細血管が骨に這う「廃墟侵食」シーン。

---

## Current State (v3)

GLB完成済み、Three.jsビューワー動作確認済み。**ただしHamadaから「血管と草が多すぎ・大きすぎ」フィードバックあり、要調整。**

```
[2026-05-04] v3 (decay-invasion) 完成
  - 脊椎: APIL CT scan, 高さ1.5m, 159K poly
  - 葉: 80枚を脊椎メッシュ表面サンプリングで配置
  - 血管: 4 main (near-vertical) + 6 fragments
  - GLB: 13MB (WebP圧縮 + 1024px texture)
  - HTML viewer: 18MB (base64埋め込み)
[FEEDBACK] 血管・草が多すぎ&大きすぎ → 次バージョンで縮小調整
```

---

## Build & Test Commands

```bash
# 1. 個別植物GLB作成 (一度きりで良い、すでにassets/にある)
blender --background --python scripts/blend_to_glb.py -- \
  /path/to/nettle.blend nettle_plant_LOD2 assets/nettle.glb "dry"

# 2. メインシーン合成
blender --background --python scripts/build.py
# → outputs/garden_final.glb

# 3. プレビュー画像生成 (Eevee高速、目視確認用)
blender --background --python scripts/preview.py
# → preview.png

# 4. WebP圧縮 (テクスチャ1/4 + WebP)
blender --background --python scripts/compress.py
# → outputs/garden_compressed.glb

# 5. 単一HTMLビューワー生成 (base64埋込)
python3 scripts/build_viewer.py
# → outputs/garden_viewer.html

# Webで実機確認
python3 -m http.server -d outputs 8080
# open http://localhost:8080/garden_viewer.html
```

---

## Files

```
scripts/
  build.py          # メインシーン構築 (★主に編集する)
  blend_to_glb.py   # Polyhaven .blend → 個別GLB変換 (一度きり)
  preview.py        # Eeveeで確認画像生成
  compress.py       # WebP+ダウンサンプリング圧縮
  build_viewer.py   # HTML生成 (base64埋込)
assets/
  nettle.glb        # 13MB - Polyhaven Nettle LOD2 (使用中)
  shrub.glb         # 18MB - Polyhaven Shrub LOD2 (v2まで使用、v3では未使用)
  spine/scene.gltf  # ★要配置: APIL CT scan from Sketchfab (CC-BY-4.0)
outputs/
  garden_v3.glb              # 圧縮済み (13MB)
  garden_v3_uncompressed.glb # 元 (20MB)
  garden_viewer.html         # 自己完結ビューワー (18MB)
```

**spine/scene.gltf は引き継ぎパッケージから除外**(再ダウンロード必要):
- Sketchfab "Patient-specific spine from CT" by APIL → CC-BY-4.0
- glTF format でダウンロード → `assets/spine/scene.gltf` に配置

---

## Next Tasks (priority order)

### P0 — 血管と草を「もっと小さく/少なく」(Hamadaフィードバック)

`scripts/build.py` の以下を調整:

```python
# === 血管調整箇所 ===
# Main capillaries: thickness を半分に
make_capillary(..., thickness=0.004, ...)  # → 0.002
make_capillary(..., thickness=0.005, ...)  # → 0.0025

# Fragment capillaries: 数を6→3に減、太さも半減
for i in range(6):  # → range(3)
    ...
    thickness=random.uniform(0.0020, 0.0035)  # → (0.0010, 0.0018)

# === 葉調整箇所 ===
N_LEAVES = 80  # → 40 程度
LEAF_HEIGHT_RANGE = (0.12, 0.28)  # → (0.06, 0.14)  # 6-14cm に縮小
```

### P1 — 反復速度を上げる仕組み

- `live_preview.py` を作成: build.py のパラメータをCLI引数化、Eeveeで即レンダリング
  ```bash
  ./live.sh --leaves 40 --vessels 4 --leaf-size 0.10
  # → preview画像が即出る
  ```
- パラメータ変えながら絵作りを高速にイテレーション

### P2 — Three.js側のチューニング (もし必要なら)

- カメラ初期位置をシーン主軸に合わせる
- ライティング: 環境光をもう少し暖色寄りに
- post-processing で bloom (血管の発光を強調)

### P3 — 質を一段上げるアイデア

- 葉のテクスチャに**より暗いバージョン**を追加 (脊椎の影に隠れる葉用)
- 椎骨の隙間に「枯れた茶色の葉」を混ぜる(廃墟感増)
- 血管の流れにアニメーション(pulse効果) — Three.js shader

---

## Design Decisions Log

```
[2026-05-04] v3 設計確定 (Hamada選択)
  - Q1「絡み合い方」 → B. 脊椎の隙間から葉が芽吹く(廃墟侵食)
  - Q2「周囲の藪」  → ゼロ(脊椎+蔦のみ)
  - Q3「血管の役割」 → 脊椎に絡みつく毛細血管(細く、骨に這う)
[2026-05-03] v2 (周囲リング配置) → Hamada却下「血管バラバラ、草が周りにあるだけ」
[2026-05-03] v1 (procedural-only) → Hamada却下「全然リアルじゃない」
```

---

## Technical Gotchas (前回ハマった箇所)

1. **Polyhaven .blend のマテリアル**は MixRGB 等の複雑ノードを使うため、glTF exporter が認識しない。
   → `blend_to_glb.py` で diff(RGB) + alpha(L) を **PIL で1枚のRGBA PNGに統合**してから ImageTexture→Principled BSDF に直結する最小構成に書き換える。

2. **headless Blender で `bpy.ops.transform_apply` は parented object に対して失敗する**。
   → 代わりに `for v in mesh.vertices: v.co = full_M @ v.co` で頂点に直接行列をベイク、その後 `obj.parent = None; obj.matrix_world = Identity()` でリセット。

3. **alpha cutout のglTF export**: Blender material の `blend_method = 'CLIP'` + `alpha_threshold = 0.5` で alphaMode=MASK が出力される。Three.js では `material.alphaTest = 0.5` と `transparent = false` をペアで設定。

4. **Eeveeのプレビューでは黒い影絵が出る** が、Three.js / Cyclesでは正しく抜ける(Eevee固有の制限)。

5. **Draco圧縮はBlender 4.0.2環境では libextern_draco.so が無く失敗する**。代わりにテクスチャを WebP + 1/4ダウンサンプリングで圧縮。

---

## Asset Licenses

```
spine/scene.gltf  - CC-BY-4.0  - APIL (Sketchfab)
assets/nettle.glb - CC0        - Polyhaven
assets/shrub.glb  - CC0        - Polyhaven
```

ビューワーHUDに帰属表示済み。配布時は維持すること。

---

## Open Questions

- 反復が遅い問題は live_preview.py で解消する予定だが、Web側でリアルタイムにパラメータ変更できる方が良いかも(dat.gui組み込み案)
- Three.js上で葉を distance-based culling して負荷を減らせないか
- モバイルでGPU足りるか実機テスト未実施
