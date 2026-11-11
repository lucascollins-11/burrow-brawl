extends TestCase


func test_urls_from_a_wss_base() -> void:
	var u := NetConfig.urls("wss://burrow-brawl-server.onrender.com")
	check_eq(u["http"], "https://burrow-brawl-server.onrender.com", "http base")
	check_eq(u["ws"], "wss://burrow-brawl-server.onrender.com/ws", "websocket url")


func test_urls_accept_http_and_a_trailing_ws_and_slash() -> void:
	var u := NetConfig.urls("http://localhost:8080/ws/")
	check_eq(u["http"], "http://localhost:8080", "http base")
	check_eq(u["ws"], "ws://localhost:8080/ws", "websocket url")


func test_urls_reject_other_schemes() -> void:
	check_eq(NetConfig.urls("ftp://example.com").is_empty(), true, "ftp is refused")
