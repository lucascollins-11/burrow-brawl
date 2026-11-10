// Picks what to run: ?sandbox3d starts the 3D sandbox, anything else is the game as before.
if (new URLSearchParams(location.search).has("sandbox3d")) {
  void import("./game3d/sandbox3d").then((m) => m.startSandbox3D());
} else {
  void import("./main");
}
export {};
