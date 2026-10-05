# RingCast Player for LG webOS: instructions for Claude

Screen app for RingCast signage on LG webOS displays. Owner: Rick Valcourt, NetRing Tech
Services, LLC. Licence: **AGPL-3.0**. Private now, **public** at launch: write as if public.

## Hard rules

1. **Targets:** LG webOS Signage displays (installed from the server at `/lg/`, started at
   power-on by SI Server Settings) and standard LG webOS TVs, webOS 5 and later (installed from
   the LG app store; the server keeps the app in front). Platform ids: `lg-signage`, `lg-tv`.
   Rick's test TV: 43UN7000PUB, webOS 5.6.
2. **Old browser engine:** webOS 5 is Chromium 68. No optional chaining, `??`, `.at()`,
   `replaceAll`, `Object.fromEntries`, `flatMap`, CSS `inset`, `aspect-ratio` or flex `gap`
   unless transpiled or polyfilled. Test on the real TV.
3. **Public certificates only:** LG displays can't trust a private CA, so the app only talks to
   `https://` servers with a publicly trusted certificate.
4. **The device protocol is a contract.** `docs/PROTOCOL.txt` is shared with
   `rrvalcourt69-source/netring-signage-manager` and `rrvalcourt69-source/ringcast-client`.
   Changes bump its version and land in every repo.
5. **No Anthias** code, names or assets.
6. **Device secrets:** the Ed25519 private key and the device token stay in the app's storage on
   the display; never log or display them.
7. Server-provided text is shown as text, never executed; the app only opens the server's own
   player page.
8. Commits: one logical change each, with a "why" message. Work on branches and open PRs.

## Product names (decided 2026-10-05)

- **RingCast Signage** is the product family, presented as **"RingCast by NetRing"**.
- **RingCast Manager**: the self-hosted server and its dashboard (formerly "NetRing Signage Manager").
- **RingCast Player**: the software on screens: Raspberry Pi and LG webOS (formerly "RingCast client").
  The LG app tile and store listing say "RingCast Player"; the Pi installer is the "RingCast Player installer".
- Only names people see change (UI, installer screens, guides, release titles and notes, website).
  Technical identifiers stay as they are so installed servers and screens keep updating:
  repo names, `/opt/netring-signage`, service and user names, `netring-signage-manager-X.Y.Z.run`,
  `ringcast-client-X.Y.Z.tar.gz`, `ringcast-pi-installer-X.Y.Z.zip`, `Install-PiClient.ps1`,
  LG app id `com.netringtech.ringcast`, signing namespaces.

## Publication rules (decided 2026-10-02)

- **Docs are `.txt`**, never `.md` (README.txt, SECURITY.txt, docs/PROTOCOL.txt, ...).
- **No references to AI tools** in any file that ships or is published: code, comments, docs, scripts,
  UI text, release notes. This CLAUDE.md is the only exception; it stays in this private development
  repo and is never included in a release, the LG store package or the public releases repo.
- Releases and their source archives are published to the separate public repo
  `rrvalcourt69-source/netring-signage-releases`; development history stays private.
  Commits there are authored as "NetRing Tech Services" with no co-author or session trailers.
- **No customer data**: no customer names, domains, hostnames or IP addresses anywhere.

## Owner's environment

Rick works from Windows over VPN (PuTTY, WinSCP in binary mode) and prefers .ps1 scripts he can
run over pasted blocks, plus concise, actionable answers.

**Always supply both (decided 2026-10-04):** whenever Rick has to run something, attach every
script in the chat (and put it on I:), **and** write out the exact commands in the reply, ready
to copy and paste, in order: PowerShell on his PC, then bash on the server (PuTTY), with full
paths and file names, each followed by a command that verifies it worked. Never just name a
script or point at a README.

**Updates go through GitHub only (decided 2026-10-04):** Rick does not install builds by
uploading files. Every build, test builds included, is a full release that Rick publishes with
`Publish-NetRingRelease.ps1`, and servers update from Settings > Updates. Only fall back to a
manual `.run` upload to recover from a failed update. The routines (dev server, certificate
renewal, LG testing) are in the claude.ai project doc `claude/netring-signage-runbook.md`.

## Releasing

The LG app ships inside the RingCast Manager release (the server publishes it at `/lg/`).
Use the **netring-signage-release** skill / `docs/RELEASING.txt` in netring-signage-manager.
