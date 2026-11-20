# New API Electron Desktop App

This directory contains the Electron wrapper for New API, providing a native desktop application with system tray support for Windows, macOS, and Linux.

## Prerequisites

### 1. Go Binary (Required)
The Electron app requires the compiled Go binary to function. You have two options:

**Option A: Use existing binary (without Go installed)**
```bash
# If you have a pre-built binary (e.g., new-api-macos)
cp ../new-api-macos ../new-api
```

**Option B: Build from source (requires Go)**
TODO

### 3. Electron Dependencies
```bash
cd electron
npm install
```

## Development

Run the app in development mode:
```bash
npm start
```

This will:
- Start the Go backend on port 3000
- Open an Electron window with DevTools enabled
- Create a system tray icon (menu bar on macOS)
- Store database in `../data/new-api.db`

## Building for Production

### Quick Build
```bash
# Ensure Go binary exists in parent directory
ls ../new-api  # Should exist

# Build for current platform
npm run build

# Platform-specific builds
npm run build:mac    # Creates .dmg and .zip
npm run build:win    # Creates .exe installer
npm run build:linux  # Creates .AppImage and .deb
```

### Build Output
- Built applications are in `electron/dist/`
- macOS: `.dmg` (installer) and `.zip` (portable)
- Windows: `.exe` (installer) and portable exe
- Linux: `.AppImage` and `.deb`

## Configuration

### Port
Default port is 3000. To change, edit `main.js`:
```javascript
const PORT = 3000; // Change to desired port
```

### Database Location
- **Development**: `../data/new-api.db` (project directory)
- **Production**:
  - macOS: `~/Library/Application Support/New API/data/`
  - Windows: `%APPDATA%/New API/data/`
  - Linux: `~/.config/New API/data/`

## Sign in using the system browser

After completing the server's initial setup, choose **在浏览器登录** from the app's system tray menu. Sign in through the usual website if prompted, then return to the authorization tab and approve. The browser sends the authorization response to the app on a temporary loopback port. Both frontend themes use the same server authorization page.

The bundled client uses the local backend on port 3000. Other native clients integrating with this backend can use the following endpoints. Use HTTPS for a deployed backend and keep the HTTP listener restricted to the loopback address.

| Endpoint | Contract |
| --- | --- |
| `GET /api/desktop-auth/authorize` | Open in the system browser with `response_type=code`, `client_id=yun-token-desktop`, `redirect_uri=http://127.0.0.1:<port>/desktop-auth/callback`, a cryptographically random `state`, and the S256 `code_challenge` with `code_challenge_method=S256`. Wait for the user to approve or cancel. |
| `POST /api/desktop-auth/token` | After verifying the returned `state`, submit form parameters `grant_type=authorization_code`, `client_id`, the exact `redirect_uri`, `code` and `code_verifier`. The authorization code is single-use and expires in 60 seconds. A successful response includes `access_token`, `token_type=Bearer` and `expires_in=600`. |
| `GET /api/desktop-auth/me` | Send `Authorization: Bearer <access_token>` to read the account ID, username and display name. |
| `POST /api/desktop-auth/session` | Send the Bearer credential once to obtain the normal signed dashboard cookie. Use that cookie and the returned user's ID in `New-Api-User` for dashboard API requests. Dashboard logout uses the existing `/api/user/logout` endpoint. |
| `POST /api/desktop-auth/revoke` | Send the Bearer credential to revoke it before exchanging it for a dashboard session. |

The existing model relay still authenticates `/v1/*` using its own API keys. Desktop authorization uses the website's current sign-in methods, including the configured third-party providers. Windows and macOS use the same loopback flow and require no custom URI registration.
