#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null
command -v python3 >/dev/null
version=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
image="repo-harbor:${version}-amd64"
dest=${1:-"delivery/repo-harbor-${version}-linux-amd64"}
[[ ! -e "$dest" ]] || { echo '输出目录已存在，请选择一个新目录；已有文件未被覆盖。'; exit 1; }
mkdir -p -- "$dest"
dest=$(cd -- "$dest" && pwd)
docker build --platform linux/amd64 --build-arg "APP_VERSION=$version" -t "$image" .
docker save -o "$dest/images.tar" "$image"
image_id=$(docker image inspect "$image" --format '{{.Id}}')
python3 scripts/image-audit.py "$dest/images.tar" "$image" "$image_id" "$dest"
python3 scripts/package-release.py "$dest"
