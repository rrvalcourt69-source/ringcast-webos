RingCast for LG webOS
=====================

The RingCast screen app for LG displays. It turns an LG webOS display into a signage screen
for NetRing Signage Manager: on first start it asks for the server's address, shows a pairing
code, and once an administrator adds the screen in the dashboard it plays whatever the server
assigns.

Supported displays
  - LG webOS Signage displays ("LG Digital Signage"): installed from the server at
    https://<server>/lg/ through the display's SI Server Settings, and started at power-on
    by the display itself.
  - Standard LG webOS TVs (webOS 5 and later): installed from the LG app store. The server
    brings the app back to the front when the TV is turned on or another app is opened.

The server must use a certificate from a public certificate authority: LG displays don't
accept a private one.

The device protocol is docs/PROTOCOL.txt, shared with NetRing Signage Manager and the
RingCast client for Raspberry Pi.

Licence: GNU Affero General Public License v3 (see LICENSE).
Copyright (C) 2026 NetRing Tech Services, LLC.
