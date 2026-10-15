"""cocode 酷码工作室 · Cocode Studio VideoForge — source-only release archive."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "Cocode-Studio-VideoForge"
FILES = [
    "package.json", "package-lock.json", "tsconfig.json", ".npmrc",
    ".env.example", ".gitignore", ".dockerignore", "cordis.patch.yml",
    "Dockerfile", "compose.yaml", "start.ps1", "start.sh", "README.md",
    "DEPLOYMENT.md",
]
DIRECTORIES = ["plugins", "shared", "scripts", "tests", "deploy", "docs", "decisions", "vendor", "runtime"]
EXCLUDED = {"node_modules", "lib", "__pycache__", ".git", ".env", "video_projects", "logs", ".dsh-videoforge", ".test-artifacts", "releases", ".runtime", ".venv-tts"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    provenance = json.loads((ROOT / "vendor/dsh/provenance.json").read_text(encoding="utf-8"))
    for artifact in provenance["artifacts"]:
        path = ROOT / "vendor/dsh" / artifact["file"]
        if path.stat().st_size != artifact["bytes"] or digest(path.read_bytes()) != artifact["sha256"]:
            raise ValueError(f"DSH archive checksum mismatch: {path.name}")
    source_archive = ROOT / "vendor/dsh/deepseek-harness-0.1.0-rc.6-source.tar.gz"
    # Inspect upstream without extracting or changing any upstream files.
    with tarfile.open(source_archive, "r:gz") as archive:
        names = archive.getnames()
        for name in names:
            if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
                raise ValueError("Unsafe upstream archive path")
        manifest_name = next(n for n in names if n.endswith("/apps/cli/package.json"))
        manifest = json.load(archive.extractfile(manifest_name))
        assert manifest["version"] == provenance["version"]
        assert any(n.endswith(".ts") and "/packages/" in n for n in names)
        assert any(n.endswith("/LICENSE") for n in names)
        upstream_files = len([n for n in archive.getmembers() if n.isfile()])
    paths = [ROOT / name for name in FILES]
    for directory in DIRECTORIES:
        paths.extend(p for p in (ROOT / directory).rglob("*") if p.is_file()
                     and not any(part in EXCLUDED for part in p.relative_to(ROOT).parts)
                     and p.suffix not in {".pyc", ".tsbuildinfo"})
    paths = sorted(set(paths), key=lambda p: p.relative_to(ROOT).as_posix())
    release = ROOT / "releases"
    release.mkdir(exist_ok=True)
    destination = release / "Cocode-Studio-VideoForge-1.0.0-source-with-dsh.zip"
    temporary = destination.with_suffix(".zip.tmp")
    manifest_lines = []
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in paths:
            if path.is_symlink():
                raise ValueError(f"Refusing symlink: {path}")
            relative = path.relative_to(ROOT).as_posix()
            if any(part in EXCLUDED for part in PurePosixPath(relative).parts):
                raise ValueError(f"Excluded path: {relative}")
            data = path.read_bytes()
            archive.writestr(f"{PREFIX}/{relative}", data)
            manifest_lines.append(f"{digest(data)}  {relative}\n")
        archive.writestr(f"{PREFIX}/SOURCE-MANIFEST.sha256", "".join(manifest_lines))
    with zipfile.ZipFile(temporary) as archive:
        assert archive.testzip() is None, "ZIP CRC check failed"
        for line in archive.read(f"{PREFIX}/SOURCE-MANIFEST.sha256").decode().splitlines():
            expected, name = line.split("  ", 1)
            assert digest(archive.read(f"{PREFIX}/{name}")) == expected, name
        assert f"{PREFIX}/.npmrc" in archive.namelist()
        assert f"{PREFIX}/.env.example" in archive.namelist()
        for plugin in ("cocode-studio-ui", "cocode-director", "cocode-data-store"):
            assert f"{PREFIX}/plugins/{plugin}/index.ts" in archive.namelist()
            assert f"{PREFIX}/plugins/{plugin}/package.json" in archive.namelist()
    temporary.replace(destination)
    checksum = digest(destination.read_bytes())
    destination.with_suffix(".zip.sha256").write_text(f"{checksum}  {destination.name}\n", encoding="utf-8")
    print(json.dumps({
        "product": "cocode 酷码工作室 · Cocode Studio VideoForge",
        "archive": str(destination), "bytes": destination.stat().st_size,
        "sha256": checksum, "applicationFiles": len(paths),
        "upstreamSourceFiles": upstream_files,
        "verification": "ZIP CRC and all per-file SHA-256 checks passed; DSH source and release version checked",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
