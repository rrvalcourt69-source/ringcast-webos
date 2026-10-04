#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
#
# Builds both RingCast packages for LG webOS into dist/:
#   ringcast-webos-<version>-lg-tv.ipk       standard LG TVs (LG app store, Developer Mode)
#   ringcast-webos-<version>-lg-signage.ipk  LG webOS Signage displays (served by the server at /lg/)
#
# The version comes from app/appinfo.json (the one place it is kept). The packages differ only in
# js/config.js, which gets the platform and the version. Uses the official LG CLI
# (@webos-tools/cli, ares-package) from this repository's node_modules; installs it with
# `npm ci` when missing. Runs the tests first and checks both packages afterwards.
#
# Usage: tools/build.sh            (from anywhere; needs node, npm, ar, tar)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
APP_ID="com.netringtech.ringcast"
ARES_PACKAGE="$ROOT/node_modules/.bin/ares-package"

die() { echo "build: $*" >&2; exit 1; }

command -v node >/dev/null || die "node is required"
command -v ar >/dev/null || die "ar (binutils) is required to check the packages"

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
  # nothing but app files: no markdown, no development notes
  if find "$STAGE" -name '*.md' -o -name 'CLAUDE*' | grep -q .; then die "unexpected files in the app folder"; fi

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
  echo "build: $(basename "$TARGET")  $(stat -c %s "$TARGET") bytes  sha256 $(sha256sum "$TARGET" | cut -c1-64)"
done

echo "build: done, packages in $DIST"
