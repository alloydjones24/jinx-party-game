# JINX! Party Game

A mobile-first, real-time party game for 2–8 players. Includes room codes, live lobby updates, answer submission, reveal phases, voting, scoring, a finale, and rematches.

## Run locally

Requirements: Node.js 18+

1. Unzip the project.
2. In this folder, run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000`

To play across devices on the same Wi-Fi, open the host computer's local network IP address on each phone, e.g. `http://192.168.1.10:3000`. Your firewall may need to allow port 3000.

## Deploy online

Deploy this folder to a Node.js host that supports persistent WebSocket connections. Set the start command to `npm start`. Share the deployed URL with players. The app uses WebSockets for real-time room state.

## Notes

- Rooms live in server memory and disappear when all players disconnect or the server restarts.
- This is an MVP prototype, not a hardened production service.
- For production, add room expiry, reconnect identity tokens, server-side moderation, rate limiting, and more robust semantic answer matching.
- Stand Out voting and Read My Mind are lightweight prototype rules; polish the round flow and edge cases before a public launch.
