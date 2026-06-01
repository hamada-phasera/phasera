# Anatomical Garden — Web Background

3DシーンをWebサイトの背景として埋め込むためのWeb Component。

## ファイル

```
garden.glb                # 3Dシーン本体 (13MB)
anatomical-garden-bg.js   # Web Component
example.html              # 統合デモ
```

## 最小組込み

```html
<script type="module" src="./anatomical-garden-bg.js"></script>

<anatomical-garden-bg src="./garden.glb"></anatomical-garden-bg>

<main style="position: relative; z-index: 1;">
  <!-- あなたのコンテンツ -->
</main>

<style>
  anatomical-garden-bg { position: fixed; inset: 0; z-index: 0; }
</style>
```

`pointer-events: none` は内部で設定済み。背景はクリック貫通します。

## 属性

| 属性 | デフォルト | 説明 |
|---|---|---|
| `src` | (必須) | GLBファイルのURL |
| `rotate-speed` | `0.15` | 自動回転速度 (0で停止) |
| `exposure` | `1.05` | トーンマッピング露出 |
| `vignette` | `0.55` | ビネット強度 (0..1) |
| `overlay-color` | `#0a0a0f` | オーバーレイ色 |
| `overlay-opacity` | `0.35` | オーバーレイ不透明度 (前景テキスト可読性) |
| `fog-near` / `fog-far` | `5` / `18` | フォグ範囲 |
| `camera-distance` | `4.4` | カメラ初期距離 |
| `camera-height` | `1.4` | カメラ初期高さ |
| `target-height` | `0.75` | カメラ注視点Y |
| `pixel-ratio-cap` | `2` | 最大DPR (モバイル省電力用) |
| `paused-when-hidden` | (任意) | 属性付与でオフスクリーン時に描画停止 |

## イベント

```js
const el = document.querySelector('anatomical-garden-bg');
el.addEventListener('garden-loaded', () => console.log('ready'));
el.addEventListener('garden-error', (e) => console.error(e.detail));
```

## アクセシビリティ

- `prefers-reduced-motion: reduce` を尊重して自動回転停止
- WebGL未対応時はグラデーション背景にフォールバック
- 背景画像扱いなのでスクリーンリーダーで読まれない

## 配信時の注意

1. **MIMEタイプ**: `.glb` を `model/gltf-binary` として配信 (Apache/Nginxは要設定)
2. **gzip/brotli圧縮**: GLBはWebPテクスチャ込みなので追加圧縮の効果は薄いが、転送経路で `Cache-Control: max-age=31536000, immutable` を設定推奨
3. **CORSが必要な配信**: 別ドメインから読む場合 `Access-Control-Allow-Origin` を設定
4. **CDN推奨**: 13MB一発ロードなので、ユーザーに近いCDNから配信するのが理想

## GLB差し替え (再ビルド時)

Hamadaが Blender で `scripts/build.py` を編集して新しいGLBを生成したら:

```bash
cp outputs/garden_compressed.glb outputs/web-bg/garden.glb
# JS側の変更不要。リロードで反映
```

## ライセンス

- Spine: APIL CT scan (Sketchfab, CC-BY-4.0) — 配布時はクレジット表示維持
- Plants: Polyhaven Nettle (CC0)
