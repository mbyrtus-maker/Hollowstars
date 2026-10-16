Vendored from https://github.com/dmotz/trystero (MIT, see LICENSE), commit in VERSION.
Only the core, torrent (BitTorrent-tracker signaling) and ws-relay (self-hosted WebSocket
signaling) packages are included; imports were rewritten to relative paths so esbuild can
bundle them without npm.
