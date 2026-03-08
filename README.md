# Vispra

Vispra is a modern HTML5 client for Xpra built with SolidJS and TypeScript. It connects to an Xpra server over WebSocket and renders remote application windows directly in the browser.

## Requirements

- Node.js 20+
- npm
- Docker

## Quick Start

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Start or prepare an Xpra server

Vispra connects to an Xpra server over WebSocket. For local development, make sure you have an Xpra server running and reachable at:

```text
ws://localhost:10000
```

If your server runs elsewhere, update the connection settings in `src/main.tsx`.

### 3. Start the Vispra development server

Run:

```bash
npm run dev
```

Open the local Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

## Development Connection

The current development setup auto-connects to:

```text
ws://localhost:10000
```

This is defined in `src/main.tsx`. If your Xpra server runs on a different host, port, or uses TLS, update the connection settings there.

## Available Scripts

Run these commands inside `vispra`:

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run test:run
npm run test:integration
npm run typecheck
```

## Integration Tests

Integration tests expect a real Xpra server on `ws://localhost:10000`.

Start the Docker server first, then run:

```bash
XPRA_TEST_URL=ws://localhost:10000 npm run test:integration
```

## Production Build

```bash
npm run build
```

The production output is generated in `dist/`.

## Notes

- The frontend currently assumes a local Xpra server for development.
- Audio support requires browser support and a running Xpra server with audio enabled.
- If port `10000` is already in use, map the container to another port and update `src/main.tsx` accordingly.

## License

MIT
