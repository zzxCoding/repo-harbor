#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
old_dir=${1:-}
if [[ -z "$old_dir" ]]; then
  if [[ -f ../code-atlas-0.1.2-linux-amd64/.env ]]; then
    old_dir=../code-atlas-0.1.2-linux-amd64
  elif [[ -f ../code-atlas-0.1.1-linux-amd64/.env ]]; then
    old_dir=../code-atlas-0.1.1-linux-amd64
  else
    old_dir=../code-atlas-0.1.0-linux-amd64
  fi
fi
[[ -f "$old_dir/.env" ]] || { echo '请把旧部署目录作为参数传入，例如 ./upgrade.sh ../code-atlas-0.1.2-linux-amd64'; exit 1; }
if [[ ! -f .env ]]; then
  umask 077
  cp -- "$old_dir/.env" .env
  chmod 600 .env
else
  cmp -s .env "$old_dir/.env" || { echo '新旧目录的部署配置不同，请核对数据卷和端口后再升级；配置未被覆盖。'; exit 1; }
fi
./load.sh
./backup.sh
./deploy.sh
echo '升级完成。已有仓库、GitLab 凭据、管理密码和 AI 读取令牌保留。仓库会自动恢复并继续同步。'
echo 'AI 接入页可编辑原有读取令牌的仓库范围。新配置格式为 version=2，回退旧应用需恢复升级前备份。'
