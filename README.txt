RingCast for LG webOS
=====================

The RingCast screen app for LG displays. It turns an LG webOS display into a signage screen
for NetRing Signage Manager: on first start it asks for the server's address, shows a pairing
code, and once an administrator adds the screen in the dashboard it plays whatever the server
assigns.

Supported displays
  - LG webOS Signage displays ("LG Digital Signage"): installed from the server at
    https://<server>/lg/ through the display's SI Server Settings, and started at power-on
    by the display itself (package ringcast-webos-<version>-lg-signage.ipk).
  - Standard LG webOS TVs (webOS 5 and later): installed from the LG app store, or in
    Developer Mode for testing (package ringcast-webos-<version>-lg-tv.ipk). The server
    brings the app back to the front when the TV is turned on or another app is opened
    (docs/PROTOCOL.txt §9).

The server must use a certificate from a public certificate authority (for example
Let's Encrypt): LG displays don't accept a private one.

The device protocol is docs/PROTOCOL.txt, shared with NetRing Signage Manager and the
RingCast client for Raspberry Pi. Security notes: SECURITY.txt.


Using it
--------
Remote keys: arrows to move, OK to type or select, BACK, and the BLUE button.

1. Server address. On first start, enter the server's address, for example
   https://signage.example.com (it is pre-filled with https://). Select the field and press OK
   to open the TV's keyboard; when done, go to Connect and press OK. The app checks that the
   address is a NetRing signage server before saving it, and says why when it isn't:
     - can't reach the server (address, network, or a certificate the display doesn't trust);
     - an IP address or local name (these can't have a public certificate);
     - the server answered but isn't a signage server, or needs updating.
2. Pairing. The display shows a code such as HXRT-2B99. In the dashboard choose
   Screens > Add Screen, enter the code, check the screen's details and confirm. A new code
   appears by itself when one expires.
3. For 60 seconds the display shows "Screen added", its name and who claimed it. If it isn't
   yours, turn the display off during this notice: it forgets the claim and shows a new code.
4. Then it plays. A small "Offline" marker appears in the corner while the server can't be
   reached; the content keeps playing.

Changing the server address later: press the BLUE button on the pairing screen (or on a
"Can't reach the server" screen). BACK keeps the current address. A paired display ignores the
BLUE button while it plays, so a stray key press can't interrupt it: first remove the screen in
the dashboard (or send it the Unpair command), then press BLUE on the pairing screen.

Commands the app carries out (PROTOCOL §5.2): refresh (new player session), restart_player
(reloads the app), set_orientation (the content is turned in the app, for portrait-mounted
displays) and unpair. The app reports the TV's LAN address at each check-in; the server uses it to keep the
app in front on standard TVs.

The bottom line of the pairing screen shows the app version, the platform (lg-tv or
lg-signage), the display model and its IP address when the display reveals them. Nothing secret
is ever shown.


Standard TVs used as signage
----------------------------
- Settings that switch the TV off on their own (for example "Auto Power Off" or an eco timer
  that turns the TV off after hours without a remote key) must be turned off.
- For the server to bring the app back to the front and wake the TV (PROTOCOL §9), turn on
  LG Connect Apps / TV On With Mobile, and Quick Start+ for wake-on-LAN.


Testing on a standard TV in Developer Mode
------------------------------------------
Developer Mode lets you install the app on your own TV without the LG app store.

1. Create an LG developer account (free) at https://webostv.developer.lge.com and sign in.
2. On the TV, open the LG Content Store, search for "Developer Mode", install it and open it.
   Sign in with the LG developer account.
3. Turn "Dev Mode Status" ON. The TV restarts. Open the Developer Mode app again.
4. Turn "Key Server" ON. Note the TV's IP address and the passphrase the app shows.
5. On the Windows PC (same network as the TV), with Node.js 20 or newer installed
   (https://nodejs.org, LTS), put the lg-tv package next to tools\Install-DevTv.ps1 and run:

       powershell -ExecutionPolicy Bypass -File .\Install-DevTv.ps1 -TvIp 192.0.2.50

   The script installs the official LG CLI next to itself (first run only), registers the TV,
   asks for the passphrase, installs the package, starts it and checks that it runs.
   Run it again to install a newer package (add -SkipKey if the passphrase hasn't changed).
6. Developer Mode sessions last 50 hours. Open the Developer Mode app and choose EXTEND
   before the time runs out: when a session expires the TV leaves Developer Mode and removes
   the apps installed this way.

Debugging on the TV: from the folder with the LG CLI,
    lg-cli\node_modules\.bin\ares-inspect.cmd --device ringcast-tv --app com.netringtech.ringcast --open
opens the web inspector for the running app (the console shows "[ringcast]" lines; the key and
the token are never logged).

If the display shows "The player page didn't load", the panel says why (the server refused a
player session, the page didn't load in time, or the player page reported an error such as a
missing player cookie). Please report the message together with the bottom line (version,
platform, model).


Building
--------
Requirements: Node.js 20 or newer with npm, bash, ar (binutils), tar.

    npm ci                  installs the LG CLI (@webos-tools/cli) and the test tools locally
    npm test                Node tests and the webOS 5 compatibility check
    tools/build.sh          builds both packages into dist/:
                              dist/ringcast-webos-<version>-lg-tv.ipk
                              dist/ringcast-webos-<version>-lg-signage.ipk

The version is kept in one place, app/appinfo.json; build.sh copies it, and the platform of each
package, into js/config.js. The app has no build step of its own: the files in app/ are what
ships, and they must run on webOS 5 (Chromium 68), so no optional chaining, ??, .at(),
replaceAll, Object.fromEntries, flatMap, CSS inset, aspect-ratio or flex gap.
tests/check_compat.js enforces this.

Browser test (optional, needs Python 3 with Playwright and Chromium, and the cryptography
package): python3 tests/e2e_screens.py [output-dir] loads the app from file:// against a fake
HTTPS server, drives the screens with remote keys and saves 1920x1080 screenshots.
RINGCAST_APP_DIR=<unpacked package> tests the packaged files instead.

Layout
  app/                 the packaged app (appinfo.json, index.html, css/, js/, icons)
  app/js/agent.js      pairing, check-in, commands, player sessions (no DOM; tested in Node)
  app/js/core.js       keys, signatures, checks of server values
  app/js/ui.js         screens and remote keys; app/js/strings.js all texts (English, Spanish)
  app/js/vendor/       TweetNaCl-js (public domain), see its README.txt
  tests/               Node tests (npm test), compatibility check, browser test
  tools/build.sh       packages; tools/Install-DevTv.ps1 Developer Mode install (Windows)
  tools/make_icons.py  draws the icons

Licence: GNU Affero General Public License v3 (see LICENSE).
Copyright (C) 2026 NetRing Tech Services, LLC.
