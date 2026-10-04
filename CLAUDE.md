# RingCast for LG webOS: instructions for Claude

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

## Releasing

The LG app ships inside the NetRing Signage Manager release (the server publishes it at `/lg/`).
Use the **netring-signage-release** skill / `docs/RELEASING.txt` in netring-signage-manager.
