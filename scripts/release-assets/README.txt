term-webclient release bundle
=============================

This bundle runs the backend on macOS and the frontend inside Docker Desktop.
The target machine does not need Node.js, but it must have Docker Desktop running.
The bundle filename uses darwin-host-* to describe the host backend platform only.
The frontend always runs as a linux/* Docker image recorded in bundle.env.

Quick start:
1. Copy .env.example to .env and fill in real values.
2. Copy any needed example files under configs/ to their non-example names.
3. Run ./start.sh
4. Open http://127.0.0.1:11947/term/

Notes:
- start.sh binds the backend to 0.0.0.0 by default so the frontend container can reach it through host.docker.internal.
- Backend logs are written to logs/backend.out
- Frontend logs are available with: docker logs <container-name>
- Stop the bundle with ./stop.sh
