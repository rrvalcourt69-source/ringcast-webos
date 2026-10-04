RingCast: LG Content Store submission package
=============================================

Everything needed to submit RingCast for standard LG TVs to the LG Content Store through
the LG Seller Lounge. The package to upload is dist/ringcast-webos-<version>-lg-tv.ipk from
tools/build.sh (the lg-signage packages are for LG webOS Signage displays and are served by
the signage server, not the store).

Files
  listing.txt              title, short and long descriptions (EN, ES), category, tag
                           keywords, contact details (placeholders), what the app needs,
                           App Tile Color #0A1A2F
  test-info.txt            Test Info: test URL, test account (placeholders), notes for testers
  ux-scenario.txt          content for LG's UX Scenario template
  self-check.txt           answers for LG's self-check list (Pass / N/A with reasons)
  uk-data-disclosure.txt   answers for the UK data disclosure
  privacy-policy.txt       privacy policy text to publish at
                           https://netringtech.com/signage/privacy (confirm the address)
  icon-400.png             app icon, 400x400, background #0A1A2F
  splash-1920x1080.png     splash image (the app's appinfo.json "splashBackground")
  screenshots/             five 1920x1080 screenshots; 1-playing.png first (webOS 6+ shows
                           the first one on the Apps main screen)

Seller Lounge: choose #0A1A2F as the App Tile Color, so it matches the icon.

Placeholders to fill in before submitting (search for "<"): support e-mail, website and
privacy policy addresses, test account and password, publication date of the policy.

Regenerating the images
  Icons and splash: python3 tools/make_icons.py (original artwork, drawn with Pillow).
  Screenshots: tools/build.sh, then
    RINGCAST_APP_DIR=build/lg-tv/check/usr/palm/applications/com.netringtech.ringcast \
      python3 tests/e2e_screens.py <folder>
  and copy 4-playing, 2-pairing, 3-claimed, 1-address and 1-address-es from <folder>.
