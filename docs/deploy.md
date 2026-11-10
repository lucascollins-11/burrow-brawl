# Deploying Burrow Brawl

Two pieces are deployed separately:

- **Server** (`server/`): a Docker image on Render, from `render.yaml` and `server/Dockerfile`. It serves WebSockets and `GET /healthz`.
- **Client** (`client/`): a static Vite build on Vercel, from `client/vercel.json`. Routes under `/r/:code` (room links) serve `index.html`.

## Environment variables

| Variable | Where it is set | Used by | Notes |
|---|---|---|---|
| `VITE_GAME_SERVER_URL` | Vercel, Production and Preview | Client, at build time | Full `wss://` URL of the Render service, for example `wss://burrow-brawl-server.onrender.com`. Changing it needs a redeploy. |
| `ALLOWED_ORIGINS` | Render | Server | Comma-separated list of client origins allowed to connect, for example `https://burrow-brawl.vercel.app`. |
| `JWT_SECRET` | Render | Server | Secret for signing session tokens. Generate a long random value and keep it private. Do not commit it. |
| `PORT` | Render (set automatically) | Server | Render sets this. The server defaults to `3000` locally. |

Never commit real values. Put local values in `.env` files, which are git-ignored.

## Steps: Render (server)

1. In Render, choose **New** > **Blueprint** and connect the `lucascollins-11/burrow-brawl` repository.
2. Render reads `render.yaml` and creates `burrow-brawl-server`.
3. When prompted, enter `JWT_SECRET` and `ALLOWED_ORIGINS`.
4. Wait for the first deploy. Open `https://<service>.onrender.com/healthz` and check that it responds.
5. Copy the service URL and change it to `wss://` for `VITE_GAME_SERVER_URL`.

## Steps: Vercel (client)

1. In Vercel, choose **Add New** > **Project** and import `lucascollins-11/burrow-brawl`.
2. Set **Root Directory** to the repository root. `client/vercel.json` sets the build and output paths.
3. Under **Environment Variables**, add `VITE_GAME_SERVER_URL` with the `wss://` URL from Render.
4. Deploy. Then open `https://<project>.vercel.app/r/TEST` and check that the app loads.
5. Add the Vercel URL to `ALLOWED_ORIGINS` on Render, then redeploy the server.

## Checking a deploy

- `GET /healthz` on the server returns 200.
- Opening `/r/<code>` on the client loads the app, not a 404.
- Two browser tabs can connect to the same room code.
