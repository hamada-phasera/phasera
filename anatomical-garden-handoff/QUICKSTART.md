# Claude Code Quick Start

このプロジェクトを Claude Code で開いたら、最初に Claude にこう言ってください:

```
@CLAUDE.md を読んで現状を把握してから、次のタスクをやってほしい:
P0タスク (血管と草を小さく/少なく) を実装してプレビューまで出して。
完了したら preview.png を見せて。
```

または段階的に:

```
1. まず @CLAUDE.md を読んで現状理解
2. scripts/build.py の血管 thickness を半分に、N_LEAVES を 40 に変更
3. blender --background --python scripts/build.py 実行
4. blender --background --python scripts/preview.py 実行
5. preview.png を私に見せて (ローカルで viewer 開くから)
6. 私が「OK」と言ったら scripts/compress.py → scripts/build_viewer.py まで実行して outputs/ にHTML置いて
```

---

## 環境セットアップ

```bash
# Blender 4.0+ 必須
blender --version  # Blender 4.0.2 で動作確認済み

# Python 3.10+
python3 --version

# Pillow 必須 (RGBA テクスチャ統合用)
pip install Pillow

# ローカルで Web ビューワー試す用
python3 -m http.server 8000
# → open http://localhost:8000/outputs/garden_viewer.html
```

---

## 開発ループ (推奨)

```
編集 scripts/build.py
   ↓
blender --background --python scripts/build.py     (~30s)
   ↓
blender --background --python scripts/preview.py   (~120s)
   ↓
open preview.png  ← Blenderプレビューで構図確認
   ↓
[OK ならば]
blender --background --python scripts/compress.py  (~15s)
python3 scripts/build_viewer.py                    (~3s)
   ↓
open outputs/garden_viewer.html  ← 実機で最終確認
```

reload速度を上げたいなら: live_preview.py を P1タスクで作る。
