# 記事の追加方法

このフォルダに markdown を置いて、ビルドスクリプトを実行すると
`https://phasera.jp/cases/<slug>/` に記事ページが生成されます。

## 手順（3ステップ）

1. このフォルダに `my-article.md` を作る（下の雛形をコピー）
2. `node scripts/build-articles.mjs` を実行
   → `cases/<slug>/index.html` 生成 + `/cases/` の一覧 + `sitemap.xml` が自動更新
3. `git add -A && git commit && git push`（Git連携済みなら push だけで本番反映）

## 雛形

```markdown
---
title: 記事タイトル
description: 一覧と検索結果に出る説明文。120字目安。
date: 2026-07-15
tag: 士業
slug: my-article
draft: true
---

## 最初の見出し

本文。**太字**、[リンク](https://example.com)、`コード` が使えます。

- 箇条書き
- も使えます
```

## ルール

- `draft: true` の間は公開されません（ビルド対象外）。公開時に行ごと削除するか `false` に
- `slug` は半角英数とハイフンのみ。省略するとファイル名が slug になります
- 記事を消したいときは md ファイルを削除して再ビルド（生成ページも自動で消えます）
- 見出しは `##` から使う（`#` はページタイトルとして自動で出るため `##` に変換されます）
- 対応記法: 見出し / 段落 / 太字・斜体 / リンク / 画像 / 箇条書き・番号リスト / 引用 / コード / 表 / 罫線
