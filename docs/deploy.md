# Deploying Burrow Brawl

Two pieces are deployed separately. Set up Vercel first (the game is playable on one computer right away), then Render (online play):

- **Server** (`server/`): a Docker image on Render, from `render.yaml` and `server/Dockerfile`. It serves WebSockets and `GET /healthz`.
- **Client** (`client/`): a static Vite build on Vercel, from `vercel.json` at the repo root. Routes under `/r/:code` (room links) serve `index.html`.

## Environment variables

| Variable | Where it is set | Used by | Notes |
|---|---|---|---|
| `VITE_GAME_SERVER_URL` | Vercel, Production and Preview | Client, at build time | Full `wss://` URL of the Render service, for example `wss://burrow-brawl-server.onrender.com`. Changing it needs a redeploy. |
| `ALLOWED_ORIGINS` | Render | Server | Comma-separated list of client origins allowed to connect, for example `https://burrow-brawl.vercel.app`. |
| `JWT_SECRET` | Render | Server | Secret for signing session tokens. At least 32 bytes of random data, for example `openssl rand -base64 32`. Keep it private and do not commit it. |
| `TRUST_PROXY` | `render.yaml` (set to `1`) | Server | Trust the `X-Forwarded-For` header from Render's proxy, so client IPs and rate limits work. Do not set it on a server that is reachable without a proxy. |
| `PORT` | Render (set automatically) | Server | Render sets this. The server defaults to `3000` locally. |

Never commit real values. Put local values in `.env` files, which are git-ignored.

## Step 1: Vercel (client)

1. In Vercel, choose **Add New** > **Project** and import `lucascollins-11/burrow-brawl`.
2. Leave **Root Directory** as the repository root. Vercel only reads `vercel.json` from the root directory, so `vercel.json` at the repo root sets the build and output paths.
3. Set **Framework Preset** to **Other**. The build comes from `vercel.json`, not from framework detection.
4. Deploy. You do not need `VITE_GAME_SERVER_URL` yet.
5. Open the site. Then open `https://<project>.vercel.app/r/TEST` and check that the app loads.

**Now you can play locally.** On the title screen, choose **Local play**, pick 2 to 4 teams and 1 to 4 critters per team, and pass the keyboard around. This needs no game server and works on a Vercel-only deploy.

## Step 2: Render (server)

1. In Render, choose **New** > **Blueprint** and connect the `lucascollins-11/burrow-brawl` repository.
2. Render reads `render.yaml` and creates `burrow-brawl-server`.
3. When prompted, enter `JWT_SECRET` (32+ bytes, see above) and `ALLOWED_ORIGINS`.
4. Wait for the first deploy. Open `https://<service>.onrender.com/healthz` and check that it responds.
5. Copy the service URL and change it to `wss://` for `VITE_GAME_SERVER_URL`.
6. Go back to Vercel, add `VITE_GAME_SERVER_URL` with that `wss://` URL under **Environment Variables**, and redeploy the client.
7. Add the Vercel URL to `ALLOWED_ORIGINS` on Render, then redeploy the server.

**Now you are online with friends.** Choose **Create room** and share the invite link.

## Checking a deploy

- `GET /healthz` on the server returns 200.
- **Local play** on the title screen starts a match with no server.
- Opening `/r/<code>` on the client loads the app, not a 404.
- Two browser tabs can connect to the same room code.
