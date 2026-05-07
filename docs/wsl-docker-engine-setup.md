# WSL2 + Docker Engine 運用手順 (Docker Desktop なし)

この手順は、Windows で Docker Desktop を使わずに `docker compose` を運用するためのものです。
対象は WSL2 上の Ubuntu です。

## 0. この手順が必要なケース

- Docker Desktop のライセンス運用を避けたい
- 既存の `docker-compose.yml` をなるべくそのまま使いたい
- VS Code は `WSL` で利用できる

## 1. WSL 状態の確認

PowerShell で実行:

```powershell
wsl -l -v
wsl --status
```

確認ポイント:

- `Ubuntu` が存在する
- `VERSION` が `2`

### 既知エラー: ERROR_ALREADY_EXISTS

`wsl --install` 実行時に次のエラーが出る場合があります。

- `Wsl/InstallDistro/ERROR_ALREADY_EXISTS`

意味:

- すでに同名ディストリビューション (例: Ubuntu) が存在する

対応:

- 再インストール不要。既存 Ubuntu を使う
- Ubuntu 起動確認:

```powershell
wsl -d Ubuntu -e bash -lc "echo WSL_OK && uname -a"
```

## 1.5 Ubuntu への入り方

Windows 側から Ubuntu シェルへ入る方法です。

PowerShell / コマンドプロンプトから入る:

```powershell
wsl -d Ubuntu
```

既定ディストリビューションが Ubuntu の場合:

```powershell
wsl
```

Windows Terminal から入る:

- 新しいタブの `Ubuntu` プロファイルを選択

入れたか確認する:

```bash
uname -a
pwd
```

終了する:

```bash
exit
```

## 1.6 Ubuntu 起動直後にやる初回 3 コマンド

Ubuntu に入った直後は、次の 3 コマンドを順に実行すると後続手順が進めやすくなります。

```bash
# 1) Ubuntu 側で動作していることを確認
uname -a

# 2) パッケージ一覧を更新
sudo apt-get update

# 3) Docker 導入で使う基本ツールを先に入れる
sudo apt-get install -y ca-certificates curl gnupg
```

補足:

- VS Code の非対話ターミナルでは `wsl -d Ubuntu` が終了コード 1 になる場合があります。
- その場合は、対話シェル確認コマンドとして次を使ってください。

```powershell
wsl -d Ubuntu -e bash -lc "echo WSL_OK && uname -a"
```

## 2. Ubuntu に Docker Engine を導入

Ubuntu (WSL) に入って実行:

```bash
sudo apt-get remove -y docker docker-engine docker.io containerd runc
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

権限設定:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

動作確認:

```bash
docker version
docker compose version
docker run --rm hello-world
```

## 3. このリポジトリの起動/停止

WSL 側でリポジトリを開き、次を実行:

```bash
docker compose up -d
docker compose ps
```

停止:

```bash
docker compose down
```

## 4. VS Code 連携

- 拡張機能 `Remote - WSL` を使用
- コマンドパレット: `WSL: Reopen Folder in WSL`
- 以後、VS Code ターミナルは WSL 側コマンドで運用

## 5. 運用上の注意

- 性能面では `/mnt/d/...` より WSL ホーム配下の作業ディレクトリ推奨
- `docker-desktop` ディストリビューションが存在していても、WSL 側 Docker Engine 運用は可能
- Docker Desktop を完全に使わない場合は、停止またはアンインストールを検討

## 6. トラブルシュート

### `Cannot connect to the Docker daemon`

- Ubuntu 側で Docker 導入手順完了を再確認
- `docker version` の Server 情報が表示されるか確認

### `permission denied while trying to connect to the Docker daemon socket`

- `sudo usermod -aG docker $USER` を実行済みか確認
- シェル再ログイン後に再実行

### `docker compose` が見つからない

- `docker-compose-plugin` の導入を確認
- `docker compose version` で確認
