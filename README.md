# 写真パズル

ブラウザ内だけで選んだ写真を扱う、ビルド依存のない静的サイトです。選んだ写真はこの端末内で読み込み、サーバーへ送信・保存しません。HTML/CSS/JavaScriptだけで動作し、ログインや共有機能はありません。

## ローカルで確認する

Node.js 22以降を用意し、プロジェクトルートで実行します。

```sh
node --check puzzle.js
node --test tests/puzzle.test.cjs
node scripts/build.mjs
```

生成物は `dist/` に作られます。このフォルダーに含まれるのは公開用の `index.html`、`styles.css`、`puzzle.js` のみです。開発テストやスクリプト、旧画像素材は含めません。`dist/` はGit対象外です。

## GitHub Pagesで公開する

1. この `outputs` の中身をGitHubリポジトリのルートに置き、`main` ブランチへpushします。
2. GitHubのリポジトリ設定で **Settings → Pages → Build and deployment → Source → GitHub Actions** を選びます。
3. `main` へのpush後、Actionsの **Deploy static site to GitHub Pages** が成功すると公開URLが表示されます。`.github/workflows/pages.yml` がテスト、静的ファイルのビルド、Pagesへのデプロイを行います。

GitHub FreeではPagesを使うリポジトリは公開リポジトリである必要があります。ソースコードを公開したくない場合は、有料プランの条件を確認するかCloudflare Pagesを利用してください。GitHub PagesのURL自体は誰でも閲覧でき、アプリに認証・アクセス制限はありません。

## Cloudflare Pagesで公開する場合

Cloudflare PagesでGitリポジトリを接続し、Production branchを `main`、Build commandを `node scripts/build.mjs`、Build output directoryを `dist` に設定します。フレームワークプリセットは不要です。

## スマートフォンと写真

320、375、390、414、768px以上を想定したレイアウトです。写真は縦横比を保ち、6×6に分けます。極端に横長な写真ではタイルのタップ領域を保つため、盤面内のみ左右スクロールします。縦長写真ではページを縦にスクロールできます。

## プライバシー

写真をサーバーや外部サービスへ送らず、永続保存もしません。公開サイト自体はインターネット上で誰でも開けるページです。`noindex` は検索向け設定であり、アクセス制限ではありません。
