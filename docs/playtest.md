# Playtest guide: the Godot Windows build

Use this to try the game with friends and report what you find. It covers the Windows build made
by CI. The browser client is kept for reference, so this guide does not cover it.

## 1. Get the build

1. Open the GitHub page of the pull request you were given, or the project's **Releases** page.
2. Find the release for that build. Each pull request has one, named `godot-pr-<number>`.
3. Under **Assets**, download `BurrowBrawl-windows.zip`.
4. Right-click the zip, choose **Extract All**, and open the new folder.
5. Double-click `BurrowBrawl.exe`.

Windows may say it does not recognise the app. Click **More info**, then **Run anyway**. This is
expected for a test build that is not code-signed.

The game opens in its own window. There is no console window in this build. If something breaks,
the log file is the most useful thing to report. It is in this folder:

`%APPDATA%\Godot\app_userdata\Burrow Brawl\logs`

To open it, press Windows+R, paste the path, and press Enter.

## 2. Title screen

- [ ] The title screen opens. The server address is shown at the bottom.
- [ ] Type a nickname of 2 to 16 characters. A shorter or longer one shows a red message.
- [ ] Click **Create room**. The first try can take up to a minute while the free server wakes up.
  The message says so while you wait.
- [ ] Click **How to play**. It opens eight pages. **Next** and **Back** move through them, and
  **Close** or Esc returns to the title screen. Every page fits the window with no cut-off text.
- [ ] In **How to play**, click **Try the guided tutorial**. It starts a practice match against target dummies.

## 3. Lobby (two or more people)

- [ ] The room code shows at the top, for example `Room K7QX2`.
- [ ] On a second computer, type a nickname, type the room code in **Room code**, and click
  **Join by code**. A wrong code shows a red message.
- [ ] Both windows list both players, with the right names.
- [ ] Click **Take seat** on a team. Your name appears on that team. **Leave seat** frees it.
- [ ] The host can click **Add team** and **Remove last team**. There can be up to 8 teams.
- [ ] Everyone clicks **Ready**. The button text changes to **Not ready**.
- [ ] **Start match** turns on for the host only, and only when every player has a seat, is
  ready and is connected.
- [ ] **Leave room** takes you back to the title screen.

## 4. Match (when the build has the match scene)

- [ ] Only the player whose turn it is can act. The other windows wait.
- [ ] Shots and explosions show on every window at the same time.
- [ ] Close one window in the middle of a match, then reopen it and join with the same code. It
  should get the same match back, not a blank screen.
- [ ] Losing your connection for a few seconds should reconnect on its own. If it gives up, the
  message says so.
- [ ] Practice match: the banner shows one step at a time. Each step that is done is ticked off,
  and the frame points at the thing the step is about: the **Weapons** button on the weapon step,
  and the wind gauge on the wind step.
- [ ] Walk into a crate between turns. The crate gives a weapon or health, and the pickup shows.
- [ ] Knock a target dummy into the soda sea. It drowns, and the splash shows.
- [ ] After the last step, **Tutorial complete** appears. **Keep playing** closes it, and
  **Back to title** leaves the match.
- [ ] The **Weapons** menu opens with **Q**. It lists every weapon. Items with no ammo are greyed out
  and cannot be picked.

## 5. Report a bug

Post the report in the project thread, or send it to whoever shared the build. Include:

1. The release name, for example `godot-pr-54`, and the time you tried it.
2. Your Windows version, if you know it.
3. The exact steps: what you clicked or typed, in order.
4. What you expected, and what happened instead.
5. The room code, if you were in a room.
6. The newest file in the logs folder (see section 1). Attach it, or copy the text from the end of it.
7. A screenshot if you can.

Do not send passwords or personal details.
