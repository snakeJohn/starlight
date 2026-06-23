# Starlight Acceptance Checklist

## Build

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run validate`

## Test Environment

- Host: `http://192.168.31.63:18191/`
- Songloft login: `admin/admin`
- Plugin entry: `/api/v1/jsplugin/starlight/`

## Source Rules

- First run shows zero music sources.
- Star Sea source is manually imported from the user-provided download path for testing.
- Paid source file is not read, copied, bundled, logged, or configured.

## Manual QR Login

- Start QR login in the UI.
- User scans QR code.
- Polling returns success.
- Device list loads after login.

## Main Flow

- Import and enable Star Sea source.
- Search a song.
- Resolve preview URL.
- Import result into Songloft.
- Push result to selected smart speaker.
- Enable conversation listener.
- Test rule voice command.
- Test external search fallback after local index miss.
