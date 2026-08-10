Mileage Tracker - Installable Test Drive PWA v1

WHAT THIS BUILD ADDS
- Installable Progressive Web App structure
- Home-screen app icon and standalone display
- Offline app shell after first successful load
- Default Home Location in Settings
- Quick destination buttons for Home and Work
- Quick Home start-location button
- All previous Work/Personal tracking, GPS, history, missed journey, reconciliation and exports

IMPORTANT: INSTALLATION NEEDS HTTPS
A PWA must normally be opened from a secure HTTPS website before a phone will offer normal app installation and before location permissions work reliably. Opening index.html directly from the ZIP is useful for reviewing the interface but is not the proper install/test route.

EASIEST TEST-DRIVE ROUTE
1. Put the contents of this folder on any HTTPS static web host.
2. Open the HTTPS address on your phone.
3. Allow Location permission.
4. Use the browser's Install/Add to Home Screen option (or the in-app Install button when available).
5. Open Mileage Tracker from the new home-screen icon.
6. Go to Settings and enter Driver, Van Registration, Default Home Location, Default Work Location and current odometer.

ANDROID
Open the hosted HTTPS address in Chrome. When the app meets install criteria, use the Install prompt/button or Chrome menu's app/home-screen installation option.

iPHONE
Open the hosted HTTPS address in Safari and use Share > Add to Home Screen. The app will then launch in a standalone window from its icon.

TESTING NOTES
- Keep the app running during a journey in this PWA test version. Mobile browsers can pause location tracking when the app is suspended/backgrounded.
- Google Maps navigation opens separately.
- This build does not use a paid Google API. Destination entry is manual plus Home/Work shortcuts.
- Data is stored locally on that browser/device. Clearing site data removes it.
- The .xls export is Excel-compatible HTML, not yet direct modification of the company's original legacy .xls template.

PRODUCTION MOBILE BUILD LATER
For robust locked-screen/background GPS, we should move the approved workflow into a native/cross-platform mobile wrapper (for example Flutter or React Native) with native background location permission handling.
