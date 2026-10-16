#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v docker >/dev/null || { echo '请先安装 Docker Engine 与 Docker Compose v2'; exit 1; }
sha256sum -c SHA256SUMS
source ./image-lock.env
docker load -i images.tar
actual_os=$(docker image inspect "$IMAGE" --format '{{.Os}}')
actual_arch=$(docker image inspect "$IMAGE" --format '{{.Architecture}}')
actual_id=$(docker image inspect "$IMAGE" --format '{{.Id}}')
[[ "$actual_os" == "$IMAGE_OS" && "$actual_arch" == "$IMAGE_ARCH" ]] || { echo '镜像平台不匹配，停止部署'; exit 1; }
case " $IMAGE_IDS " in *" $actual_id "*) ;; *) echo '加载后的镜像身份与归档不匹配，停止部署'; exit 1;; esac
echo "镜像已校验：$IMAGE ($actual_arch)"
