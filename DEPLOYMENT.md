# Phasera — デプロイ手順

| 項目 | 値 |
|------|-----|
| 本番 | https://phasera.jp （+ www / phasera.vercel.app） |
| Vercel プロジェクト | hamahiro1668s-projects/phasera |
| 形式 | 純静的（ビルド不要・フレームワーク非検出） |

## デプロイ方法

**Git 連携済み**: `main` に push すると自動で本番デプロイされます。
それ以外のブランチへの push はプレビューデプロイになります。

```bash
git push origin main   # → 本番反映
```

CLI で手動デプロイする場合（Git 連携のバックアップ手段）:

```bash
vercel deploy --prod
```

戻したいとき: `vercel rollback`

## 記事の追加

`content/articles/` に markdown を置いて `node scripts/build-articles.mjs` → commit & push。
詳細は [content/articles/README.md](content/articles/README.md)。
