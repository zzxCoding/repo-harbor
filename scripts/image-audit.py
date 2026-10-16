"""Verify Docker/OCI archive identity and emit a portable platform lock."""
import hashlib
import json
import pathlib
import sys
import tarfile

archive, image, inspected_id, output = sys.argv[1:]
with tarfile.open(archive, "r") as tar:
    names = {m.name for m in tar.getmembers() if m.isfile()}
    def read(name):
        return tar.extractfile(name).read()
    def digest(name):
        h = hashlib.sha256()
        with tar.extractfile(name) as stream:
            while chunk := stream.read(1024 * 1024):
                h.update(chunk)
        return "sha256:" + h.hexdigest()
    identities = set()
    audited_layers = set()
    platforms = []
    if "index.json" in names:
        def visit(descriptor):
            name = "blobs/sha256/" + descriptor["digest"].split(":", 1)[1]
            assert digest(name) == descriptor["digest"], "manifest digest mismatch"
            manifest = json.loads(read(name))
            if "manifests" in manifest:
                for child in manifest["manifests"]:
                    visit(child)
                return
            if "config" not in manifest or "layers" not in manifest:
                return
            config_name = "blobs/sha256/" + manifest["config"]["digest"].split(":", 1)[1]
            config = json.loads(read(config_name))
            if config.get("os") != "linux" or config.get("architecture") != "amd64":
                return
            assert digest(config_name) == manifest["config"]["digest"], "config digest mismatch"
            identities.update([descriptor["digest"], manifest["config"]["digest"]])
            platforms.append("linux/amd64")
            for layer in manifest["layers"]:
                layer_name = "blobs/sha256/" + layer["digest"].split(":", 1)[1]
                if layer_name not in audited_layers:
                    assert digest(layer_name) == layer["digest"], "layer digest mismatch"
                    audited_layers.add(layer_name)
        for descriptor in json.loads(read("index.json"))["manifests"]:
            visit(descriptor)
    if "manifest.json" in names:
        entries = [entry for entry in json.loads(read("manifest.json")) if image in (entry.get("RepoTags") or [])]
        assert len(entries) == 1, "archive must contain the requested image tag exactly once"
        entry = entries[0]
        config = json.loads(read(entry["Config"]))
        assert config["architecture"] == "amd64" and config["os"] == "linux", "wrong platform"
        identities.add(digest(entry["Config"]))
        platforms.append("linux/amd64")
        for layer in entry["Layers"]:
            assert layer in names, "missing layer"
            if layer not in audited_layers:
                digest(layer)
                audited_layers.add(layer)
    assert platforms and inspected_id in identities, "inspected image identity is not proved by archive"
report = {"image": image, "platform": "linux/amd64", "acceptedIds": sorted(identities), "inspectedId": inspected_id, "layersChecked": len(audited_layers), "credentials": "not supplied during build or export"}
dest = pathlib.Path(output)
dest.mkdir(parents=True, exist_ok=True)
(dest / "image-audit.json").write_text(json.dumps(report, indent=2) + "\n")
(dest / "image-lock.env").write_text(f"IMAGE={image}\nIMAGE_OS=linux\nIMAGE_ARCH=amd64\nIMAGE_IDS='{' '.join(sorted(identities))}'\n")
print(json.dumps(report))
