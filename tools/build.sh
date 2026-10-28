#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
#
# Builds the RingCast packages for LG webOS into dist/ (exactly one version; older ones are removed):
#   ringcast-webos-<version>-lg-tv.ipk       standard LG TVs (LG app store, Developer Mode)
#   ringcast-webos-<version>-lg-signage.ipk  LG webOS Signage displays (served by the server at /lg/)
#   ringcast-webos-<version>-lg-signage.zip  the same signage app folder zipped, appinfo.json at the
#                                            zip root (the server adds server.json and serves it as
#                                            /lg/ringcast.zip for SI Server Settings)
#
# The version comes from app/appinfo.json (the one place it is kept). The packages differ only in
# js/config.js, which gets the platform and the version. Uses the official LG CLI
# (@webos-tools/cli, ares-package) from this repository's node_modules; installs it with
# `npm ci` when missing. Runs the tests first and checks both packages afterwards.
#
# The zip is deterministic: entries in sorted order, every timestamp set to the commit time of
# HEAD (SOURCE_DATE_EPOCH overrides it), fixed permissions.
#
# Usage: tools/build.sh            (from anywhere; needs node, npm, ar, tar, python3)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
APP_ID="com.netringtech.ringcast"
ARES_PACKAGE="$ROOT/node_modules/.bin/ares-package"

die() { echo "build: $*" >&2; exit 1; }

command -v node >/dev/null || die "node is required"
command -v ar >/dev/null || die "ar (binutils) is required to check the packages"
command -v python3 >/dev/null || die "python3 is required to build the signage zip"

VERSION="$(node -p 'require("./app/appinfo.json").version')"
ID="$(node -p 'require("./app/appinfo.json").id')"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "appinfo.json version '$VERSION' must be x.y.z"
[[ "$ID" == "$APP_ID" ]] || die "appinfo.json id must be $APP_ID (the server relies on it), not '$ID'"

if [[ ! -x "$ARES_PACKAGE" ]]; then
  echo "build: installing the LG CLI into node_modules (npm ci)"
  npm ci --no-audit --no-fund >/dev/null
fi
[[ -x "$ARES_PACKAGE" ]] || die "ares-package not found after npm ci"

echo "build: tests"
node tests/run.js >/dev/null || { node tests/run.js | grep -v '^ok' ; die "tests failed"; }

BUILD="$ROOT/build"
DIST="$ROOT/dist"
rm -rf "$BUILD"
mkdir -p "$BUILD" "$DIST"
# dist/ holds exactly one version (the server's release build insists on it)
rm -f "$DIST"/ringcast-webos-*.ipk "$DIST"/ringcast-webos-*.zip
EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null || date +%s)}"

for PLATFORM in lg-tv lg-signage; do
  STAGE="$BUILD/$PLATFORM/app"
  OUT="$BUILD/$PLATFORM/out"
  mkdir -p "$STAGE" "$OUT"
  cp -a app/. "$STAGE/"
  cp LICENSE "$STAGE/LICENSE.txt"
  # js/config.js: platform and version for this package
  sed -i -e "s/^    platform: \"[a-z-]*\",\$/    platform: \"$PLATFORM\",/" \
         -e "s/^    version: \"[^\"]*\"\$/    version: \"$VERSION\"/" "$STAGE/js/config.js"
  grep -q "^    platform: \"$PLATFORM\",\$" "$STAGE/js/config.js" || die "couldn't set the platform in config.js"
  grep -q "^    version: \"$VERSION\"\$" "$STAGE/js/config.js" || die "couldn't set the version in config.js"
  # nothing but app files (no markdown, notes or stray files): an allow-list of file types
  STRAY="$(find "$STAGE" -type f ! \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.json' \
    -o -name '*.png' -o -name '*.txt' \) -print)"
  [[ -z "$STRAY" ]] || die "unexpected files in the app folder: $STRAY"

  # --no-minify: ship the readable source with its licence headers (AGPL; debugging on the TV)
  "$ARES_PACKAGE" --no-minify -o "$OUT" "$STAGE" >"$BUILD/$PLATFORM/ares-package.log" 2>&1 \
    || { cat "$BUILD/$PLATFORM/ares-package.log"; die "ares-package failed for $PLATFORM"; }
  IPK="$(ls "$OUT"/*.ipk 2>/dev/null | head -1)"
  [[ -n "$IPK" ]] || die "ares-package produced no .ipk for $PLATFORM"
  TARGET="$DIST/ringcast-webos-$VERSION-$PLATFORM.ipk"
  mv "$IPK" "$TARGET"

  # check the package: an ar archive with the app, the right id, platform and version
  CHECK="$BUILD/$PLATFORM/check"
  mkdir -p "$CHECK"
  (cd "$CHECK" && ar x "$TARGET")
  [[ -f "$CHECK/debian-binary" && -f "$CHECK/control.tar.gz" && -f "$CHECK/data.tar.gz" ]] \
    || die "$TARGET isn't a webOS package"
  tar -xzf "$CHECK/data.tar.gz" -C "$CHECK"
  APPDIR="$CHECK/usr/palm/applications/$APP_ID"
  [[ -f "$APPDIR/appinfo.json" ]] || die "$TARGET has no $APP_ID/appinfo.json"
  grep -q "platform: \"$PLATFORM\"" "$APPDIR/js/config.js" || die "$TARGET has the wrong platform"
  grep -q "version: \"$VERSION\"" "$APPDIR/js/config.js" || die "$TARGET has the wrong version"
  [[ "$(node -p "require('$APPDIR/appinfo.json').version")" == "$VERSION" ]] || die "$TARGET appinfo version"
  node tests/check_compat.js "$APPDIR" >/dev/null || die "$TARGET contains code webOS 5 can't run"
  cmp -s "$STAGE/js/agent.js" "$APPDIR/js/agent.js" || die "$TARGET: ares-package changed the source files"
  tar -xzf "$CHECK/control.tar.gz" -C "$CHECK"
  grep -q "^Package: $APP_ID\$" "$CHECK/control" || die "$TARGET control file names another package"
  grep -q "^Version: $VERSION\$" "$CHECK/control" || die "$TARGET control file has another version"
  # what LG's packaging and the app store check: requiredACG, the splash, both icons
  node -e '
    const a = require(process.argv[1]), fs = require("fs"), path = require("path"), dir = path.dirname(process.argv[1]);
    const fail = (m) => { console.error(m); process.exit(1); };
    if (!Array.isArray(a.requiredACG) || !a.requiredACG.length) fail("no requiredACG");
    for (const k of ["icon", "largeIcon", "splashBackground"]) {
      if (typeof a[k] !== "string" || !fs.existsSync(path.join(dir, a[k]))) fail(k + " missing");
    }' "$APPDIR/appinfo.json" || die "$TARGET: appinfo.json lacks requiredACG, an icon or the splash"
  echo "build: $(basename "$TARGET")  $(stat -c %s "$TARGET") bytes  sha256 $(sha256sum "$TARGET" | cut -c1-64)"

  if [[ "$PLATFORM" == "lg-signage" ]]; then
    # the packaged app folder (exactly what the IPK installs), zipped with appinfo.json at the root
    ZIP="$DIST/ringcast-webos-$VERSION-lg-signage.zip"
    python3 - "$APPDIR" "$ZIP" "$EPOCH" <<'PYEOF' || die "couldn't build the signage zip"
import os, sys, time, zipfile
src, dst, epoch = sys.argv[1], sys.argv[2], int(sys.argv[3])
stamp = max(time.gmtime(epoch)[:6], (1980, 1, 1, 0, 0, 0))
entries = []
for d, dirs, files in os.walk(src):
    dirs.sort()
    rel = os.path.relpath(d, src)
    if rel != ".":
        entries.append((rel.replace(os.sep, "/") + "/", None))
    for f in sorted(files):
        entries.append((os.path.relpath(os.path.join(d, f), src).replace(os.sep, "/"), os.path.join(d, f)))
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for name, path in sorted(entries):
        zi = zipfile.ZipInfo(name, date_time=stamp)
        zi.create_system = 3
        if path is None:
            zi.external_attr = (0o40755 << 16) | 0x10
            z.writestr(zi, b"")
        else:
            zi.external_attr = 0o100644 << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(path, "rb") as fh:
                z.writestr(zi, fh.read(), compresslevel=9)
with zipfile.ZipFile(dst) as z:
    import json
    names = z.namelist()
    assert "appinfo.json" in names and z.testzip() is None
    assert json.loads(z.read("appinfo.json"))["id"] == "com.netringtech.ringcast"
PYEOF
    echo "build: $(basename "$ZIP")  $(stat -c %s "$ZIP") bytes  sha256 $(sha256sum "$ZIP" | cut -c1-64)"
  fi
done

echo "build: done, packages in $DIST"
