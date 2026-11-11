## Where the game server is. Pure helpers, so tests can check them without a network.
class_name NetConfig
extends RefCounted

## The Render service. Override for local play with: godot --path godot -- --server=http://localhost:8080
const DEFAULT_SERVER := "https://burrow-brawl-server.onrender.com"


static func server_base() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--server="):
			return arg.trim_prefix("--server=").strip_edges().trim_suffix("/")
	return DEFAULT_SERVER


## HTTP base (https://host) and WebSocket URL (wss://host/ws) from a ws(s):// or http(s):// base.
## Returns {} for any other scheme. A trailing /ws in the base is accepted.
static func urls(base: String) -> Dictionary:
	var b := base.strip_edges().trim_suffix("/")
	var http := ""
	if b.begins_with("wss://"):
		http = "https://" + b.substr(6)
	elif b.begins_with("ws://"):
		http = "http://" + b.substr(5)
	elif b.begins_with("https://") or b.begins_with("http://"):
		http = b
	else:
		return {}
	if http.ends_with("/ws"):
		http = http.substr(0, http.length() - 3)
	http = http.trim_suffix("/")
	var ws_url := http.replace("https://", "wss://").replace("http://", "ws://") + "/ws"
	return {"http": http, "ws": ws_url}
