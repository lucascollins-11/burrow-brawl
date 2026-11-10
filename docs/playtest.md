# Playtest checklist

Use this list to try the game end to end and report what you find. Run each check in a desktop
browser (Chrome, Edge or Firefox) with the keyboard. Tick the boxes as you go.

## Before you start

- [ ] Open the Vercel site. The title screen loads, with a nickname box, **Create room**, **Join**,
  **Local play**, and the `?` help and `⚙` settings buttons in the corner.
- [ ] Press `H` or click `?`. The how-to-play overlay opens. `Esc` or a click outside closes it.
- [ ] Click `⚙`. Set the volume, mute, and turn on **reduce shake**. Reload the page: the
  settings stay.

## Hot-seat (one computer, no server)

- [ ] Click **Local play**. Pick 2 teams and 1 critter each, then start.
- [ ] Walk with `A`/`D` (or the arrow keys), jump with `Space`, backflip with `Enter`.
- [ ] Aim with `W`/`S`. Hold `F` to charge, release to fire. Try the acorn mortar (`1`) and the
  fizz grenade (`2`). Use `Z`/`X` to change the grenade fuse.
- [ ] A shot explodes, carves the terrain, knocks critters back, and shows damage numbers.
- [ ] Turns pass to the next team. The timer counts down, and the wind shows on the HUD.
- [ ] `Backspace` skips a turn. The turn passes to the next team.
- [ ] Knock every critter of one team out. The win banner shows, and **Play again** starts a new
  map.
- [ ] Try 3 and 4 teams, then reload the page with `?hotseat&teams=3&size=2&seed=42`. The same
  seed gives the same map.

## Online (friends, two or more devices)

- [ ] Open the site on two devices. On the first, type a nickname and choose **Create room**.
  The first load can take up to a minute while the server wakes up. A waking message shows.
- [ ] Copy the invite link (`/r/CODE`) and open it on the second device. The room code is filled
  in for you. Choose a nickname and join.
- [ ] Each player picks a team, then clicks **Ready**. The host sees **Start match** only when
  every player has a team and is ready. Only the host can start.
- [ ] During a match, each player plays only on their own turn. The other devices wait.
- [ ] Shots and explosions show up on both devices at the same time.
- [ ] Reload one device mid-match. It rejoins the same match and sees the same map and health.
- [ ] When the match ends, the results screen shows. Only the host sees **Back to lobby**. The
  other players see the waiting text.
- [ ] Close one tab for a few seconds and reopen it. The client reconnects and does not get
  stuck on a blank screen.

## Eight players

- [ ] With 8 players in one room (one per team), every team has its own colour and hat. The
  lobby lists all 8 members.

## How to report a bug

1. Note the time and the browser (for example, Chrome 130 on Windows).
2. Write the exact steps: what you clicked or pressed, and in what order.
3. Say what you expected and what happened.
4. Include the link you were on (the full URL). If the bug happened in a match, include the
   room code or the `seed=` value from the URL, and the turn number from the HUD.
5. Attach a screenshot or a short screen recording if you can.
6. If the page misbehaved, open the browser console (`F12`, then the Console tab), copy any red
   error lines, and paste them into the report.
7. Post the report in the project thread, or send it to the person who shared the link.

Do not send passwords, personal details or the `JWT_SECRET`.
