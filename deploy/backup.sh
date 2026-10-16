#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source ./image-lock.env
umask 077
mkdir -p backups
file="backups/code-atlas-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
container=$(docker compose --env-file .env -f compose.yml ps -q atlas)
[[ -n "$container" ]] || { echo '请先启动服务再备份'; exit 1; }
volume=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
[[ -n "$volume" ]] || { echo '备份脚本需要命名数据卷'; exit 1; }
docker compose --env-file .env -f compose.yml stop atlas
trap 'docker compose --env-file .env -f compose.yml start atlas' EXIT
docker run --rm --platform linux/amd64 --network none --read-only --entrypoint tar -v "$volume":/data:ro "$IMAGE" czf - -C /data . > "$file"
printf '备份已保存：%s（包含配置、加密密钥、源码快照与索引，请保护此文件）\n' "$file"
