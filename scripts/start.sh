#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo '请先安装 Docker Engine 与 Docker Compose v2'; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
created=false
if [[ ! -f .env ]]; then
  umask 077
  password=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
  port=${PORT:-8093}
  [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || { echo 'PORT 需为 1–65535'; exit 1; }
  volume=${DATA_VOLUME:-code-atlas-data}
  [[ "$volume" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'DATA_VOLUME 名称格式错误'; exit 1; }
  printf 'ADMIN_BOOTSTRAP_PASSWORD=%s\nPORT=%s\nBIND_ADDRESS=%s\nDATA_VOLUME=%s\n' "$password" "$port" "${BIND_ADDRESS:-0.0.0.0}" "$volume" > .env
  created=true
fi
chmod 600 .env
docker compose --env-file .env -f compose.yml up -d --build --pull never
ready=false
for attempt in $(seq 1 60); do
  id=$(docker compose --env-file .env -f compose.yml ps -q atlas)
  if [[ -n "$id" && $(docker inspect "$id" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}') == healthy ]]; then ready=true; break; fi
  sleep 2
done
if [[ "$ready" != true ]]; then echo '健康检查尚未通过，请运行 docker compose --env-file .env -f compose.yml logs --tail=100 atlas'; exit 1; fi
port=$(sed -n 's/^PORT=//p' .env)
echo "RepoHarbor 页面：http://服务器IP:${port:-8093}"
if [[ "$created" == true ]]; then printf '首次管理密码：%s\n' "$password"; else echo '使用现有管理密码；如已在页面修改，请使用修改后的密码。'; fi
echo '登录后在页面配置 GitLab、添加仓库；在 AI 接入页创建限定仓库的读取令牌。'
