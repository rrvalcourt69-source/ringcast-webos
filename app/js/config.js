// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Build-time settings. tools/build.sh rewrites this file in each package:
//   platform  "lg-tv" (standard LG TVs, LG app store) or "lg-signage" (LG webOS Signage
//             displays, installed from the server at /lg/), sent at pairing (PROTOCOL §3.1);
//   version   copied from appinfo.json, the one place the version is kept.
// Running the app straight from the source tree reports version "dev".
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};
  RC.config = {
    platform: "lg-tv",
    version: "dev"
  };
})(typeof window !== "undefined" ? window : this);
