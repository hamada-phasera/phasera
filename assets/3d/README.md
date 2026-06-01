# Phasera — 3D / Blender Asset Slots

このフォルダは、Phasera HP の per-section 3Dビジュアルを **Blenderで本気のフォトリアル品質**に到達させるためのアセット投入口です。

ファイルが存在しなければ、Three.js procedural の fallback が表示されます（progressive enhancement）。Blender で書き出したアセットを下記のファイル名・パスで置くと、自動的にコードが拾って差し替えます。

---

## ファイル一覧（10シーン分）

| # | section | ファイル | 形式 | 寸法 | 必須？ |
|---|---|---|---|---|---|
| 1 | HOOK | `hook.png` | PNG (Cycles render) | 2880×1620 | optional |
| 2 | PROBLEM | `problem.mp4` (or `.webm`) | MP4 / WebM, 30fps loop | 1920×1080, 6秒 | optional |
| 3 | GUIDE | `guide.png` | PNG portrait | 1920×2400 (4:5) | recommended |
| 4·1 | DIAGNOSE | `diagnose/0001.png`〜`0120.png` | image-sequence | 1920×1080, 4秒分 | optional |
| 4·2 | BUILD | `build.mp4` | MP4 / WebM | 1920×1080, 5秒 loop | optional |
| 4·3 | SUSTAIN | `sustain.glb` + `sustain-env.hdr` | glTF binary + HDRI | <2MB / 1MB | optional |
| 4·4·a | INDUSTRY 士業 | `industry-shigyo.jpg` | JPEG | 1500×1500 (1:1) | recommended |
| 4·4·b | INDUSTRY 派遣 | `industry-haken.jpg` | JPEG | 1500×1500 (1:1) | recommended |
| 4·5 | **VISUAL (最重要)** | `visual.glb` + `visual-hero.png` | glTF binary + Cycles still | <5MB / 2880×1620 | **必須** |
| 5 | TRANSFORMATION | `transformation.mp4` | MP4 / WebM | 1920×1080, 4秒 loop | optional |
| 6 | CALL | — | — | — | 不要（softStill） |

---

## Blender 制作前提（全アセット共通）

### Color Palette（DNA）

| 役割 | Hex | 備考 |
|---|---|---|
| ベース紙色 | `#F2F5FA` | 全シーンの背景／余白 |
| インク | `#0B1E3F` | メイン構造線・暗部 |
| インク2 | `#1E3358` | 中間階調 |
| アクセント blue | `oklch(0.62 0.18 250)` ≈ `#3C66D9` | 発光・反射 |
| ライト blue | `#6FA8FF` / `#9CC4FF` | ハイライト・rim |

サブカラーは導入しないこと。新色を追加するとブランドが崩れる。

### マテリアル

- **PBR ベース**：Principled BSDF
- **Roughness**：0.18–0.40（金属／ガラスの質感を出す）
- **Metallic**：0.6–0.85（spine要素は high metallic）
- **Transmission**：VISUAL章のオブジェクトのみ 0.85 (ガラス表現)、他は 0
- **Clearcoat**：1.0（VISUAL のみ）
- **Emission**：blue系を控えめに（emissiveIntensity 0.04–1.6）

### ライティング

- **3 点照明**：key（white 6500K, intensity 1.2）／ rim（cool blue, 0.9）／ fill（warm white, 0.3）
- **ambient**：薄く `#E6EEFB`（0.55）
- **HDRI**：studio_small_03.exr 系のクール環境マップ。彩度を一段下げる
- **fog**：`#E9EFF8`、distance 14–46

### レンダー設定

- **エンジン**：Cycles（GPU、OptiX denoise 推奨）
- **Sample**：最低 256（重要シーンは 512+）
- **Color Management**：View Transform = AgX（推奨）or Filmic
- **Output**：sRGB、8bit PNG / JPEG quality 92+
- **解像度**：Retina 想定で ×2（記載寸法の2倍は不要、記載通りでOK）

### 動画 / ループ

- **Format**：H.264 MP4 + WebM (VP9) の両方推奨
- **Bitrate**：4–8 Mbps（背景なので過剰にしない）
- **Loop seamless**：開始フレーム ≒ 終了フレームに調整
- **Length**：4–6秒（短い方が良い、CPUデコード負荷を下げる）
- **Audio**：なし

### GLB エクスポート

- **Format**：glTF 2.0 binary (.glb)
- **Compression**：Draco mesh compression 有効
- **Textures**：埋め込み、KTX2 圧縮推奨
- **Size cap**：visual.glb は **5MB 以下**を厳守
- **Animation**：含めない（コード側で回転制御）

---

## VISUAL章（最重要）— Blender 制作の指針

VISUAL章は Phasera の「3Dクリエイター能力」を見せるショーケース。これだけは妥協なしで作る。

### 推奨モチーフ案

1. **抽象的な"軸"の象徴**：背骨／柱／樹木が金属＋ガラス質感で交差するオブジェ（最有力）
2. **時間が結晶化したオブジェ**：時計／カレンダーが幾何学的に再構成された造形
3. **業務の漏れ穴を逆さに**：紙束が螺旋状に立ち上がる像

いずれも：

- ターンテーブル可能な単体オブジェクト（軸=Y軸、回転で見栄え変化）
- 高さ 1.5–2 ユニット相当
- メイン素材：金属（navy）＋ガラス（白）＋発光（blue accent）
- 背景は透過（PNG）、後で Three.js 側で envMap 反射が乗る

### コード側の配置

GLB は原点 (0, 0, 0) を中心に置く。コード側で `position(3.0, 0, 0)`、回転軸調整、scale 1.0 で配置される。

---

## コード側の挙動（progressive enhancement）

`Phasera/index.html` の Three.js は起動時に：

1. `assets/3d/visual.glb` を `GLTFLoader.load()` で取得試行
2. **成功** → fallback の icosahedron を `remove`、Blender モデルを scene に追加
3. **失敗（404 or parse error）** → サイレントフォールバック、icosahedron のまま

他のアセット（PNG / MP4）の取り込みは **次のフェーズで実装予定**。現在は GLB のみ自動拾い上げ。PNG/MP4 を反映するには、以下のいずれか：

- `<img>` / `<video>` タグを HTML に追加（プラン §8 の Blender Deliverable Spec を参照）
- 個別のセクションに `<img class="render-overlay" src="assets/3d/hook.png">` を入れる

実装が必要になったらお知らせください。

---

## 提出フロー

1. このフォルダにファイルを配置
2. ファイル名は厳守
3. ブラウザで `Phasera/index.html` を開いて差し替えを確認
4. デプロイ前に DevTools の Network タブで全アセットが 200 で配信されることを確認

---

## 参考

- プランファイル：`/Users/hamadahiromu/.claude/plans/atent-dev-pipeline-glass-ui-design-narra-unified-metcalfe.md` の §8 Per-section ビジュアル設計 と Blender Deliverable Spec を参照
