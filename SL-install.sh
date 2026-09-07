#!/bin/sh
set -eu

REPOSITORY="fabri777/SL-Repo"
INSTALL_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/sl-repo"
ASSET_DIRECTORY=""
RELEASE=""
FORCE="false"

usage() {
    cat <<'EOF'
Usage: SL-install.sh --release <tag> [options]

Options:
  --repository <owner/repo>  GitHub repository containing the release
  --install-root <path>      User-local installation root
  --asset-directory <path>   Install from previously downloaded assets
  --force                    Replace an existing installation of this version
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --release)
            RELEASE=${2:?Missing value for --release}
            shift 2
            ;;
        --repository)
            REPOSITORY=${2:?Missing value for --repository}
            shift 2
            ;;
        --install-root)
            INSTALL_ROOT=${2:?Missing value for --install-root}
            shift 2
            ;;
        --asset-directory)
            ASSET_DIRECTORY=${2:?Missing value for --asset-directory}
            shift 2
            ;;
        --force)
            FORCE="true"
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [ -z "$RELEASE" ]; then
    echo "--release is required." >&2
    usage >&2
    exit 1
fi

VERSION=${RELEASE#v}
case "$VERSION" in
    ""|[!0-9A-Za-z]*|*[!0-9A-Za-z._-]*)
        echo "Invalid release version: $RELEASE" >&2
        exit 1
        ;;
esac

case "$(uname -s)" in
    Linux) PLATFORM="linux" ;;
    Darwin) PLATFORM="darwin" ;;
    *)
        echo "Unsupported operating system: $(uname -s)" >&2
        exit 1
        ;;
esac

case "$(uname -m)" in
    x86_64|amd64) ARCHITECTURE="x64" ;;
    arm64|aarch64) ARCHITECTURE="arm64" ;;
    *)
        echo "Unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

ASSET_NAME="sl-repo-$VERSION-$PLATFORM-$ARCHITECTURE.tar.gz"
TEMPORARY_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/SL-install.XXXXXX")
DOWNLOAD_ROOT="$TEMPORARY_ROOT/download"
EXTRACT_ROOT="$TEMPORARY_ROOT/extract"
mkdir -p "$DOWNLOAD_ROOT" "$EXTRACT_ROOT"

cleanup() {
    rm -rf "$TEMPORARY_ROOT"
}
trap cleanup EXIT HUP INT TERM

copy_asset() {
    name=$1
    if [ -n "$ASSET_DIRECTORY" ]; then
        if [ ! -f "$ASSET_DIRECTORY/$name" ]; then
            echo "Missing local release asset: $ASSET_DIRECTORY/$name" >&2
            exit 1
        fi
        cp "$ASSET_DIRECTORY/$name" "$DOWNLOAD_ROOT/$name"
        return
    fi

    if ! command -v gh >/dev/null 2>&1; then
        echo "GitHub CLI is required for private release downloads. Authenticate with 'gh auth login', or use --asset-directory." >&2
        exit 1
    fi
    gh release download "$RELEASE" \
        --repo "$REPOSITORY" \
        --pattern "$name" \
        --dir "$DOWNLOAD_ROOT" \
        --clobber
}

copy_asset "SL-release-manifest.json"
copy_asset "SL-checksums.txt"
copy_asset "$ASSET_NAME"

EXPECTED_HASH=$(awk -v name="$ASSET_NAME" '$2 == name && $1 ~ /^[0-9a-fA-F]{64}$/ { print tolower($1); exit }' "$DOWNLOAD_ROOT/SL-checksums.txt")
if [ -z "$EXPECTED_HASH" ]; then
    echo "No checksum was published for $ASSET_NAME." >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_HASH=$(sha256sum "$DOWNLOAD_ROOT/$ASSET_NAME" | awk '{ print tolower($1) }')
elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_HASH=$(shasum -a 256 "$DOWNLOAD_ROOT/$ASSET_NAME" | awk '{ print tolower($1) }')
else
    echo "A SHA-256 utility (sha256sum or shasum) is required." >&2
    exit 1
fi

if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
    echo "SHA-256 verification failed for $ASSET_NAME." >&2
    exit 1
fi

tar -xzf "$DOWNLOAD_ROOT/$ASSET_NAME" -C "$EXTRACT_ROOT"
ROOT_DIRECTORY="sl-repo-$VERSION-$PLATFORM-$ARCHITECTURE"
STAGED_ROOT="$EXTRACT_ROOT/$ROOT_DIRECTORY"
if [ ! -f "$STAGED_ROOT/SL-release.json" ] || [ ! -x "$STAGED_ROOT/bin/sl-repo" ]; then
    echo "Portable archive does not contain the expected SL Repo layout." >&2
    exit 1
fi

"$STAGED_ROOT/runtime/bin/node" -e '
const fs = require("node:fs");
const [manifestPath, descriptorPath, archivePath, assetName, version, platform, architecture, expectedHash] = process.argv.slice(1);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
const archiveSize = fs.statSync(archivePath).size;
const assets = manifest.assets.filter((asset) =>
  asset.platform === platform &&
  asset.architecture === architecture &&
  asset.fileName === assetName
);
if (
  manifest.schemaVersion !== 1 ||
  manifest.version !== version ||
  !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
  assets.length !== 1 ||
  assets[0].sha256 !== expectedHash ||
  assets[0].size !== archiveSize ||
  descriptor.version !== manifest.version ||
  descriptor.sourceCommit !== manifest.sourceCommit ||
  descriptor.nodeVersion !== manifest.nodeVersion ||
  descriptor.platform !== platform ||
  descriptor.architecture !== architecture ||
  descriptor.fileName !== assetName
) {
  throw new Error("Portable archive metadata does not match the release manifest.");
}
' \
    "$DOWNLOAD_ROOT/SL-release-manifest.json" \
    "$STAGED_ROOT/SL-release.json" \
    "$DOWNLOAD_ROOT/$ASSET_NAME" \
    "$ASSET_NAME" \
    "$VERSION" \
    "$PLATFORM" \
    "$ARCHITECTURE" \
    "$EXPECTED_HASH"

DESTINATION_RELATIVE="versions/$VERSION/$PLATFORM-$ARCHITECTURE"
DESTINATION_ROOT="$INSTALL_ROOT/$DESTINATION_RELATIVE"
mkdir -p "$(dirname "$DESTINATION_ROOT")"
if [ -e "$DESTINATION_ROOT" ] && [ "$FORCE" != "true" ]; then
    echo "SL Repo $VERSION is already installed at $DESTINATION_ROOT. Use --force to replace it." >&2
    exit 1
fi

BACKUP_ROOT="$DESTINATION_ROOT.SL-backup-$$"
HAS_BACKUP="false"
if [ -e "$DESTINATION_ROOT" ]; then
    mv "$DESTINATION_ROOT" "$BACKUP_ROOT"
    HAS_BACKUP="true"
fi
if ! mv "$STAGED_ROOT" "$DESTINATION_ROOT"; then
    if [ "$HAS_BACKUP" = "true" ] && [ ! -e "$DESTINATION_ROOT" ]; then
        mv "$BACKUP_ROOT" "$DESTINATION_ROOT"
    fi
    exit 1
fi
if [ "$HAS_BACKUP" = "true" ]; then
    rm -rf "$BACKUP_ROOT"
fi

BIN_ROOT="$INSTALL_ROOT/bin"
mkdir -p "$BIN_ROOT"
WRAPPER_TEMPORARY="$BIN_ROOT/sl-repo.SL-tmp-$$"
cat > "$WRAPPER_TEMPORARY" <<'EOF'
#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CURRENT=$(cat "$SCRIPT_DIR/../current")
exec "$SCRIPT_DIR/../$CURRENT/bin/sl-repo" "$@"
EOF
chmod 755 "$WRAPPER_TEMPORARY"
mv "$WRAPPER_TEMPORARY" "$BIN_ROOT/sl-repo"

CURRENT_TEMPORARY="$INSTALL_ROOT/current.SL-tmp-$$"
printf '%s' "$DESTINATION_RELATIVE" > "$CURRENT_TEMPORARY"
mv "$CURRENT_TEMPORARY" "$INSTALL_ROOT/current"

echo "Installed SL Repo $VERSION to $DESTINATION_ROOT"
echo "Add '$BIN_ROOT' to PATH, then run:"
echo "  sl-repo init /path/to/repository --dry-run"
echo "  sl-repo init /path/to/repository"
echo "  sl-repo doctor /path/to/repository"
echo "  sl-repo validate /path/to/repository"
