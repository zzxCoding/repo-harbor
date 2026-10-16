"""Package the standalone project and an audited Linux AMD64 image."""
import hashlib
import json
import pathlib
import shutil
import sys
import tarfile

root = pathlib.Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text())["version"]
dest = pathlib.Path(sys.argv[1]).resolve()
assert dest.is_dir(), "export and audit the image first"
assert {p.name for p in dest.iterdir()} == {"images.tar", "image-audit.json", "image-lock.env"}, "output must contain only the audited image files"
audit = json.loads((dest / "image-audit.json").read_text())
assert audit["image"] == f"repo-harbor:{version}-amd64" and audit["platform"] == "linux/amd64"
for file in (root / "deploy").iterdir():
    shutil.copy2(file, dest / file.name)
for name in ["deploy.sh", "load.sh", "backup.sh", "upgrade.sh"]:
    (dest / name).chmod(0o755)
for name in ["LICENSE", "THIRD_PARTY_NOTICES.md"]:
    shutil.copy2(root / name, dest / name)
shutil.copytree(root / "docs", dest / "docs")
(dest / "README.md").write_text((root / "docs/OFFLINE.md").read_text().replace(
    "[运维说明](OPERATIONS.md)", "[运维说明](docs/OPERATIONS.md)"))
directories = ["src", "public", "scripts", "deploy", "test", "docs", ".github"]
files = ["package.json", "package-lock.json", "Dockerfile", "compose.yml", ".gitignore", ".dockerignore", ".env.example", "README.md", "DESIGN.md", "THIRD_PARTY_NOTICES.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"]
excluded = {"node_modules", "evidence", "__pycache__", ".git", ".env", "backups", "delivery", ".DS_Store"}
with tarfile.open(dest / "source.tar.gz", "w:gz") as tar:
    candidates = [root / name for name in files]
    for directory in directories:
        candidates.extend((root / directory).rglob("*"))
    for file in sorted(candidates):
        relative = file.relative_to(root)
        if not file.is_file() or file.is_symlink() or any(part in excluded for part in relative.parts):
            continue
        if file.name.startswith(".env") and file.name != ".env.example":
            continue
        tar.add(file, arcname="repo-harbor/" + relative.as_posix(), recursive=False)

def sha(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

files = [p for p in sorted(dest.rglob("*")) if p.is_file()]
(dest / "SHA256SUMS").write_text("".join(f"{sha(p)}  {p.relative_to(dest).as_posix()}\n" for p in files))
bundle = dest.parent / (dest.name + ".tar.gz")
with tarfile.open(bundle, "w:gz", compresslevel=6) as tar:
    tar.add(dest, arcname=dest.name)
checksum = sha(bundle)
(bundle.parent / (bundle.name + ".sha256")).write_text(f"{checksum}  {bundle.name}\n")
print(f"bundle={bundle}\nsize={bundle.stat().st_size}\nsha256={checksum}")
