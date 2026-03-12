# Prizma Tracker

GPS tracking system for field worker management, consisting of a React Native Android app and a React/TypeScript admin portal.

![Demo](./assets/Showreel-Grid-Mobile-remix_20260312155943.gif)

---

## Features

### Mobile App
- PIN-based login with device-bound session management
- Real-time GPS tracking with outlier filtering
- KML-based territory selection and overlay
- Background tracking with foreground service notification
- Batch upload to Firestore (every 20s)

### Admin Portal
- Live worker positions on interactive Leaflet map
- Speed-based color-coded route visualization
- Session history with filters (worker, territory, status, date)
- PDF/Excel export of completed sessions
- Responsive design (desktop, tablet, mobile)

---

## Tech Stack

### Mobile
- React Native (Android)
- Firebase Firestore & Auth
- TypeScript

### Admin Portal
- React 18, TypeScript, Vite
- Firebase Firestore
- Leaflet + OpenStreetMap
- CSS Modules
- Vercel

---

## Project Structure
```
/PrizmaTrackerApp       # React Native Android app
/prizma-admin-portal    # React admin dashboard
/scripts                # Firestore sync and migration scripts
```

---

## License

Proprietary — Prizma Distribucija