# roommate

自作のブラウザゲームを公開するサイト、API、ゲームの配信。作業の規約は [AGENTS.md](AGENTS.md) にある。

サイトは `roommate.hayashi-naoki.com`、API は `api.roommate.hayashi-naoki.com`、ゲームの配信は `play.roommate.hayashi-naoki.com`。

## デプロイ

`main` への push で、GitHub Actions の deploy job が `pnpm turbo run deploy` を実行する。job は Environment `production` を使う。

- `apps/site` はビルドしたサイトをデプロイする
- [`apps/api/scripts/deploy.sh`](apps/api/scripts/deploy.sh) は D1 `roommate` を用意してマイグレーションを当て、`JWT_SECRET` を secret にして Worker をデプロイし、WAF の rate limiting を入れる
- [`apps/play/scripts/deploy.sh`](apps/play/scripts/deploy.sh) は R2 バケット `roommate-games` を用意して、配信 Worker をデプロイする

### GitHub の secrets

Environment `production` に置く。

| 名前                    | 内容                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | デプロイ用の Cloudflare API トークン                                                        |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID                                                                  |
| `JWT_SECRET`            | 匿名 ID のトークンを署名する鍵。デプロイ時に API の Worker secret になる                    |
| `JWT_SECRET_PREVIOUS`   | 鍵を替えたあとしばらく置く、前の鍵。ふだんは置かない。[署名の鍵を替える](#署名の鍵を替える) |

### デプロイ用トークンの権限

アカウントの API トークンを作り、アカウントの権限はアカウントに、ゾーンの権限は `hayashi-naoki.com` に絞る。

アカウント:

- **Workers Scripts: Edit**。Worker の作成とデプロイ、secret、Durable Objects、rate limit の binding に使う。ダッシュボードが新しいロール名なら、Workers 製品全体の **Admin**。`apps/api/wrangler.jsonc` と `apps/play/wrangler.jsonc` の `observability` は、この権限でのデプロイに含まれる
- **D1: Edit**。DB `roommate` の作成とマイグレーション
- **Workers R2 Storage: Edit**。バケット `roommate-games` の作成

ゾーン `hayashi-naoki.com`:

- **Zone: Read**。[`apps/api/scripts/waf-rate-limit.mjs`](apps/api/scripts/waf-rate-limit.mjs) が zone を名前で引く
- **Zone WAF: Edit**。同じスクリプトが `api.roommate.hayashi-naoki.com` に、IP ごとの rate limiting を入れる
- **Workers Routes: Edit**。各 app の `wrangler.jsonc` にある custom domain

ダッシュボードで末尾が Write になっている権限は、上の Edit と同じものを選ぶ。

### ゲームの CI が使う R2 のアップロード用トークン

デプロイ用トークンとは別に、R2 の S3 互換 API 用のトークンを作る。バケット `roommate-games` のオブジェクトだけを読み書きできる。ゲームの CI は Access Key ID と Secret Access Key を `aws s3` に渡す。

1. Cloudflare ダッシュボードの R2 Overview で、API Tokens の Manage を開く
2. Create Account API token を選ぶ
3. 権限は **Object Read & Write** にし、対象をバケット `roommate-games` だけにする
4. 作成直後に一度だけ出る Access Key ID と Secret Access Key を控える。エンドポイントは `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
5. ゲームのリポジトリの Environment `production` に、次の secrets を置く
   - `R2_ACCOUNT_ID` はアカウント ID
   - `R2_ACCESS_KEY_ID` は Access Key ID
   - `R2_SECRET_ACCESS_KEY` は Secret Access Key

ゲームの CI は、このトークンで `<slug>/<file>` を同じキーへ上書きする。

## ローカルで API を動かす

依存は [AGENTS.md](AGENTS.md) の通り入れる。`apps/api/.dev.vars` を作る。このファイルは git に入らない。`wrangler dev` だけが読む。

```
JWT_SECRET=ローカル用のランダムな文字列
ALLOWED_ORIGINS=http://localhost:4321
```

- `JWT_SECRET` は、ローカルで匿名 ID を署名する鍵
- `ALLOWED_ORIGINS` は、追加で API を呼べる origin のカンマ区切り。サイトと配信の origin は常に許す。ローカルのサイトは Astro の既定の `http://localhost:4321`。本番の値は `apps/api/wrangler.jsonc` の空文字のままにする

ローカルの D1 へ、`apps/api/migrations` を当てる。確認が出る。

```sh
pnpm --filter @roommate/api exec wrangler d1 migrations apply DB --local
```

API を起動する。`http://127.0.0.1:8787` で開く。

```sh
pnpm --filter @roommate/api dev
```

ローカルのサイトからこの API を呼ぶときは、サイトの起動時に `PUBLIC_API_ORIGIN=http://127.0.0.1:8787` を付ける。

## D1 を前の時点に戻す

本番の D1 `roommate` は Time Travel が常に有効で、過去 7 日のうちの任意の時点へ戻せる。7 日は今の Workers Free プランの長さで、Workers Paid にすると 30 日になる。データベース全体をその時点の内容で上書きし、実行中のクエリは中断される。戻したあとも、それより前の時点へは戻せる。

`wrangler` にログインした状態で、リポジトリの root から実行する。

戻す時点の bookmark を見る。`--timestamp` は Unix 秒か RFC3339。省略すると今の bookmark が出る。

```sh
pnpm --filter @roommate/api exec wrangler d1 time-travel info roommate --timestamp="2026-11-07T12:00:00Z"
```

その時点へ戻す。確認のあと上書きする。

```sh
pnpm --filter @roommate/api exec wrangler d1 time-travel restore roommate --timestamp="2026-11-07T12:00:00Z"
```

出力に、戻す前の bookmark が出る。その bookmark を指定すると、戻す前の状態に戻せる。

```sh
pnpm --filter @roommate/api exec wrangler d1 time-travel restore roommate --bookmark=<previous-bookmark>
```

## 署名の鍵を替える

API は `JWT_SECRET` で匿名 ID のトークンに署名する。替えると、前の鍵で署名したトークンが通らなくなり、遊んだ人は新しい ID になる。前の鍵を `JWT_SECRET_PREVIOUS` に置いておくと、その間は前の鍵のトークンも通り、発行し直すときに今の鍵のトークンに替わる。

1. 新しい鍵を作る

   ```sh
   openssl rand -base64 48
   ```

2. GitHub の Environment `production` で、今の鍵を `JWT_SECRET_PREVIOUS` に置き、`JWT_SECRET` を新しい鍵にする
   - GitHub の secret は読み出せないので、今の鍵の控えが無ければ前の鍵は置けない。その場合は全員が新しい ID になる
3. main の CI の deploy job を実行し直す。API の Worker に両方の鍵が入る
4. 前の鍵は約 395 日残す。トークンの期限 30 日と、期限切れから発行し直せる猶予 1 年を足した長さで、それより長く開いていない人は前の鍵を外すと新しい ID になる
5. 外すときは、GitHub の `JWT_SECRET_PREVIOUS` を消し、Worker からも消す。deploy は書いていない secret を消さないため

   ```sh
   pnpm --filter @roommate/api exec wrangler secret delete JWT_SECRET_PREVIOUS
   ```

鍵が漏れて替えるときは、`JWT_SECRET_PREVIOUS` を置かない。前の鍵が通るあいだは、漏れた鍵で作ったトークンも通るため。すでに置いてあれば上の 5 で消す。

## スコアを隠す・消す

本番のスコアを見る・隠す・消すスクリプトは [`apps/api/scripts/scores.sh`](apps/api/scripts/scores.sh)。使い方はファイル先頭のコメントにある。

ゲームごとの確かめる点数(`packages/catalog` の `holdScoreAbove`)を超えたスコアは保留になり、承認するまでランキングに出ない。`scores.sh held` で一覧を見て、`approve` で承認、`hide` で却下する。

## 死活監視

UptimeRobot の無料プランで、本番を 5 分ごとに外から見ている。落ちると roommate@hayashi-naoki.com にメールが届く。

- `https://api.roommate.hayashi-naoki.com/health`
- `https://api.roommate.hayashi-naoki.com/games/grapnl/rankings/2026-10-31`: 本文に `"entries"` があるか。`/health` は D1 に触れないので、D1 の障害はこちらで気づく
- `https://roommate.hayashi-naoki.com/`
- `https://play.roommate.hayashi-naoki.com/grapnl/`
