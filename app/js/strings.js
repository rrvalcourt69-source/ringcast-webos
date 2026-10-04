// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Every text the app shows, in English and Spanish. The language follows the display's
// language (navigator.language); anything other than Spanish shows English.
// Placeholders are {name}; values are inserted as plain text (never as HTML).
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  var STRINGS = {
    en: {
      app_name: "RingCast",
      // address screen
      addr_title: "Connect to your signage server",
      addr_intro: "Enter the address of your NetRing Signage Manager server.",
      addr_cert: "LG displays need a server with a public certificate (for example from Let's Encrypt).",
      addr_label: "Server address",
      addr_example: "Example: https://signage.example.com",
      addr_connect: "Connect",
      addr_checking: "Checking {host}…",
      addr_keys: "Arrows or pointer: move · OK: type or select · BACK: exit",
      addr_keys_back: "Arrows or pointer: move · OK: type or select · BACK: keep the current server",
      err_empty: "Enter the server's address.",
      err_https_only: "The address must start with https://",
      err_invalid: "That isn't a valid server address.",
      err_address_only: "Enter only the server's address, without a path (for example https://signage.example.com).",
      err_unreachable: "Can't reach {host}. Check the address and the display's network connection. If the server uses a private or self-signed certificate, LG displays can't trust it: the server needs a public certificate.",
      err_cert_private: "Can't connect to {host}. An IP address or a local name can't have a public certificate, and LG displays only trust public certificates. Use the server's public name (for example signage.example.com).",
      err_not_signage: "{host} answered, but it isn't a NetRing signage server (or it needs updating).",
      err_no_cors: "{host} answered, but it doesn't accept LG screens yet. It may not be a NetRing signage server, or it needs updating.",
      // pairing
      pair_title: "Pair this screen",
      pair_enter: "Enter this code in {server}",
      pair_server: "Server: {host}",
      pair_poll_problem: "Can't reach the server right now. Retrying…",
      pair_expires: "A new code appears automatically when this one expires.",
      key_blue: "OK or BLUE button: change the server address",
      connecting: "Connecting to {host}…",
      // claimed
      claimed_title: "Screen added",
      claimed_by: "Claimed by {account}",
      claimed_undo: "Not yours? Turn this display off now: it forgets this claim and shows a new code.",
      claimed_wait: "Starting in {s} s",
      // messages
      msg_retrying: "Retrying automatically…",
      msg_retry_in: "Retrying in {s} s…",
      unreachable_title: "Can't reach the server",
      unreachable_detail: "Check the display's network connection. The server must have a public certificate.",
      server_old_title: "Server needs updating",
      server_old_detail: "This server is older than this screen's software.",
      busy_title: "The server is busy",
      busy_detail: "Too many screens are pairing right now.",
      refused_title: "The server refused this screen",
      refused_detail: "Reason: {reason}. The server may need updating to accept LG screens.",
      server_error_title: "The server had a problem",
      server_error_detail: "HTTP {status}. It will be tried again.",
      bad_response_detail: "The server sent an answer this screen doesn't understand.",
      // playing
      player_starting: "Starting the player…",
      offline: "Offline",
      server_old_marker: "Server needs updating",
      frame_title: "The player page didn't load",
      frame_timeout: "The player page didn't finish loading within {s} seconds.",
      frame_session_http: "The server refused a player session (HTTP {status} {error}).",
      frame_session_url: "The server sent a player address this app doesn't accept ({where}). Check that the server's public address uses https.",
      frame_session_net: "Can't reach the server to start the player.",
      frame_player_error: "The player page reported: {error}.",
      frame_cookie_hint: "The display may not keep the player's cookie inside the app (see PROTOCOL §5.3). Please report this message.",
      frame_no_session_hint: "The display refused the player's sign-in cookie inside the app, so the player can't show content. Please report this message with the line below.",
      frame_footer: "Server: {host} · {diag}",
      // diagnostics
      diag: "RingCast {version} · {platform} · {model}",
      diag_ip: "RingCast {version} · {platform} · {model} · IP {ip}",
      model_unknown: "LG webOS display"
    },
    es: {
      app_name: "RingCast",
      addr_title: "Conectar con su servidor de señalización",
      addr_intro: "Introduzca la dirección de su servidor NetRing Signage Manager.",
      addr_cert: "Las pantallas LG necesitan un servidor con un certificado público (por ejemplo de Let's Encrypt).",
      addr_label: "Dirección del servidor",
      addr_example: "Ejemplo: https://signage.example.com",
      addr_connect: "Conectar",
      addr_checking: "Comprobando {host}…",
      addr_keys: "Flechas o puntero: mover · OK: escribir o seleccionar · ATRÁS: salir",
      addr_keys_back: "Flechas o puntero: mover · OK: escribir o seleccionar · ATRÁS: mantener el servidor actual",
      err_empty: "Introduzca la dirección del servidor.",
      err_https_only: "La dirección debe empezar por https://",
      err_invalid: "Esa no es una dirección de servidor válida.",
      err_address_only: "Introduzca solo la dirección del servidor, sin ruta (por ejemplo https://signage.example.com).",
      err_unreachable: "No se puede conectar con {host}. Compruebe la dirección y la conexión de red de la pantalla. Si el servidor usa un certificado privado o autofirmado, las pantallas LG no pueden confiar en él: el servidor necesita un certificado público.",
      err_cert_private: "No se puede conectar con {host}. Una dirección IP o un nombre local no puede tener un certificado público, y las pantallas LG solo confían en certificados públicos. Use el nombre público del servidor (por ejemplo signage.example.com).",
      err_not_signage: "{host} respondió, pero no es un servidor de señalización NetRing (o necesita actualizarse).",
      err_no_cors: "{host} respondió, pero todavía no acepta pantallas LG. Puede que no sea un servidor de señalización NetRing o que necesite actualizarse.",
      pair_title: "Vincular esta pantalla",
      pair_enter: "Introduzca este código en {server}",
      pair_server: "Servidor: {host}",
      pair_poll_problem: "No se puede conectar con el servidor ahora mismo. Reintentando…",
      pair_expires: "Cuando este código caduque aparecerá uno nuevo automáticamente.",
      key_blue: "OK o botón AZUL: cambiar la dirección del servidor",
      connecting: "Conectando con {host}…",
      claimed_title: "Pantalla añadida",
      claimed_by: "Añadida por {account}",
      claimed_undo: "¿No es suya? Apague esta pantalla ahora: olvidará esta vinculación y mostrará un código nuevo.",
      claimed_wait: "Empieza en {s} s",
      msg_retrying: "Reintentando automáticamente…",
      msg_retry_in: "Reintentando en {s} s…",
      unreachable_title: "No se puede conectar con el servidor",
      unreachable_detail: "Compruebe la conexión de red de la pantalla. El servidor debe tener un certificado público.",
      server_old_title: "El servidor necesita actualizarse",
      server_old_detail: "Este servidor es más antiguo que el software de esta pantalla.",
      busy_title: "El servidor está ocupado",
      busy_detail: "Hay demasiadas pantallas vinculándose ahora mismo.",
      refused_title: "El servidor rechazó esta pantalla",
      refused_detail: "Motivo: {reason}. Puede que el servidor necesite actualizarse para aceptar pantallas LG.",
      server_error_title: "El servidor tuvo un problema",
      server_error_detail: "HTTP {status}. Se volverá a intentar.",
      bad_response_detail: "El servidor envió una respuesta que esta pantalla no entiende.",
      player_starting: "Iniciando el reproductor…",
      offline: "Sin conexión",
      server_old_marker: "El servidor necesita actualizarse",
      frame_title: "La página del reproductor no se cargó",
      frame_timeout: "La página del reproductor no terminó de cargarse en {s} segundos.",
      frame_session_http: "El servidor rechazó una sesión del reproductor (HTTP {status} {error}).",
      frame_session_url: "El servidor envió una dirección del reproductor que esta aplicación no acepta ({where}). Compruebe que la dirección pública del servidor use https.",
      frame_session_net: "No se puede conectar con el servidor para iniciar el reproductor.",
      frame_player_error: "La página del reproductor informó: {error}.",
      frame_cookie_hint: "Puede que la pantalla no conserve la cookie del reproductor dentro de la aplicación (vea PROTOCOL §5.3). Por favor, comunique este mensaje.",
      frame_no_session_hint: "La pantalla rechazó la cookie de inicio de sesión del reproductor dentro de la aplicación, así que el reproductor no puede mostrar contenido. Por favor, comunique este mensaje junto con la línea de abajo.",
      frame_footer: "Servidor: {host} · {diag}",
      diag: "RingCast {version} · {platform} · {model}",
      diag_ip: "RingCast {version} · {platform} · {model} · IP {ip}",
      model_unknown: "Pantalla LG webOS"
    }
  };

  function pickLanguage(lang) {
    return /^es\b/i.test(String(lang || "")) ? "es" : "en";
  }

  var current = pickLanguage(root.navigator && root.navigator.language);

  function t(key, vars) {
    var table = STRINGS[current] || STRINGS.en;
    var s = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : STRINGS.en[key];
    if (typeof s !== "string") return key;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  RC.strings = STRINGS;
  RC.t = t;
  RC.setLanguage = function (lang) {
    current = pickLanguage(lang);
    return current;
  };
  RC.language = function () {
    return current;
  };
})(typeof window !== "undefined" ? window : this);
